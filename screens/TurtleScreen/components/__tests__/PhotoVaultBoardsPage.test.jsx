import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
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
    await fireEvent.changeText(view.getByPlaceholderText('Search your boards'), 'warm');
    const addButton = view.getByLabelText('Add photos to a board');
    await fireEvent.press(addButton);

    expect(props.onQueryChange).toHaveBeenCalledWith('warm');
    expect(props.onAdd).toHaveBeenCalledTimes(1);
    expect(addButton.props.accessibilityRole).toBe('button');
    expect(StyleSheet.flatten(addButton.props.style)).toEqual(expect.objectContaining({
      width: 50,
      height: 50,
    }));
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

  test('uses a high-contrast checked selected chip and 44-point labeled sort targets', async () => {
    const { view } = await renderPage();
    const selected = view.getByLabelText('Sort boards by recent');
    const alphabetical = view.getByLabelText('Sort boards by alphabetical');
    const largest = view.getByLabelText('Sort boards by largest');

    expect(view.getByLabelText('Sort boards by recent').props.accessibilityState).toEqual({ selected: true });
    expect(selected.props.accessibilityRole).toBe('button');
    expect(StyleSheet.flatten(selected.props.style)).toEqual(expect.objectContaining({
      minHeight: 44,
      backgroundColor: theme.colors.primary,
    }));
    expect(StyleSheet.flatten(view.getByText('Recent').props.style).color).toBe(theme.colors.onPrimary);
    expect(view.getByTestId('sort-selected-recent')).toBeTruthy();

    for (const chip of [alphabetical, largest]) {
      expect(chip.props.accessibilityRole).toBe('button');
      expect(StyleSheet.flatten(chip.props.style).minHeight).toBeGreaterThanOrEqual(44);
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
