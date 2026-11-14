import React from 'react';
import { Dimensions } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { BAR_CONTENT_HEIGHT, CARD_MARGIN_H, TAB_SLOT, clusterStart } from '../tabBarLayout';
import { CHIP_SLIDE_MAX_MS } from '../dockMotion';

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

import DockTabBar, { LEAD_GUARD_MS, TAP_COMPLETE_MS } from '../DockTabBar';

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

/**
 * EVERY `act` IN THIS FILE IS AWAITED, AND THAT IS LOAD-BEARING.
 *
 * RNTL's `act` is async here (the same reason `render` is awaited throughout
 * this repo). Calling it without awaiting leaves React's act scope OPEN, and
 * from that point on every `render()` in the file returns a null tree — the
 * component never mounts and never runs.
 *
 * It fails silently, which is why it survived: tests 2-5 of this file were
 * driving the callbacks test 1 had registered, against shared values those
 * callbacks had never heard of, and every assertion of the form "this stayed
 * at -1" passed because nothing had touched the object. Four tests were
 * asserting nothing at all. React says so — "You called act(async () => ...)
 * without await" — but it says it as a console.error, which a passing suite
 * does not stop for.
 *
 * So: `await act(...)`, `await touchDown(...)`, `await lift()`. The helpers
 * below are async for that reason alone, and `mount()` fails loudly if a
 * mount did not take.
 */

/** Put the thumb down: onBegin fires for EVERY touch, drag or tap, and is
 *  where the dock takes its holds. A test that skips it is testing a gesture
 *  the device never produces. */
const touchDown = async (x, y = BAR_CONTENT_HEIGHT / 2) => {
  // `y` defaults to mid-capsule: the band where the buttons actually are. The
  // gesture's wrapper is taller than that (see slotUnderTouch), so a touch
  // without a y is not a touch the device can produce.
  await act(() => { mockPan.onBegin({ absoluteX: x, x, y }); });
};

/** Lift the thumb: the real gesture runs both, in this order. */
const lift = async () => {
  await act(() => { mockPan.onEnd(); });
  await act(() => { mockPan.onFinalize(); });
};

/** The dock keeps its holds for the length of the chip's travel after the
 *  lift, so the screen waking up does not land on the frames the slide is
 *  made of. Run the clock past that to see them handed back. */
const afterSlide = async () => {
  await act(() => { jest.advanceTimersByTime(CHIP_SLIDE_MAX_MS + 1); });
};

/**
 * Mount the dock and take THIS mount's gesture callbacks.
 *
 * `Gesture.Pan()` hands back one shared `api` object, so every mount
 * overwrites the callbacks the last one registered — and a test that drives
 * `mockPan` without checking gets the callbacks of whichever component
 * registered most recently, closed over ANOTHER test's shared values. The
 * assertions then read an object the gesture never touched, which is a silent
 * pass for anything expecting a value to stay where it started. Clearing the
 * callbacks in `beforeEach` and insisting they came back turns that into a
 * failure at the mount instead of a wrong answer three assertions later.
 */
const mount = async (element) => {
  const result = await render(element);
  for (const cb of ['onBegin', 'onStart', 'onUpdate', 'onEnd', 'onFinalize']) {
    if (typeof mockPan[cb] !== 'function') {
      throw new Error(`the dock did not register ${cb} on this mount — the gesture under test belongs to another test`);
    }
  }
  return result;
};

// One fake clock for the whole file rather than a fresh one per test. Not the
// thing that was breaking the mounts — that was the un-awaited `act` above —
// but React's scheduler captures `setTimeout` once, when it first loads, and
// tearing the clock down and building another one underneath it is a second
// way to stop its work ever running. One clock has no such seam, and the
// per-test state these tests actually need is the pending timers, which
// `afterEach` drains.
beforeAll(() => { jest.useFakeTimers(); });
afterAll(() => { jest.useRealTimers(); });

beforeEach(() => {
  holdSwipe.mockClear();
  releaseSwipe.mockClear();
  for (const cb of ['onBegin', 'onStart', 'onUpdate', 'onEnd', 'onFinalize']) delete mockPan[cb];
});
afterEach(() => { jest.runOnlyPendingTimers(); });

test('the chip tracks the thumb 1:1, and NOTHING changes tabs until it lifts', async () => {
  const props = buildProps(0);
  const dragSlot = { value: -1 };
  const leadSlot = { value: -1 };
  await mount(<DockTabBar {...props} dragSlot={dragSlot} leadSlot={leadSlot} />);

  // Finger down on the first icon and the drag begins: the chip takes over
  // from the navigator, at the slot it is already on.
  await touchDown(onIcon(0));
  await act(() => { mockPan.onStart({ absoluteX: onIcon(0) }); });
  expect(dragSlot.value).toBe(0);
  expect(props.navigation.dispatch).not.toHaveBeenCalled();
  // A scrub along the dock is a rightward drag, which is the same shape as
  // the back-swipe every pushed page listens for. The dock takes the guard
  // for the duration, or dragging the chip closes the page underneath it.
  expect(holdSwipe).toHaveBeenCalledTimes(1);
  expect(releaseSwipe).not.toHaveBeenCalled();

  // Halfway to Notes: the chip is a FRACTION of the way across, which is the
  // whole point of tracking a finger rather than hopping between slots.
  await act(() => { mockPan.onUpdate({ absoluteX: (onIcon(0) + onIcon(1)) / 2 - 2 }); });
  expect(dragSlot.value).toBeGreaterThan(0.4);
  expect(dragSlot.value).toBeLessThan(0.5);

  // Across four icons, parking on each, wobbling in the gaps the way a thumb
  // does. The chip follows all of it…
  const gap = (onIcon(1) + onIcon(2)) / 2;
  for (const x of [onIcon(1), onIcon(1) + 3, gap - 3, gap + 2, gap - 1, onIcon(2), onIcon(4)]) {
    await act(() => { mockPan.onUpdate({ absoluteX: x }); });
  }
  expect(dragSlot.value).toBeCloseTo(4);

  // …and not one of those crossings changed a tab. This is the thing the page
  // and the icon colours both hang off: a scrub used to be five navigates, so
  // five page transitions and five sets of icons lighting and unlighting under
  // a thumb that had not decided anything yet.
  expect(props.navigation.dispatch).not.toHaveBeenCalled();
  // The lead holds the slot the finger LANDED on — written at touch-down, so
  // a tap's chip leaves on the touch instead of waiting for the press. It is
  // irrelevant for the whole of a drag: `dragSlot` outranks it in chipAim, so
  // what the chip follows here is the thumb. Nothing about it is a tab change.
  expect(leadSlot.value).toBe(0);

  // Right off the end of the capsule and then off the other end: the thumb
  // holds the end tab instead of scrubbing into slots that do not exist, and
  // the chip never leaves the dock.
  await act(() => { mockPan.onUpdate({ absoluteX: WIDTH + 400 }); });
  expect(dragSlot.value).toBe(NAMES.length - 1);
  await act(() => { mockPan.onUpdate({ absoluteX: -400 }); });
  expect(dragSlot.value).toBe(0);
  await act(() => { mockPan.onUpdate({ absoluteX: onIcon(4) + TAB_SLOT * 0.3 }); });
  expect(props.navigation.dispatch).not.toHaveBeenCalled();

  // Thumb up. ONE navigate, for the nearest tab to where it let go — 4.3 of a
  // slot is Turtle, not Profile — and the chip is handed back to the navigator.
  await lift();
  expect(navigatedTo(props.navigation.dispatch)).toEqual(['Turtle-4']);
  expect(dragSlot.value).toBe(-1);

  // The lift also wrote where it landed, BEFORE React has heard a thing. That
  // is what the chip aims at for the few frames the navigator takes to agree;
  // without it the chip flicks back to the old tab on its way to the new one.
  expect(leadSlot.value).toBe(4);

  // Aimed at THIS navigator, the way BottomTabBar aims its own: an action
  // without a target is handled by whichever navigator feels like it.
  expect(props.navigation.dispatch.mock.calls[0][0].target).toBe('tabs-1');

  // …and the guard goes back once the chip has finished travelling. A leaked
  // hold kills back-navigation app-wide for the rest of the session, with
  // nothing on screen to explain it.
  expect(releaseSwipe).not.toHaveBeenCalled();
  await afterSlide();
  expect(releaseSwipe).toHaveBeenCalledTimes(1);
});

test('a scrub that comes home is not a tab change', async () => {
  const props = buildProps(2);
  const dragSlot = { value: -1 };
  await mount(<DockTabBar {...props} dragSlot={dragSlot} />);

  await act(() => { mockPan.onStart({ absoluteX: onIcon(2) }); });
  for (const x of [onIcon(0), onIcon(5), onIcon(2)]) {
    await act(() => { mockPan.onUpdate({ absoluteX: x }); });
  }
  await lift();

  // You can run the length of the dock and come back without having chosen
  // anything: the tab you are on is the tab you keep.
  expect(props.navigation.dispatch).not.toHaveBeenCalled();
  expect(dragSlot.value).toBe(-1);
});

test('a gesture the system cancels chooses nothing', async () => {
  const props = buildProps(0);
  const dragSlot = { value: -1 };
  const leadSlot = { value: -1 };
  await mount(<DockTabBar {...props} dragSlot={dragSlot} leadSlot={leadSlot} />);

  await touchDown(onIcon(0));
  await act(() => { mockPan.onStart({ absoluteX: onIcon(0) }); });
  await act(() => { mockPan.onUpdate({ absoluteX: onIcon(3) }); });
  // A call arriving, a modal taking the touch: onFinalize fires WITHOUT onEnd.
  // Landing the user on a tab they never released on would be the app
  // deciding for them.
  await act(() => { mockPan.onFinalize(); });

  expect(props.navigation.dispatch).not.toHaveBeenCalled();
  // The finger landed on the tab it was already on, so the lead touch-down
  // wrote points at the current tab: the chip is exactly where it belongs and
  // there is nothing for the guard below to take back.
  expect(leadSlot.value).toBe(0);
  expect(dragSlot.value).toBe(-1);
  // Cancelled, not lifted — and the guard still has to come back, or a call
  // arriving mid-scrub permanently disables the back-swipe. It comes back on
  // the same delay a real lift uses: the chip is travelling either way.
  await afterSlide();
  expect(releaseSwipe).toHaveBeenCalledTimes(1);
});

test('a TAP aims the chip before the finger leaves the glass', async () => {
  // THE WHOLE POINT OF onBegin OWNING THE AIM.
  //
  // react-navigation's tab button is a plain RN Pressable, so its `onPress` —
  // and therefore `tabPress`, and therefore the aim it used to write — does
  // not fire until RELEASE. The chip could not start until the finger came
  // off, and the probe (which stamps the touch at touch-DOWN) reported the
  // length of the tap as if the app were slow: 138ms on Mark's phone with a
  // clean travel behind it.
  //
  // Now the slot under the finger is the aim the instant it lands, and the
  // whole chain from here is on the UI thread — so a busy JS thread cannot
  // delay the chip either.
  const props = buildProps(0);
  const leadSlot = { value: -1 };
  await mount(<DockTabBar {...props} leadSlot={leadSlot} />);

  await touchDown(onIcon(3));

  expect(leadSlot.value).toBe(3);
  // Aimed, NOT navigated. The press is still react-navigation's to handle and
  // a touch is not yet a choice — nothing here dispatches.
  expect(props.navigation.dispatch).not.toHaveBeenCalled();
});

test('a tap BELOW the capsule still changes tabs — the dock finishes it', async () => {
  // THE BUG MARK KEPT HITTING: "it doesn't go to the intended tab element."
  //
  // 38% of this gesture's area has no button under it. The wrapper is
  // `dockOccupied` tall — capsule, floating gap, home-indicator inset — and
  // v7 puts that inset on the bar's own container as padding, so a thumb
  // landing low still starts this gesture while hitting nothing pressable. No
  // Pressable means no `tabPress` and no navigate, and before this the tap
  // simply did not happen.
  //
  // The first attempt at this (a5c2306, rolled back) gated the AIM on the
  // button band, which stopped the chip reacting to the miss without making
  // the tap work. The dock performs the tab change itself instead.
  const props = buildProps(0);
  const leadSlot = { value: -1 };
  const handled = { value: 0 };
  await mount(<DockTabBar {...props} leadSlot={leadSlot} handled={handled} />);

  // Horizontally over Turtle, but down in the home-indicator strip.
  await touchDown(onIcon(4), BAR_CONTENT_HEIGHT + 20);
  // Aimed anyway — the chip answers the touch, and that answer is now kept.
  expect(leadSlot.value).toBe(4);
  await act(() => { mockPan.onFinalize(); });

  // Nothing yet: react-navigation's own button gets first refusal, because a
  // press that landed and is merely slow must not be navigated twice.
  expect(props.navigation.dispatch).not.toHaveBeenCalled();

  await act(() => { jest.advanceTimersByTime(TAP_COMPLETE_MS + 1); });

  expect(navigatedTo(props.navigation.dispatch)).toEqual(['Turtle-4']);
  expect(props.navigation.dispatch.mock.calls[0][0].target).toBe('tabs-1');
});

test('…but not when the button answered — no double navigate', async () => {
  // `handled` is stamped by the tabPress listener (App.js). It is a STAMP
  // rather than a look at the navigator's state precisely so that a slow
  // commit cannot be read as a missed one and dispatched a second time.
  const props = buildProps(0);
  const handled = { value: 0 };
  await mount(<DockTabBar {...props} leadSlot={{ value: -1 }} handled={handled} />);

  await touchDown(onIcon(4));
  await act(() => { mockPan.onFinalize(); });
  // The press landed — react-navigation is already on it.
  handled.value = Date.now();
  await act(() => { jest.advanceTimersByTime(TAP_COMPLETE_MS + 1); });

  expect(props.navigation.dispatch).not.toHaveBeenCalled();
});

test('…and not after a LONG-press, which is a different gesture', async () => {
  // A long-press opens the console on Turtle. It fires `tabLongPress` and
  // never `tabPress`, so without being stamped as handled it would look
  // exactly like a tap that went missing — and the dock would change tabs
  // underneath the console that is opening.
  const props = buildProps(0);
  const handled = { value: 0 };
  await mount(<DockTabBar {...props} leadSlot={{ value: -1 }} handled={handled} />);

  await touchDown(onIcon(4));
  handled.value = Date.now(); // tabLongPress stamps the same value
  await act(() => { mockPan.onFinalize(); });
  await act(() => { jest.advanceTimersByTime(TAP_COMPLETE_MS + 1); });

  expect(props.navigation.dispatch).not.toHaveBeenCalled();
});

test('…and not after a DRAG, which already chose on the lift', async () => {
  // onEnd dispatches for a scrub. A second dispatch 150ms later would be a
  // duplicate on every single drag.
  const props = buildProps(0);
  const dragSlot = { value: -1 };
  const handled = { value: 0 };
  await mount(<DockTabBar {...props} dragSlot={dragSlot} leadSlot={{ value: -1 }} handled={handled} />);

  await touchDown(onIcon(0));
  await act(() => { mockPan.onStart({ absoluteX: onIcon(0) }); });
  await act(() => { mockPan.onUpdate({ absoluteX: onIcon(3) }); });
  await lift();
  expect(navigatedTo(props.navigation.dispatch)).toEqual(['Vault-3']);

  await act(() => { jest.advanceTimersByTime(TAP_COMPLETE_MS + 1); });
  // Still exactly one.
  expect(navigatedTo(props.navigation.dispatch)).toEqual(['Vault-3']);
});

test('a slot the navigator will not go to does not strand the chip', async () => {
  // The backstop. Completing the tap covers a press that never arrived; this
  // covers the case where the tab change cannot happen at all, which would
  // otherwise leave the lead pointing at a tab nobody is on until the dock is
  // next touched. Asks the navigator where it ended up rather than trusting
  // the clock — guessing short is how the backward kick 3686872 removed would
  // come back.
  const props = buildProps(0);
  props.navigation.dispatch = jest.fn(); // dispatched, but the state never moves
  const leadSlot = { value: -1 };
  const handled = { value: 0 };
  await mount(<DockTabBar {...props} leadSlot={leadSlot} handled={handled} />);

  await touchDown(onIcon(4));
  await act(() => { mockPan.onFinalize(); });
  await act(() => { jest.advanceTimersByTime(TAP_COMPLETE_MS + 1); });
  // It tried.
  expect(navigatedTo(props.navigation.dispatch)).toEqual(['Turtle-4']);
  expect(leadSlot.value).toBe(4);

  await act(() => { jest.advanceTimersByTime(LEAD_GUARD_MS + 1); });
  // The navigator never moved, so the chip goes home rather than sitting on a
  // tab that was never reached.
  expect(leadSlot.value).toBe(-1);
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

  test('NOTHING here transforms the dock — the blur must not be re-sampled', () => {
    // The press used to be a 1.5% scale on this wrapper, and the capsule's
    // BlurView is a descendant of it. A transform on a blur's ancestor makes
    // iOS re-derive the blur every frame, on the main thread, which is the
    // thread compositing the chip's travel — and the press and the travel
    // overlap on every tap, because the lift releases one as the other is
    // given its aim. The press is a wash FADE now, painted in TabBarPill.
    //
    // Scanned rather than rendered because the cost is a native one that no
    // jest assertion can see: the style would be perfectly valid, and the
    // only symptom is frames.
    expect(SRC).not.toMatch(/transform:\s*\[\{\s*scale/);
    expect(SRC).not.toMatch(/useAnimatedStyle/);
    // …and the value still reaches the component that draws it.
    expect(SRC).toMatch(/const press = pressLift \?\? ownPress/);
  });

  test('the press timing is something the UI thread can run', () => {
    // These callbacks are worklets on device. A worklet can only CALL other
    // worklets: a helper function, or React Native's Easing (a plain JS
    // closure), called from one throws "non-worklet function on the UI
    // thread", which a release build turns into a crash on the first touch
    // of the dock — and jest, which mocks Reanimated, never notices. So the
    // timings must be prebuilt objects whose easing is Reanimated's.
    for (const cb of ['onBegin', 'onFinalize']) {
      expect(bodyOf(cb)).toMatch(/withTiming\([01], PRESS_(IN|OUT)\)/);
    }
    expect(SRC).toMatch(/import Reanimated, \{[^}]*\bEasing\b[^}]*\} from 'react-native-reanimated'/);
    expect(SRC).not.toMatch(/import \{[^}]*\bEasing\b[^}]*\} from 'react-native'/);
    expect(SRC).toMatch(/const PRESS_IN = \{[^}]*easing: Easing\.bezier/);
    expect(SRC).toMatch(/const PRESS_OUT = \{[^}]*easing: Easing\.bezier/);
  });
});
