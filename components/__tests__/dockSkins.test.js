import {
  DOCK_STYLES,
  DEFAULT_DOCK_STYLE,
  dockSkin,
  dockSkins,
} from '../dockSkins';

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

  test('an unknown or missing skin name still paints a dock', () => {
    // The name comes out of AsyncStorage. A build that renames a skin would
    // otherwise leave everyone who chose it with a nav bar made of undefined.
    for (const bad of ['neon', '', null, undefined, 42, {}]) {
      expect(dockSkin(bad)).toBe(dockSkin(DEFAULT_DOCK_STYLE));
    }
  });
});
