import React from 'react';
import { Dimensions } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { BAR_CONTENT_HEIGHT, CARD_MARGIN_H, TAB_SLOT, clusterStart } from '../tabBarLayout';
import { CHIP_SLIDE_MAX_MS } from '../dockMotion';

// The pan the dock built, so a test can actually drag it. A chain() stub would
// let the whole gesture be wired to nothing and still pass.
const mockPan = {};
const CALLBACKS = [
  'onBegin', 'onTouchesDown', 'onTouchesUp', 'onTouchesCancelled',
  'onStart', 'onUpdate', 'onEnd', 'onFinalize',
];
jest.mock('react-native-gesture-handler', () => {
  const api = {
    maxPointers: () => api,
    activeOffsetX: () => api,
  };
  for (const cb of [
    'onBegin', 'onTouchesDown', 'onTouchesUp', 'onTouchesCancelled',
    'onStart', 'onUpdate', 'onEnd', 'onFinalize',
  ]) {
    api[cb] = (fn) => { mockPan[cb] = fn; return api; };
  }
  return {
    Gesture: { Pan: () => api },
    GestureDetector: ({ children }) => children,
  };
});

jest.mock('@react-navigation/bottom-tabs', () => ({ BottomTabBar: () => null }));

// The back-swipe guard the dock takes for the length of a touch.
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
    // the hops between the threads have to be the identity rather than a queue.
    // …unless a test STALLS the JS thread: the hop then queues, exactly as it
    // does on a phone that is busy mounting a screen, until the test lets it run.
    runOnJS: (fn) => (...args) => (global.mockJsStalled
      ? void global.mockJsQueue.push(() => fn(...args))
      : fn(...args)),
    runOnUI: (fn) => fn,
    useSharedValue: (init) => require('react').useRef({ value: init }).current,
  };
});

import DockTabBar, { LIFT_SLACK } from '../DockTabBar';

const NAMES = ['Tasks', 'Notes', 'Photos', 'Vault', 'Turtle', 'Profile'];
const WIDTH = Dimensions.get('window').width;

/** The x, in window coords, of the icon in slot `i`. */
const onIcon = (i) =>
  CARD_MARGIN_H + clusterStart(WIDTH - CARD_MARGIN_H * 2, NAMES.length) + TAB_SLOT * i + TAB_SLOT / 2;

/**
 * A navigator that behaves like the real one where it matters to the dock:
 * its state is a STORE, current on the line after a dispatch, before anything
 * has re-rendered. (dockNav.test proves the real one does this.)
 */
const buildProps = (index = 0, { refuses = false } = {}) => {
  const routes = NAMES.map((name, i) => ({ key: `${name}-${i}`, name }));
  let state = { key: 'tabs-1', index, routes, routeNames: NAMES, preloadedRouteKeys: [] };
  const dispatch = jest.fn((action) => {
    if (refuses) return;
    const to = routes.findIndex((r) => r.key === action.payload?.key || r.name === action.payload?.name);
    if (to >= 0) state = { ...state, index: to };
  });
  return {
    state,
    navigation: { dispatch, emit: jest.fn(), getState: () => state },
    descriptors: Object.fromEntries(routes.map((r) => [r.key, { options: {}, route: r }])),
    insets: { top: 59, right: 0, bottom: 34, left: 0 },
  };
};

const navigatedTo = (dispatch) =>
  dispatch.mock.calls.map(([action]) => action.payload?.key ?? action.payload?.name);

// ── The touch, as RNGH delivers it ─────────────────────────────────────────
//
// `y` is measured from the top of the gesture's wrapper. A real touch always
// has one, and the default is the middle of the capsule — on a button.
const MID = BAR_CONTENT_HEIGHT / 2;

const touchDown = async (x, y = MID) => {
  await act(() => {
    mockPan.onTouchesDown({ changedTouches: [{ x, y }] });
    mockPan.onBegin({ absoluteX: x, x, y });
  });
};

/** The finger comes off the glass without ever having dragged: a tap. */
const liftTap = async (y = MID) => {
  await act(() => {
    mockPan.onTouchesUp({ changedTouches: [{ y }] });
    // A pan that never activated FAILS on the lift — it does not end.
    mockPan.onFinalize({}, false);
  });
};

/** iOS takes the touch away (a swipe home, a call): cancelled, never lifted. */
const systemCancel = async ({ dragging = false } = {}) => {
  await act(() => {
    mockPan.onTouchesCancelled({});
    // RNGH calls onEnd for a cancelled ACTIVE gesture too, with `false`.
    if (dragging) mockPan.onEnd({}, false);
    mockPan.onFinalize({}, false);
  });
};

/** A scrub's real lift. */
const liftDrag = async () => {
  await act(() => {
    mockPan.onTouchesUp({ changedTouches: [{ y: MID }] });
    mockPan.onEnd({}, true);
    mockPan.onFinalize({}, true);
  });
};

const afterSlide = async () => {
  await act(() => { jest.advanceTimersByTime(CHIP_SLIDE_MAX_MS + 1); });
};

// `render` is ASYNC in RNTL 14 and must be awaited: un-awaited, the dock's
// gesture is never registered (or is registered late, by a previous test's
// tree), and a test then drives somebody else's callbacks.
const mount = async (element) => {
  const result = await render(element);
  for (const cb of CALLBACKS) {
    if (typeof mockPan[cb] !== 'function') {
      throw new Error(`the dock did not register ${cb} on this mount — the gesture under test belongs to another test`);
    }
  }
  return result;
};

// One fake clock for the whole file rather than a fresh one per test: React's
// scheduler captures `setTimeout` once, when it first loads, and tearing the
// clock down and building another one underneath it stops its work running.
beforeAll(() => { jest.useFakeTimers(); });
afterAll(() => { jest.useRealTimers(); });

global.mockJsStalled = false;
global.mockJsQueue = [];
/** The JS thread comes back and works through what was waiting, in order. */
const jsCatchesUp = async () => {
  global.mockJsStalled = false;
  await act(() => { while (global.mockJsQueue.length) global.mockJsQueue.shift()(); });
};

beforeEach(() => {
  global.mockJsStalled = false;
  global.mockJsQueue = [];
  holdSwipe.mockClear();
  releaseSwipe.mockClear();
  for (const cb of CALLBACKS) delete mockPan[cb];
});
afterEach(() => { jest.runOnlyPendingTimers(); });

// ═══════════════════════════════════════════════════════════════════════════
// THE DRAG
// ═══════════════════════════════════════════════════════════════════════════

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

  // …and not one of those crossings changed a tab: a scrub used to be five
  // navigates, so five page transitions under a thumb that had not decided.
  expect(props.navigation.dispatch).not.toHaveBeenCalled();
  // The lead holds the slot the finger LANDED on. It is irrelevant for the
  // whole of a drag — `dragSlot` outranks it in chipAim.
  expect(leadSlot.value).toBe(0);

  // Right off the end of the capsule and then off the other end: the thumb
  // holds the end tab instead of scrubbing into slots that do not exist.
  await act(() => { mockPan.onUpdate({ absoluteX: WIDTH + 400 }); });
  expect(dragSlot.value).toBe(NAMES.length - 1);
  await act(() => { mockPan.onUpdate({ absoluteX: -400 }); });
  expect(dragSlot.value).toBe(0);
  await act(() => { mockPan.onUpdate({ absoluteX: onIcon(4) + TAB_SLOT * 0.3 }); });
  expect(props.navigation.dispatch).not.toHaveBeenCalled();

  // Thumb up. ONE navigate, for the nearest tab to where it let go — 4.3 of a
  // slot is Turtle, not Profile — and the chip is handed back to the navigator.
  await liftDrag();
  expect(navigatedTo(props.navigation.dispatch)).toEqual(['Turtle-4']);
  expect(dragSlot.value).toBe(-1);
  // Aimed at THIS navigator, the way BottomTabBar aims its own.
  expect(props.navigation.dispatch.mock.calls[0][0].target).toBe('tabs-1');

  // The request was ANSWERED in the same call: the navigator's store already
  // says Turtle, so the lead for it is spent and nothing is left to time out.
  expect(leadSlot.value).toBe(-1);

  // …and the guard goes back once the chip has finished travelling. A leaked
  // hold kills back-navigation app-wide for the rest of the session.
  expect(releaseSwipe).not.toHaveBeenCalled();
  await afterSlide();
  expect(releaseSwipe).toHaveBeenCalledTimes(1);
});

test('a scrub that comes home is not a tab change', async () => {
  const props = buildProps(2);
  const dragSlot = { value: -1 };
  const leadSlot = { value: -1 };
  await mount(<DockTabBar {...props} dragSlot={dragSlot} leadSlot={leadSlot} />);

  await touchDown(onIcon(2));
  await act(() => { mockPan.onStart({ absoluteX: onIcon(2) }); });
  for (const x of [onIcon(0), onIcon(5), onIcon(2)]) {
    await act(() => { mockPan.onUpdate({ absoluteX: x }); });
  }
  await liftDrag();

  // You can run the length of the dock and come back without having chosen
  // anything: the tab you are on is the tab you keep.
  expect(props.navigation.dispatch).not.toHaveBeenCalled();
  expect(dragSlot.value).toBe(-1);
  // …and the lead is answered anyway, so it cannot sit there for ever.
  expect(leadSlot.value).toBe(-1);
});

test('a scrub the system cancels chooses nothing — even though RNGH calls onEnd for it', async () => {
  // THE BUG THAT WAS HIDING BEHIND A COMMENT. RNGH runs onEnd for an ACTIVE
  // gesture that is cancelled, with `success === false`. The dock ignored the
  // flag, so a call arriving mid-scrub landed you on whatever tab the thumb
  // happened to be over — "the app deciding for you", which the old comment
  // on onEnd said could not happen.
  const props = buildProps(0);
  const dragSlot = { value: -1 };
  const leadSlot = { value: -1 };
  await mount(<DockTabBar {...props} dragSlot={dragSlot} leadSlot={leadSlot} />);

  await touchDown(onIcon(1));
  await act(() => { mockPan.onStart({ absoluteX: onIcon(1) }); });
  await act(() => { mockPan.onUpdate({ absoluteX: onIcon(3) }); });
  await systemCancel({ dragging: true });

  expect(props.navigation.dispatch).not.toHaveBeenCalled();
  expect(dragSlot.value).toBe(-1);
  // The touch-down had aimed the chip at Notes. Nothing will ever answer that
  // aim, so the gesture hands the chip back itself, in the same frame.
  expect(leadSlot.value).toBe(-1);
  // Cancelled, not lifted — and the back-swipe guard still has to come back.
  await afterSlide();
  expect(releaseSwipe).toHaveBeenCalledTimes(1);
});

// ═══════════════════════════════════════════════════════════════════════════
// THE TAP
// ═══════════════════════════════════════════════════════════════════════════

test('a TAP aims the chip before the finger leaves the glass', async () => {
  // react-navigation's tab button is a plain RN Pressable, so its `onPress`
  // does not fire until RELEASE. Aimed from there, the chip could not start
  // until the finger came off. The slot under the finger is the aim the
  // instant it lands, and the whole chain from here is on the UI thread.
  const props = buildProps(0);
  const leadSlot = { value: -1 };
  await mount(<DockTabBar {...props} leadSlot={leadSlot} />);

  await touchDown(onIcon(3));

  expect(leadSlot.value).toBe(3);
  // Aimed, NOT navigated: a touch is not yet a choice.
  expect(props.navigation.dispatch).not.toHaveBeenCalled();
});

test('the lift IS the tab change — no waiting to see whether the button will', async () => {
  // This used to be a 150ms timer that checked whether react-navigation's own
  // button had answered, and a 600ms one that took the chip back if nobody
  // had. Both were guesses about how busy the JS thread was. The gesture
  // knows a tap when it sees one, so it says so at the lift.
  const props = buildProps(0);
  const leadSlot = { value: -1 };
  const navSlot = { value: 0 };
  await mount(<DockTabBar {...props} leadSlot={leadSlot} navSlot={navSlot} />);

  await touchDown(onIcon(4));
  await liftTap();

  // No clock has moved.
  expect(navigatedTo(props.navigation.dispatch)).toEqual(['Turtle-4']);
  expect(props.navigation.dispatch.mock.calls[0][0].target).toBe('tabs-1');
  // …and the chip already knows the outcome, before React has rendered
  // anything: where the navigator is, and that its lead is answered.
  expect(navSlot.value).toBe(4);
  expect(leadSlot.value).toBe(-1);
});

test('a tap BELOW the capsule changes tabs — there is no button there, and it does not matter', async () => {
  // 38% of this gesture's area has no button under it: the wrapper is
  // `dockOccupied` tall — capsule, floating gap, home-indicator inset — and
  // v7 puts that inset on the bar's own container, so a thumb landing low
  // starts this gesture while hitting nothing pressable.
  const props = buildProps(0);
  await mount(<DockTabBar {...props} leadSlot={{ value: -1 }} />);

  const low = BAR_CONTENT_HEIGHT + 20;
  await touchDown(onIcon(4), low);
  await liftTap(low);

  expect(navigatedTo(props.navigation.dispatch)).toEqual(['Turtle-4']);
});

test('a slow tap is still a tap — however long the finger rests', async () => {
  // RN's Pressability drops `onPress` once a press passes 500ms, because
  // BottomTabItem gives every tab an `onLongPress`. Nothing here is timed, so
  // there is nothing for a slow finger to miss.
  const props = buildProps(0);
  await mount(<DockTabBar {...props} leadSlot={{ value: -1 }} />);

  await touchDown(onIcon(2));
  await act(() => { jest.advanceTimersByTime(4000); });
  expect(props.navigation.dispatch).not.toHaveBeenCalled();
  await liftTap();

  expect(navigatedTo(props.navigation.dispatch)).toEqual(['Photos-2']);
});

test('the button reporting the SAME tap does not change tabs twice', async () => {
  // react-navigation's button still fires for a touch whenever it can, and
  // App.js sends it through the same `requestTab`. Whichever of the two
  // arrives second finds the navigator already there.
  const { requestTab } = require('../dockNav');
  const props = buildProps(0);
  const leadSlot = { value: -1 };
  const navSlot = { value: 0 };
  const settle = jest.fn((requested, current) => {
    navSlot.value = current;
    if (leadSlot.value === requested || leadSlot.value === current) leadSlot.value = -1;
  });
  await mount(<DockTabBar {...props} leadSlot={leadSlot} navSlot={navSlot} settle={settle} />);

  await touchDown(onIcon(3));
  await liftTap();
  // …and now the button's press for the same touch.
  requestTab(props.navigation, 3, settle, props.state);

  expect(navigatedTo(props.navigation.dispatch)).toEqual(['Vault-3']);
  expect(navSlot.value).toBe(3);
  expect(leadSlot.value).toBe(-1);
});

test('a tap on the tab you are already on asks for nothing, and leaves nothing behind', async () => {
  // The lead used to be cleared only by an effect that runs when the index
  // CHANGES — so a tap on the current tab left it set for good.
  const props = buildProps(2);
  const leadSlot = { value: -1 };
  await mount(<DockTabBar {...props} leadSlot={leadSlot} />);

  await touchDown(onIcon(2));
  expect(leadSlot.value).toBe(2);
  await liftTap();

  expect(props.navigation.dispatch).not.toHaveBeenCalled();
  expect(leadSlot.value).toBe(-1);
});

// ═══════════════════════════════════════════════════════════════════════════
// WHAT IS NOT A TAP
// ═══════════════════════════════════════════════════════════════════════════

test('a touch the SYSTEM takes away is not a tap — the swipe home starts on the dock', async () => {
  // The home-indicator inset is part of this wrapper, so the swipe up to
  // leave the app begins as a touch on the dock: it lands, and then iOS takes
  // it. "Any touch that did not become a drag is a tap" changed tabs on the
  // way out of the app, every time the swipe started over a different tab.
  const props = buildProps(0);
  const leadSlot = { value: -1 };
  await mount(<DockTabBar {...props} leadSlot={leadSlot} />);

  await touchDown(onIcon(4), BAR_CONTENT_HEIGHT + 30);
  expect(leadSlot.value).toBe(4);
  await systemCancel();

  expect(props.navigation.dispatch).not.toHaveBeenCalled();
  // The chip had left for Turtle on the touch. It is given straight back —
  // by the gesture, in the same frame, with no timer to wait out.
  expect(leadSlot.value).toBe(-1);
  await afterSlide();
  expect(releaseSwipe).toHaveBeenCalledTimes(1);
});

test('a finger that wanders off the top of the dock and lets go there chose nothing', async () => {
  // The contract every native tab bar has: touch up outside cancels.
  const props = buildProps(0);
  const leadSlot = { value: -1 };
  await mount(<DockTabBar {...props} leadSlot={leadSlot} />);

  await touchDown(onIcon(3));
  await liftTap(-(LIFT_SLACK + 40));

  expect(props.navigation.dispatch).not.toHaveBeenCalled();
  expect(leadSlot.value).toBe(-1);
});

test('…but a thumb that only rolled a little above it still tapped', async () => {
  const props = buildProps(0);
  await mount(<DockTabBar {...props} leadSlot={{ value: -1 }} />);

  await touchDown(onIcon(3), 4);
  await liftTap(-(LIFT_SLACK - 5));

  expect(navigatedTo(props.navigation.dispatch)).toEqual(['Vault-3']);
});

test('the finger coming off after a LONG-press is not a tap', async () => {
  // A long-press opens the console on Turtle (App.js raises `suppressTap`
  // from `tabLongPress`). The finger still has to come off the glass, and
  // changing tabs underneath the console it just opened is not what it meant.
  const props = buildProps(0);
  const leadSlot = { value: -1 };
  const suppressTap = { current: false };
  await mount(<DockTabBar {...props} leadSlot={leadSlot} suppressTap={suppressTap} />);

  await touchDown(onIcon(4));
  suppressTap.current = true; // tabLongPress, half a second in
  await liftTap();

  expect(props.navigation.dispatch).not.toHaveBeenCalled();
  expect(leadSlot.value).toBe(-1);
  // One long press stands down one lift, not every tap after it.
  expect(suppressTap.current).toBe(false);

  await touchDown(onIcon(4));
  await liftTap();
  expect(navigatedTo(props.navigation.dispatch)).toEqual(['Turtle-4']);
});

test('a stale long-press flag does not swallow the NEXT touch', async () => {
  // If the long press's own lift never reached the dock (the console's modal
  // took the touch), the flag is still up when the next touch lands.
  const props = buildProps(0);
  const suppressTap = { current: true };
  await mount(<DockTabBar {...props} leadSlot={{ value: -1 }} suppressTap={suppressTap} />);

  await touchDown(onIcon(1));
  expect(suppressTap.current).toBe(false);
  await liftTap();

  expect(navigatedTo(props.navigation.dispatch)).toEqual(['Notes-1']);
});

// ═══════════════════════════════════════════════════════════════════════════
// THE CHIP IS NEVER STRANDED
// ═══════════════════════════════════════════════════════════════════════════

test('a tab change the navigator REFUSES gives the chip back at once', async () => {
  // It used to take a 600ms timer to notice. The navigator's store says where
  // it is on the line after the dispatch, so the answer is immediate.
  const props = buildProps(0, { refuses: true });
  const leadSlot = { value: -1 };
  const navSlot = { value: 0 };
  await mount(<DockTabBar {...props} leadSlot={leadSlot} navSlot={navSlot} />);

  await touchDown(onIcon(4));
  await liftTap();

  expect(navigatedTo(props.navigation.dispatch)).toEqual(['Turtle-4']);
  expect(navSlot.value).toBe(0);
  expect(leadSlot.value).toBe(-1);
});

test('an abandoned touch does not take back a lead that a NEWER request owns', async () => {
  // The gesture only hands back a lead that is still its own.
  const props = buildProps(0);
  const leadSlot = { value: -1 };
  await mount(<DockTabBar {...props} leadSlot={leadSlot} />);

  await touchDown(onIcon(4));
  leadSlot.value = 2; // somebody else has re-aimed the chip since
  await systemCancel();

  expect(leadSlot.value).toBe(2);
});

test('an abandoned touch leaves a lead that a request IN FLIGHT still owns', async () => {
  // The JS thread is busy (a screen is mounting). A tap on Vault has been
  // decided and its request is queued. A second touch lands on Vault too and
  // the system takes it away. Its lead is the same number as the first
  // touch's — and clearing it would send the chip back to Tasks until the
  // queued request ran, and then forward again.
  const props = buildProps(0);
  const leadSlot = { value: -1 };
  const navSlot = { value: 0 };
  await mount(<DockTabBar {...props} leadSlot={leadSlot} navSlot={navSlot} />);

  global.mockJsStalled = true;
  await touchDown(onIcon(3));
  await liftTap();
  // Decided on the UI thread; nothing has reached the navigator yet.
  expect(props.navigation.dispatch).not.toHaveBeenCalled();
  expect(leadSlot.value).toBe(3);

  await touchDown(onIcon(3));
  await systemCancel();
  // Still aimed at Vault: the first tap's request will answer it.
  expect(leadSlot.value).toBe(3);

  await jsCatchesUp();
  expect(navigatedTo(props.navigation.dispatch)).toEqual(['Vault-3']);
  expect(navSlot.value).toBe(3);
  expect(leadSlot.value).toBe(-1);

  // …and the claim was dropped with the answer: the NEXT abandoned touch on
  // that slot is handed straight back, as usual.
  await touchDown(onIcon(1));
  await systemCancel();
  expect(leadSlot.value).toBe(-1);
});

test('a second touch takes over the first one\'s hold instead of losing it mid-scrub', async () => {
  // A lift arms a timer that releases the interaction handle and the
  // back-swipe guard once the chip has landed. A touch that lands inside that
  // window and stays down used to have both pulled out from under it.
  const props = buildProps(0);
  const dragSlot = { value: -1 };
  await mount(<DockTabBar {...props} dragSlot={dragSlot} leadSlot={{ value: -1 }} />);

  await touchDown(onIcon(1));
  await liftTap();
  await touchDown(onIcon(2));
  await act(() => { mockPan.onStart({ absoluteX: onIcon(2) }); });
  await afterSlide();
  // Still scrubbing: the guard is still held.
  expect(releaseSwipe).not.toHaveBeenCalled();

  await liftDrag();
  await afterSlide();
  expect(releaseSwipe).toHaveBeenCalledTimes(1);
});

test('without touch events the dock falls back to the old rule rather than ignoring taps', async () => {
  // `lifted` is only evidence if touch events arrive. On a build where they
  // did not, every tap would read as abandoned and the dock would do nothing
  // at all — so with no touch event ever seen, a touch that did not become a
  // drag is a tap, as it was before.
  const props = buildProps(0);
  await mount(<DockTabBar {...props} leadSlot={{ value: -1 }} />);

  await act(() => { mockPan.onBegin({ absoluteX: onIcon(5), x: onIcon(5), y: MID }); });
  await act(() => { mockPan.onFinalize({}, false); });

  expect(navigatedTo(props.navigation.dispatch)).toEqual(['Profile-5']);
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
