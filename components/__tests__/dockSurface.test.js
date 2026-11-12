import {
  dockSurfaceStops,
  DOCK_SURFACE_TOP,
  DOCK_SURFACE_BOTTOM,
  DOCK_SURFACE_STEPS,
} from '../dockSurface';

/** 'rgba(r,g,b,a)' → the four numbers. */
const parse = (css) => {
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(css);
  if (!m) throw new Error(`not an rgba string: ${css}`);
  return { r: +m[1], g: +m[2], b: +m[3], a: +m[4] };
};

/** Perceived darkness of one stop over the page behind it: more ink, darker. */
const weight = (s) => s.a * (255 - (s.r + s.g + s.b) / 3);

describe('the dock capsule’s wash', () => {
  const { colors, locations } = dockSurfaceStops();
  const stops = colors.map(parse);

  test('is a gradient the renderer will accept', () => {
    expect(colors).toHaveLength(locations.length);
    expect(colors.length).toBe(DOCK_SURFACE_STEPS);
    expect(locations[0]).toBe(0);
    expect(locations[locations.length - 1]).toBe(1);
    // Strictly increasing: expo-linear-gradient is entitled to misbehave on a
    // locations array that repeats or goes backwards.
    for (let i = 1; i < locations.length; i += 1) {
      expect(locations[i]).toBeGreaterThan(locations[i - 1]);
    }
  });

  test('starts and ends EXACTLY on the two tuned colours', () => {
    // Sampling may round the middle however it likes; the ends are the design.
    expect(stops[0]).toEqual(DOCK_SURFACE_TOP);
    expect(stops[stops.length - 1]).toEqual(DOCK_SURFACE_BOTTOM);
  });

  test('gets darker all the way down, and never back up', () => {
    for (let i = 1; i < stops.length; i += 1) {
      expect(stops[i].a).toBeGreaterThanOrEqual(stops[i - 1].a);
      expect(stops[i].r).toBeLessThanOrEqual(stops[i - 1].r);
      expect(weight(stops[i])).toBeGreaterThan(weight(stops[i - 1]));
    }
  });

  test('eases out of both edges — which is what keeps it from reading as a band', () => {
    // A straight ramp would move by the same amount every step. This one moves
    // least at the ends and most in the middle: no rate change for the eye to
    // find where the wash meets the edge of the capsule.
    const steps = stops.slice(1).map((s, i) => weight(s) - weight(stops[i]));
    const middle = steps[Math.floor(steps.length / 2)];
    expect(middle).toBeGreaterThan(steps[0] * 1.5);
    expect(middle).toBeGreaterThan(steps[steps.length - 1] * 1.5);
  });

  test('stays black over a light page — the top edge included', () => {
    // The flat fill this replaced was 0.52, chosen so the capsule reads BLACK
    // rather than washed grey over a white page. The lifted top must not undo
    // that, and the average must not fall below it.
    expect(stops[0].a).toBeGreaterThanOrEqual(0.42);
    const mean = stops.reduce((sum, s) => sum + s.a, 0) / stops.length;
    expect(mean).toBeGreaterThanOrEqual(0.52);
  });

  test('is a visible difference, not a tint', () => {
    // The ask was "a little more contrasted": enough to see, not a stripe.
    const spread = DOCK_SURFACE_BOTTOM.a - DOCK_SURFACE_TOP.a;
    expect(spread).toBeGreaterThan(0.15);
    expect(spread).toBeLessThan(0.45);
  });

  test('survives a nonsense step count rather than returning a broken gradient', () => {
    for (const bad of [0, 1, -4, NaN, undefined, 'seven']) {
      const out = dockSurfaceStops(bad);
      expect(out.colors.length).toBeGreaterThanOrEqual(2);
      expect(out.colors).toHaveLength(out.locations.length);
      expect(parse(out.colors[0])).toEqual(DOCK_SURFACE_TOP);
      expect(parse(out.colors[out.colors.length - 1])).toEqual(DOCK_SURFACE_BOTTOM);
    }
  });
});
