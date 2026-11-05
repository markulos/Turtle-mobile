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
export function safeId(mediaId) {
  return String(mediaId).replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * ── Why the file keeps an extension ───────────────────────────────────
 *
 * It is not decoration. A downloaded track is handed to the player as a
 * `file://` URL, and on iOS AVURLAsset works out the container format from
 * the path extension — there is no Content-Type on a local file to fall
 * back to. Saved as a bare `42`, the asset fails to load and the track
 * simply does not play, while every streamed track is fine because the
 * pond's response carries its type in a header.
 *
 * So the name is `<id>.<ext>`, and the id is read back off it.
 */
const EXT_BY_TYPE = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/webm': 'webm',
};

/** Last resort. Wrong for a FLAC, but a guess beats no extension at all. */
const FALLBACK_EXT = 'mp3';

/**
 * The extension to save under: the one the track's own filename carries,
 * else one derived from what the pond said it was sending, else mp3.
 */
export function extensionFor(fileName, contentType) {
  const fromName = /\.([a-zA-Z0-9]{2,5})$/.exec(String(fileName || '').trim());
  if (fromName) return fromName[1].toLowerCase();
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  return EXT_BY_TYPE[type] || FALLBACK_EXT;
}

export function fileNameFor(mediaId, ext) {
  return `${safeId(mediaId)}.${String(ext || FALLBACK_EXT).toLowerCase()}`;
}

/**
 * The id back off a stored file name, or null if this is not one of ours.
 *
 * Null for a name with NO extension, which is how the first build of this
 * feature wrote them: those files cannot play, so they are not downloads —
 * they are rubbish to be swept, and the row goes back to offering a
 * download that will work.
 */
export function idFromFileName(name) {
  const m = /^(.+)\.([a-zA-Z0-9]{2,5})$/.exec(String(name || ''));
  if (!m) return null;
  // A part-file is an interrupted download, never a finished one.
  if (m[2].toLowerCase() === PART_EXT) return null;
  return m[1];
}

/** Downloads land here first, so a partial file is never mistaken for a track. */
const PART_EXT = 'part';

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
  const downloaded = new Map(); // id -> { bytes, file }
  const inFlight = new Map();   // id -> { progress }
  const failed = new Map();     // id -> message
  const tasks = new Map();      // id -> resumable download
  // Cancels that arrived before the download had registered its task. Without
  // this, a stop tapped in the moment between "downloading" appearing on the
  // row and the task existing does nothing at all, and the track is kept
  // anyway — the one race in here, and it only ever resolves the wrong way.
  const cancelRequested = new Set();
  const listeners = new Set();
  let ready = false;
  let loading = null;
  let snapshot = EMPTY;

  function rebuild() {
    let totalBytes = 0;
    for (const entry of downloaded.values()) totalBytes += entry.bytes;
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
            const id = idFromFileName(name);
            const stat = id ? await fs.getInfoAsync(`${dir}${name}`).catch(() => null) : null;
            // Three kinds of rubbish are swept rather than listed, because
            // each would otherwise show a tick on a row that cannot play:
            //   • no extension — written by the first build of this feature,
            //     and unplayable on iOS for the reason at the top of the file
            //   • a leftover .part — an interrupted download
            //   • zero bytes — a download that died the instant it started
            // Swept, the row goes back to offering a download that works.
            if (!id || !stat?.exists || !stat.size) {
              await fs.deleteAsync(`${dir}${name}`, { idempotent: true }).catch(() => {});
              continue;
            }
            downloaded.set(id, { bytes: stat.size, file: name });
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

    isDownloaded: (mediaId) => downloaded.has(String(mediaId)),

    /** Every downloaded id → its local URI, for building a whole queue. */
    localUris() {
      const out = {};
      for (const [id, entry] of downloaded) out[id] = `${dir}${entry.file}`;
      return out;
    },

    statusOf(mediaId) {
      const key = String(mediaId);
      const live = inFlight.get(key);
      if (live) return { state: 'downloading', progress: live.progress };
      const entry = downloaded.get(key);
      if (entry) return { state: 'done', bytes: entry.bytes };
      const error = failed.get(key);
      if (error) return { state: 'failed', error };
      return { state: 'absent' };
    },

    /**
     * Fetch a track and keep it. `url` is the absolute media URL; the caller
     * owns resolving it, exactly as the player does. `fileName` is the
     * track's own name, used only to work out what to save it as — see the
     * note on extensions at the top of this file.
     *
     * Already here or already arriving is a no-op, not an error — the control
     * is a toggle and a double tap must not start two downloads of the same
     * 8 MB file.
     */
    async download(mediaId, url, fileName) {
      const key = String(mediaId);
      if (downloaded.has(key) || inFlight.has(key)) return true;
      if (!url) return false;

      cancelRequested.delete(key);
      failed.delete(key);
      inFlight.set(key, { progress: 0 });
      rebuild();

      // Written to a .part first and moved into place only once it is whole.
      // An interrupted download then cannot be mistaken for a track: the
      // directory read skips .part files, so there is nothing to sweep up
      // later and nothing that ever shows a tick it has not earned.
      const dest = `${dir}${safeId(mediaId)}.${PART_EXT}`;
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

      // Now it is whole, give it its real name. The track's own filename
      // decides the extension; the pond's Content-Type is the fallback for a
      // row whose name has none.
      const headers = res.headers || {};
      const contentType = headers['content-type'] || headers['Content-Type'];
      const file = fileNameFor(mediaId, extensionFor(fileName, contentType));
      try {
        await fs.moveAsync({ from: dest, to: `${dir}${file}` });
      } catch (error) {
        // The bytes are here but unnamed, and an unnamed file will not play.
        // Better to drop it and let the row offer again than to keep
        // something that shows a tick and then silently refuses.
        await fs.deleteAsync(dest, { idempotent: true }).catch(() => {});
        failed.set(key, error?.message || 'Could not store the download');
        rebuild();
        return false;
      }

      downloaded.set(key, { bytes: stat.size, file });
      rebuild();
      return true;
    },

    /** Stop an in-flight download. Nothing is kept. */
    async cancel(mediaId) {
      const key = String(mediaId);
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
      // The part-file, which is all a cancelled download ever wrote.
      await fs.deleteAsync(`${dir}${safeId(mediaId)}.${PART_EXT}`, { idempotent: true }).catch(() => {});
    },

    async remove(mediaId) {
      const key = String(mediaId);
      // The stored name, not a rebuilt one: the extension was decided at
      // download time from the track's own filename, so guessing it back
      // here would leave the file on disk for anything but an mp3.
      const entry = downloaded.get(key);
      await this.cancel(mediaId);
      failed.delete(key);
      if (entry) {
        await fs.deleteAsync(`${dir}${entry.file}`, { idempotent: true }).catch(() => {});
      }
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
