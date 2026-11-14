/**
 * THE INDICATOR'S LIGHT, as numbers — one copy, read by the real dock
 * (TabBarPill), by the live preview in the Navigation panel (DockLivePreview)
 * and by the Settings tiles (DockStylePicker), so none of the three can drift
 * from the thing it is previewing.
 *
 * The two indicators are two different objects and are lit differently:
 *
 *   • the UNDERLINE gives light OFF: a pool of colour standing on the line and
 *     fading up over the glyph (the "spot");
 *   • the CHIP takes light IN — but by being GLASS, not by being painted to
 *     look like it. It is simply the highlight colour, slightly transparent,
 *     over the capsule's blur.
 *
 * ── Why the chip has no inner light any more ────────────────────────────────
 *
 * It had two layers of painted-on depth: a "shade" (a radial of its own colour,
 * deeper, in the middle) and a "rim" (a lit 1pt edge). Mark, 2026-11-14:
 * "remove the inner glow of the chip and just make it a little transparent."
 *
 * He is right, and the file's own history says why: the middle of that chip
 * had already been tried as a white bloom (washed the glyph out, read as a
 * dome) and as a black shade (greyed the colour — a blue chip with a sooty
 * middle is no longer the highlight colour). The deeper-tone version was the
 * third attempt at faking, with a gradient, what a translucent fill over a
 * blur does for free and correctly: the real dock already HAS glass behind the
 * chip, so letting it through is not an effect, it is the actual thing.
 *
 * It also costs less. The shade was a per-chip SVG gradient sitting inside the
 * layer the chip travels as; an alpha on the fill is the same cached bitmap
 * with one fewer thing in it.
 *
 * CHIP_ALPHA is therefore the chip's whole material, and the GLOW setting now
 * reaches the underline's spot only — see the Glow row's blurb in
 * DockStylePicker, which says so.
 */

import { hexToRgb } from '../utils/accentColor';

/** The spot's box. Wider than a tab slot's glyph, lower than the bar. */
export const SPOT_W = 72;
export const SPOT_H = 46;
/** Alpha at the spot's brightest point: bottom centre, right on the line. */
export const SPOT_PEAK = 0.5;

/**
 * How solid the chip is. The whole of its material: the highlight colour at
 * this alpha, over the capsule's blur.
 *
 * Judged against what it has to keep doing. The chip is the one saturated
 * element on the bar and the thing the eye tracks as it slides, so it cannot
 * go far — much under about 0.8 and the inactive glyphs start competing with
 * it, and the colour itself washes toward the skin underneath. A tenth or so
 * of the page coming through is enough to read as glass and no more.
 */
export const CHIP_ALPHA = 0.88;

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The glow colour from Settings if it is one, else null ("follow the highlight"). */
export const pickedGlowColor = (value) => (HEX.test(value || '') ? value : null);

/** The glow strength from Settings: 0 is off, 1 as designed. Anything else is 1. */
export const glowStrength = (value) => (
  Number.isFinite(value) ? Math.max(0, Math.min(2, value)) : 1
);

/**
 * THE CHIP'S FILL: the highlight colour, let through a little.
 *
 * Returns the colour untouched if it cannot be read as a hex — a chip that
 * failed to tint would be worse than one that is not translucent, because the
 * bar would lose the only element that says which tab you are on.
 */
export function chipFill(accent) {
  const rgb = hexToRgb(accent);
  return rgb ? `rgba(${rgb.r},${rgb.g},${rgb.b},${CHIP_ALPHA})` : accent;
}

/**
 * Everything the three drawers need, from the two settings and the highlight
 * colour. The chip takes `chipFill` and nothing else; `strength` and the spot
 * belong to the underline.
 */
export function dockLight({ glow, glowColor, accent }) {
  const strength = glowStrength(glow);
  const picked = pickedGlowColor(glowColor);
  return {
    strength,
    spotColor: picked || accent,
    spotPeak: SPOT_PEAK * strength,
    chipFill: chipFill(accent),
  };
}
