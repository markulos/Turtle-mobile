/**
 * The dock capsule's FILL — the ghosted-black wash that sits over the blur.
 *
 * It was one flat colour (rgba(18,18,20,0.52)) and read as a slab: the capsule
 * is drawn as a piece of hardware floating over the page — a white bezel, a
 * superellipse, a shadow — and a flat face is the one part of that which does
 * not behave like an object. A surface in the world is lit from above, so the
 * wash now runs from a lifted top edge to a denser bottom one.
 *
 * ── What changes down the capsule ──────────────────────────────────────────
 *
 * Both the colour and the alpha, which is what makes a ~56pt band read as
 * depth rather than as a tint:
 *
 *   alpha  0.46 → 0.78  — the top lets more of the blurred page through, so it
 *                         catches whatever is behind the dock; the bottom shuts
 *                         it out and grounds the capsule.
 *   colour  #202024 → #040407 — and the dark end goes nearly to black, so the
 *                         contrast does not depend on opacity alone (over a
 *                         dark page the alphas have little to work with).
 *
 * The AVERAGE is a shade denser than the flat 0.52 it replaces, deliberately:
 * the old value was tuned so the capsule still reads BLACK rather than washed
 * grey over a light page, and a gradient that dropped below it at the top
 * would lose that.
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

/** The lit top edge, and the grounded bottom one. */
export const DOCK_SURFACE_TOP = { r: 32, g: 32, b: 36, a: 0.46 };
export const DOCK_SURFACE_BOTTOM = { r: 4, g: 4, b: 7, a: 0.78 };

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
