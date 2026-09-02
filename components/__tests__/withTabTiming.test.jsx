import React from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

import { withTabTiming } from '../withTabTiming';

// `mock`-prefixed on purpose: jest hoists the factory above this line, and
// only names beginning with `mock` may be referenced from inside it.
let mockFocused = true;
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
}));

const mockRespond = jest.fn();
jest.mock('../../utils/gestureProbe', () => ({
  __esModule: true,
  default: { respond: (...a) => mockRespond(...a) },
}));

/**
 * ONE render() call in this file, deliberately.
 *
 * This jest-expo / RNTL setup does not survive a second mounted root in the
 * same file: the next render() comes back as a tree its own queries cannot
 * find, and an effect-driven assertion times out. Every test here passes in
 * isolation, and the failure follows the POSITION rather than the assertion —
 * confirmed by reordering them. The blurred-mount case therefore lives in
 * withTabTiming.blurred.test.jsx rather than being dropped.
 *
 * So the focus lifecycle is exercised as ONE narrative through rerender(),
 * which is unaffected by any of that. It reads better anyway: appear, stay,
 * blur, return is one story about one screen.
 */
const Screen = () => <Text>tasks</Text>;

beforeEach(() => {
  mockRespond.mockReset();
  mockFocused = true;
});

// No explicit cleanup(): this setup already auto-unmounts between tests, and
// calling it again unmounts a root that is already gone, which leaves the NEXT
// render() with a tree it cannot query. That cost an hour — the symptom is a
// perfectly ordinary render coming back empty.

test('reports on first appearance and on every RETURN, never on a re-render', async () => {
  const Timed = withTabTiming(Screen, 'Tasks');
  const { rerender } = await render(<Timed />);

  // The first appearance of a lazily-mounted tab is the slowest one there is;
  // a guard seeded from `focused` would have skipped exactly this sample.
  // waitFor, not a bare assert: this renderer flushes effects asynchronously.
  await waitFor(() => expect(mockRespond).toHaveBeenCalledWith('tab:Tasks'));
  expect(mockRespond).toHaveBeenCalledTimes(1);

  // Staying focused is not arriving. A screen re-renders constantly.
  rerender(<Timed />);
  rerender(<Timed />);
  await waitFor(() => expect(mockRespond).toHaveBeenCalledTimes(1));

  // The blur has to COMMIT before the return is queued — two back-to-back
  // rerenders coalesce, and the component would go true → true having never
  // observed the blur that re-arms the guard.
  mockFocused = false;
  rerender(<Timed />);
  await waitFor(() => expect(mockRespond).toHaveBeenCalledTimes(1));

  mockFocused = true;
  rerender(<Timed />);
  await waitFor(() => expect(mockRespond).toHaveBeenCalledTimes(2));
  expect(mockRespond.mock.calls.map((c) => c[0])).toEqual(['tab:Tasks', 'tab:Tasks']);
});

test('the wrapper is a stable type, so composing it cannot remount the screen', () => {
  // No render: the point is the TYPE. Building this inside App's render would
  // hand React a new component every pass and remount the screen it wraps.
  const Timed = withTabTiming(Screen, 'Tasks');
  expect(Timed).toBe(Timed);
  expect(Timed.displayName).toBe('TabTimed(Tasks)');
});
