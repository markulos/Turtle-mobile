import { Animated } from 'react-native';
import {
  chromeOffsetNode,
  backToTopIntent,
  newFlingAnchor,
  FLING_UP_SPEED,
  BACK_TO_TOP_FROM,
  BACK_TO_TOP_HOME,
} from '../scrollChrome';

const MAX = 120;

// A rig around the real node. `at` scrolls to an offset and reads what the
// chrome would be — the same arithmetic the UI thread runs, evaluated here
// instead of natively.
const rig = () => {
  const y = new Animated.Value(0);
  const node = chromeOffsetNode(y, MAX);
  return {
    y,
    node,
    at(next) {
      y.setValue(next);
      return node.__getValue();
    },
  };
};

describe('chromeOffsetNode', () => {
  test('goes up with the page, one point per point', () => {
    const r = rig();
    expect(r.at(0)).toBe(0);
    expect(r.at(30)).toBeCloseTo(30);
    expect(r.at(31)).toBeCloseTo(31);
    expect(r.at(MAX)).toBeCloseTo(MAX);
  });

  test('stops when fully hidden, however much further you scroll', () => {
    const r = rig();
    expect(r.at(MAX * 3)).toBe(MAX);
    expect(r.at(MAX * 60)).toBe(MAX);
  });

  // The point of the simple rule: position depends on WHERE you are, not on
  // how you got there. Scrolling up a little deep in the list changes nothing.
  test('does not come back part-way up the list', () => {
    const r = rig();
    r.at(4000);
    expect(r.at(3800)).toBe(MAX);
    expect(r.at(400)).toBe(MAX);
  });

  test('is back exactly when the top of the page is', () => {
    const r = rig();
    r.at(4000);
    expect(r.at(MAX)).toBe(MAX);
    expect(r.at(40)).toBe(40);
    expect(r.at(0)).toBe(0);
  });

  test('rubber-banding above the top does not push it down', () => {
    const r = rig();
    expect(r.at(-80)).toBe(0);
  });

  test('a zero travel budget is a no-op, not a crash', () => {
    expect(chromeOffsetNode(new Animated.Value(0), 0).__getValue()).toBe(0);
    expect(chromeOffsetNode(new Animated.Value(0), undefined).__getValue()).toBe(0);
    expect(chromeOffsetNode(null, MAX).__getValue()).toBe(0);
  });
});

describe('backToTopIntent', () => {
  const VIEW = 800;
  const DEEP = VIEW * BACK_TO_TOP_FROM + 500;
  // A sample pair `ms` apart that travels `px` points upward.
  const flick = (anchor, fromY, px, ms) => {
    backToTopIntent(fromY, 0, anchor, VIEW);
    return backToTopIntent(fromY - px, ms, anchor, VIEW);
  };

  test('the first sample is only a reading', () => {
    expect(backToTopIntent(DEEP, 0, newFlingAnchor(), VIEW)).toBeNull();
  });

  test('a fast flick up, far from the top, offers the button', () => {
    expect(flick(newFlingAnchor(), DEEP, FLING_UP_SPEED * 16 * 2, 16)).toBe('show');
  });

  test('an ordinary drag up does not', () => {
    expect(flick(newFlingAnchor(), DEEP, 4, 16)).toBeNull();
  });

  test('a fast flick from less than the show distance offers nothing yet', () => {
    // Between the two thresholds: too far down to withdraw, not far enough to
    // be worth a shortcut.
    const shallow = VIEW * ((BACK_TO_TOP_HOME + BACK_TO_TOP_FROM) / 2);
    expect(flick(newFlingAnchor(), shallow, FLING_UP_SPEED * 16 * 2, 16)).toBeNull();
  });

  test('arriving near the top withdraws it', () => {
    const a = newFlingAnchor();
    expect(flick(a, DEEP, FLING_UP_SPEED * 16 * 2, 16)).toBe('show');
    expect(backToTopIntent(VIEW * BACK_TO_TOP_HOME, 32, a, VIEW)).toBe('hide');
  });

  test('turning round and flinging back down withdraws it', () => {
    const a = newFlingAnchor();
    expect(flick(a, DEEP, FLING_UP_SPEED * 16 * 2, 16)).toBe('show');
    expect(flick(a, DEEP, -FLING_UP_SPEED * 16 * 2, 16)).toBe('hide');
  });

  test('coasting keeps whatever the button was doing', () => {
    const a = newFlingAnchor();
    expect(flick(a, DEEP, FLING_UP_SPEED * 16 * 2, 16)).toBe('show');
    expect(backToTopIntent(DEEP - 40, 32, a, VIEW)).toBeNull();
  });

  // Thresholds are in viewports so "two screens down" travels between devices.
  test('scales its thresholds to the viewport', () => {
    const tall = 1400;
    const y = tall * BACK_TO_TOP_FROM + 100;
    const a = newFlingAnchor();
    backToTopIntent(y, 0, a, tall);
    expect(backToTopIntent(y - 40, 16, a, tall)).toBe('show');
    // The same offset on a tall screen is still "near the top" on a taller one.
    const b = newFlingAnchor();
    backToTopIntent(y, 0, b, y * 2);
    expect(backToTopIntent(y - 40, 16, b, y * 2)).toBe('hide');
  });

  test('survives a zero time step and a missing viewport', () => {
    const a = newFlingAnchor();
    backToTopIntent(DEEP, 5, a, VIEW);
    expect(backToTopIntent(DEEP - 40, 5, a, VIEW)).toBeNull();
    expect(backToTopIntent(9000, 6, newFlingAnchor(), undefined)).toBeNull();
  });
});
