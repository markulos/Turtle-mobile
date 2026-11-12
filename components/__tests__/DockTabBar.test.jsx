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
    onStart: (fn) => { mockPan.onStart = fn; return api; },
    onUpdate: (fn) => { mockPan.onUpdate = fn; return api; },
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

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock');
  return {
    ...mock,
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

test('a thumb dragged along the dock carries the chip and changes tabs as it crosses them', async () => {
  const props = buildProps(0);
  const dragSlot = { value: -1 };
  await render(<DockTabBar {...props} dragSlot={dragSlot} />);

  // Finger down on the first icon and the drag begins: the chip takes over
  // from the navigator, at the slot it is already on.
  act(() => { mockPan.onStart({ absoluteX: onIcon(0) }); });
  expect(dragSlot.value).toBe(0);
  expect(props.navigation.dispatch).not.toHaveBeenCalled();

  // Halfway to Notes. The chip is a FRACTION of the way across — the whole
  // point of tracking the finger rather than hopping — and no tab has changed
  // yet, because the thumb has not passed the gap.
  act(() => { mockPan.onUpdate({ absoluteX: (onIcon(0) + onIcon(1)) / 2 - 2 }); });
  expect(dragSlot.value).toBeGreaterThan(0.4);
  expect(dragSlot.value).toBeLessThan(0.5);
  expect(props.navigation.dispatch).not.toHaveBeenCalled();

  // Onto Notes, then straight on to Turtle: one navigate per icon crossed,
  // in order, and never a repeat for the frames spent on the same icon.
  act(() => { mockPan.onUpdate({ absoluteX: onIcon(1) }); });
  act(() => { mockPan.onUpdate({ absoluteX: onIcon(1) + 3 }); });
  act(() => { mockPan.onUpdate({ absoluteX: onIcon(4) }); });
  expect(navigatedTo(props.navigation.dispatch)).toEqual(['Notes-1', 'Turtle-4']);
  expect(dragSlot.value).toBeCloseTo(4);

  // Every dispatch is aimed at THIS navigator, the way BottomTabBar aims its
  // own: an action without a target is handled by whichever navigator feels
  // like it.
  props.navigation.dispatch.mock.calls.forEach(([action]) => {
    expect(action.target).toBe('tabs-1');
  });

  // Right off the end of the capsule and then off the other end: the thumb
  // holds the end tab instead of scrubbing into slots that do not exist, and
  // the chip never leaves the dock.
  act(() => { mockPan.onUpdate({ absoluteX: WIDTH + 400 }); });
  expect(dragSlot.value).toBe(NAMES.length - 1);
  act(() => { mockPan.onUpdate({ absoluteX: -400 }); });
  expect(dragSlot.value).toBe(0);
  // Three navigates, not four: slot 0 is where this fixture is focused, so
  // coming back to it is the "already there" guard, not a fourth switch.
  expect(navigatedTo(props.navigation.dispatch))
    .toEqual(['Notes-1', 'Turtle-4', 'Profile-5']);

  // Thumb up. The chip goes back to the navigator — a stuck drag would leave
  // it parked under a finger that is no longer there.
  act(() => { mockPan.onFinalize(); });
  expect(dragSlot.value).toBe(-1);
});
