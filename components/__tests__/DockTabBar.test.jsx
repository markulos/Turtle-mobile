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

/** Lift the thumb: the real gesture runs both, in this order. */
const lift = () => {
  act(() => { mockPan.onEnd(); });
  act(() => { mockPan.onFinalize(); });
};

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
});
