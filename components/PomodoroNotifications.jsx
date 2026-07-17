import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { useServer } from '../context/ServerContext';
import { registerPomodoroCategories } from '../services/pomodoroNotify';
import { getExpoPushTokenSafe } from '../services/vaultPush';

// Root-mounted, renders nothing. Registers the interactive pomodoro categories
// and reacts to their action buttons: "Start break"/"Start focus" POST to the
// server so the next timer runs on the shared app session (and its completion
// pings this device again). "Dismiss"/plain tap just acknowledge.
export default function PomodoroNotifications() {
  const { getBaseUrl } = useServer();

  useEffect(() => { registerPomodoroCategories(); }, []);

  useEffect(() => {
    const startNext = async (mode) => {
      try {
        const pushToken = await getExpoPushTokenSafe();
        await fetch(`${getBaseUrl()}/pomodoro/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode, pushToken: pushToken || undefined }),
        });
      } catch {
        // offline / server unreachable — the in-app controls remain the fallback
      }
    };

    const handle = (resp) => {
      const data = resp?.notification?.request?.content?.data || {};
      if (data.type !== 'pomodoro') return;
      const action = resp.actionIdentifier;
      if (action === 'start-break') startNext('break');
      else if (action === 'start-focus') startNext('focus');
      // 'pomodoro-ack' or a plain tap (DEFAULT_ACTION_IDENTIFIER) → acknowledge only.
    };

    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    // Cold start: the button tap that launched the app from a killed state.
    // A duplicate start is harmless — startTimer supersedes the prior run.
    Notifications.getLastNotificationResponseAsync?.()
      .then((r) => { if (r) handle(r); })
      .catch(() => {});

    return () => sub?.remove?.();
  }, [getBaseUrl]);

  return null;
}
