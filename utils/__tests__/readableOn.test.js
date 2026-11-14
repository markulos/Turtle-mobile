import {
  GLYPH_MIN, contrastRatio, hexToHsl, mixHex, readableOn,
} from '../accentColor';

/**
 * The guarantee: whatever highlight colour someone picks, a glyph drawn in it
 * can be seen on the surface it sits on.
 *
 * This is the thing Mark asked for in those words — "a reliable mathematical
 * means" — after a pale highlight made the Media Vault's row icons vanish
 * into their own tint. So what is pinned here is the GUARANTEE, swept across
 * the whole hue circle at every lightness, rather than a handful of colours
 * that happened to work when it was written.
 */

const PAGE_LIGHT = '#F5F3F0';
const PAGE_DARK = '#000000';
/** The tile under a Media Vault row glyph: the accent at 13% over the page. */
const TILE = (accent, page) => mixHex(page, accent, 0.133);

describe('readableOn', () => {
  test('a colour that already reads is returned untouched', () => {
    // The point is legibility, not uniformity. A deep teal on a pale teal
    // tile is already a strong mark and must not be "corrected" into some
    // other colour.
    const accent = '#1F8A9B';
    const tile = TILE(accent, PAGE_LIGHT);
    expect(contrastRatio(accent, tile)).toBeGreaterThanOrEqual(GLYPH_MIN);
    expect(readableOn(accent, tile)).toBe(accent);
  });

  test('THE BUG: a pale highlight is darkened until the glyph shows', () => {
    // Pale lemon on a 13%-lemon tile over a cream page — three near-identical
    // creams, and the icon is simply not there.
    const accent = '#F2F0A0';
    const tile = TILE(accent, PAGE_LIGHT);
    expect(contrastRatio(accent, tile)).toBeLessThan(GLYPH_MIN);

    const fixed = readableOn(accent, tile);
    expect(contrastRatio(fixed, tile)).toBeGreaterThanOrEqual(GLYPH_MIN);
    // Darker, not greyer.
    expect(hexToHsl(fixed).l).toBeLessThan(hexToHsl(accent).l);
  });

  test('…and on a DARK surface it goes the other way', () => {
    // The frost ink only ever had to darken. A glyph has to do both, or a
    // deep colour on a dark page is the same bug upside down.
    const accent = '#101A2E';
    const tile = TILE(accent, PAGE_DARK);
    const fixed = readableOn(accent, tile);
    expect(contrastRatio(fixed, tile)).toBeGreaterThanOrEqual(GLYPH_MIN);
    expect(hexToHsl(fixed).l).toBeGreaterThan(hexToHsl(accent).l);
  });

  test('hue and saturation are kept — it is still YOUR colour', () => {
    // A glyph nudged toward grey makes a tinted control look disabled. The
    // same hue taken deeper reads as one object. This is accentFrostInk's
    // rule and it holds here.
    const accent = '#F7B5D0';
    const before = hexToHsl(accent);
    const after = hexToHsl(readableOn(accent, TILE(accent, PAGE_LIGHT)));
    expect(after.h).toBeCloseTo(before.h, 0);
    expect(after.s).toBeCloseTo(before.s, 0);
  });

  test('it moves as LITTLE as it can get away with', () => {
    // The least change that works, not the first rung of a fixed ladder: a
    // colour that barely fails should barely move, or everyone's highlight
    // ends up the same few dark tones.
    const accent = '#C9C97A';
    const tile = TILE(accent, PAGE_LIGHT);
    const fixed = readableOn(accent, tile);
    const l = hexToHsl(fixed).l;
    // One step lighter must NOT clear the bar — proving this is the closest
    // passing value and not merely a passing one.
    expect(contrastRatio(fixed, tile)).toBeGreaterThanOrEqual(GLYPH_MIN);
    const nearer = require('../accentColor').hslToHex({ ...hexToHsl(accent), l: l + 1 });
    expect(contrastRatio(nearer, tile)).toBeLessThan(GLYPH_MIN);
  });

  test('EVERY hue at EVERY lightness ends up legible on its own tile', () => {
    // The sweep is the actual guarantee. A fix that works for the colour it
    // was written against is not a reliable mathematical means.
    const { hslToHex } = require('../accentColor');
    const failures = [];
    for (let h = 0; h < 360; h += 15) {
      for (let l = 5; l <= 95; l += 5) {
        for (const s of [25, 60, 100]) {
          for (const page of [PAGE_LIGHT, PAGE_DARK]) {
            const accent = hslToHex({ h, s, l });
            const tile = TILE(accent, page);
            const ratio = contrastRatio(readableOn(accent, tile), tile);
            if (ratio < GLYPH_MIN) failures.push({ accent, page, ratio: +ratio.toFixed(2) });
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test('junk in, the colour back out — never a crash and never black', () => {
    // This runs inside a render. Throwing here takes a screen down over a
    // malformed preference.
    expect(readableOn('not a colour', PAGE_LIGHT)).toBe('not a colour');
    expect(readableOn('#F2F0A0', null)).toBe('#F2F0A0');
    expect(readableOn('#F2F0A0', 'nonsense')).toBe('#F2F0A0');
  });
});
