import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { serverOrigin, getApiAuthToken } from '../../../context/ServerContext';
import { getExpoPushTokenSafe } from '../../../services/vaultPush';
import { useSyncSignals } from '../../../context/DownloadsContext';

// Shared default sessionId so web and mobile clients land in the same server
// room out of the box. Single-user app — power users can override this in
// AsyncStorage under the same key (not currently wired through).
const POMODORO_SESSION_KEY = 'pomodoroSessionId';
const DEFAULT_POMODORO_SESSION_ID = 'turtle-default';

// Shown until the pond announces the saved pair. A module constant, not an
// object literal in the body, so the returned `durations` identity is stable
// while the server has not spoken yet.
const DEFAULT_DURATIONS = { focus: 25, break: 5 };

/**
 * usePomodoroSocket — server-as-source-of-truth pomodoro timer.
 *
 * One event channel: `pomodoro-state`, fired on every transition (start,
 * stop, complete) and on initial connect. We do NOT stream per-second
 * ticks; the visible countdown is computed locally by `TimerMessage` from
 * the absolute `endsAt` we set here once.
 *
 * That channel is NOT listened to here any more. This hook lives inside
 * TurtleScreen and the bottom-tab navigator is LAZY, so until the user tapped
 * the Turtle tab the process had no `pomodoro-state` listener at all and a
 * focus block started on the desktop was invisible on the phone. The listener
 * moved to the app-level socket in `context/DownloadsContext`, which runs from
 * boot; this hook now READS that shared value, so the timer card and every
 * other surface are looking at the same bytes and cannot disagree. Its own
 * socket stays, for the start / stop / durations EMITS and for the connection
 * indicator.
 *
 * The iOS Live Activity and the completion confetti are not here either, for
 * the same reason: they moved to `components/PomodoroLiveEffects`, mounted at
 * app level, driven by the same shared view. The "already dismissed" memory
 * went with them (it is what clears the island), so `dismiss` here is the
 * context's.
 *
 * Returns:
 *   {
 *     state: null
 *          | { status:'active', mode, startedAt, endsAt, totalDuration }
 *          | { status:'completed'|'stopped', mode, startedAt, endedAt, totalDuration },
 *     start: (mode) => void,
 *     stop: () => void,
 *     dismiss: () => void,    // hides the ended card + persists so the server's
 *                             // replay of it stays dismissed across reloads
 *     durations: { focus, break },  // minutes
 *     updateDurations: (focusMinutes, breakMinutes) => void,
 *     sessionId: string,
 *     isSocketConnected: boolean,
 *   }
 */
export function usePomodoroSocket(serverIP) {
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  // The app-level socket's reading of the shared timer, already translated and
  // already minus a dismissed ended card — the card draws exactly this.
  const { pomodoroView: state, pomodoroDurations, dismissEndedTimer } = useSyncSignals();
  const durations = pomodoroDurations || DEFAULT_DURATIONS;
  const socketRef = useRef(null);
  const sessionIdRef = useRef(DEFAULT_POMODORO_SESSION_ID);
  // This device's Expo push token, prefetched so `start` can tag the timer
  // synchronously — the server pings only THIS device when the run ends.
  const pushTokenRef = useRef(null);

  useEffect(() => {
    if (!serverIP) return undefined;

    const socket = io(serverOrigin(serverIP), {
      query: { sessionId: sessionIdRef.current },
      auth: { token: getApiAuthToken() || undefined },
      transports: ['websocket'],
      reconnection: true,
      // BATTERY: socket.io defaults retry every 1–5 s FOREVER when the server
      // is unreachable — and each attempt is a TLS handshake over the funnel,
      // which is CPU-expensive. Back off to a 30 s ceiling so an unreachable
      // server costs ~one handshake/30 s instead of ~one/2–5 s (still
      // reconnects promptly once the server returns). Same on all 3 sockets.
      reconnectionDelay: 2000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5,
    });
    socketRef.current = socket;

    socket.on('connect', () => setIsSocketConnected(true));
    socket.on('disconnect', () => setIsSocketConnected(false));

    // No pomodoro-state / pomodoro-durations listeners here: the app-level
    // socket owns those (see the note on this hook). Two listeners on the same
    // two events is how the card and the rest of the app came to hold two
    // separately-translated copies of one timer.

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [serverIP]);

  // Resolve this device's push token once (cached in vaultPush after the first
  // hit). Best-effort — null before the dev rebuild / without permission.
  useEffect(() => {
    let alive = true;
    getExpoPushTokenSafe().then((t) => { if (alive) pushTokenRef.current = t; });
    return () => { alive = false; };
  }, []);

  const start = useCallback((mode) => {
    socketRef.current?.emit('pomodoro-start', {
      mode,
      // Only this device gets the "timer done" push; omitted if unavailable.
      pushToken: pushTokenRef.current || undefined,
    });
  }, []);

  const stop = useCallback(() => {
    socketRef.current?.emit('pomodoro-stop');
  }, []);

  // Hides the ended card everywhere at once — the card here, the island on the
  // lock screen — because both draw the same shared view.
  const dismiss = dismissEndedTimer;

  const updateDurations = useCallback((focusMinutes, breakMinutes) => {
    socketRef.current?.emit('pomodoro-update-durations', { focusMinutes, breakMinutes });
  }, []);

  return {
    state,
    start,
    stop,
    dismiss,
    durations,
    updateDurations,
    sessionId: sessionIdRef.current,
    isSocketConnected,
  };
}

export { POMODORO_SESSION_KEY, DEFAULT_POMODORO_SESSION_ID };
