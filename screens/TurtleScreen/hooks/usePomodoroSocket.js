import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

// Shared default sessionId so web and mobile clients land in the same server
// room out of the box. Single-user app — power users can override this in
// AsyncStorage under the same key (not currently wired through).
const POMODORO_SESSION_KEY = 'pomodoroSessionId';
const DEFAULT_POMODORO_SESSION_ID = 'turtle-default';

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
 *     dismiss: () => void,    // local-only: hides the ended card
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
  const socketRef = useRef(null);
  const sessionIdRef = useRef(DEFAULT_POMODORO_SESSION_ID);

  useEffect(() => {
    if (!serverIP) return undefined;

    const socket = io(`http://${serverIP}:3000`, {
      query: { sessionId: sessionIdRef.current },
      transports: ['websocket'],
      reconnection: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => setIsSocketConnected(true));
    socket.on('disconnect', () => setIsSocketConnected(false));

    socket.on('pomodoro-state', (data) => {
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

  const start = useCallback((mode) => {
    socketRef.current?.emit('pomodoro-start', { mode });
  }, []);

  const stop = useCallback(() => {
    socketRef.current?.emit('pomodoro-stop');
  }, []);

  const dismiss = useCallback(() => {
    setState(null);
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
