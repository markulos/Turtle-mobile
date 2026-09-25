/**
 * systemFilePick — the OS file browser behind the folder ⋯ menu's
 * "Add from phone storage".
 *
 * The module caches its lazy require in module state, so every test resets the
 * registry and re-imports rather than sharing one instance; `mockPicker` is
 * named for babel-plugin-jest-hoist's "mock*" rule, same convention as the
 * other tests in this folder.
 */
const mockGetDocumentAsync = jest.fn();
// Picked files are COPIED somewhere the OS will not reclaim before they are
// handed to the upload queue — see stagePickedFiles. Mocked explicitly so the
// staged paths in the assertions below are deterministic.
const mockCopyAsync = jest.fn(() => Promise.resolve());
const mockMakeDirectoryAsync = jest.fn(() => Promise.resolve());
const mockReadDirectoryAsync = jest.fn(() => Promise.resolve([]));
const mockDeleteAsync = jest.fn(() => Promise.resolve());
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  copyAsync: (...a) => mockCopyAsync(...a),
  makeDirectoryAsync: (...a) => mockMakeDirectoryAsync(...a),
  readDirectoryAsync: (...a) => mockReadDirectoryAsync(...a),
  deleteAsync: (...a) => mockDeleteAsync(...a),
}));

jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...a) => mockGetDocumentAsync(...a) }), { virtual: true });

const load = () => require('../systemFilePick');

beforeEach(() => {
  jest.resetModules();
  mockGetDocumentAsync.mockReset();
  mockCopyAsync.mockReset().mockResolvedValue(undefined);
  mockMakeDirectoryAsync.mockReset().mockResolvedValue(undefined);
  mockReadDirectoryAsync.mockReset().mockResolvedValue([]);
  mockDeleteAsync.mockReset().mockResolvedValue(undefined);
});

describe('pickSystemFiles', () => {
  it('maps picked assets into the {path, fileName, mimeType} shape enqueueFileShare stages', async () => {
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file:///cache/lease.pdf', name: 'lease.pdf', mimeType: 'application/pdf', size: 10 },
        { uri: 'file:///cache/shot.jpg', name: 'shot.jpg', mimeType: 'image/jpeg', size: 20 },
      ],
    });

    const { pickSystemFiles } = load();
    const result = await pickSystemFiles();

    expect(result.status).toBe('picked');
    expect(result.files.map((f) => [f.fileName, f.mimeType, f.staged])).toEqual([
      ['lease.pdf', 'application/pdf', true],
      ['shot.jpg', 'image/jpeg', true],
    ]);
    // Every entry points at the durable COPY, not the picker's cache path.
    for (const f of result.files) expect(f.path).toMatch(/^file:\/\/\/docs\/picked-files\//);
    expect(mockCopyAsync).toHaveBeenCalledTimes(2);
    expect(mockCopyAsync.mock.calls[0][0].from).toBe('file:///cache/lease.pdf');
    expect(result.skipped).toEqual([]);
    // copyToCacheDirectory is load-bearing: without it iOS returns a
    // security-scoped URL that dies with the picker, before staging copies it.
    // base64:false is too — the library defaults it to TRUE, which would slurp
    // every picked file into memory as a string the uploader never reads.
    expect(mockGetDocumentAsync).toHaveBeenCalledWith(
      expect.objectContaining({ multiple: true, copyToCacheDirectory: true, base64: false, type: '*/*' })
    );
  });

  it('reports what it dropped instead of losing it silently', async () => {
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file:///cache/lease.pdf', name: 'lease.pdf', mimeType: 'application/pdf' },
        { uri: 'file:///cache/song.mp3', name: 'song.mp3', mimeType: 'audio/mpeg' },
        { uri: 'file:///cache/tool.exe', name: 'tool.exe' },
      ],
    });

    const { pickSystemFiles } = load();
    const result = await pickSystemFiles();

    expect(result.status).toBe('picked');
    expect(result.files.map((f) => f.fileName)).toEqual(['lease.pdf']);
    expect(result.skipped).toEqual([
      { fileName: 'song.mp3', kind: 'audio' },
      { fileName: 'tool.exe', kind: 'unsupported' },
    ]);
  });

  it('falls back to the URI tail and an empty mime so extension typing still works', async () => {
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/notes.docx?v=2' }],
    });

    const { pickSystemFiles } = load();
    const result = await pickSystemFiles();

    expect(result.status).toBe('picked');
    expect(result.files).toHaveLength(1);
    expect(result.files[0].fileName).toBe('notes.docx');
    expect(result.files[0].mimeType).toBe('');
    expect(mockCopyAsync.mock.calls[0][0].from).toBe('file:///cache/notes.docx?v=2');
  });

  it('separates "backed out" from "chose nothing we can file"', async () => {
    const { pickSystemFiles } = load();

    mockGetDocumentAsync.mockResolvedValueOnce({ canceled: true });
    expect(await pickSystemFiles()).toEqual({ status: 'canceled', files: [], skipped: [] });

    mockGetDocumentAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///cache/song.mp3', name: 'song.mp3', mimeType: 'audio/mpeg' }] });
    const empty = await pickSystemFiles();
    expect(empty.status).toBe('empty');
    expect(empty.skipped).toEqual([{ fileName: 'song.mp3', kind: 'audio' }]);
  });

  // A file that could not be copied is still worth trying to upload from where
  // it is — it may well outlive the session.
  it('keeps the original path when staging the copy fails', async () => {
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/lease.pdf', name: 'lease.pdf', mimeType: 'application/pdf' }],
    });
    mockCopyAsync.mockRejectedValueOnce(new Error('No space left on device'));

    const { pickSystemFiles } = load();
    const result = await pickSystemFiles();

    expect(result.status).toBe('picked');
    expect(result.files[0].path).toBe('file:///cache/lease.pdf');
    expect(result.files[0].staged).toBe(false);
  });

  // The uploader does not own the staged copies, so nothing deletes them on
  // success. An age sweep is what stops the directory growing forever.
  it('sweeps staged files older than the TTL on each pick', async () => {
    const old = `${Date.now() - 30 * 24 * 60 * 60 * 1000}-0-ancient.pdf`;
    const fresh = `${Date.now()}-0-today.pdf`;
    mockReadDirectoryAsync.mockResolvedValue([old, fresh]);
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/lease.pdf', name: 'lease.pdf', mimeType: 'application/pdf' }],
    });

    const { pickSystemFiles } = load();
    await pickSystemFiles();
    await new Promise((r) => setImmediate(r));

    const deleted = mockDeleteAsync.mock.calls.map(([uri]) => uri);
    expect(deleted.some((u) => u.endsWith(old))).toBe(true);
    expect(deleted.some((u) => u.endsWith(fresh))).toBe(false);
  });

  // The whole reason the require is lazy: an OTA update can land on a binary
  // built before expo-document-picker was added, where requiring it throws.
  // That must degrade to a sentence, not take the runtime down.
  it('reports unavailable rather than throwing when the native module is missing', async () => {
    jest.resetModules();
    jest.doMock('expo-document-picker', () => { throw new Error('Cannot find native module'); }, { virtual: true });

    const { pickSystemFiles } = require('../systemFilePick');
    await expect(pickSystemFiles()).resolves.toEqual({ status: 'unavailable', files: [], skipped: [] });

    jest.dontMock('expo-document-picker');
  });
});
