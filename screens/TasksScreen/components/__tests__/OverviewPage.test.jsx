import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../../../utils/haptics', () => ({ tapHaptic: jest.fn() }));
jest.mock('../../../TurtleScreen/components/EdgeSwipePage', () => {
  const React = require('react');
  return function MockEdgeSwipePage({ visible, children }) {
    return visible ? React.createElement(React.Fragment, null, children) : null;
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

import OverviewPage from '../OverviewPage';

const theme = (mode) => ({
  mode,
  colors: {
    background: mode === 'dark' ? '#000' : '#fff',
    textPrimary: mode === 'dark' ? '#fff' : '#111',
    textTertiary: '#888',
    border: '#333',
    borderStrong: '#444',
  },
});

const task = (over = {}) => ({
  id: 't1', title: 'Renew the passport', project: 'Admin', completed: false,
  dueDate: '2026-09-02', time: '08:00', tags: [], itemType: 'task', ...over,
});

const baseProps = (over = {}) => ({
  visible: true,
  onClose: jest.fn(),
  tasks: [task(), task({ id: 't2', title: 'File the receipts' }), task({ id: 't3', title: 'Old thing', completed: true })],
  boards: ['Admin'],
  colorOf: () => '#4ade80',
  sharedIn: {},
  selectedProject: null,
  calendarDate: new Date('2026-09-15T12:00:00'),
  onSelectBoard: jest.fn(),
  onOpenFilters: jest.fn(),
  theme: theme('light'),
  ...over,
});

/** Drill from the overview into the one board. */
async function openBoard(props = {}) {
  const p = baseProps(props);
  const user = userEvent.setup();
  await render(<OverviewPage {...p} />);
  await user.press(screen.getByTestId('overview-board-Admin'));
  return { p, user };
}

describe('a board’s task list', () => {
  test('every task is an inset CARD, so its white title is never on a white page', async () => {
    // The bug this replaces: bare rows drawn on the page while taking their
    // colours from the inset-card palette — white text on the light-mode page.
    await openBoard({ theme: theme('light') });

    const card = screen.getByTestId('overview-task-t1');
    const box = StyleSheet.flatten(card.props.style);
    expect(box.backgroundColor).toBe('#1F2024');   // charcoal on the light page
    expect(box.borderWidth).toBe(1);
    expect(box.borderRadius).toBe(14);
  });

  test('…and the card is a step above black in dark mode', async () => {
    await openBoard({ theme: theme('dark') });
    const box = StyleSheet.flatten(screen.getByTestId('overview-task-t1').props.style);
    expect(box.backgroundColor).toBe('#17171A');
    expect(box.backgroundColor).not.toBe('#000');
  });

  test('a tap opens the task', async () => {
    const onOpenTask = jest.fn();
    const { user } = await openBoard({ onOpenTask });

    await user.press(screen.getByTestId('overview-task-t1'));
    expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
  });

  test('with no handler the rows are inert rather than broken', async () => {
    await openBoard({ onOpenTask: undefined });
    expect(screen.getByTestId('overview-task-t1').props.accessibilityState).toMatchObject({ disabled: true });
  });
});

describe('the board finder', () => {
  test('filters the lists as you type, headings included', async () => {
    await openBoard();
    expect(screen.getByText('To do · 2')).toBeTruthy();

    await act(async () => { fireEvent.changeText(screen.getByTestId('overview-board-finder'), 'receipts'); });

    expect(screen.getByText('To do · 1')).toBeTruthy();
    expect(screen.getByTestId('overview-task-t2')).toBeTruthy();
    expect(screen.queryByTestId('overview-task-t1')).toBeNull();
  });

  test('offers to create what does not exist, on THIS board', async () => {
    const onAddTask = jest.fn();
    const { user } = await openBoard({ onAddTask });

    expect(screen.queryByTestId('overview-finder-create')).toBeNull();
    await act(async () => { fireEvent.changeText(screen.getByTestId('overview-board-finder'), 'Book the ferry'); });

    await user.press(screen.getByTestId('overview-finder-create'));
    expect(onAddTask).toHaveBeenCalledWith('Book the ferry', 'Admin');
    // The field clears, so the list is readable again straight after.
    expect(screen.getByTestId('overview-finder-placeholder')).toBeTruthy();
  });

  test('an exact existing title offers no duplicate', async () => {
    await openBoard({ onAddTask: jest.fn() });
    await act(async () => { fireEvent.changeText(screen.getByTestId('overview-board-finder'), 'File the receipts'); });
    expect(screen.queryByTestId('overview-finder-create')).toBeNull();
  });

  test('the placeholder is our own Text, not the native prop', async () => {
    // iOS renders a TextInput placeholder with wide tracking under Figtree.
    await openBoard();
    expect(screen.getByTestId('overview-board-finder').props.placeholder).toBeUndefined();
    expect(screen.getByTestId('overview-finder-placeholder').props.children).toBe('Search or add a task…');
  });

  test('a task on the No Board panel is created with NO board, not one named for the sentinel', async () => {
    const onAddTask = jest.fn();
    const user = userEvent.setup();
    // A task with no project lands in the NO_BOARD panel.
    await render(<OverviewPage {...baseProps({ onAddTask, tasks: [task({ id: 'n1', project: '' })] })} />);
    await user.press(screen.getByTestId('overview-board-No Project'));

    await act(async () => { fireEvent.changeText(screen.getByTestId('overview-board-finder'), 'Loose end'); });
    await user.press(screen.getByTestId('overview-finder-create'));

    expect(onAddTask).toHaveBeenCalledWith('Loose end', '');
  });
});
