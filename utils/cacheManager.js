// Central cache governor for the mobile app.
//
// The photo vault caches aggressively (expo-image disk cache + prefetch, plus
// temp files from image-picker / manipulator / video-thumbnails, plus copies
// downloaded purely to feed the OS share sheet). Nothing capped any of it, so
// it grew to multiple GB. This module bounds it:
//
//   • sweepTransientCaches()        — always-safe, cheap. Deletes throwaway temp
//                                     dirs + leaked share files + RAM cache.
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
  try { await Image.clearMemoryCache(); } catch (e) { /* ignore */ }
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
  try { await Image.clearDiskCache(); } catch (e) { /* ignore */ }
  try { await AsyncStorage.setItem(LAST_DISK_CLEAR_KEY, String(Date.now())); } catch (e) { /* ignore */ }
}
