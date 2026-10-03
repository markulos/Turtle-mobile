// ThemeContext reaches AsyncStorage at IMPORT time (it restores the saved
// mode), so pulling anything out of it drags the native module in with it.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { blend } from '../ThemeContext';

/**
 * The accent as a FILL — the mix behind `theme.colors.surfaceAccent`.
 *
 * The one property that matters and is easy to lose is OPACITY. A translucent
 * fill composites against whatever is behind it, so the same token would be a
 * different colour on the page than it is over another card, and everything
 * drawn inside it would take the wash a second time. Lines can be translucent;
 * a fill cannot.
 */
const rgb = (css) => {
  const m = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(css);
  if (!m) throw new Error(`not an opaque rgb() colour: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};

const ORANGE = '#F97316';
const PAPER = '#EEECE9';
const NEAR_BLACK = '#0A0A0A';

describe('the accent wash', () => {
  test('is opaque — never an rgba the page shows through', () => {
    expect(blend(ORANGE, PAPER, 0.1)).toMatch(/^rgb\(/);
    expect(blend(ORANGE, NEAR_BLACK, 0.16)).toMatch(/^rgb\(/);
  });

  test('none of the accent is the surface itself, all of it is the accent', () => {
    expect(rgb(blend(ORANGE, PAPER, 0))).toEqual(rgb('rgb(238, 236, 233)'));
    expect(rgb(blend(ORANGE, PAPER, 1))).toEqual([249, 115, 22]);
  });

  test('a wash stays much nearer the surface than the accent', () => {
    // The card is thousands of times the area of the hairline around it. At a
    // line's strength the colour stops being a tint and becomes the subject.
    const [r, g, b] = rgb(blend(ORANGE, PAPER, 0.1));
    const [pr, pg, pb] = rgb('rgb(238, 236, 233)');
    for (const [got, base] of [[r, pr], [g, pg], [b, pb]]) {
      expect(Math.abs(got - base)).toBeLessThan(30);
    }
    // …but it is not a no-op either: the point is that you can SEE which
    // highlight the pond is on.
    expect(b).toBeLessThan(pb - 10);
  });

  test('it carries the accent\'s hue — warm accent, warmer card', () => {
    const [r, , b] = rgb(blend(ORANGE, PAPER, 0.1));
    expect(r).toBeGreaterThan(b);
  });

  test('a colour it cannot parse returns the surface, not an invalid string', () => {
    // RN renders an invalid colour as nothing at all, which is near-impossible
    // to spot. The palette is a mix of hex and rgba() strings, so this case is
    // reachable rather than theoretical.
    expect(blend('rgba(0,0,0,0.2)', PAPER, 0.1)).toBe(PAPER);
    expect(blend(ORANGE, 'rgba(0,0,0,0.2)', 0.1)).toBe('rgba(0,0,0,0.2)');
    expect(blend(null, PAPER, 0.1)).toBe(PAPER);
  });

  test('an out-of-range amount is clamped rather than wrapping', () => {
    expect(rgb(blend(ORANGE, PAPER, -1))).toEqual(rgb(blend(ORANGE, PAPER, 0)));
    expect(rgb(blend(ORANGE, PAPER, 9))).toEqual(rgb(blend(ORANGE, PAPER, 1)));
  });
});
