import {
  DOCK_STYLES,
  DEFAULT_DOCK_STYLE,
  DEFAULT_DOCK_COLOR,
  dockSkin,
  dockSkins,
  customDockSkin,
  activeInk,
  DOCK_INKS,
  DEFAULT_DOCK_INK,
} from '../dockSkins';
import { INK_DARK, INK_LIGHT, inkOn } from '../../utils/accentColor';

/** 'rgba(r,g,b,a)' → the four numbers. */
const parse = (css) => {
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(css);
  if (!m) throw new Error(`not an rgba string: ${css}`);
  return { r: +m[1], g: +m[2], b: +m[3], a: +m[4] };
};

const grey = (c) => (c.r + c.g + c.b) / 3;

describe('the dock’s skins', () => {
  test('the default is one of the skins on offer', () => {
    expect(DOCK_STYLES).toContain(DEFAULT_DOCK_STYLE);
    expect(dockSkins()).toHaveLength(DOCK_STYLES.length);
  });

  test.each(DOCK_STYLES)('%s is complete enough to paint a dock', (key) => {
    const skin = dockSkin(key);
    expect(skin.key).toBe(key);
    expect(skin.name).toBeTruthy();
    expect(skin.blurb).toBeTruthy();
    expect(['dark', 'light']).toContain(skin.blurTint);
    for (const colour of [skin.edge, skin.ridge, skin.inactiveTint]) {
      expect(() => parse(colour)).not.toThrow();
    }
    // lip is the one that may be absent — a skin with no depth to describe.
    if (skin.lip !== null) expect(() => parse(skin.lip)).not.toThrow();
  });

  test.each(DOCK_STYLES)('%s’s wash is a gradient the renderer will accept', (key) => {
    const { colors, locations } = dockSkin(key).wash;
    expect(colors.length).toBeGreaterThanOrEqual(2);
    expect(colors).toHaveLength(locations.length);
    expect(locations[0]).toBe(0);
    expect(locations[locations.length - 1]).toBe(1);
    for (let i = 1; i < locations.length; i += 1) {
      expect(locations[i]).toBeGreaterThan(locations[i - 1]);
    }
  });

  test.each(DOCK_STYLES)('%s’s inactive glyphs are legible ON it', (key) => {
    // The one rule a new skin can break without anyone noticing until it is on
    // a phone: the glyphs sit on the capsule, so their ink has to be a long way
    // from the capsule's own value. A white-on-white dock passes every other
    // check in this file.
    const skin = dockSkin(key);
    const surface = parse(skin.wash.colors[skin.wash.colors.length - 1]);
    const ink = parse(skin.inactiveTint);
    expect(Math.abs(grey(surface) - grey(ink))).toBeGreaterThan(120);
    // And it must actually be opaque enough to see.
    expect(ink.a).toBeGreaterThan(0.3);
  });

  describe('…and legible once the PAGE shows through it', () => {
    // The check above compares the ink to the wash's own colour, which is the
    // right question for an opaque bar and the wrong one for a sheer bar. The
    // dock went sheer on 2026-11-13 (0.80 → 0.64 at the top), so the surface
    // the glyphs actually sit on is the wash COMPOSITED over whatever page is
    // under the dock — and the page can be anything.
    //
    // Both extremes, because they fail in opposite directions: a dark skin has
    // least to work with over WHITE (the wash is diluted toward the page and
    // the white glyphs lose their ground), a light skin over BLACK.
    const over = (layer, base) => ({
      r: layer.r * layer.a + base.r * (1 - layer.a),
      g: layer.g * layer.a + base.g * (1 - layer.a),
      b: layer.b * layer.a + base.b * (1 - layer.a),
    });
    const PAGES = { 'a white page': { r: 255, g: 255, b: 255 }, 'a black page': { r: 0, g: 0, b: 0 } };

    for (const key of DOCK_STYLES) {
      for (const [name, page] of Object.entries(PAGES)) {
        test(`${key} over ${name}`, () => {
          const skin = dockSkin(key);
          const ink = parse(skin.inactiveTint);
          const stops = skin.wash.colors.map(parse);
          const reads = (stop) => {
            const seat = over(stop, page);
            return Math.abs(grey(over(ink, seat)) - grey(seat));
          };

          // WHERE THE GLYPHS ACTUALLY SIT: the middle of the capsule. A ramp's
          // sheerest end is its extreme edge, and nothing is drawn on that.
          const middle = stops[Math.floor(stops.length / 2)];
          // 65, not the 120 above: that one compares ink to the wash's own
          // colour, which is the right question for an opaque bar and the
          // wrong one for a sheer one. Measured at the shipped strength the
          // dark skins sit at ~73 here; one step sheerer (0.56 → 0.40, which
          // was rendered and rejected) gives ~63, which is where the glyphs
          // started going over a photo. So this bound is drawn BETWEEN the
          // version that works and the version that does not.
          expect(reads(middle)).toBeGreaterThan(65);

          // …and the extreme edge still has to be a surface, not a window.
          const sheerest = stops.reduce((a, b) => (a.a <= b.a ? a : b));
          expect(reads(sheerest)).toBeGreaterThan(50);
        });
      }
    }
  });

  test.each(DOCK_STYLES)('%s frosts the way its surface needs', (key) => {
    // A light-tinted blur under a near-black wash milks it out; a dark one
    // under a white wash greys it. The tint is therefore not a free choice —
    // it follows the surface.
    const skin = dockSkin(key);
    const surface = parse(skin.wash.colors[0]);
    expect(skin.blurTint).toBe(grey(surface) > 127 ? 'light' : 'dark');
  });

  test('smoked is the dark one, with the recess treatment intact', () => {
    const skin = dockSkin('smoked');
    const top = parse(skin.wash.colors[0]);
    const bottom = parse(skin.wash.colors[skin.wash.colors.length - 1]);
    expect(grey(top)).toBeLessThan(20);
    // Still a channel: darkest at the top edge, lifting toward a lit lip.
    expect(top.a).toBeGreaterThan(bottom.a);
    expect(parse(skin.lip)).toMatchObject({ r: 255, g: 255, b: 255 });
  });

  test('paper is white, flat, and nothing else', () => {
    const skin = dockSkin('paper');
    const stops = skin.wash.colors.map(parse);
    // FLAT: every stop identical. A wash on this skin would be the one thing
    // it is defined by not having.
    for (const stop of stops) expect(stop).toEqual(stops[0]);
    expect(stops[0]).toMatchObject({ r: 255, g: 255, b: 255 });
    // Translucent, so the frost still has something to do.
    expect(stops[0].a).toBeLessThan(1);
    // No lit floor to describe, and a DARK hairline — a white edge on a white
    // bar is not an edge.
    expect(skin.lip).toBeNull();
    expect(grey(parse(skin.edge))).toBeLessThan(60);
    expect(parse(skin.edge).a).toBeLessThan(0.3);
  });

  describe('custom — a skin built from one colour', () => {
    // The worst cases a colour picker can produce, not a happy path: the two
    // extremes, the mid greys where neither ink has much room, a saturated
    // colour and a pale one.
    const COLOURS = ['#000000', '#FFFFFF', '#808080', '#8A8A8A', '#C8413B', '#F5E6A8', '#1B4F72'];

    test.each(COLOURS)('%s is painted, and painted flat', (hex) => {
      const skin = customDockSkin(hex);
      expect(skin.key).toBe('custom');
      expect(skin.colour).toBe(hex);
      const stops = skin.wash.colors.map(parse);
      for (const stop of stops) expect(stop).toEqual(stops[0]);
      expect(stops[0].a).toBeLessThan(1);
      // Flat means flat: no lit floor invented on a colour nobody shaded.
      expect(skin.lip).toBeNull();
    });

    test.each(COLOURS)('%s gets glyphs you can actually see', (hex) => {
      // THE rule for a user-chosen colour. inkOn is the same contrast check
      // the accent chip's glyph uses, so there is no colour you can pick that
      // leaves the dock's icons invisible — including the mid greys, which is
      // why the ink is heavier here than on the fixed skins.
      const skin = customDockSkin(hex);
      const ink = parse(skin.inactiveTint);
      const want = inkOn(hex) === '#FFFFFF' ? 255 : 0;
      expect(grey(ink)).toBe(want);
      // Composited over the colour it sits on — the number the eye sees.
      const base = parse(skin.wash.colors[0]);
      const seen = grey(ink) * ink.a + grey(base) * (1 - ink.a);
      expect(Math.abs(seen - grey(base))).toBeGreaterThan(70);
    });

    test.each(COLOURS)('%s frosts and edges the way its own value needs', (hex) => {
      const skin = customDockSkin(hex);
      const dark = inkOn(hex) === '#FFFFFF';
      expect(skin.blurTint).toBe(dark ? 'dark' : 'light');
      // A white hairline on a white bar is not an edge.
      expect(grey(parse(skin.edge))).toBe(dark ? 255 : 0);
    });

    test('a colour that is not a colour falls back rather than painting nothing', () => {
      for (const bad of [null, undefined, '', 'rebeccapurple', '#12', 42]) {
        expect(customDockSkin(bad).colour).toBe(DEFAULT_DOCK_COLOR);
      }
    });

    test('the default colour is not the accent’s job to supply', () => {
      // The chip travels ON this surface; same colour for both and the one
      // thing that has to stand out stops standing out.
      expect(parse(customDockSkin(undefined).wash.colors[0]).a).toBeGreaterThan(0.5);
      expect(DEFAULT_DOCK_COLOR).toMatch(/^#[0-9A-F]{6}$/);
    });

    test('dockSkin routes the colour through, and only for custom', () => {
      expect(dockSkin('custom', '#C8413B').colour).toBe('#C8413B');
      // A colour passed alongside a fixed skin changes nothing about it.
      expect(dockSkin('paper', '#C8413B')).toBe(dockSkin('paper'));
      expect(dockSkins('#C8413B')[2].colour).toBe('#C8413B');
    });
  });

  describe('the active glyph’s ink', () => {
    test('auto is the contrast check, for any accent', () => {
      for (const accent of ['#1F8A9B', '#F5E6A8', '#000000', '#FFFFFF', '#C8413B']) {
        expect(activeInk('auto', accent)).toBe(inkOn(accent));
      }
    });

    test('an override IGNORES the accent — that is the whole point of it', () => {
      // Including when the contrast check would have said the opposite. The
      // setting exists because on a mid-toned accent the two answers are close
      // enough that it is taste, and taste beats the formula.
      for (const accent of ['#1F8A9B', '#F5E6A8', '#000000', '#FFFFFF']) {
        expect(activeInk('light', accent)).toBe(INK_LIGHT);
        expect(activeInk('dark', accent)).toBe(INK_DARK);
      }
    });

    test('black is the app’s ink, not #000', () => {
      // True black on a saturated colour reads as a hole punched in the chip.
      expect(activeInk('dark', '#1F8A9B')).toBe('#1F2024');
    });

    test('a mode that is not a mode falls back to auto', () => {
      for (const bad of [null, undefined, '', 'white', 42]) {
        expect(activeInk(bad, '#1F8A9B')).toBe(inkOn('#1F8A9B'));
      }
      expect(DOCK_INKS).toContain(DEFAULT_DOCK_INK);
    });
  });

  test('an unknown or missing skin name still paints a dock', () => {
    // The name comes out of AsyncStorage. A build that renames a skin would
    // otherwise leave everyone who chose it with a nav bar made of undefined.
    for (const bad of ['neon', '', null, undefined, 42, {}]) {
      expect(dockSkin(bad)).toBe(dockSkin(DEFAULT_DOCK_STYLE));
    }
  });
});

describe('the active glyph\'s ink reads what it is sitting ON', () => {
  const { activeInk, DOCK_INKS, DOCK_INK_LABELS } = require('../dockSkins');
  const { INK_DARK, INK_LIGHT } = require('../../utils/accentColor');
  const PALE = '#FFE66D'; // a highlight colour that black reads on

  test('on the chip, auto is a contrast check against the highlight colour', () => {
    expect(activeInk('auto', PALE)).toBe(INK_DARK);
    expect(activeInk('auto', PALE, { underline: false, darkDock: true })).toBe(INK_DARK);
  });

  test('with the underline there is no chip: auto reads the DOCK', () => {
    // The bug: a pale highlight colour put a black glyph on a dark dock.
    expect(activeInk('auto', PALE, { underline: true, darkDock: true })).toBe(INK_LIGHT);
    expect(activeInk('auto', '#1F8A9B', { underline: true, darkDock: false })).toBe(INK_DARK);
  });

  test('white and black are fixed, whatever is under them', () => {
    expect(activeInk('light', PALE, { underline: true, darkDock: false })).toBe(INK_LIGHT);
    expect(activeInk('dark', PALE, { underline: true, darkDock: true })).toBe(INK_DARK);
  });

  test('custom is any colour, and white until one has been picked', () => {
    expect(activeInk('custom', PALE, { custom: '#ff00aa' }).toLowerCase()).toBe('#ff00aa');
    expect(activeInk('custom', PALE, { custom: 'not a colour' })).toBe(INK_LIGHT);
    expect(activeInk('custom', PALE)).toBe(INK_LIGHT);
  });

  test('all four are offered, each with a label', () => {
    expect(DOCK_INKS).toEqual(['auto', 'light', 'dark', 'custom']);
    for (const key of DOCK_INKS) expect(typeof DOCK_INK_LABELS[key]).toBe('string');
  });
});
