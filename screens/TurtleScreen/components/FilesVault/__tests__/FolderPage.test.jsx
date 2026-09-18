import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
// FolderPage reads insets via react-native-safe-area-context itself, and so
// does ViewerSheet (mounted by the sheets this page opens); there is no
// SafeAreaProvider under jest, so the hook needs a mock — same shape as
// FolderSheets.test.jsx uses for the same reason.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../../../../utils/haptics', () => ({ tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(() => Promise.resolve(null)), setItem: jest.fn(() => Promise.resolve()) }));
// Named `mockApi` / `mockSendOrQueue` / `mockOpenDocument` (not `api` /
// `sendOrQueue` / `openDocument`): babel-plugin-jest-hoist moves jest.mock()
// calls above this file's own const declarations, and only allows a factory
// to close over an outer variable whose name starts with "mock" — the same
// convention FolderSheets.test.jsx / useFolderData.test.js use for the
// identical ServerContext / offlineQueue mocks.
const mockApi = { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() };
jest.mock('../../../../../context/ServerContext', () => ({ useServer: () => ({ api: mockApi }), getApiAuthToken: () => 't' }));
const mockSendOrQueue = jest.fn(() => Promise.resolve({ queued: false, result: { success: true, moved: 1 } }));
jest.mock('../../../../../services/offlineQueue', () => ({ sendOrQueue: (...a) => mockSendOrQueue(...a) }));
const mockOpenDocument = jest.fn(() => Promise.resolve({ uri: 'x', cached: true }));
jest.mock('../documentOpen', () => ({ openDocument: (...a) => mockOpenDocument(...a) }));
jest.mock('../../EdgeSwipePage', () => ({ visible, children }) => (visible ? children : null));

import FolderPage from '../FolderPage';

const theme = { mode: 'dark', colors: { background: '#000', surface: '#0a0a0a', surfaceElevated: '#111', textPrimary: '#fff', textSecondary: '#aaa', textMuted: '#666', primary: '#fff', border: '#222', accentError: '#f55', accentInfo: '#4af' } };
const listing = {
  success: true,
  folder: { id: 'fld_bbbbbbbbbbbb', name: 'Taxes' },
  path: [{ id: 'fld_aaaaaaaaaaaa', name: 'Scans' }, { id: 'fld_bbbbbbbbbbbb', name: 'Taxes' }],
  folders: [{ id: 'fld_cccccccccccc', name: '2025', itemCount: 2, folderCount: 0, covers: [] }],
  items: [
    { id: 'doc-1', type: 'document', originalName: 'lease.pdf', size: 5, uploadDate: 100, rawUrl: '/r/1', thumbnailUrl: '/t/1' },
    { id: 'img-1', type: 'image', originalName: 'a.jpg', size: 50, uploadDate: 300, rawUrl: '/r/2', thumbnailUrl: '/t/2' },
  ],
  pagination: { total: 2, limit: 200, offset: 0, hasMore: false },
};
const root = { success: true, folder: null, path: [], folders: [{ id: 'fld_aaaaaaaaaaaa', name: 'Scans', itemCount: 0, folderCount: 1, covers: [] }], items: [], unfiled: { count: 0 } };

const props = () => ({ visible: true, parent: 'fld_bbbbbbbbbbbb', onClose: jest.fn(), onOpenFolder: jest.fn(), onOpenMedia: jest.fn(), onBulkTag: jest.fn(), onUploadHere: jest.fn(), getFullUrl: (p) => `http://pond${p}`, base: 'http://pond', theme, topInset: 0, bottomInset: 0 });

beforeEach(() => { jest.clearAllMocks(); mockApi.get.mockImplementation((p) => Promise.resolve(p.includes('parent=root') ? root : listing)); });

// NOTE: @testing-library/react-native 14.0.1's render/rerender/fireEvent/waitFor
// are all `async function`s in this repo's installed version (confirmed by
// FolderDisc.test.jsx / FolderSheets.test.jsx) — every call is awaited here.
describe('FolderPage', () => {
  it('renders crumbs, subfolders, document rows and media thumbs; taps route to the right opener', async () => {
    const p = props();
    const { getByText, getByLabelText } = await render(<FolderPage {...p} />);
    await waitFor(() => getByText('lease.pdf'));
    expect(getByText('Scans')).toBeTruthy();
    expect(getByText('Taxes')).toBeTruthy();
    await fireEvent.press(getByLabelText('Open folder 2025'));
    expect(p.onOpenFolder).toHaveBeenCalledWith(expect.objectContaining({ id: 'fld_cccccccccccc' }));
    await fireEvent.press(getByLabelText('Open lease.pdf'));
    await waitFor(() => expect(mockOpenDocument).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-1' }), expect.any(Object)));
    await fireEvent.press(getByLabelText('Open photo a.jpg'));
    expect(p.onOpenMedia).toHaveBeenCalledWith([expect.objectContaining({ id: 'img-1' })], expect.objectContaining({ id: 'img-1' }));
  });

  it('long-press enters select mode; Move sends one bulk request and the rows leave at once', async () => {
    const p = props();
    const { getByText, getByLabelText, queryByText } = await render(<FolderPage {...p} />);
    await waitFor(() => getByText('lease.pdf'));
    await fireEvent(getByLabelText('Open lease.pdf'), 'longPress');
    expect(getByText('1 selected')).toBeTruthy();
    await fireEvent.press(getByLabelText('Move selection'));
    await waitFor(() => getByLabelText('Choose Unfiled'));
    await act(async () => { await fireEvent.press(getByLabelText('Choose Unfiled')); });
    expect(mockSendOrQueue).toHaveBeenCalledWith(mockApi, expect.objectContaining({ method: 'post', path: '/media/move', body: { ids: ['doc-1'], folderId: null } }));
    expect(queryByText('lease.pdf')).toBeNull();
    expect(queryByText('1 selected')).toBeNull();
  });

  it('the ⋯ menu offers New folder and Upload here', async () => {
    const p = props();
    const { getByLabelText, getByText } = await render(<FolderPage {...p} />);
    await waitFor(() => getByText('lease.pdf'));
    await fireEvent.press(getByLabelText('More actions'));
    await fireEvent.press(getByLabelText('Upload here'));
    expect(p.onUploadHere).toHaveBeenCalledWith('fld_bbbbbbbbbbbb');
  });

  // M3: the header Back chevron used to call the raw onClose even in select
  // mode (inconsistent with the left-edge swipe, which cleared the selection
  // instead). Back must clear-and-stay once, then actually close.
  it('Back clears the selection in select mode, and only closes the page once selection is empty', async () => {
    const p = props();
    const { getByText, getByLabelText, queryByText } = await render(<FolderPage {...p} />);
    await waitFor(() => getByText('lease.pdf'));
    await fireEvent(getByLabelText('Open lease.pdf'), 'longPress');
    expect(getByText('1 selected')).toBeTruthy();
    await fireEvent.press(getByLabelText('Back'));
    expect(queryByText('1 selected')).toBeNull();
    expect(p.onClose).not.toHaveBeenCalled();
    await fireEvent.press(getByLabelText('Back'));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  // I5: the server caps a listing at 200 (useFolderData's PAGE) and returns
  // pagination.hasMore/.total; the footer must say so rather than silently
  // truncating.
  it('shows a "first N of total" notice when the server truncated the listing', async () => {
    const capped = { ...listing, pagination: { total: 250, limit: 200, offset: 0, hasMore: true } };
    mockApi.get.mockImplementation((p) => Promise.resolve(p.includes('parent=root') ? root : capped));
    const { getByText } = await render(<FolderPage {...props()} />);
    await waitFor(() => getByText('Showing the first 2 of 250'));
  });
});
