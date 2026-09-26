/**
 * Follow-along: which line of a transcript is being spoken right now.
 *
 * Pure arithmetic over a WhisperX result's `turns` (each `{ start, end, text,
 * speaker }`, in seconds, in order), so the rule can be checked without a
 * player, an audio file or a clock.
 *
 * ─── Why "the last line that has started" and not "the line containing t" ───
 *
 * A transcript is not a partition of the timeline: there are gaps between
 * turns — pauses, breaths, music, silence the model didn't transcribe. A
 * strict containment test un-highlights the transcript every time nobody is
 * talking, so the page flickers between lit and dark through an ordinary
 * conversation.
 *
 * So the ACTIVE line is the last one that has begun, and it stays lit through
 * the gap after it until the next one starts. `spoken` reports whether the
 * clock is actually inside that line's span, which is what lets the caller
 * draw the pause differently (a softer outline) without losing its place.
 */

/** Playback clocks jitter by a few ms; don't let that unhighlight a line. */
const EPSILON = 0.02;

const startOf = (turn) => {
  const n = Number(turn?.start);
  return Number.isFinite(n) ? n : 0;
};
const endOf = (turn) => {
  const n = Number(turn?.end);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Index of the line to highlight at `seconds`, or -1 before the first one
 * starts (a recording that opens with music, say).
 *
 * Binary search, not a scan: a two-hour interview is thousands of turns and
 * this runs on every position tick, on the JS thread, while audio plays.
 */
export function activeTurnIndex(turns, seconds) {
  if (!Array.isArray(turns) || turns.length === 0) return -1;
  const t = Number(seconds);
  if (!Number.isFinite(t)) return -1;
  if (t + EPSILON < startOf(turns[0])) return -1;

  let lo = 0;
  let hi = turns.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (startOf(turns[mid]) <= t + EPSILON) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * The full answer for one tick: which line, and whether it is actually being
 * spoken or merely the last thing said.
 */
export function followState(turns, seconds) {
  const index = activeTurnIndex(turns, seconds);
  if (index < 0) return { index: -1, spoken: false };
  const turn = turns[index];
  const end = endOf(turn);
  // A turn with no usable end (or an end at/before its start) counts as spoken
  // while it is the current one — better than reporting a permanent pause.
  const spoken = !(end > startOf(turn)) || Number(seconds) <= end + EPSILON;
  return { index, spoken };
}

/**
 * Where to seek when a line is tapped.
 *
 * A hair BEFORE the line's start, because seeking to exactly `start` lands
 * mid-syllable on most encoders — the word you tapped has already begun.
 */
export function seekTargetFor(turn, { lead = 0.15 } = {}) {
  return Math.max(0, startOf(turn) - lead);
}

/**
 * A one-line caption for a transport bar: what is being said right now.
 * Empty string before the first line, so the caller can render nothing rather
 * than an empty bubble.
 */
export function captionAt(turns, seconds) {
  const { index } = followState(turns, seconds);
  if (index < 0) return '';
  return String(turns[index]?.text || '').trim();
}
