import React from 'react';
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
    await fireEvent.press(view.getByLabelText('Add photos to a board'));

    expect(props.onQueryChange).toHaveBeenCalledWith('warm');
    expect(props.onAdd).toHaveBeenCalledTimes(1);
  });

  test('renders sort chips and changes the selected mode', async () => {
    const { props, view } = await renderPage();
    await fireEvent.press(view.getByText('A–Z'));
    await fireEvent.press(view.getByText('Largest'));

    expect(props.onSortModeChange).toHaveBeenNthCalledWith(1, 'alphabetical');
    expect(props.onSortModeChange).toHaveBeenNthCalledWith(2, 'largest');
    expect(view.getByLabelText('Sort boards by recent').props.accessibilityState).toEqual({ selected: true });
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
    await fireEvent.press(empty.view.getByText('Add photos'));
    expect(empty.props.onAdd).toHaveBeenCalledTimes(1);
  });

  test('shows retry on load failure and skeletons only for an empty initial load', async () => {
    const failed = await renderPage({ boards: [], error: 'Unable to load boards' });
    await fireEvent.press(failed.view.getByText('Retry'));
    expect(failed.props.onRetry).toHaveBeenCalledTimes(1);

    const loading = await renderPage({ boards: [], loading: true });
    expect(loading.view.getAllByTestId(/board-skeleton-/)).toHaveLength(4);
  });

  test('prioritizes a load error over initial-load skeletons', async () => {
    const failed = await renderPage({ boards: [], loading: true, error: 'Unable to load boards' });

    expect(failed.view.getByText('Unable to load boards')).toBeTruthy();
    expect(failed.view.queryAllByTestId(/board-skeleton-/)).toHaveLength(0);
    await fireEvent.press(failed.view.getByText('Retry'));
    expect(failed.props.onRetry).toHaveBeenCalledTimes(1);
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
