/**
 * VaultUploadContext
 *
 * App-level owner of PHOTO-VAULT uploads (the MediaGallery "Upload Now" flow).
 * Living here — not inside MediaGallery — buys three things the vault asked for:
 *
 *   1. BACKGROUND: the batch keeps streaming while the user navigates anywhere
 *      in the app (the gallery unmounting can't cancel it), with a floating
 *      pill (VaultUploadPill, mounted at the app root) showing the live
 *      percentage the whole time.
 *   2. PERSISTENCE: the queue is checkpointed to AsyncStorage after every
 *      item. If the app is killed mid-batch, the NEXT launch restores the
 *      batch and resumes from the first un-uploaded item (files re-resolved
 *      from the photo library by assetId — picker cache URIs don't survive
 *      relaunches).
 *   3. DUPLICATES: before any bytes move, one batch call to
 *      /api/media/check-duplicates fingerprints every item (name+size, or
 *      name-stem+capture-time so HEIC→JPEG conversion still matches). Hits are
 *      SKIPPED — no wasted transfer — counted in the final stats, and offered
 *      for deletion alongside the uploaded originals when the batch finishes.
 *
 * Native multipart streaming, retries, and the two-phase watchdog live in the
 * shared streamMultipartUpload service so share-intent imports and vault
 * batches use one upload loop.
 */
import React, { createContext, useContext, useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import * as MediaLibrary from 'expo-media-library';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useServer } from './ServerContext';
import { useAuth } from './AuthContext';
import { notifyUploadComplete, updateUploadProgress, clearUploadProgress } from '../services/uploadNotify';
import { streamMultipartUpload } from '../services/streamMultipartUpload';
import { reportUploadIssue } from '../services/uploadDiagnostics';
import { registerUploadWorker, scheduleUploadDrain, cancelUploadDrain, registerAutoUploadScanner } from '../services/backgroundUploadTask';
import { subscribeAutoUpload, runAutoUpload } from '../services/cameraRollAutoUpload';
import { notifyHaptic } from '../utils/haptics';

// Split into three contexts so a consumer only re-renders on the slice it
// cares about. The `state` snapshot churns on EVERY upload % tick; before the
// split MediaGallery (which only needs status/finishedAt + enqueue) re-rendered
// on every tick through the single combined value.
//   • Actions   — the stable callbacks. Created once.
//   • State     — { state: snapshot, hidden }. Ticks. Only VaultUploadPill.
//   • Lifecycle — { status, finishedAt }. Changes only at batch boundaries.
const VaultUploadActionsContext = createContext(null);
const VaultUploadStateContext = createContext(null);
const VaultUploadLifecycleContext = createContext(null);

// One in-flight batch, checkpointed here after every item so a killed app
// resumes instead of restarting. v1 of the shape — bump the key on breaking
// changes so a stale queue from an old build can't confuse a new one.
const QUEUE_KEY_PREFIX = 'turtle:vaultUpload:batch:v2:';
const queueKeyFor = (identity) => `${QUEUE_KEY_PREFIX}${encodeURIComponent(identity || 'none')}`;

// Real mime for the streamed part when the picker doesn't report one —
// passthrough mode returns .mov/HEVC originals the old hardcoded video/mp4
// mislabeled.
const VIDEO_MIME = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime',
  avi: 'video/x-msvideo', mkv: 'video/x-matroska', webm: 'video/webm',
  '3gp': 'video/3gpp', wmv: 'video/x-ms-wmv', flv: 'video/x-flv',
};

// Terminal per-item states — anything here counts toward batch progress.
const TERMINAL = new Set(['uploaded', 'duplicate', 'failed', 'missing']);

// ── Background uploads, phase 1 (docs/superpowers/plans/2026-09-09-background-uploads.md)
// Every upload task rides an iOS background NSURLSession (expo-file-system's
// legacy default), so a file that is IN FLIGHT keeps transferring after the
// app is suspended — but only files already handed to the session do. So the
// worker keeps a small pool in the foreground and, the moment the app goes to
// the background, FANS OUT: it hands the session the next several files at
// once and lets them run while the app sleeps. An item in the session is
// `inflight` (not terminal; persisted per start). If the app is killed, the
// next launch resets in-flight items to pending and the per-segment duplicate
// pre-check skips whatever actually landed — so nothing uploads twice and
// nothing is lost.
const FOREGROUND_CONCURRENCY = 2;
const BACKGROUND_FANOUT = 8;
// RECONCILE. A task whose bytes finished while the app slept may never hand
// its completion back to JavaScript (seen on device: "stuck at 99 %" after
// returning). So on every foreground — and on a slow tick while uploading —
// the pond is asked which in-flight items it already HAS (the same
// name+size / stem+capture-time fingerprint the pre-check uses): those are
// marked uploaded and their dangling tasks cancelled; an item in flight far
// too long with no progress is re-queued once. Every outcome is logged and
// filed as a feedback note (services/uploadDiagnostics).
const RECONCILE_MIN_INFLIGHT_MS = 20 * 1000;
const RECONCILE_STALE_MS = 4 * 60 * 1000;
const PERSIST_COALESCE_MS = 1000;
const RECONCILE_TICK_MS = 45 * 1000;
const MAX_ITEM_RETRIES = 2;

// Tally a batch's item outcomes. Module-scope + pure (reads only its arg +
// TERMINAL) so both the publisher and the OS-notification driver can call it.
function countsOf(batch) {
  const c = { uploaded: 0, duplicate: 0, failed: 0, missing: 0, terminal: 0 };
  for (const it of batch.items) {
    if (it.status === 'uploaded') c.uploaded++;
    else if (it.status === 'duplicate') c.duplicate++;
    else if (it.status === 'failed') c.failed++;
    else if (it.status === 'missing') c.missing++;
    if (TERMINAL.has(it.status)) c.terminal++;
  }
  return c;
}
// Overall % from a batch + the live fraction of the item currently streaming.
function pctOf(batch, currentItemPct) {
  const c = countsOf(batch);
  const total = batch.items.length || 1;
  return Math.min(100, Math.floor(((c.terminal + currentItemPct / 100) / total) * 100));
}

export function VaultUploadProvider({ children }) {
  const { getBaseUrl } = useServer();
  const { isAuthenticated, token, authIdentity, authGeneration } = useAuth();
  const authRef = useRef({ isAuthenticated, token, authIdentity, authGeneration });
  authRef.current = { isAuthenticated, token, authIdentity, authGeneration };
  // Live base-URL getter for the async worker (server IP can change mid-batch).
  const getBaseUrlRef = useRef(getBaseUrl);
  useEffect(() => { getBaseUrlRef.current = getBaseUrl; }, [getBaseUrl]);

  // Source of truth is a mutable ref the worker owns; React state is a
  // published snapshot (same pattern as ShareUploadContext — immune to stale
  // closures in the long-running loop).
  const batchRef = useRef(null);
  const workerBusyRef = useRef(null);
  // Live progress of the items currently streaming, summed (two items at 50%
  // = 100): pctOf divides by 100, so the sum is "items' worth of progress".
  const currentPctRef = useRef(0);
  const itemPctRef = useRef(new Map()); // item key → its own %
  const itemProgressAtRef = useRef(new Map()); // item key → last progress time
  const itemAbortRef = useRef(new Map()); // item key → its own AbortController
  // The pool's "re-evaluate now" hook: the AppState listener pulls it when the
  // app backgrounds so the fan-out starts immediately, not at the next settle.
  const wakePoolRef = useRef(null);
  const diagCtx = () => ({ getBaseUrl: getBaseUrlRef.current, token: authRef.current.token });
  const [snapshot, setSnapshot] = useState(null);
  const lastShownPctRef = useRef(-1);
  // Pill visibility. `hidden` collapses the floating pill during an upload
  // (the batch keeps running; the vault screen + the OS notification still
  // show progress). Never applies to the 'done' state — the finish stats +
  // delete offer must never be missed.
  const [hidden, setHidden] = useState(false);
  // Whether the app is foregrounded, and the last progress-notification we
  // posted — the OS notification is driven ONLY while backgrounded, throttled.
  const appActiveRef = useRef(true);
  const lastNotifRef = useRef({ pct: -1, at: 0 });
  const ownsBatch = useCallback((batch) => {
    const auth = authRef.current;
    return !!(
      batch &&
      auth.isAuthenticated &&
      batch.ownerIdentity === auth.authIdentity &&
      batch.authGeneration === auth.authGeneration
    );
  }, []);

  // Drive the OS "dynamic widget" — a live, re-posted-in-place notification —
  // but ONLY while the app is BACKGROUNDED and a batch is actively uploading.
  // Foreground → the in-app pill/vault UI owns it, so clear the notification.
  // Throttled so a burst of % ticks can't hammer the notification centre.
  const driveProgressNotification = useCallback(() => {
    const batch = batchRef.current;
    if (!batch || batch.status !== 'uploading' || appActiveRef.current) {
      if (lastNotifRef.current.pct !== -1) {
        lastNotifRef.current = { pct: -1, at: 0 };
        clearUploadProgress();
      }
      return;
    }
    const c = countsOf(batch);
    const pct = pctOf(batch, currentPctRef.current);
    const inflight = batch.items.filter((it) => it.status === 'inflight').length;
    const now = Date.now();
    const { pct: lastPct, done: lastDone, at } = lastNotifRef.current;
    // Post when the % OR the landed count changes (rate-limited to min 800ms
    // apart), or as a 5s heartbeat when unchanged; skip otherwise. The count
    // is what the user reads — "how many are up" — so a finished item always
    // reaches the notification even when the % rounds to the same number.
    const changed = pct !== lastPct || c.terminal !== lastDone;
    if (!changed && now - at < 5000) return;
    if (changed && now - at < 800) return;
    lastNotifRef.current = { pct, done: c.terminal, at: now };
    updateUploadProgress({
      pct,
      total: batch.items.length,
      uploaded: c.uploaded,
      inflight,
      duplicates: c.duplicate,
      failed: c.failed + c.missing,
    });
  }, []);

  // Overall % = (terminal items + current item's fraction) / total. Duplicates
  // and failures advance the bar too — the user cares about "how much of my
  // batch is dealt with".
  const publish = useCallback(() => {
    const batch = batchRef.current;
    if (!batch) { setSnapshot(null); lastShownPctRef.current = -1; driveProgressNotification(); return; }
    const c = countsOf(batch);
    const pct = pctOf(batch, currentPctRef.current);
    lastShownPctRef.current = pct;
    setSnapshot({
      active: true,
      status: batch.status,                 // 'uploading' | 'paused' | 'done'
      pct,
      total: batch.items.length,
      currentIndex: Math.min(c.terminal + 1, batch.items.length),
      uploaded: c.uploaded,
      duplicates: c.duplicate,
      failed: c.failed + c.missing,
      // Originals we can offer to delete: everything now safely in the vault —
      // the freshly uploaded ones AND the skipped duplicates (already there).
      deletableCount: batch.items.filter((it) => (it.status === 'uploaded' || it.status === 'duplicate') && it.assetId).length,
      finishedAt: batch.finishedAt || null,
    });
    driveProgressNotification();
  }, [driveProgressNotification]);

  // Progress ticks are high-frequency; only re-publish when the INTEGER shown
  // in the pill actually changes (publish also re-evaluates the OS notification).
  const publishPctTick = useCallback(() => {
    const batch = batchRef.current;
    if (!batch) return;
    if (pctOf(batch, currentPctRef.current) !== lastShownPctRef.current) publish();
  }, [publish]);

  // Checkpoint the batch (drop transient per-item meta — it's re-resolved on
  // resume). Status transitions checkpoint at once; the per-item hot path
  // goes through persistSoon (below) — a 450-item batch used to serialize
  // the whole array ~900 times, twice per item, on the JS thread while the
  // user scrolled (perf sweep 2026-09-10).
  const persistTimerRef = useRef(null);
  const persist = useCallback(async () => {
    if (persistTimerRef.current) { clearTimeout(persistTimerRef.current); persistTimerRef.current = null; }
    const batch = batchRef.current;
    try {
      if (!batch) return;
      const lean = {
        ...batch,
        items: batch.items.map(({ meta, ...rest }) => rest),
      };
      delete lean.token;
      delete lean.abortController;
      await AsyncStorage.setItem(queueKeyFor(batch.ownerIdentity), JSON.stringify(lean));
    } catch (e) { /* best-effort — worst case a restart re-uploads one item */ }
  }, []);

  /**
   * The per-item checkpoint. Foreground: trailing, at most one write per
   * PERSIST_COALESCE_MS. Background: immediate — the OS may suspend us at any
   * moment and the resume contract needs the latest picture on disk.
   */
  const persistSoon = useCallback(() => {
    if (!appActiveRef.current) { persist(); return; }
    if (persistTimerRef.current) return;
    persistTimerRef.current = setTimeout(() => { persistTimerRef.current = null; persist(); }, PERSIST_COALESCE_MS);
  }, [persist]);

  const clearBatch = useCallback(() => {
    const ownerIdentity = batchRef.current?.ownerIdentity || authRef.current.authIdentity;
    batchRef.current = null;
    currentPctRef.current = 0;
    setHidden(false);
    lastNotifRef.current = { pct: -1, at: 0 };
    clearUploadProgress();
    publish();
    if (ownerIdentity) AsyncStorage.removeItem(queueKeyFor(ownerIdentity)).catch(() => {});
  }, [publish]);

  // Resolve an item to an uploadable file on THIS launch: prefer the photo
  // library (assetId survives forever), fall back to the stored URI (picker
  // cache — valid within the session it was picked in). Returns null if the
  // bytes are gone (deleted from the device between sessions).
  const resolveItem = async (item) => {
    let uri = null;
    let info = null;
    let assetInfo = null;
    if (item.assetId) {
      try { assetInfo = await MediaLibrary.getAssetInfoAsync(item.assetId); } catch (e) { /* asset gone / no permission */ }
      if (assetInfo?.localUri || assetInfo?.uri) uri = assetInfo.localUri || assetInfo.uri;
    }
    if (!uri && item.uri) uri = item.uri;
    if (!uri) return null;
    try { info = await FileSystem.getInfoAsync(uri, { size: true }); } catch (e) { return null; }
    if (!info?.exists) {
      // Stored URI died (cache purge). One more chance via the library copy.
      if (item.uri && uri === item.uri && item.assetId && assetInfo?.localUri && assetInfo.localUri !== uri) {
        uri = assetInfo.localUri;
        try { info = await FileSystem.getInfoAsync(uri, { size: true }); } catch (e) { return null; }
        if (!info?.exists) return null;
      } else {
        return null;
      }
    }
    return {
      uri,
      size: info.size || 0,
      creationTime: assetInfo?.creationTime || null,
      width: assetInfo?.width || item.width || null,
      height: assetInfo?.height || item.height || null,
      duration: assetInfo?.duration ? Math.round(assetInfo.duration * 1000) : (item.duration || null),
    };
  };

  // Best-effort batch duplicate pre-check. Network failure → nobody is marked
  // duplicate (the upload just proceeds — a pre-check must never strand a
  // batch). Also doubles as the reachability probe on resume.
  const checkDuplicates = async (items, batch) => {
    const base = getBaseUrlRef.current?.();
    if (!base) throw new Error('no server url');
    const endpoint = base.endsWith('/api') ? `${base}/media/check-duplicates` : `${base}/api/media/check-duplicates`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(batch.token ? { Authorization: `Bearer ${batch.token}` } : {}) },
      signal: batch.abortController.signal,
      body: JSON.stringify({
        items: items.map((it) => ({
          name: it.fileName || '',
          size: it.meta?.size || 0,
          originalDate: it.meta?.creationTime || 0,
        })),
      }),
    });
    const j = await res.json();
    if (!j?.success) throw new Error(j?.error || 'check-duplicates failed');
    return j.results || [];
  };

  // ── The worker ─────────────────────────────────────────────────────────────
  // Runs the current batch to completion. Safe to call repeatedly — a busy
  // flag makes it single-flight, and every item is skipped once terminal, so
  // a resume call simply continues where the last run stopped.
  const processBatch = useCallback(async () => {
    if (workerBusyRef.current) return;
    const batch = batchRef.current;
    if (!batch || batch.status === 'done' || !ownsBatch(batch)) return;
    const isCurrentBatch = () =>
      batchRef.current === batch &&
      ownsBatch(batch) &&
      !batch.abortController.signal.aborted;
    workerBusyRef.current = batch;
    batch.status = 'uploading';
    // The worker is single-flight, so any item still marked in-flight at entry
    // is a leftover from a run that died (kill, crash): back to pending. The
    // pre-check below skips it if its bytes already landed.
    let leftovers = 0;
    for (const it of batch.items) if (it.status === 'inflight') { it.status = 'pending'; delete it.inflightAt; leftovers += 1; }
    if (leftovers) reportUploadIssue('inflight-leftover-at-start', { count: leftovers, batch: batch.id }, diagCtx());
    itemPctRef.current.clear();
    itemProgressAtRef.current.clear();
    itemAbortRef.current.clear();
    currentPctRef.current = 0;
    publish();

    // Wake signal for the pool: resolved by the AppState listener (background
    // → fan out NOW) and re-armed on every use.
    const wake = { promise: null, resolve: null };
    const armWake = () => { wake.promise = new Promise((r) => { wake.resolve = r; }); };
    armWake();
    wakePoolRef.current = () => { const r = wake.resolve; armWake(); r?.(); };

    try {
      // Photo-library permission: needed to resolve assetIds (resume) and for
      // the end-of-batch delete offer. Non-granted is fine — picker URIs still
      // work within the session they were picked.
      try { await MediaLibrary.requestPermissionsAsync(); } catch (e) { /* optional */ }

      // SEGMENTED PIPELINE. A 450-item batch used to resolve every asset up
      // front and then run 450 back-to-back upload iterations; on iOS that
      // crashed the app around item ~200. Not the file bytes — those stream
      // natively and never enter JS — but everything AROUND them accumulated:
      // 450 PHAsset touches and their meta objects held for the whole run,
      // per-item native transients (HEIC re-encode bitmaps, video thumbnail
      // decodes, their base64 strings) allocated back-to-back with no gap for
      // iOS to drain autorelease pools, until jetsam killed the process.
      //
      // The industry-standard shape for a massive sequential transfer is a
      // WINDOWED queue, and that is what this is:
      //   • work proceeds in segments of SEGMENT_SIZE items — the working set
      //     is bounded no matter how large the batch is
      //   • metadata resolves just-in-time, per segment, so an asset is
      //     touched only when its turn approaches
      //   • the duplicate pre-check runs per segment (same endpoint, smaller
      //     bodies) and still skips hits before any of THEIR bytes move; its
      //     unreachable→retry→pause behaviour is preserved per segment
      //   • an item's meta is RELEASED the moment it goes terminal, so the
      //     retained graph shrinks as the batch progresses instead of growing
      //     (this also keeps the per-item AsyncStorage checkpoints small —
      //     resume re-resolves from assetId, which was already the contract)
      //   • segments are separated by a short breather that yields the JS
      //     thread and gives native pools a frame to drain
      // Per-item checkpointing is unchanged, so kill/resume still lands on
      // the next unfinished item regardless of segment boundaries.
      const SEGMENT_SIZE = 24;
      const SEGMENT_BREATHER_MS = 250;
      const base = getBaseUrlRef.current?.() || '';
      const uploadEndpoint = base.endsWith('/api') ? `${base}/media/upload` : `${base}/api/media/upload`;

      for (;;) {
      const segment = batch.items.filter((it) => !TERMINAL.has(it.status)).slice(0, SEGMENT_SIZE);
      if (segment.length === 0) break;

      // 1. METADATA PASS (this segment) — resolve to a live file + duplicate
      //    fingerprint inputs. Items whose bytes are gone become 'missing'.
      for (const item of segment) {
        if (!isCurrentBatch()) return;
        const meta = await resolveItem(item);
        if (!isCurrentBatch()) return;
        if (!meta) { item.status = 'missing'; continue; }
        item.meta = meta;
      }
      publish();

      // 2. DUPLICATE PRE-CHECK (this segment) — hits are skipped before any
      //    bytes move. Also the reachability probe: unreachable → retry with
      //    backoff → PAUSE the batch (resumable) instead of burning items.
      const toCheck = segment.filter((it) => !TERMINAL.has(it.status));
      if (toCheck.length > 0) {
        let results = null;
        for (let attempt = 1; attempt <= 5; attempt++) {
          try { results = await checkDuplicates(toCheck, batch); break; } catch (e) {
            if (!isCurrentBatch()) return;
            console.warn(`[VaultUpload] duplicate pre-check unreachable (attempt ${attempt}/5): ${e.message}`);
            if (attempt < 5) await new Promise((r) => setTimeout(r, attempt * 2000));
          }
        }
        if (results === null) {
          batch.status = 'paused';
          publish();
          await persist();
          return; // resumed by AppState listener / the pill's Resume button
        }
        results.forEach((r, i) => {
          if (r?.duplicate) {
            toCheck[i].status = 'duplicate';
            toCheck[i].dupOf = r.id || null;
            toCheck[i].meta = null; // terminal — release immediately
          }
        });
        const dupCount = results.filter((r) => r?.duplicate).length;
        if (dupCount) console.log(`[VaultUpload] ⏭ ${dupCount} duplicate${dupCount === 1 ? '' : 's'} skipped (already in the vault)`);
        publish();
        await persist();
      }

      // 3. UPLOAD POOL (this segment) — stream the survivors through a small
      //    pool, checkpointing on every start AND every finish so a killed app
      //    knows exactly what was in the session. Foreground: 2 at a time.
      //    Background: fan out to 8 — the background session carries them
      //    while the app sleeps.
      const uploadOne = async (item) => {
        let tempThumbnailUri = null;
        try {
          const meta = item.meta || (await resolveItem(item));
          if (!meta) { item.status = 'missing'; item.meta = null; return; }

          // Multipart TEXT fields go as a flat string map (the streaming
          // uploader takes `parameters`, not a FormData/blob).
          const parameters = {};
          if (meta.creationTime) parameters.originalDate = String(meta.creationTime);
          if (meta.width) parameters.width = String(meta.width);
          if (meta.height) parameters.height = String(meta.height);
          parameters.tags = JSON.stringify(batch.tags && batch.tags.length > 0 ? batch.tags : ['Phone Uploads']);
          // Files tab: "Upload here" files the whole batch into one folder.
          if (batch.folderId) parameters.folderId = batch.folderId;

          const originalFilename = item.fileName || String(meta.uri).split('/').pop() || 'file';
          const isVideo = item.type === 'video' || /\.(mp4|mov|avi|mkv|wmv|flv|webm|m4v|3gp)$/i.test(originalFilename);
          const isHeic = /\.heic$/i.test(originalFilename) || /\.heif$/i.test(originalFilename);

          let mediaUri = meta.uri;
          let mediaName = originalFilename;
          const fileExt = (originalFilename.split('.').pop() || '').toLowerCase();
          let mediaType = isVideo
            ? (item.mimeType || VIDEO_MIME[fileExt] || 'video/mp4')
            : 'image/jpeg';

          if (isVideo) {
            // A streamed upload carries ONE file; the small captured-frame
            // thumbnail rides along as a base64 parameter (server decodes it).
            try {
              const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(meta.uri, { time: 1000, quality: 0.8 });
              tempThumbnailUri = thumbUri;
              parameters.thumbnailBase64 = await FileSystem.readAsStringAsync(
                tempThumbnailUri, { encoding: FileSystem.EncodingType.Base64 },
              );
            } catch (e) { /* server falls back to a placeholder thumbnail */ }
            if (meta.duration) parameters.duration = String(Math.round(meta.duration / 1000));
          } else if (isHeic) {
            // HEIC uploads AS-IS. The client-side re-encode that used to live
            // here (ImageManipulator → JPEG) decoded a full-resolution bitmap
            // on the phone for every photo — and an iPhone camera roll is
            // mostly HEIC, so a 450-item batch did hundreds of full-res
            // decodes back-to-back. That native allocation churn was the
            // standing suspect for iOS killing the app mid-batch. The server
            // now converts HEIC itself (heic-convert in the upload handler,
            // on a 56-core machine); the phone just streams the original
            // bytes, which also uploads less data than the re-encoded JPEG.
            mediaType = 'image/heic';
          }
          // The streamed part's filename is the cache URI's basename (a UUID),
          // so send the real name explicitly to preserve it server-side.
          parameters.originalName = mediaName;
          parameters.clientImportId = item.clientImportId;

          const sizeMB = (meta.size || 0) / (1024 * 1024);
          console.log(`[VaultUpload] ▶ ${mediaName} · ${sizeMB.toFixed(1)}MB · ${mediaType}${isVideo ? ' (video)' : ''}`);

          // Monotonic per-item progress, fed by the native streaming callback;
          // the batch-level figure is the SUM over the pool.
          let itemPct = 0;
          itemPctRef.current.set(item.key, 0);
          itemProgressAtRef.current.set(item.key, Date.now());
          const onProgress = (pct) => {
            if (pct <= itemPct) return;
            itemPct = pct;
            itemPctRef.current.set(item.key, pct);
            itemProgressAtRef.current.set(item.key, Date.now());
            let sum = 0;
            for (const v of itemPctRef.current.values()) sum += v;
            currentPctRef.current = sum;
            publishPctTick();
          };

          // Per-item cancellation (reconcile), chained to the batch's abort.
          const itemAbort = new AbortController();
          const onBatchAbort = () => itemAbort.abort();
          batch.abortController.signal.addEventListener('abort', onBatchAbort, { once: true });
          itemAbortRef.current.set(item.key, itemAbort);
          try {
            await streamMultipartUpload({
              url: uploadEndpoint,
              fileUri: mediaUri,
              mimeType: mediaType,
              parameters,
              token: batch.token,
              label: mediaName,
              onProgress,
              signal: itemAbort.signal,
              onAnomaly: (a) => reportUploadIssue(`watchdog-${a.phase}`, { ...a, item: mediaName }, diagCtx()),
            });
          } finally {
            batch.abortController.signal.removeEventListener('abort', onBatchAbort);
            itemAbortRef.current.delete(item.key);
          }
          if (!isCurrentBatch()) return;
          item.status = 'uploaded';
          item.meta = null; // terminal — release the retained graph as we go
        } catch (error) {
          if (!isCurrentBatch()) return;
          const verdict = item.reconcile;
          delete item.reconcile;
          if (verdict === 'landed') {
            // The pond already has it; the task's completion never came back.
            item.status = 'uploaded';
            item.meta = null;
          } else if (verdict === 'retry' && (item.retries || 0) < MAX_ITEM_RETRIES) {
            item.retries = (item.retries || 0) + 1;
            item.status = 'pending'; // the pool picks it up again
          } else {
            console.error(`[VaultUpload] Failed ${item.fileName || item.key}:`, error.message);
            reportUploadIssue('item-failed', { item: item.fileName || item.key, error: String(error?.message || error), retries: item.retries || 0 }, diagCtx());
            item.status = 'failed';
            item.meta = null; // terminal — release
          }
        } finally {
          delete item.inflightAt;
          itemProgressAtRef.current.delete(item.key);
          if (tempThumbnailUri) FileSystem.deleteAsync(tempThumbnailUri, { idempotent: true }).catch(() => {});
          itemPctRef.current.delete(item.key);
          let sum = 0;
          for (const v of itemPctRef.current.values()) sum += v;
          currentPctRef.current = sum;
          if (isCurrentBatch()) {
            publish();
            persistSoon();
          }
        }
      };

      const active = new Map(); // item key → its running upload
      const limit = () => (appActiveRef.current ? FOREGROUND_CONCURRENCY : BACKGROUND_FANOUT);
      for (;;) {
        if (!isCurrentBatch()) return;
        // Top the pool up to the current limit — which jumps to the fan-out
        // size the moment the app backgrounds (the wake below re-runs this).
        let started = 0;
        for (const item of segment) {
          if (active.size >= limit()) break;
          if (item.status !== 'pending' && item.status !== undefined) continue;
          item.status = 'inflight';
          item.inflightAt = Date.now();
          const run = uploadOne(item).finally(() => { active.delete(item.key); });
          active.set(item.key, run);
          started += 1;
        }
        if (started > 0) { publish(); persistSoon(); }
        if (active.size === 0) break;
        await Promise.race([...active.values(), wake.promise]);
      }
      if (!isCurrentBatch()) return;
      // A retry re-queued an item in this segment: run the segment again
      // (the pre-check will skip it if it had in fact landed).
      if (segment.some((it) => it.status === 'pending')) continue;

      // Segment boundary: yield the JS thread and give iOS a beat to drain
      // native autorelease pools before the next window begins. 250ms every
      // 24 items adds ~4.7s across a 450-item batch — noise against the
      // upload time, and the difference between finishing and being killed.
      if (!isCurrentBatch()) return;
      await new Promise((r) => setTimeout(r, SEGMENT_BREATHER_MS));
      }

      // 4. FINISH — freeze the stats (incl. how many duplicates were found),
      //    surface the delete offer in the pill, ping a notification if the
      //    app is backgrounded. The batch stays persisted until the user
      //    answers the delete prompt (or dismisses), so even the OFFER
      //    survives an app restart.
      batch.status = 'done';
      batch.finishedAt = Date.now();
      cancelUploadDrain(); // nothing left for a background window to do
      const c = countsOf(batch);
      console.log(`[VaultUpload] ■ batch done · ${c.uploaded} uploaded · ${c.duplicate} duplicates skipped · ${c.failed + c.missing} failed`);
      publish();
      await persist();
      notifyHaptic(c.failed + c.missing > 0 ? 'warning' : 'success');
      if (c.uploaded > 0) notifyUploadComplete(c.uploaded); // guarded; silent no-op if unavailable
    } catch (e) {
      if (!isCurrentBatch()) return;
      // Unexpected worker crash: pause (never lose the batch) — resumable.
      console.error('[VaultUpload] worker error:', e);
      if (batchRef.current) {
        batchRef.current.status = 'paused';
        publish();
        await persist();
      }
    } finally {
      if (workerBusyRef.current === batch) workerBusyRef.current = null;
      if (wakePoolRef.current) wakePoolRef.current = null;
    }
  }, [ownsBatch, publish, publishPctTick, persist]);

  // Public: start a batch. `assets` are picker/library entries; only plain
  // serializable fields are kept so the queue can persist. Returns false when
  // a batch is already running (one at a time keeps % meaningful).
  const enqueue = useCallback(({ assets, tags, folderId = null }) => {
    const auth = authRef.current;
    if (!auth.isAuthenticated || !auth.authIdentity || !auth.authGeneration || !auth.token) {
      return false;
    }
    const existing = batchRef.current;
    if (existing && existing.status !== 'done') return false;
    const id = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    batchRef.current = {
      id,
      tags: Array.isArray(tags) ? tags : [],
      folderId: folderId ? String(folderId) : null,
      startedAt: Date.now(),
      finishedAt: null,
      status: 'uploading',
      ownerIdentity: auth.authIdentity,
      authGeneration: auth.authGeneration,
      token: auth.token,
      abortController: new AbortController(),
      items: (assets || []).map((a, i) => ({
        key: `${id}-${i}`,
        assetId: a.assetId || null,
        uri: a.uri || null,
        fileName: a.fileName || (a.uri ? String(a.uri).split('/').pop() : `file-${i}`),
        mimeType: a.mimeType || null,
        type: a.type === 'video' || a.mediaType === 'video' ? 'video' : 'image',
        duration: a.duration || null,
        width: a.width || null,
        height: a.height || null,
        status: 'pending',
        clientImportId: Crypto.randomUUID(),
      })),
    };
    currentPctRef.current = 0;
    setHidden(false); // a fresh batch always shows the pill
    lastNotifRef.current = { pct: -1, at: 0 };
    publish();
    persist();
    // Phase 2: ask the OS for background windows while this batch has work.
    scheduleUploadDrain();
    processBatch(); // fire-and-forget
    return true;
  }, [publish, persist, processBatch]);

  // Ask the pond which in-flight items it already has, and settle them. Runs
  // on every foreground and on a slow tick while uploading. See RECONCILE.
  const reconcileInflight = useCallback(async () => {
    const batch = batchRef.current;
    if (!batch || batch.status !== 'uploading' || !ownsBatch(batch)) return;
    const now = Date.now();
    const stuck = batch.items.filter((it) =>
      it.status === 'inflight' && it.inflightAt && now - it.inflightAt > RECONCILE_MIN_INFLIGHT_MS && it.meta);
    if (stuck.length === 0) return;
    let results;
    try { results = await checkDuplicates(stuck, batch); } catch (e) { return; /* offline — next tick */ }
    if (batchRef.current !== batch) return;
    let landed = 0;
    let retried = 0;
    stuck.forEach((it, i) => {
      if (it.status !== 'inflight') return; // settled on its own meanwhile
      const ctrl = itemAbortRef.current.get(it.key);
      if (results[i]?.duplicate) {
        it.reconcile = 'landed';
        it.dupOf = results[i].id || null;
        landed += 1;
        ctrl?.abort();
        return;
      }
      const lastProgress = itemProgressAtRef.current.get(it.key) || it.inflightAt;
      if (now - it.inflightAt > RECONCILE_STALE_MS && now - lastProgress > 60 * 1000) {
        it.reconcile = 'retry';
        retried += 1;
        ctrl?.abort();
      }
    });
    if (landed || retried) {
      reportUploadIssue('inflight-reconciled', {
        landed, retried, inflight: stuck.length, batch: batch.id,
        oldestInflightSec: Math.round((now - Math.min(...stuck.map((it) => it.inflightAt))) / 1000),
      }, diagCtx());
    }
  }, [ownsBatch]);

  // Public: resume a paused batch (pill button / app foreground).
  const resume = useCallback(() => {
    const batch = batchRef.current;
    if (!batch || batch.status === 'done') return;
    processBatch();
  }, [processBatch]);

  // Public: delete the device originals of everything now safe in the vault —
  // the uploaded items AND the skipped duplicates. MediaLibrary shows the OS's
  // own confirmation, so this is a two-step delete. Clears the batch when the
  // user goes through with it.
  const deleteOriginals = useCallback(async () => {
    const batch = batchRef.current;
    if (!batch) return false;
    const ids = batch.items
      .filter((it) => (it.status === 'uploaded' || it.status === 'duplicate') && it.assetId)
      .map((it) => it.assetId);
    if (ids.length === 0) { clearBatch(); return false; }
    try {
      const ok = await MediaLibrary.deleteAssetsAsync(ids);
      if (ok) clearBatch();
      return !!ok;
    } catch (e) {
      // User cancelled the OS prompt / permission denied — keep the offer up.
      return false;
    }
  }, [clearBatch]);

  const dismiss = useCallback(() => { clearBatch(); }, [clearBatch]);

  // ── Cross-session resume ───────────────────────────────────────────────────
  // On mount, restore a persisted batch. Interrupted mid-upload → continue it
  // (after a short beat so Server/Auth contexts settle). Finished-but-
  // unanswered → restore the done pill so the delete offer isn't lost.
  useEffect(() => {
    let cancelled = false;
    // Clear any progress notification orphaned by a PRIOR session that was
    // killed while backgrounded mid-upload — this fresh mount is foreground,
    // so its stale % must go (the driver's runtime clear-guard is skipped on a
    // -1 lastNotifRef, so it wouldn't catch this cross-launch case).
    clearUploadProgress();
    (async () => {
      try {
        const auth = authRef.current;
        const currentKey = auth.authIdentity ? queueKeyFor(auth.authIdentity) : null;
        const existing = batchRef.current;
        if (existing && !ownsBatch(existing)) {
          existing.abortController?.abort();
          existing.status = existing.status === 'done' ? 'done' : 'paused';
          await persist();
          batchRef.current = null;
          workerBusyRef.current = null;
          currentPctRef.current = 0;
          setHidden(false);
          publish();
        }
        if (!auth.isAuthenticated || !auth.authIdentity || !auth.authGeneration || !auth.token) return;
        if (existing?.ownerIdentity === auth.authIdentity) {
          existing.authGeneration = auth.authGeneration;
          existing.token = auth.token;
          existing.abortController = new AbortController();
          batchRef.current = existing;
          if (existing.status !== 'done') {
            existing.status = 'paused';
            processBatch();
          } else {
            publish();
          }
          return;
        }
        const raw = await AsyncStorage.getItem(currentKey);
        if (!raw || cancelled) return;
        const saved = JSON.parse(raw);
        if (!saved || !Array.isArray(saved.items) || saved.items.length === 0) return;
        if (saved.ownerIdentity !== auth.authIdentity) {
          await AsyncStorage.removeItem(currentKey);
          return;
        }
        if (batchRef.current) return; // a new batch beat the restore — keep it
        saved.authGeneration = auth.authGeneration;
        saved.token = auth.token;
        saved.abortController = new AbortController();
        saved.items = saved.items.map((item) => ({
          ...item,
          // In-flight when the app died: back to pending. If the background
          // session finished it anyway, the pre-check marks it duplicate.
          status: item.status === 'inflight' ? 'pending' : item.status,
          clientImportId: item.clientImportId || Crypto.randomUUID(),
        }));
        batchRef.current = saved;
        if (saved.status === 'done') {
          publish();
          return;
        }
        saved.status = 'uploading';
        publish();
        const remaining = saved.items.filter((it) => !TERMINAL.has(it.status)).length;
        console.log(`[VaultUpload] ↻ resuming interrupted batch · ${remaining} of ${saved.items.length} left`);
        setTimeout(() => { if (!cancelled) processBatch(); }, 1500);
      } catch (e) { /* corrupt queue → start clean */ }
    })();
    return () => { cancelled = true; };
  }, [authGeneration, authIdentity, isAuthenticated, ownsBatch, persist, processBatch, publish, token]);

  // AppState is the OS-notification switch AND the paused-batch retry:
  //   • leaving  → post the live progress notification (in-app UI is gone),
  //   • returning → clear it (the pill/vault UI takes back over) and, if the
  //     batch had paused (server was unreachable), retry it now.
  useEffect(() => {
    appActiveRef.current = AppState.currentState === 'active';
    const sub = AppState.addEventListener('change', (s) => {
      appActiveRef.current = (s === 'active');
      if (s === 'active' && batchRef.current?.status === 'paused') processBatch();
      // Leaving: fan the pool out NOW, while iOS still gives us a few seconds
      // of runtime — the background session carries those files while we sleep.
      if (s !== 'active') {
        wakePoolRef.current?.();
        persist(); // flush the coalesced checkpoint before we may be suspended
        const b = batchRef.current;
        if (b && b.status !== 'done' && b.items.some((it) => !TERMINAL.has(it.status))) scheduleUploadDrain();
      }
      // Returning: settle whatever finished while we slept but never told us.
      if (s === 'active') reconcileInflight();
      driveProgressNotification();
    });
    // The slow tick catches a task stuck in the foreground too.
    const tick = setInterval(() => { if (appActiveRef.current) reconcileInflight(); }, RECONCILE_TICK_MS);
    return () => { sub.remove(); clearInterval(tick); };
  }, [processBatch, driveProgressNotification, reconcileInflight]);

  // Phase 5: new camera photos queue themselves (Settings switch, off by
  // default). Foreground triggers live here; the background window runs the
  // same scan first. enqueue is read through a ref so the subscription is
  // made once.
  const enqueueRef = useRef(null);
  enqueueRef.current = enqueue;
  useEffect(() => {
    const enq = (args) => enqueueRef.current?.(args);
    registerAutoUploadScanner(() => runAutoUpload({ enqueue: enq }));
    const unsubscribe = subscribeAutoUpload({ enqueue: enq });
    return () => { unsubscribe(); registerAutoUploadScanner(null); };
  }, []);

  // Phase 2: the background drain task polls this view of the queue while it
  // holds a processing window; `kick` resumes a paused batch inside it.
  useEffect(() => {
    registerUploadWorker({
      isBusy: () => !!workerBusyRef.current,
      hasPending: async () => {
        const b = batchRef.current;
        return !!(b && b.status !== 'done' && b.items.some((it) => !TERMINAL.has(it.status)));
      },
      kick: () => { if (batchRef.current && batchRef.current.status !== 'done') processBatch(); },
    });
    return () => registerUploadWorker(null);
  }, [processBatch]);

  const hide = useCallback(() => setHidden(true), []);
  const show = useCallback(() => setHidden(false), []);

  const actions = useMemo(
    () => ({ enqueue, resume, deleteOriginals, dismiss, hide, show }),
    [enqueue, resume, deleteOriginals, dismiss, hide, show],
  );
  const stateValue = useMemo(() => ({ state: snapshot, hidden }), [snapshot, hidden]);
  const lifecycle = useMemo(
    () => ({ status: snapshot?.status ?? null, finishedAt: snapshot?.finishedAt ?? null }),
    [snapshot?.status, snapshot?.finishedAt],
  );
  return (
    <VaultUploadActionsContext.Provider value={actions}>
      <VaultUploadLifecycleContext.Provider value={lifecycle}>
        <VaultUploadStateContext.Provider value={stateValue}>
          {children}
        </VaultUploadStateContext.Provider>
      </VaultUploadLifecycleContext.Provider>
    </VaultUploadActionsContext.Provider>
  );
}

export const useVaultUploadActions = () => {
  const ctx = useContext(VaultUploadActionsContext);
  if (!ctx) throw new Error('useVaultUploadActions must be used within a VaultUploadProvider');
  return ctx;
};
export const useVaultUploadState = () => {
  const ctx = useContext(VaultUploadStateContext);
  if (!ctx) throw new Error('useVaultUploadState must be used within a VaultUploadProvider');
  return ctx;
};
export const useVaultUploadLifecycle = () => {
  const ctx = useContext(VaultUploadLifecycleContext);
  if (!ctx) throw new Error('useVaultUploadLifecycle must be used within a VaultUploadProvider');
  return ctx;
};
