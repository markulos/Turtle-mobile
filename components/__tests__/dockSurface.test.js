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

  test('LIFTS all the way down, and never back up', () => {
    // The direction is the whole design: dark at the top edge, lightest at the
    // bottom. Run the other way — lit from above — and the capsule reads as a
    // lozenge bulging off the page, which is what this replaced.
    for (let i = 1; i < stops.length; i += 1) {
      expect(stops[i].a).toBeLessThanOrEqual(stops[i - 1].a);
      expect(stops[i].r).toBeGreaterThanOrEqual(stops[i - 1].r);
      expect(weight(stops[i])).toBeLessThan(weight(stops[i - 1]));
    }
  });

  test('eases out of both edges — which is what keeps it from reading as a band', () => {
    // A straight ramp would move by the same amount every step. This one moves
    // least at the ends and most in the middle: no rate change for the eye to
    // find where the wash meets the edge of the capsule.
    // Magnitudes: the ramp LIFTS, so every step is negative.
    const steps = stops.slice(1).map((s, i) => Math.abs(weight(s) - weight(stops[i])));
    const middle = steps[Math.floor(steps.length / 2)];
    expect(middle).toBeGreaterThan(steps[0] * 1.5);
    expect(middle).toBeGreaterThan(steps[steps.length - 1] * 1.5);
  });

  test('stays black over a light page — the LIT end included', () => {
    // The flat fill this replaced was 0.52, chosen so the capsule reads BLACK
    // rather than washed grey over a white page. Inverting the ramp moved the
    // light end to the bottom, where the old design had its anchor, so the
    // lightest stop is the one that has to be checked now.
    const lightest = stops[stops.length - 1];
    expect(lightest.a).toBeGreaterThanOrEqual(0.6);
    expect((lightest.r + lightest.g + lightest.b) / 3).toBeLessThan(40);
    const mean = stops.reduce((sum, s) => sum + s.a, 0) / stops.length;
    expect(mean).toBeGreaterThanOrEqual(0.52);
  });

  test('is a hint of depth, not a sweep', () => {
    // It ran at 0.32 of alpha across 28 points of value, which at 69pt tall was
    // a gradient you looked AT. Half that: enough to say which way the light
    // comes from, and no more.
    const spread = DOCK_SURFACE_TOP.a - DOCK_SURFACE_BOTTOM.a;
    expect(spread).toBeGreaterThan(0.06);
    expect(spread).toBeLessThanOrEqual(0.16);
    expect(DOCK_SURFACE_BOTTOM.r - DOCK_SURFACE_TOP.r).toBeLessThanOrEqual(22);
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
