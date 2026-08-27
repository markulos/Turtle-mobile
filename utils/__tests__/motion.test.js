// Tests for the shared motion vocabulary.
//
// Two things here can actually regress, and both are silent:
//
//   1. The tokens drifting apart again — specifically the RN Animated and
//      Reanimated bindings ending up with different names or different numbers,
//      which is the exact failure this module was built to stop. A curve that
//      exists on one engine and not the other is a crash at a call site nobody
//      exercised; a curve that exists on both with different control points is
//      two screens that move differently for no stated reason.
//
//   2. Reduced motion silently doing nothing. The RN Animated side has no
//      built-in support for it (unlike Reanimated, which resolves it on the UI
//      thread), so it only works because these helpers apply it — and a call
//      site that reaches past them loses the behaviour with no visible sign.
import { Animated, LayoutAnimation } from 'react-native';

import {
  BEZIER,
  DURATION,
  EASE,
  SHEET,
  SPRING,
  __setReduceMotionForTests,
  duration,
  isReduceMotionEnabled,
  layoutNext,
  spring,
  timing,
} from '../motion';

// Always land back on "animate normally" — the flag is module-level cache, so a
// leaked `true` would quietly make every later test assert against a 1ms world.
afterEach(() => {
  __setReduceMotionForTests(false);
  jest.restoreAllMocks();
});

describe('tokens', () => {
  it('gives every duration a positive, ordered value', () => {
    const scale = [
      DURATION.snap,
      DURATION.fast,
      DURATION.base,
      DURATION.settle,
      DURATION.slow,
      DURATION.deliberate,
      DURATION.breath,
    ];
    scale.forEach((ms) => {
      expect(typeof ms).toBe('number');
      expect(ms).toBeGreaterThan(0);
    });
    // The scale has to stay a scale: a "fast" that outlasts "base" makes every
    // name in it a lie.
    const sorted = [...scale].sort((a, b) => a - b);
    expect(scale).toEqual(sorted);
  });

  it('keeps the sheet leaving quicker than it arrives', () => {
    // Asymmetry is deliberate — a card that leaves as slowly as it arrives feels
    // like it is resisting being dismissed.
    expect(SHEET.out).toBeLessThan(SHEET.in);
    expect(SHEET.easing).toBe(EASE.sheet);
  });

  it('describes every bezier with four control points', () => {
    Object.entries(BEZIER).forEach(([name, points]) => {
      expect(Array.isArray(points)).toBe(true);
      expect(points).toHaveLength(4);
      points.forEach((n) => expect(Number.isFinite(n)).toBe(true));
      // Each one has to have actually been bound to an easing.
      expect(typeof EASE[name]).toBe('function');
    });
  });

  it('drives every spring config on the native driver', () => {
    Object.values(SPRING).forEach((cfg) => {
      expect(cfg.useNativeDriver).toBe(true);
    });
  });
});

describe('reduced motion', () => {
  it('reports the cached OS flag', () => {
    expect(isReduceMotionEnabled()).toBe(false);
    __setReduceMotionForTests(true);
    expect(isReduceMotionEnabled()).toBe(true);
  });

  it('leaves durations alone when the switch is off', () => {
    expect(duration(DURATION.base)).toBe(DURATION.base);
  });

  it('collapses durations to sub-frame when the switch is on', () => {
    __setReduceMotionForTests(true);
    // Not zero: the animation still has to run and still has to call back, so a
    // closing sheet un-mounts itself. It just must not be seen to travel.
    expect(duration(DURATION.base)).toBeGreaterThan(0);
    expect(duration(DURATION.base)).toBeLessThan(16);
    expect(duration(DURATION.deliberate)).toBeLessThan(16);
  });
});

describe('timing', () => {
  it('passes the requested duration and easing straight through', () => {
    const spy = jest.spyOn(Animated, 'timing').mockReturnValue({ start: jest.fn() });
    const value = new Animated.Value(0);

    timing(value, 1, { duration: SHEET.in, easing: SHEET.easing });

    expect(spy).toHaveBeenCalledWith(value, expect.objectContaining({
      toValue: 1,
      duration: SHEET.in,
      easing: SHEET.easing,
      useNativeDriver: true,
    }));
  });

  it('falls back to the house default rather than RN\'s 500ms', () => {
    const spy = jest.spyOn(Animated, 'timing').mockReturnValue({ start: jest.fn() });
    timing(new Animated.Value(0), 1);
    expect(spy.mock.calls[0][1].duration).toBe(DURATION.base);
    expect(spy.mock.calls[0][1].easing).toBe(EASE.standard);
  });

  it('shortens the duration when reduced motion is on', () => {
    __setReduceMotionForTests(true);
    const spy = jest.spyOn(Animated, 'timing').mockReturnValue({ start: jest.fn() });

    timing(new Animated.Value(0), 1, { duration: DURATION.deliberate });

    expect(spy.mock.calls[0][1].duration).toBeLessThan(16);
  });

  it('returns an unstarted animation, so sequence/loop still compose', () => {
    const anim = timing(new Animated.Value(0), 1, { duration: DURATION.fast });
    expect(typeof anim.start).toBe('function');
    expect(typeof anim.stop).toBe('function');
  });
});

describe('spring', () => {
  it('springs normally when motion is allowed', () => {
    const spy = jest.spyOn(Animated, 'spring').mockReturnValue({ start: jest.fn() });
    const value = new Animated.Value(0);

    spring(value, 0, SPRING.settle);

    expect(spy).toHaveBeenCalledWith(value, expect.objectContaining({
      toValue: 0,
      bounciness: SPRING.settle.bounciness,
      useNativeDriver: true,
    }));
  });

  it('never welds two spring vocabularies together', () => {
    // RN describes a spring three mutually exclusive ways and throws if a config
    // mixes them. Merging a default config into the caller's would do exactly
    // that — SPRING.settle's `bounciness` on top of SPRING.press's
    // `tension`/`friction` — so the config has to replace, not merge.
    const spy = jest.spyOn(Animated, 'spring').mockReturnValue({ start: jest.fn() });

    spring(new Animated.Value(0), 1, SPRING.press);

    const cfg = spy.mock.calls[0][1];
    const families = [
      'bounciness' in cfg || 'speed' in cfg,
      'tension' in cfg || 'friction' in cfg,
      'stiffness' in cfg || 'damping' in cfg || 'mass' in cfg,
    ].filter(Boolean);
    expect(families).toHaveLength(1);
  });

  it('falls back to the settle config when given none', () => {
    const spy = jest.spyOn(Animated, 'spring').mockReturnValue({ start: jest.fn() });
    spring(new Animated.Value(0), 0);
    expect(spy.mock.calls[0][1]).toEqual(
      expect.objectContaining({ bounciness: SPRING.settle.bounciness }),
    );
  });

  it('degrades to a straight cut when reduced motion is on', () => {
    // A spring has no duration to shorten, so the only honest way to honour the
    // setting is to stop springing.
    __setReduceMotionForTests(true);
    const springSpy = jest.spyOn(Animated, 'spring').mockReturnValue({ start: jest.fn() });
    const timingSpy = jest.spyOn(Animated, 'timing').mockReturnValue({ start: jest.fn() });

    spring(new Animated.Value(0), 0, SPRING.settle);

    expect(springSpy).not.toHaveBeenCalled();
    expect(timingSpy.mock.calls[0][1].duration).toBeLessThan(16);
  });
});

describe('layoutNext', () => {
  it('configures the app default when called bare', () => {
    const spy = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => {});
    layoutNext();
    expect(spy).toHaveBeenCalledWith(LayoutAnimation.Presets.easeInEaseOut);
  });

  it('keeps a bespoke config', () => {
    const spy = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => {});
    const custom = { duration: 120, update: { type: 'linear' } };
    layoutNext(custom);
    expect(spy).toHaveBeenCalledWith(custom);
  });

  it('does nothing at all when reduced motion is on', () => {
    // There is no "short" LayoutAnimation worth having — the point is that the
    // rows simply appear where they now belong.
    __setReduceMotionForTests(true);
    const spy = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => {});
    layoutNext();
    expect(spy).not.toHaveBeenCalled();
  });
});
