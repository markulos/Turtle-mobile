// Test-tooling notes (both learned the hard way on this exact file):
//
// 1. jest.mock() factories may only reference outer variables whose names
//    start with `mock` (babel-plugin-jest-hoist enforces this) — hence
//    mockFs/mockSharing rather than the brief's `fs`/`sharing` names.
//
// 2. That alone isn't enough here: babel-plugin-jest-hoist hoists the
//    jest.mock() calls themselves to the very top of the file — ABOVE any
//    outer `const` a factory closes over, even one declared earlier in the
//    source — and the commonjs-modules transform likewise hoists the
//    `import '../documentOpen'` above other top-level statements. So a
//    factory of the form `() => mockFs` (a pre-built object reference) runs
//    on the FIRST require, before `const mockFs = {...}` has executed, and
//    Jest caches that empty/undefined result for the rest of the file —
//    every property comes back `undefined` even though `mockFs` looks fully
//    built two lines later. Confirmed by transforming this file through
//    babel-plugin-jest-hoist directly and inspecting the hoisted order.
//    The fix (already used by shareUploadStaging.test.js and
//    MusicVault.test.jsx in this repo): give each factory plain literals
//    and small lazy-forwarding functions, so the real jest.fn() lookup
//    happens at CALL time (inside a test), not at module-construction time.
const mockGetInfoAsync = jest.fn();
const mockMakeDirectoryAsync = jest.fn(() => Promise.resolve());
const mockCreateDownloadResumable = jest.fn();
const mockDeleteAsync = jest.fn(() => Promise.resolve());
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: (...args) => mockGetInfoAsync(...args),
  makeDirectoryAsync: (...args) => mockMakeDirectoryAsync(...args),
  createDownloadResumable: (...args) => mockCreateDownloadResumable(...args),
  deleteAsync: (...args) => mockDeleteAsync(...args),
}));

const mockIsAvailableAsync = jest.fn(() => Promise.resolve(true));
const mockShareAsync = jest.fn(() => Promise.resolve());
jest.mock('expo-sharing', () => ({
  isAvailableAsync: (...args) => mockIsAvailableAsync(...args),
  shareAsync: (...args) => mockShareAsync(...args),
}));

import { openDocument, cachePathFor } from '../documentOpen';

// Convenience aliases so the test bodies below can stay close to the
// brief's verbatim `fs`/`sharing` shape. Built after the mock registration
// and the module-under-test import, from the same jest.fn() instances the
// mocks forward to — safe because plain `const` statements are never
// hoisted the way `jest.mock()` calls and `import`s are.
const mockFs = {
  cacheDirectory: 'file:///cache/',
  getInfoAsync: mockGetInfoAsync,
  makeDirectoryAsync: mockMakeDirectoryAsync,
  createDownloadResumable: mockCreateDownloadResumable,
  deleteAsync: mockDeleteAsync,
};
const mockSharing = { isAvailableAsync: mockIsAvailableAsync, shareAsync: mockShareAsync };

const item = { id: 'media_1', originalName: 'Lease / 2025.pdf', mimeType: 'application/pdf', rawUrl: '/api/media/raw/lease.pdf', storageMode: 'imported' };
const getFullUrl = (p) => `http://pond${p}`;

beforeEach(() => { jest.clearAllMocks(); });

describe('documentOpen', () => {
  it('names the cache file safely', () => {
    expect(cachePathFor(item)).toBe('file:///cache/files/media_1-Lease _ 2025.pdf');
  });
  it('downloads once with progress, then shares; a cached file is shared without a download', async () => {
    mockFs.getInfoAsync.mockResolvedValueOnce({ exists: false }).mockResolvedValueOnce({ exists: true, size: 10 });
    const downloadAsync = jest.fn(() => Promise.resolve({ uri: 'file:///cache/files/media_1-Lease _ 2025.pdf', status: 200 }));
    mockFs.createDownloadResumable.mockImplementation((url, dest, opts, cb) => { cb({ totalBytesWritten: 5, totalBytesExpectedToWrite: 10 }); return { downloadAsync }; });
    const onProgress = jest.fn();
    const first = await openDocument(item, { getFullUrl, onProgress });
    expect(mockFs.createDownloadResumable).toHaveBeenCalledWith('http://pond/api/media/raw/lease.pdf', cachePathFor(item), {}, expect.any(Function));
    expect(onProgress).toHaveBeenCalledWith(0.5);
    expect(mockSharing.shareAsync).toHaveBeenCalledWith(cachePathFor(item), { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Lease / 2025.pdf' });
    expect(first.cached).toBe(false);
    const second = await openDocument(item, { getFullUrl });
    expect(second.cached).toBe(true);
    expect(mockFs.createDownloadResumable).toHaveBeenCalledTimes(1);
  });
  it('explains a tunnel file whose computer is off, and a missing share sheet', async () => {
    mockFs.getInfoAsync.mockResolvedValue({ exists: false });
    mockFs.createDownloadResumable.mockImplementation(() => ({ downloadAsync: () => Promise.resolve({ status: 502, uri: 'x' }) }));
    await expect(openDocument({ ...item, storageMode: 'tunnel' }, { getFullUrl })).rejects.toThrow(/computer holding it is offline/);
    expect(mockFs.deleteAsync).toHaveBeenCalled();
    mockSharing.isAvailableAsync.mockResolvedValueOnce(false);
    await expect(openDocument(item, { getFullUrl })).rejects.toThrow(/not available/);
  });
});
