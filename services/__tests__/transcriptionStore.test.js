import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  __resetForTests,
  addLocalRecording,
  getRecordings,
  loadRecordings,
  mergeServerJobs,
  patchLocalRecording,
  removeLocalRecording,
  subscribeRecordings,
} from '../transcriptionStore';

// In-memory AsyncStorage — the store's whole reason to exist is that a job
// outlives the screen and the app run, so the tests need storage they can
// re-read the way a cold start would.
const mockStore = new Map();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((k) => Promise.resolve(mockStore.has(k) ? mockStore.get(k) : null)),
  setItem: jest.fn((k, v) => { mockStore.set(k, v); return Promise.resolve(); }),
  removeItem: jest.fn((k) => { mockStore.delete(k); return Promise.resolve(); }),
}));

const STORAGE_KEY = 'turtle:transcriptions:v1';
const stored = () => JSON.parse(mockStore.get(STORAGE_KEY) || '[]');
const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  __resetForTests();
});

describe('transcriptionStore', () => {
  test('a sent recording survives to the next app run as an id and a name', async () => {
    addLocalRecording({ key: 'k1', name: 'Standup', status: 'uploading' });
    patchLocalRecording('k1', { id: 'tr_1', status: 'queued' });
    await flush();

    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({ id: 'tr_1', name: 'Standup', status: 'queued' });

    // Cold start.
    __resetForTests();
    const restored = await loadRecordings();
    expect(restored[0]).toMatchObject({ key: 'k1', id: 'tr_1', status: 'queued' });
  });

  test('never writes a bearer token, whatever it is handed', async () => {
    addLocalRecording({ key: 'k1', name: 'Call', status: 'queued', id: 'tr_1', token: 'ey.secret' });
    await flush();
    expect(mockStore.get(STORAGE_KEY)).not.toContain('secret');
  });

  test('an upload the app died during comes back as a failure, not a spinner', async () => {
    mockStore.set(STORAGE_KEY, JSON.stringify([
      { key: 'k1', name: 'Long one', status: 'uploading', uploadPercent: 40 },
    ]));
    const list = await loadRecordings();
    expect(list[0].status).toBe('failed');
    // …and the decision is written back, so the next launch does not repeat it.
    await flush();
    expect(stored()[0].status).toBe('failed');
  });

  test('unreadable storage is an empty history, not a crash on launch', async () => {
    mockStore.set(STORAGE_KEY, '{ this is not json');
    await expect(loadRecordings()).resolves.toEqual([]);
  });

  test('two hydrations share one read, so they cannot publish different lists', async () => {
    mockStore.set(STORAGE_KEY, JSON.stringify([{ key: 'k1', id: 'tr_1', status: 'queued' }]));
    const [a, b] = await Promise.all([loadRecordings(), loadRecordings()]);
    expect(a).toBe(b);
    expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
  });

  test('subscribers hear the current list immediately and again on every change', () => {
    const seen = [];
    const unsubscribe = subscribeRecordings((list) => seen.push(list.length));
    expect(seen).toEqual([0]);

    addLocalRecording({ key: 'k1', status: 'queued', id: 'tr_1' });
    patchLocalRecording('k1', { status: 'completed' });
    expect(seen).toEqual([0, 1, 1]);

    unsubscribe();
    removeLocalRecording('k1');
    expect(seen).toEqual([0, 1, 1]);
    expect(getRecordings()).toEqual([]);
  });

  test('a patch for a row that is gone changes nothing', () => {
    addLocalRecording({ key: 'k1', status: 'queued', id: 'tr_1' });
    const before = getRecordings();
    patchLocalRecording('vanished', { status: 'failed' });
    expect(getRecordings()).toBe(before);
  });

  test('merging the pond’s list adds only the jobs this phone never sent, newest on top', async () => {
    addLocalRecording({ key: 'local', id: 'tr_1', mediaId: '1', name: 'Mine', status: 'transcribing', uploadPercent: 100 });
    const seen = [];
    subscribeRecordings((list) => seen.push(list.map((r) => r.key)));

    mergeServerJobs([
      { id: 'tr_3', mediaId: '3', originalName: 'newest.m4a', status: 'queued', createdAt: '2026-09-25T12:00:00Z' },
      { id: 'tr_1', mediaId: '1', originalName: 'mine.m4a', status: 'completed', createdAt: '2026-09-25T11:00:00Z' },
      { id: 'tr_2', mediaId: '2', originalName: 'older.m4a', status: 'completed', createdAt: '2026-09-25T10:00:00Z' },
      { id: 'tr_9', originalName: 'camera-roll.mov', status: 'completed', createdAt: '2026-09-25T13:00:00Z' },
    ], { nameFor: (job) => String(job.originalName).replace(/\.\w+$/, '') });

    // tr_1 was this phone's own send and is left exactly as it was (its status
    // is the poller's to move); tr_9 has no media and is not the vault's business.
    expect(getRecordings().map((r) => r.key)).toEqual(['tr_3', 'tr_2', 'local']);
    expect(getRecordings()[0]).toMatchObject({ mediaId: '3', name: 'newest', status: 'queued' });
    expect(getRecordings()[2].status).toBe('transcribing');
    // One publish for the whole merge, and one write.
    expect(seen).toEqual([['local'], ['tr_3', 'tr_2', 'local']]);
    await flush();
    expect(stored().map((r) => r.key)).toEqual(['tr_3', 'tr_2', 'local']);
  });

  test('a merge with nothing new leaves the list identical', () => {
    addLocalRecording({ key: 'local', id: 'tr_1', mediaId: '1', status: 'queued' });
    const before = getRecordings();
    expect(mergeServerJobs([{ id: 'tr_1', mediaId: '1', status: 'completed' }])).toBe(before);
    expect(mergeServerJobs('junk')).toBe(before);
  });
});
