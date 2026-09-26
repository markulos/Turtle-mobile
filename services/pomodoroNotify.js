// Interactive pomodoro notifications (Tier 1).
//
// Registers the two iOS notification categories whose action buttons appear on
// the "Focus complete"/"Break's over" push the server sends (categoryId
// 'pomodoro-focus-complete' / 'pomodoro-break-complete'):
//   • after focus  → [ Start break, Dismiss ]
//   • after break  → [ Start focus, Dismiss ]
// The response is handled in components/PomodoroNotifications.jsx, which POSTs
// /api/pomodoro/start so the next timer runs on the shared app session.
//
// expo-notifications is a NATIVE module — before the dev rebuild (or in Expo
// Go) every call here is a guarded no-op.

import { recentlyChimed } from './focusChime';

let Notifications = null;
try {
  // eslint-disable-next-line global-require
  Notifications = require('expo-notifications');
} catch {
  Notifications = null;
}

let registered = false;

export async function registerPomodoroCategories() {
  if (!Notifications || registered) return;
  try {
    // Foreground presentation: show the banner even when the app is open, and
    // ding for a pomodoro (uploads stay silent — decided per-notification by
    // data.type so it doesn't matter which module sets the handler last).
    Notifications.setNotificationHandler({
      handleNotification: async (n) => {
        const type = n?.request?.content?.data?.type;
        const isPomodoro = type === 'pomodoro';
        return {
          shouldShowAlert: true,
          shouldShowBanner: true,
          shouldShowList: true,
          // A pomodoro dings — UNLESS the Focus page just chimed for the same
          // completion. The server pushes to the device that started the block
          // and the app is often open on it, so without this one finished
          // block makes two sounds a second apart. The banner still shows; only
          // the duplicate sound is dropped.
          shouldPlaySound: isPomodoro && !recentlyChimed(),
          shouldSetBadge: false,
        };
      },
    });

    await Notifications.setNotificationCategoryAsync('pomodoro-focus-complete', [
      { identifier: 'start-break', buttonTitle: 'Start break', options: { opensAppToForeground: true } },
      { identifier: 'pomodoro-ack', buttonTitle: 'Dismiss', options: { opensAppToForeground: false } },
    ]);
    await Notifications.setNotificationCategoryAsync('pomodoro-break-complete', [
      { identifier: 'start-focus', buttonTitle: 'Start focus', options: { opensAppToForeground: true } },
      { identifier: 'pomodoro-ack', buttonTitle: 'Dismiss', options: { opensAppToForeground: false } },
    ]);
    registered = true;
  } catch {
    // Native module not present in this build yet — fine, no interactive buttons.
  }
}
