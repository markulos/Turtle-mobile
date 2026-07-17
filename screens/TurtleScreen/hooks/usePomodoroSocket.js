import { useEffect, useRef, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io } from 'socket.io-client';
import { serverOrigin, getApiAuthToken } from '../../../context/ServerContext';
import { getExpoPushTokenSafe } from '../../../services/vaultPush';
import * as liveActivity from '../../../services/liveActivity';
import { useCelebration } from '../../../context/CelebrationContext';

// Shared default sessionId so web and mobile clients land in the same server
// room out of the box. Single-user app — power users can override this in
// AsyncStorage under the same key (not currently wired through).
const POMODORO_SESSION_KEY = 'pomodoroSessionId';
const DEFAULT_POMODORO_SESSION_ID = 'turtle-default';

// Persisted identity of the last ended (completed/stopped) card the user
// dismissed. The server keeps replaying that ended state on every connect, so
// without this the card would reappear after every app reload. Identity is the
// server-clock start/end stamps (stable across reloads, unlike our skew-
// corrected local copies), so a genuinely NEW completion never matches.
const POMODORO_DISMISSED_KEY = 'pomodoroDismissedEndedId';
const endedIdentity = (data) =>
  data && (data.status === 'completed' || data.status === 'stopped')
    ? `${data.mode}:${data.startedAt}:${data.endedAt}`
    : null;

/**
 * usePomodoroSocket — server-as-source-of-truth pomodoro timer.
 *
 * One event channel: `pomodoro-state`, fired on every transition (start,
 * stop, complete) and on initial connect. We do NOT stream per-second
 * ticks; the visible countdown is computed locally by `TimerMessage` from
 * the absolute `endsAt` we set here once.
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
  const [state, setState] = useState(null);
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [durations, setDurations] = useState({ focus: 25, break: 5 });
  const { celebrate } = useCelebration();
  const socketRef = useRef(null);
  const sessionIdRef = useRef(DEFAULT_POMODORO_SESSION_ID);
  // Identity of the ended card the user has already dismissed (loaded from
  // AsyncStorage on mount) + the identity of the ended state currently coming
  // off the socket (so `dismiss` knows what to persist).
  const dismissedEndedIdRef = useRef(null);
  const lastEndedIdRef = useRef(null);
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

    socket.on('pomodoro-state', (data) => {
      const id = endedIdentity(data);
      lastEndedIdRef.current = id;
      // An ended card the user already dismissed on a prior run — the server
      // is just replaying it. Stay hidden instead of popping back up.
      if (id && id === dismissedEndedIdRef.current) {
        setState(null);
        return;
      }
      setState(translateServerState(data));
    });

    socket.on('pomodoro-durations', (data) => {
      if (data && typeof data.focus === 'number' && typeof data.break === 'number') {
        setDurations({ focus: data.focus, break: data.break });
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [serverIP]);

  // Restore the "already dismissed" ended-card identity. If the socket's
  // replay of that ended state raced ahead of this read, it's on screen now —
  // clear it the moment we learn it was dismissed.
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(POMODORO_DISMISSED_KEY)
      .then((v) => {
        if (!alive || !v) return;
        dismissedEndedIdRef.current = v;
        if (lastEndedIdRef.current === v) setState(null);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Resolve this device's push token once (cached in vaultPush after the first
  // hit). Best-effort — null before the dev rebuild / without permission.
  useEffect(() => {
    let alive = true;
    getExpoPushTokenSafe().then((t) => { if (alive) pushTokenRef.current = t; });
    return () => { alive = false; };
  }, []);

  // Drive the iOS Live Activity (Dynamic Island / lock screen) off the server
  // timer state — a live countdown while running, a persistent "done" card on
  // natural completion, gone on manual stop. Server state is the single source,
  // so this stays correct no matter which device started the run.
  const prevStatusRef = useRef(null);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const status = state?.status || 'idle';
    const prev = prevStatusRef.current;
    if (status === 'active') {
      liveActivity.showRunning(state.mode, state.endsAt);
    } else if (status === 'completed') {
      // A real completion transition, or a still-fresh completion the app just
      // reconnected to — never a stale 'completed' replayed on connect.
      const fresh = typeof state.endedAt === 'number' && Date.now() - state.endedAt < 120000;
      if (prev === 'active' || fresh) liveActivity.showCompleted(state.mode);
      else liveActivity.clear();
    } else {
      liveActivity.clear();
    }
    prevStatusRef.current = status;
  }, [state]);

  // Confetti + "+25 pts" when a FOCUS pomodoro reaches zero. Platform-agnostic
  // (unlike the iOS-only Live Activity effect above). Fires only for a real,
  // RECENT active→completed focus transition:
  //   • prev === 'active'  — we actually witnessed it running (not a cold replay)
  //   • endedAt < 120s ago — a warm reconnect after backgrounding replays a
  //     stale 'completed' with prevCelebRef still 'active'; the freshness gate
  //     stops confetti popping for an hours-old pomodoro.
  //   • mode !== 'break'   — breaks earn nothing.
  const prevCelebRef = useRef(null);
  useEffect(() => {
    const status = state?.status || 'idle';
    const fresh = typeof state?.endedAt !== 'number' || (Date.now() - state.endedAt < 120000);
    if (status === 'completed' && prevCelebRef.current === 'active' && fresh && state?.mode !== 'break') {
      celebrate({ points: 25, kind: 'pomodoro' });
    }
    prevCelebRef.current = status;
  }, [state, celebrate]);

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

  const dismiss = useCallback(() => {
    setState(null);
    // Remember this exact ended card so the server's replay of it after a
    // reload stays dismissed. Nothing to persist if it wasn't an ended card.
    const id = lastEndedIdRef.current;
    if (id) {
      dismissedEndedIdRef.current = id;
      AsyncStorage.setItem(POMODORO_DISMISSED_KEY, id).catch(() => {});
    }
  }, []);

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

/**
 * Translate a server-clock state payload into client-clock timestamps,
 * applying a one-shot clock-skew correction from `serverNow`. Done once
 * per state event — no recurring re-anchoring per tick (which is what
 * caused the previous design to thrash effects every second).
 */
function translateServerState(data) {
  if (!data || data.status === 'idle') return null;

  const skew =
    typeof data.serverNow === 'number' ? Date.now() - data.serverNow : 0;

  if (data.status === 'active') {
    return {
      status: 'active',
      mode: data.mode,
      totalDuration: data.totalDuration,
      startedAt: data.startedAt + skew,
      endsAt: data.endsAt + skew,
    };
  }
  // completed | stopped
  return {
    status: data.status,
    mode: data.mode,
    totalDuration: data.totalDuration,
    startedAt: data.startedAt + skew,
    endedAt: data.endedAt + skew,
  };
}

export { POMODORO_SESSION_KEY, DEFAULT_POMODORO_SESSION_ID };
