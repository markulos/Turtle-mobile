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

/**
 * A LONG SECTION SHOWS THE FEW YOU ARE ACTUALLY USING.
 *
 * Twenty-six boards as chips is six wrapped rows of them, alphabetical, and
 * the two you are working on this week are never the ones beginning with A —
 * so the panel asked you to read all twenty-six every time, and the Labels and
 * People sections underneath were off the bottom of the screen before you
 * started. The chips are the most RECENTLY used few; the rest is one tap away
 * in place, and the whole list is behind the section's own search.
 */
describe('long sections lead with the recent few', () => {
  const MANY = ['Admin', 'Bible', 'Gym', 'Inbox', 'Job search', 'Larkin', 'Picco', 'Thesis'];
  // Recency is the screen's job (utils/recentFirst); the panel is handed the
  // order and shows the head of it.
  const RECENT = ['Thesis', 'Larkin', 'Gym', 'Inbox', 'Admin', 'Bible', 'Job search', 'Picco'];
  const many = (over = {}) => props({ projects: MANY, recentProjects: RECENT, ...over });

  test('four chips, and they are the recent four', async () => {
    await render(<PlannerFilterPanel {...many()} />);
    for (const name of ['Thesis', 'Larkin', 'Gym', 'Inbox']) {
      expect(screen.getByTestId(`planner-filter-board-${name}`)).toBeTruthy();
    }
    expect(screen.queryByTestId('planner-filter-board-Picco')).toBeNull();
  });

  test('the rest is one tap away, and folds back', async () => {
    await render(<PlannerFilterPanel {...many()} />);
    expect(screen.getByTestId('planner-filter-board-more')).toHaveTextContent('4 more');

    await press('planner-filter-board-more');
    expect(screen.getByTestId('planner-filter-board-Picco')).toBeTruthy();
    expect(screen.getByTestId('planner-filter-board-more')).toHaveTextContent('Show less');

    await press('planner-filter-board-more');
    expect(screen.queryByTestId('planner-filter-board-Picco')).toBeNull();
  });

  test('a short list gets no "more" key at all', async () => {
    await render(<PlannerFilterPanel {...props()} />);
    expect(screen.queryByTestId('planner-filter-board-more')).toBeNull();
  });

  // A panel that hides the filter it is applying cannot be read — which is the
  // whole reason the heading states its own answer.
  test('the chosen one is always a chip, however far down the order it fell', async () => {
    await render(<PlannerFilterPanel {...many({ selectedProject: 'Picco' })} />);
    expect(screen.getByTestId('planner-filter-board-Picco')).toBeTruthy();
    // And it does not cost one of the recent four.
    expect(screen.getByTestId('planner-filter-board-Thesis')).toBeTruthy();
  });

  test('labels fold the same way', async () => {
    await render(<PlannerFilterPanel {...props({
      tags: ['a', 'b', 'c', 'd', 'e', 'f'],
      recentTags: ['f', 'e', 'd', 'c', 'b', 'a'],
    })} />);
    expect(screen.getByTestId('planner-filter-tag-f')).toBeTruthy();
    expect(screen.queryByTestId('planner-filter-tag-a')).toBeNull();
    await press('planner-filter-tag-more');
    expect(screen.getByTestId('planner-filter-tag-a')).toBeTruthy();
  });

  test('with no recency order it still shows something — the list it was given', async () => {
    // A forgotten prop must narrow the panel, never empty it.
    await render(<PlannerFilterPanel {...props({ projects: MANY })} />);
    expect(screen.getByTestId('planner-filter-board-Admin')).toBeTruthy();
  });
});

describe('the whole list lives behind the section’s search', () => {
  const MANY = ['Admin', 'Bible', 'Gym', 'Inbox', 'Mayfield Construction', 'Thesis'];
  const type = async (text) => {
    await act(async () => { fireEvent.changeText(screen.getByTestId('planner-filter-search-input'), text); });
  };

  test('the key opens it, and it lists every board', async () => {
    await render(<PlannerFilterPanel {...props({ projects: MANY })} />);
    await press('planner-filter-board-search');
    for (const name of MANY) {
      expect(screen.getByTestId(`planner-filter-search-pick-${name}`)).toBeTruthy();
    }
  });

  test('it matches anywhere in the name, not just the start', async () => {
    // "cons" has to find "Mayfield Construction".
    await render(<PlannerFilterPanel {...props({ projects: MANY })} />);
    await press('planner-filter-board-search');
    await type('cons');
    expect(screen.getByTestId('planner-filter-search-pick-Mayfield Construction')).toBeTruthy();
    expect(screen.queryByTestId('planner-filter-search-pick-Admin')).toBeNull();
  });

  test('picking a board scopes the planner and closes the page', async () => {
    const onSelectProject = jest.fn();
    await render(<PlannerFilterPanel {...props({ projects: MANY, onSelectProject })} />);
    await press('planner-filter-board-search');
    await press('planner-filter-search-pick-Thesis');
    expect(onSelectProject).toHaveBeenCalledWith('Thesis');
    expect(screen.queryByTestId('planner-filter-search-pick-Thesis')).toBeNull();
  });

  test('picking a LABEL keeps the page up — labels are a multi-pick', async () => {
    const onToggleTag = jest.fn();
    await render(<PlannerFilterPanel {...props({ tags: ['urgent', 'home', 'errand'], onToggleTag })} />);
    await press('planner-filter-tag-search');
    await press('planner-filter-search-pick-urgent');
    expect(onToggleTag).toHaveBeenCalledWith('urgent');
    // Choosing three in a row should not be three trips through the page.
    expect(screen.getByTestId('planner-filter-search-pick-home')).toBeTruthy();
  });

  test('a board section with no boards offers no search', async () => {
    await render(<PlannerFilterPanel {...props({ projects: [] })} />);
    expect(screen.queryByTestId('planner-filter-board-search')).toBeNull();
  });
});
