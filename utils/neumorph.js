/**
 * NEUMORPHISM — depth with no edges.
 *
 * Mark asked for the style off a reference sheet (2026-11-15): "soft light ×
 * shadow × depth", monochromatic, elements that appear to RAISE UP or PRESS
 * DOWN out of the surface they are on.
 *
 * The whole idea is one rule: **an element is the SAME COLOUR as its
 * background**, and the only thing that separates them is a light source. A
 * highlight on the side the light comes from, a shadow on the side it does
 * not, and the eye reads a bump. Reverse the two and it reads as a dent.
 * There is no fill change, no border, and no tint — if you can see an edge,
 * it is not this style.
 *
 * ── Why this needs two shadows, and how it gets them ───────────────────────
 *
 * `shadowColor`/`shadowOffset` is ONE shadow per view, which is why every
 * previous attempt at this in React Native is a stack of nested wrappers.
 * RN 0.81 on the New Architecture takes a `boxShadow` LIST instead, with real
 * `inset` support (React/Fabric/Utils/RCTBoxShadow.mm), so a raised surface
 * and a pressed one are each one view and one style.
 *
 * If a build ever runs this on the old architecture the shadows simply do not
 * draw — the panel is flat, not broken. That is the right failure: the style
 * is decoration over a surface that still has its own colour and its text.
 *
 * ── Why the shadows are derived, not picked ────────────────────────────────
 *
 * Monochromatic is the second half of the reference. Both shadows come off
 * the surface's OWN colour — a darker version of it below right, a lighter
 * version above left — so the style follows the page into dark mode and
 * follows the user's theme without a second palette to keep in step. A
 * neutral grey shadow under a warm charcoal panel is the thing that makes
 * this look cheap.
 *
 * ── Why it is not the app's default depth ──────────────────────────────────
 *
 * `surfaceDepth.depth()` is the app's ordinary lift: a card ON a page, with
 * the two reading as different planes. This is the opposite claim — one
 * plane, deformed. They do not mix, so a surface takes one or the other, and
 * the page under a neumorphic panel has to be the panel's own colour or the
 * illusion collapses (see `neuPage`).
 *
 * ── The honest caveat, written down where it will be read ──────────────────
 *
 * This style is famously bad for contrast: its own reference sheet lists
 * "MINIMAL UI" as a principle and shows controls you cannot find. Nothing
 * here touches TEXT colour or a control's own fill — STYLE-RULES §1 still
 * governs those, and a neumorphic panel keeps the ink it had.
 */

import { hexToHsl, hslToHex, normalizeHex } from './accentColor';

/**
 * How far the light is from the surface, in points. The reference's cards sit
 * at roughly this against their own size: big enough to read as a bump at
 * arm's length, small enough that the panel does not look like it is hovering.
 */
export const NEU_OFFSET = 6;
/** Soft, not sharp: a hard shadow is a drop shadow, which is the other style. */
export const NEU_BLUR = 14;

/**
 * How far the two tones move from the surface, in HSL lightness points.
 *
 * Not symmetric. A shadow has to travel further than a highlight to read as
 * equally strong, because the eye is more forgiving of darkening — and on a
 * dark surface there is far more room below than above, which is why these
 * are chosen per mode rather than shared.
 */
const TONES = {
  light: { down: 9, up: 7 },
  // A charcoal panel can barely go lighter before it looks lit from inside,
  // and can go a long way darker before it hits the page.
  dark: { down: 7, up: 9 },
};

/** The same colour, moved `points` of HSL lightness. Hue and saturation hold. */
function shift(base, points) {
  const hsl = hexToHsl(base);
  if (!hsl) return null;
  return hslToHex({ ...hsl, l: Math.max(0, Math.min(100, hsl.l + points)) });
}

/**
 * The two tones a surface casts: `lit` above-left, `cast` below-right.
 *
 * Exported because the pressed state needs them the other way round and the
 * tests need to assert they came from the surface rather than from a swatch.
 */
export function neuTones(surface, mode) {
  const base = normalizeHex(surface);
  if (!base) return null;
  const t = TONES[mode === 'dark' ? 'dark' : 'light'];
  const lit = shift(base, t.up);
  const cast = shift(base, -t.down);
  return lit && cast ? { base, lit, cast } : null;
}

/**
 * A surface that stands OUT of the page: light above-left, shadow below-right.
 *
 * Returns the background too, because the whole style depends on it being the
 * page's colour — handing back only the shadows is how a caller ends up with
 * a tinted card wearing neumorphic light, which reads as neither.
 */
export function neuRaised(surface, mode, { offset = NEU_OFFSET, blur = NEU_BLUR } = {}) {
  const t = neuTones(surface, mode);
  if (!t) return { backgroundColor: surface };
  return {
    backgroundColor: t.base,
    boxShadow: [
      { offsetX: offset, offsetY: offset, blurRadius: blur, color: t.cast },
      { offsetX: -offset, offsetY: -offset, blurRadius: blur, color: t.lit },
    ],
  };
}

/**
 * A surface PRESSED into the page — the same two tones, inside and swapped.
 *
 * The swap is the whole trick: shadow where the light was, light where the
 * shadow was, and the identical bump reads as a dent. It is what the
 * reference means by "raised & pressed", and it is the state a track, a well
 * or a held control wants.
 */
export function neuPressed(surface, mode, { offset = NEU_OFFSET, blur = NEU_BLUR } = {}) {
  const t = neuTones(surface, mode);
  if (!t) return { backgroundColor: surface };
  return {
    backgroundColor: t.base,
    boxShadow: [
      { offsetX: offset, offsetY: offset, blurRadius: blur, color: t.lit, inset: true },
      { offsetX: -offset, offsetY: -offset, blurRadius: blur, color: t.cast, inset: true },
    ],
  };
}

export default { neuRaised, neuPressed, neuTones, NEU_OFFSET, NEU_BLUR };
