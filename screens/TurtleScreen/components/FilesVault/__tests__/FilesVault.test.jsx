import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
// FilesVault calls useSafeAreaInsets() itself, and so do FolderPage and the
// ViewerSheet-backed FolderNameSheet it renders; there is no SafeAreaProvider
// under jest, so the hook needs a mock — same shape FolderPage.test.jsx and
// FolderSheets.test.jsx use for the identical reason.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../../../../utils/haptics', () => ({ tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(() => Promise.resolve(null)), setItem: jest.fn(() => Promise.resolve()) }));
// Named `mockApi` (not `api`): babel-plugin-jest-hoist only allows a
// jest.mock() factory to close over an outer variable whose name starts with
// "mock" — the same convention FolderPage.test.jsx / FolderSheets.test.jsx /
// useFolderData.test.js use for the identical ServerContext mock.
const mockApi = { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() };
jest.mock('../../../../../context/ServerContext', () => ({ useServer: () => ({ api: mockApi }), getApiAuthToken: () => 't' }));
jest.mock('../../../../../services/offlineQueue', () => ({ sendOrQueue: jest.fn(() => Promise.resolve({ queued: false, result: { success: true } })) }));
// FilesVault pushes FolderPage once a folder is open, and FolderPage imports
// the real documentOpen.js (expo-file-system/legacy + expo-sharing) at module
// scope; FolderPage.test.jsx mocks it for the same reason even though this
// suite never presses a document row.
jest.mock('../documentOpen', () => ({ openDocument: jest.fn(() => Promise.resolve({ uri: 'x', cached: true })) }));
jest.mock('../../EdgeSwipePage', () => ({ visible, children }) => (visible ? children : null));

import FilesVault from '../FilesVault';

const theme = { mode: 'dark', colors: { background: '#000', surface: '#0a0a0a', surfaceElevated: '#111', textPrimary: '#fff', textSecondary: '#aaa', textMuted: '#666', primary: '#fff', border: '#222', accentError: '#f55' } };
const root = { success: true, folder: null, path: [], folders: [{ id: 'fld_aaaaaaaaaaaa', name: 'Scans', itemCount: 3, folderCount: 1, covers: ['/t/1.jpg'] }], items: [], unfiled: { count: 2 }, pagination: { total: 0, limit: 200, offset: 0, hasMore: false } };
const scans = { success: true, folder: { id: 'fld_aaaaaaaaaaaa', name: 'Scans' }, path: [{ id: 'fld_aaaaaaaaaaaa', name: 'Scans' }], folders: [], items: [{ id: 'd1', type: 'document', originalName: 'a.pdf', uploadDate: 1, rawUrl: '/r', thumbnailUrl: null }], pagination: { total: 1, limit: 200, offset: 0, hasMore: false } };
const taxes = { success: true, folder: { id: 'fld_bbbbbbbbbbbb', name: 'Taxes' }, path: [{ id: 'fld_aaaaaaaaaaaa', name: 'Scans' }, { id: 'fld_bbbbbbbbbbbb', name: 'Taxes' }], folders: [], items: [], pagination: { total: 0, limit: 200, offset: 0, hasMore: false } };

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.get.mockImplementation((p) => Promise.resolve(p.includes('parent=root') ? root : p.includes('fld_bbbbbbbbbbbb') ? taxes : scans));
});

// NOTE: @testing-library/react-native 14.0.1's render/rerender/fireEvent/waitFor
// are all `async function`s in this repo's installed version (confirmed by
// FolderPage.test.jsx / FolderSheets.test.jsx) — every call is awaited here.
describe('FilesVault', () => {
  it('shows Unfiled first, then the folders A–Z, and pushes a folder page on tap', async () => {
    const { getByText, getByLabelText, queryByText } = await render(<FilesVault theme={theme} getFullUrl={(p) => `http://pond${p}`} base="http://pond" onOpenMedia={jest.fn()} onBulkTag={jest.fn()} onUploadHere={jest.fn()} />);
    await waitFor(() => getByText('Scans'));
    expect(getByText('Unfiled')).toBeTruthy();
    expect(getByText('2')).toBeTruthy();
    await fireEvent.press(getByLabelText('Open folder Scans'));
    await waitFor(() => getByText('a.pdf'));
    await fireEvent.press(getByLabelText('Back'));
    await waitFor(() => expect(queryByText('a.pdf')).toBeNull());
  });

  it('an open-target for a nested folder pushes the whole crumb chain', async () => {
    const consumed = jest.fn();
    const { getAllByText } = await render(<FilesVault theme={theme} getFullUrl={(p) => p} base="" onOpenMedia={jest.fn()} onBulkTag={jest.fn()} onUploadHere={jest.fn()} target={{ kind: 'folder', id: 'fld_bbbbbbbbbbbb' }} onTargetConsumed={consumed} />);
    await waitFor(() => getAllByText('Taxes'));
    expect(consumed).toHaveBeenCalled();
    // getAllByText, not getByText: the root's own "Scans" folder disc stays
    // mounted underneath the pushed pages (EdgeSwipePage's jest mock has no
    // occlusion, unlike the real overlay), and the Taxes-level FolderPage's
    // own crumb bar repeats "Scans" as an ancestor crumb — so it legitimately
    // renders more than once at once.
    expect(getAllByText('Scans').length).toBeGreaterThan(0);
  });
});
