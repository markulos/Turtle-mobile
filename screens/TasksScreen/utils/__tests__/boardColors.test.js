/**
 * The board palette is bracketed by two failure modes, both of which have
 * shipped: highlighter accents that vibrate and can't hold text, and earthy
 * mid-tones so close together that three boards all read as "brown".
 *
 * The rules that thread between them — chroma, luminance, an ink that works,
 * and separation from the neighbours — are asserted as PROPERTIES rather than
 * as hex values, so adding a colour tells you whether it belongs.
 */
import { BOARD_COLORS, boardColorAt, boardInkOn, inkOn, luminanceOf } from '../boardColors';

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const linear = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Hue in degrees, for asserting that a legibility fix did not change the colour. */
const hue = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
};

const hsv = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return { s: max ? (max - min) / max : 0, v: max };
};

// CIE L*a*b*, so "different enough" is measured the way an eye judges it and
// not as RGB distance (which calls navy and black neighbours).
const lab = (hex) => {
  const [r, g, b] = rgb(hex).map(linear);
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

describe('BOARD_COLORS', () => {
  test('every colour is a plain 6-digit hex (mixHex reads nothing else)', () => {
    for (const c of BOARD_COLORS) expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  test('every colour can carry text — in ONE of the two inks, at AA', () => {
    // The pills are 9pt, so body-text contrast (4.5:1) is the bar. Note this
    // is not "white works": inkOn picks, which is what lets the palette keep
    // colours too bright for a white label.
    for (const c of BOARD_COLORS) {
      expect(contrast(c, inkOn(c))).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('nothing glaring: luminance is the measure, not saturation', () => {
    // Orange throws a third of the light white does (0.34) and is fine;
    // highlighter yellow throws 0.86 and is not. Saturation can't tell them
    // apart — both are 1.00.
    for (const c of BOARD_COLORS) expect(luminanceOf(c)).toBeLessThanOrEqual(0.5);
  });

  test('and nothing dusty: every entry is a colour, not a tinted grey', () => {
    // The over-correction this replaced sat around S 0.35 and read as mud.
    for (const c of BOARD_COLORS) expect(hsv(c).s).toBeGreaterThanOrEqual(0.45);
  });

  test('the highlighter accents would FAIL these rules (the guard bites)', () => {
    // #00E676 / #76FF03 / #FFEA00 throw too much light; #D500F9 throws a
    // middling amount and is the worse case — NEITHER ink reaches AA on it.
    for (const c of ['#00E676', '#76FF03', '#FFEA00', '#D500F9']) {
      expect(luminanceOf(c) > 0.5 || contrast(c, inkOn(c)) < 4.5).toBe(true);
    }
  });

  test('and so would the greyed-out ones (both brackets are held)', () => {
    for (const c of ['#7D6E63', '#5F727E', '#7A5C48']) {
      expect(hsv(c).s).toBeLessThan(0.45);
    }
  });

  test('no two boards look alike', () => {
    for (let i = 0; i < BOARD_COLORS.length; i += 1) {
      for (let j = i + 1; j < BOARD_COLORS.length; j += 1) {
        expect(deltaE(BOARD_COLORS[i], BOARD_COLORS[j])).toBeGreaterThan(15);
      }
    }
  });

  test('and CONSECUTIVE boards are obviously different, wrap included', () => {
    // Boards take these in order, so 3-next-to-4 is the comparison that gets
    // made. Ordering the list by hue would fail this.
    for (let i = 0; i < BOARD_COLORS.length; i += 1) {
      const next = BOARD_COLORS[(i + 1) % BOARD_COLORS.length];
      expect(deltaE(BOARD_COLORS[i], next)).toBeGreaterThan(30);
    }
  });
});

describe('inkOn', () => {
  test('white on the deep half, near-black on the bright half', () => {
    expect(inkOn('#3949AB')).toBe('#FFFFFF'); // Indigo
    expect(inkOn('#F57C00')).toBe('#1F2024'); // Orange
    expect(inkOn('#00ACC1')).toBe('#1F2024'); // Cyan
  });

  test('both extremes get the obvious answer', () => {
    expect(inkOn('#000000')).toBe('#FFFFFF');
    expect(inkOn('#FFFFFF')).toBe('#1F2024');
  });

  test('a colour it cannot read still gets an ink, never undefined', () => {
    // undefined here would paint the pill's title in the default colour —
    // black on a dark fill.
    expect(inkOn('rgba(0,0,0,0.5)')).toBe('#FFFFFF');
    expect(inkOn(undefined)).toBe('#FFFFFF');
  });

  test('whatever it picks is the MORE readable of the two, always', () => {
    for (const c of [...BOARD_COLORS, '#FFEA00', '#7F7F7F', '#123456']) {
      const picked = contrast(c, inkOn(c));
      const other = contrast(c, inkOn(c) === '#FFFFFF' ? '#1F2024' : '#FFFFFF');
      expect(picked).toBeGreaterThanOrEqual(other);
    }
  });
});

describe('boardColorAt', () => {
  test('wraps past the end of the list', () => {
    expect(boardColorAt(0)).toBe(BOARD_COLORS[0]);
    expect(boardColorAt(BOARD_COLORS.length)).toBe(BOARD_COLORS[0]);
    expect(boardColorAt(BOARD_COLORS.length + 3)).toBe(BOARD_COLORS[3]);
  });

  test('and a negative index is still a colour, not undefined', () => {
    expect(boardColorAt(-1)).toBe(BOARD_COLORS[BOARD_COLORS.length - 1]);
  });
});

/**
 * The palette is sized to be FILLED WITH — every colour carries white or
 * near-black type at 4.5:1 (`inkOn`). Being the type is the other half of the
 * problem and the palette does not solve it: Indigo is 2.3:1 on a dark page,
 * Leaf is 2.2:1 on the warm off-white. A board name nobody can read is worse
 * than one in the plain ink, because it still looks deliberate.
 */
describe('boardInkOn — the palette as ink rather than as fill', () => {
  // The two pages, as `pageColor(theme)` actually resolves them: a lifted
  // off-black and a warm off-white, neither of them the raw token.
  const DARK = '#121214';
  const LIGHT = '#F5F3EF';

  test.each([DARK, LIGHT])('every board clears the legibility floor on %s', (page) => {
    for (const c of BOARD_COLORS) {
      expect(contrast(boardInkOn(c, page), page)).toBeGreaterThanOrEqual(3);
    }
  });

  // The whole reason this keeps the hue instead of reaching for the theme's
  // ink: the point of the colour is that the board is recognisable as itself.
  test('it moves the lightness and leaves the hue alone', () => {
    for (const page of [DARK, LIGHT]) {
      for (const c of BOARD_COLORS) {
        const after = boardInkOn(c, page);
        // Hue survives the round trip through HSL within a degree or two.
        const drift = Math.abs(hue(after) - hue(c));
        expect(Math.min(drift, 360 - drift)).toBeLessThanOrEqual(2);
        // Still a COLOUR and not a tinted grey — the "TOO DUSTY" failure is
        // reachable from this direction too.
        expect(hsv(after).s).toBeGreaterThan(0.3);
      }
    }
  });

  // The common case must cost nothing and change nothing: a colour that is
  // already legible is the palette's own.
  test('a colour that already clears it comes back untouched', () => {
    // Rust on the off-white is 4.9:1 — it needs no help, and a "fix" that
    // darkened it anyway would make the title and the chip's dot disagree.
    expect(boardInkOn('#BF4A1F', LIGHT)).toBe('#BF4A1F');
  });

  test('it lightens on a dark page and darkens on a light one', () => {
    const indigo = '#3949AB';
    expect(luminance(boardInkOn(indigo, DARK))).toBeGreaterThan(luminance(indigo));
    const leaf = '#7CB342';
    expect(luminance(boardInkOn(leaf, LIGHT))).toBeLessThan(luminance(leaf));
  });

  // The caller falls back to its own ink on null; painting with the string
  // "null" is the bug this prevents.
  test('a non-colour is null, not a colour', () => {
    expect(boardInkOn(undefined, LIGHT)).toBeNull();
    expect(boardInkOn('not a colour', LIGHT)).toBeNull();
  });

  test('and with no page to measure against, the palette colour stands', () => {
    expect(boardInkOn('#1976D2', undefined)).toBe('#1976D2');
  });
});
