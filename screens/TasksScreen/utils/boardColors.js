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
import { luminance } from '../../../utils/accentColor';

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
