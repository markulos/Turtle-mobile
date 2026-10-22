/**
 * Transcribing a video from a Files folder.
 *
 * The badge is on the tile rather than behind a long-press (a long press here
 * already means "select"), and tapping it asks WHICH of the two outcomes is
 * wanted before anything is sent. What these pin:
 *
 *   • only a video carries the badge;
 *   • the choice sheet reflects what the pond admits to — "keep the audio"
 *     is disabled, with a reason, on a pond without the endpoint;
 *   • picking a mode starts that mode's run.
 *
 * The run itself is covered by services/__tests__/videoTranscribeRun.test.js;
 * here it is stubbed, so what is asserted is the page's own decision.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../../../../utils/haptics', () => ({ tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(() => Promise.resolve(null)), setItem: jest.fn(() => Promise.resolve()) }));

// Named with the `mock` prefix so babel-plugin-jest-hoist lets the factories
// below close over them — the convention the sibling tests use.
const mockApi = { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() };
jest.mock('../../../../../context/ServerContext', () => ({ useServer: () => ({ api: mockApi }), getApiAuthToken: () => 't' }));
jest.mock('../../../../../services/offlineQueue', () => ({ sendOrQueue: jest.fn(() => Promise.resolve({ queued: false, result: { success: true } })) }));
jest.mock('../documentOpen', () => ({
  openDocument: jest.fn(() => Promise.resolve({ uri: 'x', cached: true })),
  shareDocument: jest.fn(() => Promise.resolve({})),
  ensureLocalCopy: jest.fn(() => Promise.resolve({ uri: 'file:///x.pdf', cached: true })),
}));
jest.mock('../../EdgeSwipePage', () => ({ visible, children }) => (visible ? children : null));
jest.mock('../PdfViewer', () => ({ __esModule: true, canRenderPdf: () => true, default: () => null }));
// The panel is a whole screen of its own with its own network; this file is
// about the door into it, not what is behind it.
jest.mock('../../../../../components/TranscriptionPanel', () => () => null);

let mockCaps = {};
const mockStart = jest.fn();
jest.mock('../../../../../services/transcriptions', () => ({
  getCapabilities: () => Promise.resolve(mockCaps),
}));
jest.mock('../../../../../services/videoTranscribeRun', () => ({
  startVideoTranscription: (...args) => mockStart(...args),
}));

import FolderPage from '../FolderPage';

const theme = { mode: 'dark', colors: { background: '#000', surface: '#0a0a0a', surfaceElevated: '#111', textPrimary: '#fff', textSecondary: '#aaa', textMuted: '#666', primary: '#fff', border: '#222', accentError: '#f55', accentInfo: '#4af' } };

const listing = {
  success: true,
  folder: { id: 'fld_standups', name: 'Standups' },
  path: [{ id: 'fld_standups', name: 'Standups' }],
  folders: [],
  items: [
    { id: 'vid-1', type: 'video', originalName: 'Standup.mp4', size: 900, uploadDate: 300, rawUrl: '/r/v', thumbnailUrl: '/t/v' },
    { id: 'img-1', type: 'image', originalName: 'a.jpg', size: 50, uploadDate: 200, rawUrl: '/r/i', thumbnailUrl: '/t/i' },
  ],
  pagination: { total: 2, limit: 200, offset: 0, hasMore: false },
};

const props = () => ({
  visible: true, parent: 'fld_standups', onClose: jest.fn(), onOpenFolder: jest.fn(),
  onOpenMedia: jest.fn(), onBulkTag: jest.fn(), onUploadHere: jest.fn(), onAddFromStorage: jest.fn(),
  getFullUrl: (p) => `http://pond${p}`, base: 'http://pond', theme, topInset: 0, bottomInset: 0,
});

// `render` is awaited: this project's RNTL build resolves it asynchronously,
// and the synchronous return value has none of the queries on it.
async function open() {
  const view = await render(<FolderPage {...props()} />);
  await waitFor(() => view.getByTestId('transcribe-vid-1'));
  return view;
}

beforeEach(() => {
  mockCaps = { features: { mediaSubmit: true, audioExtract: true } };
  mockStart.mockClear();
  mockApi.get.mockImplementation(() => Promise.resolve(listing));
  mockApi.post.mockImplementation(() => Promise.resolve({}));
});

it('puts the badge on a video and on nothing else', async () => {
  const view = await open();
  expect(view.queryByTestId('transcribe-vid-1')).toBeTruthy();
  expect(view.queryByTestId('transcribe-img-1')).toBeNull();
});

it('asks which outcome is wanted, then starts that run', async () => {
  const view = await open();
  await act(async () => { fireEvent.press(view.getByTestId('transcribe-vid-1')); });
  await waitFor(() => view.getByTestId('transcribe-mode-audio'));

  await act(async () => { fireEvent.press(view.getByTestId('transcribe-mode-audio')); });
  expect(mockStart).toHaveBeenCalledTimes(1);
  expect(mockStart.mock.calls[0][1]).toMatchObject({ mode: 'audio' });
  expect(mockStart.mock.calls[0][1].item.id).toBe('vid-1');
});

it('offers the plain transcript on a pond that cannot keep the audio, and says why', async () => {
  mockCaps = { features: { mediaSubmit: true } };
  const view = await open();
  await act(async () => { fireEvent.press(view.getByTestId('transcribe-vid-1')); });
  await waitFor(() => view.getByTestId('transcribe-mode-transcript'));

  expect(view.getByText(/can still transcribe the video/)).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByTestId('transcribe-mode-transcript')); });
  expect(mockStart.mock.calls[0][1]).toMatchObject({ mode: 'transcript' });
});
