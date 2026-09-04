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
 * Audio destination:
 *   Shared audio/video files are copied into app-owned storage before the
 *   share target dismisses, then streamed one at a time to the durable Audio
 *   import queue. URL-only Audio shares stay on the existing /api/share path.
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
 *   Only images or staged media files that have not been accepted are retried.
 */
import React, { createContext, useContext, useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { useServer } from './ServerContext';
import { useAuth } from './AuthContext';
import { streamMultipartUpload } from '../services/streamMultipartUpload';
import {
  SHARE_UPLOAD_ROOT,
  assertShareStagingCapacity,
  sweepShareUploadStaging,
  writeShareUploadManifest,
} from '../services/shareUploadStaging';
import {
  classifySharedFile,
  isHttpImportUrl,
  supportedAudioVideoFiles,
} from '../utils/shareMediaClassifier';
import { notifyHaptic } from '../utils/haptics';

const ShareUploadContext = createContext(null);

// Dedicated staging dir for in-flight share copies. Deliberately NOT one of the
// names cacheManager's background sweep wipes (ImagePicker / full_ / shared_ …),
// so an upload that spans an app-background isn't deleted out from under itself.
const SHARE_DIR = SHARE_UPLOAD_ROOT;

// How long a success toast lingers before auto-dismissing itself.
const SUCCESS_TOAST_MS = 3500;
const AUDIO_BOARD = { kind: 'album', name: 'Audio' };
const AUDIO_QUEUED_MESSAGE = 'Queued for Music Vault';

const channelForPlatform = () => (Platform.OS === 'android' ? 'android-share' : 'ios-share');

// Pick a sensible file extension from the source path, falling back to mime.
const extFromPathOrMime = (p, mime) => {
  const m = /\.([a-zA-Z0-9]+)$/.exec(String(p || '').split(/[?#]/, 1)[0]);
  if (m) return `.${m[1].toLowerCase()}`;
  if (mime === 'image/png') return '.png';
  if (mime === 'image/heic' || mime === 'image/heif') return '.heic';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  return '.jpg';
};

const MEDIA_MIME_EXTENSION = {
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/flac': '.flac',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/x-msvideo': '.avi',
  'video/x-matroska': '.mkv',
  'video/webm': '.webm',
  'video/3gpp': '.3gp',
};

const sourceNameOf = (file, index) => {
  if (typeof file?.fileName === 'string' && file.fileName.trim()) return file.fileName.trim();
  const source = typeof file?.path === 'string' ? file.path.split(/[?#]/, 1)[0] : '';
  const fallback = source.split('/').pop();
  return fallback || `shared-media-${index}`;
};

const safeFileName = (value, fallback) => {
  const safe = String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return safe && safe !== '.' && safe !== '..' ? safe : fallback;
};

const ownedMediaName = (file, index) => {
  const kind = classifySharedFile(file);
  const original = sourceNameOf(file, index);
  const fallbackExtension = MEDIA_MIME_EXTENSION[
    typeof file?.mimeType === 'string' ? file.mimeType.toLowerCase() : ''
  ] || (kind === 'video' ? '.mp4' : '.mp3');
  const safe = safeFileName(original, `shared-media-${index}${fallbackExtension}`);
  return /\.[a-z0-9]+$/i.test(safe) ? safe : `${safe}${fallbackExtension}`;
};

const uploadEndpointOf = (baseUrl) => {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return base.endsWith('/api') ? `${base}/media/upload` : `${base}/api/media/upload`;
};

const acceptedUploadJobId = (result) => {
  let body = result?.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  if (!body?.success || !body?.queued || !body?.jobId) {
    throw new Error(body?.error || 'Server did not queue the Music Vault import.');
  }
  return body.jobId;
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
  const { api, getBaseUrl } = useServer();
  const { isAuthenticated, token, authIdentity, authGeneration } = useAuth();
  const authRef = useRef({ isAuthenticated, token, authIdentity, authGeneration });
  authRef.current = { isAuthenticated, token, authIdentity, authGeneration };

  // Latest `api` in a ref so the async upload loop always uses a live client
  // (its identity changes when serverIP / connection state changes) without
  // capturing a stale closure.
  const apiRef = useRef(api);
  useEffect(() => { apiRef.current = api; }, [api]);
  const getBaseUrlRef = useRef(getBaseUrl);
  useEffect(() => { getBaseUrlRef.current = getBaseUrl; }, [getBaseUrl]);

  // Source of truth for jobs is a Map in a ref — the async worker reads/writes it
  // directly, immune to stale closures. React state is a rendered snapshot kept
  // in sync via publish().
  const jobsRef = useRef(new Map());
  const [jobs, setJobs] = useState([]);
  const autoDismissTimers = useRef(new Map());
  const previousOwnerRef = useRef(authIdentity);
  const ownsJob = useCallback((job) => {
    const auth = authRef.current;
    return !!(
      job &&
      auth.isAuthenticated &&
      job.ownerIdentity === auth.authIdentity &&
      job.authGeneration === auth.authGeneration
    );
  }, []);

  const publish = useCallback(() => {
    setJobs(Array.from(jobsRef.current.values()).map((j) => ({
      id: j.id,
      board: j.board,
      // Human-readable destination for the boardless case, where `board` alone
      // can't tell the toast whether this was a vault share or an Inbox link.
      destination: j.destination || null,
      status: j.status,
      total: j.total,
      done: j.done,
      error: j.error,
      message: j.message,
      kind: j.kind,
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
    for (const media of job.media || []) {
      if (media.localPath) {
        FileSystem.deleteAsync(media.localPath, { idempotent: true }).catch(() => {});
      }
    }
    if (job.ownedDirectory) {
      FileSystem.deleteAsync(job.ownedDirectory, { idempotent: true }).catch(() => {});
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

  const persistAudioManifest = useCallback(async (job) => {
    if (!job?.ownedDirectory || job.kind !== 'audio-files') return;
    try {
      await writeShareUploadManifest(job.ownedDirectory, {
        id: job.id,
        ownerIdentity: job.ownerIdentity,
        authGeneration: job.authGeneration,
        status: job.status,
        total: job.total,
        done: job.done,
        backendJobIds: job.backendJobIds,
        media: job.media.map((media) => ({
          localPath: media.localPath,
          filename: media.filename,
          mimeType: media.mimeType,
          sent: !!media.sent,
          backendJobId: media.backendJobId || null,
          clientImportId: media.clientImportId,
          error: media.error || null,
        })),
      });
    } catch {
      // The upload may continue; startup will age-sweep a missing manifest.
    }
  }, []);

  useEffect(() => {
    let changed = false;
    for (const [id, job] of jobsRef.current) {
      if (ownsJob(job)) continue;
      job.abortController?.abort();
      cleanupJobFiles(job);
      const timer = autoDismissTimers.current.get(id);
      if (timer) clearTimeout(timer);
      autoDismissTimers.current.delete(id);
      jobsRef.current.delete(id);
      changed = true;
    }
    if (changed) publish();
  }, [authGeneration, authIdentity, cleanupJobFiles, isAuthenticated, ownsJob, publish]);

  useEffect(() => {
    let cancelled = false;
    const previousOwner = previousOwnerRef.current;
    const activeDirectories = Array.from(jobsRef.current.values())
      .filter((job) => ownsJob(job) && job.ownedDirectory)
      .map((job) => job.ownedDirectory);
    if (previousOwner && previousOwner !== authIdentity) {
      sweepShareUploadStaging({
        ownerIdentity: previousOwner,
        activeDirectories: [],
        forceOwnerCleanup: true,
      }).catch(() => {});
    }
    if (authIdentity) {
      sweepShareUploadStaging({ ownerIdentity: authIdentity, activeDirectories })
        .then((retained) => {
          if (cancelled || authRef.current.authIdentity !== authIdentity) return;
          let changed = false;
          for (const { directory, manifest } of retained || []) {
            if (
              jobsRef.current.has(manifest.id) ||
              !Array.isArray(manifest.media) ||
              manifest.media.length === 0
            ) {
              continue;
            }
            const auth = authRef.current;
            jobsRef.current.set(manifest.id, {
              id: manifest.id,
              kind: 'audio-files',
              board: AUDIO_BOARD,
              url: null,
              mediaFiles: [],
              media: manifest.media,
              backendJobIds: Array.isArray(manifest.backendJobIds)
                ? manifest.backendJobIds
                : [],
              total: manifest.total || manifest.media.length,
              done: manifest.done || 0,
              copied: true,
              status: 'error',
              error: 'Upload interrupted. Tap retry to continue.',
              message: null,
              ownerIdentity: auth.authIdentity,
              authGeneration: auth.authGeneration,
              token: auth.token,
              apiClient: apiRef.current,
              abortController: new AbortController(),
              ownedDirectory: directory,
            });
            changed = true;
          }
          if (changed) publish();
        })
        .catch(() => {});
    }
    previousOwnerRef.current = authIdentity;
    return () => {
      cancelled = true;
    };
  }, [authGeneration, authIdentity, ownsJob, publish]);

  const scheduleAutoDismiss = useCallback((id) => {
    const existing = autoDismissTimers.current.get(id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      const job = jobsRef.current.get(id);
      if (job && (job.status === 'success' || job.status === 'queued')) removeJob(id);
    }, SUCCESS_TOAST_MS);
    autoDismissTimers.current.set(id, t);
  }, [removeJob]);

  const processAudioJob = useCallback(async (id) => {
    const job = jobsRef.current.get(id);
    if (!job || !ownsJob(job)) return;

    try {
      if (job.kind === 'audio-url') {
        const response = await job.apiClient.post('/share', {
          board: bodyBoard(AUDIO_BOARD),
          payload: { text: undefined, url: job.url },
          channel: channelForPlatform(),
        });
        if (!ownsJob(job)) return;
        if (!response?.success || !response?.downloadJobId) {
          throw new Error(response?.error || 'Server did not queue the Music Vault import.');
        }
        job.backendJobIds = [response.downloadJobId];
        job.status = 'queued';
        job.message = AUDIO_QUEUED_MESSAGE;
        job.error = null;
        await persistAudioManifest(job);
        publish();
        notifyHaptic('success');
        scheduleAutoDismiss(id);
        return;
      }

      const uploadUrl = uploadEndpointOf(getBaseUrlRef.current?.());
      if (!uploadUrl.startsWith('http')) throw new Error('Turtle server URL is unavailable.');

      let failures = 0;
      for (const media of job.media) {
        if (media.sent) continue;
        if (!ownsJob(job)) return;
        try {
          const result = await streamMultipartUpload({
            url: uploadUrl,
            fileUri: media.localPath,
            mimeType: media.mimeType,
            parameters: {
              outputKind: 'audio',
              album: 'Audio',
              tags: JSON.stringify(['Audio']),
              originalName: media.filename,
              clientImportId: media.clientImportId,
            },
            token: job.token,
            label: media.filename,
            onProgress: () => {},
            signal: job.abortController.signal,
          });
          if (!ownsJob(job)) return;
          media.backendJobId = acceptedUploadJobId(result);
          media.sent = true;
          job.backendJobIds.push(media.backendJobId);
          job.done += 1;
          await persistAudioManifest(job);
          publish();
          FileSystem.deleteAsync(media.localPath, { idempotent: true }).catch(() => {});
        } catch (error) {
          if (!ownsJob(job) || job.abortController.signal.aborted) return;
          media.error = error.message || 'Upload failed.';
          failures += 1;
          console.warn(`[ShareUpload] media ${media.filename} failed:`, media.error);
        }
      }

      if (failures === 0) {
        job.status = 'queued';
        job.message = AUDIO_QUEUED_MESSAGE;
        job.error = null;
        await persistAudioManifest(job);
        publish();
        notifyHaptic('success');
        scheduleAutoDismiss(id);
      } else {
        job.status = 'error';
        job.message = null;
        job.error = `${failures} of ${job.total} didn't queue.`;
        await persistAudioManifest(job);
        publish();
        notifyHaptic('error');
      }
    } catch (error) {
      if (!ownsJob(job) || job.abortController.signal.aborted) return;
      console.error('[ShareUpload] Music Vault import failed:', error);
      job.status = 'error';
      job.message = null;
      job.error = error.message || 'Music Vault import failed.';
      await persistAudioManifest(job);
      publish();
      notifyHaptic('error');
    }
  }, [ownsJob, persistAudioManifest, publish, scheduleAutoDismiss]);

  // The worker. Runs a single job to completion (or first failure). Safe to call
  // again for the same id to RESUME (retry) — it skips already-copied files and
  // already-uploaded images via job.copied / job.nextIndex.
  const processJob = useCallback(async (id) => {
    const job = jobsRef.current.get(id);
    if (!job || !ownsJob(job)) return;
    if (job.kind === 'audio-url' || job.kind === 'audio-files') {
      return processAudioJob(id);
    }

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
        const res = await job.apiClient.post('/share', {
          board: bodyBoard(job.board),
          payload: { text: job.text || undefined, url: job.url || undefined },
          channel: channelForPlatform(),
        });
        if (!ownsJob(job)) return;
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
        if (!ownsJob(job)) return;

        try {
          let dataBase64 = await FileSystem.readAsStringAsync(img.localPath, { encoding: 'base64' });
          // Attach text/url until it's confirmed delivered, so the note/link is
          // created exactly once regardless of which image lands first.
          const carryText = !job.textConfirmed;
          const res = await job.apiClient.post('/share', {
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
          if (!ownsJob(job)) return;
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
      if (!ownsJob(job)) return;
      console.error('[ShareUpload] job failed:', e);
      job.status = 'error';
      job.error = e.message || 'Send failed.';
      publish();
      notifyHaptic('error');
    }
  }, [ensureDir, ownsJob, processAudioJob, publish, scheduleAutoDismiss]);

  const stageAudioFiles = useCallback(async (job) => {
    await assertShareStagingCapacity(job.mediaFiles.map((file) => file.path));
    await ensureDir();
    const ownedDirectory = `${SHARE_DIR}${job.id}/`;
    await FileSystem.makeDirectoryAsync(ownedDirectory, { intermediates: true });
    job.ownedDirectory = ownedDirectory;

    const copies = [];
    for (let index = 0; index < job.mediaFiles.length; index++) {
      const file = job.mediaFiles[index];
      const filename = ownedMediaName(file, index);
      const itemDirectory = `${ownedDirectory}${index}/`;
      const destination = `${itemDirectory}${filename}`;
      await FileSystem.makeDirectoryAsync(itemDirectory, { intermediates: true });
      await FileSystem.copyAsync({ from: file.path, to: destination });
      copies.push({
        localPath: destination,
        filename,
        mimeType: file.mimeType,
        sent: false,
        clientImportId: Crypto.randomUUID(),
      });
    }
    job.media = copies;
    job.copied = true;
    await persistAudioManifest(job);
  }, [ensureDir, persistAudioManifest]);

  // Public: start a share. Returns immediately (fire-and-forget) so the caller
  // can dismiss the share sheet without waiting on the network.
  const enqueueShare = useCallback(({ board, text, url, imageFiles }) => {
    const files = (Array.isArray(imageFiles) ? imageFiles : [])
      .filter((file) => classifySharedFile(file) === 'image');
    if (!text && !url && files.length === 0) return null;
    const auth = authRef.current;
    if (!auth.isAuthenticated || !auth.authIdentity || !auth.authGeneration) return null;

    const id = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const job = {
      id,
      kind: 'standard',
      groupId: id,               // stable per-share id the server groups on
      board,
      // Where a BOARDLESS share lands, resolved here because the server makes
      // the same call from the same signal: photos with no board go to the
      // vault, a bare link/text with no board becomes an Inbox note.
      destination: board ? null : (files.length > 0 ? 'Photo vault' : 'Inbox'),
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
      message: null,
      ownerIdentity: auth.authIdentity,
      authGeneration: auth.authGeneration,
      token: auth.token,
      apiClient: apiRef.current,
      abortController: new AbortController(),
    };
    jobsRef.current.set(id, job);
    publish();
    processJob(id); // fire-and-forget
    return id;
  }, [publish, processJob]);

  const enqueueAudioShare = useCallback(async ({ mediaFiles, url } = {}) => {
    const files = supportedAudioVideoFiles(mediaFiles);
    const importUrl = isHttpImportUrl(url) ? url.trim() : null;
    if (files.length === 0 && !importUrl) {
      throw new Error('No supported audio, video, or HTTP(S) URL was shared.');
    }
    const auth = authRef.current;
    if (!auth.isAuthenticated || !auth.authIdentity || !auth.authGeneration || !auth.token) {
      throw new Error('Sign in before importing media.');
    }

    const id = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const job = {
      id,
      kind: files.length > 0 ? 'audio-files' : 'audio-url',
      board: AUDIO_BOARD,
      url: importUrl,
      mediaFiles: files,
      media: [],
      backendJobIds: [],
      total: files.length,
      done: 0,
      copied: files.length === 0,
      status: 'uploading',
      error: null,
      message: null,
      ownerIdentity: auth.authIdentity,
      authGeneration: auth.authGeneration,
      token: auth.token,
      apiClient: apiRef.current,
      abortController: new AbortController(),
    };
    jobsRef.current.set(id, job);
    publish();

    if (files.length > 0) {
      try {
        await stageAudioFiles(job);
      } catch (error) {
        removeJob(id);
        throw new Error(`Could not preserve shared media: ${error.message}`);
      }
    }

    processJob(id);
    return id;
  }, [processJob, publish, removeJob, stageAudioFiles]);

  const retryJob = useCallback((id) => {
    const job = jobsRef.current.get(id);
    if (!job || !ownsJob(job)) return;
    job.status = 'uploading';
    job.error = null;
    job.message = null;
    publish();
    persistAudioManifest(job);
    processJob(id);
  }, [ownsJob, persistAudioManifest, publish, processJob]);

  const dismissJob = useCallback((id) => removeJob(id), [removeJob]);

  // Memoized: every member is already referentially stable (state + useCallback),
  // so without this the bare object literal handed consumers a NEW context value
  // on every provider render — re-rendering the toast + every subscriber even
  // when nothing they read had changed.
  const value = useMemo(
    () => ({ jobs, enqueueShare, enqueueAudioShare, retryJob, dismissJob }),
    [jobs, enqueueShare, enqueueAudioShare, retryJob, dismissJob],
  );
  return <ShareUploadContext.Provider value={value}>{children}</ShareUploadContext.Provider>;
}

export const useShareUpload = () => {
  const ctx = useContext(ShareUploadContext);
  if (!ctx) throw new Error('useShareUpload must be used within a ShareUploadProvider');
  return ctx;
};

