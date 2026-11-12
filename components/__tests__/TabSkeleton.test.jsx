import React from 'react';
import { render, screen } from '@testing-library/react-native';

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

import TabSkeleton from '../TabSkeleton';

const KINDS = ['tasks', 'notes', 'photos', 'vault', 'turtle', 'profile'];

/**
 * EVERY template in ONE tree, which is also the only way to cover six of them
 * in a file that may mount a single root (see withTabTiming.test.jsx).
 *
 * The assertion is deliberately shallow — these are grey boxes, and testing
 * their shapes would be testing a drawing. What is worth catching is a
 * template that THROWS, because the one moment it renders is the moment a tab
 * is opening, and a crash there replaces the tab with an error card.
 */
test('every tab has a template, and none of them throws', async () => {
  await render(
    <>
      {KINDS.map((kind) => <TabSkeleton key={kind} kind={kind} />)}
    </>,
  );

  KINDS.forEach((kind) => {
    expect(screen.getByTestId(`tab-skeleton:${kind}`)).toBeTruthy();
  });

  // Announced as one busy surface rather than as a pile of unlabelled boxes.
  expect(screen.getAllByLabelText('Loading')).toHaveLength(KINDS.length);
});
