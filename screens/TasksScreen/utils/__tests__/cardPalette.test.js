/**
 * Board-coloured cards. The fill carries the board's identity, but the INK is
 * chosen by the mode — which only holds while the mix stays close enough to
 * its base. These pin both halves of that bargain.
 */
import { boardCardPalette, insetCardPalette, mixHex } from '../cardPalette';

const light = { mode: 'light' };
const dark = { mode: 'dark' };

describe('mixHex', () => {
  test('the ends are the ends', () => {
    expect(mixHex('#FFFFFF', '#2979FF', 0)).toBe('#ffffff');
    expect(mixHex('#FFFFFF', '#2979FF', 1)).toBe('#2979ff');
  });

  test('halfway is halfway, per channel', () => {
    expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });

  test('short hex is understood', () => {
    expect(mixHex('#FFF', '#000', 1)).toBe('#000000');
  });

  test('a colour it cannot read degrades to the base, never to NaN', () => {
    // A theme token like this reaching the mixer used to paint "#NaNNaNNaN",
    // which RN renders as nothing — a blank card.
    expect(mixHex('#FFFFFF', 'rgba(0,0,0,0.5)', 0.4)).toBe('#FFFFFF');
    expect(mixHex('#FFFFFF', undefined, 0.4)).toBe('#FFFFFF');
    expect(mixHex('#FFFFFF', '', 0.4)).toBe('#FFFFFF');
  });

  test('t is clamped, so a bad strength cannot overshoot', () => {
    expect(mixHex('#000000', '#FFFFFF', 5)).toBe('#ffffff');
    expect(mixHex('#000000', '#FFFFFF', -2)).toBe('#000000');
  });
});

// The relative luminance a channel triple carries, for the contrast checks.
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('boardCardPalette', () => {
  test('no board → the plain card, IDENTICALLY (not a rebuild of it)', () => {
    // Same object shape AND same values: a boardless agenda row must be the
    // same dark panel every other card in the app is.
    expect(boardCardPalette(light, null)).toEqual(insetCardPalette(light));
    expect(boardCardPalette(dark, null)).toEqual(insetCardPalette(dark));
  });

  test('a board tints that dark panel without swallowing it', () => {
    const { card } = boardCardPalette(light, '#2979FF');
    expect(card).not.toBe(insetCardPalette(light).card);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(card.slice(i, i + 2), 16));
    // Still the board's hue…
    expect(b).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(r);
    // …and still dark: the card stays a panel, not a colour swatch.
    expect(lum(card)).toBeLessThan(0.25);
  });

  test('even the loudest board keeps the white title readable', () => {
    // Bright yellow and lime are the palette's hardest cases — neat, they
    // leave white text on a glare. Mixed into the panel, they cannot.
    for (const c of ['#00E676', '#FFEA00', '#76FF03', '#FFFFFF']) {
      const { card, text } = boardCardPalette(light, c);
      expect(text).toBe('#FFFFFF');
      // WCAG AA for body text is 4.5:1.
      expect(contrast(card, text)).toBeGreaterThan(4.5);
    }
  });

  test('and the muted caption on the same fill stays legible too', () => {
    // sub/muted are white at 0.72/0.50 — checked against the worst case as if
    // they were flattened onto the fill.
    const { card } = boardCardPalette(light, '#FFEA00');
    expect(contrast(card, mixHex(card, '#FFFFFF', 0.50))).toBeGreaterThan(2.5);
  });

  test('the ink is the panel ink in both modes — nothing per-colour', () => {
    expect(boardCardPalette(light, '#2979FF').text).toBe(insetCardPalette(light).text);
    expect(boardCardPalette(dark, '#2979FF').text).toBe(insetCardPalette(dark).text);
  });

  test('no shadow: a recess casts none, boarded or not', () => {
    expect(boardCardPalette(light, null).shadow).toEqual({});
    expect(boardCardPalette(light, '#2979FF').shadow).toEqual({});
  });

  test('the rim is the card lifted toward white, as the plain panel is', () => {
    const { card, edge, edgeTop } = boardCardPalette(light, '#2979FF');
    expect(edge).toBe(mixHex(card, '#FFFFFF', 0.20));
    // The lit top edge is a step brighter than the rest of the rim.
    expect(lum(edgeTop)).toBeGreaterThan(lum(edge));
  });

  test('a colour it cannot read falls all the way back to the plain card', () => {
    expect(boardCardPalette(light, 'rebeccapurple')).toEqual(insetCardPalette(light));
  });
});
