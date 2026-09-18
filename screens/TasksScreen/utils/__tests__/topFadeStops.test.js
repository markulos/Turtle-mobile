import { topFadeStops, CLEAR_RUN } from '../topFadeStops';

// The realistic case: ~90pt of margin above the month, 18pt of feather below
// the clip. Numbers come from monthLayout on a normal phone.
const INSET = 90;
const FEATHER = 18;
const TOTAL = INSET + FEATHER;

const alphaAt = ({ locations, alphas }, position) => {
  if (position <= locations[0]) return alphas[0];
  if (position >= locations[locations.length - 1]) return alphas[alphas.length - 1];
  for (let i = 1; i < locations.length; i += 1) {
    if (position <= locations[i]) {
      const span = locations[i] - locations[i - 1];
      const t = span === 0 ? 1 : (position - locations[i - 1]) / span;
      return alphas[i - 1] + t * (alphas[i] - alphas[i - 1]);
    }
  }
  return alphas[alphas.length - 1];
};

describe('topFadeStops', () => {
  const stops = topFadeStops(INSET, FEATHER);

  test('is completely clear at the header so the backdrop reaches it', () => {
    expect(alphaAt(stops, 0)).toBe(0);
  });

  test('keeps a third of the MARGIN clear — measured on the margin, not the band', () => {
    // A third of 90pt is 30pt; as a fraction of the 108pt band that is 0.278.
    // Measuring the clear run against the band instead would eat into it.
    const thirdOfMargin = (INSET * CLEAR_RUN) / TOTAL;
    expect(alphaAt(stops, thirdOfMargin)).toBeCloseTo(0, 5);
    expect(stops.locations[1]).toBeCloseTo(thirdOfMargin, 5);
  });

  // The whole point. The month list's top edge is a hard overflow clip, so the
  // page colour must be at FULL strength exactly there — a partial wash does
  // not hide a cut, it tints one, which is what sliced "September 2026" through
  // the middle of its glyphs.
  test('is fully opaque exactly on the clip', () => {
    expect(alphaAt(stops, INSET / TOTAL)).toBeCloseTo(1, 5);
  });

  test('lets go again by the end of the feather, so it never sits on the title', () => {
    expect(alphaAt(stops, 1)).toBe(0);
    // Half way through the feather it is already well on its way out.
    const midFeather = (INSET + FEATHER / 2) / TOTAL;
    expect(alphaAt(stops, midFeather)).toBeLessThan(0.6);
  });

  test('climbs monotonically from clear to the clip', () => {
    let prev = -1;
    for (let p = 0; p <= INSET / TOTAL; p += 0.02) {
      const a = alphaAt(stops, p);
      expect(a).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = a;
    }
  });

  test('positions are strictly increasing and in range', () => {
    const { locations, alphas } = stops;
    expect(locations).toHaveLength(alphas.length);
    for (let i = 1; i < locations.length; i += 1) {
      expect(locations[i]).toBeGreaterThan(locations[i - 1]);
    }
    expect(locations[0]).toBe(0);
    expect(locations[locations.length - 1]).toBe(1);
  });

  // A short margin would otherwise ask the ramp to go 0 → 1 across almost no
  // distance, which draws as a hard line of its own — trading one visible edge
  // for another.
  test('always leaves the ramp room to climb on a short margin', () => {
    const tight = topFadeStops(12, FEATHER);
    const edge = 12 / (12 + FEATHER);
    expect(edge - tight.locations[1]).toBeGreaterThanOrEqual(0.12 - 1e-9);
    expect(tight.locations[1]).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < tight.locations.length; i += 1) {
      expect(tight.locations[i]).toBeGreaterThan(tight.locations[i - 1]);
    }
  });

  test('with no feather it simply ends opaque on the clip', () => {
    const noTail = topFadeStops(INSET, 0);
    expect(alphaAt(noTail, 1)).toBe(1);
    expect(alphaAt(noTail, 0)).toBe(0);
  });

  test.each([[0, 0], [null, 0], [undefined, 0], [NaN, 0]])(
    'degrades to a harmless gradient for inset %p',
    (inset) => {
      const out = topFadeStops(inset, 0);
      expect(out.locations).toHaveLength(out.alphas.length);
      expect(out.alphas.every((a) => a === 0)).toBe(true);
    },
  );
});
