import { DARK_THEME } from '../../context/ThemeContext';
import {
  PAGE_WASH_COLORS, PAGE_WASH_LOCATIONS, PAGE_WASH_START, PAGE_WASH_END, pageColor,
} from '../pageWash';

// ThemeContext restores the saved mode from AsyncStorage at IMPORT time, so
// importing DARK_THEME out of it drags the native module in. Mocked for the
// same reason themeWarmth.test.js mocks it: the palette is what matters here,
// not where it happens to live.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex) => rgb(hex).reduce((a, b) => a + b, 0);

/**
 * THE PAGE IS NOT `colors.background`, and this is what keeps that true.
 *
 * The dark token is pure #000000 and no screen shows it, because the wash lifts
 * the top of the page off it. Every surface that has to disappear INTO the page
 * has to ramp to the lifted colour instead — the Planner's header got this
 * wrong by filling itself with the token, and the calendar's top fade got it
 * wrong by fading to it. Both read as a true-black block on a page that is not
 * true black.
 */
describe('pageColor', () => {
  const dark = { colors: { background: '#000000' } };
  const light = { colors: { background: '#F5F3F0' } };

  test('on black it is NOT true black — that is the whole point', () => {
    const c = pageColor(dark);
    expect(c).not.toBe('#000000');
    // Lifted, but only just: past this it stops being a black page.
    expect(lum(c)).toBeLessThan(lum('#1A1A1A'));
    expect(lum(c)).toBeGreaterThan(0);
  });

  test('the lift is COOL, the way the wash is', () => {
    // The wash is a blue-tinted white, so blue has to come out above red —
    // the opposite relationship to the warm light page (see themeWarmth).
    const [r, , b] = rgb(pageColor(dark));
    expect(b).toBeGreaterThan(r);
  });

  test('on the light page it stays a light page, a shade cooler', () => {
    const c = pageColor(light);
    expect(c).not.toBe(light.colors.background);
    const [r, , b] = rgb(c);
    // The warm page's blue deficit is narrowed by a cool wash, not reversed
    // into a page that reads blue.
    expect(r).toBeGreaterThanOrEqual(b);
    expect(lum(c)).toBeGreaterThan(lum('#E0E0E0'));
  });

  test('it composites the REAL dark background, not a hardcoded black', () => {
    // If the token is ever re-based off pure black, the colour has to move with
    // it rather than quietly keeping a stale mix.
    expect(pageColor({ colors: DARK_THEME.colors })).toBe(pageColor(dark));
    expect(pageColor({ colors: { background: '#101010' } })).not.toBe(pageColor(dark));
  });

  test('a themeless call degrades to the dark page rather than throwing', () => {
    expect(() => pageColor(undefined)).not.toThrow();
    expect(pageColor(undefined)).toBe(pageColor(dark));
  });
});

describe('the wash itself', () => {
  test('it is derived from one set of stops, never written out twice', () => {
    expect(PAGE_WASH_COLORS).toHaveLength(PAGE_WASH_LOCATIONS.length);
    for (const c of PAGE_WASH_COLORS) expect(c).toMatch(/^rgba\(\d+, \d+, \d+, [\d.]+\)$/);
  });

  test('it only ever dissolves — strongest first, gone last', () => {
    const alpha = (c) => Number(c.match(/([\d.]+)\)$/)[1]);
    const alphas = PAGE_WASH_COLORS.map(alpha);
    for (let i = 1; i < alphas.length; i += 1) expect(alphas[i]).toBeLessThan(alphas[i - 1]);
    expect(alphas[alphas.length - 1]).toBe(0);
  });

  test('the alphas stay whisper-faint — a depth cue, not a gradient', () => {
    const alpha = (c) => Number(c.match(/([\d.]+)\)$/)[1]);
    // Past about a tenth it stops being atmosphere and starts being a tint
    // somebody chose, and `pageColor` becomes a visibly different grey.
    for (const c of PAGE_WASH_COLORS) expect(alpha(c)).toBeLessThanOrEqual(0.1);
  });

  test('it runs top-left to bottom-right, which is what puts it under the hood', () => {
    expect(PAGE_WASH_START.y).toBeLessThan(PAGE_WASH_END.y);
  });
});
