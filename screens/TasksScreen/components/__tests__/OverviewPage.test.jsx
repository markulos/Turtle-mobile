import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, fireEvent, render, screen, userEvent, within } from '@testing-library/react-native';

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
import { RULE_HIGHLIGHT } from '../../../../utils/surfaceDepth';

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
  // A board tile UNFOLDS in place now, and its body is a measuring copy until
  // something lays it out; the full page is the key inside it.
  await expandBoard(user, 'Admin');
  await user.press(screen.getByTestId('overview-board-open-Admin'));
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
    await expandBoard(user, 'No Project');
    await user.press(screen.getByTestId('overview-board-open-No Project'));

    await act(async () => { fireEvent.changeText(screen.getByTestId('overview-board-finder'), 'Loose end'); });
    await user.press(screen.getByTestId('overview-finder-create'));

    expect(onAddTask).toHaveBeenCalledWith('Loose end', '');
  });
});

describe('the stat tiles open what is behind the number', () => {
  /** They live behind the Overview key now — open it, then press the tile. */
  const pressTile = async (user, tileId) => {
    await user.press(screen.getByTestId('overview-key'));
    await user.press(screen.getByTestId(tileId));
  };

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

    await pressTile(user, tileId);

    expect(screen.getByText(heading)).toBeTruthy();
    for (const id of present) expect(screen.getByTestId(`overview-task-${id}`)).toBeTruthy();
    for (const id of absent) expect(screen.queryByTestId(`overview-task-${id}`)).toBeNull();
  });

  test('a tile list names the board under each task — the one thing the title cannot', async () => {
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({ tasks: [task({ id: 'a', project: 'AMB Architects' })] })} />);
    await pressTile(user, 'overview-tile-todo');
    // Asserted on the row itself: the board name is also on the page behind
    // (its board row), so a bare text query would match either.
    expect(screen.getByTestId('overview-task-a').props.accessibilityLabel)
      .toMatch(/^Renew the passport, AMB Architects/);
  });

  test('and a tap there opens the task too', async () => {
    const onOpenTask = jest.fn();
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({ tasks: mixed, onOpenTask })} />);
    await pressTile(user, 'overview-tile-late');
    await user.press(screen.getByTestId('overview-task-a'));
    expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  test('an empty bucket says so rather than showing an empty page', async () => {
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({ tasks: [task({ id: 'c', dueDate: '2026-12-01' })] })} />);
    await pressTile(user, 'overview-tile-late');
    expect(screen.getByText(/Nothing late/)).toBeTruthy();
  });
});

// The four squares were the first thing on the tab, above the one control a
// blank-slate page needs. They are one key now — but what is LATE changes the
// shape of a day, so it rides on the key rather than hiding behind it.
describe('the Overview key', () => {
  const dayOffset = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // The key sits on the heading's line now, so it is a small pill rather than a
  // full-width row and the counts no longer fit on it as words. Late is the one
  // figure that cannot wait behind a tap, so it stays — as a dot, which is all
  // you need from it at a glance.
  test('shows a mark when something is late', async () => {
    await render(<OverviewPage {...baseProps({
      embedded: true,
      // The base fixture's own dueDate is in the past, so the not-late one has
      // to be given a future date explicitly.
      tasks: [task({ id: 'a', dueDate: dayOffset(-3) }), task({ id: 'b', dueDate: dayOffset(3) })],
    })} />);
    expect(screen.getByTestId('overview-key-late')).toBeTruthy();
    // …and still says so in full to a screen reader, where a dot says nothing.
    expect(screen.getByTestId('overview-key').props.accessibilityLabel).toMatch(/1 late/);
  });

  test('and no mark when nothing is', async () => {
    await render(<OverviewPage {...baseProps({ embedded: true, tasks: [task({ id: 'b', dueDate: dayOffset(3) })] })} />);
    expect(screen.queryByTestId('overview-key-late')).toBeNull();
    expect(screen.getByTestId('overview-key')).toHaveTextContent(/Overview/);
  });

  test('it opens the figures, and they are all still there', async () => {
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({ embedded: true })} />);
    expect(screen.queryByTestId('overview-tile-todo')).toBeNull();

    await user.press(screen.getByTestId('overview-key'));
    for (const id of ['todo', 'done', 'late', 'today']) {
      expect(screen.getByTestId(`overview-tile-${id}`)).toBeTruthy();
    }
  });
});

/**
 * The Inbox tab's capture field and its list are handed in as `header`, and the
 * one thing that matters about them is WHERE they render.
 *
 * They were siblings ABOVE this component, which put them outside the only
 * scroll view on the page — so they took their height off it, and once the list
 * had a dozen lines in it there was no scrollable area left underneath. The tab
 * simply stopped scrolling. A fixed header that GROWS is a page that stops
 * scrolling; inside the scroller it is just more content.
 */
/**
 * A board wears its own colour as its BORDER, all the way round and thin.
 *
 * It was a 3pt strip across the top edge, which made it the loudest thing in
 * the grid — a rule per board rather than a board with a colour.
 */
describe('a board tile', () => {
  // The coloured rectangle is the WRAPPER — it envelopes the header row and,
  // opened, the tasks. `overview-board-<name>` is the header button inside it.
  const tileStyle = (name) => StyleSheet.flatten(screen.getByTestId(`overview-board-wrap-${name}`).props.style);

  // FLAT colour, and the depth comes from the white line beside it. Mixing the
  // light INTO the hue was the wrong read of it twice over: the colour stops
  // being the board's, and the edge reads as a gradient rather than as an edge
  // with light on it.
  test('is outlined in its own colour, flat', async () => {
    await render(<OverviewPage {...baseProps({ embedded: true })} />);
    const box = tileStyle('Admin');
    expect(box.borderColor.toLowerCase()).toBe('#4ade80');
    // One colour all the way round — no per-edge shading.
    expect(box.borderTopColor).toBeUndefined();
    expect(box.borderBottomColor).toBeUndefined();
  });

  // The white sits BESIDE the colour, not mixed into it — two adjacent edges,
  // one coloured and one lit, which is what the header's rule does across a
  // page. It borrows that rule's white rather than picking one, or the two
  // read as different materials.
  test('carries a white liner hugging it, in the rule’s own white', async () => {
    await render(<OverviewPage {...baseProps({ embedded: true })} />);
    const liner = StyleSheet.flatten(
      screen.getByTestId('overview-board-wrap-Admin').props.children[0].props.style,
    );
    expect(liner.borderColor).toBe(RULE_HIGHLIGHT);
    expect(liner.position).toBe('absolute');
  });

  // Its radius is the tile's LESS the border it sits within, or the two curves
  // run at different rates round the corner and the line pinches.
  test('…and its corner follows the border it hugs', async () => {
    await render(<OverviewPage {...baseProps({ embedded: true })} />);
    const box = tileStyle('Admin');
    const liner = StyleSheet.flatten(
      screen.getByTestId('overview-board-wrap-Admin').props.children[0].props.style,
    );
    expect(liner.borderRadius).toBe(box.borderRadius - box.borderWidth);
  });

  // Thin enough to be an outline, heavy enough to be the board's: at a hairline
  // all the way round it read as barely there, and as a 3pt strip on ONE edge
  // it was the loudest thing on the page.
  // The WEIGHT is even all the way round even though the COLOUR is not: an
  // edge that changes thickness reads as a mistake, where one that changes
  // shade reads as light falling on it.
  test('the outline is an even weight all the way round', async () => {
    await render(<OverviewPage {...baseProps({ embedded: true })} />);
    const box = tileStyle('Admin');
    expect(box.borderWidth).toBe(2);
    expect(box.borderTopWidth).toBeUndefined();
    expect(box.borderBottomWidth).toBeUndefined();
  });

  // The board you are scoped to is the same hue drawn heavier. A different
  // COLOUR would fight the one the border is already saying.
  // The board is identified by the ridge's colours; the SELECTION is only ever
  // a weight. A second colour on top would be two claims in one place.
  test('the scoped board cuts the same ridge deeper', async () => {
    const { unmount } = await render(<OverviewPage {...baseProps({ embedded: true })} />);
    const resting = tileStyle('Admin');
    await act(async () => { unmount(); });

    await render(<OverviewPage {...baseProps({ embedded: true, selectedProject: 'Admin' })} />);
    const scoped = tileStyle('Admin');
    expect(scoped.borderWidth).toBeGreaterThan(resting.borderWidth);
    expect(scoped.borderTopColor).toBe(resting.borderTopColor);
  });

  // Opened, the rectangle has to hold the TASKS too — it used to wrap nothing
  // but its own title while they hung on the page below it, which is a board
  // that does not look like it holds anything.
  test('opened, the border envelopes the tasks', async () => {
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({ embedded: true, tasks: [task({ id: 'a', project: 'Admin' })] })} />);
    await expandBoard(user, 'Admin');

    const rect = screen.getByTestId('overview-board-wrap-Admin');
    expect(within(rect).getByTestId('overview-board-body-Admin')).toBeTruthy();
    expect(within(rect).getByTestId('overview-board-task-a')).toBeTruthy();
    expect(within(rect).getByTestId('overview-board-open-Admin')).toBeTruthy();
  });

  // The rectangle must NOT clip: the string deliberately paints past both
  // borders so it crosses them, and clipping would cut it at every board —
  // the one thing the arrangement exists to stop.
  test('and never clips, so the string can cross its edges', async () => {
    await render(<OverviewPage {...baseProps({ embedded: true })} />);
    expect(tileStyle('Admin').overflow).toBe('visible');
  });

  // One per row: two-up meant a tile had to be tall and stacked to fit
  // anything, and full width that is three short lines against an empty half.
  test('takes the whole row rather than half of one', async () => {
    await render(<OverviewPage {...baseProps({ embedded: true })} />);
    const box = tileStyle('Admin');
    expect(box.flexBasis).toBeUndefined();
    expect(box.width).toBeUndefined();
  });
});

describe('boards open together, and close on their own', () => {
  // One-at-a-time made the list close a board you were reading in order to
  // show you another, so comparing two meant opening each in turn and
  // remembering the first.
  test('opening a second board does not shut the first', async () => {
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({ embedded: true, boards: ['Admin', 'Garden'] })} />);

    await user.press(screen.getByTestId('overview-board-Admin'));
    await user.press(screen.getByTestId('overview-board-Garden'));

    expect(screen.getByTestId('overview-board-body-Admin')).toBeTruthy();
    expect(screen.getByTestId('overview-board-body-Garden')).toBeTruthy();
  });

  test('and each closes on its own key', async () => {
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({ embedded: true, boards: ['Admin', 'Garden'] })} />);

    await user.press(screen.getByTestId('overview-board-Admin'));
    await user.press(screen.getByTestId('overview-board-Garden'));
    await user.press(screen.getByTestId('overview-board-Admin'));

    // Admin's body stays MOUNTED while it rolls shut — there would be nothing
    // left to animate otherwise — so the state it reports is what to assert on.
    expect(screen.getByTestId('overview-board-Admin').props.accessibilityState.expanded).toBe(false);
    expect(screen.getByTestId('overview-board-Garden').props.accessibilityState.expanded).toBe(true);
  });
});

describe('a board’s own two verbs', () => {
  test('the pencil opens that board’s settings, and names which board', async () => {
    const onEditBoard = jest.fn();
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({ embedded: true, onEditBoard })} />);
    await user.press(screen.getByTestId('overview-board-edit-Admin'));
    expect(onEditBoard).toHaveBeenCalledWith('Admin');
  });

  // They sit inside the header's own Pressable, so the inner key has to take
  // the touch — otherwise the pencil would also toggle the board under it.
  test('pressing a verb does not toggle the board it sits on', async () => {
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({ embedded: true, onEditBoard: jest.fn() })} />);
    await user.press(screen.getByTestId('overview-board-edit-Admin'));
    expect(screen.getByTestId('overview-board-Admin').props.accessibilityState.expanded).toBe(false);
  });

  test('the plus opens a box on that board, and opens the board to show it', async () => {
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({ embedded: true })} />);
    expect(screen.queryByTestId('overview-board-add-input-Admin')).toBeNull();

    await user.press(screen.getByTestId('overview-board-add-Admin'));
    await settleBoards();

    // Asking to add is also asking to open: a field on a shut board is a field
    // you cannot see.
    expect(screen.getByTestId('overview-board-Admin').props.accessibilityState.expanded).toBe(true);
    expect(screen.getByTestId('overview-board-add-input-Admin')).toBeTruthy();
  });
});

describe('the add key', () => {
  const keyStyle = (name) => StyleSheet.flatten(screen.getByTestId(`overview-board-add-${name}`).props.style);

  // Beside the name it sat wherever that name happened to end, so on a column
  // of boards it landed in twenty-six different places and there was nowhere
  // to aim. It is a fixed distance from the right edge on every card now.
  test('is the same size and shape on every board, whatever the name', async () => {
    await render(<OverviewPage {...baseProps({
      embedded: true,
      boards: ['Admin', 'A board with a very much longer name than that one'],
    })} />);
    const a = keyStyle('Admin');
    const b = keyStyle('A board with a very much longer name than that one');
    expect(a.width).toBe(b.width);
    expect(a.height).toBe(b.height);
  });

  // A square with a soft corner, not a circle: a circle reads as a floating
  // action and this is a key on a row.
  test('is a square with a soft corner, big enough to hit', async () => {
    await render(<OverviewPage {...baseProps({ embedded: true })} />);
    const box = keyStyle('Admin');
    expect(box.width).toBe(box.height);
    expect(box.width).toBeGreaterThanOrEqual(32);
    expect(box.borderRadius).toBeGreaterThan(0);
    expect(box.borderRadius).toBeLessThan(box.width / 2);
  });

  test('wears its own board’s colour, faintly', async () => {
    await render(<OverviewPage {...baseProps({ embedded: true })} />);
    // colorOf returns #4ade80 for every board in these fixtures.
    expect(keyStyle('Admin').backgroundColor).toMatch(/^#4ade80/i);
    // Faint: an alpha channel, not the colour neat.
    expect(keyStyle('Admin').backgroundColor).not.toBe('#4ade80');
  });

  test('and lights up while its box is open', async () => {
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({ embedded: true })} />);
    const resting = keyStyle('Admin').backgroundColor;

    await user.press(screen.getByTestId('overview-board-add-Admin'));
    await settleBoards();

    expect(keyStyle('Admin').backgroundColor).not.toBe(resting);
  });

  // The boardless row's "colour" is a THEME TOKEN, which may already be an
  // rgba() — appending an alpha to that is not a colour, and RN renders an
  // invalid colour as black.
  test('a board with no colour of its own gets no fill, not a black one', async () => {
    await render(<OverviewPage {...baseProps({
      embedded: true,
      tasks: [task({ id: 'n1', project: '' })],
      colorOf: () => 'rgba(0,0,0,0.5)',
    })} />);
    expect(keyStyle('No Project').backgroundColor).toBe('transparent');
  });
});

describe('the add box', () => {
  const typeIn = async (board, text) => {
    await act(async () => {
      fireEvent.changeText(screen.getByTestId(`overview-board-add-input-${board}`), text);
    });
  };

  test('creates into the board it belongs to', async () => {
    const onAddTask = jest.fn();
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({ embedded: true, onAddTask })} />);
    await user.press(screen.getByTestId('overview-board-add-Admin'));
    await settleBoards();
    await typeIn('Admin', 'Ring the bank');
    await user.press(screen.getByTestId('overview-board-add-go-Admin'));
    expect(onAddTask).toHaveBeenCalledWith('Ring the bank', 'Admin');
  });

  // NO_BOARD is a DISPLAY sentinel — a task filed under it has no board at all,
  // not one named for the sentinel.
  test('and into NO board from the boardless one', async () => {
    const onAddTask = jest.fn();
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({
      embedded: true,
      onAddTask,
      tasks: [task({ id: 'n1', project: '' })],
    })} />);
    await user.press(screen.getByTestId('overview-board-add-No Project'));
    await settleBoards();
    await typeIn('No Project', 'Loose end');
    await user.press(screen.getByTestId('overview-board-add-go-No Project'));
    expect(onAddTask).toHaveBeenCalledWith('Loose end', '');
  });

  // "Is this already here?" and "put it here" are one gesture rather than two,
  // which is the whole reason it is one box.
  test('typing narrows what the board is showing', async () => {
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({
      embedded: true,
      tasks: [
        task({ id: 'a', title: 'Ring the bank', project: 'Admin' }),
        task({ id: 'b', title: 'Book the ferry', project: 'Admin' }),
      ],
    })} />);
    await user.press(screen.getByTestId('overview-board-add-Admin'));
    await settleBoards();
    await typeIn('Admin', 'ferry');

    expect(screen.getByTestId('overview-board-task-b')).toBeTruthy();
    expect(screen.queryByTestId('overview-board-task-a')).toBeNull();
  });

  test('an empty box will not make an untitled task', async () => {
    const onAddTask = jest.fn();
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({ embedded: true, onAddTask })} />);
    await user.press(screen.getByTestId('overview-board-add-Admin'));
    await settleBoards();
    await user.press(screen.getByTestId('overview-board-add-go-Admin'));
    expect(onAddTask).not.toHaveBeenCalled();
  });
});

/**
 * THE TEST THAT WAS MISSING, and the bug it would have caught.
 *
 * The body used to be measured INSIDE the collapsing box — which is clipped and
 * starts at zero height, so it was measured inside the very constraint the
 * measurement exists to escape. It reported nothing, the roll waited forever on
 * a height that was never coming, and every board simply stayed shut.
 *
 * Nothing in the old tests could see it: RNTL performs no layout, so `onLayout`
 * never fires and a body stuck at height zero looks exactly like one that
 * opened. These drive the layout event by hand, which is the only way to tell
 * the two apart without a device.
 */
describe('a board actually opens', () => {
  const layout = async (testID, height) => {
    await act(async () => {
      fireEvent(screen.getByTestId(testID), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 300, height } },
      });
    });
  };

  test('it measures in a pass of its own before it rolls', async () => {
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({ embedded: true })} />);
    await user.press(screen.getByTestId('overview-board-Admin'));

    // Unmeasured: a measuring pass, NOT the collapsing box — a height read
    // inside the clip is a height that never arrives.
    expect(screen.getByTestId('board-measuring')).toBeTruthy();
    expect(screen.queryByTestId('board-collapsible')).toBeNull();
  });

  test('…and the measuring pass is out of flow, so nothing moves for it', async () => {
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({ embedded: true })} />);
    await user.press(screen.getByTestId('overview-board-Admin'));

    const box = StyleSheet.flatten(screen.getByTestId('board-measuring').props.style);
    expect(box.position).toBe('absolute');
    expect(box.opacity).toBe(0);
    // Full width, or the height it reports is the wrong one.
    expect(box.left).toBe(0);
    expect(box.right).toBe(0);
  });

  test('once it reports a height, the collapsing box takes over', async () => {
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({ embedded: true })} />);
    await user.press(screen.getByTestId('overview-board-Admin'));
    await layout('board-measuring', 180);

    expect(screen.getByTestId('board-collapsible')).toBeTruthy();
    expect(screen.queryByTestId('board-measuring')).toBeNull();
  });

  test('and the tasks are reachable throughout, measured or not', async () => {
    const user = userEvent.setup();
    const props = baseProps({ embedded: true, tasks: [task({ id: 'a', project: 'Admin' })] });
    await render(<OverviewPage {...props} />);
    await user.press(screen.getByTestId('overview-board-Admin'));

    expect(screen.getByTestId('overview-board-task-a')).toBeTruthy();
    await layout('board-measuring', 180);
    expect(screen.getByTestId('overview-board-task-a')).toBeTruthy();
  });

  // A measured board that is closed and opened again must not go back to
  // measuring: the component only returns null, so what it learnt survives.
  test('a second open does not measure again', async () => {
    const user = userEvent.setup();
    await render(<OverviewPage {...baseProps({ embedded: true })} />);
    await user.press(screen.getByTestId('overview-board-Admin'));
    await layout('board-measuring', 180);
    expect(screen.getByTestId('board-collapsible')).toBeTruthy();

    // Shut it. The body stays MOUNTED while it rolls, so the state the header
    // reports is what to assert on.
    await user.press(screen.getByTestId('overview-board-Admin'));
    expect(screen.getByTestId('overview-board-Admin').props.accessibilityState.expanded).toBe(false);

    await user.press(screen.getByTestId('overview-board-Admin'));
    expect(screen.queryByTestId('board-measuring')).toBeNull();
    expect(screen.getByTestId('board-collapsible')).toBeTruthy();
  });
});

describe('the header scrolls with the page', () => {
  const Header = () => <Text testID="test-header">captured</Text>;

  test('the header renders INSIDE the scroller, not above it', async () => {
    await render(<OverviewPage {...baseProps({ embedded: true, header: <Header /> })} />);
    const scroller = screen.getByTestId('overview-scroll');
    expect(within(scroller).getByTestId('test-header')).toBeTruthy();
  });

  test('so the boards are still reachable under it', async () => {
    await render(<OverviewPage {...baseProps({ embedded: true, header: <Header /> })} />);
    const scroller = screen.getByTestId('overview-scroll');
    expect(within(scroller).getByTestId('overview-board-Admin')).toBeTruthy();
  });

  test('and with no header the page is unchanged', async () => {
    await render(<OverviewPage {...baseProps({ embedded: true })} />);
    expect(screen.queryByTestId('test-header')).toBeNull();
    expect(screen.getByTestId('overview-board-Admin')).toBeTruthy();
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

/** The four figures moved behind one key — open it before reaching for them. */
async function openOverview() {
  await act(async () => { fireEvent.press(screen.getByTestId('overview-key')); });
}

/**
 * Do the layout a device would do.
 *
 * An unmeasured board body renders as an out-of-flow, `pointerEvents="none"`
 * measuring copy — one frame on a phone, forever in a test, because RNTL
 * performs no layout and so `onLayout` never fires on its own. Anything that
 * opens a board and then touches what is inside it has to drive that event
 * first, or it is reaching into a copy that deliberately takes no touches.
 */
async function settleBoards(height = 180) {
  const measuring = screen.queryAllByTestId('board-measuring');
  if (measuring.length === 0) return;
  await act(async () => {
    for (const m of measuring) {
      fireEvent(m, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 300, height } } });
    }
  });
}

/** Open a board and let it settle, which is what a phone does in one frame. */
async function expandBoard(user, name) {
  await user.press(screen.getByTestId(`overview-board-${name}`));
  await settleBoards();
}

// ── Embedded as the Inbox tab ───────────────────────────────────────────────
// The overview stopped being a page you open from a tray and became the third
// view in the Tasks pager. Embedded it has no shell and no header of its own —
// the pager's segmented control IS the header, and the keys that would sit
// here (search, filters) live on the page around it.
describe('embedded in the pager', () => {
  // Asserted on the header's own KEYS rather than on the word "Overview",
  // which is now also the label of the key that opens the figures.
  test('it drops its own header: no back key, no header keys', async () => {
    await render(<OverviewPage {...baseProps({ embedded: true })} />);
    expect(screen.queryByTestId('overview-stats-key')).toBeNull();
    expect(screen.queryByTestId('overview-filters')).toBeNull();
    // …while the page itself is all still there.
    expect(screen.getByTestId('overview-key')).toBeTruthy();
    expect(screen.getByTestId('overview-board-Admin')).toBeTruthy();
  });

  test('it still keeps its header when it owns the whole screen', async () => {
    await render(<OverviewPage {...baseProps()} />);
    expect(screen.getByTestId('overview-filters')).toBeTruthy();
  });

  // The search narrows the BOARD list only. The tiles above are the whole
  // picture and stay whole — which is what makes it obvious you are filtering
  // a list rather than looking at a smaller pond.
  test('the query narrows the boards, never the totals', async () => {
    const props = baseProps({ embedded: true, boards: ['Admin', 'Garden'], query: 'gard' });
    await render(<OverviewPage {...props} />);
    expect(screen.queryByTestId('overview-board-Admin')).toBeNull();
    expect(screen.getByTestId('overview-board-Garden')).toBeTruthy();
    // The totals are whole whatever the list is showing — which is what makes
    // it obvious you are filtering a list rather than looking at a smaller pond.
    await openOverview();
    expect(screen.getByTestId('overview-tile-todo')).toBeTruthy();
  });

  test('an empty query leaves every board in place', async () => {
    await render(<OverviewPage {...baseProps({ embedded: true, boards: ['Admin', 'Garden'], query: '   ' })} />);
    expect(screen.getByTestId('overview-board-Admin')).toBeTruthy();
    expect(screen.getByTestId('overview-board-Garden')).toBeTruthy();
  });

  // The pager has to stop paging while a drill-down is up, or a left-edge
  // back-swipe and a page-swipe become the same gesture and the wrong one
  // wins. Reported from one effect, so no open/close site can forget.
  test('it reports when a drill-down opens and closes', async () => {
    const onDrillChange = jest.fn();
    await render(<OverviewPage {...baseProps({ embedded: true, onDrillChange })} />);
    expect(onDrillChange).toHaveBeenLastCalledWith(false);

    await openOverview();
    await act(async () => { fireEvent.press(screen.getByTestId('overview-tile-late')); });
    expect(onDrillChange).toHaveBeenLastCalledWith(true);
  });

  test('it releases the pager when it unmounts mid-drill', async () => {
    const onDrillChange = jest.fn();
    const view = await render(<OverviewPage {...baseProps({ embedded: true, onDrillChange })} />);
    await openOverview();
    await act(async () => { fireEvent.press(screen.getByTestId('overview-tile-late')); });
    expect(onDrillChange).toHaveBeenLastCalledWith(true);
    // Swiping away to another tab must not leave the pager locked forever.
    await act(async () => { view.unmount(); });
    expect(onDrillChange).toHaveBeenLastCalledWith(false);
  });
});
