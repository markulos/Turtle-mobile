import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('../../../../utils/haptics', () => ({
  tapHaptic: jest.fn(),
  impactHaptic: jest.fn(),
  markGesture: jest.fn(),
}));
jest.mock('../../../TurtleScreen/components/EdgeSwipePage', () => {
  const React = require('react');
  return function MockEdgeSwipePage({ visible, children }) {
    return visible ? React.createElement(React.Fragment, null, children) : null;
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

import PlannerSearchPanel from '../PlannerSearchPanel';
import { buildTaskIndex } from '../../utils/taskSearch';

const theme = {
  mode: 'dark',
  typography: { small: 13 },
  colors: {
    background: '#000', textPrimary: '#fff', textSecondary: '#ccc', textTertiary: '#888',
    textMuted: '#777', border: '#333', borderStrong: '#444', surface: '#111',
    surfaceElevated: '#1a1a1a', accentInfo: '#5598e7', accentSuccess: '#4ade80',
  },
};

const NOW = new Date(2026, 8, 26, 12, 0, 0).getTime();
const day = (o) => {
  const d = new Date(2026, 8, 26 + o);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const TASKS = [
  { id: 't1', title: 'Renew the passport', project: 'Admin', tags: [], dueDate: day(1) },
  { id: 't2', title: 'Book the ferry', project: 'Travel', tags: ['urgent'], dueDate: day(3) },
  { id: 't3', title: 'File the receipts', project: 'Admin', tags: [], completed: true },
];

const props = (over = {}) => ({
  visible: true,
  mode: 'list',
  query: '',
  onQueryChange: jest.fn(),
  onClose: jest.fn(),
  scope: 'all',
  onScopeChange: jest.fn(),
  taskIndex: buildTaskIndex(TASKS),
  projects: ['Admin', 'Travel'],
  selectedProject: 'All',
  onOpenTask: jest.fn(),
  onFocusTask: jest.fn(),
  onPickBoard: jest.fn(),
  onAssignTask: jest.fn(),
  theme,
  isDark: true,
  nowMs: NOW,
  ...over,
});

const press = async (testID) => {
  const el = screen.getByTestId(testID);
  await act(async () => { fireEvent.press(el); });
};

describe('the same field, a different errand per tab', () => {
  // Search used to be the Boards tab's alone: to look for a TASK you first had
  // to go to the one page that does not list tasks.
  test('the agenda searches tasks, and a hit opens it', async () => {
    const p = props({ mode: 'list', query: 'ferry' });
    await render(<PlannerSearchPanel {...p} />);
    await press('planner-search-task-t2');
    expect(p.onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ id: 't2' }));
    expect(p.onFocusTask).not.toHaveBeenCalled();
  });

  test('the calendar searches the same tasks the same way', async () => {
    const p = props({ mode: 'calendar', query: 'passport' });
    await render(<PlannerSearchPanel {...p} />);
    await press('planner-search-task-t1');
    expect(p.onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
  });

  // The Focus tab's rows mean "start a block on this", which is a different
  // verb on the same noun — so it must not quietly open the task instead.
  test('the focus tab starts a block on the task it was given', async () => {
    const p = props({ mode: 'focus', query: 'ferry' });
    await render(<PlannerSearchPanel {...p} />);
    await press('planner-search-task-t2');
    expect(p.onFocusTask).toHaveBeenCalledWith(expect.objectContaining({ id: 't2' }));
    expect(p.onOpenTask).not.toHaveBeenCalled();
  });

  test('the boards tab searches boards, and a hit scopes the planner', async () => {
    const p = props({ mode: 'boards', query: 'trav' });
    await render(<PlannerSearchPanel {...p} />);
    await press('planner-search-board-Travel');
    expect(p.onPickBoard).toHaveBeenCalledWith('Travel');
  });

  test('the field says which errand it is on', async () => {
    await render(<PlannerSearchPanel {...props({ mode: 'focus' })} />);
    expect(screen.getByTestId('planner-search-input').props.placeholder).toBe('Find a task to focus on');
  });
});

// The Focus deck's own picker. Same panel, same rows, a different VERB: the
// header's focus search starts a block on what you pick, this one only names
// what the next one will be about.
describe('assigning a task to the next session', () => {
  test('a hit names the task instead of starting anything', async () => {
    const p = props({ mode: 'assign', query: 'ferry' });
    await render(<PlannerSearchPanel {...p} />);
    await press('planner-search-task-t2');
    expect(p.onAssignTask).toHaveBeenCalledWith(expect.objectContaining({ id: 't2' }));
    expect(p.onFocusTask).not.toHaveBeenCalled();
    expect(p.onOpenTask).not.toHaveBeenCalled();
  });

  test('the field asks the question this errand is', async () => {
    await render(<PlannerSearchPanel {...props({ mode: 'assign' })} />);
    expect(screen.getByTestId('planner-search-input').props.placeholder)
      .toBe('Which task is this session for?');
  });

  // The two modes must not read identically — picking in one starts a timer and
  // picking in the other does not, which is the whole difference.
  test('the hint says a press is not a start', async () => {
    await render(<PlannerSearchPanel {...props({ mode: 'assign', query: '' })} />);
    expect(screen.getByTestId('planner-search-focus-hint'))
      .toHaveTextContent(/pick one, then press Start session/);
  });

  test('it still lists what is next before you type', async () => {
    await render(<PlannerSearchPanel {...props({ mode: 'assign', query: '' })} />);
    expect(screen.getByTestId('planner-search-task-t1')).toBeTruthy();
  });
});

// The title names the Planner's scope, so the title is what picks it. The rows
// are the same board rows the Boards tab's search shows; what differs is that
// this one owns the whole screen.
describe('the board picker', () => {
  const picker = (over = {}) => props({ mode: 'boards', fullScreen: true, ...over });

  test('“All boards” leads the list — widening is a choice like any other', async () => {
    await render(<PlannerSearchPanel {...picker({ query: '' })} />);
    expect(screen.getByTestId('planner-search-board-__all__')).toBeTruthy();
  });

  test('picking it clears the scope rather than naming a board', async () => {
    const p = picker({ selectedProject: 'Travel' });
    await render(<PlannerSearchPanel {...p} />);
    await press('planner-search-board-__all__');
    expect(p.onPickBoard).toHaveBeenCalledWith('All');
  });

  test('the scope you are on is ticked, whichever it is', async () => {
    const { unmount } = await render(<PlannerSearchPanel {...picker({ selectedProject: 'All' })} />);
    expect(screen.getByTestId('planner-search-board-__all__').props.accessibilityState.selected).toBe(true);
    await act(async () => { unmount(); });

    await render(<PlannerSearchPanel {...picker({ selectedProject: 'Travel' })} />);
    expect(screen.getByTestId('planner-search-board-Travel').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('planner-search-board-__all__').props.accessibilityState.selected).toBe(false);
  });

  // A query that cannot mean "all boards" should not keep offering it — the row
  // would sit above the one thing you actually searched for.
  test('a query that rules it out takes it away', async () => {
    await render(<PlannerSearchPanel {...picker({ query: 'trav' })} />);
    expect(screen.queryByTestId('planner-search-board-__all__')).toBeNull();
    expect(screen.getByTestId('planner-search-board-Travel')).toBeTruthy();
  });

  test('a row says how much open work the board is carrying', async () => {
    const stats = { All: { total: 9, done: 1, overdue: 2 }, Travel: { total: 4, done: 1, overdue: 1 } };
    await render(<PlannerSearchPanel {...picker({ boardStats: stats })} />);
    expect(screen.getByText('3 open · 1 late')).toBeTruthy();
    expect(screen.getByText('8 open · 2 late')).toBeTruthy();
  });

  // "0 open" reads as an error at a glance; a board with nothing at all has
  // nothing to report rather than a zero.
  test('a finished board says so, and an empty one says nothing', async () => {
    const stats = { Travel: { total: 3, done: 3, overdue: 0 }, Admin: { total: 0, done: 0, overdue: 0 } };
    await render(<PlannerSearchPanel {...picker({ boardStats: stats })} />);
    expect(screen.getByText('all done')).toBeTruthy();
    expect(screen.queryByText('0 open')).toBeNull();
  });

  // Return should never silently widen the scope to everything.
  test('Return takes a named board, never “all”', async () => {
    const p = picker({ query: 'trav' });
    await render(<PlannerSearchPanel {...p} />);
    await act(async () => { fireEvent(screen.getByTestId('planner-search-input'), 'submitEditing'); });
    expect(p.onPickBoard).toHaveBeenCalledWith('Travel');
  });
});

describe('the answers', () => {
  test('a query narrows to what matches, and the rest is gone', async () => {
    await render(<PlannerSearchPanel {...props({ query: 'ferry' })} />);
    expect(screen.getByTestId('planner-search-task-t2')).toBeTruthy();
    expect(screen.queryByTestId('planner-search-task-t1')).toBeNull();
  });

  // An empty field answering "nothing" teaches you the search is broken. On
  // Focus in particular the whole errand is "pick something to work on".
  test('an empty field lists what is next rather than nothing', async () => {
    await render(<PlannerSearchPanel {...props({ query: '' })} />);
    expect(screen.getByTestId('planner-search-task-t1')).toBeTruthy();
    expect(screen.getByTestId('planner-search-task-t2')).toBeTruthy();
  });

  test('…and on Focus it says that is what the list is', async () => {
    await render(<PlannerSearchPanel {...props({ mode: 'focus', query: '' })} />);
    expect(screen.getByTestId('planner-search-focus-hint')).toBeTruthy();
  });

  test('the hint goes once you have actually asked something', async () => {
    await render(<PlannerSearchPanel {...props({ mode: 'focus', query: 'ferry' })} />);
    expect(screen.queryByTestId('planner-search-focus-hint')).toBeNull();
  });

  test('a row carries where the task lives and when it is due', async () => {
    await render(<PlannerSearchPanel {...props({ query: 'passport' })} />);
    expect(screen.getByText('Admin · Tomorrow')).toBeTruthy();
  });

  test('nothing matching says so in the tab’s own words', async () => {
    await render(<PlannerSearchPanel {...props({ mode: 'focus', query: 'zzzz' })} />);
    expect(screen.getByText(/No task matches that/)).toBeTruthy();
  });
});

describe('the scope chips', () => {
  test('tasks get them; boards do not, because a board is not to-do or done', async () => {
    const { unmount } = await render(<PlannerSearchPanel {...props({ mode: 'list' })} />);
    expect(screen.getByText('Overdue')).toBeTruthy();
    await act(async () => { unmount(); });

    await render(<PlannerSearchPanel {...props({ mode: 'boards' })} />);
    expect(screen.queryByText('Overdue')).toBeNull();
  });

  test('a chip narrows the list without touching the words you typed', async () => {
    await render(<PlannerSearchPanel {...props({ scope: 'done' })} />);
    expect(screen.getByTestId('planner-search-task-t3')).toBeTruthy();
    expect(screen.queryByTestId('planner-search-task-t1')).toBeNull();
  });
});
