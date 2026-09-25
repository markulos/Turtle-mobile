import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
// The search panel is a pushed page; here it is just its contents, so the
// tests can assert on the search rather than on the slide-in.
jest.mock('../../../TurtleScreen/components/EdgeSwipePage', () => {
  const React = require('react');
  return function MockEdgeSwipePage({ visible, children }) {
    return visible ? React.createElement(React.Fragment, null, children) : null;
  };
});

const mockApi = { get: jest.fn() };
let mockConnected = true;
jest.mock('../../../../context/ServerContext', () => ({
  useServer: () => ({ api: mockApi, isConnected: mockConnected }),
  getApiAuthToken: () => 't',
}));

import NoteLinkPicker, { NoteSearchPanel } from '../NoteLinkPicker';

const theme = {
  mode: 'dark',
  colors: new Proxy({}, { get: () => '#334155' }),
  typography: new Proxy({}, { get: () => 14 }),
};

const note = (over) => ({
  id: over.id, content: over.content || '', description: over.description || '',
  tags: over.tags || [], type: over.type || 'note', createdAt: over.createdAt || 1,
});

const PAGE = [
  note({ id: 'p1', content: 'Milk run', createdAt: 3 }),
  note({ id: 'p2', content: 'Call the plumber', createdAt: 2 }),
  note({ id: 'p3', content: 'Buy a gift', type: 'todo', createdAt: 1 }),
];

// Routes each endpoint the picker talks to; a test overrides just the one it
// cares about. Keyed by the distinctive path segment.
const routeApi = ({ page = PAGE, search = [], index = [] } = {}) => {
  mockApi.get.mockImplementation((path) => {
    if (path.includes('/notes/search')) return Promise.resolve({ success: true, notes: search });
    if (path.includes('/notes/index')) return Promise.resolve({ success: true, index });
    return Promise.resolve({ success: true, notes: page });
  });
};

/**
 * The field and the search are two components now — the form mounts the field
 * in its ScrollView and the page outside it, because an absolute-fill layer
 * inside scrolling content is positioned against the content. This harness is
 * that arrangement, so the tests drive what the form actually renders.
 */
function Host({ value = null, onPick = () => {}, onClear = () => {} }) {
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState(value);
  return (
    <>
      <NoteLinkPicker
        value={picked}
        onClear={() => { setPicked(null); onClear(); }}
        onRequestOpen={() => setOpen(true)}
        theme={theme}
      />
      <NoteSearchPanel
        visible={open}
        onPick={(n) => { setPicked(n); onPick(n); }}
        onClose={() => setOpen(false)}
        theme={theme}
      />
    </>
  );
}

const draw = (props = {}) => render(<Host {...props} />);

const openPicker = async (view) => {
  await fireEvent.press(view.getByLabelText('Link a note'));
  await waitFor(() => expect(view.getByPlaceholderText('Search notes, todos, tags…')).toBeTruthy());
};

const type = async (view, text) => {
  await act(async () => {
    fireEvent.changeText(view.getByPlaceholderText('Search notes, todos, tags…'), text);
  });
};

beforeEach(() => { jest.useFakeTimers(); mockApi.get.mockReset(); mockConnected = true; routeApi(); });
afterEach(() => { jest.useRealTimers(); });

// The debounced FTS call sits behind a timer; this lets it fire and settle.
const flushSearch = async () => {
  await act(async () => { jest.advanceTimersByTime(400); });
};

it('shows the linked note and nothing else once one is picked', async () => {
  const onClear = jest.fn();
  const view = await draw({ value: { id: 'p1', title: 'Milk run' }, onClear });
  expect(view.getByText('Linked to note: Milk run')).toBeTruthy();
  expect(view.queryByLabelText('Link a note')).toBeNull();

  await fireEvent.press(view.getByLabelText('Unlink note'));
  expect(onClear).toHaveBeenCalled();
});

it('fetches the browse pool only when the picker is opened', async () => {
  const view = await draw();
  expect(mockApi.get).not.toHaveBeenCalled();

  await openPicker(view);
  await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/turtle/notes?limit=200'));
  // The most recent notes, before anything is typed.
  await waitFor(() => expect(view.getByText('Milk run')).toBeTruthy());
});

it('ranks the best match first, not the most recent one', async () => {
  // The old picker sliced the most recent matches, so the note whose TITLE was
  // the query routinely lost to one that merely mentioned it.
  routeApi({
    page: [
      note({ id: 'a', content: 'Errands', description: 'buy milk', createdAt: 99 }),
      note({ id: 'b', content: 'Milk run', createdAt: 1 }),
    ],
  });
  const view = await draw();
  await openPicker(view);
  await type(view, 'milk');
  await flushSearch();

  // The trigger button stays mounted UNDER the pushed panel, so exclude it.
  const titles = view.getAllByLabelText(/^Link /)
    .map((n) => n.props.accessibilityLabel)
    .filter((l) => l !== 'Link a note');
  expect(titles).toEqual(['Link Milk run', 'Link Errands']);
});

it('merges server FTS hits the loaded page never held', async () => {
  routeApi({ search: [note({ id: 's1', content: 'Milk from the farm shop' })] });
  const view = await draw();
  await openPicker(view);
  await type(view, 'milk');
  await flushSearch();

  await waitFor(() => expect(view.getByText('Milk from the farm shop')).toBeTruthy());
  expect(mockApi.get).toHaveBeenCalledWith('/turtle/notes/search?q=milk');
  // Also present from the page — one list, ranked together, deduped.
  expect(view.getByText('Milk run')).toBeTruthy();
});

it('debounces the server call instead of firing one per letter', async () => {
  const view = await draw();
  await openPicker(view);
  await type(view, 'm');
  await type(view, 'mi');
  await type(view, 'mil');
  await flushSearch();

  const searches = mockApi.get.mock.calls.filter(([p]) => p.includes('/notes/search'));
  expect(searches).toHaveLength(1);
  expect(searches[0][0]).toBe('/turtle/notes/search?q=mil');
});

it('falls back to fuzzy matching only when the first two tiers miss', async () => {
  routeApi({ search: [], index: [{ id: 'p2', text: 'call the plumber' }] });
  const view = await draw();
  await openPicker(view);
  await type(view, 'plumbre'); // transposed — no substring, no FTS hit
  await flushSearch();

  await waitFor(() => expect(view.getByText('No exact match — showing the closest notes.')).toBeTruthy());
  expect(view.getByText('Call the plumber')).toBeTruthy();
  expect(mockApi.get).toHaveBeenCalledWith('/turtle/notes/index');
});

it('does not dress a fuzzy guess up as a real hit', async () => {
  // A match that IS exact must not carry the "closest" caveat.
  const view = await draw();
  await openPicker(view);
  await type(view, 'milk');
  await flushSearch();
  expect(view.queryByText('No exact match — showing the closest notes.')).toBeNull();
});

it('narrows by kind', async () => {
  const view = await draw();
  await openPicker(view);
  await waitFor(() => expect(view.getByText('Buy a gift')).toBeTruthy());

  await act(async () => { fireEvent.press(view.getByLabelText('Show Todos')); });
  expect(view.getByText('Buy a gift')).toBeTruthy();
  expect(view.queryByText('Milk run')).toBeNull();
});

it('skips the doomed request while offline and still answers from the page', async () => {
  mockConnected = false;
  const view = await draw();
  await openPicker(view);
  await type(view, 'milk');
  await flushSearch();

  expect(mockApi.get.mock.calls.some(([p]) => p.includes('/notes/search'))).toBe(false);
  // Tier 1 is the tier that works offline, and it still does.
  expect(view.getByText('Milk run')).toBeTruthy();
});

it('says what it looked for when nothing matches', async () => {
  routeApi({ search: [], index: [] });
  const view = await draw();
  await openPicker(view);
  await type(view, 'zebra');
  await flushSearch();
  await waitFor(() => expect(view.getByText('Nothing matches “zebra”.')).toBeTruthy());
});

it('hands back the id and title, then collapses', async () => {
  const onPick = jest.fn();
  const view = await draw({ onPick });
  await openPicker(view);
  await waitFor(() => expect(view.getByLabelText('Link Milk run')).toBeTruthy());

  await act(async () => { fireEvent.press(view.getByLabelText('Link Milk run')); });
  expect(onPick).toHaveBeenCalledWith({ id: 'p1', title: 'Milk run' });
  // The page is gone, and the field now carries the note instead of the
  // "Link a note" button.
  expect(view.queryByPlaceholderText('Search notes, todos, tags…')).toBeNull();
  expect(view.getByText('Linked to note: Milk run')).toBeTruthy();
});

it('closes without picking, and re-opening is free', async () => {
  const view = await draw();
  await openPicker(view);
  await waitFor(() => expect(view.getByText('Milk run')).toBeTruthy());
  const before = mockApi.get.mock.calls.length;

  await act(async () => { fireEvent.press(view.getByLabelText('Back')); });
  expect(view.queryByPlaceholderText('Search notes, todos, tags…')).toBeNull();
  expect(view.getByLabelText('Link a note')).toBeTruthy();

  // The browse page is fetched ONCE and kept — re-opening costs nothing.
  await openPicker(view);
  expect(mockApi.get.mock.calls.length).toBe(before);
});

it('starts a fresh search each time it opens', async () => {
  // A query left over from the last time you went looking is not a filter you
  // meant to apply to this one.
  const view = await draw();
  await openPicker(view);
  await type(view, 'milk');
  await flushSearch();
  expect(view.queryByText('Call the plumber')).toBeNull();

  await act(async () => { fireEvent.press(view.getByLabelText('Back')); });
  await openPicker(view);
  expect(view.getByPlaceholderText('Search notes, todos, tags…').props.value).toBe('');
  expect(view.getByText('Call the plumber')).toBeTruthy();
});
