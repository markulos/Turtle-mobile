/**
 * The depth token, and the two promises it makes: it is LIGHT-ONLY, and it is
 * SUBTLE. Both are easy to break by hand later — "just bump the opacity" is
 * how a soft falloff becomes a drawn edge, and dropping the mode check is how
 * dark mode gains 124 invisible shadow layers.
 */
import { depth, DEPTH, LEVELS } from '../surfaceDepth';

const light = { mode: 'light' };
const dark = { mode: 'dark' };

describe('depth', () => {
  test('gives a light surface its shadow', () => {
    const d = depth(light, 'card');
    expect(d.shadowOpacity).toBe(0.06);
    expect(d.shadowRadius).toBe(8);
    expect(d.elevation).toBe(2);
  });

  test('gives a DARK surface nothing at all', () => {
    // A black shadow behind a near-black card on a black page is invisible; all
    // it costs is a layer per element, and Android's elevation draws a halo.
    // Spread unconditionally, this has to be an empty object.
    for (const level of LEVELS) expect(depth(dark, level)).toEqual({});
  });

  test('survives a missing theme rather than throwing into a stylesheet', () => {
    expect(depth(undefined)).toEqual({});
    expect(depth(null, 'card')).toEqual({});
  });

  test('defaults to the card level, and ignores a level nobody defined', () => {
    expect(depth(light)).toEqual(DEPTH.card);
    expect(depth(light, 'nonsense')).toEqual(DEPTH.card);
  });
});

describe('the values stay subtle', () => {
  test('no level is darker than a tenth of black, bar the sheet overlay', () => {
    for (const level of LEVELS) {
      expect(DEPTH[level].shadowOpacity).toBeLessThanOrEqual(0.12);
    }
    // A control should be barely there — it is pressable, not raised.
    expect(DEPTH.control.shadowOpacity).toBeLessThanOrEqual(0.05);
  });

  test('every shadow is a GRADIENT: spread much wider than it is offset', () => {
    // This is what makes it read as a soft falloff instead of a drawn edge. A
    // radius at or under the offset is a hard line under the element.
    for (const level of LEVELS) {
      const { shadowRadius, shadowOffset } = DEPTH[level];
      expect(shadowRadius).toBeGreaterThan(Math.abs(shadowOffset.height) * 1.5);
    }
  });

  test('the levels climb in the order they are named', () => {
    const order = ['control', 'card', 'raised', 'overlay'];
    expect(LEVELS).toEqual(order);
    for (let i = 1; i < order.length; i += 1) {
      expect(DEPTH[order[i]].shadowRadius).toBeGreaterThan(DEPTH[order[i - 1]].shadowRadius);
      expect(DEPTH[order[i]].elevation).toBeGreaterThan(DEPTH[order[i - 1]].elevation);
    }
  });

  test('the shadow is a blue-black, not a neutral one', () => {
    // A neutral black greys the pixels under it on a white page and reads as
    // dirt; a touch of blue reads as light.
    for (const level of LEVELS) {
      const c = DEPTH[level].shadowColor;
      const [r, g, b] = [c.slice(1, 3), c.slice(3, 5), c.slice(5, 7)].map((h) => parseInt(h, 16));
      expect(b).toBeGreaterThan(r);
      expect(b).toBeLessThan(0x40); // still a shadow, not a blue glow
    }
  });
});
