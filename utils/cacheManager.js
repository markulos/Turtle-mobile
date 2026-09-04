// Central cache governor for the mobile app.
//
// The photo vault caches aggressively (expo-image disk cache + prefetch, plus
// temp files from image-picker / manipulator / video-thumbnails, plus copies
// downloaded purely to feed the OS share sheet). Nothing capped any of it, so
// it grew to multiple GB. This module bounds it:
//
//   • sweepTransientCaches()        — always-safe, cheap. Deletes throwaway temp
//                                     dirs + leaked share files. Deliberately does
//                                     NOT wipe expo-image's in-memory cache: that
//                                     forced a full re-decode of every visible tile
//                                     on resume (cold "warm scroll"). The OS evicts
//                                     image RAM under pressure on its own. The
//                                     explicit Clear-cache button still wipes it
//                                     (see clearAllCaches).
//   • maybeClearImageDiskCache()    — wipes expo-image's PERSISTENT disk cache,
//                                     throttled by max-age so quick app-switches
//                                     don't keep nuking a warm cache.
//   • runCacheMaintenanceOnBackground() — the one call wired to AppState.
//   • clearAllCaches()              — force-wipe everything (Settings button).
//
// We deliberately do NOT wipe the whole image cache on every close: that would
// force a full re-download from the home server on each launch. Instead we keep
// it warm for a short window and only let it rebuild occasionally.
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sweepShareUploadStaging } from '../services/shareUploadStaging';

// How often, at most, the persistent expo-image disk cache is wiped when the
// app is backgrounded. 0 = wipe on every app close; larger = keep it warmer
// across quick app-switches. This is the main size governor — the disk cache is
// what grows without bound.
export const IMAGE_DISK_CACHE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

const LAST_DISK_CLEAR_KEY = 'cache:lastImageDiskClear';

const baseDir = () => FileSystem.cacheDirectory || '';

// expo helper temp dirs — pure throwaway, regenerated on demand.
const TRANSIENT_DIRS = ['ImagePicker', 'ImageManipulator', 'VideoThumbnails'];

// Files we download into cacheDirectory solely to hand to the OS share sheet.
// doShare / bulk-share now delete their own copy immediately, but this catches
// any left behind by a crash or mid-share dismissal.
const SHARE_PREFIXES = ['full_', 'reg_', 'shared_'];

const rm = async (uri) => {
  try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch (e) { /* ignore */ }
};

// Recursively sum the byte size of everything under `uri`. Directories are
// walked; files contribute their `size`. Best-effort: anything unreadable is
// skipped so a single bad entry can't fail the whole measurement.
const dirSize = async (uri) => {
  let info;
  try { info = await FileSystem.getInfoAsync(uri, { size: true }); } catch (e) { return 0; }
  if (!info || !info.exists) return 0;
  if (!info.isDirectory) return info.size || 0;
  let names;
  try { names = await FileSystem.readDirectoryAsync(uri); } catch (e) { return 0; }
  // Ensure a trailing slash before joining child names.
  const prefix = uri.endsWith('/') ? uri : `${uri}/`;
  const sizes = await Promise.all(names.map((n) => dirSize(`${prefix}${n}`)));
  return sizes.reduce((a, b) => a + b, 0);
};

// Total bytes the app cache is currently occupying. This walks
// FileSystem.cacheDirectory, which holds the transient temp dirs, leftover
// share files, AND expo-image's persistent disk cache (it lives under the same
// OS caches directory) — i.e. exactly what clearAllCaches() wipes.
export async function getCacheSizeBytes() {
  const base = baseDir();
  if (!base) return 0;
  return dirSize(base);
}

// "1.4 GB" / "327 MB" / "812 KB" / "0 B" — compact human-readable bytes.
// Byte sizes are formatted in ONE place app-wide (utils/statsFormat), so the
// cache size on this screen and the database size two sections below it can't
// disagree about how to round the same number. Re-exported rather than moved:
// every existing importer of `cacheManager.formatBytes` keeps working.
export { formatBytes } from './statsFormat';

// Always-safe, cheap cleanup. Safe to run on every background.
export async function sweepTransientCaches() {
  const base = baseDir();
  if (!base) return;
  for (const d of TRANSIENT_DIRS) await rm(`${base}${d}`);
  try {
    const names = await FileSystem.readDirectoryAsync(base);
    await Promise.all(
      names
        .filter((n) => SHARE_PREFIXES.some((p) => n.startsWith(p)))
        .map((n) => rm(`${base}${n}`)),
    );
  } catch (e) { /* dir may not exist yet */ }
  await sweepShareUploadStaging();
}

// Wipe expo-image's persistent disk cache, throttled by max-age. Returns true
// if it actually cleared.
export async function maybeClearImageDiskCache(maxAgeMs = IMAGE_DISK_CACHE_MAX_AGE_MS) {
  try {
    const raw = await AsyncStorage.getItem(LAST_DISK_CLEAR_KEY);
    const last = raw ? parseInt(raw, 10) : 0;
    const now = Date.now();
    if (now - last < maxAgeMs) return false;
    await Image.clearDiskCache();
    await AsyncStorage.setItem(LAST_DISK_CLEAR_KEY, String(now));
    return true;
  } catch (e) {
    return false;
  }
}

// One call to run when the app goes to the background / is closed.
export async function runCacheMaintenanceOnBackground() {
  await sweepTransientCaches();
  await maybeClearImageDiskCache();
}

// Force-wipe everything now (e.g. a Settings "Clear cache" button).
export async function clearAllCaches() {
  await sweepTransientCaches();
  // The explicit "Clear cache" button DOES wipe the in-memory cache (unlike the
  // per-background sweep, which leaves it warm).
  try { await Image.clearMemoryCache(); } catch (e) { /* ignore */ }
  try { await Image.clearDiskCache(); } catch (e) { /* ignore */ }
  try { await AsyncStorage.setItem(LAST_DISK_CLEAR_KEY, String(Date.now())); } catch (e) { /* ignore */ }
}
