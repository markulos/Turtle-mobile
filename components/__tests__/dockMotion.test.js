import { Animated } from 'react-native';

import {
  CHIP_SLIDE_BASE_MS,
  CHIP_SLIDE_MAX_MS,
  chipSlideMs,
  TAB_SWITCH_BEZIER,
  PRESS_BEZIER,
  PRESS_SCALE,
  PRESS_IN_MS,
  PRESS_OUT_MS,
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
 * here is a band or a relationship.
 *
 * The frame-one property has been pinned BOTH WAYS over this file's life, and
 * the current answer is the one Mark gave looking at the phone: the chip must
 * LEAVE on the first frame, because a selection that eases in reads as the
 * navbar hesitating. The earlier suite asserted the exact opposite for the
 * same curve — see dockMotion's own header for why that was right about pages
 * and wrong about the chip. The press is the one mover that still must not
 * jump, and it has its own control points now.
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

/**
 * A turn is TWO scenes at once: the one leaving runs 0 → +1 (or 0 → -1) while
 * the one arriving runs from the opposite side to 0. `at` is how far through
 * the turn we are, 0 → 1.
 */
const bothScenesAt = (at) => ({
  leaving: sceneAt(at).opacity,
  arriving: sceneAt(at - 1).opacity,
});

describe('what the turn shows THROUGH itself', () => {
  it('has a window where NEITHER page is opaque — hence the app backdrop', () => {
    // This is not a bug in the curve: the gap is what makes a turn read as a
    // dissolve rather than a cut, and it is deliberate (see SCENE_SOLID_TO).
    //
    // It is, however, the reason App.js must paint ONE OPAQUE LAYER behind the
    // navigator. Each scene's own background is inside the view being faded,
    // so it goes translucent with it, and whatever sits under the navigator is
    // what you actually see mid-turn. Left to the native root that is WHITE,
    // and every tab change in dark mode flashed pale.
    const mid = bothScenesAt(0.5);
    expect(mid.leaving).toBeLessThan(1);
    expect(mid.arriving).toBeLessThan(1);

    // And stacking them does not save it. Their opacities sum to 1 at the
    // midpoint, which LOOKS like full cover and is not: alpha composites
    // rather than adds, so two layers at a and b leave (1-a)(1-b) of whatever
    // is underneath showing through. Both sit at ~0.57 here, which covers
    // ~0.82 — so nearly a fifth of the backdrop is visible at the worst frame,
    // and over white that is the flash.
    const covered = 1 - (1 - mid.leaving) * (1 - mid.arriving);
    expect(covered).toBeLessThan(0.9);
    expect(covered).toBeGreaterThan(0.6);
  });

  it('the window is in the MIDDLE, not at either end', () => {
    // At both ends one page is fully solid, which is what stops the backdrop
    // from ever being the thing you are looking at.
    expect(bothScenesAt(0).leaving).toBe(1);
    expect(bothScenesAt(1).arriving).toBe(1);
  });
});

describe('the tab switch curve', () => {
  it('is long enough to be followed and short enough not to be waited on', () => {
    // A decelerating move wants to be shorter than a soft-started one: the
    // tail is the part you watch, so the same 260ms here read as drifting.
    expect(TAB_SWITCH_MS).toBeGreaterThanOrEqual(160);
    expect(TAB_SWITCH_MS).toBeLessThanOrEqual(260);
    expect(TAB_SWITCH_SPEC.config.duration).toBe(TAB_SWITCH_MS);
  });

  it('leaves on the first frame — there is no ease-in to sit through', () => {
    const { easing } = TAB_SWITCH_SPEC.config;
    expect(easing(0)).toBe(0);
    // One frame in (~8% of the duration) the chip is visibly on its way. The
    // curve this replaced had covered 1.7% by here, which is what Mark read
    // as the navbar hesitating after the tap.
    expect(easing(1 / 12)).toBeGreaterThan(0.15);
    // No ease-in at all: x1 and y1 are both zero, so there is no first stretch
    // spent getting up to speed.
    expect(TAB_SWITCH_BEZIER[0]).toBe(0);
    expect(TAB_SWITCH_BEZIER[1]).toBe(0);
  });

  it('lands soft — the last frames settle instead of stopping', () => {
    const { easing } = TAB_SWITCH_SPEC.config;
    expect(easing(1)).toBe(1);
    // Most of the move is done early and the tail is a settle, which is what
    // keeps the arrival from reading as a stop.
    expect(easing(0.5)).toBeGreaterThan(0.6);
    expect(easing(0.7)).toBeGreaterThan(0.9);
    // …and it never arrives before the end, so there is no dead stretch where
    // the duration is being spent on nothing.
    expect(easing(0.9)).toBeLessThan(1);
    // The landing is soft because the SECOND control point says so, which is
    // the half of the old curve that survived.
    expect(TAB_SWITCH_BEZIER[3]).toBe(1);
  });

  it('moves the chip on a shorter clock than the pages', () => {
    // Set by eye on the phone: the chip is a small object the thumb is
    // already looking at, so the duration that reads as a turn on a whole
    // screen reads as a delay on it. They share the curve, not the clock.
    expect(CHIP_SLIDE_MAX_MS).toBeLessThanOrEqual(TAB_SWITCH_MS + 40);
    expect(chipSlideMs(1)).toBeLessThan(TAB_SWITCH_MS);
    // Bounded from both sides because both were tried: 200 read as a delay,
    // 75 was too fast to follow, and 160 is where a two-slot move landed.
    expect(chipSlideMs(2)).toBe(160);
  });

  it('takes longer the further it goes — the dock is ONE object', () => {
    // The thing that read as erratic: a fixed duration makes a one-slot hop
    // and a run across the whole dock the same move at five times the speed.
    // Every platform spec says the same thing here — duration grows with
    // distance — and this is that, as arithmetic.
    expect(chipSlideMs(1)).toBeLessThan(chipSlideMs(2));
    expect(chipSlideMs(2)).toBeLessThan(chipSlideMs(5));
    // …but SUB-linearly. True constant velocity would put a dock-wide move
    // past 600ms, which is no longer motion, it is waiting.
    expect(chipSlideMs(5)).toBeLessThan(chipSlideMs(1) * 5);
    expect(chipSlideMs(5)).toBeLessThanOrEqual(CHIP_SLIDE_MAX_MS);
    // The speed spread is what the eye actually reads. Fixed, it was 5x.
    const slow = (1 * 67) / chipSlideMs(1);
    const fast = (5 * 67) / chipSlideMs(5);
    expect(fast / slow).toBeLessThan(3);
  });

  it('never returns a duration of nothing, whatever it is handed', () => {
    // Direction is not distance: a move left is as long as a move right.
    expect(chipSlideMs(-3)).toBe(chipSlideMs(3));
    // A settle under a lifted thumb is a fraction of a slot, and still has
    // to take a moment — a zero-length animation is a jump.
    expect(chipSlideMs(0)).toBe(CHIP_SLIDE_BASE_MS);
    expect(chipSlideMs(0.4)).toBeGreaterThan(CHIP_SLIDE_BASE_MS);
    expect(chipSlideMs(undefined)).toBe(CHIP_SLIDE_BASE_MS);
    expect(chipSlideMs(Number.NaN)).toBe(CHIP_SLIDE_BASE_MS);
    // And it cannot run away on a navigator with a lot of tabs.
    expect(chipSlideMs(40)).toBe(CHIP_SLIDE_MAX_MS);
  });

  it('is a third of the way through on the chip first frame', () => {
    // Enough that the move has visibly begun before the eye settles, little
    // enough that there are still frames of travel to watch. Checked at the
    // shortest clock, which is where a first frame covers the most ground.
    const { easing } = TAB_SWITCH_SPEC.config;
    const firstFrame = easing((1000 / 60) / CHIP_SLIDE_BASE_MS);
    expect(firstFrame).toBeGreaterThan(0.2);
    expect(firstFrame).toBeLessThan(0.5);
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

describe('the press', () => {
  it('is a swell, not a pop — under two points on a 370pt bar', () => {
    const bar = 370;
    expect(PRESS_SCALE).toBeGreaterThan(1);
    // Mark asked for "ever so slightly" and "very subtle". Past ~3% of a bar
    // this wide the capsule stops looking lifted and starts looking resized.
    expect(PRESS_SCALE).toBeLessThan(1.03);
    expect((PRESS_SCALE - 1) * bar).toBeLessThan(6);
    // …and enough that the edge visibly moves against the screen edge it is
    // parallel to. Below about a point it is indistinguishable from nothing.
    expect((PRESS_SCALE - 1) * bar).toBeGreaterThan(1.5);
  });

  it('answers faster than it lets go', () => {
    // Pressing is a thing you did; releasing is a thing that stops. A release
    // that snaps back draws the eye to the end of an interaction instead of
    // to its result.
    expect(PRESS_IN_MS).toBeLessThan(PRESS_OUT_MS);
    // Both inside the band where motion still reads as a response rather than
    // as a wait.
    expect(PRESS_IN_MS).toBeGreaterThan(60);
    expect(PRESS_OUT_MS).toBeLessThan(300);
  });

  it('starts from REST in both directions — unlike the chip', () => {
    // A press is a SIZE changing under a finger that is already resting on
    // it. An ease-out press would be at full speed on its first frame: the
    // bar would not grow, it would jump to grown, which reads as a twitch.
    // The chip moves the other way round on purpose (see the suite above), so
    // the press has its own control points and this is where that is held.
    expect(PRESS_BEZIER[1]).toBe(0);     // zero slope at t=0: it starts still
    expect(PRESS_BEZIER[0]).toBeGreaterThan(0);
    expect(PRESS_BEZIER).not.toEqual(TAB_SWITCH_BEZIER);
    expect(PRESS_IN_MS).toBeGreaterThan(0);
    expect(PRESS_OUT_MS).toBeGreaterThan(0);
  });
});
