/**
 * The two pure rules for reading a `pomodoro-state` payload off the socket.
 *
 * They used to be private to `screens/TurtleScreen/hooks/usePomodoroSocket` —
 * fine while that hook was the only listener. It no longer is: the app-level
 * socket in `context/DownloadsContext` now holds the listener (the tab
 * navigator is LAZY, so a hook inside the Turtle tab hears nothing until the
 * tab is first opened, and a focus block started on the desktop was invisible
 * on the phone until then). With the payload shared app-wide, "how a server
 * stamp becomes a client stamp" stops being one screen's private detail: every
 * reader has to apply the SAME skew correction or two surfaces will draw the
 * same timer ending at different moments.
 */

/**
 * The identity of an ENDED card, for the "already dismissed" memory.
 *
 * Deliberately the SERVER-clock stamps: the server replays its last ended state
 * to every socket on connect, so without this the dismissed card comes back
 * after every reload. Our skew-corrected local copies shift by a few ms between
 * runs and would never match twice; the server's do not. A genuinely new
 * completion has new stamps, so it is never mistaken for the dismissed one.
 */
export const endedIdentity = (data) =>
  data && (data.status === 'completed' || data.status === 'stopped')
    ? `${data.mode}:${data.startedAt}:${data.endedAt}`
    : null;

/**
 * Translate a server-clock state payload into client-clock timestamps,
 * applying a one-shot clock-skew correction from `serverNow`. Done once
 * per state event — no recurring re-anchoring per tick (which is what
 * caused the previous design to thrash effects every second).
 */
export function translateServerState(data) {
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

/**
 * The timer AS THE USER SHOULD SEE IT: the translated payload, unless it is an
 * ended card the user already dismissed, in which case nothing. The server
 * replays its last ended state to every socket on connect, so without this the
 * card (and the lock-screen activity that follows it) comes back after every
 * reload. One derivation, shared by the Turtle tab's card and the app-level
 * Live Activity driver, so dismissing the card is also what clears the island.
 */
export function visibleTimer(data, dismissedEndedId) {
  const id = endedIdentity(data);
  if (id && dismissedEndedId && id === dismissedEndedId) return null;
  return translateServerState(data);
}

/** An ended block counts as "just now" for this long — a warm reconnect after
 *  backgrounding replays a stale completion, and a stale one must not re-fire. */
export const ENDED_FRESH_MS = 120000;

/**
 * What the iOS Live Activity should be doing for this timer view, given what it
 * was doing for the previous one. `prevStatus` is the last status this driver
 * SAW — the driver's own memory, not the server's idea, because "a real
 * completion transition" means one it witnessed running.
 *
 *   'running'    a live countdown to endsAt
 *   'completed'  the persistent "done" card
 *   'clear'      nothing — idle, manually stopped, or a stale replay
 */
export function liveActivityAction(prevStatus, view, now = Date.now()) {
  const status = view?.status || 'idle';
  if (status === 'active') return 'running';
  if (status === 'completed') {
    const fresh = typeof view.endedAt === 'number' && now - view.endedAt < ENDED_FRESH_MS;
    return (prevStatus === 'active' || fresh) ? 'completed' : 'clear';
  }
  return 'clear';
}

/**
 * Confetti and "+25 pts" fire ONLY for a real, recent, witnessed FOCUS
 * completion: the driver saw it running, it ended within the freshness window,
 * and it was not a break (breaks earn nothing). A cold replay of an hours-old
 * completion on app open must not shower confetti.
 */
export function shouldCelebrate(prevStatus, view, now = Date.now()) {
  const status = view?.status || 'idle';
  if (status !== 'completed' || prevStatus !== 'active') return false;
  if (view?.mode === 'break') return false;
  const fresh = typeof view?.endedAt !== 'number' || (now - view.endedAt < ENDED_FRESH_MS);
  return fresh;
}

/**
 * A server stamp moved onto this device's clock. `serverNow` is the server's
 * clock at the moment it answered (or pushed); the difference from our clock,
 * measured on that very message, is the skew. No serverNow → trusted as is.
 * The same rule translateServerState applies to the pond's own timer, made
 * available to the TASK-LINKED block, whose reads never carried serverNow
 * until the pond started sending it.
 */
export function alignedStamp(stamp, serverNow, now = Date.now()) {
  const skew = typeof serverNow === 'number' && Number.isFinite(serverNow) ? now - serverNow : 0;
  return stamp + skew;
}

/**
 * Read a `focus:changed` push into what the Focus page's ring should show.
 * The server sends the block it holds (the /pomodoros/active shape plus
 * endsAt) and serverNow; the result is the TasksScreen `activePomo` shape
 * on this device's clock.
 *
 *   { action: 'resync' }         the server could not say (no `session`) → re-read
 *   { action: 'clear' }          nothing running, or a finished / elapsed block
 *   { action: 'set', session }   a live block
 */
export function taskSessionFromPush(payload, now = Date.now()) {
  if (!payload || typeof payload !== 'object') return { action: 'resync' };
  if (!('session' in payload) || payload.session === undefined) return { action: 'resync' };
  const s = payload.session;
  if (s === null) return { action: 'clear' };
  const mins = Number(s?.durationMinutes);
  if (
    typeof s !== 'object'
    || typeof s.taskId !== 'string' || !s.taskId
    || typeof s.startedAt !== 'number' || !Number.isFinite(s.startedAt)
    || !Number.isFinite(mins) || mins <= 0
  ) {
    return { action: 'resync' };
  }
  if (s.status && s.status !== 'in_progress') return { action: 'clear' };
  const startedAt = alignedStamp(s.startedAt, payload.serverNow, now);
  const endsAt = startedAt + mins * 60000;
  if (now >= endsAt) return { action: 'clear' };
  return {
    action: 'set',
    session: {
      id: s.id ?? null,
      taskId: s.taskId,
      mode: 'focus',
      startedAt,
      endsAt,
      durationMinutes: mins,
      taskTitle: s.taskTitle ?? null,
    },
  };
}
