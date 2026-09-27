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
