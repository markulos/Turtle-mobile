import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

// `renderHook` is unusable in this suite (it returns a promise, so destructuring
// `result` yields undefined) — drive a host component and capture the return.
const mockApi = { get: jest.fn() };
jest.mock('../../../context/ServerContext', () => ({
  useServer: () => ({ api: mockApi }),
  getApiAuthToken: () => 't',
}));

import useNoteThumbs from '../useNoteThumbs';

let latest = null;
function Harness({ notes }) {
  latest = useNoteThumbs(notes);
  return null;
}

const row = (id) => ({ id, type: 'image', thumbnailLgUrl: `/t/${id}-lg.webp` });
const idsOf = (call) => decodeURIComponent(call[0].replace('/media/by-ids?ids=', '')).split(',');

beforeEach(() => { mockApi.get.mockReset(); latest = null; });

it('asks for nothing when no note carries an attachment', async () => {
  await render(<Harness notes={[{ id: 'n1', mediaIds: [] }, { id: 'n2' }]} />);
  expect(mockApi.get).not.toHaveBeenCalled();
  expect(latest.size).toBe(0);
});

it('resolves the whole loaded page in one call, not one per row', async () => {
  mockApi.get.mockResolvedValue({ items: [row('a'), row('b')] });
  const notes = [{ id: 'n1', mediaIds: ['a'] }, { id: 'n2', mediaIds: ['b'] }];
  await render(<Harness notes={notes} />);

  await waitFor(() => expect(latest.size).toBe(2));
  expect(mockApi.get).toHaveBeenCalledTimes(1);
  expect(idsOf(mockApi.get.mock.calls[0])).toEqual(['a', 'b']);
  expect(latest.get('a')).toEqual(row('a'));
});

it('only asks for ids it has not asked about before', async () => {
  mockApi.get.mockResolvedValue({ items: [row('a')] });
  const view = await render(<Harness notes={[{ id: 'n1', mediaIds: ['a'] }]} />);
  await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(1));

  // Paging in more notes: only the new ids cost a request.
  await view.rerender(<Harness notes={[{ id: 'n1', mediaIds: ['a'] }, { id: 'n2', mediaIds: ['a', 'z'] }]} />);
  await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2));
  expect(idsOf(mockApi.get.mock.calls[1])).toEqual(['z']);
});

it('costs nothing when a refresh rebuilds the same notes', async () => {
  mockApi.get.mockResolvedValue({ items: [row('a')] });
  const view = await render(<Harness notes={[{ id: 'n1', mediaIds: ['a'] }]} />);
  await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(1));

  // A fresh array with the same contents — what every list refresh produces.
  await view.rerender(<Harness notes={[{ id: 'n1', mediaIds: ['a'] }]} />);
  expect(mockApi.get).toHaveBeenCalledTimes(1);
});

it('splits a page past the server cap into several requests', async () => {
  const many = Array.from({ length: 205 }, (_, i) => `m${i}`);
  mockApi.get.mockResolvedValue({ items: [] });
  await render(<Harness notes={[{ id: 'n1', mediaIds: many }]} />);

  // 200 is the cap GET /media/by-ids enforces; 201 in one call is a 400.
  await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2));
  expect(idsOf(mockApi.get.mock.calls[0])).toHaveLength(200);
  expect(idsOf(mockApi.get.mock.calls[1])).toHaveLength(5);
});

it('swallows a failure and does not retry it on the next render', async () => {
  // A missing thumbnail makes a row look like a note without one — the correct
  // degradation for a decoration. Retrying mid-scroll would help nobody.
  mockApi.get.mockRejectedValue(new Error('API 404'));
  const view = await render(<Harness notes={[{ id: 'n1', mediaIds: ['a'] }]} />);
  await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(1));

  await view.rerender(<Harness notes={[{ id: 'n1', mediaIds: ['a'] }]} />);
  expect(mockApi.get).toHaveBeenCalledTimes(1);
  expect(latest.size).toBe(0);
});

it('does not re-ask for an id whose media was deleted', async () => {
  // It never comes back, so "answered" can't be the thing that stops the ask.
  mockApi.get.mockResolvedValue({ items: [] });
  const view = await render(<Harness notes={[{ id: 'n1', mediaIds: ['gone'] }]} />);
  await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(1));

  await view.rerender(<Harness notes={[{ id: 'n1', mediaIds: ['gone'] }]} />);
  expect(mockApi.get).toHaveBeenCalledTimes(1);
});
