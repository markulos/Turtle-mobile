import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('../../../../utils/haptics', () => ({ tapHaptic: jest.fn(), markGesture: jest.fn() }));
jest.mock('../../../TurtleScreen/components/EdgeSwipePage', () => {
  const React = require('react');
  return function MockEdgeSwipePage({ visible, children }) {
    return visible ? React.createElement(React.Fragment, null, children) : null;
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

import PlannerFilterPanel from '../PlannerFilterPanel';

const theme = {
  mode: 'dark',
  colors: {
    background: '#000', textPrimary: '#fff', textSecondary: '#ccc', textTertiary: '#888',
    textMuted: '#777', border: '#333', borderStrong: '#444', surface: '#111',
    accentInfo: '#5598e7',
  },
};

const props = (over = {}) => ({
  visible: true,
  onClose: jest.fn(),
  theme,
  statusFilter: 'todo',
  onStatusChange: jest.fn(),
  projects: ['Admin', 'Travel'],
  selectedProject: 'All',
  onSelectProject: jest.fn(),
  tags: ['urgent', 'home'],
  selectedTags: [],
  onToggleTag: jest.fn(),
  tagFilterMode: 'any',
  onTagModeChange: jest.fn(),
  owners: [],
  selectedOwners: [],
  onToggleOwner: jest.fn(),
  ownerColor: () => '#abc',
  matchCount: 12,
  onClearAll: jest.fn(),
  ...over,
});

const press = async (testID) => {
  const el = screen.getByTestId(testID);
  await act(async () => { fireEvent.press(el); });
};

describe('every way to narrow the Planner, in one place', () => {
  // It used to be three: status keys and a board rail folded inside the Boards
  // tab, and tags/people in a sheet behind a key inside that fold — none of it
  // reachable from the pages the filters actually act on.
  test('status, board, and labels are all on the one page', async () => {
    await render(<PlannerFilterPanel {...props()} />);
    expect(screen.getByTestId('planner-filter-status')).toBeTruthy();
    expect(screen.getByTestId('planner-filter-board')).toBeTruthy();
    expect(screen.getByTestId('planner-filter-tags')).toBeTruthy();
  });

  test('each control reports the choice it made', async () => {
    const p = props();
    await render(<PlannerFilterPanel {...p} />);
    await press('planner-filter-status-done');
    expect(p.onStatusChange).toHaveBeenCalledWith('done');
    await press('planner-filter-board-Travel');
    expect(p.onSelectProject).toHaveBeenCalledWith('Travel');
    await press('planner-filter-tag-urgent');
    expect(p.onToggleTag).toHaveBeenCalledWith('urgent');
  });

  test('“all boards” is a chip too, not the absence of one', async () => {
    const p = props({ selectedProject: 'Travel' });
    await render(<PlannerFilterPanel {...p} />);
    await press('planner-filter-board-all');
    expect(p.onSelectProject).toHaveBeenCalledWith('All');
  });
});

// Most of what "intuitive" means for a filter is knowing what is already on
// before you start changing it.
describe('the panel reads without being operated', () => {
  test('each section states its current answer in its heading', async () => {
    await render(<PlannerFilterPanel {...props({ statusFilter: 'done', selectedProject: 'Travel' })} />);
    expect(screen.getByTestId('planner-filter-status-value')).toHaveTextContent('Done');
    expect(screen.getByTestId('planner-filter-board-value')).toHaveTextContent('Travel');
  });

  test('“all boards” rather than the bare sentinel, which reads as a truncation', async () => {
    await render(<PlannerFilterPanel {...props({ selectedProject: 'All' })} />);
    expect(screen.getByTestId('planner-filter-board-value')).toHaveTextContent('All boards');
  });

  test('the labels heading says how many and how they combine', async () => {
    await render(<PlannerFilterPanel {...props({ selectedTags: ['urgent', 'home'], tagFilterMode: 'all' })} />);
    expect(screen.getByTestId('planner-filter-tags-value')).toHaveTextContent('2 chosen · match all');
  });
});

describe('the footer', () => {
  // Without a live count you have to close the panel to find out whether what
  // you just picked left anything at all.
  test('says how many items survive, live', async () => {
    await render(<PlannerFilterPanel {...props({ matchCount: 7, selectedTags: ['urgent'] })} />);
    expect(screen.getByTestId('planner-filter-count')).toHaveTextContent('7 items match');
  });

  test('counts one properly rather than “1 items”', async () => {
    await render(<PlannerFilterPanel {...props({ matchCount: 1, selectedTags: ['urgent'] })} />);
    expect(screen.getByTestId('planner-filter-count')).toHaveTextContent('1 item match');
  });

  test('unfiltered, it says what it is counting instead of claiming a match', async () => {
    await render(<PlannerFilterPanel {...props({ matchCount: 20 })} />);
    expect(screen.getByTestId('planner-filter-count')).toHaveTextContent('20 items in the Planner');
  });

  test('Show closes the panel', async () => {
    const p = props();
    await render(<PlannerFilterPanel {...p} />);
    await press('planner-filter-done');
    expect(p.onClose).toHaveBeenCalled();
  });
});

describe('clear', () => {
  // A key that appears and disappears is a key you cannot aim for.
  test('is always there, and disabled when there is nothing to clear', async () => {
    await render(<PlannerFilterPanel {...props()} />);
    expect(screen.getByTestId('planner-filter-clear').props.accessibilityState.disabled).toBe(true);
  });

  test('wakes up as soon as anything is narrowing the list', async () => {
    const p = props({ selectedTags: ['urgent'] });
    await render(<PlannerFilterPanel {...p} />);
    expect(screen.getByTestId('planner-filter-clear').props.accessibilityState.disabled).toBe(false);
    await press('planner-filter-clear');
    expect(p.onClearAll).toHaveBeenCalled();
  });

  test('a board scope alone counts as narrowing', async () => {
    await render(<PlannerFilterPanel {...props({ selectedProject: 'Admin' })} />);
    expect(screen.getByTestId('planner-filter-clear').props.accessibilityState.disabled).toBe(false);
  });
});

describe('sections that would say nothing are not shown', () => {
  // Offering a choice that changes nothing is how a panel teaches you not to
  // trust its controls: with one label picked, "any" and "all" select the same
  // set.
  test('any-vs-all appears only once two labels are chosen', async () => {
    const { unmount } = await render(<PlannerFilterPanel {...props({ selectedTags: ['urgent'] })} />);
    expect(screen.queryByTestId('planner-filter-tagmode')).toBeNull();
    await act(async () => { unmount(); });

    await render(<PlannerFilterPanel {...props({ selectedTags: ['urgent', 'home'] })} />);
    expect(screen.getByTestId('planner-filter-tagmode')).toBeTruthy();
  });

  test('a solo pond gets no People section — there is nobody to disambiguate', async () => {
    await render(<PlannerFilterPanel {...props({ owners: [] })} />);
    expect(screen.queryByTestId('planner-filter-people')).toBeNull();
  });

  test('a shared one does, and a person can be picked', async () => {
    const p = props({ owners: [{ userId: 'u1', ownerName: 'Sam' }] });
    await render(<PlannerFilterPanel {...p} />);
    await press('planner-filter-owner-u1');
    expect(p.onToggleOwner).toHaveBeenCalledWith('u1');
  });

  test('no labels in play, no Labels section', async () => {
    await render(<PlannerFilterPanel {...props({ tags: [] })} />);
    expect(screen.queryByTestId('planner-filter-tags')).toBeNull();
  });
});
