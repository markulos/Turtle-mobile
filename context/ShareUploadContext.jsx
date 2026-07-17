/**
 * ShareUploadContext
 *
 * App-level owner of "Send to Turtle" uploads. The whole point of this
 * living OUTSIDE ShareTargetScreen is lifecycle: the user taps a board, the
 * share sheet dismisses INSTANTLY, and the actual encode + upload keeps running
 * here — unaffected by the modal unmounting (no cancelled work, no
 * setState-on-unmounted warnings). A small floating toast (ShareUploadToast,
 * mounted at the app root) surfaces progress and the final outcome.
 *
 * Why one image per request:
 *   10–30 full-res photos as base64 is hundreds of MB. We NEVER hold more than
 *   one image's base64 at a time — read → upload → release, image by image. Each
 *   request is small (well under the server's body limit) and memory stays flat.
 *   The server coalesces the per-image requests back into a single chat_log entry
 *   via a shared `groupId` (see server/routes/share.js).
 *
 * Why we copy the temp files first:
 *   The OS hands us temporary file URIs for the shared photos. They can be
 *   reclaimed once the share session ends, so before we start the (slower)
 *   base64 upload loop we copy each one into app storage — a cheap byte copy
 *   that never inflates JS memory — and read from those copies instead.
 *
 * Retry:
 *   A failed job keeps its remaining file copies + its resume index on disk, so
 *   Retry picks up where it left off WITHOUT re-opening the OS share sheet.
 *   Only images that haven't uploaded yet are re-read.
 */
import React, { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { useServer } from './ServerContext';
import { notifyHaptic } from '../utils/haptics';

const ShareUploadContext = createContext(null);

// Dedicated staging dir for in-flight share copies. Deliberately NOT one of the
// names cacheManager's background sweep wipes (ImagePicker / full_ / shared_ …),
// so an upload that spans an app-background isn't deleted out from under itself.
const SHARE_DIR = `${FileSystem.cacheDirectory || ''}TurtleShareUploads/`;

// How long a success toast lingers before auto-dismissing itself.
const SUCCESS_TOAST_MS = 3500;

const channelForPlatform = () => (Platform.OS === 'android' ? 'android-share' : 'ios-share');

// Pick a sensible file extension from the source path, falling back to mime.
const extFromPathOrMime = (p, mime) => {
  const m = /\.([a-zA-Z0-9]+)$/.exec(p || '');
  if (m) return `.${m[1].toLowerCase()}`;
  if (mime === 'image/png') return '.png';
  if (mime === 'image/heic' || mime === 'image/heif') return '.heic';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  return '.jpg';
};

// Board shape the /api/share endpoint expects, preserving a create-on-demand
// flag. A null board is the "photo vault as-is" share — the field is omitted
// from the request body entirely and the server files the images untagged.
const bodyBoard = (board) => (board ? {
  kind: board.kind,
  name: board.name,
  ...(board.create ? { create: true } : {}),
} : undefined);

export function ShareUploadProvider({ children }) {
  const { api } = useServer();

  // Latest `api` in a ref so the async upload loop always uses a live client
  // (its identity changes when serverIP / connection state changes) without
  // capturing a stale closure.
  const apiRef = useRef(api);
  useEffect(() => { apiRef.current = api; }, [api]);

  // Source of truth for jobs is a Map in a ref — the async worker reads/writes it
  // directly, immune to stale closures. React state is a rendered snapshot kept
  // in sync via publish().
  const jobsRef = useRef(new Map());
  const [jobs, setJobs] = useState([]);
  const autoDismissTimers = useRef(new Map());

  const publish = useCallback(() => {
    setJobs(Array.from(jobsRef.current.values()).map((j) => ({
      id: j.id,
      board: j.board,
      status: j.status,
      total: j.total,
      done: j.done,
      error: j.error,
    })));
  }, []);

  const ensureDir = useCallback(async () => {
    try {
      const info = await FileSystem.getInfoAsync(SHARE_DIR);
      if (!info.exists) await FileSystem.makeDirectoryAsync(SHARE_DIR, { intermediates: true });
    } catch (e) { /* best-effort — copy step falls back to the original path */ }
  }, []);

  // Delete whatever file copies a job still has on disk.
  const cleanupJobFiles = useCallback((job) => {
    for (const img of job.images || []) {
      if (img.localPath && !img.ephemeral) {
        FileSystem.deleteAsync(img.localPath, { idempotent: true }).catch(() => {});
      }
    }
  }, []);

  const removeJob = useCallback((id) => {
    const job = jobsRef.current.get(id);
    if (job) cleanupJobFiles(job);
    const timer = autoDismissTimers.current.get(id);
    if (timer) { clearTimeout(timer); autoDismissTimers.current.delete(id); }
    jobsRef.current.delete(id);
    publish();
  }, [cleanupJobFiles, publish]);

  const scheduleAutoDismiss = useCallback((id) => {
    const existing = autoDismissTimers.current.get(id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      const job = jobsRef.current.get(id);
      if (job && job.status === 'success') removeJob(id);
    }, SUCCESS_TOAST_MS);
    autoDismissTimers.current.set(id, t);
  }, [removeJob]);

  // The worker. Runs a single job to completion (or first failure). Safe to call
  // again for the same id to RESUME (retry) — it skips already-copied files and
  // already-uploaded images via job.copied / job.nextIndex.
  const processJob = useCallback(async (id) => {
    const job = jobsRef.current.get(id);
    if (!job) return;

    try {
      // 1. Copy the OS temp files into app storage once (cheap byte copy, no
      //    base64 in memory) so the upload loop can outlive the share session.
      if (!job.copied) {
        await ensureDir();
        const copies = [];
        for (let i = 0; i < job.imageFiles.length; i++) {
          const f = job.imageFiles[i];
          const ext = extFromPathOrMime(f.path, f.mimeType);
          const dest = `${SHARE_DIR}${job.id}-${i}${ext}`;
          try {
            await FileSystem.copyAsync({ from: f.path, to: dest });
            copies.push({ localPath: dest, filename: f.fileName || `share-${job.id}-${i}${ext}`, mimeType: f.mimeType, sent: false });
          } catch (e) {
            // Copy failed — fall back to reading the original path directly. It
            // may well still be alive for this session; mark ephemeral so we
            // don't try to delete a file we don't own.
            console.warn('[ShareUpload] copy failed, using original path:', e.message);
            copies.push({ localPath: f.path, filename: f.fileName || `share-${job.id}-${i}${ext}`, mimeType: f.mimeType, ephemeral: true, sent: false });
          }
        }
        job.images = copies;
        job.copied = true;
      }

      // 2. Text / URL-only share → a single plain request (no image group).
      if (job.images.length === 0) {
        const res = await apiRef.current.post('/share', {
          board: bodyBoard(job.board),
          payload: { text: job.text || undefined, url: job.url || undefined },
          channel: channelForPlatform(),
        });
        if (!res?.success) throw new Error(res?.error || 'Server rejected the share.');
        job.status = 'success';
        publish();
        notifyHaptic('success');
        scheduleAutoDismiss(id);
        return;
      }

      // 3. Images → one request per image, sequentially, but RESILIENT: a single
      //    image failing does NOT abort the batch — we keep sending the rest and
      //    all land in the SAME content via the shared groupId + imageTotal. The
      //    text/url rides whichever request first reaches the server (that one
      //    INSERTs the chat_log + creates the note; the rest append), so it's
      //    never lost to a failed image 0. `sent` flags let a later Retry re-send
      //    only the ones that didn't make it — into the same group.
      let failures = 0;
      for (let i = 0; i < job.images.length; i++) {
        const img = job.images[i];
        if (img.sent) continue; // already delivered on an earlier pass

        try {
          let dataBase64 = await FileSystem.readAsStringAsync(img.localPath, { encoding: 'base64' });
          // Attach text/url until it's confirmed delivered, so the note/link is
          // created exactly once regardless of which image lands first.
          const carryText = !job.textConfirmed;
          const res = await apiRef.current.post('/share', {
            board: bodyBoard(job.board),
            groupId: job.groupId,
            imageTotal: job.total,
            // Stable per-image index → the server derives a deterministic
            // media id from groupId+imageIndex, so a retry after a LOST
            // response lands on the same row instead of duplicating it.
            imageIndex: i,
            payload: {
              text: carryText ? (job.text || undefined) : undefined,
              url: carryText ? (job.url || undefined) : undefined,
              images: [{ filename: img.filename, mimeType: img.mimeType, dataBase64 }],
            },
            channel: channelForPlatform(),
          });
          dataBase64 = null; // release the base64 string ASAP for GC
          // Require the persisted-row ECHO, not just success — the server used
          // to return success even when the media insert failed, and marking
          // `sent` on that is silent photo loss with no retry.
          if (!res?.success || !(Array.isArray(res.mediaIds) && res.mediaIds.length >= 1)) {
            throw new Error(res?.error || 'Image did not persist on the server.');
          }

          img.sent = true;
          if (carryText) job.textConfirmed = true;
          job.done += 1;
          publish();

          // Delivered — drop this copy so we never hold more than the unsent ones.
          if (!img.ephemeral) FileSystem.deleteAsync(img.localPath, { idempotent: true }).catch(() => {});
        } catch (e) {
          // Keep going — this image stays unsent (its copy is retained on disk)
          // and gets picked up by Retry. One bad photo can't strand the batch.
          console.warn(`[ShareUpload] image ${i + 1}/${job.total} failed:`, e.message);
          failures += 1;
        }
      }

      if (failures === 0) {
        job.status = 'success';
        job.error = null;
        publish();
        notifyHaptic('success');
        scheduleAutoDismiss(id);
      } else {
        // Partial: some landed, some didn't. Retry re-sends only the unsent ones.
        job.status = 'error';
        job.error = `${failures} of ${job.total} didn't send.`;
        publish();
        notifyHaptic('error');
      }
    } catch (e) {
      console.error('[ShareUpload] job failed:', e);
      job.status = 'error';
      job.error = e.message || 'Send failed.';
      publish();
      notifyHaptic('error');
    }
  }, [ensureDir, publish, scheduleAutoDismiss]);

  // Public: start a share. Returns immediately (fire-and-forget) so the caller
  // can dismiss the share sheet without waiting on the network.
  const enqueueShare = useCallback(({ board, text, url, imageFiles }) => {
    const id = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const files = Array.isArray(imageFiles) ? imageFiles : [];
    const job = {
      id,
      groupId: id,               // stable per-share id the server groups on
      board,
      text: text || null,
      url: url || null,
      imageFiles: files,         // original OS temp refs {path, fileName, mimeType}
      images: [],                // filled after copy: {localPath, filename, mimeType, sent}
      total: files.length,
      done: 0,
      textConfirmed: false,      // has the text/url ridden a successful request yet?
      copied: false,
      status: 'uploading',
      error: null,
    };
    jobsRef.current.set(id, job);
    publish();
    processJob(id); // fire-and-forget
    return id;
  }, [publish, processJob]);

  const retryJob = useCallback((id) => {
    const job = jobsRef.current.get(id);
    if (!job) return;
    job.status = 'uploading';
    job.error = null;
    publish();
    processJob(id); // re-sends only the images still flagged unsent, same group
  }, [publish, processJob]);

  const dismissJob = useCallback((id) => removeJob(id), [removeJob]);

  const value = { jobs, enqueueShare, retryJob, dismissJob };
  return <ShareUploadContext.Provider value={value}>{children}</ShareUploadContext.Provider>;
}

export const useShareUpload = () => {
  const ctx = useContext(ShareUploadContext);
  if (!ctx) throw new Error('useShareUpload must be used within a ShareUploadProvider');
  return ctx;
};
