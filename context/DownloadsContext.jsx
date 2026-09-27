/**
 * DownloadsContext (mobile) — the app's ONE always-on Socket.IO connection.
 *
 * It started life watching the server's ghost-download queue, modeled on
 * usePomodoroSocket: connect on serverIP, subscribe, clean up on change. It is
 * now also the app's cross-device SYNC listener, because it is the only socket
 * that exists from boot: the other three (pomodoro, claude, terminal) live
 * inside TurtleScreen, and the bottom-tab navigator is LAZY, so until the user
 * taps the Turtle tab this process had no listener for any of them. A focus
 * block started on the desktop was therefore invisible on the phone, and a task
 * or note edited anywhere else could sit unseen indefinitely — mobile had no
 * task socket AND no focus refetch.
 *
 * This socket is authenticated (auth.token), which is what puts it in the
 * server's `user:<userId>` room and its `pomodoro:<userId>` room — see the
 * io.on('connection') handler: both rooms are keyed off the VERIFIED user, not
 * off any client-sent sessionId, and the server replays pomodoro-state /
 * pomodoro-durations to each socket the moment it connects. So nothing here
 * needs a second connection, and nothing needs to poll.
 *
 * Server broadcasts, download queue + vault (io.emit, no room):
 *   download:job       — a download_jobs row (media_id stripped server-side:
 *                        unauthenticated surface, and media ids are capabilities)
 *   download:progress  — { id, percent } (yt-dlp) OR { id, downloaded, total }
 *   media:added        — a media row landed → bump mediaVersion so the gallery
 *                        can live-refresh (downloads land in the vault).
 *
 * Server pings, room `user:<userId>` — EVERY payload is empty on purpose, so a
 * ping cannot go stale between emit and read. Each one bumps a counter and the
 * screen that cares REFETCHES over authenticated HTTP:
 *   tasks:changed          — a task of theirs (or one they are on) was created,
 *                            edited, ticked or deleted → tasksVersion
 *   notes:changed          — a note changed → notesVersion
 *   pomodoro-task-changed  — a TASK-LINKED focus block started/stopped/finished
 *                            → focusVersion (re-read /pomodoro/widget and
 *                            /pomodoros/active, which those screens already read)
 *   pomodoro-state         — the shared timer changed; the payload IS the state,
 *                            so it is kept rather than counted
 *   pomodoro-durations     — the saved focus/break minutes changed
 *   message:new            — a direct message arrived; no chat UI yet, ignored.
 */
import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io } from 'socket.io-client';
import { useServer, serverOrigin } from './ServerContext';
import { useAuth } from './AuthContext';
import { endedIdentity, visibleTimer } from '../utils/pomodoroState';

// The ended card the user last dismissed, by its server stamps. Persisted,
// because the server replays its last ended state to every socket on connect
// and the card would otherwise come back after every reload. Used to live in
// the Turtle tab's hook; it moved here with the timer, so that the app-level
// Live Activity driver honours a dismissal the same instant the card does.
const POMODORO_DISMISSED_KEY = 'pomodoroDismissedEndedId';

const DownloadsContext = createContext({
  jobs: [], active: 0, mediaVersion: 0,
  control: async () => {}, remove: async () => {}, enqueue: async () => {}, refresh: async () => {},
});

export const useDownloads = () => useContext(DownloadsContext);

// mediaVersion lives in its OWN context: the jobs value churns on every
// download:progress tick, and MediaGallery (which only cares about "did the
// vault change") was re-rendering per tick through useDownloads.
const MediaVersionContext = createContext({ mediaVersion: 0 });
export const useMediaVersion = () => useContext(MediaVersionContext);

// The cross-device sync signals, in their OWN context for the same reason
// mediaVersion has one: `jobs` churns on every download:progress tick, and a
// screen that only wants to know "did my tasks change on another device"
// must not re-render six times a second because something is downloading.
const SyncContext = createContext({
  tasksVersion: 0, notesVersion: 0, focusVersion: 0,
  pomodoroState: null, pomodoroDurations: null,
  // The timer as the user should SEE it (translated, minus a dismissed ended
  // card), and the one way to dismiss. Both the Turtle tab's card and the
  // app-level Live Activity driver read this, never the raw payload.
  pomodoroView: null, dismissEndedTimer: () => {},
  // The last task-linked focus push ({ payload, receivedAt }) — see the listener.
  focusPush: null,
});
export const useSyncSignals = () => useContext(SyncContext);

const pctOf = (j) =>
  typeof j.percent === 'number'
    ? j.percent
    : (j.total_bytes && j.downloaded_bytes != null)
      ? Math.min(100, Math.round((j.downloaded_bytes / j.total_bytes) * 100))
      : null;

export function DownloadsProvider({ children }) {
  const { serverIP, isConnected, api } = useServer();
  const { isAuthenticated, token, authIdentity, authGeneration } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [mediaVersion, setMediaVersion] = useState(0);
  // Cross-device sync. The three counters are "something changed over there, go
  // and read it"; the two pomodoro values are the payload itself, because the
  // shared timer's state IS small and complete (see utils/pomodoroState).
  const [tasksVersion, setTasksVersion] = useState(0);
  const [notesVersion, setNotesVersion] = useState(0);
  const [focusVersion, setFocusVersion] = useState(0);
  const [pomodoroState, setPomodoroState] = useState(null);
  const [pomodoroDurations, setPomodoroDurations] = useState(null);
  // The last `focus:changed` push, raw: { payload, receivedAt }.
  const [focusPush, setFocusPush] = useState(null);
  // Restored once from disk; a dismissal writes through. Until the read lands,
  // a replayed ended card may flash for a frame — the same race the hook had.
  const [dismissedEndedId, setDismissedEndedId] = useState(null);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(POMODORO_DISMISSED_KEY)
      .then((v) => { if (alive && v) setDismissedEndedId(v); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const socketRef = useRef(null);
  const authGenerationRef = useRef(authGeneration);
  authGenerationRef.current = authGeneration;

  const refresh = useCallback(async () => {
    const generation = authGeneration;
    if (!isAuthenticated || !generation) return;
    try {
      const r = await api.get('/downloads');
      if (authGenerationRef.current !== generation) return;
      if (r?.jobs) setJobs(r.jobs.map((j) => ({ ...j, percent: pctOf(j) })));
    } catch { /* offline / unauthorized */ }
  }, [api, authGeneration, isAuthenticated]);

  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => { if (isAuthenticated && isConnected) refresh(); }, [isAuthenticated, isConnected, refresh]);

  useEffect(() => {
    setJobs([]);
    // A different account's timer is not this account's: drop the last one and
    // wait for the new socket's connect replay rather than showing the previous
    // user's focus block for a frame.
    setPomodoroState(null);
    setPomodoroDurations(null);
    setFocusPush(null);
    if (!serverIP || !isAuthenticated || !token || !authGeneration) return undefined;
    const generation = authGeneration;
    const accountId = String(authIdentity || '').split(':').slice(1).join(':');
    const isCurrent = () => authGenerationRef.current === generation;
    const accepts = (payload) =>
      isCurrent() &&
      (!payload?.userId || !accountId || String(payload.userId) === accountId);
    const socket = io(serverOrigin(serverIP), {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5,
    });
    socketRef.current = socket;
    socket.on('connect', () => { if (isCurrent()) refreshRef.current(); });

    socket.on('download:job', (job) => {
      if (!accepts(job)) return;
      setJobs((prev) => {
        const i = prev.findIndex((j) => j.id === job.id);
        const merged = i === -1 ? { ...job } : { ...prev[i], ...job };
        merged.percent = pctOf(merged);
        if (i === -1) return [merged, ...prev];
        const next = prev.slice(); next[i] = merged; return next;
      });
    });
    socket.on('download:progress', (p) => {
      if (!accepts(p)) return;
      setJobs((prev) => prev.map((j) => {
        if (j.id !== p.id) return j;
        const m = {
          ...j,
          downloaded_bytes: p.downloaded ?? j.downloaded_bytes,
          total_bytes: p.total ?? j.total_bytes,
          // Byte-style events carry no percent — clear the stale one so pctOf
          // recomputes from fresh bytes (else the bar freezes at first value).
          percent: typeof p.percent === 'number' ? p.percent : null,
        };
        m.percent = pctOf(m);
        return m;
      }));
    });
    // Any vault change → let the gallery reload: additions (ghost download,
    // upload from another device, folder-watcher ingest), deletions, and
    // in-place updates (JIT compress, AI re-understanding). The payload is
    // deliberately empty (unauthenticated surface) — the reload goes through
    // the authenticated list endpoints.
    const bumpMedia = (payload) => {
      if (accepts(payload)) setMediaVersion((v) => v + 1);
    };
    socket.on('media:added', bumpMedia);
    socket.on('media:removed', bumpMedia);
    socket.on('media:updated', bumpMedia);

    // ── Cross-device sync ────────────────────────────────────────────────────
    // Tasks had NO realtime path at all on mobile, and no focus refetch either,
    // so a task added, ticked or deleted on the desktop stayed invisible here
    // for as long as the app ran. The ping carries nothing (it cannot go stale);
    // the counter is what the Tasks / Notes screens watch to re-read over HTTP.
    // The server pings the ACTOR too, which is harmless: the refetch those
    // screens run is throttled and coalescing, and it overlays any optimistic
    // write still in flight.
    socket.on('tasks:changed', (p) => { if (accepts(p)) setTasksVersion((v) => v + 1); });
    socket.on('notes:changed', (p) => { if (accepts(p)) setNotesVersion((v) => v + 1); });
    // A TASK-LINKED focus block lives in `task_pomodoros`, not in the pond's
    // in-memory timer, so starting one never reached another device — the only
    // surface that noticed was the tray HUD, because it polls.
    socket.on('pomodoro-task-changed', (p) => { if (accepts(p)) setFocusVersion((v) => v + 1); });
    // THE HEADLINE FIX. This listener used to exist only inside the Turtle tab,
    // which the lazy tab navigator does not mount until it is first opened — so
    // a focus block started anywhere else simply did not exist on the phone.
    // The raw server payload is kept, not a translated one: the ended-card
    // "already dismissed" memory is keyed on the SERVER stamps (see
    // utils/pomodoroState.endedIdentity), which a local translation destroys.
    socket.on('pomodoro-state', (data) => {
      if (!accepts(data)) return;
      setPomodoroState(data || null);
      // The pond's timer changing is also the moment /pomodoro/widget starts
      // answering something else, so the Focus page's figures follow it. Replayed
      // on every (re)connect, which is exactly when a screen should catch up.
      setFocusVersion((v) => v + 1);
    });
    socket.on('pomodoro-durations', (d) => {
      if (accepts(d) && typeof d?.focus === 'number' && typeof d?.break === 'number') {
        setPomodoroDurations({ focus: d.focus, break: d.break });
      }
    });
    // The TASK-LINKED block, WITH its state: the pond now sends the block it
    // holds (its own start stamp, planned end, titles) and serverNow, on every
    // start / stop / finish on any of this person's devices. The Focus page
    // applies it straight off (utils/pomodoroState.taskSessionFromPush), no
    // round trip; the payload-free ping above still bumps focusVersion, so the
    // re-read that follows confirms rather than discovers. Kept raw, with the
    // moment it arrived, so the same push is never applied twice.
    socket.on('focus:changed', (p) => {
      if (!accepts(p)) return;
      setFocusPush({ payload: p && typeof p === 'object' ? p : {}, receivedAt: Date.now() });
    });

    return () => { socket.removeAllListeners(); socket.disconnect(); socketRef.current = null; };
  }, [authGeneration, authIdentity, isAuthenticated, serverIP, token]);

  // Battery: drop the socket while backgrounded, reconnect on return (same
  // pattern as the Claude session socket). Only the stable 'background' /
  // 'active' states — 'inactive' (app-switcher peek) is ignored so a quick
  // peek doesn't churn the connection. On reconnect the 'connect' handler
  // already re-pulls /downloads; bump mediaVersion too so media added while
  // backgrounded triggers the gallery's windowed soft reload.
  useEffect(() => {
    let wasBackgrounded = false;
    const sub = AppState.addEventListener('change', (s) => {
      const sock = socketRef.current;
      if (!sock) return;
      if (s === 'background') {
        wasBackgrounded = true;
        sock.disconnect();
      } else if (s === 'active' && !sock.connected) {
        sock.connect();
        if (wasBackgrounded) {
          wasBackgrounded = false;
          setMediaVersion((v) => v + 1);
          // Same reason, for the sync pings: the socket was DOWN while
          // backgrounded and there is no replay for tasks:changed /
          // notes:changed — a change made on the desktop in that window is
          // simply gone. pomodoro-state IS replayed on connect, so it needs no
          // nudge. Bumping the counters makes coming back to the app a catch-up.
          setTasksVersion((v) => v + 1);
          setNotesVersion((v) => v + 1);
        }
      }
    });
    return () => sub?.remove();
  }, []);

  const control = useCallback(async (id, action) => {
    try { await api.post(`/downloads/${id}/${action}`, {}); await refresh(); } catch { /* ignore */ }
  }, [api, refresh]);
  const remove = useCallback(async (id) => {
    try { await api.delete(`/downloads/${id}`); } catch { /* ignore */ }
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, [api]);
  const enqueue = useCallback(async (url) => {
    try { await api.post('/downloads', { url }); await refresh(); } catch { /* ignore */ }
  }, [api, refresh]);

  const active = jobs.filter((j) => ['queued', 'downloading', 'ingesting'].includes(j.status)).length;

  const value = useMemo(
    () => ({ jobs, active, mediaVersion, control, remove, enqueue, refresh }),
    [jobs, active, mediaVersion, control, remove, enqueue, refresh],
  );
  const mediaValue = useMemo(() => ({ mediaVersion }), [mediaVersion]);
  // Dismiss the ended card currently on show. Remembering its identity is what
  // keeps the server's replay of it from bringing it back after a reload;
  // nothing to remember if what is showing is not an ended card.
  const pomodoroStateRef = useRef(pomodoroState);
  pomodoroStateRef.current = pomodoroState;
  const dismissEndedTimer = useCallback(() => {
    const id = endedIdentity(pomodoroStateRef.current);
    if (!id) return;
    setDismissedEndedId(id);
    AsyncStorage.setItem(POMODORO_DISMISSED_KEY, id).catch(() => {});
  }, []);
  const pomodoroView = useMemo(() => visibleTimer(pomodoroState, dismissedEndedId), [pomodoroState, dismissedEndedId]);
  const syncValue = useMemo(
    () => ({ tasksVersion, notesVersion, focusVersion, pomodoroState, pomodoroDurations, pomodoroView, dismissEndedTimer, focusPush }),
    [tasksVersion, notesVersion, focusVersion, pomodoroState, pomodoroDurations, pomodoroView, dismissEndedTimer, focusPush],
  );
  return (
    <DownloadsContext.Provider value={value}>
      <MediaVersionContext.Provider value={mediaValue}>
        <SyncContext.Provider value={syncValue}>{children}</SyncContext.Provider>
      </MediaVersionContext.Provider>
    </DownloadsContext.Provider>
  );
}
