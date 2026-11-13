/**
 * The dock capsule's FILL — the ghosted-black wash that sits over the blur.
 *
 * It was one flat colour (rgba(18,18,20,0.52)) and read as a slab, so it became
 * a gradient. The first gradient ran the WRONG WAY: lifted at the top edge,
 * densest at the bottom, which is a surface lit from above — and a surface lit
 * from above is a surface that BULGES TOWARD YOU. The capsule looked like a bar
 * of soap sitting on the page.
 *
 * The dock is meant to read as a channel cut INTO the page, not a lozenge
 * resting on it, so the wash is inverted: darkest along the top edge, easing to
 * its lightest at the bottom. That is a trough — the top wall of a groove faces
 * away from the light and the bottom wall faces into it. The lit hairline along
 * the bottom of the capsule (TabBarPill) is the other half of the same reading.
 *
 * ── What changes down the capsule ──────────────────────────────────────────
 *
 *   alpha  0.64 → 0.48  — denser at the top, letting more of the blurred page
 *                         through at the bottom. Both ends came down on
 *                         2026-11-13; see the note on the constants.
 *   colour  #060609 → #1A1A1E — near-black at the top edge, lifting to a dark
 *                         charcoal rather than to a grey. Inverting the ramp
 *                         put the LIGHT end at the bottom, where the old design
 *                         had its anchor, so both ends had to come down in
 *                         value or the capsule would read as a grey trough on a
 *                         white page instead of a black one.
 *
 * ── Half the contrast it used to have ──────────────────────────────────────
 *
 * The spread was 0.32 of alpha across 28 points of value, and at 69pt tall that
 * was a visible light-to-dark sweep — the gradient had become a feature of the
 * dock rather than a property of its surface. It is now 0.16 across 20 points:
 * enough to tell you which way the light is coming from, not enough to look at.
 * Depth should be something you notice only when it is wrong.
 *
 * ── Why the stops are computed ─────────────────────────────────────────────
 *
 * A two-stop ramp is mathematically smooth and still reads as a band, because
 * it starts and stops at full rate: the eye finds the two ends, where the ramp
 * meets the flat edge of the capsule, and that is the thing that looks like a
 * seam. These stops follow a SMOOTHSTEP instead — zero rate of change at both
 * ends, steepest in the middle — so the wash eases out of the top edge and
 * into the bottom one and there is no line anywhere to find.
 *
 * Seven stops is enough for the curve to read as a curve at this size; the
 * renderer interpolates linearly between them, and past ~7 the difference is
 * below a quantisation step on an 8-bit channel.
 */

/**
 * The shadowed top edge of the channel, and its lit floor.
 *
 * ── Sheer, as of 2026-11-13 ────────────────────────────────────────────────
 *
 * These ran 0.80 → 0.66, which is a dark bar with a blur behind it doing
 * nothing you could see. The ask was a backdrop you can see THROUGH: the page
 * moving under the dock rather than stopping at it. Down to 0.64 → 0.48, the
 * same shape at about three quarters of the ink.
 *
 * The floor is legibility, and it is not the dark page — it is a WHITE one,
 * where the wash has least to work with and the glyphs sit on whatever the
 * page happens to be. Rendered against a white page, a dark page and a busy
 * photo at four strengths before picking: one step further (0.56 → 0.40)
 * still looked fine on black and lost the unselected glyphs over a photo.
 * dockSkins' own suite now composites each skin over both extremes and fails
 * if the ink stops clearing its surface, so the next person tuning this gets
 * told rather than shipping it.
 */
export const DOCK_SURFACE_TOP = { r: 6, g: 6, b: 9, a: 0.64 };
export const DOCK_SURFACE_BOTTOM = { r: 26, g: 26, b: 30, a: 0.48 };

/** How many stops the ramp is sampled into. */
export const DOCK_SURFACE_STEPS = 7;

/** Zero slope at both ends — the whole reason this is not a two-stop gradient. */
const smoothstep = (t) => t * t * (3 - 2 * t);

const mix = (a, b, t) => a + (b - a) * t;

/**
 * The capsule's wash, ready for expo-linear-gradient: `{ colors, locations }`,
 * same length, locations strictly increasing from 0 to 1 (LinearGradient is
 * entitled to misbehave otherwise).
 *
 * Endpoints are EXACT — sampling can round the middle however it likes, but
 * the top of the capsule must be the top colour and the bottom the bottom one,
 * or the two ends of the ramp drift as the step count is tuned.
 */
export function dockSurfaceStops(steps = DOCK_SURFACE_STEPS) {
  const n = Math.max(2, Math.round(Number(steps) || 0));
  const colors = [];
  const locations = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const e = i === 0 ? 0 : i === n - 1 ? 1 : smoothstep(t);
    const r = Math.round(mix(DOCK_SURFACE_TOP.r, DOCK_SURFACE_BOTTOM.r, e));
    const g = Math.round(mix(DOCK_SURFACE_TOP.g, DOCK_SURFACE_BOTTOM.g, e));
    const b = Math.round(mix(DOCK_SURFACE_TOP.b, DOCK_SURFACE_BOTTOM.b, e));
    const a = Math.round(mix(DOCK_SURFACE_TOP.a, DOCK_SURFACE_BOTTOM.a, e) * 1000) / 1000;
    colors.push(`rgba(${r},${g},${b},${a})`);
    locations.push(t);
  }
  return { colors, locations };
}

export default dockSurfaceStops;
