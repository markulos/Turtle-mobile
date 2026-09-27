// Cross-device sync: the per-row write paths, and the coalescing refresh.
//
// Three bugs are pinned here, all of them "another device's work disappears":
//   • POST /tasks replaces the caller's WHOLE task list server-side (delete +
//     reinsert), so creating or deleting one task from a stale snapshot silently
//     reverted everything the other device had done since. Create goes to
//     POST /tasks/single and delete to DELETE /tasks/:id — neither touches any
//     other row.
//   • `tasks:changed` is a fire-and-forget ping that never repeats. loadData
//     throttles to MIN_REFRESH_INTERVAL and returns silently when asked too
//     soon, so a ping landing inside that window used to be DROPPED outright —
//     the remote change then stayed invisible for the life of the process.
//     lazyRefresh parks a trailing call instead.
import { renderHook, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useTaskData } from '../useTaskData';
import { __resetForTests, getPending } from '../../../../services/offlineQueue';

const mockStore = new Map();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((k) => Promise.resolve(mockStore.has(k) ? mockStore.get(k) : null)),
  setItem: jest.fn((k, v) => { mockStore.set(k, v); return Promise.resolve(); }),
  removeItem: jest.fn((k) => { mockStore.delete(k); return Promise.resolve(); }),
}));
jest.mock('../../../../context/ServerContext', () => ({ getApiAuthToken: () => 'tok' }));

const networkError = () => new Error('Network request failed');
const httpError = (status) => new Error(`API Error ${status}: nope`);

const makeApi = (over = {}) => ({
  get: jest.fn(async (path) => {
    if (path === '/tasks') return [{ id: 't1', title: 'one', completed: false }];
    if (path === '/projects') return [];
    if (path === '/tags') return [];
    return [];
  }),
  post: jest.fn(async () => ({ success: true })),
  patch: jest.fn(async () => ({ success: true })),
  delete: jest.fn(async () => ({ success: true })),
  ...over,
});

beforeEach(() => {
  mockStore.clear();
  __resetForTests();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const mount = async (api) => {
  const hook = await renderHook(() => useTaskData(api, true, null));
  await flush();
  return hook;
};
const pathsPosted = (api) => api.post.mock.calls.map((c) => c[0]);

describe('createTask — one row, never the list', () => {
  test('posts /tasks/single and takes the server row as truth', async () => {
    const api = makeApi({
      post: jest.fn(async (path, body) => ({
        success: true,
        // The server applies the account's default participants; the draft has
        // none, so the answer is genuinely different from what we sent.
        task: { ...body, involvedUsers: ['u9'] },
      })),
    });
    const { result } = await mount(api);

    await act(async () => { await result.current.createTask({ id: 't2', title: 'two' }); });

    expect(pathsPosted(api)).toEqual(['/tasks/single']);
    expect(pathsPosted(api)).not.toContain('/tasks');   // the list-wipe path
    expect(result.current.tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(result.current.tasks[1]).toMatchObject({ involvedUsers: ['u9'], subtasks: [] });
  });

  test('offline: the draft stands and the write is parked PER TASK', async () => {
    const api = makeApi({ post: jest.fn(() => Promise.reject(networkError())) });
    const { result } = await mount(api);

    await act(async () => { await result.current.createTask({ id: 't2', title: 'two' }); });

    expect(result.current.tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(Alert.alert).not.toHaveBeenCalled();
    const pending = getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ method: 'post', path: '/tasks/single', key: 'task:t2:create' });

    // Two offline creates must BOTH survive — a list snapshot could only ever
    // have carried the last one.
    await act(async () => { await result.current.createTask({ id: 't3', title: 'three' }); });
    expect(getPending().map((e) => e.key)).toEqual(['task:t2:create', 'task:t3:create']);
  });

  test('permanent 4xx: the row leaves the screen again and says so', async () => {
    const api = makeApi({ post: jest.fn(() => Promise.reject(httpError(400))) });
    const { result } = await mount(api);

    await act(async () => {
      await expect(result.current.createTask({ id: 't2', title: 'two' })).rejects.toBeTruthy();
    });

    expect(result.current.tasks.map((t) => t.id)).toEqual(['t1']);
    expect(Alert.alert).toHaveBeenCalled();
    expect(getPending()).toHaveLength(0);
  });
});

describe('deleteTask — one row, never the list', () => {
  test('calls DELETE /tasks/:id and posts nothing at all', async () => {
    const api = makeApi();
    const { result } = await mount(api);

    await act(async () => { await result.current.deleteTask('t1'); });

    expect(api.delete).toHaveBeenCalledWith('/tasks/t1');
    expect(api.post).not.toHaveBeenCalled();
    expect(result.current.tasks).toEqual([]);
  });

  test('a 404 means it is ALREADY gone — the row stays gone, silently', async () => {
    // Deleted on another device, or this delete replayed out of the outbox.
    // Putting the row back so the next refetch can remove it again is a lie.
    const api = makeApi({ delete: jest.fn(() => Promise.reject(httpError(404))) });
    const { result } = await mount(api);

    let ok;
    await act(async () => { ok = await result.current.deleteTask('t1'); });

    expect(ok).toBe(true);
    expect(result.current.tasks).toEqual([]);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  test('offline: parked under its own key, the row stays gone', async () => {
    const api = makeApi({ delete: jest.fn(() => Promise.reject(networkError())) });
    const { result } = await mount(api);

    await act(async () => { await result.current.deleteTask('t1'); });

    expect(result.current.tasks).toEqual([]);
    expect(getPending()[0]).toMatchObject({ method: 'delete', path: '/tasks/t1', key: 'task:t1:delete' });
  });

  test('a real failure puts the row back and says so', async () => {
    const api = makeApi({ delete: jest.fn(() => Promise.reject(httpError(403))) });
    const { result } = await mount(api);

    let ok;
    await act(async () => { ok = await result.current.deleteTask('t1'); });

    expect(ok).toBe(false);
    expect(result.current.tasks.map((t) => t.id)).toEqual(['t1']);
    expect(Alert.alert).toHaveBeenCalled();
  });
});

describe('lazyRefresh — a socket ping is never dropped', () => {
  const taskGets = (api) => api.get.mock.calls.filter((c) => c[0] === '/tasks').length;

  test('a ping inside the throttle window is PARKED, then lands exactly once', async () => {
    const api = makeApi();
    const { result } = await mount(api);
    expect(taskGets(api)).toBe(1); // the mount load, which also arms the throttle

    // A burst — the server pings per write, so several arrive together.
    await act(async () => {
      result.current.lazyRefresh();
      result.current.lazyRefresh();
      result.current.lazyRefresh();
    });
    // Throttled: nothing extra yet, and nothing lost either.
    expect(taskGets(api)).toBe(1);

    // MIN_REFRESH_INTERVAL is 2 s; the trailing call fires just past it.
    await act(async () => { await new Promise((r) => setTimeout(r, 2400)); });
    expect(taskGets(api)).toBe(2);
  }, 20000);

  test('once the window is open it refetches straight away', async () => {
    const api = makeApi();
    const { result } = await mount(api);
    await act(async () => { await new Promise((r) => setTimeout(r, 2100)); });

    await act(async () => { await result.current.lazyRefresh(); });
    expect(taskGets(api)).toBe(2);
  }, 20000);
});
