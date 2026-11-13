import {
  DOCK_THEMES, dockTheme, isDockTheme, themeSkin, themeIsIntact, resolveDockSkin,
} from '../dockThemes';
import { activeInk, customDockSkin, dockSkin, DOCK_INKS } from '../dockSkins';
import { normalizeHex } from '../../utils/accentColor';

const parse = (css) => {
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(css);
  if (!m) throw new Error(`not an rgba string: ${css}`);
  return { r: +m[1], g: +m[2], b: +m[3], a: +m[4] };
};
const hexToRgb = (hex) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});
const lum = ({ r, g, b }) => 0.299 * r + 0.587 * g + 0.114 * b;

/** `over` composited on `base`, both as {r,g,b}, at alpha a. */
const over = (ink, base, a) => ({
  r: ink.r * a + base.r * (1 - a),
  g: ink.g * a + base.g * (1 - a),
  b: ink.b * a + base.b * (1 - a),
});

describe('the dock’s named themes', () => {
  test.each(DOCK_THEMES.map((t) => [t.name, t]))('%s is a complete look', (_, t) => {
    expect(t.key).toBeTruthy();
    expect(t.name).toBeTruthy();
    expect(t.tagline).toBeTruthy();
    expect(normalizeHex(t.backdrop)).toBe(t.backdrop);
    expect(normalizeHex(t.accent)).toBe(t.accent);
    expect(DOCK_INKS).toContain(t.ink);
    // Composed, not derived: a theme that leaves its ink on auto would move
    // the day the contrast check is retuned.
    expect(t.ink).not.toBe('auto');
  });

  test.each(DOCK_THEMES.map((t) => [t.name, t]))('%s builds ON the derived skin', (_, t) => {
    // Overrides on top of customDockSkin, not a skin written out by hand —
    // so a field added to a skin later arrives here with a sane derived value
    // instead of as undefined.
    const skin = themeSkin(t);
    const base = customDockSkin(t.backdrop);
    for (const field of ['wash', 'blurTint', 'lip']) {
      if (!(field in (t.skin || {}))) expect(skin[field]).toEqual(base[field]);
    }
    for (const [field, value] of Object.entries(t.skin || {})) {
      expect(skin[field]).toBe(value);
    }
    // It still paints as a custom backdrop, which is what the picker's
    // Backdrop row reads to decide what is selected.
    expect(skin.key).toBe('custom');
    expect(skin.themeKey).toBe(t.key);
  });

  test.each(DOCK_THEMES.map((t) => [t.name, t]))('%s stays legible where it overrides', (_, t) => {
    // THE PRICE OF BEING ALLOWED TO OVERRIDE. The generic skins derive their
    // inactive ink from the backdrop and cannot be illegible; a theme picks
    // its own, so it has to prove the glyphs still read.
    const skin = themeSkin(t);
    const ground = hexToRgb(t.backdrop);
    const ink = parse(skin.inactiveTint);
    const seen = over(ink, ground, ink.a);
    expect(Math.abs(lum(seen) - lum(ground))).toBeGreaterThan(55);

    // …and the chip, and the glyph on the chip.
    const chip = hexToRgb(t.accent);
    expect(Math.abs(lum(chip) - lum(ground))).toBeGreaterThan(60);
    const glyph = hexToRgb(activeInk(t.ink, t.accent));
    expect(Math.abs(lum(glyph) - lum(chip))).toBeGreaterThan(60);
  });

  test('godzilla is the one we shipped, and it is not just a dark bar', () => {
    const g = dockTheme('godzilla');
    expect(g).toBeTruthy();
    // The parts a PALETTE could not have said. If these ever fall back to the
    // derived values, the theme has quietly become a palette.
    const base = customDockSkin(g.backdrop);
    expect(themeSkin(g).inactiveTint).not.toBe(base.inactiveTint);
    expect(themeSkin(g).edge).not.toBe(base.edge);
    // Scales: the unselected glyphs are green, not grey — more green than
    // either of the other channels.
    const ink = parse(themeSkin(g).inactiveTint);
    expect(ink.g).toBeGreaterThan(ink.r);
    expect(ink.g).toBeGreaterThan(ink.b);
    // The chip is the cold one, against a warm-dark ground.
    const chip = hexToRgb(g.accent);
    expect(chip.b).toBeGreaterThan(chip.r);
  });

  test('an unknown theme key is no theme at all', () => {
    for (const bad of ['mothra', '', null, undefined, 42, {}]) {
      expect(dockTheme(bad)).toBeNull();
      expect(isDockTheme(bad)).toBe(false);
    }
    expect(isDockTheme('godzilla')).toBe(true);
  });

  describe('resolving what the dock wears', () => {
    const g = DOCK_THEMES[0];

    test('a theme wins, because nothing else knows its overrides', () => {
      const skin = resolveDockSkin(
        { dockTheme: g.key, dockStyle: 'smoked', dockColor: '#123456' }, dockSkin,
      );
      expect(skin).toEqual(themeSkin(g));
    });

    test('no theme falls through to the ordinary skin', () => {
      expect(resolveDockSkin({ dockTheme: '', dockStyle: 'paper' }, dockSkin))
        .toBe(dockSkin('paper'));
      expect(resolveDockSkin({ dockStyle: 'smoked' }, dockSkin)).toBe(dockSkin('smoked'));
    });

    test('a theme this build no longer ships falls through too', () => {
      // Rather than leaving the dock asking for a skin nobody can paint.
      expect(resolveDockSkin({ dockTheme: 'mothra', dockStyle: 'paper' }, dockSkin))
        .toBe(dockSkin('paper'));
    });
  });

  describe('whether the theme still describes you', () => {
    const g = DOCK_THEMES[0];
    const worn = {
      dockStyle: 'custom', dockColor: g.backdrop, accentColor: g.accent, dockInk: g.ink,
    };

    test('intact when every setting it wrote is still there', () => {
      expect(themeIsIntact(g, worn)).toBe(true);
      expect(themeIsIntact(g, { ...worn, dockColor: g.backdrop.toLowerCase() })).toBe(true);
    });

    test('edit any one of them and it is no longer that theme', () => {
      expect(themeIsIntact(g, { ...worn, dockInk: 'auto' })).toBe(false);
      expect(themeIsIntact(g, { ...worn, dockColor: '#101010' })).toBe(false);
      expect(themeIsIntact(g, { ...worn, accentColor: '#101010' })).toBe(false);
      expect(themeIsIntact(g, { ...worn, dockStyle: 'paper' })).toBe(false);
      expect(themeIsIntact(null, worn)).toBe(false);
    });
  });
});
