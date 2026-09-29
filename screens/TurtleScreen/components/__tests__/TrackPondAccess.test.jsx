/**
 * The "Share in your pond" page of a music track's ⋯ sheet.
 *
 * The same conversation a photo board's sharing card holds, rendered as a page
 * inside a bottom sheet instead of a section in a scrolling card. What is
 * tested here is the WIRING — that the page reaches the track endpoints with
 * the track's media id, and that a surface with no api client simply does not
 * offer the row.
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
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import TrackActionsSheet from '../TrackActionsSheet';

const colors = {
  background: '#000', surface: '#111', surfaceElevated: '#181818', surfaceHighlight: '#222',
  border: '#333', borderStrong: '#444',
  textPrimary: '#fff', textSecondary: '#bbb', textTertiary: '#999', textMuted: '#777',
  accent: '#0a84ff', accentInfo: '#0a84ff', accentError: '#F87171',
};

const TRACK = { id: 'm5', originalName: 'Roadtrip.mp3', type: 'audio' };
const BEA = { shareId: 's_bea', userId: 'u_bea', name: 'Bea', permission: 'view' };

const makeApi = (over = {}) => ({
  get: jest.fn(async (path) => {
    if (path.startsWith('/track-access?')) return { success: true, trackId: 'm5', people: [BEA] };
    if (path === '/friends') {
      return { success: true, friends: [{ id: 'u_bea', name: 'Bea' }, { id: 'u_cal', name: 'Cal' }] };
    }
    return {};
  }),
  post: jest.fn(async () => ({
    success: true,
    trackId: 'm5',
    people: [BEA, { shareId: 's_cal', userId: 'u_cal', name: 'Cal', permission: 'view' }],
    person: { shareId: 's_cal', userId: 'u_cal', name: 'Cal', permission: 'view' },
  })),
  delete: jest.fn(async () => ({ success: true, removed: true })),
  ...over,
});

const open = async (api, props = {}) => render(
  <TrackActionsSheet
    visible
    track={TRACK}
    title="Roadtrip"
    subtitle="Audio"
    colors={colors}
    api={api}
    baseUrl="https://pond"
    onClose={() => {}}
    {...props}
  />,
);

describe('a track’s pond access', () => {
  test('the row counts who has it, and opens the page', async () => {
    const api = makeApi();
    const view = await open(api);
    await waitFor(() => expect(view.getByTestId('track-pond-open')).toBeTruthy());
    // The count is the whole point of the row: whether this track has left the
    // library is otherwise invisible without opening anything.
    await waitFor(() => expect(view.getByText('In your pond · 1')).toBeTruthy());

    fireEvent.press(view.getByTestId('track-pond-open'));
    await waitFor(() => expect(view.getByText('Share in your pond')).toBeTruthy());
  });

  test('reads the roster by the track’s media id', async () => {
    const api = makeApi();
    await open(api);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/track-access?trackId=m5'));
  });

  test('a surface with no client does not offer the row at all', async () => {
    // The share target mounts this sheet without a pond client; an affordance
    // that could only fail is worse than no affordance.
    const view = await open(undefined, { api: undefined });
    expect(view.queryByTestId('track-pond-open')).toBeNull();
  });

  test('offers only people who do not already have the track', async () => {
    const api = makeApi();
    const view = await open(api);
    await waitFor(() => expect(view.getByTestId('track-pond-open')).toBeTruthy());
    fireEvent.press(view.getByTestId('track-pond-open'));

    await waitFor(() => expect(view.getByTestId('track-pond-add-u_cal')).toBeTruthy());
    expect(view.queryByTestId('track-pond-add-u_bea')).toBeNull();
    // …and Bea is listed as already holding it, with a way to take it back.
    expect(view.getByTestId('track-pond-remove-u_bea')).toBeTruthy();
  });

  test('granting posts the track id and the member', async () => {
    const api = makeApi();
    const onPondChanged = jest.fn();
    const view = await open(api, { onPondChanged });
    await waitFor(() => expect(view.getByTestId('track-pond-open')).toBeTruthy());
    fireEvent.press(view.getByTestId('track-pond-open'));
    await waitFor(() => expect(view.getByTestId('track-pond-add-u_cal')).toBeTruthy());
    fireEvent.press(view.getByTestId('track-pond-add-u_cal'));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/track-access', {
      trackId: 'm5', withUserId: 'u_cal',
    }));
    // The list behind needs to re-read: the row's face count just changed.
    await waitFor(() => expect(onPondChanged).toHaveBeenCalled());
    await waitFor(() => expect(view.getByText('Cal')).toBeTruthy());
  });

  test('removing deletes by share id — no confirm, the page IS the confirm', async () => {
    const api = makeApi();
    const view = await open(api);
    await waitFor(() => expect(view.getByTestId('track-pond-open')).toBeTruthy());
    fireEvent.press(view.getByTestId('track-pond-open'));
    await waitFor(() => expect(view.getByTestId('track-pond-remove-u_bea')).toBeTruthy());
    fireEvent.press(view.getByTestId('track-pond-remove-u_bea'));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/track-access/s_bea'));
  });

  test('a server refusal is shown in the sheet rather than swallowed', async () => {
    const api = makeApi({ post: jest.fn(async () => ({ success: false, error: "That track isn't in your library." })) });
    const view = await open(api);
    await waitFor(() => expect(view.getByTestId('track-pond-open')).toBeTruthy());
    fireEvent.press(view.getByTestId('track-pond-open'));
    await waitFor(() => expect(view.getByTestId('track-pond-add-u_cal')).toBeTruthy());
    fireEvent.press(view.getByTestId('track-pond-add-u_cal'));

    await waitFor(() => expect(view.getByText("That track isn't in your library.")).toBeTruthy());
  });

  test('a track nobody has says so, and still offers the pond', async () => {
    const api = makeApi({
      get: jest.fn(async (path) => {
        if (path.startsWith('/track-access?')) return { success: true, people: [] };
        if (path === '/friends') return { success: true, friends: [{ id: 'u_cal', name: 'Cal' }] };
        return {};
      }),
    });
    const view = await open(api);
    await waitFor(() => expect(view.getByText('Share in your pond…')).toBeTruthy());
    fireEvent.press(view.getByTestId('track-pond-open'));
    await waitFor(() => expect(view.getByTestId('track-pond-add-u_cal')).toBeTruthy());
  });

  test('an empty pond says that, not "everyone has it"', async () => {
    const api = makeApi({
      get: jest.fn(async (path) => {
        if (path.startsWith('/track-access?')) return { success: true, people: [] };
        if (path === '/friends') return { success: true, friends: [] };
        return {};
      }),
    });
    const view = await open(api);
    await waitFor(() => expect(view.getByTestId('track-pond-open')).toBeTruthy());
    fireEvent.press(view.getByTestId('track-pond-open'));
    await waitFor(() => expect(view.getByText('Nobody else is in your pond yet.')).toBeTruthy());
  });
});
