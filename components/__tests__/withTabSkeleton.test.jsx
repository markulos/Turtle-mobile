import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';

// `mock`-prefixed on purpose: jest hoists the factory above this line, and only
// names beginning with `mock` may be referenced from inside it.
let mockFocused = true;
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({
    theme: { colors: { background: '#000', surfaceElevated: '#111', border: '#222' } },
  }),
}));

jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock');
  const pass = (f) => f || ((t) => t);
  return {
    ...mock,
    Easing: { inOut: pass, out: pass, in: pass, quad: (t) => t, linear: (t) => t },
    withRepeat: mock.withRepeat || ((v) => v),
    cancelAnimation: mock.cancelAnimation || (() => {}),
  };
});

import { withTabSkeleton } from '../withTabSkeleton';

/**
 * ONE render() in this file, for the reason recorded in withTabTiming.test.jsx:
 * this jest-expo / RNTL setup does not survive a second mounted root, so the
 * lifecycle is told as one story through rerender().
 */
const mounted = jest.fn();
const Screen = () => {
  useEffect(() => { mounted(); }, []);
  return <Text>the real notes screen</Text>;
};

test('template first, real screen second — and never the template again', async () => {
  const Framed = withTabSkeleton(Screen, 'notes');

  // A tab the thumb merely DRAGGED PAST: mounted, not focused. This is the
  // case that pays for the drag — it must show its template and must not
  // start mounting a 4,000-line screen on the way through.
  mockFocused = false;
  const { rerender } = await render(<Framed />);

  expect(screen.getByTestId('tab-skeleton:notes')).toBeTruthy();
  expect(mounted).not.toHaveBeenCalled();

  // Not "not yet" — not at all, however long the gesture lasts. (No act()
  // around the wait: a blurred frame schedules nothing, so there is no state
  // update to flush, and nesting it inside the act RNTL already holds is what
  // produces the "overlapping act" warning.)
  await new Promise((r) => setTimeout(r, 600));
  expect(mounted).not.toHaveBeenCalled();
  expect(screen.getByTestId('tab-skeleton:notes')).toBeTruthy();

  // The thumb stops here. The screen mounts, and the template goes with it in
  // the same commit — no blank frame in between.
  mockFocused = true;
  rerender(<Framed />);
  await waitFor(() => expect(screen.getByText('the real notes screen')).toBeTruthy());
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('tab-skeleton:notes')).toBeNull();

  // Leaving and coming back must not flash grey bars over content that is
  // already on screen, and must not remount the screen.
  mockFocused = false;
  rerender(<Framed />);
  expect(screen.getByText('the real notes screen')).toBeTruthy();
  mockFocused = true;
  rerender(<Framed />);
  expect(screen.getByText('the real notes screen')).toBeTruthy();
  expect(screen.queryByTestId('tab-skeleton:notes')).toBeNull();
  expect(mounted).toHaveBeenCalledTimes(1);
});

test('the wrapper is a stable type, so composing it cannot remount the screen', () => {
  // No render: the point is the TYPE. Built inside App's render it would hand
  // React a new component every pass and throw away the tab's state.
  const Framed = withTabSkeleton(Screen, 'notes');
  expect(Framed).toBe(Framed);
  expect(Framed.displayName).toBe('TabFramed(notes)');
});
