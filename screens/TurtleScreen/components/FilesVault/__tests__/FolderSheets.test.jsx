import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
// ViewerSheet reads insets via react-native-safe-area-context; there is no
// SafeAreaProvider under jest, so the hook needs a mock (same shape as
// MusicVault.test.jsx / PhotoViewer.test.jsx use for the same reason).
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../../../../utils/haptics', () => ({ tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn() }));
// Named `mockApi` (not `api`): babel-plugin-jest-hoist moves jest.mock() calls
// above this file's own const declarations, and only allows a factory to close
// over an outer variable whose name starts with "mock" — the same convention
// useFolderData.test.js uses for the identical ServerContext mock.
const mockApi = { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() };
jest.mock('../../../../../context/ServerContext', () => ({ useServer: () => ({ api: mockApi }), getApiAuthToken: () => 't' }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(() => Promise.resolve(null)), setItem: jest.fn(() => Promise.resolve()) }));
jest.mock('../../../../../services/offlineQueue', () => ({ sendOrQueue: jest.fn() }));

import { FolderNameSheet, FolderPickerSheet, FilesSortSheet, FolderActionsSheet } from '../FolderSheets';

const theme = { mode: 'dark', colors: { background: '#000', surface: '#0a0a0a', surfaceElevated: '#111', textPrimary: '#fff', textSecondary: '#aaa', textMuted: '#666', primary: '#fff', border: '#222', accentError: '#f55' } };

// NOTE: @testing-library/react-native 14.0.1's render/rerender/fireEvent/waitFor
// are all `async function`s in this repo's installed version (confirmed in
// node_modules/@testing-library/react-native/dist/render.js + fire-event.js,
// same fact FolderTile.test.jsx documents) — every call is awaited here.
describe('FolderSheets', () => {
  it('FolderNameSheet submits a trimmed name on Done and shows a server error inline', async () => {
    const onSubmit = jest.fn();
    const { getByLabelText, getByText, rerender } = await render(<FolderNameSheet title="New folder" doneLabel="Create" onSubmit={onSubmit} onClose={() => {}} theme={theme} />);
    await fireEvent.changeText(getByLabelText('Folder name'), '  Receipts ');
    await fireEvent.press(getByLabelText('Create'));
    expect(onSubmit).toHaveBeenCalledWith('Receipts');
    await rerender(<FolderNameSheet title="New folder" doneLabel="Create" onSubmit={onSubmit} onClose={() => {}} theme={theme} error="A folder named Receipts already exists here." />);
    expect(getByText(/already exists/)).toBeTruthy();
  });

  it('FolderPickerSheet browses from the root and picks a folder or Unfiled', async () => {
    mockApi.get.mockImplementation((p) => Promise.resolve(p.includes('parent=root')
      ? { success: true, folder: null, path: [], folders: [{ id: 'fld_aaaaaaaaaaaa', name: 'Scans', itemCount: 1, folderCount: 1, covers: [] }], items: [], unfiled: { count: 2 } }
      : { success: true, folder: { id: 'fld_aaaaaaaaaaaa', name: 'Scans' }, path: [{ id: 'fld_aaaaaaaaaaaa', name: 'Scans' }], folders: [{ id: 'fld_bbbbbbbbbbbb', name: 'Taxes', itemCount: 0, folderCount: 0, covers: [] }], items: [] }));
    const onPick = jest.fn();
    const { getByLabelText, getByText } = await render(<FolderPickerSheet onPick={onPick} onClose={() => {}} theme={theme} exclude={['fld_bbbbbbbbbbbb']} />);
    await waitFor(() => getByText('Scans'));
    await fireEvent.press(getByLabelText('Open folder Scans'));
    await waitFor(() => getByText('Taxes'));
    expect(getByLabelText('Open folder Taxes').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(getByLabelText('Move here'));
    expect(onPick).toHaveBeenCalledWith({ id: 'fld_aaaaaaaaaaaa', name: 'Scans' });
    await fireEvent.press(getByLabelText('Back to Files'));
    await waitFor(() => getByText('Unfiled'));
    await fireEvent.press(getByLabelText('Choose Unfiled'));
    expect(onPick).toHaveBeenLastCalledWith({ id: 'unfiled', name: 'Unfiled' });
  });

  it('FolderPickerSheet is a PAGE, not a card to pull up', async () => {
    // Mark, 2026-11-16: filing something means BROWSING a grid of folders,
    // and at the house 60% detent every one of them started below the fold.
    // One detent — nothing to drag up — but drag-down still closes, because
    // that is the cancel.
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '..', 'FolderSheets.jsx'), 'utf8',
    );
    const picker = src.slice(src.indexOf('export function FolderPickerSheet'));
    expect(picker).toMatch(/collapsedRatio=\{EXPANDED_RATIO\}/);
    expect(src).toMatch(/import ViewerSheet, \{ EXPANDED_RATIO \}/);
  });

  it('FolderPickerSheet searches, and OFFERS THE FOLDER IT CANNOT FIND', async () => {
    // "If the folder does not exist, it will offer to create a new folder
    // with the searched name." You came here to file something and typed
    // where it goes; the app not knowing that place is no reason to send
    // you away.
    mockApi.get.mockImplementation(() => Promise.resolve({ success: true, folder: null, path: [], folders: [{"id":"fld_aaaaaaaaaaaa","name":"Scans","itemCount":1,"folderCount":0,"covers":[]},{"id":"fld_cccccccccccc","name":"Receipts 2024","itemCount":3,"folderCount":0,"covers":[]}], items: [], unfiled: { count: 2 } }));
    // The hook posts through sendOrQueue, not through api.post directly —
    // mocking the wrong one leaves `r` undefined and the create silently
    // fails back to the sheet.
    require('../../../../../services/offlineQueue').sendOrQueue
      .mockResolvedValue({ queued: false, result: { success: true, folder: { id: 'fld_new', name: 'Invoices' } } });
    const onPick = jest.fn();
    const view = await render(<FolderPickerSheet onPick={onPick} onClose={() => {}} theme={theme} />);
    await waitFor(() => view.getByText('Scans'));

    // It FILTERS…
    await fireEvent.changeText(view.getByLabelText('Search folders'), 'receipts');
    await waitFor(() => expect(view.queryByText('Scans')).toBeNull());
    expect(view.getByText('Receipts 2024')).toBeTruthy();
    // …and a near miss still offers the exact name you typed, because
    // "Receipts" is not "Receipts 2024".
    expect(view.getByTestId('folder-picker-create')).toBeTruthy();

    // An EXACT match offers nothing: the folder is right there.
    await fireEvent.changeText(view.getByLabelText('Search folders'), 'Scans');
    await waitFor(() => expect(view.queryByTestId('folder-picker-create')).toBeNull());

    // And creating one files into it in the same breath — making the folder
    // and then asking where to put the thing is one question twice.
    await fireEvent.changeText(view.getByLabelText('Search folders'), 'Invoices');
    await fireEvent.press(view.getByTestId('folder-picker-create'));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith({ id: 'fld_new', name: 'Invoices' }));
  });

  it('FolderPickerSheet says so when a search matches nothing it can make', async () => {
    mockApi.get.mockImplementation(() => Promise.resolve({ success: true, folder: null, path: [], folders: [], items: [], unfiled: { count: 2 } }));
    const view = await render(<FolderPickerSheet onPick={() => {}} onClose={() => {}} theme={theme} />);
    await waitFor(() => view.getByLabelText('Search folders'));
    // Empty box, empty folder: the old hint, which is about Move here.
    expect(view.getByText(/No folders inside/)).toBeTruthy();
  });

  it('FilesSortSheet reports the sort, order and query', async () => {
    const onChange = jest.fn();
    const { getByLabelText } = await render(<FilesSortSheet sort="date" order="desc" query="" onChange={onChange} onClose={() => {}} theme={theme} />);
    await fireEvent.press(getByLabelText('Sort by name'));
    expect(onChange).toHaveBeenCalledWith({ sort: 'name', order: 'desc', query: '' });
    await fireEvent.press(getByLabelText('Oldest first'));
    expect(onChange).toHaveBeenCalledWith({ sort: 'date', order: 'asc', query: '' });
    await fireEvent.changeText(getByLabelText('Search this folder'), 'lease');
    expect(onChange).toHaveBeenCalledWith({ sort: 'date', order: 'desc', query: 'lease' });
  });

  it('FolderActionsSheet offers share, rename, move and delete', async () => {
    const onShare = jest.fn(); const onRename = jest.fn(); const onMove = jest.fn(); const onDelete = jest.fn();
    const { getByLabelText } = await render(<FolderActionsSheet folder={{ id: 'fld_aaaaaaaaaaaa', name: 'Scans' }} onShare={onShare} onRename={onRename} onMove={onMove} onDelete={onDelete} onClose={() => {}} theme={theme} />);
    // Share leads: it is the only one of these that involves anybody else.
    await fireEvent.press(getByLabelText('Share folder…'));
    await fireEvent.press(getByLabelText('Rename folder'));
    await fireEvent.press(getByLabelText('Move folder'));
    await fireEvent.press(getByLabelText('Delete folder'));
    expect(onShare).toHaveBeenCalled();
    expect(onRename).toHaveBeenCalled(); expect(onMove).toHaveBeenCalled(); expect(onDelete).toHaveBeenCalled();
  });
});
