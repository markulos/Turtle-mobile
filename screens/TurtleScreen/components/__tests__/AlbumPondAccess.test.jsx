/**
 * The IN YOUR POND section of a board's sharing card — giving a board to
 * someone who already has an account, rather than minting a link.
 *
 * The section is rendered through the whole sheet on purpose: its placement
 * ABOVE the public link is part of the design (the safe, common case first),
 * and a test that mounted the section alone could not notice it moving.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../../../utils/haptics', () => ({
  impactHaptic: jest.fn(), notifyHaptic: jest.fn(), tapHaptic: jest.fn(),
}));

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AlbumShareSheet from '../AlbumShareSheet';

const theme = {
  colors: {
    background: '#000', surface: '#111', surfaceElevated: '#181818', surfaceHighlight: '#222',
    border: '#333', borderStrong: '#444',
    textPrimary: '#fff', textSecondary: '#bbb', textTertiary: '#999', textMuted: '#777',
    accentInfo: '#0a84ff',
  },
};

const BEA = { shareId: 'share_bea', userId: 'u_bea', name: 'Bea', avatarUrl: null, permission: 'view' };

/** A fake pond: Bea already has the board, Cal doesn't. */
function makeApi(over = {}) {
  return {
    get: jest.fn(async (path) => {
      if (path.startsWith('/album-access?')) return { success: true, album: 'Trip', people: [BEA] };
      if (path === '/friends') {
        return {
          success: true,
          friends: [
            { id: 'u_bea', name: 'Bea', avatarUrl: null },
            { id: 'u_cal', name: 'Cal', avatarUrl: null },
          ],
        };
      }
      if (path.startsWith('/album-shares')) return { success: true, shares: [] };
      return {};
    }),
    post: jest.fn(async () => ({
      success: true,
      album: 'Trip',
      people: [BEA, { shareId: 'share_cal', userId: 'u_cal', name: 'Cal', permission: 'view' }],
      person: { shareId: 'share_cal', userId: 'u_cal', name: 'Cal', permission: 'view' },
    })),
    delete: jest.fn(async () => ({ success: true, removed: true })),
    patch: jest.fn(async () => ({ success: true })),
    ...over,
  };
}

const open = async (api, props = {}) => render(
  <AlbumShareSheet
    visible
    albumName="Trip"
    api={api}
    theme={theme}
    baseUrl="https://pond"
    onClose={() => {}}
    {...props}
  />,
);

describe('a board’s pond access', () => {
  test('lists who already has the board', async () => {
    const api = makeApi();
    const view = await open(api);
    await waitFor(() => expect(view.getByText('Bea')).toBeTruthy());
    expect(view.getByText('Can view')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/album-access?album=Trip');
  });

  test('says so plainly when the board is shared with nobody', async () => {
    const api = makeApi({
      get: jest.fn(async (path) => {
        if (path.startsWith('/album-access?')) return { success: true, people: [] };
        if (path === '/friends') return { success: true, friends: [] };
        return { success: true, shares: [] };
      }),
    });
    const view = await open(api);
    await waitFor(() => expect(view.getByText('Not shared with anyone yet.')).toBeTruthy());
  });

  test('the picker offers only people who do NOT already have it', async () => {
    const api = makeApi();
    const view = await open(api);
    await waitFor(() => expect(view.getByTestId('album-access-open-picker')).toBeTruthy());
    fireEvent.press(view.getByTestId('album-access-open-picker'));

    await waitFor(() => expect(view.getByTestId('album-access-add-u_cal')).toBeTruthy());
    // Bea holds it already — offering her again would mint a second grant for
    // one person, which the server folds anyway.
    expect(view.queryByTestId('album-access-add-u_bea')).toBeNull();
  });

  test('granting sends the member id and redraws from the server’s roster', async () => {
    const api = makeApi();
    const view = await open(api);
    await waitFor(() => expect(view.getByTestId('album-access-open-picker')).toBeTruthy());
    fireEvent.press(view.getByTestId('album-access-open-picker'));
    await waitFor(() => expect(view.getByTestId('album-access-add-u_cal')).toBeTruthy());
    fireEvent.press(view.getByTestId('album-access-add-u_cal'));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/album-access', {
      album: 'Trip', withUserId: 'u_cal',
    }));
    // The roster comes back from the POST, so the list cannot drift from what
    // the server actually stored.
    await waitFor(() => expect(view.getByText('Cal')).toBeTruthy());
  });

  test('a failed grant says so and leaves the roster alone', async () => {
    const api = makeApi({ post: jest.fn(async () => ({ success: false, error: "That member isn't in your pond." })) });
    const view = await open(api);
    await waitFor(() => expect(view.getByTestId('album-access-open-picker')).toBeTruthy());
    fireEvent.press(view.getByTestId('album-access-open-picker'));
    await waitFor(() => expect(view.getByTestId('album-access-add-u_cal')).toBeTruthy());
    fireEvent.press(view.getByTestId('album-access-add-u_cal'));

    await waitFor(() => expect(view.getByText("That member isn't in your pond.")).toBeTruthy());
    expect(view.getByText('Bea')).toBeTruthy();
  });

  test('removing someone confirms first, then deletes by SHARE id', async () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const api = makeApi();
    const view = await open(api);
    await waitFor(() => expect(view.getByTestId('album-access-remove-u_bea')).toBeTruthy());
    fireEvent.press(view.getByTestId('album-access-remove-u_bea'));

    expect(spy).toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();

    // Take the destructive button out of the alert and press it.
    const remove = spy.mock.calls[0][2].find((b) => b.style === 'destructive');
    await remove.onPress();
    // The share id, not the user id: that is the row that revokes.
    expect(api.delete).toHaveBeenCalledWith('/album-access/share_bea');
    spy.mockRestore();
  });

  test('losing the pond directory does not erase who already has the board', async () => {
    // The two reads are independent. An empty roster would read as "shared with
    // nobody", which is a different claim from "could not list your pond".
    const api = makeApi({
      get: jest.fn(async (path) => {
        if (path.startsWith('/album-access?')) return { success: true, people: [BEA] };
        if (path === '/friends') throw new Error('offline');
        return { success: true, shares: [] };
      }),
    });
    const view = await open(api);
    await waitFor(() => expect(view.getByText('Bea')).toBeTruthy());
  });

  test('the pond section comes before the public link', async () => {
    const api = makeApi();
    const view = await open(api);
    await waitFor(() => expect(view.getByText('IN YOUR POND')).toBeTruthy());
    const order = view.getAllByText(/IN YOUR POND|PUBLIC LINK/).map((n) => n.props.children);
    expect(order).toEqual(['IN YOUR POND', 'PUBLIC LINK']);
  });
});
