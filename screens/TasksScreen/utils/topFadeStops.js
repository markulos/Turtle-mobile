/**
 * topFadeStops — the gradient over the empty margin above the month grid.
 *
 * This strip has to do two things that pull against each other, which is why it
 * is worth computing rather than hand-writing stops:
 *
 *  1. Be CLEAR at the top, so the page's own backdrop reaches the header
 *     instead of dying under a solid block.
 *  2. Be FULLY OPAQUE at the month list's top edge, because that edge is a hard
 *     overflow clip. Anything less and a month scrolled up is sliced through
 *     the middle of its glyphs — the page colour has to be at full strength
 *     exactly where the cut happens, or the cut is simply visible through a
 *     half-transparent wash.
 *
 * So the ramp climbs across the margin and then dissolves back out over a short
 * `feather` INTO the month page. The feather is what makes the clip read as a
 * dissolve; it is kept short deliberately, so it lands on the month title's
 * empty leading and never on the title's text.
 *
 * Returns `{ locations, alphas }` — same length, both strictly increasing in
 * position, ready to hand to expo-linear-gradient.
 */

/** How much of the MARGIN stays completely clear, measured from the header. */
export const CLEAR_RUN = 1 / 3;

export function topFadeStops(inset, feather, clearRun = CLEAR_RUN) {
  const margin = Math.max(0, Number(inset) || 0);
  const tail = Math.max(0, Number(feather) || 0);
  const total = margin + tail;

  // Nothing to cover. A caller with no margin should not draw this at all, but
  // returning a valid degenerate gradient beats returning something that makes
  // LinearGradient throw.
  if (total <= 0) return { locations: [0, 1], alphas: [0, 0] };

  // Where the clip lives, as a fraction of the whole band.
  const edge = margin / total;

  // The clear run is a fraction of the MARGIN, not of the band — the feather
  // below the edge is not the header's business and must not shrink it.
  let clearEnd = (margin * clamp01(clearRun)) / total;

  // On a short margin the clear run can reach the edge, which would demand a
  // vertical jump from 0 to 1 and draw as a hard line of its own. Always leave
  // the ramp some room to climb in.
  const MIN_RAMP = 0.12;
  if (edge - clearEnd < MIN_RAMP) clearEnd = Math.max(0, edge - MIN_RAMP);

  // No feather (or none left after rounding): the band simply ends opaque at
  // the clip. Still correct — just abrupt below, which is the caller's choice.
  if (edge >= 1) return { locations: [0, clearEnd, 1], alphas: [0, 0, 1] };

  return {
    locations: [0, clearEnd, edge, 1],
    alphas: [0, 0, 1, 0],
  };
}

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

export default topFadeStops;
