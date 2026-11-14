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
 *     middle (the "shade") and lit along its edge (the "rim"). It shipped for
 *     one build with a white bloom in the middle instead, which the owner sent
 *     straight back — a bright centre washes out the glyph sitting on it and
 *     makes the chip look domed rather than set in.
 */

import { hexToRgb } from '../utils/accentColor';

/** The spot's box. Wider than a tab slot's glyph, lower than the bar. */
export const SPOT_W = 72;
export const SPOT_H = 46;
/** Alpha at the spot's brightest point: bottom centre, right on the line. */
export const SPOT_PEAK = 0.5;
/** Alpha at the chip's darkest point: dead centre, under the glyph. */
export const SHADE_PEAK = 0.24;
/** The shade is always this. A coloured shadow is a stain. */
export const SHADE_COLOR = '#000000';
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
    shadeColor: SHADE_COLOR,
    shadePeak: SHADE_PEAK * strength,
    rimColor: rimColor(picked),
  };
}
