/**
 * offlineMedia — the pictures you asked the phone to keep.
 *
 * ── Why this is not just "the cache" ──────────────────────────────────────
 * The vault already caches aggressively, and `utils/cacheManager` deliberately
 * WIPES that cache: transient dirs on every background, expo-image's disk
 * cache every 10 minutes, everything on the Settings "Clear photo cache"
 * button. That is the right behaviour for a cache — it is the wrong behaviour
 * for "I am getting on a plane and I want this photo". So a saved picture is
 * NOT a cache entry: it lives under `documentDirectory`, which nothing in
 * cacheManager walks, and only ever leaves when the user removes it.
 *
 * ── Why the index stores a NAME, never a path ─────────────────────────────
 * On iOS the app container's absolute path changes between installs and across
 * some OS updates, so an absolute `file:///.../Documents/...` uri persisted
 * today can be dead tomorrow while the file itself is fine. The index keeps
 * only the file NAME; the absolute uri is rebuilt from the CURRENT
 * `documentDirectory` on every read (`uriForName`). `reconcile` then drops
 * entries whose file genuinely isn't there any more.
 *
 * The pure half (names, totals, index arithmetic) is exported separately so it
 * can be tested without a filesystem.
 */
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Where saved pictures live. Outside cacheDirectory, on purpose. */
export const offlineDir = () => `${FileSystem.documentDirectory || ''}offline-media/`;
export const INDEX_KEY = 'offline:media-index';

// ── pure helpers ────────────────────────────────────────────────────────────

/**
 * The on-disk name for a saved item: the media id first (so the file is
 * traceable back to a row, and two photos sharing a filename can't collide),
 * then a sanitised original name for anyone browsing the container.
 *
 * The extension is forced to the one the bytes actually are — the display
 * tier is always JPEG, whatever the original was — because an iOS HEIC
 * original saved as ".heic" but holding JPEG bytes confuses every consumer.
 */
export function offlineFileName(id, filename, ext = 'jpg') {
  // No dots survive in either half: the ONE dot in the result is the one
  // before the extension. That kills both directory traversal ("../..") and
  // double-extension confusion in a single rule.
  const safeId = String(id ?? 'item').replace(/[^\w-]/g, '_');
  const stem = String(filename || '')
    .replace(/\.[^.]*$/, '')          // drop the original extension
    .replace(/[^\w-]/g, '_')
    .replace(/^_+|_+$/g, '')          // no leading/trailing underscore runs
    .slice(0, 48);
  // A name that sanitised down to punctuation is no name at all.
  return `${safeId}__${/[a-z0-9]/i.test(stem) ? stem : 'photo'}.${ext}`;
}

/** Tolerant read of whatever AsyncStorage handed back. Never throws. */
export function parseIndex(raw) {
  if (!raw) return {};
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {};
  for (const [id, entry] of Object.entries(parsed)) {
    // A row without a name can't be turned back into a file — it is noise.
    if (entry && typeof entry === 'object' && typeof entry.name === 'string' && entry.name) {
      out[id] = { ...entry, id };
    }
  }
  return out;
}

export const withEntry = (index, entry) => ({ ...index, [entry.id]: entry });
export const withoutId = (index, id) => {
  const next = { ...index };
  delete next[id];
  return next;
};

/** Bytes held by everything saved. Entries with no size count as zero. */
export function totalBytes(index) {
  return Object.values(index || {}).reduce((n, e) => n + (Number(e?.bytes) || 0), 0);
}

export const savedCount = (index) => Object.keys(index || {}).length;

// ── filesystem + index ──────────────────────────────────────────────────────

/** Absolute uri for a stored name, against the CURRENT container. */
export const uriForName = (name) => (name ? `${offlineDir()}${name}` : null);

async function ensureDir() {
  const dir = offlineDir();
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info?.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch { /* makeDirectory throws if it raced another call — that's fine */ }
  return dir;
}

export async function loadIndex() {
  try { return parseIndex(await AsyncStorage.getItem(INDEX_KEY)); } catch { return {}; }
}

export async function writeIndex(index) {
  try { await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index || {})); } catch { /* best effort */ }
}

/**
 * Drop index entries whose file is gone (container moved, user cleaned the
 * app's storage from iOS Settings, a restore that skipped the media). Returns
 * the surviving index, written back only if something actually changed — a
 * cold start must not write on every launch.
 */
export async function reconcile(index) {
  const ids = Object.keys(index || {});
  if (!ids.length) return index || {};
  const alive = {};
  for (const id of ids) {
    const entry = index[id];
    try {
      const info = await FileSystem.getInfoAsync(uriForName(entry.name), { size: true });
      if (info?.exists) alive[id] = { ...entry, bytes: info.size ?? entry.bytes ?? 0 };
    } catch { /* unreadable = treat as gone */ }
  }
  if (savedCount(alive) !== ids.length) await writeIndex(alive);
  return alive;
}

/**
 * Download `url` and keep it. Returns the new entry, or throws — the caller
 * decides how loud the failure is.
 *
 * `downloadAsync` does NOT reject on 4xx/5xx: it writes the error body to disk
 * and resolves. Saving that would leave a few bytes of JSON named ".jpg" that
 * renders as a broken picture with no explanation, so the status is checked
 * and the corpse deleted.
 */
export async function saveMedia({ id, url, filename, type = 'image' }) {
  if (!id || !url) throw new Error('offlineMedia.saveMedia needs an id and a url');
  await ensureDir();
  const name = offlineFileName(id, filename);
  const dest = uriForName(name);
  let res;
  try {
    res = await FileSystem.downloadAsync(url, dest);
  } catch (e) {
    try { await FileSystem.deleteAsync(dest, { idempotent: true }); } catch { /* ignore */ }
    throw e;
  }
  if (!res || (res.status && res.status >= 400)) {
    try { await FileSystem.deleteAsync(dest, { idempotent: true }); } catch { /* ignore */ }
    throw new Error(`HTTP ${res?.status} saving ${id} for offline`);
  }
  let bytes = 0;
  try {
    const info = await FileSystem.getInfoAsync(dest, { size: true });
    bytes = info?.size || 0;
  } catch { /* size is informational */ }
  return { id: String(id), name, bytes, type, filename: filename || null, savedAt: new Date().toISOString() };
}

/** Forget one picture: the file first, then the index row. */
export async function removeMedia(entry) {
  if (!entry?.name) return;
  try { await FileSystem.deleteAsync(uriForName(entry.name), { idempotent: true }); } catch { /* ignore */ }
}

/** Remove every saved picture and the directory itself. */
export async function clearAllOffline() {
  try { await FileSystem.deleteAsync(offlineDir(), { idempotent: true }); } catch { /* ignore */ }
  await writeIndex({});
}
