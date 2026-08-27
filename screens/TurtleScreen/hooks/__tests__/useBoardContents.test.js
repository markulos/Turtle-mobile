import { act, renderHook, waitFor } from '@testing-library/react-native';

/**
 * useBoardContents — one group of one board's items, fetched when it opens.
 *
 * These exist for one class of bug, and it is the class that hurts: a request
 * that goes out and whose answer is then thrown away, while its key stays
 * claimed. The group shows "Loading…" for the rest of the visit and nothing
 * short of closing and re-opening it will ever ask again.
 *
 * The two ways in are (1) a second group opening while the first is in flight,
 * which changes the effect's dependencies, and (2) an invalidate, which drops
 * the cache but changes nothing the fetch effect watches.
 */

const mockGet = jest.fn();
let mockApi = { get: mockGet };
jest.mock('../../../../context/ServerContext', () => ({
  useServer: () => ({ api: mockApi }),
}));

// eslint-disable-next-line import/first
import useBoardContents from '../useBoardContents';

/** A deferred response, so a request can be left hanging on purpose. */
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const items = (n, kind) => Array.from({ length: n }, (_, i) => ({
  kind, id: `${kind}-${i}`, ts: i, title: `${kind} ${i}`,
}));
const ok = (rows) => ({ success: true, items: rows });

beforeEach(() => {
  mockGet.mockReset();
  mockApi = { get: mockGet };
});

describe('useBoardContents', () => {
  it('asks for one kind at a time, and only once per group', async () => {
    mockGet.mockResolvedValue(ok(items(2, 'task')));
    const { result, rerender } = await renderHook(({ keys }) => useBoardContents(keys), {
      initialProps: { keys: ['Work/task'] },
    });

    await waitFor(() => expect(result.current.itemsOf('Work', 'task')).toHaveLength(2));
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet.mock.calls[0][0]).toContain('kind=task');
    expect(mockGet.mock.calls[0][0]).toContain('/projects/Work/timeline');

    // Re-rendering with the same open groups must not re-ask.
    await rerender({ keys: ['Work/task'] });
    await act(async () => {});
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  // THE regression. Opening a second group re-runs the fetch effect; a per-run
  // "am I still the live run?" flag would drop the first group's answer, and its
  // key is already claimed, so it would never be asked for again.
  it('still fills the first group when a second opens while it is loading', async () => {
    const first = deferred();
    const second = deferred();
    mockGet.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);

    const { result, rerender } = await renderHook(({ keys }) => useBoardContents(keys), {
      initialProps: { keys: ['Home/media'] },
    });
    await act(async () => {});

    // A second group opens before the first has answered.
    await rerender({ keys: ['Home/media', 'Home/task'] });
    await act(async () => {});
    expect(mockGet).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve(ok(items(1, 'task')));
      first.resolve(ok(items(3, 'media')));
    });

    await waitFor(() => expect(result.current.itemsOf('Home', 'media')).toHaveLength(3));
    expect(result.current.itemsOf('Home', 'task')).toHaveLength(1);
  });

  it('keeps a group filled when another one closes', async () => {
    mockGet.mockResolvedValue(ok(items(2, 'media')));
    const { result, rerender } = await renderHook(({ keys }) => useBoardContents(keys), {
      initialProps: { keys: ['Home/media', 'Home/task'] },
    });
    await waitFor(() => expect(result.current.itemsOf('Home', 'media')).toHaveLength(2));

    await rerender({ keys: ['Home/media'] });
    await act(async () => {});
    expect(result.current.itemsOf('Home', 'media')).toHaveLength(2);
  });

  it('reports "there is more" without needing a second call', async () => {
    // One past the cap is what the request asks for, and all it means.
    mockGet.mockResolvedValue(ok(items(13, 'media')));
    const { result } = await renderHook(() => useBoardContents(['Home/media']));

    await waitFor(() => expect(result.current.moreOf('Home', 'media')).toBe(1));
    expect(result.current.itemsOf('Home', 'media')).toHaveLength(12);
  });

  it('reports no more when the group fits', async () => {
    mockGet.mockResolvedValue(ok(items(4, 'media')));
    const { result } = await renderHook(() => useBoardContents(['Home/media']));

    await waitFor(() => expect(result.current.itemsOf('Home', 'media')).toHaveLength(4));
    expect(result.current.moreOf('Home', 'media')).toBe(0);
  });

  it('leaves a board it was never asked about alone', async () => {
    mockGet.mockResolvedValue(ok(items(2, 'task')));
    const { result } = await renderHook(() => useBoardContents(['Work/task']));
    await waitFor(() => expect(result.current.itemsOf('Work', 'task')).toHaveLength(2));
    expect(result.current.itemsOf('Home', 'task')).toEqual([]);
    expect(result.current.moreOf('Home', 'task')).toBe(0);
  });

  // The second way a group can be stranded: dropping the cache changes nothing
  // the fetch effect watches, so an OPEN group would empty and stay empty.
  it('re-reads an invalidated board that is still open', async () => {
    mockGet.mockResolvedValue(ok(items(2, 'task')));
    const { result } = await renderHook(() => useBoardContents(['Work/task']));
    await waitFor(() => expect(result.current.itemsOf('Work', 'task')).toHaveLength(2));

    mockGet.mockResolvedValue(ok(items(5, 'task')));
    await act(async () => { result.current.invalidate('Work'); });

    await waitFor(() => expect(result.current.itemsOf('Work', 'task')).toHaveLength(5));
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('invalidates only the board it was given', async () => {
    mockGet.mockResolvedValue(ok(items(2, 'task')));
    const { result } = await renderHook(() => useBoardContents(['Work/task', 'Home/task']));
    await waitFor(() => expect(result.current.itemsOf('Home', 'task')).toHaveLength(2));
    expect(mockGet).toHaveBeenCalledTimes(2);

    await act(async () => { result.current.invalidate('Work'); });
    await act(async () => {});

    // Work re-read; Home untouched.
    expect(mockGet).toHaveBeenCalledTimes(3);
    expect(mockGet.mock.calls[2][0]).toContain('/projects/Work/timeline');
  });

  it('re-reads everything when invalidated wholesale', async () => {
    mockGet.mockResolvedValue(ok(items(1, 'task')));
    const { result } = await renderHook(() => useBoardContents(['Work/task', 'Home/task']));
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));

    await act(async () => { result.current.invalidate(); });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(4));
  });

  it('opens a group empty when the server cannot answer, and retries next time', async () => {
    mockGet.mockRejectedValueOnce(new Error('offline'));
    const { result, rerender } = await renderHook(({ keys }) => useBoardContents(keys), {
      initialProps: { keys: ['Home/media'] },
    });
    await waitFor(() => expect(result.current.itemsOf('Home', 'media')).toEqual([]));

    // Closing and re-opening the group asks again — a failure must not claim
    // the key forever.
    mockGet.mockResolvedValue(ok(items(2, 'media')));
    await rerender({ keys: [] });
    await act(async () => {});
    await rerender({ keys: ['Home/media'] });
    await waitFor(() => expect(result.current.itemsOf('Home', 'media')).toHaveLength(2));
  });

  it('drops an answer that arrives after the server changed', async () => {
    const slow = deferred();
    mockGet.mockImplementationOnce(() => slow.promise);
    const { result, rerender } = await renderHook(({ keys }) => useBoardContents(keys), {
      initialProps: { keys: ['Home/media'] },
    });
    await act(async () => {});

    // A different pond. Same board names, different boards.
    mockApi = { get: mockGet.mockResolvedValue(ok(items(1, 'media'))) };
    await rerender({ keys: ['Home/media'] });
    await act(async () => {});

    await act(async () => { slow.resolve(ok(items(9, 'media'))); });
    // The nine belong to the old server and must not appear under the new one.
    expect(result.current.itemsOf('Home', 'media')).not.toHaveLength(9);
  });

  it('survives being given nothing', async () => {
    const { result } = await renderHook(() => useBoardContents(undefined));
    await act(async () => {});
    expect(mockGet).not.toHaveBeenCalled();
    expect(result.current.itemsOf('Home', 'task')).toEqual([]);
  });

  // A board name may contain a slash — `moodboard/wedding` is a real shape in
  // this app — so the kind is the last segment, not the second.
  it('splits a board name that contains a slash correctly', async () => {
    mockGet.mockResolvedValue(ok(items(1, 'note')));
    const { result } = await renderHook(() => useBoardContents(['moodboard/wedding/note']));
    await waitFor(() => expect(result.current.itemsOf('moodboard/wedding', 'note')).toHaveLength(1));
    expect(mockGet.mock.calls[0][0]).toContain('/projects/moodboard%2Fwedding/timeline');
    expect(mockGet.mock.calls[0][0]).toContain('kind=note');
  });
});
