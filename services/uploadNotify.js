// Guarded local-notification helper for the photo-upload flow.
//
// expo-notifications is a NATIVE module: it only functions once the dev app has
// been REBUILT with it included. Everything here is wrapped so that — before
// that rebuild, or if the user denies permission — every call is a silent
// no-op. The in-app "delete from phone?" prompt is the always-present fallback;
// this notification is purely a bonus ping for when the app is backgrounded.

let Notifications = null;
try {
  // eslint-disable-next-line global-require
  Notifications = require('expo-notifications');
} catch (e) {
  Notifications = null; // not built into this binary yet → fall back to in-app prompt
}

let handlerSet = false;

// Stable identifier for the LIVE upload-progress notification. Re-posting with
// the SAME id replaces the delivered notification in place (iOS + Android), so
// the single entry ticks its percentage instead of stacking new banners.
const PROGRESS_ID = 'vault-upload-progress';

// Set the display handler once (idempotent). Separated from the permission
// request so progress updates can ensure the handler WITHOUT ever prompting.
function ensureHandler() {
  if (!Notifications || handlerSet) return;
  Notifications.setNotificationHandler({
    // shouldShowAlert (older) + shouldShowBanner/List (SDK 53+) so the
    // banner appears even while the app is foregrounded, across versions.
    // Data-aware: pomodoro end-pings ding; upload notices stay silent, and
    // the constantly-updating progress notice never re-banners (it only
    // shows in the list / Notification Center, updating quietly).
    handleNotification: async (n) => {
      const type = n?.request?.content?.data?.type;
      const isProgress = type === 'upload-progress';
      return {
        shouldShowAlert: !isProgress,
        shouldShowBanner: !isProgress,
        shouldShowList: true,
        shouldPlaySound: type === 'pomodoro',
        shouldSetBadge: false,
      };
    },
  });
  handlerSet = true;
}

async function ensureReady() {
  if (!Notifications) return false;
  try {
    ensureHandler();
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    return status === 'granted';
  } catch (e) {
    return false;
  }
}

// Granted-ONLY gate for progress updates: ensures the handler but NEVER
// prompts (a progress tick must not raise a permission dialog). Returns false
// until the user has granted via some earlier flow (e.g. the completion ping,
// or a task reminder), at which point progress notifications light up.
async function progressPermitted() {
  if (!Notifications) return false;
  try {
    ensureHandler();
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  } catch (e) {
    return false;
  }
}

// True if the native module is present in this build (so callers can decide
// whether to lean on the notification or the in-app prompt).
export function notificationsAvailable() {
  return !!Notifications;
}

// Fire a "your upload finished — free up space?" local notification. Returns
// true if it was actually scheduled, false if notifications aren't available.
export async function notifyUploadComplete(count) {
  try {
    const ready = await ensureReady();
    if (!ready) return false;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Upload complete 🐢',
        body: `${count} photo${count === 1 ? '' : 's'} uploaded. Open Turtle to delete the originals from your phone.`,
      },
      trigger: null, // deliver immediately
    });
    return true;
  } catch (e) {
    return false;
  }
}

// Post and clear are fired UNAWAITED from different turns (a % tick vs. an
// AppState/done event) and each has internal awaits (a permissions round-trip,
// then schedule; or dismiss then cancel) that route through independent native
// modules — so their effects could interleave and a late-resolving POST could
// re-create the notification AFTER a clear, orphaning it. Two guards make the
// ordering deterministic:
//   • one shared promise CHAIN → ops run strictly one-after-another (a post's
//     schedule can never overtake a prior clear's dismiss+cancel), and
//   • a monotonic EPOCH that clearUploadProgress bumps → any post queued before
//     that clear is dropped, even across its internal await gap.
let notifOpChain = Promise.resolve();
let notifEpoch = 0;
const runNotifOp = (fn) => { notifOpChain = notifOpChain.then(fn, fn); return notifOpChain; };

// The LIVE progress notification — the "dynamic widget OUTSIDE the app". Re-post
// with the fixed PROGRESS_ID to update the same entry's percentage in place.
//   iOS:      interruptionLevel 'passive' → updates quietly in Notification
//             Center, never re-alerting; the handler above also suppresses its
//             banner if it ever fires foreground.
//   Android:  sticky/ongoing so it reads as an in-progress transfer.
// Note: a foreground URLSession suspends ~30s after the app backgrounds, so
// this reflects progress during the background grace window + on the next time
// JS runs; a truly always-live lock-screen bar is a Live Activity (native).
// Granted-only (never prompts) and fully guarded → silent no-op pre-rebuild.
export async function updateUploadProgress({ pct, current, total, duplicates = 0 }) {
  const myEpoch = notifEpoch; // captured before queueing; a later clear invalidates it
  return runNotifOp(async () => {
    if (myEpoch !== notifEpoch) return false;           // a clear was requested after this post
    try {
      if (!(await progressPermitted())) return false;
      if (myEpoch !== notifEpoch) return false;         // re-check across the async gap
      const dupPart = duplicates > 0 ? ` · ${duplicates} duplicate${duplicates === 1 ? '' : 's'} skipped` : '';
      await Notifications.scheduleNotificationAsync({
        identifier: PROGRESS_ID,
        content: {
          title: `Uploading to your vault · ${pct}%`,
          body: `${current} of ${total}${dupPart}`,
          sticky: true,                 // Android: ongoing while the batch runs
          interruptionLevel: 'passive', // iOS 15+: quiet, list-only updates
          data: { type: 'upload-progress' },
        },
        trigger: null,
      });
      return true;
    } catch (e) {
      return false;
    }
  });
}

// Remove the live progress notification (upload finished, cancelled, or the
// app returned to the foreground where the in-app UI takes over). Bumps the
// epoch FIRST so any post already queued is dropped rather than re-posting
// after this clear.
export async function clearUploadProgress() {
  notifEpoch++;
  return runNotifOp(async () => {
    if (!Notifications) return;
    try { await Notifications.dismissNotificationAsync(PROGRESS_ID); } catch (e) { /* not delivered */ }
    try { await Notifications.cancelScheduledNotificationAsync(PROGRESS_ID); } catch (e) { /* not scheduled */ }
  });
}
