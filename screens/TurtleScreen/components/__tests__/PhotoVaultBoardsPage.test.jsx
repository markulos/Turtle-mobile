import React from 'react';
import { Keyboard, StyleSheet } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import PhotoVaultBoardsPage from '../PhotoVaultBoardsPage';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));

const theme = {
  mode: 'dark',
  colors: {
    background: '#000',
    surface: '#0a0a0a',
    surfaceElevated: '#111',
    surfaceHighlight: '#1a1a1a',
    border: '#222',
    primary: '#fff',
    onPrimary: '#000',
    textPrimary: '#fff',
    textSecondary: '#aaa',
    textMuted: '#666',
  },
};

const boards = [{
  name: 'Warm interiors',
  covers: [],
  count: 47,
  latestDate: 1,
  metadata: '47 items · 2d',
}];

const renderPage = async (overrides = {}) => {
  const props = {
    boards,
    loading: false,
    error: null,
    hasLoadedAlbums: true,
    query: '',
    sortMode: 'recent',
    theme,
    topInset: 90,
    resolveCoverUrl: (path) => path,
    onQueryChange: jest.fn(),
    onSortModeChange: jest.fn(),
    onAdd: jest.fn(),
    onRetry: jest.fn(),
    onOpenBoard: jest.fn(),
    onLongPressBoard: jest.fn(),
    onCardPressIn: jest.fn(),
    onScroll: jest.fn(),
    onContentSizeChange: jest.fn(),
    onLayout: jest.fn(),
    ...overrides,
  };
  return { props, view: await render(<PhotoVaultBoardsPage {...props} />) };
};

describe('PhotoVaultBoardsPage', () => {
  test('keeps search and add directly visible and delegates input', async () => {
    const { props, view } = await renderPage();
    await fireEvent.changeText(view.getByLabelText('Search your boards'), 'warm');
    const addButton = view.getByLabelText('Add photos to a board');
    await fireEvent.press(addButton);

    expect(props.onQueryChange).toHaveBeenCalledWith('warm');
    expect(props.onAdd).toHaveBeenCalledTimes(1);
    expect(addButton.props.accessibilityRole).toBe('button');
    // A bare glyph in the reference, not a filled circle — so the visible box
    // is under 44pt and the accessible target comes from hitSlop instead.
    const addBox = StyleSheet.flatten(addButton.props.style);
    expect(addBox.backgroundColor).toBeUndefined();
    expect(addBox.width).toBe(44);
    expect(addButton.props.hitSlop).toEqual({ top: 8, bottom: 8, left: 8, right: 8 });
  });

  test('keeps the search field mounted across query renders so the keyboard stays up', async () => {
    // VirtualizedList renders a FUNCTION-valued ListHeaderComponent as
    // `<ListHeaderComponent />`. A header function defined in the render body has
    // a new identity every render, so React sees a NEW element type, unmounts the
    // old header, and mounts a fresh one — killing the focused TextInput and
    // closing the keyboard on every keystroke. An element keeps the type stable.
    const ref = React.createRef();
    await renderPage({ ref });
    const list = ref.current;

    expect(typeof list.props.ListHeaderComponent).not.toBe('function');
    expect(React.isValidElement(list.props.ListHeaderComponent)).toBe(true);
    expect(typeof list.props.ListEmptyComponent).not.toBe('function');
  });

  test('uses standard incremental-search input and keyboard behaviour', async () => {
    const ref = React.createRef();
    const { view } = await renderPage({ ref });
    const input = view.getByLabelText('Search your boards');
    const list = ref.current;

    expect(input.props.autoCorrect).toBe(false);
    expect(input.props.autoCapitalize).toBe('none');
    expect(input.props.spellCheck).toBe(false);
    expect(input.props.returnKeyType).toBe('search');
    expect(input.props.blurOnSubmit).toBe(false);
    // Tap a board while typing: one tap opens it, keyboard closes on drag.
    expect(list.props.keyboardShouldPersistTaps).toBe('handled');
    expect(list.props.keyboardDismissMode).toBe('on-drag');
  });

  test('shows an accessible 44-point search-clear button for a non-empty query', async () => {
    const { props, view } = await renderPage({ query: 'warm' });
    const clearButton = view.getByLabelText('Clear board search');

    expect(clearButton.props.accessibilityRole).toBe('button');
    expect(StyleSheet.flatten(clearButton.props.style)).toEqual(expect.objectContaining({
      width: 44,
      height: 44,
    }));

    await fireEvent.press(clearButton);
    expect(props.onQueryChange).toHaveBeenCalledWith('');
  });

  test('pins All Photos above the grid while not searching', async () => {
    const onOpenAllPhotos = jest.fn();
    const allPhotos = { name: 'All Photos', covers: [], count: 12480, metadata: '12480 items' };
    const { view } = await renderPage({ allPhotos, onOpenAllPhotos });

    const card = view.getByLabelText(/^All Photos, 12480 items/);
    expect(card).toBeTruthy();

    await fireEvent.press(card);
    expect(onOpenAllPhotos).toHaveBeenCalledWith('All Photos');
  });

  test('takes All Photos away while searching — it is not a result', async () => {
    const allPhotos = { name: 'All Photos', covers: [], count: 12480, metadata: '12480 items' };
    // Pinned during a search it sat above the matches pretending to be one,
    // and matched every query precisely because it was never filtered.
    const { view } = await renderPage({ allPhotos, boards: [], query: 'zzz' });

    expect(view.queryByLabelText(/^All Photos/)).toBeNull();
    expect(view.getByText('No boards match “zzz”.')).toBeTruthy();
  });

  test('omits the All Photos card when the caller supplies none', async () => {
    const { view } = await renderPage();
    expect(view.queryByLabelText(/^All Photos/)).toBeNull();
  });

  test('the placeholder is our own Text, and it leaves as soon as there is a query', async () => {
    // iOS draws the `placeholder` prop OUTSIDE the app's text pipeline, so
    // under Figtree it came out wide-tracked and off-size. components/
    // AppTextInput keeps that prop — VoiceOver and getByPlaceholderText both
    // hang off it — but makes it TRANSPARENT and draws a real <Text> instead.
    const empty = await renderPage();
    const input = empty.view.getByLabelText('Search your boards');
    expect(input.props.placeholder).toBe('Search your boards');
    expect(input.props.placeholderTextColor).toBe('transparent');

    const placeholder = empty.view.getByTestId('board-search-placeholder');
    expect(placeholder.props.children).toBe('Search your boards');
    // Invisible to touch and to a screen reader — the field already carries
    // the label, and a second copy would be read twice.
    expect(placeholder.props.pointerEvents).toBe('none');
    expect(placeholder.props.accessible).toBe(false);
    // Same size as the text it stands in for, and no tracking of its own.
    const style = StyleSheet.flatten(placeholder.props.style);
    expect(style.fontSize).toBe(15);
    expect(style.letterSpacing).toBeUndefined();

    const typed = await renderPage({ query: 'warm' });
    expect(typed.view.queryByTestId('board-search-placeholder')).toBeNull();
  });

  test('renders sort chips in a horizontal non-wrapping scroller', async () => {
    const { props, view } = await renderPage();
    const sortScroll = view.getByTestId('board-sort-scroll');
    await fireEvent.press(view.getByText('A–Z'));
    await fireEvent.press(view.getByText('Largest'));

    expect(sortScroll.props.horizontal).toBe(true);
    expect(sortScroll.props.showsHorizontalScrollIndicator).toBe(false);
    expect(StyleSheet.flatten(sortScroll.props.contentContainerStyle).flexWrap).not.toBe('wrap');
    expect(props.onSortModeChange).toHaveBeenNthCalledWith(1, 'alphabetical');
    expect(props.onSortModeChange).toHaveBeenNthCalledWith(2, 'largest');
  });

  test('uses a high-contrast checked selected chip and 44-point sort targets via hitSlop', async () => {
    const { view } = await renderPage();
    const selected = view.getByLabelText('Sort boards by recent');
    const alphabetical = view.getByLabelText('Sort boards by alphabetical');
    const largest = view.getByLabelText('Sort boards by largest');

    expect(view.getByLabelText('Sort boards by recent').props.accessibilityState).toEqual({ selected: true });
    expect(selected.props.accessibilityRole).toBe('button');
    // 34pt visible pill (reference proportions) + 8pt hitSlop per side = a 50pt
    // target, so matching the design never shrank the tap area.
    expect(StyleSheet.flatten(selected.props.style)).toEqual(expect.objectContaining({
      height: 34,
      backgroundColor: theme.colors.primary,
    }));
    expect(selected.props.hitSlop).toEqual({ top: 8, bottom: 8, left: 8, right: 8 });
    expect(StyleSheet.flatten(view.getByText('Recent').props.style).color).toBe(theme.colors.onPrimary);
    expect(view.getByTestId('sort-selected-recent')).toBeTruthy();

    for (const chip of [alphabetical, largest]) {
      expect(chip.props.accessibilityRole).toBe('button');
      const box = StyleSheet.flatten(chip.props.style);
      expect(box.height + chip.props.hitSlop.top + chip.props.hitSlop.bottom).toBeGreaterThanOrEqual(44);
      expect(box.borderWidth).toBeUndefined();   // borderless: the fill carries the chip
    }
  });

  test('opens a rendered board', async () => {
    const { props, view } = await renderPage();
    await fireEvent.press(view.getByLabelText('Warm interiors, 47 items, updated 2d'));
    expect(props.onOpenBoard).toHaveBeenCalledWith('Warm interiors');
  });

  test('shows a searchable empty state and a library-empty add action', async () => {
    const searched = await renderPage({ boards: [], query: 'missing' });
    expect(searched.view.getByText('No boards match “missing”.')).toBeTruthy();

    const empty = await renderPage({ boards: [], query: '' });
    expect(empty.view.getByText('Create your first board by adding photos.')).toBeTruthy();
    const addAction = empty.view.getByLabelText('Add photos to create a board');
    expect(addAction.props.accessibilityRole).toBe('button');
    expect(StyleSheet.flatten(addAction.props.style).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(addAction);
    expect(empty.props.onAdd).toHaveBeenCalledTimes(1);
  });

  test('shows an accessible 44-point retry action on initial load failure', async () => {
    const failed = await renderPage({
      boards: [],
      error: 'Unable to load boards',
      hasLoadedAlbums: false,
    });
    const retry = failed.view.getByLabelText('Retry loading boards');
    await fireEvent.press(retry);

    expect(failed.props.onRetry).toHaveBeenCalledTimes(1);
    expect(retry.props.accessibilityRole).toBe('button');
    expect(StyleSheet.flatten(retry.props.style).minHeight).toBeGreaterThanOrEqual(44);
  });

  test('shows initial skeletons despite the seeded Phone Uploads board', async () => {
    const loading = await renderPage({
      boards: [{ ...boards[0], name: 'Phone Uploads' }],
      loading: true,
      hasLoadedAlbums: false,
    });

    expect(loading.view.getAllByTestId(/board-skeleton-/)).toHaveLength(4);
    expect(loading.view.queryByLabelText('Phone Uploads, 47 items, updated 2d')).toBeNull();
  });

  test('shows a blocking initial error despite the seeded Phone Uploads board', async () => {
    const unsafeError = 'upstream token=secret failed at https://internal.example';
    const failed = await renderPage({
      boards: [{ ...boards[0], name: 'Phone Uploads' }],
      loading: false,
      error: unsafeError,
      hasLoadedAlbums: false,
    });

    expect(failed.view.getByText('Unable to load boards')).toBeTruthy();
    expect(failed.view.queryByText('Couldn’t refresh boards.')).toBeNull();
    expect(failed.view.queryByText(unsafeError)).toBeNull();
    expect(failed.view.queryByLabelText('Phone Uploads, 47 items, updated 2d')).toBeNull();
  });

  test('keeps retained boards visible behind a safe retry banner after a refresh failure', async () => {
    const unsafeError = 'upstream token=secret failed at https://internal.example';
    const { props, view } = await renderPage({ error: unsafeError, hasLoadedAlbums: true });

    expect(view.getByText('Couldn’t refresh boards.')).toBeTruthy();
    expect(view.queryByText(unsafeError)).toBeNull();
    expect(view.getByLabelText('Warm interiors, 47 items, updated 2d')).toBeTruthy();

    const retry = view.getByLabelText('Retry loading boards');
    expect(StyleSheet.flatten(retry.props.style).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(retry);
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  test('prioritizes a load error over initial-load skeletons', async () => {
    const failed = await renderPage({
      boards: [],
      loading: true,
      error: 'Unable to load boards',
      hasLoadedAlbums: false,
    });

    expect(failed.view.getByText('Unable to load boards')).toBeTruthy();
    expect(failed.view.queryAllByTestId(/board-skeleton-/)).toHaveLength(0);
    await fireEvent.press(failed.view.getByText('Retry'));
    expect(failed.props.onRetry).toHaveBeenCalledTimes(1);
  });

  test('keeps refresh-error banner semantics after search filters retained data to zero', async () => {
    const unsafeError = 'upstream token=secret failed at https://internal.example';
    const failedRefresh = await renderPage({
      boards: [],
      query: 'missing',
      error: unsafeError,
      hasLoadedAlbums: true,
    });

    expect(failedRefresh.view.getByText('Couldn’t refresh boards.')).toBeTruthy();
    expect(failedRefresh.view.getByText('No boards match “missing”.')).toBeTruthy();
    expect(failedRefresh.view.queryByText('Unable to load boards')).toBeNull();
    expect(failedRefresh.view.queryByText(unsafeError)).toBeNull();
  });

  // ── Search mode: the field takes the screen, results come back as rows ────
  // The grid spends a whole screen on four collages. Searching, you are after
  // ONE board by name — so the page turns into a name column (Instagram's user
  // search), the chrome above the field steps aside, and the matches start
  // directly under it.
  test('searching swaps the two-up grid for single-column rows', async () => {
    const ref = React.createRef();
    const { view } = await renderPage({ ref, query: 'warm' });

    expect(ref.current.props.numColumns).toBe(1);
    // Rows, not cards: the card builds a three-pane collage, the row does not.
    expect(view.queryByTestId('board-collage')).toBeNull();
    expect(view.getByLabelText('Warm interiors, 47 items')).toBeTruthy();
  });

  test('a search takes the sort chips away and keeps the field', async () => {
    const browsing = await renderPage();
    expect(browsing.view.getByTestId('board-sort-scroll')).toBeTruthy();

    const searching = await renderPage({ query: 'warm' });
    // Nothing between the field and the first match.
    expect(searching.view.queryByTestId('board-sort-scroll')).toBeNull();
    expect(searching.view.getByLabelText('Search your boards')).toBeTruthy();
  });

  test('reports search mode so the vault header can stand down', async () => {
    const onSearchActiveChange = jest.fn();
    const { view } = await renderPage({ query: 'warm', onSearchActiveChange });

    expect(onSearchActiveChange).toHaveBeenCalledWith(true);
    expect(view.getByTestId('board-search-cancel')).toBeTruthy();
  });

  // Cancel is one movement, and the trick to it is that WHAT IS ON SCREEN and
  // WHAT THE PARENT HOLDS part company for its duration.
  //
  // Clearing the query is the expensive half — the parent rebuilds every board
  // model from the filtered set back to the full one, rebuilds the A–Z index
  // off that, and mounts the rail. It goes on the FIRST frame, so that work
  // happens while the native glide runs (the UI thread does not care that JS is
  // busy) instead of landing in one long frame at the end, which is what made
  // the close stutter. The page is held still meanwhile by a frozen copy.
  test('Cancel clears the query at once but holds the screen until the page lands', async () => {
    const onSearchActiveChange = jest.fn();
    const onQueryChange = jest.fn();
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    dismiss.mockClear();
    const { props, view } = await renderPage({ query: 'warm', onSearchActiveChange, onQueryChange });

    await fireEvent.press(view.getByTestId('board-search-cancel'));

    // Keyboard, header and query all go on frame one, together.
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(onSearchActiveChange).toHaveBeenLastCalledWith(false);
    expect(onQueryChange).toHaveBeenCalledWith('');

    // The parent obeys immediately — and NOTHING the user can see may move.
    // Still in search posture: the sort chips have not come back, and the
    // field still reads what they typed rather than blanking under them.
    view.rerender(<PhotoVaultBoardsPage {...props} query="" />);
    expect(view.queryByTestId('board-sort-scroll')).toBeNull();
    expect(view.getByLabelText('Search your boards').props.value).toBe('warm');
    expect(view.queryByTestId('board-search-placeholder')).toBeNull();

    // Only once the glide has landed does the grid come back.
    await waitFor(() => expect(view.queryByTestId('board-sort-scroll')).toBeTruthy());
    expect(view.getByLabelText('Search your boards').props.value).toBe('');
    dismiss.mockRestore();
  });

  // NOT COVERED HERE: re-focusing the field mid-glide, which must take the exit
  // back (cancelRunRef makes the pending landing a no-op, and onFocus drops the
  // frozen copy). A test for it re-focuses while the exit timing is still in
  // flight, and an animation crossing a test boundary in this harness leaves
  // every LATER test in the file rendering nothing — draining it inside act()
  // did not help. The behaviour is real; the harness is what is missing.

  // Both keys are MOUNTED at all times now, and which one is live is decided by
  // pointerEvents rather than by rendering one of them. That is deliberate: the
  // field is flex:1, so unmounting the trailing key would let it grow into the
  // freed space and relayout the row mid-animation, which is exactly what the
  // slide is there to avoid. So the invariant to hold is not "only one exists"
  // — it is "only one can be pressed".
  test('only one of add / back is reachable at a time', async () => {
    const browsing = await renderPage();
    await fireEvent.press(browsing.view.getByLabelText('Add photos to a board'));
    expect(browsing.props.onAdd).toHaveBeenCalled();
    // The back key sits over the field's leading edge while browsing; if it
    // were live it would eat the tap that opens search.
    await fireEvent.press(browsing.view.getByTestId('board-search-cancel'));
    expect(browsing.props.onQueryChange).not.toHaveBeenCalled();

    const searching = await renderPage({ query: 'warm' });
    await fireEvent.press(searching.view.getByLabelText('Add photos to a board'));
    expect(searching.props.onAdd).not.toHaveBeenCalled();
    expect(searching.view.getByLabelText('Cancel board search')).toBeTruthy();
  });

  test('opens a board from a result row', async () => {
    const { props, view } = await renderPage({ query: 'warm' });
    await fireEvent.press(view.getByLabelText('Warm interiors, 47 items'));
    expect(props.onOpenBoard).toHaveBeenCalledWith('Warm interiors');
  });

  // `keyboardShouldPersistTaps="handled"` hands the tap to the row with the
  // keyboard still up, so opening a result has to drop it itself — otherwise
  // the board slides in under a keyboard nothing is typing into.
  test('drops the keyboard when a result is opened, without leaving search', async () => {
    // jest-expo's Keyboard.dismiss is already a mock, so spyOn hands back the
    // SAME function every test shares — clear it or you count the whole file.
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    dismiss.mockClear();
    const onSearchActiveChange = jest.fn();
    const { props, view } = await renderPage({ query: 'warm', onSearchActiveChange });

    await fireEvent.press(view.getByLabelText('Warm interiors, 47 items'));

    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(props.onOpenBoard).toHaveBeenCalledWith('Warm interiors');
    // Only the keyboard. Come back from the board and the query — and the
    // results you were picking from — are still there.
    expect(props.onQueryChange).not.toHaveBeenCalled();
    expect(onSearchActiveChange).not.toHaveBeenCalledWith(false);
    dismiss.mockRestore();
  });

  // The pinned All Photos card is only reachable while browsing, but it is the
  // same journey out of the page and must not leave a keyboard behind either.
  test('drops the keyboard when All Photos is opened', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    dismiss.mockClear();
    const onOpenAllPhotos = jest.fn();
    const allPhotos = { name: 'All Photos', covers: [], count: 12480, metadata: '12480 items' };
    const { view } = await renderPage({ allPhotos, onOpenAllPhotos });

    await fireEvent.press(view.getByLabelText(/^All Photos, 12480 items/));

    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(onOpenAllPhotos).toHaveBeenCalledWith('All Photos');
    dismiss.mockRestore();
  });

  // Sticky, not scrolling: the chips moved out of ListHeaderComponent and into
  // the fixed dock beside the field. In the list header they left the screen on
  // the first flick, so re-sorting a long library meant scrolling back to the
  // top first.
  test('keeps the sort chips OUT of the scrolling list header', async () => {
    const ref = React.createRef();
    const { view } = await renderPage({ ref });

    // Visible on the page…
    expect(view.getByTestId('board-sort-scroll')).toBeTruthy();

    // …but not inside the part of it that scrolls away.
    const header = await render(ref.current.props.ListHeaderComponent);
    expect(header.queryByTestId('board-sort-scroll')).toBeNull();
  });

  test('forwards the list ref and A–Z scrubber callbacks', async () => {
    const ref = React.createRef();
    const { props, view } = await renderPage({ ref });
    const list = ref.current;
    const scrollEvent = { nativeEvent: { contentOffset: { y: 240 } } };
    const layoutEvent = { nativeEvent: { layout: { height: 640, width: 320 } } };

    expect(ref.current).toBeTruthy();
    expect(list.props.onScroll).toBe(props.onScroll);
    expect(list.props.onContentSizeChange).toBe(props.onContentSizeChange);
    expect(list.props.onLayout).toBe(props.onLayout);
    await list.props.onScroll(scrollEvent);
    await list.props.onContentSizeChange(320, 1280);
    await list.props.onLayout(layoutEvent);

    expect(props.onScroll).toHaveBeenCalledWith(scrollEvent);
    expect(props.onContentSizeChange).toHaveBeenCalledWith(320, 1280);
    expect(props.onLayout).toHaveBeenCalledWith(layoutEvent);
  });
});
