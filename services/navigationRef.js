/**
 * A handle on the navigator for code that is not inside it.
 *
 * Almost nothing should want this — a screen navigates with the hook it is
 * given, and reaching for a global ref instead is how navigation logic ends up
 * scattered outside the tree that owns it. The honest exception is an event
 * that arrives from OUTSIDE React altogether: a notification the user tapped.
 * That handler has no component, no hook and no props, and it still has to put
 * the app on the right tab.
 *
 * ── Why it queues ──────────────────────────────────────────────────────────
 *
 * On a COLD start the tap is delivered before the navigator exists.
 * `getLastNotificationResponseAsync` resolves within the first frames, while
 * `NavigationContainer` is still mounting, so a bare `navigate()` there is a
 * no-op and the app opens on whatever tab it was last on — the exact bug this
 * is here to avoid, and one that only ever shows up from a killed app.
 *
 * So a request made too early is PARKED and replayed from `onReady`. One slot,
 * not a queue: these are user intentions, and the only one worth honouring is
 * the most recent.
 */
import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

/** The tab asked for before the navigator could answer, if any. */
let parked = null;

/**
 * Go to a tab by name. Returns whether it happened now — false means parked,
 * not failed.
 */
export function navigateToTab(name) {
  if (!name) return false;
  if (navigationRef.isReady()) {
    navigationRef.navigate(name);
    return true;
  }
  parked = name;
  return false;
}

/** Replay whatever was asked for too early. Safe to call more than once. */
export function flushPendingNavigation() {
  if (!parked || !navigationRef.isReady()) return;
  const name = parked;
  parked = null;
  navigationRef.navigate(name);
}

/** Tests only — the parked slot is module state and outlives a test file. */
export function __resetParkedNavigation() {
  parked = null;
}
