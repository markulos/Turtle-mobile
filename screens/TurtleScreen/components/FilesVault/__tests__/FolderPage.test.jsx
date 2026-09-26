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
jest.mock('../documentOpen', () => ({
  openDocument: (...a) => mockOpenDocument(...a),
  shareDocument: (...a) => mockOpenDocument(...a),
  ensureLocalCopy: jest.fn(() => Promise.resolve({ uri: 'file:///x.pdf', cached: true })),
}));
jest.mock('../../EdgeSwipePage', () => ({ visible, children }) => (visible ? children : null));
// The reader is stubbed here so this file tests FolderPage's ROUTING decision
// (in-app vs share sheet) rather than react-native-pdf; PdfViewer.test.jsx
// covers the viewer itself. `mockCanRenderPdf` is flipped by the test that
// checks the no-renderer fallback.
let mockCanRenderPdf = true;
jest.mock('../PdfViewer', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    canRenderPdf: () => mockCanRenderPdf,
    default: ({ item }) => React.createElement(Text, null, `VIEWING ${item?.originalName}`),
  };
});

import FolderPage from '../FolderPage';

const theme = { mode: 'dark', colors: { background: '#000', surface: '#0a0a0a', surfaceElevated: '#111', textPrimary: '#fff', textSecondary: '#aaa', textMuted: '#666', primary: '#fff', border: '#222', accentError: '#f55', accentInfo: '#4af' } };
const listing = {
  success: true,
  folder: { id: 'fld_bbbbbbbbbbbb', name: 'Taxes' },
  path: [{ id: 'fld_aaaaaaaaaaaa', name: 'Scans' }, { id: 'fld_bbbbbbbbbbbb', name: 'Taxes' }],
  folders: [{ id: 'fld_cccccccccccc', name: '2025', itemCount: 2, folderCount: 0, covers: [] }],
  items: [
    // Three thumbnail shapes on purpose: a row with both variants (the peek
    // must prefer the large one), a row with only the small one (older rows,
    // pre-lg), and a row with none at all.
    { id: 'doc-1', type: 'document', originalName: 'lease.pdf', size: 5, uploadDate: 100, rawUrl: '/r/1', thumbnailUrl: '/t/1', thumbnailLgUrl: '/t/1-lg' },
    { id: 'doc-2', type: 'document', originalName: 'minutes.docx', size: 7, uploadDate: 200, rawUrl: '/r/3' },
    { id: 'doc-3', type: 'document', originalName: 'old-scan.pdf', size: 9, uploadDate: 150, rawUrl: '/r/4', thumbnailUrl: '/t/4' },
    { id: 'img-1', type: 'image', originalName: 'a.jpg', size: 50, uploadDate: 300, rawUrl: '/r/2', thumbnailUrl: '/t/2' },
  ],
  pagination: { total: 4, limit: 200, offset: 0, hasMore: false },
};
const root = { success: true, folder: null, path: [], folders: [{ id: 'fld_aaaaaaaaaaaa', name: 'Scans', itemCount: 0, folderCount: 1, covers: [] }], items: [], unfiled: { count: 0 } };

const props = () => ({ visible: true, parent: 'fld_bbbbbbbbbbbb', onClose: jest.fn(), onOpenFolder: jest.fn(), onOpenMedia: jest.fn(), onBulkTag: jest.fn(), onUploadHere: jest.fn(), onAddFromStorage: jest.fn(), getFullUrl: (p) => `http://pond${p}`, base: 'http://pond', theme, topInset: 0, bottomInset: 0 });

beforeEach(() => { jest.clearAllMocks(); mockCanRenderPdf = true; mockApi.get.mockImplementation((p) => Promise.resolve(p.includes('parent=root') ? root : listing)); });

// NOTE: @testing-library/react-native 14.0.1's render/rerender/fireEvent/waitFor
// are all `async function`s in this repo's installed version (confirmed by
// FolderTile.test.jsx / FolderSheets.test.jsx) — every call is awaited here.
describe('FolderPage', () => {
  it('renders crumbs, subfolders, document rows and media thumbs; taps route to the right opener', async () => {
    const p = props();
    const { getByText, getByLabelText } = await render(<FolderPage {...p} />);
    await waitFor(() => getByText('lease.pdf'));
    expect(getByText('Scans')).toBeTruthy();
    expect(getByText('Taxes')).toBeTruthy();
    await fireEvent.press(getByLabelText('Open folder 2025'));
    expect(p.onOpenFolder).toHaveBeenCalledWith(expect.objectContaining({ id: 'fld_cccccccccccc' }));
    await fireEvent.press(getByLabelText('Open minutes.docx'));
    await waitFor(() => expect(mockOpenDocument).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-2' }), expect.any(Object)));
    await fireEvent.press(getByLabelText('Open photo a.jpg'));
    expect(p.onOpenMedia).toHaveBeenCalledWith([expect.objectContaining({ id: 'img-1' })], expect.objectContaining({ id: 'img-1' }));
  });

  // The whole point of the reader: a PDF must NOT leave the app. Anything else
  // still does, because the OS previews a .docx and we cannot.
  it('a PDF opens the in-app reader; other documents still go to the share sheet', async () => {
    const { getByText, getByLabelText, queryByText } = await render(<FolderPage {...props()} />);
    await waitFor(() => getByText('lease.pdf'));
    await fireEvent.press(getByLabelText('Open lease.pdf'));
    await waitFor(() => getByText('VIEWING lease.pdf'));
    expect(mockOpenDocument).not.toHaveBeenCalled();

    await fireEvent.press(getByLabelText('Open minutes.docx'));
    await waitFor(() => expect(mockOpenDocument).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-2' }), expect.any(Object)));
    expect(queryByText('VIEWING minutes.docx')).toBeNull();
  });

  // An OTA update can land on a binary built before react-native-pdf was
  // added. The tap must still open the document, the old way.
  it('falls back to the share sheet for a PDF when the binary has no renderer', async () => {
    mockCanRenderPdf = false;
    const { getByText, getByLabelText, queryByText } = await render(<FolderPage {...props()} />);
    await waitFor(() => getByText('lease.pdf'));
    await fireEvent.press(getByLabelText('Open lease.pdf'));
    await waitFor(() => expect(mockOpenDocument).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-1' }), expect.any(Object)));
    expect(queryByText('VIEWING lease.pdf')).toBeNull();
  });

  it('peek → Select enters select mode; Move sends one bulk request and the rows leave at once', async () => {
    const p = props();
    const { getByText, getByLabelText, queryByText } = await render(<FolderPage {...p} />);
    await waitFor(() => getByText('lease.pdf'));
    // Long-press peeks now; Select inside the peek is the way into select mode.
    await fireEvent(getByLabelText('Open lease.pdf'), 'longPress');
    await fireEvent.press(getByLabelText('Select'));
    expect(getByText('1 selected')).toBeTruthy();
    await fireEvent.press(getByLabelText('Move selection'));
    await waitFor(() => getByLabelText('Choose Unfiled'));
    await act(async () => { await fireEvent.press(getByLabelText('Choose Unfiled')); });
    expect(mockSendOrQueue).toHaveBeenCalledWith(mockApi, expect.objectContaining({ method: 'post', path: '/media/move', body: { ids: ['doc-1'], folderId: null } }));
    expect(queryByText('lease.pdf')).toBeNull();
    expect(queryByText('1 selected')).toBeNull();
  });

  it('the ⋯ menu offers New folder and both add sources', async () => {
    const p = props();
    const { getByLabelText, getByText } = await render(<FolderPage {...p} />);
    await waitFor(() => getByText('lease.pdf'));
    await fireEvent.press(getByLabelText('More actions'));
    expect(getByLabelText('New folder')).toBeTruthy();
    await fireEvent.press(getByLabelText('Add photos & videos'));
    expect(p.onUploadHere).toHaveBeenCalledWith('fld_bbbbbbbbbbbb');
  });

  // The photo picker cannot see a PDF, so the storage row is the only in-app
  // way to put a document in a folder. It carries the folder's NAME as well as
  // its id, because that is what the share toast says the batch was filed in.
  it('the ⋯ menu offers phone storage as a second source, with the folder it files into', async () => {
    const p = props();
    const { getByLabelText, getByText } = await render(<FolderPage {...p} />);
    await waitFor(() => getByText('lease.pdf'));
    await fireEvent.press(getByLabelText('More actions'));
    await fireEvent.press(getByLabelText('Add from phone storage'));
    expect(p.onAddFromStorage).toHaveBeenCalledWith({ id: 'fld_bbbbbbbbbbbb', name: 'Taxes' });
  });

  // The row's 44pt tile is enough to tell a cover from a placeholder and no
  // more. Long-press shows the same picture at a readable size.
  it('long-press peeks at the document with its large cover, not select mode', async () => {
    const { getByText, getByLabelText, getByTestId, queryByText } = await render(<FolderPage {...props()} />);
    await waitFor(() => getByText('lease.pdf'));
    await fireEvent(getByLabelText('Open lease.pdf'), 'longPress');

    expect(getByTestId('peek-image').props.source).toEqual({ uri: 'http://pond/t/1-lg' });
    expect(queryByText('1 selected')).toBeNull();
    expect(mockOpenDocument).not.toHaveBeenCalled();
  });

  it('peeks an older row on its small cover when there is no large one', async () => {
    const { getByText, getByLabelText, getByTestId } = await render(<FolderPage {...props()} />);
    await waitFor(() => getByText('old-scan.pdf'));
    await fireEvent(getByLabelText('Open old-scan.pdf'), 'longPress');
    expect(getByTestId('peek-image').props.source).toEqual({ uri: 'http://pond/t/4' });
  });

  it('a document with no cover peeks with its typed icon rather than a blank card', async () => {
    const { getByText, getByLabelText, getByTestId } = await render(<FolderPage {...props()} />);
    await waitFor(() => getByText('minutes.docx'));
    await fireEvent(getByLabelText('Open minutes.docx'), 'longPress');
    expect(getByTestId('peek-no-preview')).toBeTruthy();
  });

  it('peek Open routes a PDF to the reader, and Share always goes out to the OS', async () => {
    const { getByText, getByLabelText, queryByTestId } = await render(<FolderPage {...props()} />);
    await waitFor(() => getByText('lease.pdf'));

    await fireEvent(getByLabelText('Open lease.pdf'), 'longPress');
    await fireEvent.press(getByLabelText('Open'));
    await waitFor(() => getByText('VIEWING lease.pdf'));
    expect(queryByTestId('peek-image')).toBeNull();
    expect(mockOpenDocument).not.toHaveBeenCalled();
  });

  it('peek Share hands even a PDF to the system sheet', async () => {
    const { getByText, getByLabelText } = await render(<FolderPage {...props()} />);
    await waitFor(() => getByText('lease.pdf'));
    await fireEvent(getByLabelText('Open lease.pdf'), 'longPress');
    await fireEvent.press(getByLabelText('Share'));
    await waitFor(() => expect(mockOpenDocument).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-1' }), expect.any(Object)));
  });

  // Once you ARE selecting, a long-press can only sensibly mean "toggle this".
  it('long-press still toggles selection while select mode is on', async () => {
    const { getByText, getByLabelText, queryByText } = await render(<FolderPage {...props()} />);
    await waitFor(() => getByText('lease.pdf'));
    await fireEvent(getByLabelText('Open lease.pdf'), 'longPress');
    await fireEvent.press(getByLabelText('Select'));
    expect(getByText('1 selected')).toBeTruthy();

    await fireEvent(getByLabelText('Select minutes.docx'), 'longPress');
    expect(getByText('2 selected')).toBeTruthy();
    await fireEvent(getByLabelText('Deselect minutes.docx'), 'longPress');
    expect(queryByText('2 selected')).toBeNull();
  });

  // M3: the header Back chevron used to call the raw onClose even in select
  // mode (inconsistent with the left-edge swipe, which cleared the selection
  // instead). Back must clear-and-stay once, then actually close.
  it('Back clears the selection in select mode, and only closes the page once selection is empty', async () => {
    const p = props();
    const { getByText, getByLabelText, queryByText } = await render(<FolderPage {...p} />);
    await waitFor(() => getByText('lease.pdf'));
    await fireEvent(getByLabelText('Open lease.pdf'), 'longPress');
    await fireEvent.press(getByLabelText('Select'));
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
    await waitFor(() => getByText('Showing the first 4 of 250'));
  });
});
