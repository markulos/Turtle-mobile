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
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import TrackActionsSheet from '../TrackActionsSheet';

const fs = require('fs');
const path = require('path');

/**
 * The ⋯ card, on top of everything, and able to take a track OFF a playlist.
 *
 * Mark, 2026-11-18: "give the option to remove items from playlist and let the
 * three dot overlay card always be above all on click even when you are
 * within an overlay inset like a playlist overlay".
 *
 * Both halves were the same shape of bug — something the card could not reach.
 *
 *  · REMOVE. A playlist the track was already on drew as a ticked, DISABLED
 *    row, so nothing anywhere in the app could unfile a track.
 *  · ON TOP. Every full-screen page in the vault is a real <Modal>
 *    (EdgeSwipePage), and no z-index reaches across one — so the card, a
 *    sibling of all of them, rendered UNDERNEATH whichever was open. The app
 *    had grown three workarounds: Playlists, Downloads and Voice recordings
 *    each CLOSED themselves to show the menu, throwing you back to the library
 *    to answer it.
 *
 * The removal is behaviour and is driven below. The stacking is structure — a
 * modal you cannot see into from jsdom — so it is read off the source, which
 * is also where it would silently regress: re-adding `setPlaylistsOpen(false)`
 * to an onOptions handler looks like tidying up.
 */

const colors = {
  background: '#000', surface: '#111', surfaceElevated: '#181818', surfaceHighlight: '#222',
  border: '#333', borderStrong: '#444',
  textPrimary: '#fff', textSecondary: '#bbb', textTertiary: '#999', textMuted: '#777',
  accent: '#0a84ff', accentInfo: '#0a84ff', accentError: '#F87171',
};
const TRACK = { id: 'm5', originalName: 'Atlantis.mp3', type: 'audio' };

const openSheet = async (props = {}) => {
  const view = await render(
    <TrackActionsSheet
      visible
      track={TRACK}
      title="Atlantis Is Calling"
      subtitle="Audio"
      playlists={['Chill', 'Focus']}
      colors={colors}
      onClose={() => {}}
      {...props}
    />,
  );
  await waitFor(() => expect(view.getByText('Add to playlist')).toBeTruthy());
  return view;
};

describe('Remove from the playlist you are standing in', () => {
  test('the row NAMES the playlist, rather than saying "this one"', async () => {
    // You arrive at this card from inside a playlist, and the one thing you
    // already know is which. A generic label would make you check.
    const view = await openSheet({
      inPlaylist: 'Chill', onRemoveFromPlaylist: jest.fn(),
    });
    expect(view.getByText('Remove from Chill')).toBeTruthy();
  });

  test('…and tapping it removes from THAT playlist', async () => {
    const onRemoveFromPlaylist = jest.fn();
    const view = await openSheet({ inPlaylist: 'Chill', onRemoveFromPlaylist });
    await act(async () => {
      fireEvent.press(view.getByTestId('track-remove-from-playlist'));
    });
    expect(onRemoveFromPlaylist).toHaveBeenCalledWith('Chill');
  });

  test('there is no such row when you are not in a playlist', async () => {
    // The library, Downloads, the shared strip: the picker is still two taps
    // away, and a "remove from" with nothing to name is a dead row.
    const view = await openSheet({ onRemoveFromPlaylist: jest.fn() });
    expect(view.queryByTestId('track-remove-from-playlist')).toBeNull();
  });

  test('…nor when there is no write behind it', async () => {
    const view = await openSheet({ inPlaylist: 'Chill' });
    expect(view.queryByTestId('track-remove-from-playlist')).toBeNull();
  });

  test('IT IS NOT DRAWN AS DESTRUCTIVE — the track stays in the vault', async () => {
    // Delete from vault is the red one. Unfiling a track removes a tag and
    // nothing else, and colour is the only thing that says which is which.
    const view = await openSheet({
      inPlaylist: 'Chill', onRemoveFromPlaylist: jest.fn(),
    });
    // The label node itself: this RNTL has no by-type walk off an element.
    const label = view.getByText('Remove from Chill');
    const colour = StyleSheet.flatten(label.props.style)?.color;
    expect(colour).toBe(colors.textPrimary);
    expect(colour).not.toBe(colors.accentError);
  });
});

describe('the card is drawn above everything it sits beside', () => {
  const SHEET = fs.readFileSync(path.join(__dirname, '..', 'TrackActionsSheet.jsx'), 'utf8');
  const VAULT = fs.readFileSync(path.join(__dirname, '..', 'MusicVault.jsx'), 'utf8');
  const PAGE = fs.readFileSync(path.join(__dirname, '..', 'EdgeSwipePage.jsx'), 'utf8');

  test('its layer CLEARS the nested in-tree page it has to cover', () => {
    // A playlist's own page is an EdgeSwipePage in `overlay` form — an in-tree
    // layer, not a modal — so the card has to out-rank it by number. Both
    // figures are read out of the source so this cannot assert yesterday's.
    const sheetZ = Number(/layer: \{ zIndex: (\d+)/.exec(SHEET)[1]);
    const pageZ = Number(/overlayLayer: \{ zIndex: (\d+)/.exec(PAGE)[1]);
    expect(sheetZ).toBeGreaterThan(pageZ);
    expect(SHEET).toMatch(/<View style=\{\[StyleSheet\.absoluteFill, styles\.layer\]\}/);
  });

  test('…and it is drawn INSIDE whichever page is open, because z-index stops at a Modal', () => {
    // The whole fix. One element, placed in exactly one of five hosts.
    expect(VAULT).toMatch(/const actionsSheet = \(/);
    expect(VAULT).toMatch(/const sheetLayer = playlistsOpen \? 'playlists'/);
    for (const layer of ['playlists', 'recordings', 'downloads', 'shared', 'root']) {
      expect(VAULT).toMatch(new RegExp(`\\{sheetLayer === '${layer}' && actionsSheet\\}`));
    }
    // Exactly once each — a second copy of the element is a second sheet.
    expect(VAULT.match(/&& actionsSheet\}/g)).toHaveLength(5);
  });

  test('NO LIST STANDS ITS PAGE DOWN TO SHOW THE MENU any more', () => {
    // The three workarounds, gone. Each of these inside an onOptions is the
    // old behaviour back: tap ⋯ inside Playlists, land in the library.
    const options = VAULT.match(/onOptions: \([^)]*\) => [^\n]*/g) || [];
    expect(options.length).toBeGreaterThanOrEqual(4);
    for (const line of options) {
      expect(line).not.toMatch(/setPlaylistsOpen\(false\)/);
      expect(line).not.toMatch(/setDownloadsOpen\(false\)/);
      expect(line).not.toMatch(/setRecordingsOpen\(false\)/);
      expect(line).not.toMatch(/setOpenPlaylist\(null\)/);
      expect(line).not.toMatch(/setOpenRecordingPlaylist\(null\)/);
    }
  });

  test('a page the ⋯ came from passes WHICH playlist it was', () => {
    // Which is now the only reason onOptions exists at all.
    expect(VAULT).toMatch(/onOptions: \(id\) => openSheet\(id, openPlaylist\)/);
    expect(VAULT).toMatch(/onOptions: \(id\) => openSheet\(id, openRecordingPlaylist\)/);
    // …and closing the card forgets it, or the next track opened from the
    // library would offer to remove it from a playlist you had left.
    expect(VAULT).toMatch(/setSheetId\(null\); setSheetFrom\(null\);/);
  });
});
