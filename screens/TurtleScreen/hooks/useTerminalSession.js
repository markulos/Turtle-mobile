import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { serverOrigin, getApiAuthToken } from '../../../context/ServerContext';

const DEFAULT_SESSION_ID = 'turtle-default';

/**
 * useTerminalSession — drives a persistent remote shell on the server over
 * socket.io and owns the rendered transcript + current working directory.
 *
 * The server spawns ONE long-lived shell (see
 * server/services/terminalSessionManager.js); this hook sends commands and
 * collects the streamed output. Transcript lines:
 *   { id, kind: 'command'|'output'|'error'|'meta', text, cwd? }
 *
 * Exposes: { active, busy, open, cwd, transcript, start, send, stop, close }
 *   open = panel visible / terminal-mode active (drives routing).
 */
export function useTerminalSession(serverIP, token) {
  const [active, setActive] = useState(false); // shell process running
  const [busy, setBusy] = useState(false);     // a command is in flight
  const [open, setOpen] = useState(false);     // panel visible
  const [cwd, setCwd] = useState('');
  const [transcript, setTranscript] = useState([]);
  // BATTERY: the socket is created LAZILY — only after the terminal is first
  // used (start/send). Most app sessions never open the remote shell, so this
  // keeps one of the three socket.io connections from dialing out on every
  // TurtleScreen mount. It latches true on first use and stays up for the rest
  // of the session (reconnecting like before); we deliberately do NOT tear it
  // down on close, to avoid shell re-sync races on reopen.
  const [shouldConnect, setShouldConnect] = useState(false);

  const socketRef = useRef(null);
  const tokenRef = useRef(token);
  const idRef = useRef(0);
  const cwdRef = useRef('');
  // Emits issued before the lazily-created socket has connected wait here and
  // flush on 'connect' (socketRef is null until the gated effect runs).
  const pendingRef = useRef([]);

  useEffect(() => { tokenRef.current = token; }, [token]);
  useEffect(() => { cwdRef.current = cwd; }, [cwd]);

  // Cap the scrollback so a noisy command (e.g. `dir` of a huge folder)
  // can't grow the transcript unbounded.
  const MAX_LINES = 500;
  const push = useCallback((line) => {
    setTranscript((prev) => {
      const next = [...prev, { id: `tm_${idRef.current++}`, ...line }];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  // Send an event now if the socket is connected, else queue it and bring the
  // socket up — the lazy-connect entry point used by start()/send().
  const emitOrQueue = useCallback((event, payload) => {
    const s = socketRef.current;
    if (s && s.connected) {
      s.emit(event, payload);
    } else {
      pendingRef.current.push([event, payload]);
      setShouldConnect(true); // dial the socket on first use
    }
  }, []);

  useEffect(() => {
    // Gated on shouldConnect so the socket stays dormant until the terminal is
    // actually used (battery — see the state comment above).
    if (!serverIP || !shouldConnect) return undefined;

    const socket = io(serverOrigin(serverIP), {
      query: { sessionId: DEFAULT_SESSION_ID },
      auth: { token: getApiAuthToken() || undefined },
      transports: ['websocket'],
      reconnection: true,
      // BATTERY: cap reconnect backoff at 30 s (default retries every 1–5 s
      // forever). See usePomodoroSocket for the full rationale.
      reconnectionDelay: 2000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5,
      forceNew: true,
    });
    socketRef.current = socket;

    // Flush any emits queued before the socket finished connecting (the first
    // terminal:start / terminal:input that triggered this lazy connect).
    socket.on('connect', () => {
      if (pendingRef.current.length) {
        const queued = pendingRef.current;
        pendingRef.current = [];
        for (const [ev, pl] of queued) socket.emit(ev, pl);
      }
    });

    socket.on('terminal:status', (s) => {
      if (s?.running === true) { setActive(true); if (s.cwd) setCwd(s.cwd); }
      else if (s?.running === false) { setActive(false); setBusy(false); }
      if (s?.error) push({ kind: 'error', text: s.error });
      else if (s?.running === true) push({ kind: 'meta', text: `shell ready (${s.shell || 'shell'})` });
      else if (s?.stopped) push({ kind: 'meta', text: 'terminal closed' });
      else if (s?.running === false && typeof s?.code === 'number') push({ kind: 'meta', text: `shell exited (${s.code})` });
    });
    socket.on('terminal:cwd', (d) => { if (d?.cwd) setCwd(d.cwd); });
    socket.on('terminal:output', (o) => {
      push({ kind: o?.stream === 'stderr' ? 'error' : 'output', text: o?.text ?? '' });
    });
    socket.on('terminal:done', () => setBusy(false));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [serverIP, shouldConnect, push]);

  const start = useCallback(() => {
    setOpen(true);
    emitOrQueue('terminal:start', { token: tokenRef.current });
  }, [emitOrQueue]);

  const send = useCallback((command) => {
    setOpen(true);
    setBusy(true);
    push({ kind: 'command', text: command, cwd: cwdRef.current });
    emitOrQueue('terminal:input', { token: tokenRef.current, text: command });
  }, [push, emitOrQueue]);

  const stop = useCallback(() => {
    socketRef.current?.emit('terminal:stop', { token: tokenRef.current });
    setOpen(false);
    setBusy(false);
  }, []);

  // Hide the panel without killing the shell (it keeps running server-side).
  const close = useCallback(() => { setOpen(false); }, []);

  return { active, busy, open, cwd, transcript, start, send, stop, close };
}
