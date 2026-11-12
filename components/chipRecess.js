/**
 * THE ACTIVE CHIP'S RECESS — the two washes that make the dock's chip read as a
 * cell pressed INTO the capsule rather than a card sitting on top of it.
 *
 * The chip shipped with a drop shadow (0,+2, radius 6): the signature of an
 * object resting ON a surface, and it read exactly that way — a bevelled tile
 * protruding from the dock. A recess is the same physics run the other way, and
 * it is made of three things, not one:
 *
 *   SHADE  the inside of the well's TOP wall. It faces down and away from the
 *          light, so it is the darkest part of the whole dock. This is the cue
 *          that does the work — if only one of the three survives a retune,
 *          keep this one.
 *   SHEEN  the inside of the BOTTOM wall, which faces up into the light. Weaker
 *          than the shade deliberately: a well is mostly shadow, and matching
 *          the two just reads as a stripe top and bottom.
 *   the lip and the groove, which are hairlines and live in TabBarPill with the
 *          rest of the dock's palette.
 *
 * ── Why the ramps ease at BOTH ends ────────────────────────────────────────
 *
 * Same reason as the capsule's own wash (dockSurface): a straight ramp starts
 * and stops at full rate, so the eye finds the two places where it meets flat
 * colour and reads them as edges. The chip is 57pt and these bands are ~30pt of
 * it, which is small enough that one visible seam would be most of the effect.
 * A SMOOTHSTEP on the alpha has zero slope at both ends — the shade eases out of
 * the top edge and into the untouched middle, and neither junction is findable.
 *
 * ── Why the spans are fractions ────────────────────────────────────────────
 *
 * They are multiplied by whatever the chip's height is (PILL_SIZE), so the
 * recess stays the same SHAPE if the chip is ever resized — a fixed 30pt band
 * would turn into a half-filled chip the day the dock shrinks.
 */

/** The shadowed top wall: how black, and over what fraction of the chip. */
export const CHIP_SHADE = { r: 0, g: 0, b: 0, a: 0.38 };
export const CHIP_SHADE_SPAN = 0.5;

/**
 * The lit bottom wall — a TIGHT band, and that is the tuning that matters.
 * Rendered against the real capsule at 57pt, a sheen spread over the bottom
 * ~38% stopped reading as a wall and started reading as a lit bulge: a wide
 * soft highlight low down is what a dome does. Pulled in to a quarter of the
 * chip it goes back to being the floor of a cut catching the light.
 */
export const CHIP_SHEEN = { r: 255, g: 255, b: 255, a: 0.22 };
export const CHIP_SHEEN_SPAN = 0.26;

/** How many stops each ramp is sampled into. */
export const CHIP_RECESS_STEPS = 6;

/** Zero slope at both ends — the whole reason these are not two-stop ramps. */
const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * One wash, ready for expo-linear-gradient: `{ colors, locations }`, same
 * length, locations strictly increasing from 0 to 1.
 *
 * `fade` says which end is solid. 'out' holds the tint at location 0 and fades
 * to nothing at 1 (the shade, drawn from the top edge down); 'in' is the mirror
 * (the sheen, drawn from its own top down to the bottom edge). Both endpoints
 * are EXACT — sampling may round the middle, but a ramp that doesn't reach zero
 * leaves a visible line where the layer ends.
 */
export function chipRecessStops(tint, fade = 'out', steps = CHIP_RECESS_STEPS) {
  const n = Math.max(2, Math.round(Number(steps) || 0));
  const colors = [];
  const locations = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    // Eased position along the ramp, with the two ends pinned exactly.
    const e = i === 0 ? 0 : i === n - 1 ? 1 : smoothstep(t);
    const k = fade === 'in' ? e : 1 - e;
    const a = Math.round(tint.a * k * 1000) / 1000;
    colors.push(`rgba(${tint.r},${tint.g},${tint.b},${a})`);
    locations.push(t);
  }
  return { colors, locations };
}

/** The well's shadowed top wall. */
export const chipShadeStops = (steps) => chipRecessStops(CHIP_SHADE, 'out', steps);

/** The well's lit bottom wall. */
export const chipSheenStops = (steps) => chipRecessStops(CHIP_SHEEN, 'in', steps);

export default chipRecessStops;
