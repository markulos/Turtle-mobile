/**
 * Colour maths for the CUSTOM highlight colour (Settings → Appearance).
 *
 * Pure and dependency-free — it is imported by both the picker and
 * ThemeContext, and ThemeContext reaches AsyncStorage at import time, so
 * anything shared has to live outside it or the native module gets dragged into
 * every test that only wanted to convert a colour.
 *
 * HSL, not HSV. The three numbers are the three words the sliders are labelled
 * with, and LIGHTNESS is the one someone reaching for "a lighter pink" is
 * actually after; on an HSV square the same move costs two axes at once.
 */

// Accepts '#abc', 'abc', '#AABBCC', with or without surrounding space — a hex
// arrives from a field someone typed into or pasted into, not from code.
const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** '#abc' / 'aabbcc' / ' #AABBCC ' → '#AABBCC'. null when it is not a colour. */
export function normalizeHex(input) {
  const m = HEX_RE.exec(String(input ?? '').trim());
  if (!m) return null;
  const body = m[1];
  const six = body.length === 3 ? body.replace(/./g, (c) => c + c) : body;
  return `#${six.toUpperCase()}`;
}

export const isHex = (input) => normalizeHex(input) !== null;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** '#RRGGBB' → { r, g, b } in 0–255. null when the input is not a colour. */
export function hexToRgb(input) {
  const hex = normalizeHex(input);
  if (!hex) return null;
  const int = parseInt(hex.slice(1), 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

/** '#RRGGBB' → { h: 0–360, s: 0–100, l: 0–100 }. null when not a colour. */
export function hexToHsl(input) {
  const rgb = hexToRgb(input);
  if (!rgb) return null;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    // The denominator vanishes at l = 0 and l = 1, but so does d — a black or
    // white pixel takes the grey branch above and never reaches this.
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** { h, s, l } → '#RRGGBB'. Hue wraps; saturation and lightness clamp. */
export function hslToHex({ h, s, l } = {}) {
  const H = (((Number(h) || 0) % 360) + 360) % 360;
  const S = clamp(Number(s) || 0, 0, 100) / 100;
  const L = clamp(Number(l) || 0, 0, 100) / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = L - c / 2;
  let rgb;
  if (H < 60) rgb = [c, x, 0];
  else if (H < 120) rgb = [x, c, 0];
  else if (H < 180) rgb = [0, c, x];
  else if (H < 240) rgb = [0, x, c];
  else if (H < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const byte = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${byte(rgb[0])}${byte(rgb[1])}${byte(rgb[2])}`;
}

/**
 * WCAG relative luminance, 0 (black) → 1 (white).
 *
 * Not the average of the channels: the eye reads green as far brighter than
 * blue, which is why a saturated yellow and a saturated blue of the "same"
 * lightness are nowhere near as legible as each other on a white page.
 */
export function luminance(input) {
  const rgb = hexToRgb(input);
  if (!rgb) return null;
  const ch = (v) => {
    const u = v / 255;
    return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(rgb.r) + 0.7152 * ch(rgb.g) + 0.0722 * ch(rgb.b);
}

/** WCAG contrast ratio between two colours: 1 (identical) → 21 (black/white). */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la == null || lb == null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// The two inks anything drawn ON a colour can use. The dark one is NOT pure
// black: against a mid-tone fill, black technically out-contrasts white (a
// violet at L≈0.2 scores 4.96 to white's 4.24) and would win every tie-break,
// putting black type on colours the eye expects white on. A near-black at
// L≈0.014 moves the crossover to where it belongs.
export const INK_LIGHT = '#FFFFFF';
export const INK_DARK = '#1F2024';

/**
 * The text colour to draw ON `input` — whichever of the two inks is actually
 * more readable against it.
 *
 * ONE definition for the whole app: the board palette established this (it is
 * what lets a board colour stay orange instead of being darkened until white
 * type fits), the highlight colour needs the same answer now that an accent can
 * be a pale pink as easily as a deep violet, and two copies of a contrast
 * threshold would drift. `screens/TasksScreen/utils/boardColors` re-exports this
 * one rather than keeping its own.
 *
 * White wins ties, and anything unparseable gets white — the old behaviour, and
 * the safer default over an unknown fill.
 */
export function inkOn(input) {
  const l = luminance(input);
  if (l == null) return INK_LIGHT;
  const onWhite = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / (luminance(INK_DARK) + 0.05);
  return onWhite >= onDark ? INK_LIGHT : INK_DARK;
}

/**
 * The line the picker shows under a colour that will be hard to read.
 *
 * A highlight colour is not decoration here: it draws LINK TEXT and active
 * chips (see ThemeContext), so a pale pink on the off-white light page is a
 * sentence you cannot read. Advisory, never a veto — the colour is the user's
 * call, and the app has plenty of places (rules, dots, fills) where a faint one
 * is exactly right. 3:1 is WCAG's floor for large text and for icon-only
 * controls, which is the least this colour ever has to carry.
 */
export const LEGIBLE_MIN = 3;

export function legibilityNote(color, background) {
  const ratio = contrastRatio(color, background);
  if (ratio == null || ratio >= LEGIBLE_MIN) return null;
  return 'Faint against this page — links and small labels in it will be hard to read.';
}
