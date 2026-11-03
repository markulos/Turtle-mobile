/**
 * THE board palette — one list, read by everything that colours a board.
 *
 * It used to be two: the screen assigned boards from a 20-entry list by
 * position, and CalendarView hashed the board's NAME into a different
 * 10-entry list, so one board was two colours depending which page you were
 * on. Both now read this.
 *
 * These are proper, saturated colours — a board should be recognisable across
 * a month grid at a glance. Two failure modes bracket the choice, and both
 * have been shipped here:
 *
 *   • TOO HOT — the original list ended in the Material A400/A700 accents
 *     (#00E676, #76FF03, #FFEA00, #D500F9). A month of those reads as a tray
 *     of highlighters: they vibrate, they fight each other, and the brightest
 *     can't carry text of any colour.
 *   • TOO DUSTY — the first attempt at fixing that went to earthy mid-tones
 *     (S≈0.35–0.55 at low value). Easy on the eyes, but a board stopped being
 *     identifiable: clay, cocoa and terracotta are three names for brown.
 *
 * So the rule isn't "muted", it's: STRONG hue, MIDDLING brightness.
 *
 *   1. Chroma — saturation ≥ 0.45, so every entry is a colour rather than a
 *      tinted grey.
 *   2. Never glaring — relative luminance ≤ 0.5. This is the measure that
 *      actually separates orange (0.34) from highlighter yellow (0.86); it is
 *      about how much light the colour throws, not how saturated it is.
 *   3. Readable — each has an ink, white or near-black, at ≥ 4.5:1 (WCAG AA
 *      for body text). The calendar's day pills are 9pt solid fills, so this
 *      is the binding constraint: see `inkOn`, which picks per colour rather
 *      than assuming white. That is what lets orange and cyan stay bright
 *      instead of being darkened until they read as brown and navy.
 *   4. Distinct — ≥ 15 ΔE*ab between any two, and ≥ 30 between NEIGHBOURS,
 *      since boards take these in order and board 3 sitting next to board 4
 *      is the comparison people actually make. (Hence the interleaving: a
 *      hue-sorted list fails this.)
 *
 * `__tests__/boardColors.test.js` asserts all four, so a colour added here in
 * a hurry can't quietly break the set. Add to the END: the assignment is by
 * position, so inserting in the middle recolours everybody's boards.
 */
import {
  LEGIBLE_MIN, contrastRatio, hexToHsl, hslToHex, luminance, normalizeHex,
} from '../../../utils/accentColor';

export const BOARD_COLORS = [
  '#1976D2', // Blue
  '#BF4A1F', // Rust
  '#00796B', // Teal
  '#AD1457', // Magenta
  '#7CB342', // Leaf
  '#5E35B1', // Violet
  '#F57C00', // Orange
  '#2E7D32', // Green
  '#D81B60', // Pink
  '#00ACC1', // Cyan
  '#8E24AA', // Purple
  '#827717', // Olive
  '#3949AB', // Indigo
  '#D32F2F', // Red
];

/** The colour for the board at `index` in the board list; wraps. */
export const boardColorAt = (index) =>
  BOARD_COLORS[((index % BOARD_COLORS.length) + BOARD_COLORS.length) % BOARD_COLORS.length];

/** WCAG relative luminance. Exported so the palette's rules can be checked. */
export const luminanceOf = (hex) => luminance(hex) ?? 0;

/** How far one step moves the lightness, hunting for legibility. */
const L_STEP = 4;

/**
 * The board's colour as INK — written ON the page rather than filled with.
 *
 * Rule 3 above sizes every entry to CARRY text (`inkOn` picks white or
 * near-black to go on top of it). Being text is the opposite constraint, and
 * the palette fails it at both ends: Indigo on a dark page is 2.3:1, and Leaf
 * on the warm off-white is 2.2:1 — a board name nobody can read is worse than
 * one in the plain ink, because it still looks deliberate.
 *
 * So the HUE is kept and only the lightness moves, away from the page, until
 * the pair clears `min`. Keeping the hue is the whole point: this exists so a
 * board is recognisable as itself, and a legibility fix that turned Orange
 * into brown would be the "TOO DUSTY" failure above, arrived at from the other
 * side. The floor is the app's own (`LEGIBLE_MIN`, 3:1 — WCAG for large text),
 * not 4.5, for exactly that reason: 4.5 costs the bright half of the palette
 * its identity, and these are names set in a title, not body copy.
 *
 * A colour that already clears it comes back UNTOUCHED, so the common case
 * (most of the palette, on either page) is the palette itself.
 *
 * @param hex   the board's palette colour
 * @param page  the colour it will be written on — `pageColor(theme)`, not
 *              `theme.colors.background`, which is true black while the page
 *              is not
 * @returns a hex, or null when `hex` is not a colour (so a caller can fall
 *          back to its own ink rather than painting with "null")
 */
export function boardInkOn(hex, page, { min = LEGIBLE_MIN } = {}) {
  const base = normalizeHex(hex);
  if (!base) return null;
  const onto = normalizeHex(page);
  // Nothing to measure against: the palette colour is the honest answer.
  if (!onto) return base;
  if ((contrastRatio(base, onto) ?? 0) >= min) return base;
  const hsl = hexToHsl(base);
  if (!hsl) return base;
  // Lighter on a dark page, darker on a light one. Decided by the PAGE, so
  // one call is right in both modes.
  const lighten = (luminance(onto) ?? 0) < 0.5;
  let best = base;
  for (let l = hsl.l; l > 0 && l < 100;) {
    l = lighten ? Math.min(100, l + L_STEP) : Math.max(0, l - L_STEP);
    best = hslToHex({ ...hsl, l });
    if ((contrastRatio(best, onto) ?? 0) >= min) break;
  }
  return best;
}

/**
 * The text colour to draw ON `hex` — white for the deep half of the palette,
 * near-black for the bright half.
 *
 * Hardcoding white was what forced every previous palette to be dark: a
 * colour bright enough to be cheerful couldn't hold a white label, so it got
 * darkened until it wasn't cheerful any more. Choosing per colour means
 * orange and cyan can stay orange and cyan.
 *
 * THE IMPLEMENTATION MOVED to `utils/accentColor`, unchanged — the highlight
 * colour needs exactly this decision (an accent can be a pale pink as easily as
 * a deep violet) and a second copy of a contrast threshold in another file is a
 * drift waiting to happen. Still re-exported from here because the board palette
 * is where the rule is DOCUMENTED, and because this is the import every board
 * surface already reaches for.
 */
export { inkOn } from '../../../utils/accentColor';
