import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

/**
 * BoardsCanvas — the map of every board, opened a piece at a time.
 *
 * The geometry is covered by utils/__tests__/boardMindMap and the tree by
 * utils/__tests__/boardTree; what these lock down is the WIRING, which is where
 * this page can quietly break: a node per board, disc sizes that follow the
 * activity, a tap that means the one thing the disc says it means, a way back
 * out that agrees with itself, and the not-loaded states not being mistaken for
 * "you have no boards".
 *
 * The transform is mocked away on purpose. Gesture Handler and Reanimated do
 * their work on the UI thread, which jest does not have — asserting on a
 * mocked shared value would only be asserting on the mock.
 */

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('../../../../utils/haptics', () => ({
  tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

// Leaving the map for another tab: the canvas navigates AND posts a board link.
// Both halves matter — the tab is where you land, the link is what filters it.
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
const mockBoardLink = jest.fn();
jest.mock('../../../../context/BoardLinkContext', () => ({
  useBoardLink: () => ({ open: mockBoardLink, pending: null, clear: jest.fn() }),
}));

jest.mock('react-native-gesture-handler', () => {
  const { View: RNView } = require('react-native');
  // Every builder method returns the builder, so the real chains
  // (`.averageTouches(true).onStart(fn)…`) compose without a stub per method.
  const builder = () => {
    const chainable = new Proxy({}, { get: () => () => chainable });
    return chainable;
  };
  return {
    GestureHandlerRootView: RNView,
    GestureDetector: ({ children }) => children,
    Gesture: { Pan: builder, Pinch: builder, Simultaneous: builder },
  };
});

jest.mock('react-native-reanimated', () => {
  const { View: RNView } = require('react-native');
  return {
    __esModule: true,
    default: { View: RNView },
    useSharedValue: (initial) => ({ value: initial }),
    useAnimatedStyle: () => ({}),
    useAnimatedKeyboard: () => ({ height: { value: 0 } }),
    withTiming: (value) => value,
    withDecay: () => 0,
    cancelAnimation: () => {},
    runOnJS: (fn) => fn,
    // Must cover the whole Easing surface utils/motionReanimated binds, not
    // just the curves this screen happens to use: that module builds every
    // named curve at import, so a partial mock here fails the suite at require
    // time with "Easing.in is not a function".
    Easing: {
      bezier: () => () => 0,
      in: () => () => 0,
      out: () => () => 0,
      inOut: () => () => 0,
      cubic: () => 0,
      quad: () => 0,
      linear: () => 0,
    },
  };
});

jest.mock('../../../../context/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      mode: 'dark',
      colors: {
        background: '#000',
        surface: '#0a0a0a',
        surfaceElevated: '#111',
        surfaceHighlight: '#161616',
        border: '#222',
        textPrimary: '#fff',
        textSecondary: '#aaa',
        textTertiary: '#888',
        textMuted: '#666',
      },
    },
  }),
}));

// The page brings its own EdgeSwipePage; here it is just "render when visible".
jest.mock('../EdgeSwipePage', () => {
  const { View: RNView } = require('react-native');
  return ({ visible, children }) => (visible ? <RNView>{children}</RNView> : null);
});

// A stub, so a node's disc SIZE is assertable — the real collage is covered
// where it lives.
jest.mock('../BoardAvatar', () => {
  const { View: RNView } = require('react-native');
  const Stub = ({ name, size }) => <RNView testID={`avatar-${name}`} accessibilityValue={{ now: Math.round(size) }} />;
  return {
    __esModule: true,
    default: Stub,
    boardColor: () => '#888',
    boardTint: () => 'rgba(136,136,136,0.5)',
  };
});

jest.mock('../BoardTimeline', () => {
  const { Text } = require('react-native');
  return ({ visible, board }) => (visible ? <Text>{`timeline:${board}`}</Text> : null);
});

// `mock`-prefixed so jest's mock-factory hoisting will let the factories below
// close over them.
const mockOverview = {
  boards: [],
  avatars: {},
  mediaBase: 'http://turtle.local',
  loading: false,
  refreshing: false,
  loadFailed: false,
  load: jest.fn(),
  createBoard: jest.fn(async () => ({ ok: true })),
  moveBoard: jest.fn(async () => ({ ok: true })),
  deleteBoard: jest.fn(async () => ({ ok: true })),
};
jest.mock('../../hooks/useBoardsOverview', () => ({
  __esModule: true,
  default: () => mockOverview,
}));

// What a board holds, keyed `board/kind`. The real hook fetches this lazily
// when a GROUP opens; here it is a table, set up front.
const mockContents = { items: {}, more: {}, invalidate: jest.fn() };
jest.mock('../../hooks/useBoardContents', () => ({
  __esModule: true,
  default: () => ({
    itemsOf: (name, kind) => mockContents.items[`${name}/${kind}`] || [],
    moreOf: (name, kind) => mockContents.more[`${name}/${kind}`] || 0,
    invalidate: mockContents.invalidate,
  }),
}));

// eslint-disable-next-line import/first
import BoardsCanvas from '../BoardsCanvas';

const setOverview = (patch) => Object.assign(mockOverview, patch);

const BOARDS = [
  { name: 'Recipes', total: 40, lastTs: Date.now() - 60000, counts: {}, latest: null },
  { name: 'Drone spraying', total: 4, lastTs: Date.now() - 3 * 86400000, counts: {}, latest: null },
  { name: 'Inbox', total: 0, lastTs: 0, counts: {}, latest: null },
];

/** A board row as /projects-overview returns one — counts included. */
const row = (name, parent, counts = {}) => {
  const c = {
    tasks: 0, notes: 0, media: 0, chat: 0, ...counts,
  };
  return {
    name,
    parent,
    counts: c,
    total: c.tasks + c.notes + c.media + c.chat,
    lastTs: 0,
  };
};

// Work ─ Q3 ─ Launch
//     └─ Admin
// Home
const TREE = [
  row('Work', null, { tasks: 1 }),
  row('Q3', 'Work', { tasks: 2 }),
  row('Launch', 'Q3', { media: 5 }),
  row('Admin', 'Work', { notes: 3 }),
  row('Home', null, { media: 5, tasks: 2, audio: 4 }),
];

// Nothing lays out until the viewport reports a size — the canvas is
// positioned against the measured box, never against Dimensions.
const measure = async (view) => {
  await act(async () => {
    fireEvent(view.getByTestId('boards-canvas'), 'layout', {
      nativeEvent: { layout: { width: 390, height: 800 } },
    });
  });
  return view;
};

/** Open the page and give it a viewport, which is every test's first two lines. */
const open = async (props = {}) => measure(await render(<BoardsCanvas visible onClose={jest.fn()} {...props} />));

/**
 * Change what the server says, mid-visit, and get the page to notice.
 *
 * The hooks are mocked as plain objects read during render, so a mutation only
 * lands if something re-renders — and `rerender()` does not, because the props
 * are unchanged and the new data is not in them. A viewport change is a real
 * state update the page already handles, and it goes through the same single
 * act() the initial measure does (nesting act inside act is what broke every
 * later render in this file when this was written with `rerender`).
 */
const reload = async (view, boards) => {
  setOverview({ boards });
  await act(async () => {
    fireEvent(view.getByTestId('boards-canvas'), 'layout', {
      nativeEvent: { layout: { width: 391, height: 800 } },
    });
  });
};

const discSize = (view, name) => view.getByTestId(`avatar-${name}`).props.accessibilityValue.now;
const press = async (view, matcher) => {
  await act(async () => { fireEvent.press(matcher(view)); });
};
const tapNode = (name) => (view) => view.getByTestId(`board-node-${name}`);
/** A group chip (or an open group's header) inside a board's frame. */
const tapGroup = (name, kind) => (view) => view.getByTestId(`board-group-${name}-${kind}`);
const holdNode = async (view, name) => {
  await act(async () => { fireEvent(view.getByTestId(`board-node-${name}`), 'longPress'); });
};
/** Re-root the map on a board — the mind map's answer to "go in there". */
const focusOn = async (view, name) => {
  await holdNode(view, name);
  await press(view, (v) => v.getByLabelText('Focus the map here'));
};
/**
 * Type into a composer. The act() is load-bearing, not ceremony: a bare
 * `fireEvent.changeText` here leaves the field's state unflushed, so the
 * submit button is still disabled when the next line presses it.
 */
const type = async (view, testID, text) => {
  await act(async () => { fireEvent.changeText(view.getByTestId(testID), text); });
};

const item = (id, kind, title) => ({ id: `${kind}:${id}`, kind, title });

beforeEach(() => {
  setOverview({
    boards: [],
    avatars: {},
    loading: false,
    loadFailed: false,
    load: jest.fn(),
    createBoard: jest.fn(async () => ({ ok: true })),
    moveBoard: jest.fn(async () => ({ ok: true })),
    deleteBoard: jest.fn(async () => ({ ok: true })),
  });
  mockContents.items = {};
  mockContents.more = {};
  mockContents.invalidate = jest.fn();
  mockNavigate.mockClear();
  mockBoardLink.mockClear();
});

describe('BoardsCanvas', () => {
  test('renders nothing at all until it is opened', async () => {
    setOverview({ boards: BOARDS });
    const view = await render(<BoardsCanvas visible={false} onClose={jest.fn()} />);
    expect(view.queryByTestId('boards-canvas')).toBeNull();
  });

  test('puts every board on the map, with its count and age', async () => {
    setOverview({ boards: BOARDS });
    const view = await open();

    for (const b of BOARDS) expect(view.getByTestId(`board-node-${b.name}`)).toBeTruthy();
    expect(view.getByText('Recipes')).toBeTruthy();
    expect(view.getByText('40 items · 1m')).toBeTruthy();
    expect(view.getByText('4 items · 3d')).toBeTruthy();
    // An untouched board says so rather than showing a bare "0".
    expect(view.getByText('Empty')).toBeTruthy();
    // The header count is the same population.
    expect(view.getByText('3')).toBeTruthy();
  });

  test('sizes each disc by how much is on the board', async () => {
    setOverview({ boards: BOARDS });
    const view = await open();

    expect(discSize(view, 'Recipes')).toBeGreaterThan(discSize(view, 'Drone spraying'));
    expect(discSize(view, 'Drone spraying')).toBeGreaterThan(discSize(view, 'Inbox'));
  });

  test('shows the hint until the map has actually been used', async () => {
    setOverview({ boards: BOARDS });
    expect((await open()).getByText('Tap to open a board · hold for options')).toBeTruthy();
  });

  test('an unreachable server offers a retry rather than claiming there are no boards', async () => {
    const load = jest.fn();
    setOverview({ boards: [], loadFailed: true, load });
    const view = await open();

    expect(view.getByText("Couldn't reach the server.")).toBeTruthy();
    expect(view.queryByText('No boards yet — make your first one.')).toBeNull();
    fireEvent.press(view.getByLabelText('Retry loading boards'));
    expect(load).toHaveBeenCalled();
  });

  test('a genuinely empty pond offers to make the first board, with no retry', async () => {
    setOverview({ boards: [], loadFailed: false });
    const view = await open();

    expect(view.getByText('No boards yet — make your first one.')).toBeTruthy();
    expect(view.queryByLabelText('Retry loading boards')).toBeNull();
    expect(view.getByLabelText('Create a board')).toBeTruthy();
  });

  test('a first load in flight is a spinner, not an empty pond', async () => {
    setOverview({ boards: [], loading: true });
    const view = await open();

    expect(view.queryByText('No boards yet — make your first one.')).toBeNull();
    expect(view.queryByText("Couldn't reach the server.")).toBeNull();
  });

  test('the back chevron closes the page from the whole map', async () => {
    const onClose = jest.fn();
    setOverview({ boards: BOARDS });
    const view = await open({ onClose });

    fireEvent.press(view.getByLabelText('Back'));
    expect(onClose).toHaveBeenCalled();
  });

  test('offers both framings — fit everything, and back to the busiest board', async () => {
    setOverview({ boards: BOARDS });
    const view = await open();

    expect(view.getByLabelText('Fit every board on screen')).toBeTruthy();
    expect(view.getByLabelText('Back to the busiest board')).toBeTruthy();
  });

  test('hides the framing controls while there is nothing to frame', async () => {
    // They only make sense with a map to frame.
    setOverview({ boards: [] });
    expect((await open()).queryByLabelText('Fit every board on screen')).toBeNull();
  });
});

describe('BoardsCanvas — opening a board into a frame', () => {
  test('draws only the top of the tree until something is opened', async () => {
    setOverview({ boards: TREE });
    const view = await open();

    expect(view.getByTestId('board-node-Work')).toBeTruthy();
    expect(view.getByTestId('board-node-Home')).toBeTruthy();
    // Q3 and Launch live inside Work; drawing every board at once is exactly
    // the thing this design is not.
    expect(view.queryByTestId('board-node-Q3')).toBeNull();
    expect(view.queryByTestId('board-node-Launch')).toBeNull();
  });

  test('marks a board that can be opened, with how many boards are inside it', async () => {
    setOverview({ boards: TREE });
    const view = await open();

    // Work holds Q3, Launch and Admin — the badge counts the whole subtree, or
    // a folder of folders would read as "1".
    expect(view.getByTestId('board-nested-Work')).toBeTruthy();
    expect(view.getByText('3')).toBeTruthy();
    // Home has no sub-boards at all but does have items of its own, so it is
    // still something you can open — just with no count to show.
    expect(view.getByTestId('board-nested-Home')).toBeTruthy();
    expect(view.getByText('3 boards · 1 item')).toBeTruthy();
  });

  test('sizes a board by everything beneath it, not by its own items alone', async () => {
    setOverview({ boards: TREE });
    const view = await open();

    // Work carries 1 item of its own against Home's 7, but holds 11 in total.
    expect(discSize(view, 'Work')).toBeGreaterThan(discSize(view, 'Home'));
  });

  test('a tap grows the board into a frame, without leaving the map', async () => {
    setOverview({ boards: TREE });
    const view = await open();

    expect(view.queryByTestId('board-frame-Work')).toBeNull();
    await press(view, tapNode('Work'));

    // The disc became a frame, and Work's sub-boards are laid out in it…
    expect(view.getByTestId('board-frame-Work')).toBeTruthy();
    expect(view.getByTestId('board-node-Q3')).toBeTruthy();
    expect(view.getByTestId('board-node-Admin')).toBeTruthy();
    // …while everything that was on the map before still is. That is the point
    // of opening in place: two boards open at once, side by side.
    expect(view.getByTestId('board-node-Home')).toBeTruthy();
    // And it did NOT open Work's conversation.
    expect(view.queryByText('timeline:Work')).toBeNull();
  });

  test('nests a frame inside a frame', async () => {
    setOverview({ boards: TREE });
    const view = await open();

    await press(view, tapNode('Work'));
    await press(view, tapNode('Q3'));
    await press(view, tapNode('Home'));

    expect(view.getByTestId('board-frame-Work')).toBeTruthy();
    expect(view.getByTestId('board-frame-Q3')).toBeTruthy();
    expect(view.getByTestId('board-frame-Home')).toBeTruthy();
    for (const name of ['Work', 'Q3', 'Launch', 'Admin', 'Home']) {
      expect(view.getByTestId(`board-node-${name}`)).toBeTruthy();
    }
    // Launch is two frames deep and still closed — a disc, not a frame.
    expect(view.queryByTestId('board-frame-Launch')).toBeNull();
  });

  test('an open board whose counts have not arrived is still a frame', async () => {
    // The fast names tier fills only name and parent. A board opened before the
    // overview lands has to be a frame in the meantime, not a sliver of border.
    setOverview({ boards: [{ name: 'Fresh', parent: null, total: 3, lastTs: 0 }] });
    const view = await open();

    await press(view, tapNode('Fresh'));
    expect(view.getByTestId('board-frame-Fresh')).toBeTruthy();
    expect(view.getByText('Nothing in here yet')).toBeTruthy();
  });

  test('tapping an open board closes it, and everything inside it', async () => {
    setOverview({ boards: TREE });
    const view = await open();

    await press(view, tapNode('Work'));
    await press(view, tapNode('Q3'));
    expect(view.getByTestId('board-node-Launch')).toBeTruthy();

    await press(view, tapNode('Work'));

    expect(view.queryByTestId('board-frame-Work')).toBeNull();
    expect(view.queryByTestId('board-node-Q3')).toBeNull();
    // Re-opening Work must not silently unfold Q3 again — the frame re-opens as
    // small as it was closed.
    await press(view, tapNode('Work'));
    expect(view.getByTestId('board-node-Q3')).toBeTruthy();
    expect(view.queryByTestId('board-frame-Q3')).toBeNull();
    expect(view.queryByTestId('board-node-Launch')).toBeNull();
  });

  test('a board with nothing in it opens its conversation instead', async () => {
    setOverview({ boards: [{ name: 'Fresh', parent: null, total: 0, lastTs: 0 }] });
    const view = await open();

    // Nothing to open out into, so the tap goes where the content is.
    expect(view.queryByTestId('board-nested-Fresh')).toBeNull();
    await press(view, tapNode('Fresh'));
    expect(view.getByText('timeline:Fresh')).toBeTruthy();
  });

  test('offers one tap back to a map you can see all of', async () => {
    setOverview({ boards: TREE });
    const view = await open();

    // Nothing to collapse yet, so the control isn't there.
    expect(view.queryByLabelText('Close every open board')).toBeNull();

    await press(view, tapNode('Work'));
    await press(view, tapNode('Q3'));
    await press(view, (v) => v.getByLabelText('Close every open board'));

    expect(view.queryByTestId('board-frame-Work')).toBeNull();
    expect(view.queryByTestId('board-node-Q3')).toBeNull();
    expect(view.queryByTestId('board-node-Launch')).toBeNull();
    expect(view.getByTestId('board-node-Work')).toBeTruthy();
  });
});

describe('BoardsCanvas — contents grouped by kind', () => {
  test('shows a chip per kind, with its count, before anything is fetched', async () => {
    setOverview({ boards: TREE });
    const view = await open();

    await press(view, tapNode('Home'));

    // Home has 5 photos and 2 tasks — and no notes, so there is no Notes chip
    // to tap and find nothing behind.
    expect(view.getByTestId('board-group-Home-media')).toBeTruthy();
    expect(view.getByTestId('board-group-Home-task')).toBeTruthy();
    expect(view.getByTestId('board-group-Home-audio')).toBeTruthy();
    expect(view.queryByTestId('board-group-Home-note')).toBeNull();
    expect(view.getByLabelText('5 Photos on Home. Show them')).toBeTruthy();
    expect(view.getByLabelText('2 Tasks on Home. Show them')).toBeTruthy();
    // Audio is its own group, not a lump of "media" — photos and music are two
    // different things in two different parts of the app.
    expect(view.getByLabelText('4 Audio on Home. Show them')).toBeTruthy();
    // The counts come from the overview the map already loaded, so nothing was
    // asked of the server to draw any of that.
    expect(view.queryByTestId('board-item-media:1')).toBeNull();
  });

  test('opens one group into its items, leaving the others shut', async () => {
    mockContents.items = {
      'Home/media': [item(1, 'media', 'Beach.jpg'), item(2, 'media', 'Hills.jpg')],
    };
    setOverview({ boards: TREE });
    const view = await open();

    await press(view, tapNode('Home'));
    await press(view, tapGroup('Home', 'media'));

    expect(view.getByTestId('board-group-frame-Home-media')).toBeTruthy();
    expect(view.getByText('Beach.jpg')).toBeTruthy();
    expect(view.getByText('Hills.jpg')).toBeTruthy();
    // Tasks stays a chip until it is asked for.
    expect(view.queryByTestId('board-group-frame-Home-task')).toBeNull();
    expect(view.getByLabelText('2 Tasks on Home. Show them')).toBeTruthy();
  });

  test('closes a group again without closing the board', async () => {
    mockContents.items = { 'Home/media': [item(1, 'media', 'Beach.jpg')] };
    setOverview({ boards: TREE });
    const view = await open();

    await press(view, tapNode('Home'));
    await press(view, tapGroup('Home', 'media'));
    expect(view.getByLabelText('5 Photos on Home. Hide them')).toBeTruthy();

    await press(view, tapGroup('Home', 'media'));

    expect(view.queryByTestId('board-group-frame-Home-media')).toBeNull();
    expect(view.queryByText('Beach.jpg')).toBeNull();
    expect(view.getByTestId('board-frame-Home')).toBeTruthy();
  });

  test('keeps two boards\' groups of the same kind apart', async () => {
    mockContents.items = {
      'Home/task': [item(1, 'task', 'Water the plants')],
      'Work/task': [item(2, 'task', 'Send the invoice')],
    };
    setOverview({ boards: TREE });
    const view = await open();

    await press(view, tapNode('Home'));
    await press(view, tapNode('Work'));
    await press(view, tapGroup('Home', 'task'));

    expect(view.getByText('Water the plants')).toBeTruthy();
    // Opening Home's Tasks must not open Work's.
    expect(view.queryByText('Send the invoice')).toBeNull();
  });

  test('an open group whose items have not arrived says so', async () => {
    setOverview({ boards: TREE });
    const view = await open();

    await press(view, tapNode('Home'));
    await press(view, tapGroup('Home', 'media'));

    expect(view.getByTestId('board-group-frame-Home-media')).toBeTruthy();
    expect(view.getByText('Loading…')).toBeTruthy();
  });

  test('tapping an item opens the board it lives on', async () => {
    mockContents.items = { 'Home/task': [item(1, 'task', 'Water the plants')] };
    setOverview({ boards: TREE });
    const view = await open();

    await press(view, tapNode('Home'));
    await press(view, tapGroup('Home', 'task'));
    await press(view, (v) => v.getByTestId('board-item-task:1'));

    expect(view.getByText('timeline:Home')).toBeTruthy();
  });

  test('closes a full group with a way into the rest of the board', async () => {
    mockContents.items = { 'Home/media': [item(1, 'media', 'Beach.jpg')] };
    mockContents.more = { 'Home/media': 1 };
    setOverview({ boards: TREE });
    const view = await open();

    await press(view, tapNode('Home'));
    await press(view, tapGroup('Home', 'media'));
    await press(view, (v) => v.getByLabelText('See everything on Home'));

    expect(view.getByText('timeline:Home')).toBeTruthy();
  });

  test('every group offers a way through to where that kind of thing lives', async () => {
    const onClose = jest.fn();
    setOverview({ boards: TREE });
    const view = await open({ onClose });

    await press(view, tapNode('Home'));
    await press(view, tapGroup('Home', 'media'));
    await press(view, (v) => v.getByTestId('board-open-in-Home-media'));

    // Both halves: the tab you land on, and the filter that makes landing there
    // worth anything.
    expect(mockBoardLink).toHaveBeenCalledWith('photos', 'Home');
    expect(mockNavigate).toHaveBeenCalledWith('Photos');
    // The map closes behind you — it is a page over the Profile tab, and
    // leaving it up means coming back to the map rather than to the photos.
    expect(onClose).toHaveBeenCalled();
  });

  test.each([
    ['note', 'notes', 'Notes'],
    ['task', 'tasks', 'Tasks'],
    ['audio', 'audio', 'Photos'],
  ])('sends the %s group to its own surface', async (kind, surface, tab) => {
    setOverview({ boards: TREE });
    const view = await open();

    // Admin has the notes, Home the audio and tasks — one board with all three
    // would do, but these are the rows that carry them.
    const board = kind === 'note' ? 'Admin' : 'Home';
    if (board === 'Admin') {
      await press(view, tapNode('Work'));
    }
    await press(view, tapNode(board));
    await press(view, tapGroup(board, kind));
    await press(view, (v) => v.getByTestId(`board-open-in-${board}-${kind}`));

    expect(mockBoardLink).toHaveBeenCalledWith(surface, board);
    expect(mockNavigate).toHaveBeenCalledWith(tab);
  });

  test('offers no way out for chat — its home is the board itself', async () => {
    setOverview({ boards: [row('Talk', null, { chat: 4 })] });
    const view = await open();

    await press(view, tapNode('Talk'));
    await press(view, tapGroup('Talk', 'chat'));

    expect(view.getByTestId('board-group-frame-Talk-chat')).toBeTruthy();
    expect(view.queryByTestId('board-open-in-Talk-chat')).toBeNull();
  });

  test('closing every open board closes their groups too', async () => {
    mockContents.items = { 'Home/media': [item(1, 'media', 'Beach.jpg')] };
    setOverview({ boards: TREE });
    const view = await open();

    await press(view, tapNode('Home'));
    await press(view, tapGroup('Home', 'media'));
    await press(view, (v) => v.getByLabelText('Close every open board'));

    expect(view.queryByTestId('board-frame-Home')).toBeNull();

    // Re-opening Home must not silently unfold Photos again.
    await press(view, tapNode('Home'));
    expect(view.queryByTestId('board-group-frame-Home-media')).toBeNull();
    expect(view.getByLabelText('5 Photos on Home. Show them')).toBeTruthy();
  });
});

describe('BoardsCanvas — focusing the map', () => {
  test('re-roots the map on one board, and the trail says where you are', async () => {
    setOverview({ boards: TREE });
    const view = await open();

    await focusOn(view, 'Work');
    await focusOn(view, 'Q3');

    expect(view.getByTestId('board-node-Launch')).toBeTruthy();
    expect(view.queryByTestId('board-node-Home')).toBeNull();
    expect(view.getByTestId('board-breadcrumbs')).toBeTruthy();
    expect(view.getByLabelText('Go up to Boards')).toBeTruthy();
    expect(view.getByLabelText('Go up to Work')).toBeTruthy();
    // You are standing in Q3, so its crumb is a label rather than a way back.
    expect(view.getByLabelText('Q3, current level')).toBeTruthy();
  });

  test('a breadcrumb jumps straight back to that level', async () => {
    setOverview({ boards: TREE });
    const view = await open();

    await focusOn(view, 'Work');
    await focusOn(view, 'Q3');
    await press(view, (v) => v.getByLabelText('Go up to Boards'));

    expect(view.getByTestId('board-node-Work')).toBeTruthy();
    expect(view.getByTestId('board-node-Home')).toBeTruthy();
    expect(view.queryByTestId('board-breadcrumbs')).toBeNull();
  });

  test('the back chevron pops one level before it leaves the page', async () => {
    const onClose = jest.fn();
    setOverview({ boards: TREE });
    const view = await open({ onClose });

    await focusOn(view, 'Work');
    await press(view, (v) => v.getByLabelText('Back to all boards'));

    expect(view.getByTestId('board-node-Home')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    // Only once we are back at the whole map does back mean "leave".
    await press(view, (v) => v.getByLabelText('Back'));
    expect(onClose).toHaveBeenCalled();
  });

  test('the board the map is focused on still has a door to its conversation', async () => {
    setOverview({ boards: TREE });
    const view = await open();

    // Focused on Work, Work itself is no longer a node — so the header is the
    // only way to its own tasks, notes and photos. Losing it would strand them.
    await focusOn(view, 'Work');
    expect(view.queryByTestId('board-node-Work')).toBeNull();
    await press(view, (v) => v.getByLabelText('Open the Work conversation'));
    expect(view.getByText('timeline:Work')).toBeTruthy();
  });

  test('is not offered for a board with nothing under it', async () => {
    setOverview({ boards: TREE });
    const view = await open();

    await holdNode(view, 'Home');
    expect(view.queryByLabelText('Focus the map here')).toBeNull();
  });

  test('an empty level says so, and offers to fill it', async () => {
    setOverview({ boards: [...TREE, { name: 'Ideas', parent: 'Home', total: 0, lastTs: 0 }] });
    const view = await open();

    await focusOn(view, 'Home');
    expect(view.getByTestId('board-node-Ideas')).toBeTruthy();

    // …and then Ideas is filed somewhere else while we are standing in Home.
    // "No boards" here would be a lie about the whole pond rather than about
    // this level, and would leave no way to put something back in it.
    await reload(view, TREE);

    expect(view.getByText('Nothing inside “Home” yet.')).toBeTruthy();
    expect(view.queryByText('No boards yet — make your first one.')).toBeNull();
    expect(view.getByLabelText('Create a board inside Home')).toBeTruthy();
  });

  test('a trail that has gone stale falls back to the deepest level still real', async () => {
    setOverview({ boards: TREE });
    const view = await open();

    await focusOn(view, 'Work');
    await focusOn(view, 'Q3');
    expect(view.getByTestId('board-node-Launch')).toBeTruthy();

    // Q3 is deleted elsewhere (the web app, Tasks) while this page is open.
    await reload(view, TREE.filter((b) => b.name !== 'Q3' && b.name !== 'Launch'));

    // We land in Work — the descent we made that is still true — rather than
    // being thrown all the way back to the top.
    expect(view.getByTestId('board-node-Admin')).toBeTruthy();
    expect(view.getByLabelText('Work, current level')).toBeTruthy();
    expect(view.queryByTestId('board-node-Launch')).toBeNull();
  });
});

describe('BoardsCanvas — making and moving boards', () => {
  test('creates a board at whatever the map is rooted on', async () => {
    const createBoard = jest.fn(async () => ({ ok: true }));
    setOverview({ boards: TREE, createBoard });
    const view = await open();

    await focusOn(view, 'Work');
    await press(view, (v) => v.getByLabelText('New board inside Work'));

    expect(view.getByTestId('board-create-sheet')).toBeTruthy();
    expect(view.getByText('Inside “Work”')).toBeTruthy();

    // Trimmed on the way out — a trailing space is a typo, not a board name.
    await type(view, 'board-create-name', '  Roadmap  ');
    await press(view, (v) => v.getByLabelText('Create board'));

    expect(createBoard).toHaveBeenCalledWith('Roadmap', 'Work');
  });

  test('creates at the top level when that is where you are', async () => {
    const createBoard = jest.fn(async () => ({ ok: true }));
    setOverview({ boards: TREE, createBoard });
    const view = await open();

    await press(view, (v) => v.getByLabelText('New board'));
    expect(view.getByText('At the top level')).toBeTruthy();

    await type(view, 'board-create-name', 'Garden');
    await press(view, (v) => v.getByLabelText('Create board'));

    expect(createBoard).toHaveBeenCalledWith('Garden', null);
  });

  test('opens the board it was created inside, so the new one is visible', async () => {
    setOverview({ boards: TREE });
    const view = await open();

    await holdNode(view, 'Work');
    await press(view, (v) => v.getByLabelText('New board inside'));
    await type(view, 'board-create-name', 'Roadmap');
    await press(view, (v) => v.getByLabelText('Create board'));

    // A board you cannot see reads exactly like a create that failed.
    expect(view.getByTestId('board-frame-Work')).toBeTruthy();
    expect(view.getByTestId('board-node-Q3')).toBeTruthy();
    expect(view.getByTestId('board-node-Admin')).toBeTruthy();
  });

  test('keeps the composer open with the server\'s reason when a create is refused', async () => {
    const createBoard = jest.fn(async () => ({ ok: false, error: 'You already have a board named "Home".' }));
    setOverview({ boards: TREE, createBoard });
    const view = await open();

    await press(view, (v) => v.getByLabelText('New board'));
    await type(view, 'board-create-name', 'Home');
    await press(view, (v) => v.getByLabelText('Create board'));

    expect(view.getByTestId('board-create-sheet')).toBeTruthy();
    expect(view.getByText('You already have a board named "Home".')).toBeTruthy();
  });

  test('holding a board opens its actions — including the ones a tap cannot reach', async () => {
    setOverview({ boards: TREE });
    const view = await open();

    await holdNode(view, 'Work');

    expect(view.getByTestId('board-actions-sheet')).toBeTruthy();
    expect(view.getByLabelText('Open Work')).toBeTruthy();
    expect(view.getByLabelText('New board inside')).toBeTruthy();
    expect(view.getByLabelText('Focus the map here')).toBeTruthy();
    expect(view.getByLabelText('Move to…')).toBeTruthy();
    expect(view.getByLabelText('Delete board')).toBeTruthy();
    expect(view.getByText('3 boards inside')).toBeTruthy();
  });

  test('opens a board\'s own conversation from the actions card', async () => {
    setOverview({ boards: TREE });
    const view = await open();

    await holdNode(view, 'Work');
    await press(view, (v) => v.getByLabelText('Open Work'));

    expect(view.getByText('timeline:Work')).toBeTruthy();
  });

  test('offers every legal destination for a move, and no illegal one', async () => {
    setOverview({ boards: TREE });
    const view = await open();

    await holdNode(view, 'Work');
    await press(view, (v) => v.getByLabelText('Move to…'));

    expect(view.getByLabelText('Move into Top level')).toBeTruthy();
    expect(view.getByLabelText('Move into Home')).toBeTruthy();
    // Work's own subtree would close a loop and strand the branch.
    expect(view.queryByLabelText('Move into Q3')).toBeNull();
    expect(view.queryByLabelText('Move into Launch')).toBeNull();
    expect(view.queryByLabelText('Move into Admin')).toBeNull();
    expect(view.queryByLabelText('Move into Work')).toBeNull();
  });

  test('moves a board and opens where it landed', async () => {
    const moveBoard = jest.fn(async () => ({ ok: true }));
    setOverview({ boards: TREE, moveBoard });
    const view = await open();

    await holdNode(view, 'Home');
    await press(view, (v) => v.getByLabelText('Move to…'));
    await press(view, (v) => v.getByLabelText('Move into Work'));

    expect(moveBoard).toHaveBeenCalledWith('Home', 'Work');
    // The board went somewhere; the map opens that frame so you can see it
    // there, or the move reads as a board that vanished.
    expect(view.getByTestId('board-frame-Work')).toBeTruthy();
    expect(view.getByTestId('board-node-Q3')).toBeTruthy();
    expect(view.getByTestId('board-node-Admin')).toBeTruthy();
  });
});

describe('BoardsCanvas — deleting a board', () => {
  /** Hold a board and step into the delete page. */
  const armDelete = async (view, name) => {
    await holdNode(view, name);
    await press(view, (v) => v.getByLabelText('Delete board'));
    return view;
  };

  test('says what deleting will actually do before asking', async () => {
    setOverview({ boards: TREE });
    const view = await armDelete(await open(), 'Work');

    // Deleting a board is not deleting what is on it, and the card has to say
    // so — an unqualified "delete" invites the user to assume the worst (and
    // keep dead boards forever) or the best (and be surprised).
    expect(view.getByText('Its 3 boards move up to the top level.')).toBeTruthy();
    expect(view.getByText('Tasks on it stay — they just lose their board.')).toBeTruthy();
    expect(view.getByText('Notes and photos keep the tag.')).toBeTruthy();
  });

  test('names the board the sub-boards will move up INTO', async () => {
    setOverview({ boards: TREE });
    const view = await open();
    await focusOn(view, 'Work');
    await armDelete(view, 'Q3');

    expect(view.getByText('Its board moves up to “Work”.')).toBeTruthy();
  });

  test('refuses to delete until the name is typed back exactly', async () => {
    const deleteBoard = jest.fn(async () => ({ ok: true }));
    setOverview({ boards: TREE, deleteBoard });
    const view = await armDelete(await open(), 'Work');

    // Nothing typed — the button is inert, not merely styled as inert.
    await press(view, (v) => v.getByLabelText('Delete Work'));
    expect(deleteBoard).not.toHaveBeenCalled();

    // The right idea, the wrong board.
    await type(view, 'board-delete-confirm', 'Home');
    await press(view, (v) => v.getByLabelText('Delete Work'));
    expect(deleteBoard).not.toHaveBeenCalled();

    // Nearly — but a board's name is its identity, so nearly is not it.
    await type(view, 'board-delete-confirm', 'work');
    await press(view, (v) => v.getByLabelText('Delete Work'));
    expect(deleteBoard).not.toHaveBeenCalled();
  });

  test('deletes once the name matches', async () => {
    const deleteBoard = jest.fn(async () => ({ ok: true }));
    setOverview({ boards: TREE, deleteBoard });
    const view = await armDelete(await open(), 'Work');

    // Surrounding whitespace is a keyboard artefact, not a different board.
    await type(view, 'board-delete-confirm', ' Work ');
    await press(view, (v) => v.getByLabelText('Delete Work'));

    expect(deleteBoard).toHaveBeenCalledWith('Work');
    // The card is done with; the map is still where it was.
    expect(view.queryByTestId('board-actions-sheet')).toBeNull();
  });

  test('backing out keeps the board, and forgets what was typed', async () => {
    const deleteBoard = jest.fn(async () => ({ ok: true }));
    setOverview({ boards: TREE, deleteBoard });
    const view = await armDelete(await open(), 'Work');

    await type(view, 'board-delete-confirm', 'Work');
    await press(view, (v) => v.getByLabelText('Keep this board'));

    expect(deleteBoard).not.toHaveBeenCalled();
    expect(view.getByLabelText('Move to…')).toBeTruthy();

    // Coming back must start from empty — a page that remembers a matching
    // name is a one-tap delete wearing a confirmation's clothes.
    await press(view, (v) => v.getByLabelText('Delete board'));
    await press(view, (v) => v.getByLabelText('Delete Work'));
    expect(deleteBoard).not.toHaveBeenCalled();
  });

  test('a refused delete keeps the card open with the reason', async () => {
    const deleteBoard = jest.fn(async () => ({ ok: false, error: 'Could not reach the server.' }));
    setOverview({ boards: TREE, deleteBoard });
    const view = await armDelete(await open(), 'Work');

    await type(view, 'board-delete-confirm', 'Work');
    await press(view, (v) => v.getByLabelText('Delete Work'));

    expect(view.getByTestId('board-actions-sheet')).toBeTruthy();
    expect(view.getByText('Could not reach the server.')).toBeTruthy();
  });
});
