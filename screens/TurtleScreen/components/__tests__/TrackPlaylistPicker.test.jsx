/**
 * The "Add to playlist" page of a track's ⋯ sheet.
 *
 * The matching itself is tested in utils/__tests__/playlistSearch.test.js. What
 * is tested here is that the PAGE is wired to it: that typing narrows the list,
 * that a name you do not have turns into a create row, and that both of them
 * reach onAddToPlaylist with the right name — the one call that both adds and
 * creates (a playlist is a tag; see MusicVault's sheetAddToPlaylist).
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../../../utils/haptics', () => ({
  impactHaptic: jest.fn(), notifyHaptic: jest.fn(), tapHaptic: jest.fn(),
}));

import React from 'react';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import TrackActionsSheet from '../TrackActionsSheet';

const colors = {
  background: '#000', surface: '#111', surfaceElevated: '#181818', surfaceHighlight: '#222',
  border: '#333', borderStrong: '#444',
  textPrimary: '#fff', textSecondary: '#bbb', textTertiary: '#999', textMuted: '#777',
  accent: '#0a84ff', accentInfo: '#0a84ff', accentError: '#F87171',
};

const TRACK = { id: 'm5', originalName: 'Atlantis.mp3', type: 'audio' };
const LIBRARY = ['Audio', 'Classics', 'Coca Cola', 'Download', 'Fr Bishoy Kamel'];

// Open the sheet and walk to the playlist page, which is where every test
// below starts. The sheet opens on its actions page by design.
const openPicker = async (props = {}) => {
  // `render` is async in this harness (see the sibling sheet tests) — a
  // forgotten await leaves you holding a promise with no queries on it.
  const view = await render(
    <TrackActionsSheet
      visible
      track={TRACK}
      title="Atlantis Is Calling"
      subtitle="Audio"
      playlists={LIBRARY}
      colors={colors}
      onClose={() => {}}
      {...props}
    />,
  );
  await waitFor(() => expect(view.getByText('Add to playlist')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByText('Add to playlist')); });
  await waitFor(() => expect(view.getByTestId('playlist-search')).toBeTruthy());
  return view;
};

// Each of these gets its own act: the field is controlled, so what the next
// line asserts about depends on the re-render this one causes having landed.
const type = async (view, text) => {
  await act(async () => { fireEvent.changeText(view.getByTestId('playlist-search'), text); });
};
const submit = async (view) => {
  await act(async () => { fireEvent(view.getByTestId('playlist-search'), 'submitEditing'); });
};

describe('picking a playlist', () => {
  test('starts as the whole list, with nothing offered for creation', async () => {
    const view = await openPicker();
    for (const name of LIBRARY) expect(view.getByText(name)).toBeTruthy();
    expect(view.queryByTestId('playlist-create')).toBeNull();
  });

  test('typing narrows the list', async () => {
    const view = await openPicker();
    await type(view, 'cla');
    expect(view.getByText('Classics')).toBeTruthy();
    expect(view.queryByText('Coca Cola')).toBeNull();
    expect(view.queryByText('Download')).toBeNull();
  });

  test('the search is fuzzy — a typo and a run-together still find it', async () => {
    const view = await openPicker();
    await type(view, 'classsics');
    expect(view.getByText('Classics')).toBeTruthy();

    await type(view, 'cocacola');
    expect(view.getByText('Coca Cola')).toBeTruthy();
    expect(view.queryByText('Classics')).toBeNull();
  });

  test('a name you do not have becomes the create row', async () => {
    const onAddToPlaylist = jest.fn();
    const view = await openPicker({ onAddToPlaylist });
    await type(view, 'Road trip');

    const create = view.getByTestId('playlist-create');
    expect(create.props.accessibilityLabel).toContain('Road trip');
    for (const name of LIBRARY) expect(view.queryByText(name)).toBeNull();

    fireEvent.press(create);
    // The name goes up exactly as it was typed — the matching form is for
    // deciding, never for storing.
    expect(onAddToPlaylist).toHaveBeenCalledWith('Road trip');
  });

  test('a playlist you already have is never offered as a new one', async () => {
    const view = await openPicker();
    await type(view, 'Classics');
    expect(view.getByText('Classics')).toBeTruthy();
    expect(view.queryByTestId('playlist-create')).toBeNull();

    // However it was typed: same tag, same playlist.
    await type(view, 'coca-cola');
    expect(view.queryByTestId('playlist-create')).toBeNull();
  });

  test('create is offered ALONGSIDE a near match — "Classic" is not "Classics"', async () => {
    const view = await openPicker();
    await type(view, 'Classic');
    expect(view.getByText('Classics')).toBeTruthy();
    expect(view.getByTestId('playlist-create')).toBeTruthy();
  });

  test('tapping a match adds the track to it', async () => {
    const onAddToPlaylist = jest.fn();
    const view = await openPicker({ onAddToPlaylist });
    await type(view, 'down');
    fireEvent.press(view.getByText('Download'));
    expect(onAddToPlaylist).toHaveBeenCalledWith('Download');
  });

  test('a playlist the track is already in cannot be added twice', async () => {
    const onAddToPlaylist = jest.fn();
    const view = await openPicker({ onAddToPlaylist, currentPlaylists: ['Audio'] });
    fireEvent.press(view.getByText('Audio'));
    expect(onAddToPlaylist).not.toHaveBeenCalled();
  });

  test('the keyboard’s key takes the only match, or makes the missing one', async () => {
    const onAddToPlaylist = jest.fn();
    const view = await openPicker({ onAddToPlaylist });

    await type(view, 'down');
    await submit(view);
    expect(onAddToPlaylist).toHaveBeenLastCalledWith('Download');

    await type(view, 'Road trip');
    await submit(view);
    expect(onAddToPlaylist).toHaveBeenLastCalledWith('Road trip');

    // Two matches is not a guess: the rows are there to be tapped.
    onAddToPlaylist.mockClear();
    await type(view, 'c');
    await submit(view);
    expect(onAddToPlaylist).not.toHaveBeenCalled();
  });

  test('clearing the field gives the whole list back', async () => {
    const view = await openPicker();
    await type(view, 'Road trip');
    expect(view.queryByText('Classics')).toBeNull();

    await act(async () => { fireEvent.press(view.getByTestId('playlist-search-clear')); });
    for (const name of LIBRARY) expect(view.getByText(name)).toBeTruthy();
    expect(view.queryByTestId('playlist-create')).toBeNull();
  });

  test('an empty library says so, and the first name typed is the first playlist', async () => {
    const onAddToPlaylist = jest.fn();
    const view = await openPicker({ onAddToPlaylist, playlists: [] });
    expect(view.getByText(/No playlists yet/)).toBeTruthy();

    await type(view, 'Classics');
    expect(view.queryByText(/No playlists yet/)).toBeNull();
    fireEvent.press(view.getByTestId('playlist-create'));
    expect(onAddToPlaylist).toHaveBeenCalledWith('Classics');
  });
});
