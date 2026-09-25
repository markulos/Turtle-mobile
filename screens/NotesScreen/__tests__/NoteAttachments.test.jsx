import React from 'react';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('../../../utils/haptics', () => ({ tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn() }));

// Named `mockApi` because babel-plugin-jest-hoist lifts jest.mock() above this
// file's consts and only lets the factory close over a "mock"-prefixed name.
const mockApi = { get: jest.fn() };
jest.mock('../../../context/ServerContext', () => ({
  useServer: () => ({
    api: mockApi,
    getBaseUrl: () => 'http://pond.local/api',
    getMediaBaseUrl: () => 'http://media.local/api',
  }),
  getApiAuthToken: () => 't',
}));

import NoteAttachments from '../NoteAttachments';

const theme = {
  colors: {
    surface: '#0a0a0a', surfaceElevated: '#111', border: '#222',
    textPrimary: '#fff', textSecondary: '#aaa', textTertiary: '#888', textMuted: '#666',
  },
};

const IMAGE = {
  id: '11', type: 'image', mimeType: 'image/png', name: 'shot.png',
  thumbnailUrl: '/api/media/thumbnails/11.webp',
  thumbnailLgUrl: '/api/media/thumbnails/11-lg.webp',
};
const DOC = { id: '12', type: 'document', mimeType: 'application/pdf', name: 'spec.pdf', thumbnailUrl: null, thumbnailLgUrl: null };

const draw = (props = {}) => render(
  <NoteAttachments theme={theme} isDark onOpenImage={jest.fn()} {...props} />,
);

beforeEach(() => { mockApi.get.mockReset(); });

it('renders nothing for a note that carries no files', async () => {
  const view = await draw({ mediaIds: [] });
  expect(view.toJSON()).toBeNull();
  expect(mockApi.get).not.toHaveBeenCalled();
});

it('resolves the note\'s ids through /media/by-ids and shows the images', async () => {
  mockApi.get.mockResolvedValue({ success: true, items: [IMAGE] });
  const view = await draw({ mediaIds: ['11'] });

  await waitFor(() => expect(view.getByLabelText('Open shot.png')).toBeTruthy());
  expect(mockApi.get).toHaveBeenCalledWith('/media/by-ids?ids=11');
  expect(view.getByText('1 file')).toBeTruthy();
});

it('draws the thumbnail from the MEDIA origin, not the api one', async () => {
  // Bytes ride the probed HTTP/2 media origin so a thumbnail the gallery has
  // already cached is a cache hit here too.
  mockApi.get.mockResolvedValue({ success: true, items: [IMAGE] });
  const view = await draw({ mediaIds: ['11'] });

  const img = await waitFor(() => view.getByTestId('note-attachment-11'));
  expect(img.props.source).toEqual({ uri: 'http://media.local/api/media/thumbnails/11-lg.webp' });
});

it('hands the viewer the full-size url, the thumbnail and the tapped index', async () => {
  const onOpenImage = jest.fn();
  mockApi.get.mockResolvedValue({ success: true, items: [IMAGE, { ...IMAGE, id: '13', name: 'two.png' }] });
  const view = await draw({ mediaIds: ['11', '13'], onOpenImage });

  const second = await waitFor(() => view.getByLabelText('Open two.png'));
  await fireEvent.press(second);

  expect(onOpenImage).toHaveBeenCalledTimes(1);
  const [images, index] = onOpenImage.mock.calls[0];
  expect(index).toBe(1);
  expect(images[1]).toEqual({
    key: '13',
    // Addressed by id — nothing from the vault is needed to open it.
    uri: 'http://media.local/api/media/display/13',
    previewUri: 'http://media.local/api/media/thumbnails/11-lg.webp',
    name: 'two.png',
  });
});

it('shows non-images as named chips rather than in the viewer', async () => {
  mockApi.get.mockResolvedValue({ success: true, items: [DOC] });
  const view = await draw({ mediaIds: ['12'] });

  await waitFor(() => expect(view.getByText('spec.pdf')).toBeTruthy());
  expect(view.queryByLabelText('Open spec.pdf')).toBeNull();
});

it('renders what came back and accounts for the ids that did not', async () => {
  // A note outlives its files: a deleted photo is an ordinary result, not an
  // error — but the count above must not then read as a bug.
  mockApi.get.mockResolvedValue({ success: true, items: [IMAGE] });
  const view = await draw({ mediaIds: ['11', '99'] });

  await waitFor(() => expect(view.getByText('1 no longer in the vault.')).toBeTruthy());
  expect(view.getByText('2 files')).toBeTruthy();
  expect(view.getByLabelText('Open shot.png')).toBeTruthy();
});

it('says so when the fetch itself fails', async () => {
  mockApi.get.mockRejectedValue(new Error('API 404 on GET /media/by-ids'));
  const view = await draw({ mediaIds: ['11'] });

  await waitFor(() => expect(view.getByText('Could not load these right now.')).toBeTruthy());
});

it('is read-only without onRemove, and an editor with it', async () => {
  mockApi.get.mockResolvedValue({ success: true, items: [IMAGE, DOC] });
  const readOnly = await draw({ mediaIds: ['11', '12'] });
  await waitFor(() => expect(readOnly.getByLabelText('Open shot.png')).toBeTruthy());
  expect(readOnly.queryByLabelText('Remove shot.png')).toBeNull();

  const onRemove = jest.fn();
  const editor = await draw({ mediaIds: ['11', '12'], onRemove });
  await waitFor(() => expect(editor.getByLabelText('Remove shot.png')).toBeTruthy());
  // Chips get one too — a mis-picked PDF is as worth undoing as a photo.
  expect(editor.getByLabelText('Remove spec.pdf')).toBeTruthy();

  await fireEvent.press(editor.getByLabelText('Remove shot.png'));
  expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: '11' }));
});

it('keeps the pictures on screen while a newly-added id resolves', async () => {
  // The id set changes every time a file is attached. Blanking the strip to
  // "Loading…" each time would blink the images you already had off screen.
  mockApi.get.mockResolvedValue({ success: true, items: [IMAGE] });
  const view = await draw({ mediaIds: ['11'] });
  await waitFor(() => expect(view.getByLabelText('Open shot.png')).toBeTruthy());

  let resolveSecond;
  mockApi.get.mockReturnValue(new Promise((r) => { resolveSecond = r; }));
  await view.rerender(
    <NoteAttachments mediaIds={['11', '13']} theme={theme} isDark onOpenImage={jest.fn()} />,
  );
  expect(view.queryByText('Loading…')).toBeNull();
  expect(view.getByLabelText('Open shot.png')).toBeTruthy();

  await act(async () => {
    resolveSecond({ success: true, items: [IMAGE, { ...IMAGE, id: '13', name: 'two.png' }] });
  });
  await waitFor(() => expect(view.getByLabelText('Open two.png')).toBeTruthy());
});

it('keeps what it already had when a refresh fails', async () => {
  mockApi.get.mockResolvedValue({ success: true, items: [IMAGE] });
  const view = await draw({ mediaIds: ['11'] });
  await waitFor(() => expect(view.getByLabelText('Open shot.png')).toBeTruthy());

  mockApi.get.mockRejectedValue(new Error('offline'));
  await view.rerender(
    <NoteAttachments mediaIds={['11', '13']} theme={theme} isDark onOpenImage={jest.fn()} />,
  );
  await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2));
  // Still there — emptying the strip over one failed refresh would read as
  // "your files are gone".
  expect(view.getByLabelText('Open shot.png')).toBeTruthy();
  expect(view.queryByText('Could not load these right now.')).toBeNull();
});

it('refetches when the id SET changes, not on every re-render', async () => {
  mockApi.get.mockResolvedValue({ success: true, items: [IMAGE] });
  const view = await draw({ mediaIds: ['11'] });
  await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(1));

  // A fresh array with the same ids — what a list refresh produces.
  await view.rerender(<NoteAttachments mediaIds={['11']} theme={theme} isDark onOpenImage={jest.fn()} />);
  expect(mockApi.get).toHaveBeenCalledTimes(1);

  await view.rerender(<NoteAttachments mediaIds={['11', '13']} theme={theme} isDark onOpenImage={jest.fn()} />);
  await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2));
  expect(mockApi.get).toHaveBeenLastCalledWith('/media/by-ids?ids=11%2C13');
});
