/**
 * The colour maths behind the custom highlight colour.
 *
 * Worth pinning because every one of these is a silent failure on screen: an
 * unparsed hex renders as nothing in RN (an invalid colour is not an error), a
 * hue that comes back 60° out puts the thumb somewhere the user did not touch,
 * and a luminance that averages the channels calls a saturated yellow "dark"
 * and paints black text on it.
 */
import fs from 'fs';
import path from 'path';
import {
  accentFrostInk,
  contrastRatio,
  INK_SAT_CAP,
  neutralInk,
  frostSurface,
  mixHex,
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

describe('mixHex / frostSurface', () => {
  test('the ends of the mix are the colours themselves', () => {
    expect(mixHex('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(mixHex('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
    expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });

  test('a wash of accent on a page lands between the two', () => {
    const surface = frostSurface('#F9A8D4', '#F5F3F0');
    expect(luminance(surface)).toBeLessThan(luminance('#F5F3F0'));
    expect(luminance(surface)).toBeGreaterThan(luminance('#F9A8D4'));
  });

  test('nonsense in still yields a colour, never undefined', () => {
    expect(mixHex('nope', '#F97316', 0.5)).toBe('#F97316');
    expect(mixHex('#F97316', 'nope', 0.5)).toBe('#F97316');
  });
});

describe('accentFrostInk', () => {
  const DARK_PAGE = '#000000';
  const LIGHT_PAGE = '#F5F3F0';

  test('a deep accent carries plain white', () => {
    for (const accent of ['#8B5CF6', '#3B82F6', '#EF4444', '#F97316', '#14B8A6']) {
      expect(accentFrostInk(accent, { page: DARK_PAGE })).toBe(INK_LIGHT);
    }
  });

  // The rule Mark asked for: not a neutral near-black — the SAME colour, much
  // darker. A pink key reads as one object with deep pink type on it; the same
  // key with grey type on it looks disabled.
  test('a pale accent keeps its own hue and drops its lightness', () => {
    const accent = '#F9A8D4';
    const ink = accentFrostInk(accent, { page: LIGHT_PAGE });
    expect(ink).not.toBe(INK_LIGHT);
    expect(ink).not.toBe(INK_DARK);
    const a = hexToHsl(accent);
    const i = hexToHsl(ink);
    // Same colour…
    expect(Math.abs(i.h - a.h)).toBeLessThanOrEqual(2);
    expect(i.s).toBeGreaterThan(30);
    // …much darker.
    expect(i.l).toBeLessThan(a.l / 2);
  });

  test('and it is actually readable on the pill it sits on', () => {
    for (const accent of ['#F9A8D4', '#FFFF00', '#FDE68A', '#FFFFFF', '#F59E0B']) {
      const ink = accentFrostInk(accent, { page: LIGHT_PAGE });
      const surface = frostSurface(accent, LIGHT_PAGE);
      expect(contrastRatio(ink, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  // The same accent is a deep chip on a black page and a pastel one on cream,
  // so the decision has to be made about the SURFACE, not the accent.
  test('the page decides too — one accent, two answers', () => {
    const amber = '#F59E0B';
    expect(accentFrostInk(amber, { page: DARK_PAGE })).toBe(INK_LIGHT);
    expect(accentFrostInk(amber, { page: LIGHT_PAGE })).not.toBe(INK_LIGHT);
  });

  test('white text never lands on a pale pill', () => {
    for (const accent of ['#F9A8D4', '#FFFF00', '#FFFFFF', '#FDE68A']) {
      expect(accentFrostInk(accent, { page: LIGHT_PAGE })).not.toBe(INK_LIGHT);
    }
  });

  test('a non-colour falls back to white rather than to nothing', () => {
    expect(accentFrostInk('nope', { page: LIGHT_PAGE })).toBe(INK_LIGHT);
    expect(accentFrostInk(undefined)).toBe(INK_LIGHT);
  });
});

describe('neutralInk — the accent as ink on a pale page', () => {
  const PAGE = '#F5F3F0';   // the light theme's own page colour
  const THEME_SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'context', 'ThemeContext.js'), 'utf8');
  /**
   * The preset swatches, READ OFF the source rather than imported.
   *
   * ThemeContext reaches AsyncStorage at import time, which is the whole
   * reason this colour maths lives outside it — importing it here to get one
   * array would drag the native module into a pure-maths suite. Parsed, the
   * list also cannot drift from the one the app ships.
   */
  const PRESETS = THEME_SRC
    .slice(THEME_SRC.indexOf('export const ACCENTS'), THEME_SRC.indexOf('export const DEFAULT_ACCENT'))
    .match(/#[0-9A-Fa-f]{6}/g) || [];

  test('a colour that already reads is returned UNTOUCHED', () => {
    // The point is to rescue a bad choice, not to restyle a good one. A navy
    // or a deep teal theme must come out exactly as the owner set it.
    for (const ok of ['#1E3A8A', '#0F766E', '#7C2D12']) {
      expect(neutralInk(ok, PAGE)).toBe(ok);
      expect(contrastRatio(ok, PAGE)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('a FLUORESCENT colour loses its chroma as well as its lightness', () => {
    // Mark, 2026-11-16: "turn down the fluorescent and make the tone more
    // neutral and dark within the same palette." Darkening alone does not do
    // that — #E8FF00 taken down by lightness is a 100%-saturated acid olive.
    const neon = '#E8FF00';
    const ink = neutralInk(neon, PAGE);
    expect(contrastRatio(ink, PAGE)).toBeGreaterThanOrEqual(4.5);
    expect(hexToHsl(ink).s).toBeLessThanOrEqual(INK_SAT_CAP);
    expect(hexToHsl(ink).s).toBeLessThan(hexToHsl(neon).s);
    expect(hexToHsl(ink).l).toBeLessThan(hexToHsl(neon).l);
  });

  test('a PALE colour does not come back MORE fluorescent than it went in', () => {
    // The failure that makes the cap necessary: lightness-only on the pastel
    // #F9A8D4 lands on #D20F7A — a hot magenta, further from what was picked
    // than the pastel was. Saturation must not be allowed to rise.
    const pale = '#F9A8D4';
    const ink = neutralInk(pale, PAGE);
    expect(contrastRatio(ink, PAGE)).toBeGreaterThanOrEqual(4.5);
    expect(hexToHsl(ink).s).toBeLessThanOrEqual(hexToHsl(pale).s);
  });

  test('…but it is still RECOGNISABLY the colour that was picked', () => {
    // "Within the same palette": the hue is what carries that, and it is held
    // exactly. Only chroma and lightness move.
    for (const c of ['#E8FF00', '#F9A8D4', '#F97316', '#3B82F6', '#14B8A6', '#EF4444']) {
      const ink = neutralInk(c, PAGE);
      // Within a couple of degrees: 8-bit hex cannot hold an HSL triple
      // exactly, so a round trip moves the hue a point on its own. That is
      // quantisation, not the maths (the same allowance neumorph.test makes).
      expect(Math.abs(hexToHsl(ink).h - hexToHsl(c).h)).toBeLessThanOrEqual(2);
    }
  });

  test('EVERY preset, and three neon extremes, clear the bar on the light page', () => {
    // A sweep rather than a handful of cases: the owner can pick any of these
    // and the labels drawn in it have to be readable in all of them.
    expect(PRESETS.length).toBeGreaterThanOrEqual(9);
    const all = [...PRESETS, '#E8FF00', '#39FF14', '#00FFF0'];
    for (const c of all) {
      expect(contrastRatio(neutralInk(c, PAGE), PAGE)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('it is the LEAST change that works, not the first rung of a ladder', () => {
    // A colour that barely fails is barely moved — same discipline readableOn
    // has. A fixed step ladder would drag it much darker than it needs.
    const near = '#D23F3F';                       // fails 4.5 by a little
    expect(contrastRatio(near, PAGE)).toBeLessThan(4.5);
    const ink = neutralInk(near, PAGE);
    expect(Math.abs(hexToHsl(ink).l - hexToHsl(near).l)).toBeLessThanOrEqual(12);
  });

  test('the SURFACE is the one the ink sits on, and junk changes nothing', () => {
    // The same accent is a different problem on each surface, so there is no
    // answer without one — and inventing a page is how an ink ends up tuned
    // for a background it is never drawn on.
    const neon = '#E8FF00';
    expect(neutralInk(neon, '#000000')).toBe(neon);     // already fine on black
    expect(neutralInk(neon, null)).toBe(neon);
    expect(neutralInk(neon, 'nonsense')).toBe(neon);
    expect(neutralInk('nonsense', PAGE)).toBe('nonsense');
  });

  test('a mid-grey surface nothing clears returns the MOST legible thing', () => {
    // Neither end of the scale reaches 4.5 against #777777. Returning the raw
    // colour there would be returning something known to be unreadable.
    const out = neutralInk('#808080', '#777777');
    expect(contrastRatio(out, '#777777')).toBeGreaterThan(contrastRatio('#808080', '#777777'));
  });

  test('DARK MODE keeps the accent — there is nothing fluorescent about it there', () => {
    // On the black page a bright accent is the legible one; darkening it is
    // the exact wrong move, which is why the token is gated on the mode.
    const ctx = fs.readFileSync(path.resolve(__dirname, '..', '..', 'context', 'ThemeContext.js'), 'utf8');
    expect(ctx).toMatch(/accentInk: isDark \? accentColor : neutralInk\(accentColor, baseTheme\.colors\.background\)/);
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
