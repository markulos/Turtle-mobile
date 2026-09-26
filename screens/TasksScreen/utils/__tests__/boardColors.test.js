/**
 * The board palette is bracketed by two failure modes, both of which have
 * shipped: highlighter accents that vibrate and can't hold text, and earthy
 * mid-tones so close together that three boards all read as "brown".
 *
 * The rules that thread between them — chroma, luminance, an ink that works,
 * and separation from the neighbours — are asserted as PROPERTIES rather than
 * as hex values, so adding a colour tells you whether it belongs.
 */
import { BOARD_COLORS, boardColorAt, inkOn, luminanceOf } from '../boardColors';

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
