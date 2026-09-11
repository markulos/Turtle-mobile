/**
 * Opening the inspector must not take the Tasks screen down with it.
 *
 * The regression: the inspector mounts the date picker while it is CLOSED,
 * and the picker built its stylesheet from a `theme` PROP that nobody handed
 * it — so `theme.colors` threw the moment a task card was pressed and the
 * screen fell back to "Tasks couldn't load / Cannot read property 'colors'
 * of undefined". Rendering with no theme at all is the pin.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import TaskInspectorSheet from '../TaskInspectorSheet';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../../../context/ThemeContext', () => ({
  useTheme: () => ({
    timeFormat: '12h',
    theme: {
      mode: 'dark',
      colors: {
        background: '#000',
        surface: '#111',
        surfaceElevated: '#1c1c1e',
        textPrimary: '#fff',
        textSecondary: '#aaa',
        textTertiary: '#888',
        accentSuccess: '#34D399',
        accentInfo: '#60A5FA',
        border: '#333',
        primary: '#3b82f6',
      },
    },
  }),
}));
jest.mock('../../../../utils/haptics', () => ({
  tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn(),
}));
jest.mock('../../../TurtleScreen/components/PhotoViewer/ViewerSheet', () => {
  const React2 = require('react');
  const { View } = require('react-native');
  const Sheet = ({ children, topBar, footer }) => React2.createElement(View, null, topBar, children, footer);
  return { __esModule: true, default: Sheet, sheetColors: () => ({
    card: '#1c1c1e', textPrimary: '#fff', textSecondary: '#aaa', textMuted: '#777',
    border: '#333', handle: '#333', surface: '#222', primary: '#fff', background: '#000',
    chip: '#fff', chipText: '#000', chipGhostBorder: '#444', chipGhostText: '#fff',
  }) };
});

const task = {
  id: 't1', title: 'Water the plants', dueDate: '2026-09-11', time: '09:30',
  priority: 'medium', project: 'Home', subtasks: [], tags: [],
};

describe('TaskInspectorSheet', () => {
  test('renders with no theme prop (the pickers fall back to the context)', async () => {
    const view = await render(<TaskInspectorSheet task={task} boards={['Home']} />);
    expect(view).toBeTruthy();
  });

  test('renders with the theme handed down, as the day panel does', async () => {
    const view = await render(
      <TaskInspectorSheet task={task} boards={['Home']} theme={{ mode: 'dark', colors: { background: '#000' } }} />,
    );
    expect(view).toBeTruthy();
  });
});
