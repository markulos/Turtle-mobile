import {
  chipShadeStops,
  chipSheenStops,
  chipRecessStops,
  CHIP_SHADE,
  CHIP_SHEEN,
  CHIP_SHADE_SPAN,
  CHIP_SHEEN_SPAN,
  CHIP_RECESS_STEPS,
} from '../chipRecess';

/** 'rgba(r,g,b,a)' → the four numbers. */
const parse = (css) => {
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(css);
  if (!m) throw new Error(`not an rgba string: ${css}`);
  return { r: +m[1], g: +m[2], b: +m[3], a: +m[4] };
};

const alphas = (stops) => stops.colors.map((c) => parse(c).a);

describe('the active chip’s recess', () => {
  test('both washes are gradients the renderer will accept', () => {
    for (const wash of [chipShadeStops(), chipSheenStops()]) {
      expect(wash.colors).toHaveLength(wash.locations.length);
      expect(wash.colors.length).toBe(CHIP_RECESS_STEPS);
      expect(wash.locations[0]).toBe(0);
      expect(wash.locations[wash.locations.length - 1]).toBe(1);
      for (let i = 1; i < wash.locations.length; i += 1) {
        expect(wash.locations[i]).toBeGreaterThan(wash.locations[i - 1]);
      }
    }
  });

  test('the shade is solid at the chip’s top edge and gone by its own end', () => {
    // Backwards and it would darken the middle of the chip instead of the wall
    // under its top edge, which is the one cue the whole effect rests on.
    const a = alphas(chipShadeStops());
    expect(a[0]).toBe(CHIP_SHADE.a);
    expect(a[a.length - 1]).toBe(0);
    for (let i = 1; i < a.length; i += 1) expect(a[i]).toBeLessThan(a[i - 1]);
  });

  test('the sheen is the mirror — nothing at its top, lit at the chip’s bottom edge', () => {
    const a = alphas(chipSheenStops());
    expect(a[0]).toBe(0);
    expect(a[a.length - 1]).toBe(CHIP_SHEEN.a);
    for (let i = 1; i < a.length; i += 1) expect(a[i]).toBeGreaterThan(a[i - 1]);
  });

  test('reads as a well, not a stripe at each end: the shade outweighs the sheen', () => {
    // A lit bottom as strong as the shadowed top is two bands, not a depth.
    expect(CHIP_SHEEN.a).toBeLessThan(CHIP_SHADE.a * 0.75);
    expect(CHIP_SHEEN_SPAN).toBeLessThan(CHIP_SHADE_SPAN);
    // …and the two must not meet: a band of untouched accent in the middle is
    // what keeps the chip's own colour the thing the eye tracks along the dock.
    expect(CHIP_SHADE_SPAN + CHIP_SHEEN_SPAN).toBeLessThan(1);
  });

  test('the shade is black and the sheen is white — no tinting of the accent', () => {
    // Either one carrying a hue would drag the chip off whatever accent the
    // user picked in Settings, and differently for each accent.
    const sheen = chipSheenStops().colors;
    expect(parse(chipShadeStops().colors[0])).toMatchObject({ r: 0, g: 0, b: 0 });
    expect(parse(sheen[sheen.length - 1])).toMatchObject({ r: 255, g: 255, b: 255 });
  });

  test('eases out of both ends, which is what keeps a 30pt band from showing a seam', () => {
    const a = alphas(chipShadeStops(9));
    const steps = a.slice(1).map((v, i) => Math.abs(v - a[i]));
    const middle = steps[Math.floor(steps.length / 2)];
    expect(middle).toBeGreaterThan(steps[0] * 1.5);
    expect(middle).toBeGreaterThan(steps[steps.length - 1] * 1.5);
  });

  test('survives a nonsense step count rather than returning a broken gradient', () => {
    for (const bad of [0, 1, -4, NaN, undefined, 'six']) {
      const out = chipRecessStops(CHIP_SHADE, 'out', bad);
      expect(out.colors.length).toBeGreaterThanOrEqual(2);
      expect(out.colors).toHaveLength(out.locations.length);
      expect(parse(out.colors[0]).a).toBe(CHIP_SHADE.a);
      expect(parse(out.colors[out.colors.length - 1]).a).toBe(0);
    }
  });
});
