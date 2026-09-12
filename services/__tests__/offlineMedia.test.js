/**
 * The offline store: names, totals, index arithmetic, the tolerance of a parse
 * that reads whatever a previous version wrote — and the two filesystem
 * behaviours that actually bite (a 4xx written to disk as if it were a photo,
 * and an index outliving the files it names).
 */
const mockStore = new Map();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((k) => Promise.resolve(mockStore.has(k) ? mockStore.get(k) : null)),
  setItem: jest.fn((k, v) => { mockStore.set(k, v); return Promise.resolve(); }),
  removeItem: jest.fn((k) => { mockStore.delete(k); return Promise.resolve(); }),
}));

// A toy filesystem: uri → bytes. `downloadAsync` writes whatever the fake
// server hands back, status and all, exactly as the real one does.
const mockFs = new Map();
const mockServer = { status: 200, size: 1234 };
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn((uri) => Promise.resolve(
    mockFs.has(uri) ? { exists: true, size: mockFs.get(uri), isDirectory: false } : { exists: false },
  )),
  makeDirectoryAsync: jest.fn((uri) => { mockFs.set(uri, 0); return Promise.resolve(); }),
  deleteAsync: jest.fn((uri) => { mockFs.delete(uri); return Promise.resolve(); }),
  downloadAsync: jest.fn((_url, dest) => {
    mockFs.set(dest, mockServer.size);
    return Promise.resolve({ uri: dest, status: mockServer.status });
  }),
}));

import {
  INDEX_KEY, offlineDir, offlineFileName, parseIndex, withEntry, withoutId,
  totalBytes, savedCount, uriForName, saveMedia, reconcile, loadIndex,
  writeIndex, clearAllOffline, removeMedia,
} from '../offlineMedia';

beforeEach(() => {
  mockStore.clear();
  mockFs.clear();
  mockServer.status = 200;
  mockServer.size = 1234;
});

describe('offlineFileName', () => {
  test('id first, then a sanitised stem, and always the real extension', () => {
    expect(offlineFileName('m1', 'IMG_0001.HEIC')).toBe('m1__IMG_0001.jpg');
    expect(offlineFileName('m1', 'holiday photo (2).png')).toBe('m1__holiday_photo__2.jpg');
  });

  test('no filename still produces something openable', () => {
    expect(offlineFileName('m2', null)).toBe('m2__photo.jpg');
    expect(offlineFileName('m2', '')).toBe('m2__photo.jpg');
    // A name that sanitises away to punctuation must not leave a stem of
    // underscores (or, worse, a bare dot-file).
    expect(offlineFileName('m2', '///')).toBe('m2__photo.jpg');
    expect(offlineFileName('m2', '...')).toBe('m2__photo.jpg');
  });

  test('separators and dots in either half cannot escape the directory', () => {
    const name = offlineFileName('../../etc', '../../passwd');
    expect(name).toBe('______etc__photo.jpg');
    expect(name).not.toContain('/');
    // Exactly one dot: the extension's.
    expect(name.split('.')).toHaveLength(2);
  });

  test('a very long original name is cut, not carried', () => {
    const name = offlineFileName('m3', 'x'.repeat(200));
    expect(name.length).toBeLessThan(70);
    expect(name.endsWith('.jpg')).toBe(true);
  });
});

describe('parseIndex', () => {
  test('reads a written index back', () => {
    const raw = JSON.stringify({ m1: { id: 'm1', name: 'm1__a.jpg', bytes: 10 } });
    expect(parseIndex(raw)).toEqual({ m1: { id: 'm1', name: 'm1__a.jpg', bytes: 10 } });
  });

  test('nothing, junk, or the wrong shape all read as empty rather than throwing', () => {
    expect(parseIndex(null)).toEqual({});
    expect(parseIndex('')).toEqual({});
    expect(parseIndex('not json')).toEqual({});
    expect(parseIndex('[1,2]')).toEqual({});
    expect(parseIndex('"a string"')).toEqual({});
  });

  test('an entry with no file name is dropped — it cannot name a file', () => {
    const raw = JSON.stringify({ m1: { id: 'm1' }, m2: { id: 'm2', name: 'm2__b.jpg' }, m3: null });
    expect(Object.keys(parseIndex(raw))).toEqual(['m2']);
  });
});

describe('index arithmetic', () => {
  const a = { id: 'm1', name: 'm1__a.jpg', bytes: 100 };
  const b = { id: 'm2', name: 'm2__b.jpg', bytes: 250 };

  test('withEntry adds without mutating, and replaces by id', () => {
    const one = withEntry({}, a);
    const two = withEntry(one, b);
    expect(Object.keys(one)).toEqual(['m1']);
    expect(savedCount(two)).toBe(2);
    const replaced = withEntry(two, { ...a, bytes: 400 });
    expect(savedCount(replaced)).toBe(2);
    expect(replaced.m1.bytes).toBe(400);
  });

  test('withoutId removes without mutating', () => {
    const two = withEntry(withEntry({}, a), b);
    const one = withoutId(two, 'm1');
    expect(Object.keys(one)).toEqual(['m2']);
    expect(savedCount(two)).toBe(2);
    expect(withoutId(one, 'nope')).toEqual(one);
  });

  test('totalBytes sums, and a sizeless entry counts as zero rather than NaN', () => {
    expect(totalBytes({})).toBe(0);
    expect(totalBytes(withEntry(withEntry({}, a), b))).toBe(350);
    expect(totalBytes({ m1: { id: 'm1', name: 'x' } })).toBe(0);
    expect(totalBytes(null)).toBe(0);
  });
});

describe('saving', () => {
  test('a saved picture lands under documentDirectory, never the cache', async () => {
    const entry = await saveMedia({ id: 'm1', url: 'https://pond/api/media/display/m1', filename: 'IMG_1.HEIC' });
    expect(entry).toMatchObject({ id: 'm1', name: 'm1__IMG_1.jpg', bytes: 1234, type: 'image' });
    const uri = uriForName(entry.name);
    expect(uri).toBe('file:///docs/offline-media/m1__IMG_1.jpg');
    expect(uri.startsWith(offlineDir())).toBe(true);
    expect(mockFs.has(uri)).toBe(true);
  });

  test('an error response is deleted, not kept as a picture', async () => {
    mockServer.status = 404;
    await expect(saveMedia({ id: 'm1', url: 'https://pond/nope' })).rejects.toThrow(/404/);
    expect(mockFs.has('file:///docs/offline-media/m1__photo.jpg')).toBe(false);
  });

  test('no id or no url is a caller bug, and says so', async () => {
    await expect(saveMedia({ url: 'https://pond/x' })).rejects.toThrow(/needs an id and a url/);
    await expect(saveMedia({ id: 'm1' })).rejects.toThrow(/needs an id and a url/);
  });

  test('removeMedia deletes the file; a nameless entry is a no-op', async () => {
    const entry = await saveMedia({ id: 'm1', url: 'https://pond/x' });
    await removeMedia(entry);
    expect(mockFs.has(uriForName(entry.name))).toBe(false);
    await expect(removeMedia(null)).resolves.toBeUndefined();
  });
});

describe('reconcile', () => {
  test('keeps what exists, drops what does not, and rewrites the index only then', async () => {
    const present = await saveMedia({ id: 'm1', url: 'https://pond/x' });
    const index = withEntry(withEntry({}, present), { id: 'm2', name: 'm2__gone.jpg', bytes: 99 });
    await writeIndex(index);

    const alive = await reconcile(index);
    expect(Object.keys(alive)).toEqual(['m1']);
    // ...and the shrunken index was persisted, so the next launch is already right.
    expect(Object.keys(parseIndex(mockStore.get(INDEX_KEY)))).toEqual(['m1']);
  });

  test('an all-present index is not rewritten on a cold start', async () => {
    const entry = await saveMedia({ id: 'm1', url: 'https://pond/x' });
    const index = withEntry({}, entry);
    mockStore.clear(); // nothing written yet
    await reconcile(index);
    expect(mockStore.has(INDEX_KEY)).toBe(false);
  });

  test('sizes are refreshed from disk, so a truncated file stops overstating', async () => {
    const entry = await saveMedia({ id: 'm1', url: 'https://pond/x' });
    mockFs.set(uriForName(entry.name), 7);
    const alive = await reconcile(withEntry({}, entry));
    expect(alive.m1.bytes).toBe(7);
  });

  test('an empty index short-circuits', async () => {
    await expect(reconcile({})).resolves.toEqual({});
    await expect(reconcile(null)).resolves.toEqual({});
  });
});

describe('the index round-trips', () => {
  test('write then load gives back what was saved', async () => {
    const entry = await saveMedia({ id: 'm1', url: 'https://pond/x', filename: 'a.jpg' });
    await writeIndex(withEntry({}, entry));
    expect(await loadIndex()).toEqual({ m1: entry });
  });

  test('clearAllOffline empties both the directory and the index', async () => {
    const entry = await saveMedia({ id: 'm1', url: 'https://pond/x' });
    await writeIndex(withEntry({}, entry));
    await clearAllOffline();
    expect(await loadIndex()).toEqual({});
    expect(mockFs.has(offlineDir())).toBe(false);
  });
});
