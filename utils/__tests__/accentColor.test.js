/**
 * The colour maths behind the custom highlight colour.
 *
 * Worth pinning because every one of these is a silent failure on screen: an
 * unparsed hex renders as nothing in RN (an invalid colour is not an error), a
 * hue that comes back 60° out puts the thumb somewhere the user did not touch,
 * and a luminance that averages the channels calls a saturated yellow "dark"
 * and paints black text on it.
 */
import {
  contrastRatio,
  hexToHsl,
  hexToRgb,
  hslToHex,
  inkOn,
  INK_DARK,
  INK_LIGHT,
  isHex,
  legibilityNote,
  luminance,
  normalizeHex,
} from '../accentColor';

describe('normalizeHex', () => {
  test('takes a hex however it was typed or pasted', () => {
    expect(normalizeHex('#f97316')).toBe('#F97316');
    expect(normalizeHex('F97316')).toBe('#F97316');
    expect(normalizeHex('  #F97316 ')).toBe('#F97316');
    // Shorthand expands — someone typing a colour by hand reaches for #f9a.
    expect(normalizeHex('#f9a')).toBe('#FF99AA');
    expect(normalizeHex('abc')).toBe('#AABBCC');
  });

  test('null for anything that is not a colour', () => {
    // '#F9' is the halfway state of someone still typing, and it must not
    // resolve to something — the field would rewrite itself under the caret.
    expect(normalizeHex('#F9')).toBeNull();
    expect(normalizeHex('#F9731')).toBeNull();
    expect(normalizeHex('#GGGGGG')).toBeNull();
    expect(normalizeHex('rebeccapurple')).toBeNull();
    expect(normalizeHex('')).toBeNull();
    expect(normalizeHex(null)).toBeNull();
    expect(normalizeHex(undefined)).toBeNull();
  });

  test('isHex agrees with it', () => {
    expect(isHex('#F9A8D4')).toBe(true);
    expect(isHex('#F9A8D')).toBe(false);
  });
});

describe('hexToRgb', () => {
  test('splits the channels', () => {
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#F9A8D4')).toEqual({ r: 249, g: 168, b: 212 });
  });
});

describe('hexToHsl', () => {
  test('the hue lands on the right side of the wheel', () => {
    expect(hexToHsl('#FF0000').h).toBe(0);
    expect(hexToHsl('#FFFF00').h).toBe(60);
    expect(hexToHsl('#00FF00').h).toBe(120);
    expect(hexToHsl('#00FFFF').h).toBe(180);
    expect(hexToHsl('#0000FF').h).toBe(240);
    expect(hexToHsl('#FF00FF').h).toBe(300);
  });

  test('a hue past magenta wraps forward, never negative', () => {
    // The red-max branch is the one that can go below zero before the wrap; a
    // negative hue would put the thumb off the left end of the track.
    expect(hexToHsl('#FF0080').h).toBeGreaterThan(300);
    expect(hexToHsl('#FF0080').h).toBeLessThan(360);
  });

  test('grey has no hue and no saturation', () => {
    expect(hexToHsl('#808080')).toEqual({ h: 0, s: 0, l: 50 });
    expect(hexToHsl('#000000')).toEqual({ h: 0, s: 0, l: 0 });
    expect(hexToHsl('#FFFFFF')).toEqual({ h: 0, s: 0, l: 100 });
  });

  test('light pink reads as light and pink', () => {
    const { h, s, l } = hexToHsl('#F9A8D4');
    expect(h).toBeGreaterThan(300);
    expect(s).toBeGreaterThan(50);
    expect(l).toBeGreaterThan(75);
  });

  test('null for a non-colour', () => {
    expect(hexToHsl('nope')).toBeNull();
  });
});

describe('hslToHex', () => {
  test('the corners of the space', () => {
    expect(hslToHex({ h: 0, s: 0, l: 0 })).toBe('#000000');
    expect(hslToHex({ h: 0, s: 0, l: 100 })).toBe('#FFFFFF');
    expect(hslToHex({ h: 0, s: 100, l: 50 })).toBe('#FF0000');
    expect(hslToHex({ h: 240, s: 100, l: 50 })).toBe('#0000FF');
  });

  test('hue wraps and the rest clamps, so a dragged slider cannot produce a non-colour', () => {
    expect(hslToHex({ h: 360, s: 100, l: 50 })).toBe('#FF0000');
    expect(hslToHex({ h: -60, s: 100, l: 50 })).toBe(hslToHex({ h: 300, s: 100, l: 50 }));
    expect(hslToHex({ h: 120, s: 500, l: 50 })).toBe('#00FF00');
    expect(hslToHex({ h: 120, s: 100, l: -20 })).toBe('#000000');
    expect(hslToHex({})).toBe('#000000');
  });

  test('every output is a colour RN can render', () => {
    for (let h = 0; h < 360; h += 7) {
      for (const s of [0, 37, 100]) {
        for (const l of [0, 12, 50, 88, 100]) {
          expect(hslToHex({ h, s, l })).toMatch(/^#[0-9A-F]{6}$/);
        }
      }
    }
  });

  // The picker keeps hex AND hsl side by side rather than deriving one from the
  // other, and this is why: the round trip is close but not exact, so deriving
  // would let a typed colour come back a point off and look self-corrected.
  test('the round trip is stable to within a point per channel', () => {
    for (const hex of ['#F97316', '#3B82F6', '#22C55E', '#8B5CF6', '#EC4899', '#F9A8D4', '#14B8A6']) {
      const back = hslToHex(hexToHsl(hex));
      const a = hexToRgb(hex);
      const b = hexToRgb(back);
      expect(Math.abs(a.r - b.r)).toBeLessThanOrEqual(2);
      expect(Math.abs(a.g - b.g)).toBeLessThanOrEqual(2);
      expect(Math.abs(a.b - b.b)).toBeLessThanOrEqual(2);
    }
  });
});

describe('luminance and contrast', () => {
  test('black to white is the full WCAG span', () => {
    expect(luminance('#000000')).toBeCloseTo(0, 5);
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#F97316', '#F97316')).toBeCloseTo(1, 5);
  });

  test('it is weighted by the eye, not by the average of the channels', () => {
    // Same channel total, wildly different brightness: a flat average would
    // call these equal and paint the wrong ink on one of them.
    expect(luminance('#00FF00')).toBeGreaterThan(luminance('#0000FF'));
  });

  test('the ratio is symmetric — neither argument is "the background"', () => {
    expect(contrastRatio('#F9A8D4', '#F5F3F0')).toBeCloseTo(contrastRatio('#F5F3F0', '#F9A8D4'), 6);
  });
});

describe('inkOn', () => {
  test('near-black on a pale fill, white on a deep one', () => {
    expect(inkOn('#F9A8D4')).toBe(INK_DARK);
    expect(inkOn('#FFFF00')).toBe(INK_DARK);
    expect(inkOn('#8B5CF6')).toBe(INK_LIGHT);
    expect(inkOn('#000000')).toBe(INK_LIGHT);
  });

  // The reason the dark ink is #1F2024 and not #000000: against a mid-tone
  // fill, pure black out-contrasts white on paper and would take every
  // tie-break, so a violet accent would carry black type.
  test('it picks whichever ink actually reads better on the colour', () => {
    for (const c of ['#F97316', '#3B82F6', '#22C55E', '#8B5CF6', '#EC4899', '#F9A8D4', '#14B8A6', '#FFFFFF', '#000000']) {
      const picked = inkOn(c);
      const other = picked === INK_LIGHT ? INK_DARK : INK_LIGHT;
      expect(contrastRatio(c, picked)).toBeGreaterThanOrEqual(contrastRatio(c, other));
    }
  });

  test('a non-colour still gets readable ink rather than undefined', () => {
    // An undefined colour renders black on black (STYLE-RULES §1).
    expect(inkOn('nope')).toBe(INK_LIGHT);
    expect(inkOn(undefined)).toBe(INK_LIGHT);
    // rgba() tokens reach this too — the palette is a mix of both forms.
    expect(inkOn('rgba(0,0,0,0.5)')).toBe(INK_LIGHT);
  });
});

describe('legibilityNote', () => {
  const LIGHT_PAGE = '#F5F3F0';
  const DARK_PAGE = '#000000';

  test('silent for a colour that can carry text on the page', () => {
    expect(legibilityNote('#F97316', DARK_PAGE)).toBeNull();
    expect(legibilityNote('#8B5CF6', LIGHT_PAGE)).toBeNull();
  });

  test('speaks up for a pale colour on a pale page', () => {
    // Exactly the light-pink case: perfect on black, unreadable as link text on
    // the off-white page, and the sheet says so instead of letting it be found
    // later on a screen of invisible links.
    expect(legibilityNote('#F9A8D4', LIGHT_PAGE)).toMatch(/faint/i);
    expect(legibilityNote('#111111', DARK_PAGE)).toMatch(/faint/i);
  });

  test('a non-colour is not a legibility problem', () => {
    expect(legibilityNote('nope', LIGHT_PAGE)).toBeNull();
  });
});
