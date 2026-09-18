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
// same fact FolderDisc.test.jsx documents) — every call is awaited here.
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

  it('FolderActionsSheet offers rename, move and delete', async () => {
    const onRename = jest.fn(); const onMove = jest.fn(); const onDelete = jest.fn();
    const { getByLabelText } = await render(<FolderActionsSheet folder={{ id: 'fld_aaaaaaaaaaaa', name: 'Scans' }} onRename={onRename} onMove={onMove} onDelete={onDelete} onClose={() => {}} theme={theme} />);
    await fireEvent.press(getByLabelText('Rename folder'));
    await fireEvent.press(getByLabelText('Move folder'));
    await fireEvent.press(getByLabelText('Delete folder'));
    expect(onRename).toHaveBeenCalled(); expect(onMove).toHaveBeenCalled(); expect(onDelete).toHaveBeenCalled();
  });
});
