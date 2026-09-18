/**
 * TaskDetail now rides the app's sheet shell (docs/STYLE-RULES.md §4) instead
 * of its own Modal + fade. Two things are worth pinning:
 *
 *  1. It renders nothing at all while closed. The shell plays its entrance on
 *     MOUNT, so a card that stayed mounted behind `visible` would either never
 *     animate or animate once and never again — and it would keep polling
 *     /pomodoros for a task nobody is looking at.
 *  2. Everything the old card showed it still shows: the title, the priority
 *     stamp, the meta chips, the subtasks, the three actions and the comment
 *     composer — plus Edit / Delete, which moved into the shell's footer.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { TaskDetail } from '../TaskDetail';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('../../../../utils/haptics', () => ({
  tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn(),
}));
jest.mock('../../../../services/offlineQueue', () => ({ sendOrQueue: jest.fn() }));
jest.mock('../../../../context/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      mode: 'dark',
      colors: {
        background: '#000',
        surface: '#111',
        surfaceElevated: '#1c1c1e',
        textPrimary: '#fff',
        textSecondary: '#aaa',
        textTertiary: '#888',
        textMuted: '#777',
        accentSuccess: '#4ADE80',
        accentWarning: '#FBBF24',
        accentError: '#F87171',
        accentInfo: '#60A5FA',
        border: '#333',
        borderStrong: '#444',
        primary: '#3b82f6',
      },
      typography: { body: 14 },
    },
  }),
}));
// ONE api object for the whole suite. Handing back a fresh one per render
// would re-identify the comment loader every pass and spin the effect that
// depends on it — the real ServerContext value is stable, so the mock is too.
const mockApi = { get: jest.fn(() => Promise.resolve({})) };
jest.mock('../../../../context/ServerContext', () => ({ useServer: () => ({ api: mockApi }) }));
// The shell itself is covered by its own tests; here it only has to hand back
// the pieces the card gives it so we can assert on what the card renders.
jest.mock('../../../TurtleScreen/components/PhotoViewer/ViewerSheet', () => {
  const React2 = require('react');
  const { View, Text } = require('react-native');
  const Sheet = ({ children, topBar, footer, title, subtitle }) => React2.createElement(
    View,
    null,
    React2.createElement(Text, null, title),
    React2.createElement(Text, null, subtitle),
    topBar,
    children,
    footer,
  );
  return {
    __esModule: true,
    default: Sheet,
    sheetColors: () => ({
      card: 'rgba(10,10,12,0.55)', textPrimary: '#fff', textSecondary: 'rgba(255,255,255,0.7)',
      textMuted: 'rgba(255,255,255,0.45)', border: 'rgba(255,255,255,0.18)', handle: '#555',
      surface: 'rgba(255,255,255,0.12)', primary: '#fff', background: '#000',
      chip: '#fff', chipText: '#000', chipGhostBorder: 'rgba(255,255,255,0.45)', chipGhostText: '#fff',
    }),
  };
});

const task = {
  id: 't1',
  title: 'Details portfolio for Gensler',
  priority: 'medium',
  project: 'Job search',
  dueDate: '2026-09-16',
  createdAt: 1758000000000,
  subtasks: [{ id: 's1', title: 'Pick the projects', completed: true }, { id: 's2', title: 'Export the PDF', completed: false }],
  tags: ['portfolio'],
};

describe('TaskDetail', () => {
  test('renders nothing while closed', async () => {
    const view = await render(<TaskDetail task={task} visible={false} onClose={jest.fn()} />);
    expect(view.toJSON()).toBeNull();
  });

  test('renders nothing without a task', async () => {
    const view = await render(<TaskDetail task={null} visible onClose={jest.fn()} />);
    expect(view.toJSON()).toBeNull();
  });

  test('shows the task on the sheet: title, stamp, chips, subtasks, footer', async () => {
    const view = await render(
      <TaskDetail
        task={task}
        visible
        onClose={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onToggleComplete={jest.fn()}
        onToggleSubtask={jest.fn()}
        onStartPomodoro={jest.fn()}
        onContinue={jest.fn()}
      />,
    );
    expect(view.getByText('Details portfolio for Gensler')).toBeTruthy();
    // The one filled pill, and the board name as the sheet's header title.
    expect(view.getByText('medium')).toBeTruthy();
    expect(view.getAllByText('Job search').length).toBeGreaterThan(0);
    expect(view.getByText('Due: 2026-09-16')).toBeTruthy();
    // Section labels are the app's small-caps scale, and the count rides the label.
    expect(view.getByText('Subtasks · 1/2')).toBeTruthy();
    expect(view.getByText('Export the PDF')).toBeTruthy();
    // Actions are keys in the body; Edit / Delete are the shell's footer.
    expect(view.getByText('Continue today')).toBeTruthy();
    expect(view.getByText('Start Pomodoro')).toBeTruthy();
    expect(view.getByText('Edit')).toBeTruthy();
    expect(view.getByText('Delete')).toBeTruthy();
    expect(view.getByText('No comments yet. Start the conversation.')).toBeTruthy();
  });

  test('an action that was not handed down does not draw its key', async () => {
    const view = await render(<TaskDetail task={task} visible onClose={jest.fn()} />);
    expect(view.queryByText('Continue today')).toBeNull();
    expect(view.queryByText('Start Pomodoro')).toBeNull();
    expect(view.queryByText('Send to Claude')).toBeNull();
  });

  test('an occasion stamps its kind, keeps its guests and reminders, and is never continued', async () => {
    const birthday = {
      id: 'b1', title: "Mum's birthday", itemType: 'birthday', dueDate: '2026-10-02', time: '18:00',
      createdAt: 1758000000000, subtasks: [], tags: [],
      meta: { yearly: true, guests: ['Dad'], reminders: ['1-day'] },
    };
    const view = await render(
      <TaskDetail task={birthday} visible onClose={jest.fn()} onContinue={jest.fn()} onStartPomodoro={jest.fn()} />,
    );
    expect(view.getByText('birthday')).toBeTruthy();
    expect(view.getByText('Every year')).toBeTruthy();
    expect(view.getByText('Guests · 1')).toBeTruthy();
    expect(view.getByText('Dad')).toBeTruthy();
    expect(view.getByText('1 day before')).toBeTruthy();
    expect(view.getByText('18:00')).toBeTruthy();
    // "Continue today" is a task affordance; an occasion recurs on its own.
    expect(view.queryByText('Continue today')).toBeNull();
    expect(view.getByText('Start Pomodoro')).toBeTruthy();
  });

  test('a tag closes the card before it filters by it', async () => {
    const onClose = jest.fn();
    const onTagPress = jest.fn();
    const view = await render(
      <TaskDetail task={task} visible onClose={onClose} onTagPress={onTagPress} />,
    );
    fireEvent.press(view.getByText('portfolio'));
    expect(onClose).toHaveBeenCalled();
    expect(onTagPress).toHaveBeenCalledWith('portfolio');
  });
});
