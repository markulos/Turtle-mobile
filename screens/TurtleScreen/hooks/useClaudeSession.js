import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import { serverOrigin } from '../../../context/ServerContext';

// Same room the rest of the turtle app uses, so the server streams Claude
// output back to this client. Single-user app → one shared session id.
const DEFAULT_SESSION_ID = 'turtle-default';

// A little ASCII flourish shown when a session boots, instead of a flat
// "Starting Claude…". Built programmatically (repeat + center-pad) so the
// box stays perfectly aligned regardless of hand-counting. Rendered in a
// horizontally-scrollable monospace line (kind: 'banner') so it never wraps.
const CLAUDE_BANNER = (() => {
  const W = 24;
  const bar = '═'.repeat(W);
  const center = (s) => {
    const total = Math.max(0, W - s.length);
    const left = Math.floor(total / 2);
    return ' '.repeat(left) + s + ' '.repeat(total - left);
  };
  return [
    '╔' + bar + '╗',
    '║' + center('C  L  A  U  D  E') + '║',
    '║' + center('turtle dev session') + '║',
    '╚' + bar + '╝',
    '🐢  awake — ready when you are',
  ].join('\n');
})();

// Condense a Claude tool_use input into a one-line label, e.g.
// Read({file_path}) → "src/app.js".
const summarizeToolInput = (input) => {
  if (!input || typeof input !== 'object') return '';
  const k = input.file_path || input.path || input.pattern || input.command
    || input.url || input.query || input.prompt || input.description;
  if (typeof k !== 'string') return '';
  return k.length > 60 ? `${k.slice(0, 57)}…` : k;
};

/**
 * useClaudeSession — drives a persistent Claude Code CLI session on the
 * server over socket.io AND owns the rendered transcript.
 *
 * Earlier the screen tried to fold streamed events into the chat's
 * `messages` array; live output didn't reliably appear. This hook instead
 * keeps its OWN `transcript` state, so a dedicated console panel can render
 * it directly (same reliable pattern as the pomodoro card). Each socket
 * event appends a typed line:
 *   { id, kind: 'user'|'assistant'|'tool'|'meta'|'log'|'login'|'result'|'error', text }
 *
 * Exposes: { active, busy, mode, transcript, start, send, stop, login,
 *            loginInput, loginStop, close, reset }
 *   mode = null | 'session' | 'login'  (drives panel visibility/behaviour)
 */
export function useClaudeSession(serverIP, token) {
  const [active, setActive] = useState(false); // CLI process running
  const [busy, setBusy] = useState(false);     // a turn is in flight
  // Live view ON/OFF. When OFF the session keeps running + buffering on the
  // server, but we stop receiving + rendering the per-chunk event firehose
  // (the thing that pegs the phone CPU at 100%). Resuming replays the buffer
  // so we catch up. liveRef mirrors it for the socket callbacks (no stale
  // closure, and so the resume's buffered replay isn't itself ignored).
  const [live, setLive] = useState(true);
  const liveRef = useRef(true);
  // Mirror of `active` for callbacks that must read it without a stale closure
  // (e.g. suspend-on-leave, which only fires when a session is actually live).
  const activeRef = useRef(false);
  activeRef.current = active;
  const [mode, setMode] = useState(null);      // null | 'session' | 'login'
  const [admin, setAdmin] = useState(false);   // full-access (--dangerously-skip-permissions)
  const [transcript, setTranscript] = useState([]);
  // Pending Approve/Deny cards. The server emits `claude:permission` for each
  // gated tool call (incl. ExitPlanMode plan approvals) and blocks until we
  // answer. Each item: { requestId, toolName, summary, input, cwd, timeoutMs }.
  const [permissions, setPermissions] = useState([]);
  // Pending AskUserQuestion cards. The server emits `claude:question` with the
  // tool's questions; the session blocks until we submit picks. Each item:
  // { requestId, questions, timeoutMs }.
  const [questions, setQuestions] = useState([]);
  // The server-side task queue (pending to-do tasks the session works through
  // one at a time). Mirrored here from `claude:queue` / the attach bundle so
  // the banner can show count + let the user clear it. Each item: { id, label }.
  const [queue, setQueue] = useState([]);
  // Recently FINISHED queued tasks, newest last. The server stamps each one's
  // finish time (`claude:queue-done`) and replays the list in the attach bundle
  // so the banner can show "✓ finished <label> at <time>" even after the queue
  // empties. Each item: { id, label, startedAt, finishedAt, durationMs }.
  const [completedQueue, setCompletedQueue] = useState([]);

  // Selected Claude model for new sessions (null = the CLI's configured
  // default). Set via the composer's long-press model picker. Kept in a ref too
  // so the start callbacks emit the latest pick without being re-created.
  const [model, setModelState] = useState(null);
  const modelRef = useRef(null);
  const setModel = useCallback((m) => {
    modelRef.current = m || null;
    setModelState(m || null);
  }, []);

  const socketRef = useRef(null);
  const tokenRef = useRef(token);
  const idRef = useRef(0);
  const loginRespondedRef = useRef(false); // did the server answer a login request?
  const bannerShownRef = useRef(false);    // banner shown once per session lifecycle
  const attachedRef = useRef(false);       // did we already replay a running session?

  useEffect(() => {
    tokenRef.current = token;
    // If the socket connected before the token was ready, re-attach now that
    // we can authenticate — otherwise a running session wouldn't be re-shown.
    if (token && socketRef.current?.connected) {
      socketRef.current.emit('claude:attach', { token });
    }
  }, [token]);

  const push = useCallback((line) => {
    setTranscript((prev) => [...prev, { id: `cl_${idRef.current++}`, ...line }]);
  }, []);

  // Show the ASCII boot banner exactly once per session start (reset when the
  // session ends), so restarting shows it again but a single start never
  // double-prints it.
  const showBannerOnce = useCallback(() => {
    if (bannerShownRef.current) return;
    bannerShownRef.current = true;
    push({ kind: 'banner', text: CLAUDE_BANNER });
  }, [push]);

  // Map one raw stream-json event → transcript line(s).
  const handleEvent = useCallback((evt) => {
    // Live view paused → ignore the firehose entirely (no setState, no
    // re-render). The server already skips us, but in-flight events (or an
    // older server) are dropped here too. The buffered replay on resume sets
    // liveRef=true first, so this guard never swallows the catch-up.
    if (!liveRef.current) return;
    if (!evt || !evt.type) return;
    // Synthetic user turn emitted by the server (queue-drained tasks, and
    // replayed turns on re-attach). Lets the console show the prompt that was
    // sent even though no one typed it on this device.
    if (evt.type === 'turtle_user') {
      if (evt.text?.trim()) { push({ kind: 'user', text: evt.text.trim() }); setBusy(true); }
      return;
    }
    if (evt.type === 'system') {
      if (evt.subtype === 'init') {
        push({ kind: 'meta', text: `${evt.model || 'claude'} · ${(evt.tools || []).length} tools ready` });
      } else if (evt.subtype === 'api_retry' && evt.attempt === 1) {
        // Only the first retry, so a hiccup doesn't flood the panel.
        push({ kind: 'error', text: `API ${evt.error_status || ''} ${evt.error || ''}`.trim() });
      }
      return;
    }
    if (evt.type === 'assistant') {
      // Skip the CLI's synthetic error echo — `result` already reports it.
      if (evt.message?.model === '<synthetic>' || evt.error) return;
      for (const block of evt.message?.content || []) {
        if (block.type === 'text' && block.text?.trim()) push({ kind: 'assistant', text: block.text.trim() });
        else if (block.type === 'tool_use') push({ kind: 'tool', text: `${block.name}(${summarizeToolInput(block.input)})` });
      }
      return;
    }
    if (evt.type === 'result') {
      setBusy(false);
      if (evt.is_error) {
        push({ kind: 'error', text: evt.result || 'Error' });
      } else {
        const secs = typeof evt.duration_ms === 'number' ? (evt.duration_ms / 1000).toFixed(1) : '?';
        const cost = typeof evt.total_cost_usd === 'number' && evt.total_cost_usd > 0 ? ` · $${evt.total_cost_usd.toFixed(4)}` : '';
        push({ kind: 'result', text: `done · ${secs}s${cost}` });
      }
      return;
    }
  }, [push]);

  useEffect(() => {
    if (!serverIP) return undefined;

    const socket = io(serverOrigin(serverIP), {
      query: { sessionId: DEFAULT_SESSION_ID },
      transports: ['websocket'],
      reconnection: true,
      // BATTERY: cap reconnect backoff at 30 s (default tops out at 5 s and
      // retries forever) so an unreachable server doesn't spin TLS handshakes
      // every few seconds. See usePomodoroSocket for the full rationale.
      reconnectionDelay: 2000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5,
      // Dedicated connection so this never tangles with the pomodoro socket.
      forceNew: true,
    });
    socketRef.current = socket;

    // On (re)connect, ask the server whether a session is already running so we
    // can re-attach and SHOW it (with its history) instead of a blank panel —
    // this is what makes a session survive the app being closed. Fires on the
    // initial connect and every reconnect; the attach handler de-dupes replay.
    socket.on('connect', () => {
      if (!tokenRef.current) return;
      socket.emit('claude:attach', { token: tokenRef.current });
      // A reconnected socket is a fresh server-side socket with no paused flag,
      // so re-assert the pause or it would start re-streaming the firehose.
      if (!liveRef.current) socket.emit('claude:pause', { token: tokenRef.current });
    });

    // The server's reply to claude:attach — the full state of the running
    // session: status + buffered transcript + pending prompt cards + queue.
    socket.on('claude:attached', (b) => {
      if (!b) return;
      // Queue can exist even with no live session (tasks queued, awaiting Start).
      setQueue(Array.isArray(b.queue) ? b.queue : []);
      setCompletedQueue(Array.isArray(b.completedQueue) ? b.completedQueue : []);
      if (!b.running) return;
      setActive(true);
      setAdmin(!!b.admin);
      setPermissions(Array.isArray(b.permissions) ? b.permissions : []);
      setQuestions(Array.isArray(b.questions) ? b.questions : []);
      // Live view paused/unloaded (e.g. user left the chat, or a reconnect
      // auto-attached while paused) → keep liveness + cards current but DON'T
      // load the transcript. It's retrieved on demand when the user resumes.
      if (!liveRef.current) { setBusy(!!b.busy); return; }
      // Already showing this session (a mere reconnect) → just refresh liveness.
      if (attachedRef.current) { setBusy(!!b.busy); return; }
      attachedRef.current = true;
      bannerShownRef.current = true; // don't paint the boot banner over real history
      setMode('session');            // reveal the console (parent mounts it on mode)
      setTranscript([]);
      push({ kind: 'meta', text: '↩ re-attached to the running session' });
      for (const evt of (Array.isArray(b.events) ? b.events : [])) handleEvent(evt);
      setBusy(!!b.busy);
    });

    // Live task-queue updates (enqueue/remove/clear/drain on the server).
    socket.on('claude:queue', (d) => { setQueue(Array.isArray(d?.queue) ? d.queue : []); });

    // A queued task just finished — append it (with its finish timestamp) to the
    // completed list so the banner can show "✓ finished <label> at <time>".
    socket.on('claude:queue-done', (d) => {
      if (!d || !d.id) return;
      setCompletedQueue((prev) => {
        const next = prev.filter((e) => e.id !== d.id); // de-dupe on retries
        next.push(d);
        return next.slice(-20); // mirror the server's cap
      });
    });

    socket.on('claude:status', (s) => {
      if (s?.running === true) { setActive(true); setAdmin(!!s.admin); }
      else if (s?.running === false) { setActive(false); setBusy(false); setAdmin(false); setPermissions([]); setQuestions([]); bannerShownRef.current = false; attachedRef.current = false; }
      if (s?.notLoggedIn) push({ kind: 'error', text: 'Not signed in. Type /claude login to use your subscription.' });
      else if (s?.error) push({ kind: 'error', text: s.error });
      else if (s?.running === true) push({ kind: 'meta', text: `session started · ${s.admin ? '⚡ ADMIN — full access' : (s.permissionMode || 'default') + ' mode'}` });
      else if (s?.running === false && !s?.stopped && typeof s?.code === 'number') push({ kind: 'meta', text: `session ended (exit ${s.code})` });
    });
    socket.on('claude:event', handleEvent);
    // Interactive approval cards. `claude:permission` parks a question; the
    // server blocks on it until we answer (claude:permission-answer) or it
    // times out. `claude:permission-resolved` fires on ANY resolution (our
    // tap, a timeout, or the session ending) so we always clear the card.
    socket.on('claude:permission', (p) => {
      if (!p?.requestId) return;
      setPermissions((prev) => (prev.some((x) => x.requestId === p.requestId) ? prev : [...prev, p]));
      push({ kind: 'meta', text: `⏸ approval needed · ${p.toolName || 'tool'}${p.summary ? `(${p.summary})` : ''}` });
    });
    socket.on('claude:permission-resolved', (p) => {
      if (!p?.requestId) return;
      setPermissions((prev) => prev.filter((x) => x.requestId !== p.requestId));
    });
    // AskUserQuestion option cards. Same park/resolve shape as permissions:
    // `claude:question` parks a card the session blocks on; `claude:question-
    // resolved` fires on ANY resolution (our submit, timeout, session end).
    socket.on('claude:question', (q) => {
      if (!q?.requestId || !Array.isArray(q.questions) || q.questions.length === 0) return;
      setQuestions((prev) => (prev.some((x) => x.requestId === q.requestId) ? prev : [...prev, q]));
      push({ kind: 'meta', text: `❓ Claude is asking ${q.questions.length === 1 ? 'a question' : `${q.questions.length} questions`}` });
    });
    socket.on('claude:question-resolved', (q) => {
      if (!q?.requestId) return;
      setQuestions((prev) => prev.filter((x) => x.requestId !== q.requestId));
    });
    socket.on('claude:log', (l) => { const t = (l?.text || '').trim(); if (t) push({ kind: 'log', text: t }); });
    socket.on('claude:auth', (a) => {
      if (a?.loggedIn === true) push({ kind: 'meta', text: `signed in as ${a.email || 'you'}${a.subscriptionType ? ` (${a.subscriptionType})` : ''} · subscription` });
    });
    socket.on('claude:login', (l) => { loginRespondedRef.current = true; const t = (l?.text || '').trim(); if (t) push({ kind: 'login', text: t }); });
    socket.on('claude:login-done', (d) => {
      loginRespondedRef.current = true;
      if (d?.ok) {
        push({ kind: 'result', text: `signed in as ${d.auth?.email || 'you'} — use /claude to chat` });
        setMode((m) => (m === 'login' ? null : m)); // success → close the login panel
      } else if (d?.cancelled) {
        push({ kind: 'meta', text: 'sign-in cancelled' });
        setMode((m) => (m === 'login' ? null : m));
      } else {
        // Keep the panel OPEN so the error stays visible (don't silently vanish).
        push({ kind: 'error', text: `sign-in didn't complete${d?.error ? `: ${d.error}` : ''}` });
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [serverIP, handleEvent, push]);

  // BATTERY: drop the Claude socket while the app is BACKGROUNDED and restore it
  // on return to the foreground. iOS suspends backgrounded JS anyway, so a live
  // socket there delivers nothing in real time — it only costs idle WebSocket
  // keepalive + reconnect churn (the heat the user reported). The foreground
  // "✓ finished" banner is preserved: reconnecting re-fires the `connect` handler
  // above → claude:attach → claude:attached replays the completedQueue, so a task
  // that finished while away still shows on return. This is the SAME
  // disconnect→reconnect→re-attach the hook already survives on any network blip
  // (reconnection:true) — just driven deliberately by app state. We act on the
  // STABLE 'background'/'active' states only; 'inactive' (app-switcher peek,
  // Control Center pull-down) is transient and ignored so a quick glance doesn't
  // churn the connection.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      const sock = socketRef.current;
      if (!sock) return;
      if (s === 'background') {
        sock.disconnect();                    // pause: closes the WS AND halts the reconnect loop
      } else if (s === 'active' && !sock.connected) {
        sock.connect();                       // resume; connect→claude:attach replays session + queue
      }
    });
    return () => sub?.remove();
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────
  // `modelOverride` lets a caller (e.g. the picker restarting a session) force
  // a model without waiting for the model state to settle; otherwise we use the
  // current pick from the ref.
  const start = useCallback((modelOverride) => {
    setMode('session');
    showBannerOnce();
    const m = modelOverride !== undefined ? (modelOverride || null) : modelRef.current;
    socketRef.current?.emit('claude:start', { token: tokenRef.current, model: m });
  }, [showBannerOnce]);

  // Full-access "admin" session — requires the admin password (verified
  // server-side on top of the JWT). Restarts the session in bypass mode.
  const startAdmin = useCallback((password, modelOverride) => {
    setMode('session');
    showBannerOnce();
    push({ kind: 'meta', text: '⚡ requesting full-access (admin) session…' });
    const m = modelOverride !== undefined ? (modelOverride || null) : modelRef.current;
    socketRef.current?.emit('claude:start-admin', { token: tokenRef.current, password, model: m });
  }, [push, showBannerOnce]);

  const send = useCallback((text, image) => {
    setMode('session');
    setBusy(true);
    push({ kind: 'user', text: image ? `🖼 ${text || 'image'}`.trim() : text });
    socketRef.current?.emit('claude:input', {
      token: tokenRef.current,
      text: text || '',
      // base64 image attachment → sent into the session as an image block.
      image: image && image.base64 ? { base64: image.base64, mediaType: image.mediaType || 'image/jpeg' } : undefined,
    });
  }, [push]);

  const stop = useCallback(() => {
    socketRef.current?.emit('claude:stop', { token: tokenRef.current });
    setMode(null);
    setBusy(false);
  }, []);

  const login = useCallback(() => {
    setMode('login');
    loginRespondedRef.current = false;
    push({ kind: 'user', text: '/claude login' });
    push({ kind: 'meta', text: 'requesting sign-in link…' });
    socketRef.current?.emit('claude:login', { token: tokenRef.current });
    // If the server never answers, it's almost certainly running older code
    // (restart it so it has the /claude socket handlers) or the app isn't
    // signed in. Surface that instead of an endless blank panel.
    setTimeout(() => {
      if (!loginRespondedRef.current) {
        push({ kind: 'error', text: 'No response from the server. Restart the server so it has the latest /claude code, and make sure you are signed in to the app.' });
      }
    }, 6000);
  }, [push]);

  const loginInput = useCallback((text) => {
    push({ kind: 'user', text: '••• code pasted' });
    socketRef.current?.emit('claude:login-input', { token: tokenRef.current, text });
  }, [push]);

  const loginStop = useCallback(() => {
    socketRef.current?.emit('claude:login-stop', { token: tokenRef.current });
    setMode(null);
  }, []);

  // Answer a pending approval card. `decision` is 'allow' | 'deny'; `reason`
  // is optional free-text feedback (e.g. "no — use the REST endpoint instead"
  // when declining a plan), surfaced back to Claude as the denial reason.
  const respondPermission = useCallback((requestId, decision, reason) => {
    const norm = decision === 'allow' ? 'allow' : 'deny';
    socketRef.current?.emit('claude:permission-answer', {
      token: tokenRef.current,
      requestId,
      decision: norm,
      reason: typeof reason === 'string' ? reason : '',
    });
    // Optimistically drop the card; the server's claude:permission-resolved
    // echo is idempotent against this.
    setPermissions((prev) => prev.filter((x) => x.requestId !== requestId));
    push({ kind: 'meta', text: `${norm === 'allow' ? '✓ approved' : '✗ denied'}${reason ? ` · ${reason}` : ''}` });
  }, [push]);

  // Submit answers to a pending AskUserQuestion card. `answers` is an array
  // aligned to the card's questions, each { selected: string[], other?: string }.
  const respondQuestion = useCallback((requestId, answers) => {
    socketRef.current?.emit('claude:question-answer', {
      token: tokenRef.current,
      requestId,
      answers: Array.isArray(answers) ? answers : [],
    });
    // Optimistically drop the card; the server's claude:question-resolved echo
    // is idempotent against this.
    setQuestions((prev) => prev.filter((x) => x.requestId !== requestId));
    const summary = (Array.isArray(answers) ? answers : [])
      .map((a) => [...(a?.selected || []), a?.other].filter(Boolean).join(', '))
      .filter(Boolean)
      .join(' · ');
    push({ kind: 'meta', text: `✓ answered${summary ? ` · ${summary}` : ''}` });
  }, [push]);

  // Task-queue controls (the queue lives server-side; these just drive it).
  const removeQueueItem = useCallback((id) => {
    socketRef.current?.emit('claude:queue-remove', { token: tokenRef.current, id });
    setQueue((prev) => prev.filter((x) => x.id !== id)); // optimistic
  }, []);
  const clearQueue = useCallback(() => {
    socketRef.current?.emit('claude:queue-clear', { token: tokenRef.current });
    setQueue([]); // optimistic
  }, []);

  // Hide the panel without killing the session (it keeps running server-side).
  const close = useCallback(() => { setMode(null); }, []);
  // Clear everything.
  const reset = useCallback(() => { setTranscript([]); setMode(null); setBusy(false); bannerShownRef.current = false; }, []);

  // Toggle the live view. PAUSE: tell the server to stop streaming the event
  // firehose to us (session keeps running + buffering). RESUME: clear the flag
  // and force a fresh replay of the server's buffered transcript so we catch up
  // to the live state (re-using the claude:attach path — hence resetting
  // attachedRef so the `claude:attached` handler rebuilds rather than no-ops).
  const setLiveView = useCallback((on) => {
    if (liveRef.current === on) return;
    liveRef.current = on;
    setLive(on);
    if (on) {
      attachedRef.current = false;
      socketRef.current?.emit('claude:resume', { token: tokenRef.current });
    } else {
      socketRef.current?.emit('claude:pause', { token: tokenRef.current });
    }
  }, []);
  const toggleLive = useCallback(() => setLiveView(!liveRef.current), [setLiveView]);

  // Suspend on LEAVING the chat: pause the stream AND unload the transcript
  // from the frontend (frees the rendered ScrollView + the transcript array) —
  // the session keeps running + buffering server-side, and the user retrieves
  // it on demand (tap Live) which rebuilds from the buffer. No-op when no
  // session is live. Does NOT auto-resume on return (retrieve-on-request).
  const suspend = useCallback(() => {
    if (!activeRef.current) return;        // no live session → nothing to suspend
    liveRef.current = false;
    setLive(false);
    attachedRef.current = false;   // so a later resume rebuilds from the buffer
    bannerShownRef.current = true;  // don't repaint the boot banner on resume
    setTranscript([]);              // unload the rendered transcript (idempotent)
    socketRef.current?.emit('claude:pause', { token: tokenRef.current });
  }, []);

  return { active, busy, live, toggleLive, suspend, mode, admin, model, setModel, transcript, permissions, respondPermission, questions, respondQuestion, queue, completedQueue, removeQueueItem, clearQueue, start, startAdmin, send, stop, login, loginInput, loginStop, close, reset };
}
