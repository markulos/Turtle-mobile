import { DOCK_PALETTES, dockPalette, matchingPalette, paletteSkin } from '../dockPalettes';
import { DOCK_INKS, activeInk, customDockSkin } from '../dockSkins';
import { normalizeHex } from '../../utils/accentColor';

const hexToRgb = (hex) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});

/** Rough perceived lightness, 0–255. */
const lum = (hex) => {
  const { r, g, b } = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

/** Hue in degrees, for telling the five apart. */
const hue = (hex) => {
  const { r, g, b } = hexToRgb(hex);
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B); const min = Math.min(R, G, B);
  const d = max - min;
  if (!d) return 0;
  let h;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return ((h * 60) + 360) % 360;
};

describe('the dock’s palettes', () => {
  test('there are five, each named and uniquely keyed', () => {
    expect(DOCK_PALETTES).toHaveLength(5);
    const keys = DOCK_PALETTES.map((p) => p.key);
    expect(new Set(keys).size).toBe(5);
    for (const p of DOCK_PALETTES) expect(p.name).toBeTruthy();
  });

  test.each(DOCK_PALETTES.map((p) => [p.name, p]))('%s is made of real colours', (_, p) => {
    expect(normalizeHex(p.backdrop)).toBe(p.backdrop);
    expect(normalizeHex(p.accent)).toBe(p.accent);
    expect(DOCK_INKS).toContain(p.ink);
    // Auto, since 2026-11-14: a fixed ink is right for the chip OR for the
    // underline, never both — the glyph sits on a different colour in each.
    expect(p.ink).toBe('auto');
    expect(['light', 'dark']).toContain(p.legacyInk);
  });

  test.each(DOCK_PALETTES.map((p) => [p.name, p]))('%s’s chip stands ON its backdrop', (_, p) => {
    // The whole job of a pairing. A chip within a hair of the bar it travels
    // along is not a combination, it is camouflage.
    expect(Math.abs(lum(p.backdrop) - lum(p.accent))).toBeGreaterThan(60);
  });

  test.each(DOCK_PALETTES.map((p) => [p.name, p]))('%s’s glyph is legible on its chip', (_, p) => {
    const glyph = activeInk(p.ink, p.accent);
    expect(Math.abs(lum(glyph) - lum(p.accent))).toBeGreaterThan(60);
  });

  test.each(DOCK_PALETTES.map((p) => [p.name, p]))('%s’s inactive glyphs survive its backdrop', (_, p) => {
    // The backdrop goes through the same builder the custom skin uses, so the
    // unchosen tabs are legible by construction — but only if the palette
    // actually routes through it.
    const skin = paletteSkin(p);
    expect(skin).toEqual(customDockSkin(p.backdrop));
    const white = skin.inactiveTint.startsWith('rgba(255');
    expect(white).toBe(lum(p.backdrop) < 128);
  });

  test('the five are telling each other apart — by hue, not just lightness', () => {
    // Two pale bars that differ only in brightness are one option, not two.
    const hues = DOCK_PALETTES.map((p) => hue(p.accent)).sort((a, b) => a - b);
    for (let i = 1; i < hues.length; i += 1) {
      expect(hues[i] - hues[i - 1]).toBeGreaterThan(20);
    }
    // …and the set covers both grounds, because a light bar is a different
    // decision about the whole screen rather than a lighter dark one.
    const light = DOCK_PALETTES.filter((p) => lum(p.backdrop) > 128);
    expect(light.length).toBeGreaterThanOrEqual(2);
    expect(light.length).toBeLessThan(DOCK_PALETTES.length);
  });

  describe('which one you are wearing', () => {
    const state = (p) => ({
      dockStyle: 'custom',
      dockColor: p.backdrop,
      accentColor: p.accent,
      dockInk: p.ink,
    });

    test.each(DOCK_PALETTES.map((p) => [p.name, p]))('%s recognises itself', (_, p) => {
      expect(matchingPalette(state(p))).toBe(p.key);
      // Case is not meaning: a hex out of storage may come back lower-case.
      expect(matchingPalette({ ...state(p), dockColor: p.backdrop.toLowerCase() })).toBe(p.key);
    });

    test('nudge ANY of the four and the tick leaves — honestly', () => {
      const p = DOCK_PALETTES[0];
      expect(matchingPalette({ ...state(p), dockInk: 'dark' })).toBeNull();
      expect(matchingPalette({ ...state(p), dockColor: '#123456' })).toBeNull();
      expect(matchingPalette({ ...state(p), accentColor: '#123456' })).toBeNull();
      // A palette paints a CUSTOM backdrop. On smoked or paper, the colour it
      // remembers is not what you are looking at.
      expect(matchingPalette({ ...state(p), dockStyle: 'smoked' })).toBeNull();
    });

    test('a dock nobody templated matches nothing, and says so quietly', () => {
      expect(matchingPalette({ dockStyle: 'custom' })).toBeNull();
      expect(matchingPalette({})).toBeNull();
    });
  });

  test('dockPalette finds one by key, and refuses to invent one', () => {
    expect(dockPalette('midnight')).toBe(DOCK_PALETTES[0]);
    for (const bad of ['nope', '', null, undefined]) expect(dockPalette(bad)).toBeNull();
  });
});
