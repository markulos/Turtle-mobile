/**
 * "Which album?" — the sheet.
 *
 * Its whole job is to turn one question into one tap, so what is worth testing
 * is what it OFFERS: the albums you have, a way to make the one you do not,
 * and no way to file a photo somewhere it already is.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../../../utils/haptics', () => ({
  tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn(), markGesture: jest.fn(),
}));

import AlbumPickerSheet from '../AlbumPickerSheet';

const theme = {
  colors: {
    background: '#000', surface: '#0a0a0a', surfaceElevated: '#111', border: '#222',
    textPrimary: '#fff', textSecondary: '#aaa', textTertiary: '#888', textMuted: '#666',
    accentInfo: '#4aa', accentSuccess: '#4ADE80',
  },
};

const ALBUMS = [{ name: 'Wedding', count: 42 }, { name: 'Kitchen', count: 3 }];

const draw = (props = {}) => render(
  <AlbumPickerSheet
    visible
    albums={ALBUMS}
    count={1}
    inAlbums={[]}
    onPick={jest.fn()}
    onClose={jest.fn()}
    theme={theme}
    {...props}
  />,
);

const type = async (view, text) => {
  await act(async () => { fireEvent.changeText(view.getByTestId('album-picker-field'), text); });
};

it('draws nothing at all when it is not up', async () => {
  const view = await draw({ visible: false });
  expect(view.toJSON()).toBeNull();
});

it('lists the albums you have, with what is in them', async () => {
  const view = await draw();
  expect(view.getByText('Wedding')).toBeTruthy();
  expect(view.getByText('42 photos')).toBeTruthy();
  expect(view.getByText('3 photos')).toBeTruthy();
});

it('says how many photos are being filed', async () => {
  expect((await draw({ count: 1 })).getByText('Add this photo to…')).toBeTruthy();
  expect((await draw({ count: 6 })).getByText('Add 6 photos to…')).toBeTruthy();
});

it('files into the album you tap', async () => {
  const onPick = jest.fn();
  const view = await draw({ onPick });
  await act(async () => { fireEvent.press(view.getByTestId('album-pick-Wedding')); });
  expect(onPick).toHaveBeenCalledWith('Wedding');
});

it('filters as you type, anywhere in the name', async () => {
  const view = await draw();
  await type(view, 'kit');
  expect(view.getByText('Kitchen')).toBeTruthy();
  expect(view.queryByText('Wedding')).toBeNull();
});

it('offers to MAKE the album when the name is new', async () => {
  const onPick = jest.fn();
  const view = await draw({ onPick });
  await type(view, 'Garden');
  const row = view.getByTestId('album-picker-new');
  expect(row).toBeTruthy();
  // It says what will happen — the album is created by this filing, because
  // an album here exists only once a photo carries its name.
  expect(view.getByText(/Created with this photo in it/)).toBeTruthy();
  await act(async () => { fireEvent.press(row); });
  expect(onPick).toHaveBeenCalledWith('Garden');
});

it('does NOT offer to make one that already exists in another case', async () => {
  // The pond matches album names case-insensitively, so this would silently
  // merge into "Wedding" — offering it is a promise it would not keep.
  const view = await draw();
  await type(view, 'wedding');
  expect(view.queryByTestId('album-picker-new')).toBeNull();
  expect(view.getByText('Wedding')).toBeTruthy();
});

it('offers nothing to make from an empty field', async () => {
  const view = await draw();
  await type(view, '   ');
  expect(view.queryByTestId('album-picker-new')).toBeNull();
});

it('shows an album the photo is already in, and will not file it twice', async () => {
  const onPick = jest.fn();
  const view = await draw({ inAlbums: ['Wedding'], onPick });
  // Said, not hidden: an album missing from the list because the photo is
  // already filed there reads as a bug.
  expect(view.getByLabelText('Wedding, already in it')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByTestId('album-pick-Wedding')); });
  expect(onPick).not.toHaveBeenCalled();
});

it('says what to do when there are no albums yet', async () => {
  const view = await draw({ albums: [] });
  expect(view.getByText(/Type a name to make the first one/)).toBeTruthy();
});

/**
 * The selection bar has ONE filing key now — Tag and Album were two keys
 * writing the same row — so the rest of what tagging could do has to be
 * reachable from here, and only from here.
 */
describe('the way through to the tag editor', () => {
  it('offers it, and hands over when tapped', async () => {
    const onEditTags = jest.fn();
    const view = await draw({ onEditTags });
    await act(async () => { fireEvent.press(view.getByTestId('album-picker-tags')); });
    expect(onEditTags).toHaveBeenCalled();
  });

  it('shows no key at all to a caller with no tag editor to offer', async () => {
    const view = await draw();
    expect(view.queryByTestId('album-picker-tags')).toBeNull();
  });

  it('is labelled, not a bare icon — it leaves this sheet for another one', async () => {
    const view = await draw({ onEditTags: jest.fn() });
    expect(view.getByText('Tags')).toBeTruthy();
    expect(view.getByLabelText('Edit tags instead')).toBeTruthy();
  });
});
