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

async function ensureReady() {
  if (!Notifications) return false;
  try {
    if (!handlerSet) {
      Notifications.setNotificationHandler({
        // shouldShowAlert (older) + shouldShowBanner/List (SDK 53+) so the
        // banner appears even while the app is foregrounded, across versions.
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
      handlerSet = true;
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
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
