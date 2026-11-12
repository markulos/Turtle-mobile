/**
 * How far along "Finding the audio..." is.
 *
 * ── What is actually measurable, and what is not ────────────────────────
 * The wait before a web result plays has two halves, and only the second one
 * has a number in it:
 *
 *   1. RESOLVING. The pond is asking YouTube where the audio for this video
 *      is. There are no bytes, no total, and no fraction — it is one request
 *      that either comes back or does not. Measured on the R730: ~1-2s through
 *      the pond's long-lived resolver, ~3.6s when it falls back to spawning
 *      yt-dlp, and 0 when the row was already warmed.
 *
 *   2. BUFFERING. Bytes are arriving and the player is filling up before it
 *      starts. `useProgress().buffered` is a real measurement of this.
 *
 * So the first half is an ESTIMATE and the second half is a reading. Rather
 * than pretend otherwise, this is built so the estimate can never tell a lie
 * that matters:
 *
 *   • it eases toward RESOLVE_CEILING and never reaches it, so a resolve that
 *     is taking unusually long CRAWLS rather than sitting at a number or
 *     claiming to be nearly done;
 *   • crossing into the second half is a real event (the first byte), and it
 *     is where the number jumps - the jump IS the information;
 *   • 100 is never shown by this at all. The only thing that means "done" is
 *     sound, and when that happens the caller stops asking;
 *   • and past STALLED_AFTER_MS the number stops being the message. See below.
 *
 * ── Where this went wrong, and the rule that came out of it ─────────────
 * The first three bullets were all true and the screen still lied. A preview
 * that never produced a byte sat at 69% — the cap — for as long as you cared
 * to watch it, because the estimate had nowhere left to go and the measurement
 * had nothing to say. Reported from the pond on 2026-11-12: "it loads fast and
 * then slows down and gets stuck at 69%".
 *
 * A number that cannot change is not progress, it is a frozen clock, and the
 * one thing it reliably communicates is that the app has stopped noticing. So
 * the honest version has a third state: past STALLED_AFTER_MS with still no
 * audio in hand, the percentage stops being the message and the words say what
 * is actually known — this is taking longer than it should, and here is the
 * way out. The percentage is NOT shown in that state; there is nothing it
 * could add that "still nothing" does not already say better.
 *
 * ── Why these constants ─────────────────────────────────────────────────
 * RESOLVE_HALF_MS is the measured middle of a cold resolve, so the estimate
 * moves at roughly the rate the real thing does: ~35% at 1.5s, ~53% at 3s,
 * ~61% at 6s. BUFFER_TARGET_SEC is the audio a player wants in hand before it
 * will start, which is the one part of this that is a rule of thumb rather
 * than a measurement — three seconds is the usual order for both ExoPlayer and
 * AVPlayer, and being wrong about it only changes how fast the last third
 * moves, never whether it completes.
 */

/** Where the no-signal half tops out. It approaches this and never arrives. */
export const RESOLVE_CEILING = 70;

/** Time for the estimate to cover half the distance to the ceiling. */
export const RESOLVE_HALF_MS = 1500;

/** Audio in hand before a player will start, give or take. */
export const BUFFER_TARGET_SEC = 3;

/** The highest number this will ever report. See the header: 100 is sound. */
export const MAX_PERCENT = 99;

/**
 * Waiting this long with no audio at all stops being a wait and starts being a
 * problem worth offering a way out of.
 *
 * Twenty seconds is chosen against what the pond actually does, not picked for
 * roundness. A warmed row resolves in 0 ms and a cold one in 1-2s, so neither
 * gets near the ceiling; the slowest healthy path is the fallback to spawning
 * yt-dlp.exe at ~3.6s, which shows ~56%. Reaching 69 AT ALL already means
 * something unusual, and this leaves another eleven seconds on top of that
 * before changing the words.
 *
 * It is deliberately not the pond's own 25s request timeout. The point is to
 * speak BEFORE the thing gives up, while pressing it again is still the
 * cheapest fix available.
 */
export const STALLED_AFTER_MS = 20_000;

/**
 * The percentage to show, 0-99.
 *
 * `floor` is the last value shown and is what makes this monotonic: `buffered`
 * can legitimately go backwards (a seek re-bases it, a stall drops it), and a
 * progress number that goes down reads as something having gone wrong.
 */
export function preparingPercent({ elapsedMs = 0, bufferedAheadSec = 0, floor = 0 } = {}) {
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const ahead = Number.isFinite(bufferedAheadSec) && bufferedAheadSec > 0 ? bufferedAheadSec : 0;

  let percent;
  if (ahead > 0) {
    // Bytes are arriving: a real reading, from the ceiling upward. Rounded,
    // because it is a measurement and the nearest number is the truest one.
    const filled = Math.min(1, ahead / BUFFER_TARGET_SEC);
    percent = Math.round(RESOLVE_CEILING + (MAX_PERCENT - RESOLVE_CEILING) * filled);
  } else {
    // Nothing to measure yet. An eased clock, asymptotic to the ceiling —
    // FLOORED, not rounded, so it cannot round its way up to a ceiling it is
    // supposed to approach and never reach. An estimate may understate.
    //
    // And capped a point below it outright, rather than trusting the curve:
    // past about a minute `2 ** -n` is small enough that the multiplication
    // comes back as exactly the ceiling in float64, and "never reaches it"
    // should be a rule, not a happy accident of precision.
    percent = Math.min(
      RESOLVE_CEILING - 1,
      Math.floor(RESOLVE_CEILING * (1 - 2 ** (-elapsed / RESOLVE_HALF_MS))),
    );
  }

  const last = Number.isFinite(floor) && floor > 0 ? floor : 0;
  return Math.min(MAX_PERCENT, Math.max(last, percent));
}

/**
 * Whether this wait has stopped being one.
 *
 * Only ever true while there is NOTHING in hand: once a byte has arrived the
 * percentage is a measurement again and climbing, and a track that buffers
 * slowly is a different situation from one that never started. A mid-track
 * stall lands here too, which is correct — the audio stopped and tapping again
 * is still the way out of it.
 */
export function preparingStalled({ elapsedMs = 0, bufferedAheadSec = 0 } = {}) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < STALLED_AFTER_MS) return false;
  return !(Number.isFinite(bufferedAheadSec) && bufferedAheadSec > 0);
}

/**
 * What the wait says, in the one place that decides it.
 *
 * Two surfaces show the same wait at the same moment — the tapped row and the
 * transport bar above the dock — and each building its own sentence is how the
 * same wait ends up reading as two different numbers on one screen.
 *
 * The stalled sentence names the way out, because on both surfaces the control
 * is the thing you already tapped: the row re-previews, and the transport's
 * play key cancels and starts over. Neither grows a new button — what was
 * missing was never a control, it was anyone saying the control was there.
 */
export function preparingLabel(percent, { stalled = false } = {}) {
  if (stalled) return 'Still finding the audio - tap to try again';
  return `Finding the audio... ${Math.round(Number(percent) || 0)}%`;
}
