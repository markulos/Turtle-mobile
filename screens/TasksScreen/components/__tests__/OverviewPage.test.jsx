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
    // iOS draws a TextInput's placeholder outside the app's text pipeline, so
    // under Figtree it lands in the system face. components/AppTextInput keeps
    // the prop — transparent, for VoiceOver and getByPlaceholderText — and
    // draws a real <Text> instead.
    await openBoard();
    const field = screen.getByTestId('overview-board-finder');
    expect(field.props.placeholder).toBe('Search or add a task…');
    expect(field.props.placeholderTextColor).toBe('transparent');
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

describe('the stat tiles open what is behind the number', () => {
  // "Late" and "Today" are answered against the REAL clock (OverviewPage reads
  // localTodayStr), so these dates have to be relative to it. They were fixed
  // strings pinned to the day the test was written, which meant the suite
  // passed until midnight and then called the "due today" task late — a
  // failure that looks like a bucketing bug and is a calendar page turning.
  const dayOffset = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const mixed = [
    task({ id: 'a', title: 'Late one', dueDate: dayOffset(-14) }),
    task({ id: 'b', title: 'Due today', dueDate: dayOffset(0) }),
    task({ id: 'c', title: 'Later', dueDate: dayOffset(76) }),
    task({ id: 'd', title: 'Finished', completed: true, completedAt: 1 }),
  ];

  test.each([
    ['overview-tile-late', 'Late · 1', ['a'], ['b', 'c', 'd']],
    ['overview-tile-today', 'Today · 1', ['b'], ['a', 'c']],
    ['overview-tile-done', 'Done · 1', ['d'], ['a', 'b', 'c']],
    ['overview-tile-todo', 'To do · 3', ['a', 'b', 'c'], ['d']],
  ])('%s opens a list of exactly the right tasks', async (tileId, heading, present, absent) => {
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({ tasks: mixed })} />);

    await user.press(screen.getByTestId(tileId));

    expect(screen.getByText(heading)).toBeTruthy();
    for (const id of present) expect(screen.getByTestId(`overview-task-${id}`)).toBeTruthy();
    for (const id of absent) expect(screen.queryByTestId(`overview-task-${id}`)).toBeNull();
  });

  test('a tile list names the board under each task — the one thing the title cannot', async () => {
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({ tasks: [task({ id: 'a', project: 'AMB Architects' })] })} />);
    await user.press(screen.getByTestId('overview-tile-todo'));
    // Asserted on the row itself: the board name is also on the page behind
    // (its board row), so a bare text query would match either.
    expect(screen.getByTestId('overview-task-a').props.accessibilityLabel)
      .toMatch(/^Renew the passport, AMB Architects/);
  });

  test('and a tap there opens the task too', async () => {
    const onOpenTask = jest.fn();
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({ tasks: mixed, onOpenTask })} />);
    await user.press(screen.getByTestId('overview-tile-late'));
    await user.press(screen.getByTestId('overview-task-a'));
    expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  test('an empty bucket says so rather than showing an empty page', async () => {
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({ tasks: [task({ id: 'c', dueDate: '2026-12-01' })] })} />);
    await user.press(screen.getByTestId('overview-tile-late'));
    expect(screen.getByText(/Nothing late/)).toBeTruthy();
  });
});

describe('the stats page', () => {
  test('the header key opens it, and it draws its charts', async () => {
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps()} />);

    await user.press(screen.getByTestId('overview-stats-key'));

    expect(screen.getByTestId('stats-completion')).toBeTruthy();
    expect(screen.getByTestId('stats-heatmap')).toBeTruthy();
    expect(screen.getByTestId('stats-weeks')).toBeTruthy();
    expect(screen.getByTestId('stats-weekdays')).toBeTruthy();
    expect(screen.getByTestId('stats-boards')).toBeTruthy();
  });
});
