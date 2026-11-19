/**
 * "Which album?" — the sheet.
 *
 * Its whole job is to turn one question into one tap, so what is worth testing
 * is what it OFFERS: the albums you have, a way to make the one you do not,
 * and no way to file a photo somewhere it already is.
 */
import fs from 'fs';
import React from 'react';
import { StyleSheet } from 'react-native';
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

/**
 * IT OPENED ON A PRESS, SO IT COVERS WHAT RAISED IT (STYLE-RULES §4).
 *
 * This sheet is the rule's cautionary tale: it was mounted one sibling above
 * the photos page, so the page you pressed "Album" on painted straight over it
 * — a sheet you ask for and cannot see.
 */
describe('where it sits, and what it clears', () => {
  const layerOf = (view) => StyleSheet.flatten(view.getByTestId('album-picker').props.style);

  it('is in the app\'s top band, so nothing on the screen outranks it', async () => {
    expect(layerOf(await draw()).zIndex).toBe(1000);
  });

  it('rises on the keyboard rather than letting it cover the field', async () => {
    // The house rule is a native-driver transform matched to the keyboard —
    // no KeyboardAvoidingView anywhere (STYLE-RULES §4).
    // Comments blanked: this file's own prose NAMES the thing it must not use,
    // and the prose must not be allowed to answer for the code.
    const SRC = fs.readFileSync('screens/TurtleScreen/components/AlbumPickerSheet.jsx', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
    // …read from the app's ONE keyboard source (utils/keyboardMotion).
    expect(SRC).toMatch(/useKeyboardFrame\(\)/);
    expect(SRC).not.toMatch(/useAnimatedKeyboard/);
    expect(SRC).not.toMatch(/KeyboardAvoidingView/);
    // The lift CANCELS the clearance the sheet already rests on; adding the
    // two leaves the card floating above the keyboard.
    expect(SRC).toMatch(/keyboard\.height\.value - pad/);
    // And it shrinks by the same number, or a card that lifts takes its own
    // top off the screen.
    expect(SRC).toMatch(/maxHeight: Math\.min\(winH \* 0\.72, winH - up/);
  });

  it('reserves what the caller says is under it, not just the home indicator', async () => {
    // The floating dock covers the bottom of the screen and reserves no layout
    // space of its own, so the sheet has to be told about it.
    const SRC = fs.readFileSync('screens/TurtleScreen/components/AlbumPickerSheet.jsx', 'utf8');
    expect(SRC).toMatch(/const pad = Math\.max\(insets\.bottom, bottomInset\)/);
    expect(SRC).toMatch(/paddingBottom: pad \+ 10/);
  });
});

/**
 * The mount SITE, which no render test can see: a parent's zIndex or
 * `overflow: hidden` outranks whatever the sheet itself carries, so the number
 * above is only true while this stays at the screen root.
 */
describe('the mount site in the gallery', () => {
  const SRC = fs.readFileSync('screens/TurtleScreen/components/MediaGallery.jsx', 'utf8');

  it('is mounted at the screen root, after the page it opens over', async () => {
    const mount = SRC.indexOf('<AlbumPickerSheet');
    const page = SRC.indexOf('<EdgeSwipePage overlay visible={photosOpen}');
    expect(mount).toBeGreaterThan(-1);
    expect(page).toBeGreaterThan(-1);
    // Later sibling paints on top. This is the whole bug, in one comparison.
    expect(mount).toBeGreaterThan(page);
  });

  it('is handed the dock to clear', async () => {
    expect(SRC).toMatch(/<AlbumPickerSheet[\s\S]*?bottomInset=\{Math\.max\(tabBarH, insets\.bottom\)\}/);
  });
});

/**
 * A BULK ACTION THAT FINISHES ENDS THE SELECTION.
 *
 * Filing a selection into a board left the picker closing onto the same bar
 * it was raised from, over a grid whose rows had just moved — a bar you have
 * to dismiss to find out whether anything happened. Tagging, deleting and
 * sending all put it away; this was the one that did not.
 */
describe('filing into a board ends the selection', () => {
  const CODE = fs.readFileSync('screens/TurtleScreen/components/MediaGallery.jsx', 'utf8')
    // Blanked, not deleted: the prose beside each branch explains the rule and
    // must not be allowed to answer for the code.
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
  const addToAlbum = CODE.slice(
    CODE.indexOf('const addToAlbum = useCallback'),
    CODE.indexOf('const openBulkTags = useCallback'),
  );

  it('puts the bar away once the write lands', () => {
    const ok = addToAlbum.slice(addToAlbum.indexOf('if (!r.queued) fetchAlbums();'), addToAlbum.indexOf('} catch'));
    expect(ok).toMatch(/if \(fromSelection\) leaveSelectMode\(\)/);
  });

  it('…and on the one where everything was already in that board', () => {
    // Nothing to write is still a finished errand: the photos ARE in that
    // album, which is what was asked for. Leaving the bar up reads as a tap
    // that missed.
    const noop = addToAlbum.slice(0, addToAlbum.indexOf('const ids = items.map'));
    expect(noop).toMatch(/if \(fromSelection\) leaveSelectMode\(\)/);
  });

  it('but NOT when the write failed', () => {
    // Then the selection is the only thing between you and picking all of
    // them again.
    const failed = addToAlbum.slice(addToAlbum.indexOf('} catch'), addToAlbum.indexOf('} finally'));
    expect(failed).not.toMatch(/leaveSelectMode/);
  });

  it('only the GRID\'s selection has a bar to put away', () => {
    // Filing one photo from the viewer never raised one.
    expect(addToAlbum).toMatch(/const fromSelection = albumPickerIsSelectionRef\.current/);
  });

  it('there is ONE way to end a selection, not five hand-rolled copies', () => {
    // Selecting is five pieces of state and five places end it. The copies had
    // already drifted — only one of them cleared the range anchor, so leaving
    // select mode mid-range and coming back could fill from a stale one.
    expect(CODE).toMatch(/const leaveSelectMode = useCallback/);
    expect(CODE.match(/setSelectedGridItems\(new Set\(\)\)/g) || []).toHaveLength(1);
    const helper = CODE.slice(CODE.indexOf('const leaveSelectMode = useCallback'), CODE.indexOf('}, []);', CODE.indexOf('const leaveSelectMode')));
    for (const bit of ['setIsSelectMode(false)', 'setRangeSelectMode(false)', 'setRangeAnchorIdx(null)', 'rangeAnchorRef.current = null']) {
      expect(helper).toContain(bit);
    }
  });
});
