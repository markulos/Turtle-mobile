import { Animated } from 'react-native';

import {
  TAB_SWITCH_MS,
  TAB_SWITCH_SPEC,
  TAB_TRAVEL_PT,
  SCENE_SOLID_TO,
  SCENE_CLEAR_BY,
  forTabTurn,
} from '../dockMotion';

/**
 * What "not abrupt" means, as arithmetic.
 *
 * These are claims about the SHAPE of the tab transition, not about the exact
 * constants — the numbers are meant to be tuned on the phone, so every test
 * here is a band or a relationship. The one thing they do pin down is the pair
 * of properties that made the old transition read as a cut: motion that starts
 * at full speed, and a frame where neither page is really on screen.
 */

// The navigator hands the interpolator one Animated value per screen: 0 when
// that screen is focused, +1 when it sits to the right of the focused one, -1
// to the left. So a page part-way through a switch is just a progress value.
const sceneAt = (progress) => {
  const { sceneStyle } = forTabTurn({ current: { progress: new Animated.Value(progress) } });
  return {
    opacity: sceneStyle.opacity.__getValue(),
    translateX: sceneStyle.transform[0].translateX.__getValue(),
  };
};

describe('the tab switch curve', () => {
  it('is long enough to be followed and short enough not to be waited on', () => {
    expect(TAB_SWITCH_MS).toBeGreaterThanOrEqual(200);
    expect(TAB_SWITCH_MS).toBeLessThanOrEqual(320);
    expect(TAB_SWITCH_SPEC.config.duration).toBe(TAB_SWITCH_MS);
  });

  it('starts from rest — the first frames accelerate instead of jumping', () => {
    const { easing } = TAB_SWITCH_SPEC.config;
    expect(easing(0)).toBe(0);
    // One frame in (~6% of the duration) the page has barely left: that is the
    // difference from ease-out, whose velocity is at its maximum on frame one
    // and so covered ~17% of the travel in the same frame.
    expect(easing(1 / 16)).toBeLessThan(0.05);
  });

  it('lands soft — the last frames settle instead of stopping', () => {
    const { easing } = TAB_SWITCH_SPEC.config;
    expect(easing(1)).toBe(1);
    // Most of the move is done early and the tail is a settle, which is what
    // keeps a longer duration from reading as a slower app.
    expect(easing(0.5)).toBeGreaterThan(0.6);
    expect(easing(0.7)).toBeGreaterThan(0.9);
    // …and it never arrives before the end, so there is no dead stretch where
    // the duration is being spent on nothing.
    expect(easing(0.9)).toBeLessThan(1);
  });

  it('rises all the way, without overshooting', () => {
    const { easing } = TAB_SWITCH_SPEC.config;
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 1 / 32) {
      const v = easing(Math.min(1, t));
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });
});

describe('how a page moves through a switch', () => {
  it('sits still and solid when it is the focused page', () => {
    expect(sceneAt(0)).toEqual({ opacity: 1, translateX: 0 });
  });

  it('shows which way the selection went', () => {
    // A page to the right arrives from the right; one to the left, from the
    // left. The sign of progress IS the direction, so these cannot disagree.
    expect(sceneAt(1).translateX).toBe(TAB_TRAVEL_PT);
    expect(sceneAt(-1).translateX).toBe(-TAB_TRAVEL_PT);
    // Far enough to be a direction, short enough that a calm duration does not
    // turn into a slow slide.
    expect(TAB_TRAVEL_PT).toBeGreaterThanOrEqual(16);
    expect(TAB_TRAVEL_PT).toBeLessThanOrEqual(40);
  });

  it('travels in proportion to progress, both ways', () => {
    expect(sceneAt(0.5).translateX).toBeCloseTo(TAB_TRAVEL_PT / 2);
    expect(sceneAt(-0.5).translateX).toBeCloseTo(-TAB_TRAVEL_PT / 2);
  });

  it('is invisible once it is off the stage, and holds full opacity as it leaves', () => {
    expect(sceneAt(1).opacity).toBe(0);
    expect(sceneAt(-1).opacity).toBe(0);
    // No fade at all on the frames where the movement is being established:
    // the page starts moving before it starts going.
    expect(sceneAt(SCENE_SOLID_TO * 0.9).opacity).toBe(1);
    expect(sceneAt(-SCENE_SOLID_TO * 0.9).opacity).toBe(1);
    expect(sceneAt(SCENE_CLEAR_BY).opacity).toBe(0);
  });

  it('never leaves an empty frame where the content was', () => {
    // The two pages in a switch run this same curve in opposite directions, so
    // at every moment their progresses sum to 1 (or -1). The content area is
    // therefore covered iff the two opacities together always come to about 1 —
    // a true fade-through would dip to the app background in the middle and
    // read as a blink.
    for (let p = 0; p <= 1.0001; p += 1 / 32) {
      const together = sceneAt(Math.min(1, p)).opacity + sceneAt(Math.max(0, 1 - p)).opacity;
      expect(together).toBeGreaterThan(0.9);
    }
  });

  it('hands over in the middle of the move, not across the whole of it', () => {
    // Both pages at a bit over half: the dissolve itself is brief and sits
    // inside the travel, which is what stops the arriving page being washed
    // out most of the way in.
    const half = sceneAt(0.5).opacity;
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.8);
    expect(SCENE_SOLID_TO).toBeLessThan(SCENE_CLEAR_BY);
    expect(SCENE_CLEAR_BY).toBeLessThan(1);
  });
});
