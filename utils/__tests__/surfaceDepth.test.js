/**
 * The depth token, and the two promises it makes: it is LIGHT-ONLY, and it is
 * SUBTLE. Both are easy to break by hand later — "just bump the opacity" is
 * how a soft falloff becomes a drawn edge, and dropping the mode check is how
 * dark mode gains 124 invisible shadow layers.
 */
import { depth, DEPTH, LEVELS, insetRule, ridgeRule, RULE_W } from '../surfaceDepth';

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

/**
 * A separator that reads as a GROOVE rather than a drawn line: a shadow
 * hairline with a highlight directly beneath it. One hairline can only ever be
 * a line someone drew ON the page; two are a line cut INTO it.
 */
describe('insetRule', () => {
  const light = { mode: 'light', colors: { border: 'rgba(0,0,0,0.1)' } };
  const dark = { mode: 'dark', colors: { border: 'rgba(255,255,255,0.1)' } };

  test('light gets TWO lines — the pair is the whole effect', () => {
    const r = insetRule(light);
    expect(r.borderTopWidth).toBeGreaterThan(0);
    expect(r.borderBottomWidth).toBeGreaterThan(0);
  });

  test('a shadow above and a highlight below, in that order', () => {
    const r = insetRule(light);
    // Upside down it is a ridge, not a groove — the order carries the meaning.
    expect(r.borderTopColor).toMatch(/^rgba\(0, 0, 0/);
    expect(r.borderBottomColor).toMatch(/^rgba\(255, 255, 255/);
  });

  // Same reason `depth()` returns nothing in dark mode: a white highlight on a
  // black page is not a groove, it is a white line.
  test('dark gets the plain hairline it always had', () => {
    const r = insetRule(dark);
    expect(r.borderTopWidth).toBeUndefined();
    expect(r.borderBottomColor).toBe(dark.colors.border);
  });

  // It must NOT set a height. The two borders already give a childless View
  // exactly the right one — and a `height: 0` in here is a footgun: spread onto
  // a header CONTAINER by mistake it collapses the header to nothing, which is
  // a bug that ships looking like a missing header rather than a bad style.
  test('it sets no height — the borders give a bare View the right one', () => {
    expect(insetRule(light).height).toBeUndefined();
    expect(insetRule(dark).height).toBeUndefined();
  });

  test('a missing theme degrades to the plain line rather than throwing', () => {
    expect(() => insetRule(undefined)).not.toThrow();
  });
});

/**
 * The same two hairlines the other way up. `insetRule` is a cut, `ridgeRule` is
 * an edge standing proud — the ORDER alone carries the whole meaning, which is
 * why neither may ever be "simplified" into a single line.
 */
describe('ridgeRule', () => {
  const light = { mode: 'light', colors: { border: 'rgba(0,0,0,0.1)' } };
  const dark = { mode: 'dark', colors: { border: 'rgba(255,255,255,0.1)' } };

  test('highlight on top, shadow beneath — the inverse of the groove', () => {
    const r = ridgeRule(light);
    expect(r.borderTopColor).toMatch(/^rgba\(255, 255, 255/);
    expect(r.borderBottomColor).toMatch(/^rgba\(0, 0, 0/);
  });

  // If these ever agree, one of them has been flattened into the other and the
  // page has two names for one thing.
  test('and it is genuinely the opposite, not a copy', () => {
    const ridge = ridgeRule(light);
    const groove = insetRule(light);
    expect(ridge.borderTopColor).toBe(groove.borderBottomColor);
    expect(ridge.borderTopColor).not.toBe(groove.borderTopColor);
  });

  test('dark mode takes the plain hairline it always had', () => {
    expect(ridgeRule(dark).borderTopWidth).toBeUndefined();
    expect(ridgeRule(dark).borderBottomColor).toBe(dark.colors.border);
  });

  test('it sets no height either, for the same reason', () => {
    expect(ridgeRule(light).height).toBeUndefined();
  });

  test('a missing theme degrades rather than throwing', () => {
    expect(() => ridgeRule(undefined)).not.toThrow();
  });
});

/**
 * Both rules are TWO lines, and the width is what decides whether they read as
 * two. At a hairline the pair sat a third of a point apart and most renderers
 * resolved them into one grey smudge — the very thing having two is meant to
 * avoid.
 */
describe('the rules are thick enough to be two lines', () => {
  const light = { mode: 'light', colors: { border: 'rgba(0,0,0,0.1)' } };

  test('each line is a whole point, not a hairline', () => {
    expect(RULE_W).toBe(1);
    expect(insetRule(light).borderTopWidth).toBe(RULE_W);
    expect(ridgeRule(light).borderBottomWidth).toBe(RULE_W);
  });

  // Still small: the pair is a line you notice the QUALITY of, not the weight.
  test('and the pair still reads as a line, not a bar', () => {
    const r = insetRule(light);
    expect(r.borderTopWidth + r.borderBottomWidth).toBeLessThanOrEqual(2);
  });

  test('both rules use the same width, so the two never disagree', () => {
    expect(ridgeRule(light).borderTopWidth).toBe(insetRule(light).borderTopWidth);
  });
});
