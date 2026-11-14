/**
 * THE INDICATOR'S LIGHT, as numbers — one copy, read by the real dock
 * (TabBarPill) and by the live preview in Settings (DockLivePreview), so the
 * preview cannot drift from the thing it is previewing.
 *
 * Two different lights, because the two indicators are two different objects:
 *
 *   • the UNDERLINE gives light OFF: a pool of colour standing on the line and
 *     fading up over the glyph (the "spot");
 *   • the CHIP takes light IN: it is a piece of glass, so it is DARKER in the
 *     middle (the "shade") and lit along its edge (the "rim"). The shade is
 *     the chip's OWN colour, deeper — not black. It shipped for one build
 *     with a white bloom in the middle (washes out the glyph, reads as a
 *     dome) and for one with a black shade (greys the colour: a blue chip
 *     with a sooty middle is no longer the highlight colour). Both went
 *     straight back. A deeper tone of the same hue is what a thicker piece
 *     of the same glass looks like.
 */

import { hexToRgb } from '../utils/accentColor';

/** The spot's box. Wider than a tab slot's glyph, lower than the bar. */
export const SPOT_W = 72;
export const SPOT_H = 46;
/** Alpha at the spot's brightest point: bottom centre, right on the line. */
export const SPOT_PEAK = 0.5;
/**
 * Alpha at the chip's deepest point: dead centre, under the glyph. Much
 * higher than a black shade would want, because the colour laid down is
 * only a deeper tone of what is already there.
 */
export const SHADE_PEAK = 0.6;
/**
 * How deep that tone is: each channel of the chip's colour times this. Scaling
 * all three alike keeps the hue and the saturation and moves only the value,
 * which is the whole point — it stays the same colour.
 */
const SHADE_DEPTH = 0.42;
/** The rim when no glow colour has been picked: plain light. */
const RIM_PLAIN = 'rgba(255,255,255,0.26)';
/** A picked colour needs a little more weight than white to read as an edge. */
const RIM_PICKED_ALPHA = 0.4;

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The glow colour from Settings if it is one, else null ("follow the highlight"). */
export const pickedGlowColor = (value) => (HEX.test(value || '') ? value : null);

/** The glow strength from Settings: 0 is off, 1 as designed. Anything else is 1. */
export const glowStrength = (value) => (
  Number.isFinite(value) ? Math.max(0, Math.min(2, value)) : 1
);

const two = (n) => Math.round(n).toString(16).padStart(2, '0').toUpperCase();

/**
 * The colour of the chip's shade: the chip's own colour, deeper — or null for
 * a chip with nothing to deepen.
 *
 * A fully WHITE chip is the exception. White has no hue, so "the same colour
 * but darker" is grey, and a grey pool in the middle of a white chip is a
 * smudge, not depth. White stays clean and is carried by its rim alone.
 */
export function shadeColor(chip) {
  const rgb = hexToRgb(chip);
  if (!rgb) return null;
  if (rgb.r === 255 && rgb.g === 255 && rgb.b === 255) return null;
  return '#' + two(rgb.r * SHADE_DEPTH) + two(rgb.g * SHADE_DEPTH) + two(rgb.b * SHADE_DEPTH);
}

/** The colour of the chip's rim: the picked glow colour, or plain light. */
export function rimColor(picked) {
  const rgb = picked ? hexToRgb(picked) : null;
  return rgb ? `rgba(${rgb.r},${rgb.g},${rgb.b},${RIM_PICKED_ALPHA})` : RIM_PLAIN;
}

/**
 * Everything either drawer needs, from the two settings and the highlight
 * colour.
 */
export function dockLight({ glow, glowColor, accent }) {
  const strength = glowStrength(glow);
  const picked = pickedGlowColor(glowColor);
  return {
    strength,
    spotColor: picked || accent,
    spotPeak: SPOT_PEAK * strength,
    shadeColor: shadeColor(accent),
    shadePeak: SHADE_PEAK * strength,
    rimColor: rimColor(picked),
  };
}
