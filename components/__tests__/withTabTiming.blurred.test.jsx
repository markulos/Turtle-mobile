import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { withTabTiming } from '../withTabTiming';

/**
 * Its own file on purpose — see the note in withTabTiming.test.jsx. This setup
 * fails the second mounted root in a file, so the one behaviour that needs a
 * fresh mount at a different focus state gets a file to itself rather than
 * being dropped for the harness's convenience.
 */
let mockFocused = false;
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
}));

const mockRespond = jest.fn();
jest.mock('../../utils/gestureProbe', () => ({
  __esModule: true,
  default: { respond: (...a) => mockRespond(...a) },
}));

test('a screen mounted while blurred renders normally and reports nothing', async () => {
  const Greeting = ({ who }) => <Text>{`hello ${who}`}</Text>;
  const Timed = withTabTiming(Greeting, 'Photos');

  const { getByText } = await render(<Timed who="mark" />);

  // Props reach the wrapped screen untouched...
  expect(getByText('hello mark')).toBeTruthy();
  // ...and nothing is filed, because nobody navigated here. A screen can be
  // mounted off-screen; that is not an arrival and must not be timed as one.
  expect(mockRespond).not.toHaveBeenCalled();
});
