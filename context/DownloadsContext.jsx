/**
 * DownloadsContext (mobile) — a single app-level Socket.IO connection to watch
 * the server's ghost-download queue. The mobile app has no global socket (the
 * pomodoro/claude sockets live inside TurtleScreen), so this owns one, modeled
 * on usePomodoroSocket: connect on serverIP, subscribe, clean up on change.
 *
 * Server broadcasts (io.emit, no room):
 *   download:job       — a download_jobs row (media_id stripped server-side:
 *                        unauthenticated surface, and media ids are capabilities)
 *   download:progress  — { id, percent } (yt-dlp) OR { id, downloaded, total }
 *   media:added        — a media row landed → bump mediaVersion so the gallery
 *                        can live-refresh (downloads land in the vault).
 */
import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import { useServer, serverOrigin } from './ServerContext';
import { useAuth } from './AuthContext';

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
  return (
    <DownloadsContext.Provider value={value}>
      <MediaVersionContext.Provider value={mediaValue}>{children}</MediaVersionContext.Provider>
    </DownloadsContext.Provider>
  );
}
