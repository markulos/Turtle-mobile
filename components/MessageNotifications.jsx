/**
 * Tapping a message notification opens that conversation.
 *
 * The push already carries who it is from — the server sends
 * `{ type: 'message', withUserId }` (server/services/messagePush) — so the tap
 * has everything it needs and the app was simply throwing it away: it opened on
 * whatever tab you left it on, and you went looking for the message you had
 * just been told about.
 *
 * Root-mounted and renders nothing, like PomodoroNotifications next door, and
 * for the same reason: a listener that lives inside a tab does not exist until
 * that tab has been opened, which is never the case for the cold start this
 * mostly has to serve.
 *
 * ── The two ways a tap arrives ─────────────────────────────────────────────
 *
 * WARM — the app is running, `addNotificationResponseReceivedListener` fires.
 * COLD — the tap launched the app, and there is no listener yet because there
 * was no app. `getLastNotificationResponseAsync` is the only way to see it, and
 * it is a replay of the LAST response rather than an event: it keeps answering
 * with the same tap every time it is asked.
 *
 * So the replay is read ONCE per run of the app. Without that guard a remount
 * — a provider above this re-rendering, a fast refresh — re-opens a thread the
 * user may have deliberately closed, and does it again on the next remount.
 * PomodoroNotifications can be relaxed about its own replay because starting an
 * already-running timer is a no-op; yanking someone back into a conversation is
 * not.
 */
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { requestChat } from '../services/chatIntent';
import { navigateToTab } from '../services/navigationRef';

/** The conversation thread lives on the Profile tab. */
const CHAT_TAB = 'Profile';

/** Module scope, not a ref: it is per RUN, not per mount. */
let coldStartRead = false;

export function handleMessageResponse(resp) {
  const data = resp?.notification?.request?.content?.data || {};
  if (data.type !== 'message') return false;
  const withUserId = String(data.withUserId || '').trim();
  if (!withUserId) return false;
  // Ask FIRST, then navigate: on a cold start the request is parked and the
  // screen takes it as it mounts, so it must already be there when the
  // navigator brings the tab up.
  requestChat(withUserId);
  navigateToTab(CHAT_TAB);
  return true;
}

export default function MessageNotifications() {
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(handleMessageResponse);

    if (!coldStartRead) {
      coldStartRead = true;
      Notifications.getLastNotificationResponseAsync?.()
        .then((r) => { if (r) handleMessageResponse(r); })
        .catch(() => { /* no launch notification, which is the normal case */ });
    }

    return () => sub?.remove?.();
  }, []);

  return null;
}

/** Tests only — the cold-start guard is module state. */
export function __resetColdStart() {
  coldStartRead = false;
}
