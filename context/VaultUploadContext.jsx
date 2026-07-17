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
 * The streaming uploader (createUploadTask + two-phase watchdog + retries)
 * moved here VERBATIM from MediaGallery — see the comment on it below.
 */
import React, { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as ImageManipulator from 'expo-image-manipulator';
import { useServer, getApiAuthToken } from './ServerContext';
import { notifyUploadComplete, updateUploadProgress, clearUploadProgress } from '../services/uploadNotify';
import { notifyHaptic } from '../utils/haptics';

const VaultUploadContext = createContext(null);

// One in-flight batch, checkpointed here after every item so a killed app
// resumes instead of restarting. v1 of the shape — bump the key on breaking
// changes so a stale queue from an old build can't confuse a new one.
const QUEUE_KEY = 'turtle:vaultUpload:batch:v1';

// ── Streaming media upload (moved from MediaGallery — the large-file fix) ────
// The old path appended { uri } to a FormData and sent it via XMLHttpRequest.
// React Native's FormData reads the whole file into a single in-memory blob
// before sending, so a large video (hundreds of MB) blew the JS heap and the
// upload "broke consistently". expo-file-system's createUploadTask STREAMS the
// file from disk in native code (constant memory), which is the real fix.
//
// On top of streaming this adds the failsafes the to-do asked for:
//   • up to 3 attempts with linear backoff (transient network / 5xx / stall),
//   • a TWO-PHASE stall watchdog — see below,
//   • verbose, greppable [VaultUpload] logging of size, status, elapsed, attempt.
// Returns the FileSystemUploadResult on 2xx; throws after exhausting retries.
//
// TWO-PHASE WATCHDOG (the real large-file fix):
//   Phase 1 — transfer: while bytes are still moving up the wire, cancel +
//     retry if NOTHING moves for UPLOAD_STALL_MS (a dead tunnel socket).
//   Phase 2 — processing: the instant the last byte is sent, progress
//     callbacks STOP firing while the server runs sharp / ExifTool / ffmpeg
//     remux on the file (seconds→minutes for a large video). That expected
//     silence is NOT a dead socket, so once all bytes are sent we switch to
//     the much longer UPLOAD_PROCESSING_MS grace before giving up.
const UPLOAD_MAX_ATTEMPTS = 3;
const UPLOAD_STALL_MS = 60000;        // transfer phase: no bytes for 60s → dead socket
const UPLOAD_PROCESSING_MS = 300000;  // processing phase: server may transcode for up to 5 min
async function streamUploadWithRetry({ url, fileUri, mimeType, parameters, token, label, onProgress }) {
  let lastErr = null;
  for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    let lastProgressAt = Date.now();
    // Set to the timestamp the final byte hit the wire — flips the watchdog
    // from transfer-phase to processing-phase. Reset per attempt.
    let allSentAt = null;
    let stallTimer = null;
    try {
      const task = FileSystem.createUploadTask(
        url,
        fileUri,
        {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'media',
          mimeType,
          parameters,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          // DELIBERATELY no sessionType override — the DEFAULT (foreground)
          // session is the configuration every production upload ran on.
          // Setting BACKGROUND here broke uploads with HTTP 400 "Unexpected
          // end of form": expo-file-system's multipart path writes the whole
          // assembled body to a shared temp file (caches/uploads/<name>, via a
          // silent `try? data.write`) for the out-of-process background daemon
          // to read `fromFile`, and that hand-off truncated bodies. App
          // backgrounding resilience comes from THIS QUEUE instead — the
          // batch checkpoints after every item and resumes on relaunch.
        },
        (p) => {
          lastProgressAt = Date.now();
          const total = p.totalBytesExpectedToSend || 0;
          const sent = p.totalBytesSent || 0;
          if (total > 0 && onProgress) {
            onProgress(Math.min(99, Math.round((sent / total) * 100)));
          }
          // Last byte on the wire → enter processing phase (once).
          if (total > 0 && sent >= total && allSentAt === null) {
            allSentAt = Date.now();
            const secs = ((allSentAt - startedAt) / 1000).toFixed(1);
            console.log(`[VaultUpload] ⏳ ${label} · ${(total / (1024 * 1024)).toFixed(1)}MB sent in ${secs}s · awaiting server processing…`);
          }
        },
      );

      const result = await new Promise((resolve, reject) => {
        stallTimer = setInterval(() => {
          const idleMs = Date.now() - lastProgressAt;
          const threshold = allSentAt ? UPLOAD_PROCESSING_MS : UPLOAD_STALL_MS;
          if (idleMs > threshold) {
            const phase = allSentAt ? 'server processing' : 'transfer';
            console.warn(`[VaultUpload] ⏱ ${label} · watchdog tripped during ${phase} (idle ${Math.round(idleMs / 1000)}s)`);
            task.cancelAsync().catch(() => {});
            reject(new Error(`stalled during ${phase} — no progress for ${Math.round(threshold / 1000)}s`));
          }
        }, 5000);
        task.uploadAsync().then(resolve, reject);
      });
      if (stallTimer) { clearInterval(stallTimer); stallTimer = null; }

      const status = result?.status ?? 0;
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (status >= 200 && status < 300) {
        if (onProgress) onProgress(100);
        console.log(`[VaultUpload] ✓ ${label} · ${secs}s · HTTP ${status} (attempt ${attempt})`);
        return result;
      }
      lastErr = new Error(`HTTP ${status}: ${String(result?.body || '').slice(0, 300)}`);
      console.warn(`[VaultUpload] ✗ ${label} · HTTP ${status} (attempt ${attempt}/${UPLOAD_MAX_ATTEMPTS})`);
      // Client errors (bad request, auth) won't fix themselves on retry — stop.
      if (status < 500 && status !== 408 && status !== 429) throw lastErr;
    } catch (e) {
      if (stallTimer) { clearInterval(stallTimer); stallTimer = null; }
      lastErr = e;
      console.warn(`[VaultUpload] ✗ ${label} (attempt ${attempt}/${UPLOAD_MAX_ATTEMPTS}): ${e.message}`);
      if (/HTTP 4\d\d/.test(e.message) && !/HTTP (408|429)/.test(e.message)) break;
    }
    if (attempt < UPLOAD_MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, attempt * 1500)); // 1.5s, 3s backoff
    }
  }
  throw lastErr || new Error('upload failed');
}

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
  // Live base-URL getter for the async worker (server IP can change mid-batch).
  const getBaseUrlRef = useRef(getBaseUrl);
  useEffect(() => { getBaseUrlRef.current = getBaseUrl; }, [getBaseUrl]);

  // Source of truth is a mutable ref the worker owns; React state is a
  // published snapshot (same pattern as ShareUploadContext — immune to stale
  // closures in the long-running loop).
  const batchRef = useRef(null);
  const workerBusyRef = useRef(false);
  const currentPctRef = useRef(0);   // live % of the item currently streaming
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
    const now = Date.now();
    const { pct: lastPct, at } = lastNotifRef.current;
    // Post on a % change (rate-limited to min 800ms apart) or a 5s heartbeat
    // when unchanged; skip otherwise.
    if (pct === lastPct && now - at < 5000) return;
    if (pct !== lastPct && now - at < 800) return;
    lastNotifRef.current = { pct, at: now };
    updateUploadProgress({
      pct,
      current: Math.min(c.terminal + 1, batch.items.length),
      total: batch.items.length,
      duplicates: c.duplicate,
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
  // resume). Called after every item, never per progress tick.
  const persist = useCallback(async () => {
    const batch = batchRef.current;
    try {
      if (!batch) { await AsyncStorage.removeItem(QUEUE_KEY); return; }
      const lean = {
        ...batch,
        items: batch.items.map(({ meta, ...rest }) => rest),
      };
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(lean));
    } catch (e) { /* best-effort — worst case a restart re-uploads one item */ }
  }, []);

  const clearBatch = useCallback(() => {
    batchRef.current = null;
    currentPctRef.current = 0;
    setHidden(false);
    lastNotifRef.current = { pct: -1, at: 0 };
    clearUploadProgress();
    publish();
    persist();
  }, [publish, persist]);

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
  const checkDuplicates = async (items) => {
    const base = getBaseUrlRef.current?.();
    if (!base) throw new Error('no server url');
    const endpoint = base.endsWith('/api') ? `${base}/media/check-duplicates` : `${base}/api/media/check-duplicates`;
    const token = getApiAuthToken();
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
    if (!batch || batch.status === 'done') return;
    workerBusyRef.current = true;
    batch.status = 'uploading';
    publish();

    try {
      // Photo-library permission: needed to resolve assetIds (resume) and for
      // the end-of-batch delete offer. Non-granted is fine — picker URIs still
      // work within the session they were picked.
      try { await MediaLibrary.requestPermissionsAsync(); } catch (e) { /* optional */ }

      // 1. METADATA PASS — resolve every pending item to a live file + its
      //    duplicate fingerprint inputs. Items whose bytes are gone (deleted
      //    from the device between sessions) become 'missing'.
      const pending = batch.items.filter((it) => !TERMINAL.has(it.status));
      for (const item of pending) {
        const meta = await resolveItem(item);
        if (!meta) { item.status = 'missing'; continue; }
        item.meta = meta;
      }
      publish();

      // 2. DUPLICATE PRE-CHECK — one batch call; hits are skipped before any
      //    bytes move. This fetch is also the reachability probe: if the
      //    server is unreachable (fresh launch before the tunnel is up), retry
      //    with backoff, then PAUSE the batch (resumable from the pill /
      //    next foreground) instead of burning items as failures.
      const toCheck = batch.items.filter((it) => !TERMINAL.has(it.status));
      if (toCheck.length > 0) {
        let results = null;
        for (let attempt = 1; attempt <= 5; attempt++) {
          try { results = await checkDuplicates(toCheck); break; } catch (e) {
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
          }
        });
        const dupCount = results.filter((r) => r?.duplicate).length;
        if (dupCount) console.log(`[VaultUpload] ⏭ ${dupCount} duplicate${dupCount === 1 ? '' : 's'} skipped (already in the vault)`);
        publish();
        await persist();
      }

      // 3. UPLOAD LOOP — stream the survivors one by one, checkpointing after
      //    each so a killed app resumes at the next item.
      const base = getBaseUrlRef.current?.() || '';
      const uploadEndpoint = base.endsWith('/api') ? `${base}/media/upload` : `${base}/api/media/upload`;
      for (const item of batch.items) {
        if (TERMINAL.has(item.status)) continue;
        let tempThumbnailUri = null;
        let tempManipulatedUri = null;
        try {
          const meta = item.meta || (await resolveItem(item));
          if (!meta) { item.status = 'missing'; continue; }

          // Multipart TEXT fields go as a flat string map (the streaming
          // uploader takes `parameters`, not a FormData/blob).
          const parameters = {};
          if (meta.creationTime) parameters.originalDate = String(meta.creationTime);
          if (meta.width) parameters.width = String(meta.width);
          if (meta.height) parameters.height = String(meta.height);
          parameters.tags = JSON.stringify(batch.tags && batch.tags.length > 0 ? batch.tags : ['Phone Uploads']);

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
            const manipulated = await ImageManipulator.manipulateAsync(
              meta.uri, [], { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
            );
            tempManipulatedUri = manipulated.uri;
            mediaUri = tempManipulatedUri;
            mediaName = originalFilename.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg');
            mediaType = 'image/jpeg';
          }
          // The streamed part's filename is the cache URI's basename (a UUID),
          // so send the real name explicitly to preserve it server-side.
          parameters.originalName = mediaName;

          const sizeMB = (meta.size || 0) / (1024 * 1024);
          console.log(`[VaultUpload] ▶ ${mediaName} · ${sizeMB.toFixed(1)}MB · ${mediaType}${isVideo ? ' (video)' : ''}`);

          // Monotonic per-item progress, fed by the native streaming callback.
          let itemPct = 0;
          currentPctRef.current = 0;
          const onProgress = (pct) => {
            if (pct <= itemPct) return;
            itemPct = pct;
            currentPctRef.current = pct;
            publishPctTick();
          };

          await streamUploadWithRetry({
            url: uploadEndpoint,
            fileUri: mediaUri,
            mimeType: mediaType,
            parameters,
            token: getApiAuthToken(),
            label: mediaName,
            onProgress,
          });
          item.status = 'uploaded';
        } catch (error) {
          console.error(`[VaultUpload] Failed ${item.fileName || item.key}:`, error.message);
          item.status = 'failed';
        } finally {
          if (tempThumbnailUri) FileSystem.deleteAsync(tempThumbnailUri, { idempotent: true }).catch(() => {});
          if (tempManipulatedUri) FileSystem.deleteAsync(tempManipulatedUri, { idempotent: true }).catch(() => {});
          currentPctRef.current = 0;
          publish();
          await persist();
        }
      }

      // 4. FINISH — freeze the stats (incl. how many duplicates were found),
      //    surface the delete offer in the pill, ping a notification if the
      //    app is backgrounded. The batch stays persisted until the user
      //    answers the delete prompt (or dismisses), so even the OFFER
      //    survives an app restart.
      batch.status = 'done';
      batch.finishedAt = Date.now();
      const c = countsOf(batch);
      console.log(`[VaultUpload] ■ batch done · ${c.uploaded} uploaded · ${c.duplicate} duplicates skipped · ${c.failed + c.missing} failed`);
      publish();
      await persist();
      notifyHaptic(c.failed + c.missing > 0 ? 'warning' : 'success');
      if (c.uploaded > 0) notifyUploadComplete(c.uploaded); // guarded; silent no-op if unavailable
    } catch (e) {
      // Unexpected worker crash: pause (never lose the batch) — resumable.
      console.error('[VaultUpload] worker error:', e);
      if (batchRef.current) {
        batchRef.current.status = 'paused';
        publish();
        await persist();
      }
    } finally {
      workerBusyRef.current = false;
    }
  }, [publish, publishPctTick, persist]);

  // Public: start a batch. `assets` are picker/library entries; only plain
  // serializable fields are kept so the queue can persist. Returns false when
  // a batch is already running (one at a time keeps % meaningful).
  const enqueue = useCallback(({ assets, tags }) => {
    const existing = batchRef.current;
    if (existing && existing.status !== 'done') return false;
    const id = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    batchRef.current = {
      id,
      tags: Array.isArray(tags) ? tags : [],
      startedAt: Date.now(),
      finishedAt: null,
      status: 'uploading',
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
      })),
    };
    currentPctRef.current = 0;
    setHidden(false); // a fresh batch always shows the pill
    lastNotifRef.current = { pct: -1, at: 0 };
    publish();
    persist();
    processBatch(); // fire-and-forget
    return true;
  }, [publish, persist, processBatch]);

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
        const raw = await AsyncStorage.getItem(QUEUE_KEY);
        if (!raw || cancelled) return;
        const saved = JSON.parse(raw);
        if (!saved || !Array.isArray(saved.items) || saved.items.length === 0) return;
        if (batchRef.current) return; // a new batch beat the restore — keep it
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AppState is the OS-notification switch AND the paused-batch retry:
  //   • leaving  → post the live progress notification (in-app UI is gone),
  //   • returning → clear it (the pill/vault UI takes back over) and, if the
  //     batch had paused (server was unreachable), retry it now.
  useEffect(() => {
    appActiveRef.current = AppState.currentState === 'active';
    const sub = AppState.addEventListener('change', (s) => {
      appActiveRef.current = (s === 'active');
      if (s === 'active' && batchRef.current?.status === 'paused') processBatch();
      driveProgressNotification();
    });
    return () => sub.remove();
  }, [processBatch, driveProgressNotification]);

  const hide = useCallback(() => setHidden(true), []);
  const show = useCallback(() => setHidden(false), []);

  const value = { state: snapshot, hidden, hide, show, enqueue, resume, deleteOriginals, dismiss };
  return <VaultUploadContext.Provider value={value}>{children}</VaultUploadContext.Provider>;
}

export const useVaultUpload = () => {
  const ctx = useContext(VaultUploadContext);
  if (!ctx) throw new Error('useVaultUpload must be used within a VaultUploadProvider');
  return ctx;
};
