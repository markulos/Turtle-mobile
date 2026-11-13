import React from 'react';
import { Dimensions } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { CARD_MARGIN_H, TAB_SLOT, clusterStart } from '../tabBarLayout';

// The pan the dock built, so a test can actually drag it. A chain() stub would
// let the whole gesture be wired to nothing and still pass.
const mockPan = {};
jest.mock('react-native-gesture-handler', () => {
  const api = {
    maxPointers: () => api,
    activeOffsetX: () => api,
    onBegin: (fn) => { mockPan.onBegin = fn; return api; },
    onStart: (fn) => { mockPan.onStart = fn; return api; },
    onUpdate: (fn) => { mockPan.onUpdate = fn; return api; },
    onEnd: (fn) => { mockPan.onEnd = fn; return api; },
    onFinalize: (fn) => { mockPan.onFinalize = fn; return api; },
  };
  return {
    Gesture: { Pan: () => api },
    GestureDetector: ({ children }) => children,
  };
});

// The real bar is react-navigation's, and this file is about the gesture over
// it — not about re-testing the library's rendering.
jest.mock('@react-navigation/bottom-tabs', () => ({ BottomTabBar: () => null }));

// The app-wide back-swipe guard. Mocked rather than exercised: what this file
// is responsible for is that the dock TAKES it for the length of a drag and
// gives it back — the guard's own counting has its own test.
const releaseSwipe = jest.fn();
const holdSwipe = jest.fn(() => releaseSwipe);
jest.mock('../../utils/edgeSwipeGuard', () => ({ holdEdgeSwipe: () => mockHoldSwipe() }));
global.mockHoldSwipe = () => holdSwipe();

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock');
  return {
    ...mock,
    // The press lift is written through withTiming on the UI thread; in here
    // it lands immediately, which is what lets a test read the end state.
    withTiming: (to) => to,
    // The gesture's callbacks are worklets on device; here they run inline, so
    // runOnJS has to be the identity rather than a queue.
    runOnJS: (fn) => fn,
    useSharedValue: (init) => ({ value: init }),
  };
});

import DockTabBar from '../DockTabBar';

const NAMES = ['Tasks', 'Notes', 'Photos', 'Vault', 'Turtle', 'Profile'];
const WIDTH = Dimensions.get('window').width;

/** The x, in window coords, of the icon in slot `i`. */
const onIcon = (i) =>
  CARD_MARGIN_H + clusterStart(WIDTH - CARD_MARGIN_H * 2, NAMES.length) + TAB_SLOT * i + TAB_SLOT / 2;

const buildProps = (index = 0) => {
  const routes = NAMES.map((name, i) => ({ key: `${name}-${i}`, name }));
  return {
    state: { key: 'tabs-1', index, routes, routeNames: NAMES, preloadedRouteKeys: [] },
    navigation: { dispatch: jest.fn(), emit: jest.fn() },
    descriptors: Object.fromEntries(routes.map((r) => [r.key, { options: {}, route: r }])),
    insets: { top: 59, right: 0, bottom: 34, left: 0 },
  };
};

/** Which route a recorded dispatch is asking for. */
const navigatedTo = (dispatch) =>
  dispatch.mock.calls.map(([action]) => action.payload?.key ?? action.payload?.name);

/** Lift the thumb: the real gesture runs both, in this order. */
const lift = () => {
  act(() => { mockPan.onEnd(); });
  act(() => { mockPan.onFinalize(); });
};

beforeEach(() => { holdSwipe.mockClear(); releaseSwipe.mockClear(); });

test('the chip tracks the thumb 1:1, and NOTHING changes tabs until it lifts', async () => {
  const props = buildProps(0);
  const dragSlot = { value: -1 };
  const leadSlot = { value: -1 };
  await render(<DockTabBar {...props} dragSlot={dragSlot} leadSlot={leadSlot} />);

  // Finger down on the first icon and the drag begins: the chip takes over
  // from the navigator, at the slot it is already on.
  act(() => { mockPan.onStart({ absoluteX: onIcon(0) }); });
  expect(dragSlot.value).toBe(0);
  expect(props.navigation.dispatch).not.toHaveBeenCalled();
  // A scrub along the dock is a rightward drag, which is the same shape as
  // the back-swipe every pushed page listens for. The dock takes the guard
  // for the duration, or dragging the chip closes the page underneath it.
  expect(holdSwipe).toHaveBeenCalledTimes(1);
  expect(releaseSwipe).not.toHaveBeenCalled();

  // Halfway to Notes: the chip is a FRACTION of the way across, which is the
  // whole point of tracking a finger rather than hopping between slots.
  act(() => { mockPan.onUpdate({ absoluteX: (onIcon(0) + onIcon(1)) / 2 - 2 }); });
  expect(dragSlot.value).toBeGreaterThan(0.4);
  expect(dragSlot.value).toBeLessThan(0.5);

  // Across four icons, parking on each, wobbling in the gaps the way a thumb
  // does. The chip follows all of it…
  const gap = (onIcon(1) + onIcon(2)) / 2;
  [onIcon(1), onIcon(1) + 3, gap - 3, gap + 2, gap - 1, onIcon(2), onIcon(4)]
    .forEach((x) => { act(() => { mockPan.onUpdate({ absoluteX: x }); }); });
  expect(dragSlot.value).toBeCloseTo(4);

  // …and not one of those crossings changed a tab. This is the thing the page
  // and the icon colours both hang off: a scrub used to be five navigates, so
  // five page transitions and five sets of icons lighting and unlighting under
  // a thumb that had not decided anything yet.
  expect(props.navigation.dispatch).not.toHaveBeenCalled();
  expect(leadSlot.value).toBe(-1);

  // Right off the end of the capsule and then off the other end: the thumb
  // holds the end tab instead of scrubbing into slots that do not exist, and
  // the chip never leaves the dock.
  act(() => { mockPan.onUpdate({ absoluteX: WIDTH + 400 }); });
  expect(dragSlot.value).toBe(NAMES.length - 1);
  act(() => { mockPan.onUpdate({ absoluteX: -400 }); });
  expect(dragSlot.value).toBe(0);
  act(() => { mockPan.onUpdate({ absoluteX: onIcon(4) + TAB_SLOT * 0.3 }); });
  expect(props.navigation.dispatch).not.toHaveBeenCalled();

  // Thumb up. ONE navigate, for the nearest tab to where it let go — 4.3 of a
  // slot is Turtle, not Profile — and the chip is handed back to the navigator.
  lift();
  expect(navigatedTo(props.navigation.dispatch)).toEqual(['Turtle-4']);
  expect(dragSlot.value).toBe(-1);

  // The lift also wrote where it landed, BEFORE React has heard a thing. That
  // is what the chip aims at for the few frames the navigator takes to agree;
  // without it the chip flicks back to the old tab on its way to the new one.
  expect(leadSlot.value).toBe(4);

  // Aimed at THIS navigator, the way BottomTabBar aims its own: an action
  // without a target is handled by whichever navigator feels like it.
  expect(props.navigation.dispatch.mock.calls[0][0].target).toBe('tabs-1');

  // …and the guard goes back. A leaked hold kills back-navigation app-wide
  // for the rest of the session, with nothing on screen to explain it.
  expect(releaseSwipe).toHaveBeenCalledTimes(1);
});

test('a scrub that comes home is not a tab change', async () => {
  const props = buildProps(2);
  const dragSlot = { value: -1 };
  await render(<DockTabBar {...props} dragSlot={dragSlot} />);

  act(() => { mockPan.onStart({ absoluteX: onIcon(2) }); });
  [onIcon(0), onIcon(5), onIcon(2)].forEach((x) => {
    act(() => { mockPan.onUpdate({ absoluteX: x }); });
  });
  lift();

  // You can run the length of the dock and come back without having chosen
  // anything: the tab you are on is the tab you keep.
  expect(props.navigation.dispatch).not.toHaveBeenCalled();
  expect(dragSlot.value).toBe(-1);
});

test('a gesture the system cancels chooses nothing', async () => {
  const props = buildProps(0);
  const dragSlot = { value: -1 };
  const leadSlot = { value: -1 };
  await render(<DockTabBar {...props} dragSlot={dragSlot} leadSlot={leadSlot} />);

  act(() => { mockPan.onStart({ absoluteX: onIcon(0) }); });
  act(() => { mockPan.onUpdate({ absoluteX: onIcon(3) }); });
  // A call arriving, a modal taking the touch: onFinalize fires WITHOUT onEnd.
  // Landing the user on a tab they never released on would be the app
  // deciding for them.
  act(() => { mockPan.onFinalize(); });

  expect(props.navigation.dispatch).not.toHaveBeenCalled();
  expect(leadSlot.value).toBe(-1);
  expect(dragSlot.value).toBe(-1);
  // Cancelled, not lifted — and the guard still has to come back, or a call
  // arriving mid-scrub permanently disables the back-swipe.
  expect(releaseSwipe).toHaveBeenCalledTimes(1);
});

describe('the dock answers the touch', () => {
  // READ AS SOURCE, not driven as a gesture. The press lift is a shared value
  // written from a worklet, and this file's harness registers the gesture
  // chain once for the whole file — so a second test that mounts the bar gets
  // the FIRST test's callbacks and writes to a shared value it cannot see.
  // Driving it here would assert on the wrong object and pass or fail for
  // reasons that have nothing to do with the dock.
  //
  // What matters is wiring, and wiring is visible: WHICH callbacks touch the
  // lift. The numbers it animates between are dockMotion's, and they are
  // tested there as values.
  const SRC = require('fs').readFileSync(
    require('path').resolve(__dirname, '..', 'DockTabBar.jsx'), 'utf8',
  );
  const bodyOf = (name) => {
    const at = SRC.indexOf(`.${name}((`);
    if (at < 0) return '';
    // Up to the next chained callback — `\n    .` is the chain's own indent.
    return SRC.slice(at, SRC.indexOf('\n    .', at + 1));
  };

  test('the scan can see the callbacks at all', () => {
    // Every check below is a `not.toMatch` away from passing on an empty
    // string. If the chain is ever reformatted, this is the one that says so
    // rather than the suite quietly asserting nothing.
    for (const cb of ['onBegin', 'onStart', 'onUpdate', 'onEnd', 'onFinalize']) {
      expect(bodyOf(cb).length).toBeGreaterThan(20);
    }
  });

  test('the TOUCH LANDING raises it — onBegin, not onStart', () => {
    // onStart fires only once the pan ACTIVATES, which a tap never does.
    // Wired there, tapping a tab would get no acknowledgement at all and
    // only a drag would feel alive.
    expect(bodyOf('onBegin')).toMatch(/press\.value\s*=\s*withTiming\(1/);
    expect(bodyOf('onStart')).not.toMatch(/press\.value/);
  });

  test('it HOLDS for the length of a scrub rather than blinking at the start', () => {
    // The lift belongs to the finger being down, so the per-frame callback
    // must not touch it: nothing to re-trigger, nothing to decay.
    expect(bodyOf('onUpdate')).not.toMatch(/press\.value/);
    expect(bodyOf('onEnd')).not.toMatch(/press\.value/);
  });

  test('and it comes back down on FINALIZE, so a cancelled gesture is not stuck', () => {
    // onEnd is a real lift; onFinalize is that plus every way a gesture can
    // die — a call arriving, a modal taking the touch. The dock must not be
    // left parked at its pressed size for the rest of the session.
    expect(bodyOf('onFinalize')).toMatch(/press\.value\s*=\s*withTiming\(0/);
  });

  test('the scale is applied to the one view that holds the bar AND its buttons', () => {
    // Scaling the chip separately would multiply its 1:1 drag tracking and
    // slide it off the glyph under the thumb.
    expect(SRC).toMatch(/testID="dock-press-layer"[\s\S]{0,200}pressStyle/);
    expect(SRC).toMatch(/pressStyle[\s\S]{0,200}BottomTabBar/);
  });
});
