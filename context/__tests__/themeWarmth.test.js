// ThemeContext reaches AsyncStorage at IMPORT time (it restores the saved
// mode), so pulling the palette out of it drags the native module in with it.
// Mocked rather than worked around: the palette is what is under test, and
// where it happens to live is not this test's business.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { LIGHT_THEME_COLORS } from '../ThemeContext';

/**
 * The light page is warm by a BLUE DEFICIT — red and green level, blue below
 * them — and the size of that gap is the whole of the hue. Asserted as a
 * relationship, not as a hex: the exact colour is a taste call and will be
 * nudged again, but "warm, and only just" is the decision.
 */
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const deficit = (hex) => {
  const [r, g, b] = rgb(hex);
  return Math.round((r + g) / 2) - b;
};

const RAMP = ['background', 'surface', 'surfaceElevated', 'surfaceHighlight'];

describe('the light page is paper, not a lightbox', () => {
  test('it is off-white — never the brightest thing the screen can make', () => {
    expect(LIGHT_THEME_COLORS.background).not.toBe('#FFFFFF');
    const [r] = rgb(LIGHT_THEME_COLORS.background);
    // Still unmistakably a light page, though.
    expect(r).toBeGreaterThan(235);
  });

  test('warm, and only just: blue sits below red and green', () => {
    const d = deficit(LIGHT_THEME_COLORS.background);
    expect(d).toBeGreaterThan(0);
    // Past about six it stops reading as paper and starts reading as a tint
    // somebody chose.
    expect(d).toBeLessThanOrEqual(6);
  });

  // Warmth that fades as the surfaces get deeper is a ramp that changes hue as
  // it descends, and the eye reads that as two different papers rather than one
  // with shadows on it.
  test('every rung carries the same warmth', () => {
    const deficits = RAMP.map((k) => deficit(LIGHT_THEME_COLORS[k]));
    const spread = Math.max(...deficits) - Math.min(...deficits);
    expect(spread).toBeLessThanOrEqual(3);
  });

  // The relationship the whole light theme is built on, and every depth()
  // shadow is tuned against: a surface is a step DOWN from what carries it.
  test('the ramp steps down from the page, rung by rung', () => {
    const lums = RAMP.map((k) => rgb(LIGHT_THEME_COLORS[k]).reduce((a, b) => a + b, 0));
    for (let i = 1; i < lums.length; i += 1) expect(lums[i]).toBeLessThan(lums[i - 1]);
  });
});
