import * as FileSystem from 'expo-file-system/legacy';
import {
  SHARE_UPLOAD_ROOT,
  assertShareStagingCapacity,
  sweepShareUploadStaging,
  writeShareUploadManifest,
} from '../shareUploadStaging';

const mockReadDirectoryAsync = jest.fn();
const mockGetInfoAsync = jest.fn();
const mockReadAsStringAsync = jest.fn();
const mockWriteAsStringAsync = jest.fn();
const mockDeleteAsync = jest.fn();
const mockGetFreeDiskStorageAsync = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: (...args) => mockGetInfoAsync(...args),
  readDirectoryAsync: (...args) => mockReadDirectoryAsync(...args),
  readAsStringAsync: (...args) => mockReadAsStringAsync(...args),
  writeAsStringAsync: (...args) => mockWriteAsStringAsync(...args),
  deleteAsync: (...args) => mockDeleteAsync(...args),
  getFreeDiskStorageAsync: (...args) => mockGetFreeDiskStorageAsync(...args),
}));

const manifest = (ownerIdentity, status) =>
  JSON.stringify({ version: 1, ownerIdentity, status, updatedAt: 1000, media: [] });

describe('share upload staging', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteAsync.mockResolvedValue(undefined);
    mockWriteAsStringAsync.mockResolvedValue(undefined);
  });

  test('removes old orphan, terminal, and foreign directories while retaining active and retry state', async () => {
    mockReadDirectoryAsync.mockResolvedValue([
      'active',
      'retry',
      'terminal',
      'foreign',
      'old-orphan',
    ]);
    mockGetInfoAsync.mockImplementation(async (uri) => ({
      exists: true,
      isDirectory: true,
      modificationTime: uri.includes('old-orphan') ? 1 : 900,
      size: 0,
    }));
    mockReadAsStringAsync.mockImplementation(async (uri) => {
      if (uri.includes('/retry/')) return manifest('sub:account-a', 'error');
      if (uri.includes('/terminal/')) return manifest('sub:account-a', 'queued');
      if (uri.includes('/foreign/')) return manifest('sub:account-b', 'uploading');
      throw new Error('missing manifest');
    });

    await sweepShareUploadStaging({
      ownerIdentity: 'sub:account-a',
      activeDirectories: [`${SHARE_UPLOAD_ROOT}active/`],
      now: 100000000,
      orphanMaxAgeMs: 1000,
    });

    const removed = mockDeleteAsync.mock.calls.map(([uri]) => uri);
    expect(removed).toEqual(
      expect.arrayContaining([
        `${SHARE_UPLOAD_ROOT}terminal/`,
        `${SHARE_UPLOAD_ROOT}foreign/`,
        `${SHARE_UPLOAD_ROOT}old-orphan/`,
      ])
    );
    expect(removed).not.toContain(`${SHARE_UPLOAD_ROOT}active/`);
    expect(removed).not.toContain(`${SHARE_UPLOAD_ROOT}retry/`);
  });

  test('cache maintenance retains known active or retry manifests without an owner', async () => {
    mockReadDirectoryAsync.mockResolvedValue(['retry-a', 'active-b']);
    mockGetInfoAsync.mockResolvedValue({
      exists: true,
      isDirectory: true,
      modificationTime: 1,
      size: 0,
    });
    mockReadAsStringAsync
      .mockResolvedValueOnce(manifest('sub:account-a', 'error'))
      .mockResolvedValueOnce(manifest('sub:account-b', 'uploading'));

    await sweepShareUploadStaging({ now: 100000000, orphanMaxAgeMs: 1000 });

    expect(mockDeleteAsync).not.toHaveBeenCalled();
  });

  test('rejects staging that exceeds quota or available free-space reserve', async () => {
    mockGetInfoAsync.mockImplementation(async (uri) => {
      if (uri === SHARE_UPLOAD_ROOT) {
        return { exists: true, isDirectory: true, size: 0 };
      }
      return { exists: true, isDirectory: false, size: 80 };
    });
    mockReadDirectoryAsync.mockResolvedValue([]);
    mockGetFreeDiskStorageAsync.mockResolvedValue(100);

    await expect(
      assertShareStagingCapacity(['file:///one.mp3', 'file:///two.mp3'], {
        maxStagingBytes: 100,
        freeSpaceReserveBytes: 0,
      })
    ).rejects.toThrow('staging quota');

    await expect(
      assertShareStagingCapacity(['file:///one.mp3'], {
        maxStagingBytes: 1000,
        freeSpaceReserveBytes: 50,
      })
    ).rejects.toThrow('free space');
  });

  test('writes retry identity without persisting a bearer token', async () => {
    await writeShareUploadManifest(`${SHARE_UPLOAD_ROOT}job/`, {
      ownerIdentity: 'sub:account-a',
      authGeneration: 'generation-a',
      token: 'bearer-secret',
      status: 'error',
      media: [{ clientImportId: 'stable-id' }],
    });

    const serialized = mockWriteAsStringAsync.mock.calls[0][1];
    expect(serialized).toContain('stable-id');
    expect(serialized).toContain('sub:account-a');
    expect(serialized).not.toContain('bearer-secret');
    expect(serialized).not.toContain('"token"');
  });
});
