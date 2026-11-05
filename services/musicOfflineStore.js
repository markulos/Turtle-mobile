/**
 * Offline music — keeping a track's bytes on the phone so it plays with no
 * pond to reach.
 *
 * ── documentDirectory, not cacheDirectory ─────────────────────────────
 * The vault's document opener caches into `cacheDirectory` (see
 * FilesVault/documentOpen), which is right for something you can always
 * fetch again: iOS and Android are both free to empty that directory when
 * storage runs short. For music that is exactly the failure this feature
 * exists to prevent — you download an album for a flight, the OS reclaims
 * the space, and you find out at 30,000 feet. Downloads go in
 * `documentDirectory`, which the system does not purge.
 *
 * ── The index is the directory ────────────────────────────────────────
 * There is no manifest file listing what has been downloaded, because a
 * manifest and a directory can disagree — and when they do the manifest
 * lies about music you no longer have. The files on disk ARE the index:
 * one per media id, read back with a directory listing on boot.
 *
 * ── Why a module singleton ────────────────────────────────────────────
 * A download has to survive leaving the Music vault, so the state cannot
 * live in a mounted component. React subscribes through
 * useSyncExternalStore (see useOfflineMusic).
 */
import * as FileSystem from 'expo-file-system/legacy';

/** One directory, one file per track, named by media id. */
export const OFFLINE_DIR = `${FileSystem.documentDirectory || ''}music-offline/`;

/**
 * A media id is server-generated, but it still reaches a filename here, so
 * it is scrubbed: a `..` or a separator sneaking into a path is the kind of
 * thing that writes outside the directory it was meant to.
 */
export function fileNameFor(mediaId) {
  return String(mediaId).replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function pathFor(mediaId) {
  return `${OFFLINE_DIR}${fileNameFor(mediaId)}`;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return '<0.1 MB';
  if (mb < 1000) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

const EMPTY = {
  downloaded: new Map(),
  inFlight: new Map(),
  failed: new Map(),
  totalBytes: 0,
  ready: false,
};

export function createOfflineMusicStore(fs = FileSystem, dir = OFFLINE_DIR) {
  const downloaded = new Map(); // mediaId -> bytes
  const inFlight = new Map();   // mediaId -> { progress }
  const failed = new Map();     // mediaId -> message
  const tasks = new Map();      // mediaId -> resumable download
  // Cancels that arrived before the download had registered its task. Without
  // this, a stop tapped in the moment between "downloading" appearing on the
  // row and the task existing does nothing at all, and the track is kept
  // anyway — the one race in here, and it only ever resolves the wrong way.
  const cancelRequested = new Set();
  const listeners = new Set();
  let ready = false;
  let loading = null;
  let snapshot = EMPTY;

  const filePath = (mediaId) => `${dir}${fileNameFor(mediaId)}`;

  function rebuild() {
    let totalBytes = 0;
    for (const n of downloaded.values()) totalBytes += n;
    // A fresh object every time: useSyncExternalStore compares by identity
    // and would never re-render if these were mutated in place.
    snapshot = {
      downloaded: new Map(downloaded),
      inFlight: new Map(inFlight),
      failed: new Map(failed),
      totalBytes,
      ready,
    };
    for (const fn of listeners) fn();
  }
  rebuild();

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const info = await fs.getInfoAsync(dir);
        if (!info?.exists) {
          await fs.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
        } else {
          const names = await fs.readDirectoryAsync(dir);
          for (const name of names) {
            const stat = await fs.getInfoAsync(`${dir}${name}`).catch(() => null);
            // A zero-byte file is a download that died mid-flight. Sweeping
            // it here rather than listing it means the row offers to fetch
            // it again instead of claiming a track that will not play.
            if (!stat?.exists) continue;
            if (!stat.size) {
              await fs.deleteAsync(`${dir}${name}`, { idempotent: true }).catch(() => {});
              continue;
            }
            downloaded.set(name, stat.size);
          }
        }
      } catch {
        // No directory means no downloads, not a broken screen.
      } finally {
        ready = true;
        rebuild();
      }
    })();
    return loading;
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      load();
      return () => listeners.delete(fn);
    },
    getSnapshot: () => snapshot,
    load,

    isDownloaded: (mediaId) => downloaded.has(fileNameFor(mediaId)),

    /** The `file://` URI to play, or null. Fed straight to the track mapper. */
    localUri: (mediaId) => (downloaded.has(fileNameFor(mediaId)) ? filePath(mediaId) : null),

    /** Every downloaded id → its local URI, for building a whole queue. */
    localUris() {
      const out = {};
      for (const name of downloaded.keys()) out[name] = `${dir}${name}`;
      return out;
    },

    statusOf(mediaId) {
      const key = fileNameFor(mediaId);
      const live = inFlight.get(key);
      if (live) return { state: 'downloading', progress: live.progress };
      const bytes = downloaded.get(key);
      if (bytes !== undefined) return { state: 'done', bytes };
      const error = failed.get(key);
      if (error) return { state: 'failed', error };
      return { state: 'absent' };
    },

    /**
     * Fetch a track and keep it. `url` is the absolute media URL; the caller
     * owns resolving it, exactly as the player does.
     *
     * Already here or already arriving is a no-op, not an error — the control
     * is a toggle and a double tap must not start two downloads of the same
     * 8 MB file.
     */
    async download(mediaId, url) {
      const key = fileNameFor(mediaId);
      if (downloaded.has(key) || inFlight.has(key)) return true;
      if (!url) return false;

      cancelRequested.delete(key);
      failed.delete(key);
      inFlight.set(key, { progress: 0 });
      rebuild();

      const dest = `${dir}${key}`;
      await fs.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});

      let lastPct = -1;
      const task = fs.createDownloadResumable(url, dest, {}, (p) => {
        const total = p?.totalBytesExpectedToWrite || 0;
        if (total <= 0) return;
        const progress = Math.min(1, (p.totalBytesWritten || 0) / total);
        // Whole percents only: a multi-megabyte file fires this constantly,
        // and a re-render per callback would make the list stutter while
        // something is playing.
        const pct = Math.floor(progress * 100);
        if (pct === lastPct) return;
        lastPct = pct;
        inFlight.set(key, { progress });
        rebuild();
      });
      tasks.set(key, task);

      let res = null;
      let threw = null;
      try {
        res = await task.downloadAsync();
      } catch (error) {
        threw = error;
      }
      tasks.delete(key);
      // Either kind of cancel: one that reached the task, or one that beat it
      // here and only left its intent behind.
      const cancelled = !inFlight.has(key) || cancelRequested.delete(key);
      inFlight.delete(key);

      // A cancel resolves with no result. Nothing kept, and no red row —
      // stopping a download is a choice, not a failure.
      if (cancelled || (!res && !threw)) {
        await fs.deleteAsync(dest, { idempotent: true }).catch(() => {});
        rebuild();
        return false;
      }

      if (threw || !res || res.status < 200 || res.status >= 300) {
        // A half-written file would otherwise look downloaded forever, and
        // every later play would hit a truncated track instead of retrying.
        await fs.deleteAsync(dest, { idempotent: true }).catch(() => {});
        failed.set(key, threw?.message || `The pond answered ${res?.status ?? 'nothing'}`);
        rebuild();
        return false;
      }

      const stat = await fs.getInfoAsync(dest).catch(() => null);
      if (!stat?.exists || !stat.size) {
        await fs.deleteAsync(dest, { idempotent: true }).catch(() => {});
        failed.set(key, 'The download arrived empty');
        rebuild();
        return false;
      }

      downloaded.set(key, stat.size);
      rebuild();
      return true;
    },

    /** Stop an in-flight download. Nothing is kept. */
    async cancel(mediaId) {
      const key = fileNameFor(mediaId);
      const task = tasks.get(key);
      if (!task && !inFlight.has(key)) return;
      // The intent is recorded whether or not the task exists yet, and
      // inFlight is dropped FIRST so the download() path can tell a cancel
      // from a failure when its await comes back.
      cancelRequested.add(key);
      inFlight.delete(key);
      tasks.delete(key);
      rebuild();
      await task?.cancelAsync?.().catch(() => {});
      await fs.deleteAsync(`${dir}${key}`, { idempotent: true }).catch(() => {});
    },

    async remove(mediaId) {
      const key = fileNameFor(mediaId);
      await this.cancel(mediaId);
      failed.delete(key);
      await fs.deleteAsync(`${dir}${key}`, { idempotent: true }).catch(() => {});
      downloaded.delete(key);
      rebuild();
    },

    async clear() {
      for (const key of [...tasks.keys()]) await this.cancel(key);
      await fs.deleteAsync(dir, { idempotent: true }).catch(() => {});
      await fs.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      downloaded.clear();
      failed.clear();
      rebuild();
    },
  };
}

export const musicOfflineStore = createOfflineMusicStore();
