/**
 * launchUpdate — the quiet check that lets a bad update be fixed by
 * publishing a good one.
 *
 * The app's expo-updates config is `checkAutomatically: ON_ERROR_RECOVERY`
 * (app.json): it never looks for an update by itself, only during crash
 * recovery or when someone opens the updates card. On 2026-11-13 that meant a
 * preview update that crashed on the first touch of the navbar could only be
 * replaced by tapping the navbar — and changing that config would move the
 * native fingerprint and need a new build.
 *
 * So the JavaScript does it: shortly after launch, and again on coming back to
 * the foreground after a while, ask the pond for a newer update and DOWNLOAD
 * it in the background. It is never applied mid-session — no reloadAsync here,
 * nothing yanks the screen out from under you. expo-updates launches a
 * downloaded update the next time the app starts, so a broken update heals in
 * two opens with no menus, and a good one simply arrives.
 *
 * The delay is short on purpose: the case that motivated this is an update
 * that crashes on the first touch, and the download has to be under way
 * before someone's thumb gets there.
 *
 * Everything is swallowed: offline, a pond that is down, a dev client where
 * every Updates call throws. The result only feeds the Profile dot.
 */
import * as Updates from 'expo-updates';
import { setAttention } from '../utils/attention';

/** After first render, so the check does not compete with startup work. */
export const LAUNCH_DELAY_MS = 1500;
/** Coming back to the foreground re-checks only if the last check is older than this. */
export const RECHECK_AFTER_MS = 30 * 60 * 1000;

let lastCheckAt = 0;
let inFlight = null;

export function shouldRecheck(lastAt, now) {
  return !lastAt || now - lastAt >= RECHECK_AFTER_MS;
}

/**
 * Check, and download if there is something newer. Resolves to
 * 'skipped' | 'current' | 'ready' | 'error'. Concurrent calls share one run.
 */
export function checkAndDownload({
  updates = Updates,
  isDev = typeof __DEV__ !== 'undefined' && __DEV__,
  now = Date.now,
} = {}) {
  if (isDev || !updates?.isEnabled) return Promise.resolve('skipped');
  if (inFlight) return inFlight;
  inFlight = (async () => {
    lastCheckAt = now();
    try {
      const found = await updates.checkForUpdateAsync();
      if (!found?.isAvailable) {
        setAttention({ update: 'none' });
        return 'current';
      }
      setAttention({ update: 'available' });
      // isNew false = this update was already downloaded earlier and is still
      // pending for the next launch — "ready" either way.
      await updates.fetchUpdateAsync();
      setAttention({ update: 'ready' });
      return 'ready';
    } catch {
      return 'error';
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function lastLaunchCheckAt() {
  return lastCheckAt;
}

/** Tests only. */
export function __resetLaunchUpdate() {
  lastCheckAt = 0;
  inFlight = null;
}
