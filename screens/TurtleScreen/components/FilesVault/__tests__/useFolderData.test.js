import { act, renderHook, waitFor } from '@testing-library/react-native';

// babel-plugin-jest-hoist moves every jest.mock() call above this file's own
// const declarations, so a factory that closes over an outer variable must
// name it with a leading "mock" (the same house convention as
// screens/TasksScreen/hooks/__tests__/useTaskData.outbox.test.js's mockStore) —
// otherwise it's a real TDZ bug, not just a lint nit.
const mockStore = new Map();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((k) => Promise.resolve(mockStore.get(k) ?? null)),
  setItem: jest.fn((k, v) => { mockStore.set(k, v); return Promise.resolve(); }),
}));
const mockApi = { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() };
jest.mock('../../../../../context/ServerContext', () => ({
  useServer: () => ({ api: mockApi }),
  getApiAuthToken: () => 'token-a',
}));
const mockSendOrQueue = jest.fn();
jest.mock('../../../../../services/offlineQueue', () => ({ sendOrQueue: (...a) => mockSendOrQueue(...a) }));

import useFolderData, { applyRename, withoutFolder, withoutItems, withFolder } from '../useFolderData';

const hashOf = (token) => { let h = 0; for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) | 0; return h >>> 0; };
const listing = () => ({
  folder: { id: 'fld_aaaaaaaaaaaa', name: 'Scans', parentId: null },
  path: [{ id: 'fld_aaaaaaaaaaaa', name: 'Scans' }],
  folders: [{ id: 'fld_bbbbbbbbbbbb', name: 'Taxes', itemCount: 2, folderCount: 0, covers: [] }],
  items: [{ id: 'doc-1', type: 'document', originalName: 'a.pdf', size: 5, uploadDate: 100 }],
  pagination: { total: 1, limit: 200, offset: 0, hasMore: false },
});

beforeEach(() => { mockStore.clear(); jest.clearAllMocks(); });

describe('useFolderData', () => {
  it('serves the cached listing first, then the network, and writes the cache back', async () => {
    const cached = { ...listing(), items: [] };
    mockStore.set(`turtle.filesCache.${hashOf('token-a')}.fld_aaaaaaaaaaaa.date.desc`, JSON.stringify({ listing: cached, savedAt: 1 }));
    // The network response is held open deliberately: renderHook()'s own mount
    // await (see below) drains every microtask that's already resolvable, so
    // an instantly-resolved mock here would race straight past the cached
    // paint and land on the network value before the first assertion ever runs.
    // Holding it open lets us observe the cache-then-network staging for real
    // instead of hoping the two resolutions land in separate ticks.
    let resolveGet;
    mockApi.get.mockImplementationOnce(() => new Promise((resolve) => { resolveGet = resolve; }));
    const { result } = await renderHook(() => useFolderData('fld_aaaaaaaaaaaa'));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.data.items.length).toBe(0); // the cache, instantly
    await act(async () => { resolveGet({ success: true, ...listing() }); });
    await waitFor(() => expect(result.current.data.items.length).toBe(1)); // then the network
    expect(mockApi.get).toHaveBeenCalledWith('/folders?parent=fld_aaaaaaaaaaaa&sort=date&order=desc&limit=200&offset=0');
    expect(mockStore.size).toBe(1);
  });

  it('createFolder shows the folder at once and swaps in the server row', async () => {
    mockApi.get.mockResolvedValue({ success: true, ...listing() });
    mockSendOrQueue.mockResolvedValueOnce({ queued: false, result: { success: true, folder: { id: 'fld_cccccccccccc', name: 'Receipts', parentId: 'fld_aaaaaaaaaaaa' } } });
    const { result } = await renderHook(() => useFolderData('fld_aaaaaaaaaaaa'));
    await waitFor(() => expect(result.current.data?.items?.length).toBe(1));
    let out;
    await act(async () => { out = await result.current.createFolder('Receipts'); });
    expect(out.queued).toBe(false);
    expect(result.current.data.folders.map((f) => f.name)).toEqual(['Receipts', 'Taxes']);
    expect(result.current.data.folders[0].id).toBe('fld_cccccccccccc');
    expect(mockSendOrQueue).toHaveBeenCalledWith(mockApi, expect.objectContaining({ method: 'post', path: '/folders', body: { parentId: 'fld_aaaaaaaaaaaa', name: 'Receipts' } }));
  });

  it('a permanent failure reverts and rejects; a queued write keeps the optimistic state', async () => {
    mockApi.get.mockResolvedValue({ success: true, ...listing() });
    const { result } = await renderHook(() => useFolderData('fld_aaaaaaaaaaaa'));
    await waitFor(() => expect(result.current.data?.items?.length).toBe(1));
    mockSendOrQueue.mockRejectedValueOnce(Object.assign(new Error('A folder named Taxes already exists here.'), { status: 409 }));
    await act(async () => {
      await expect(result.current.renameFolder('fld_bbbbbbbbbbbb', 'Taxes')).rejects.toThrow(/already exists/);
    });
    expect(result.current.data.folders[0].name).toBe('Taxes');
    mockSendOrQueue.mockResolvedValueOnce({ queued: true });
    await act(async () => { await result.current.moveItems(['doc-1'], 'fld_bbbbbbbbbbbb'); });
    expect(result.current.data.items).toEqual([]);
    expect(result.current.data.folders[0].itemCount).toBe(3);
  });

  it('pure list transforms', () => {
    const l = listing();
    expect(applyRename(l, 'fld_bbbbbbbbbbbb', 'Tax').folders[0].name).toBe('Tax');
    expect(withoutFolder(l, 'fld_bbbbbbbbbbbb').folders).toEqual([]);
    expect(withoutItems(l, ['doc-1']).items).toEqual([]);
    expect(withoutItems(l, ['doc-1']).pagination.total).toBe(0);
    expect(withFolder(l, { id: 'x', name: 'apple' }).folders.map((f) => f.name)).toEqual(['apple', 'Taxes']);
  });
});
