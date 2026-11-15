/**
 * THE FOCUS PAGE'S SKIN — the one surface in the app that is neumorphic.
 *
 * `insetCardPalette` makes a DARK panel in both modes, because a task card is
 * a recess on a page it has to stand off (STYLE-RULES §1). Neumorphism is the
 * opposite claim: the panel IS the page, raised out of it by light alone, so
 * figure and ground must share a colour. That means this page needs a palette
 * of its own rather than an override of that one — and it is only this page.
 *
 * ── Light mode is cream, not charcoal ──────────────────────────────────────
 *
 * Mark, on the first build (2026-11-15): "in light mode I want the colour to
 * be a light cream colour matching the cream tint of the app". The first pass
 * took the card's charcoal for the ground, which made the focus page dark in
 * light mode — correct for the style and wrong for the app. So in light mode
 * the surface is the app's own cream and the INK FLIPS with it: dark type on
 * cream, the mirror of the dark mode's white on charcoal. A neumorphic
 * surface cannot keep its old ink, because the surface is what changed.
 *
 * ── Why these creams and not `background` ──────────────────────────────────
 *
 * `theme.colors.surface` (#EEECE9) is the app's cream and the obvious choice,
 * and it is what the ground uses. The TILE inside a panel goes a step deeper
 * rather than lighter: on a surface this pale the highlight is already at
 * white, so "deeper" is the only direction left that still reads as a
 * different plane.
 */

/** The app's cream, and the charcoal the dark mode already used. */
const LIGHT_BASE = '#EEECE9';
const DARK_BASE = '#241F1D';
/** The ink on cream: the same warm near-black the cards are made of. */
const LIGHT_INK = '#211C1B';

export function focusSkin(theme) {
  const dark = theme?.mode === 'dark';
  return dark
    ? {
      card: DARK_BASE,
      text: '#F2F2F4',
      sub: 'rgba(255,255,255,0.68)',
      muted: 'rgba(255,255,255,0.48)',
      track: 'rgba(255,255,255,0.14)',
      field: 'rgba(255,255,255,0.07)',
      control: 'rgba(255,255,255,0.22)',
      edge: 'rgba(255,255,255,0.04)',
      tile: '#302A28',
      onText: DARK_BASE,
    }
    : {
      card: LIGHT_BASE,
      // The mirror of the dark mode's ink, at the same weights — so a reading
      // that is quiet in one mode is quiet in the other.
      text: LIGHT_INK,
      sub: 'rgba(33,28,27,0.70)',
      muted: 'rgba(33,28,27,0.50)',
      track: 'rgba(33,28,27,0.13)',
      field: 'rgba(33,28,27,0.06)',
      control: 'rgba(33,28,27,0.22)',
      edge: 'rgba(33,28,27,0.06)',
      // DEEPER, not lighter: at this lightness the highlight is already white,
      // so down is the only direction that still reads as another plane.
      tile: '#E2DED6',
      onText: LIGHT_BASE,
    };
}

export default focusSkin;
