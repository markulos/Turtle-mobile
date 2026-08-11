import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  __resetForTests,
  clearQueue,
  enqueue,
  flushQueue,
  getPending,
  getPendingByKey,
  isPermanentFailure,
  loadQueue,
  sendOrQueue,
} from '../offlineQueue';

// In-memory AsyncStorage — the queue's whole point is that it survives a
// restart, so the tests need a mockStore they can inspect and re-read.
const mockStore = new Map();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((k) => Promise.resolve(mockStore.has(k) ? mockStore.get(k) : null)),
  setItem: jest.fn((k, v) => { mockStore.set(k, v); return Promise.resolve(); }),
  removeItem: jest.fn((k) => { mockStore.delete(k); return Promise.resolve(); }),
}));

const STORAGE_KEY = 'turtle:offlineQueue:v1';
// The shapes ServerContext's api wrapper actually throws.
const networkError = () => new Error('Network request failed');
const httpError = (status) => new Error(`API Error ${status}: nope`);

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  __resetForTests();
});

describe('offlineQueue', () => {
  test('parks a failed write and persists it for the next app run', async () => {
    const api = { patch: jest.fn(() => Promise.reject(networkError())) };

    const res = await sendOrQueue(api, {
      method: 'patch',
      path: '/media/one',
      body: { originalName: 'Night Drive.mp3' },
      key: 'media:one:originalName',
    });

    expect(res.queued).toBe(true);
    expect(JSON.parse(mockStore.get(STORAGE_KEY))).toHaveLength(1);

    // A fresh app run reads it straight back off disk.
    __resetForTests();
    await loadQueue();
    expect(getPendingByKey('media:one:originalName').body).toEqual({
      originalName: 'Night Drive.mp3',
    });
  });

  test('a successful write is not queued', async () => {
    const api = { patch: jest.fn(() => Promise.resolve({ success: true })) };
    const res = await sendOrQueue(api, { method: 'patch', path: '/media/one', body: { a: 1 } });

    expect(res.queued).toBe(false);
    expect(getPending()).toHaveLength(0);
  });

  test('a permanent failure rejects instead of queueing', async () => {
    const api = { patch: jest.fn(() => Promise.reject(httpError(404))) };

    await expect(
      sendOrQueue(api, { method: 'patch', path: '/media/gone', body: { a: 1 } }),
    ).rejects.toThrow('404');
    expect(getPending()).toHaveLength(0);
  });

  test('classifies transport failures as retryable and 4xx as permanent', () => {
    expect(isPermanentFailure(networkError())).toBe(false);
    expect(isPermanentFailure(new Error('GET /x timed out after 20000ms'))).toBe(false);
    expect(isPermanentFailure(httpError(500))).toBe(false);
    expect(isPermanentFailure(httpError(429))).toBe(false);
    expect(isPermanentFailure(httpError(400))).toBe(true);
    expect(isPermanentFailure(httpError(403))).toBe(true);
  });

  test('a keyed re-edit collapses to one request, keeping its queue position', async () => {
    await enqueue({ method: 'put', path: '/media/two/tags', body: { tags: ['A'] } });
    await enqueue({ method: 'patch', path: '/media/one', body: { originalName: 'First take.mp3' }, key: 'media:one:originalName' });
    await enqueue({ method: 'patch', path: '/media/one', body: { originalName: 'Final.mp3' }, key: 'media:one:originalName' });

    const pending = getPending();
    expect(pending).toHaveLength(2);
    // Position held (still second), body replaced by the newest edit.
    expect(pending[1].body).toEqual({ originalName: 'Final.mp3' });
  });

  test('flush replays in order and stops at the first retryable failure', async () => {
    const calls = [];
    const api = {
      patch: jest.fn((path, body) => {
        calls.push(path);
        return path === '/media/two' ? Promise.reject(networkError()) : Promise.resolve({});
      }),
    };
    await enqueue({ method: 'patch', path: '/media/one', body: { n: 1 } });
    await enqueue({ method: 'patch', path: '/media/two', body: { n: 2 } });
    await enqueue({ method: 'patch', path: '/media/three', body: { n: 3 } });

    const res = await flushQueue(api);

    // /media/three must NOT overtake the stalled /media/two.
    expect(calls).toEqual(['/media/one', '/media/two']);
    expect(res).toEqual({ sent: 1, dropped: 0, remaining: 2 });
    expect(getPending()[0].attempts).toBe(1);
  });

  test('flush drops entries the server will never accept and keeps going', async () => {
    const api = {
      patch: jest.fn((path) => (path === '/media/gone'
        ? Promise.reject(httpError(404))
        : Promise.resolve({}))),
    };
    await enqueue({ method: 'patch', path: '/media/gone', body: { n: 1 } });
    await enqueue({ method: 'patch', path: '/media/ok', body: { n: 2 } });

    const res = await flushQueue(api);

    expect(res).toEqual({ sent: 1, dropped: 1, remaining: 0 });
    expect(JSON.parse(mockStore.get(STORAGE_KEY))).toEqual([]);
  });

  test('a drained queue leaves nothing on disk', async () => {
    const api = { patch: jest.fn(() => Promise.resolve({})) };
    await enqueue({ method: 'patch', path: '/media/one', body: { n: 1 } });
    await flushQueue(api);

    expect(getPending()).toHaveLength(0);
    await clearQueue();
    expect(JSON.parse(mockStore.get(STORAGE_KEY))).toEqual([]);
  });

  test('a corrupt outbox on disk is discarded, not thrown', async () => {
    mockStore.set(STORAGE_KEY, '{not json');
    await loadQueue();
    expect(getPending()).toEqual([]);
  });
});
