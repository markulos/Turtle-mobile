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
 * How far the light is from the surface, and how soft — in points.
 *
 * ── Why these are small, and tied to the gap between panels ───────────────
 *
 * The shading describes AN EDGE, not a card floating over a page. That is the
 * whole claim of the style: the panel is the page, extruded, one continuous
 * material. So the shadow has to stay on the panel's own border.
 *
 * At 6/14 it did not. Its reach — offset plus blur — was 20pt against a 10pt
 * gap, so a panel's cast shadow crossed the gap entirely and landed on its
 * neighbour's highlight. What you got in between was a dark smudge belonging
 * to nothing, which is a thing a surface cannot do and an object hovering
 * above one can. Mark circled exactly that gap: "it doesn't make sense to
 * have a shadow there."
 *
 * So the rule, and `neumorph.test` holds it: REACH ≤ GAP. At 3 + 7 the
 * shading stops at the edge of the gutter and the panels still read as
 * raised — the illusion never needed the distance, only the direction.
 */
export const NEU_OFFSET = 3;
/** Soft, not sharp: a hard shadow is a drop shadow, which is the other style. */
export const NEU_BLUR = 7;
/**
 * The space between two neumorphic panels, which is what the reach above is
 * measured against. Kept here rather than in the page's styles so the two
 * cannot drift apart — a wider gap may take a longer shadow, a tighter one
 * may not.
 */
export const NEU_GAP = 10;
/**
 * The gutter above the FIRST panel on a page — twice the gap between two.
 *
 * A panel between two others has a neighbour's gutter above it and its own
 * below, so the space reads as even. The top one has only its own, against a
 * header that is a hard edge rather than another soft surface, so at NEU_GAP
 * it reads as jammed under the chrome with its highlight clipped by it. Mark
 * asked for the margin twice — on the focus timer and on the planner header —
 * which is the tell that one number belongs here rather than in each page.
 */
export const NEU_PAGE_TOP = NEU_GAP * 2;
/**
 * The gap between two SECTIONS, as opposed to two peers.
 *
 * Twice the gap between panels — the same number as the page's top gutter,
 * and the same reasoning: the eye reads a run of evenly spaced panels as one
 * group, so the only way to say "this is the subject and those are a
 * footnote to it" is to break the rhythm. Mark asked for it between the
 * focus timer and the stats below it (2026-11-16).
 *
 * A LARGER gap is always safe for the shading — the rule is reach ≤ gap, so
 * widening one can never put a shadow on a neighbour.
 */
export const NEU_SECTION_GAP = NEU_GAP * 2;

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

export default {
  neuRaised, neuPressed, neuTones,
  NEU_OFFSET, NEU_BLUR, NEU_GAP, NEU_PAGE_TOP, NEU_SECTION_GAP,
};
