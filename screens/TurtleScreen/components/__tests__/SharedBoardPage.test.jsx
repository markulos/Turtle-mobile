/**
 * SharedBoardPage — a board somebody else gave you, opened.
 *
 * The load-bearing claim: the page asks for a SHARE ID and nothing else. The
 * server pins the query to the owner recorded on that row, so a request that
 * also carried an album name or a user id would be offering the client a say in
 * whose media comes back. These tests pin the request shape as much as the UI.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../../../utils/haptics', () => ({
  impactHaptic: jest.fn(), notifyHaptic: jest.fn(), tapHaptic: jest.fn(),
}));
// The slide-in is not what these tests are about — render the contents.
jest.mock('../EdgeSwipePage', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ visible, children }) => (visible ? React.createElement(View, null, children) : null);
});

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import SharedBoardPage from '../SharedBoardPage';

const theme = {
  colors: {
    background: '#000', surfaceHighlight: '#222',
    textPrimary: '#fff', textSecondary: '#bbb', textTertiary: '#999', textMuted: '#777',
  },
};

const BOARD = {
  shareId: 'share_1',
  album: 'Trip',
  ownerUserId: 'u_bea',
  ownerName: 'Bea',
  permission: 'view',
  count: 2,
  covers: [],
};

const item = (id, over = {}) => ({
  id, type: 'image', originalName: `${id}.jpg`,
  thumbnailUrl: `/api/media/thumbnails/${id}.jpg`,
  rawUrl: `/api/media/raw/${id}.jpg`,
  ...over,
});

const draw = async (api, props = {}) => render(
  <SharedBoardPage
    visible
    board={BOARD}
    api={api}
    theme={theme}
    getFullUrl={(u) => `https://pond${u}`}
    onClose={() => {}}
    {...props}
  />,
);

const okApi = (items, over = {}) => ({
  get: jest.fn(async () => ({ success: true, album: 'Trip', items, total: items.length, hasMore: false })),
  delete: jest.fn(async () => ({ success: true, removed: true })),
  ...over,
});

describe('SharedBoardPage', () => {
  test('reads the board by SHARE ID alone', async () => {
    const api = okApi([item('m1')]);
    await draw(api);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const path = api.get.mock.calls[0][0];
    expect(path).toMatch(/^\/shared-albums\/share_1\/items\?/);
    // Nothing in the request names the album or its owner — the server decides
    // both from the row, and a client-supplied one could only widen it.
    expect(path).not.toMatch(/album=|user|owner/i);
  });

  test('names the board and who it came from', async () => {
    const api = okApi([item('m1'), item('m2')]);
    const view = await draw(api);
    await waitFor(() => expect(view.getByText('Trip')).toBeTruthy());
    expect(view.getByText('From Bea · 2 items')).toBeTruthy();
  });

  test('draws a cell per item, and opens one', async () => {
    const api = okApi([item('m1'), item('m2')]);
    const view = await draw(api);
    await waitFor(() => expect(view.getByTestId('shared-item-m1')).toBeTruthy());
    expect(view.getByTestId('shared-item-m2')).toBeTruthy();

    fireEvent.press(view.getByTestId('shared-item-m1'));
    await waitFor(() => expect(view.getByText('1 of 2')).toBeTruthy());
  });

  test('a revoked board says so rather than showing an error code', async () => {
    const api = okApi([], { get: jest.fn(async () => { throw new Error('not found'); }) });
    const view = await draw(api);
    await waitFor(() => expect(view.getByText('This board is no longer shared with you.')).toBeTruthy());
  });

  test('an empty board is a sentence, not a blank page', async () => {
    const api = okApi([]);
    const view = await draw(api);
    await waitFor(() => expect(view.getByText('Bea hasn’t put anything in this board yet.')).toBeTruthy());
  });

  test('leaving confirms, deletes the share, and tells the caller', async () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onLeft = jest.fn();
    const onClose = jest.fn();
    const api = okApi([item('m1')]);
    const view = await draw(api, { onLeft, onClose });
    await waitFor(() => expect(view.getByTestId('shared-board-leave')).toBeTruthy());

    fireEvent.press(view.getByTestId('shared-board-leave'));
    expect(api.delete).not.toHaveBeenCalled();

    const leave = spy.mock.calls[0][2].find((b) => b.style === 'destructive');
    await leave.onPress();
    // The recipient's half of DELETE /api/album-access/:id — same endpoint the
    // owner revokes with, same id.
    expect(api.delete).toHaveBeenCalledWith('/album-access/share_1');
    expect(onLeft).toHaveBeenCalledWith('share_1');
    expect(onClose).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('video and audio are marked rather than shown as dead stills', async () => {
    const api = okApi([item('m1', { type: 'video' }), item('m2', { type: 'audio' })]);
    const view = await draw(api);
    await waitFor(() => expect(view.getByTestId('shared-item-m1')).toBeTruthy());
    fireEvent.press(view.getByTestId('shared-item-m1'));
    await waitFor(() => expect(view.getByText('m1.jpg')).toBeTruthy());
  });

  test('a second page is appended without duplicating a shifted row', async () => {
    // The owner adding a photo between two page reads slides the window, so the
    // same id can come back twice — and a duplicate key takes the list down.
    const api = {
      get: jest.fn()
        .mockResolvedValueOnce({ success: true, items: [item('m1'), item('m2')], total: 4, hasMore: true })
        .mockResolvedValueOnce({ success: true, items: [item('m2'), item('m3')], total: 4, hasMore: false }),
      delete: jest.fn(),
    };
    const view = await draw(api);
    await waitFor(() => expect(view.getByTestId('shared-item-m2')).toBeTruthy());

    fireEvent(view.getByTestId('shared-item-m1').parent, 'onEndReached');
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.getByTestId('shared-item-m3')).toBeTruthy());
    // m2 arrived in both pages and must appear once.
    expect(view.getAllByTestId('shared-item-m2')).toHaveLength(1);
  });
});
