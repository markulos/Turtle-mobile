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

describe('the panel separates by TONE, not by a line', () => {
  // The decision of 2026-11-13, as arithmetic. The panel used to be drawn as
  // a recess — near-black fill, hairline rim, brighter lit top edge — and on
  // a black page the rim WAS the card: the eye found the outline first and
  // the surface second. The weight moved to the fill.
  const dark = insetCardPalette({ mode: 'dark' });
  const alpha = (css) => Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(css)[1]);

  test('the fill alone lifts the card clear of a black page', () => {
    // If this is the only thing you keep, keep this: a card has to be visible
    // with the rim switched off entirely. The old near-black fill sat at
    // 1.17 against the page, which is why it needed an outline to exist.
    expect(contrast(dark.card, '#000000')).toBeGreaterThan(1.25);
  });

  test('the rim is a hint — a fraction of what it was', () => {
    expect(alpha(dark.edge)).toBeLessThan(0.06);
    expect(alpha(dark.edgeTop)).toBeLessThan(0.08);
    // Still ordered, so the top edge keeps catching a touch more light than
    // the sides. A rim at zero is a different decision and not this one.
    expect(alpha(dark.edgeTop)).toBeGreaterThan(alpha(dark.edge));
    expect(alpha(dark.edge)).toBeGreaterThan(0);
  });

  test('…and the fill out-weighs it, which is the whole inversion', () => {
    // Like for like: what the card does against the page, against what the
    // rim does against the card. Before the change the rim won.
    const rimSeen = contrast(mixHex(dark.card, '#FFFFFF', alpha(dark.edge)), dark.card);
    const fillSeen = contrast(dark.card, '#000000');
    expect(fillSeen).toBeGreaterThan(rimSeen);
  });

  test('warm: red highest, blue lowest, and only just', () => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(dark.card.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    // Past about eight points it stops being "lit" and starts being brown.
    expect(r - b).toBeLessThanOrEqual(8);
  });

  test('the icon tile still reads as a step above the card it sits on', () => {
    expect(lum(dark.tile)).toBeGreaterThan(lum(dark.card));
  });
});

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
    // A LIFT toward white, asserted as a relationship rather than as the
    // mixing constant: the rim faded app-wide on 2026-11-13, and a board's
    // card has to fade with it or it keeps an outline nothing else has.
    expect(lum(edge)).toBeGreaterThan(lum(card));
    // The top edge is a step brighter than the rest of the rim.
    expect(lum(edgeTop)).toBeGreaterThan(lum(edge));
    // …and it is a HINT. Before the fade this was a fifth of the way to
    // white, and the rim was the first thing you saw on a card.
    expect(lum(edge)).toBeLessThan(lum(mixHex(card, '#FFFFFF', 0.12)));
  });

  test('a colour it cannot read falls all the way back to the plain card', () => {
    expect(boardCardPalette(light, 'rebeccapurple')).toEqual(insetCardPalette(light));
  });
});
