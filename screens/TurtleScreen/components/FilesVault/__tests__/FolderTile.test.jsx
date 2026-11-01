import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import FolderTile, { TILE_RADIUS } from '../FolderTile';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('../../../../../utils/haptics', () => ({ tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn() }));

const theme = { mode: 'dark', colors: { background: '#000', surface: '#0a0a0a', textPrimary: '#fff', textSecondary: '#aaa', textMuted: '#666', primary: '#fff', border: '#222' } };

// NOTE: @testing-library/react-native 14.0.1's render/rerender/fireEvent are all
// `async function`s in this repo's installed version (verified in
// node_modules/@testing-library/react-native/dist/render.js + fire-event.js), so
// every call is awaited here — same convention as PhotoVaultBoardCard.test.jsx.
describe('FolderTile', () => {
  it('shows the initial with a tint when there are no covers, and the count', async () => {
    const { getByText, queryAllByTestId } = await render(<FolderTile name="Taxes" covers={[]} count={12} base="http://pond" theme={theme} onPress={() => {}} testID="tile" />);
    expect(getByText('T')).toBeTruthy();
    expect(getByText('Taxes')).toBeTruthy();
    expect(getByText('12')).toBeTruthy();
    expect(queryAllByTestId('tile-cover').length).toBe(0);
  });
  it('collages up to four covers, absolute or pond-relative', async () => {
    const { queryAllByTestId } = await render(<FolderTile name="Taxes" covers={['/a.jpg', 'http://x/b.jpg', '/c.jpg', '/d.jpg', '/e.jpg']} count={4} base="http://pond" theme={theme} onPress={() => {}} testID="tile" />);
    const covers = queryAllByTestId('tile-cover');
    expect(covers.length).toBe(4);
    expect(covers[0].props.source.uri).toBe('http://pond/a.jpg');
    expect(covers[1].props.source.uri).toBe('http://x/b.jpg');
  });
  // A folder is a container of rectangular things: cropping four photographs
  // into quarters of a circle cost the corners of all four. The radius has to
  // stay SMALL — a tile whose corner grows with it is on its way back to a
  // disc — so it is asserted against the size rather than just being non-zero.
  it('is a rounded square, not a disc', async () => {
    const { getByTestId } = await render(<FolderTile name="Taxes" covers={[]} count={0} theme={theme} onPress={() => {}} testID="tile" />);
    const s = require('react-native').StyleSheet.flatten(getByTestId('tile-box').props.style);
    expect(s.borderRadius).toBe(TILE_RADIUS);
    expect(s.borderRadius).toBeLessThan(s.height / 3);
    // Without this the covers are a hard-edged square inside a rounded one.
    expect(s.overflow).toBe('hidden');
  });

  it('presses and long-presses, and is inert while pending', async () => {
    const onPress = jest.fn(); const onLongPress = jest.fn();
    const { getByLabelText, rerender } = await render(<FolderTile name="Taxes" covers={[]} count={0} theme={theme} onPress={onPress} onLongPress={onLongPress} />);
    await fireEvent.press(getByLabelText('Open folder Taxes'));
    await fireEvent(getByLabelText('Open folder Taxes'), 'longPress');
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    await rerender(<FolderTile name="Taxes" covers={[]} count={0} theme={theme} onPress={onPress} pending />);
    await fireEvent.press(getByLabelText('Open folder Taxes'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

/**
 * THE BADGE ANSWERS "WHO ELSE CAN SEE THIS" FOR THE WHOLE GRID.
 *
 * Before it, a folder you had given someone access to was indistinguishable
 * from one you had not — the only way to find out was to open each folder's
 * sheet in turn. The mark has to be absent by default, though: a badge on
 * every tile says nothing, and most folders are shared with nobody.
 */
describe('FolderTile share badge', () => {
  const tile = (props) => (
    <FolderTile name="Taxes" covers={[]} count={0} theme={theme} onPress={() => {}} testID="tile" {...props} />
  );

  it('draws nothing when the folder is shared with nobody', async () => {
    const { queryByTestId } = await render(tile({ sharedWith: 0 }));
    expect(queryByTestId('tile-shared')).toBeNull();
  });

  it('is absent when nothing was said about sharing at all', async () => {
    // The share map loads separately from the folders and may not have arrived
    // — an undefined prop must read as "not shared", never as a badge.
    const { queryByTestId } = await render(tile({}));
    expect(queryByTestId('tile-shared')).toBeNull();
  });

  // `includeHiddenElements` because the badge is deliberately hidden FROM the
  // accessibility tree — the fact it carries is already in the tile's one
  // label, and a reader should not stop on it twice. RNTL 14 skips
  // a11y-hidden nodes by default, so without this the query cannot see a badge
  // that is on screen. The label assertions below are what prove it is drawn
  // for a sighted user; these two prove the mark itself exists.
  const hidden = { includeHiddenElements: true };

  it('marks a folder that someone else can see', async () => {
    const { getByTestId } = await render(tile({ sharedWith: 1 }));
    expect(getByTestId('tile-shared', hidden)).toBeTruthy();
  });

  it('states the count once there is more than one person', async () => {
    const { getByText } = await render(tile({ sharedWith: 3 }));
    expect(getByText('3', hidden)).toBeTruthy();
  });

  it('shows no "1" — the icon alone already says one person', async () => {
    const { queryByText } = await render(tile({ sharedWith: 1 }));
    expect(queryByText('1', { includeHiddenElements: true })).toBeNull();
  });

  it('says who can see it in the label, not as a second stop for a reader', async () => {
    const { getByLabelText } = await render(tile({ sharedWith: 2 }));
    expect(getByLabelText('Open folder Taxes. Shared with 2 people.')).toBeTruthy();
  });

  it('says "person" for one, because "1 people" is how a label reads as a bug', async () => {
    const { getByLabelText } = await render(tile({ sharedWith: 1 }));
    expect(getByLabelText('Open folder Taxes. Shared with 1 person.')).toBeTruthy();
  });

  it('keeps the plain label when nothing is shared', async () => {
    const { getByLabelText } = await render(tile({ sharedWith: 0 }));
    expect(getByLabelText('Open folder Taxes')).toBeTruthy();
  });
});
