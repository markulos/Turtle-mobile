/**
 * The question asked before a Claude session is stopped.
 *
 * Stopping is not a pause: the pond kills the CLI process, and the next
 * session starts from nothing — nothing it knew is carried over. The Stop
 * key is also the easiest thing in the console header to hit by mistake, a
 * finger's width from Pause and from the two icon keys beside it, and the
 * cost of that mistake is the whole session.
 *
 * So every stop of a LIVE session is asked about. There is no harmless case:
 * an idle session still holds its context, and that context is the thing
 * being thrown away.
 *
 * Not asked about: `/claude stop` typed in the chat (words are intent), and
 * the model picker's restart, which says it restarts the session on the card
 * where you pick the model.
 *
 * The web app asks the same question in the same words (web
 * src/components/claude/stopConfirm.ts); the only difference is the shape it
 * is poured into — an Alert here, an inline bar there.
 */

/** How long the session has been up, for the weight it adds to the question.
 *  Null under a minute — "running 0m" is noise, not information. */
export function runningFor(startedAt, now) {
  if (!startedAt || !Number.isFinite(startedAt)) return null;
  const mins = Math.floor((now - startedAt) / 60000);
  if (mins < 1) return null;
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * The Alert to put in front of someone before the session dies — { title,
 * body } — or null if there is no live session to stop.
 *
 * `busy` is a turn in flight, which is the costlier stop of the two: it ends
 * work that is part-way done, which may be a half-written file or a release
 * mid-publish, so it says so.
 */
export function stopPrompt({ active, busy, startedAt, now }) {
  if (!active) return null;
  const age = runningFor(startedAt, now);
  if (busy) {
    return {
      title: 'Claude is working — stop anyway?',
      body: `Stopping ends the turn it is part-way through${age ? `, ${age} into this session` : ''} — and the session with it. The next one starts from nothing.`,
    };
  }
  return {
    title: 'Stop this session?',
    body: `This ends the session${age ? ` running ${age}` : ''} and everything it is holding. The next one starts from nothing.`,
  };
}
