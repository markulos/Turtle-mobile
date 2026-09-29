/**
 * usePondAccess — the one exchange behind BOTH pond-sharing surfaces (a photo
 * board's card and a music track's ⋯ sheet).
 *
 * Testing the hook directly is what keeps the two surfaces honest: the rules
 * that are easy to get subtly wrong (an independent directory read, a roster
 * that comes back from the server rather than being appended to locally, a
 * revoke that reverts) are asserted once here rather than twice in renderers.
 */
import { act, render } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';
import { usePondAccess } from '../usePondAccess';

const BEA = { shareId: 's_bea', userId: 'u_bea', name: 'Bea' };
const CAL = { shareId: 's_cal', userId: 'u_cal', name: 'Cal' };

/**
 * RNTL's renderHook is unusable in this project (see memory: rntl-act-gotchas),
 * so the hook is driven through a probe component that publishes its latest
 * value to a ref.
 */
async function mount(api, opts) {
  const ref = { current: null };
  function Probe() {
    ref.current = usePondAccess(api, opts);
    return <Text>{String(ref.current.loading)}</Text>;
  }
  const view = await render(<Probe />);
  return { ref, view };
}

const directory = {
  success: true,
  friends: [{ id: 'u_bea', name: 'Bea' }, { id: 'u_cal', name: 'Cal' }],
};

const makeApi = (over = {}) => ({
  get: jest.fn(async (path) => (path === '/friends'
    ? directory
    : { success: true, people: [BEA] })),
  post: jest.fn(async () => ({ success: true, people: [BEA, CAL], person: CAL })),
  delete: jest.fn(async () => ({ success: true, removed: true })),
  ...over,
});

const settle = async () => { await act(async () => { await Promise.resolve(); }); };

describe('usePondAccess', () => {
  test('an album asks the album endpoints, a track asks the track ones', async () => {
    const albumApi = makeApi();
    await mount(albumApi, { kind: 'album', id: 'Trip' });
    await settle();
    expect(albumApi.get).toHaveBeenCalledWith('/album-access?album=Trip');

    const trackApi = makeApi();
    await mount(trackApi, { kind: 'track', id: 'm5' });
    await settle();
    expect(trackApi.get).toHaveBeenCalledWith('/track-access?trackId=m5');
  });

  test('ids are encoded, so a name with a slash or a space still reads', async () => {
    const api = makeApi();
    await mount(api, { kind: 'album', id: 'Summer / 24' });
    await settle();
    expect(api.get).toHaveBeenCalledWith('/album-access?album=Summer%20%2F%2024');
  });

  test('addable excludes whoever already holds it', async () => {
    const { ref } = await mount(makeApi(), { kind: 'track', id: 'm5' });
    await settle();
    expect(ref.current.people.map((p) => p.userId)).toEqual(['u_bea']);
    expect(ref.current.addable.map((m) => m.id)).toEqual(['u_cal']);
  });

  test('losing the directory does NOT empty the roster', async () => {
    // "shared with nobody" and "could not list your pond" are different claims
    // and the second must never be told as the first.
    const api = makeApi({
      get: jest.fn(async (path) => {
        if (path === '/friends') throw new Error('offline');
        return { success: true, people: [BEA] };
      }),
    });
    const { ref } = await mount(api, { kind: 'track', id: 'm5' });
    await settle();
    expect(ref.current.people.map((p) => p.userId)).toEqual(['u_bea']);
    expect(ref.current.addable).toEqual([]);
  });

  test('losing the roster reports an error rather than claiming nobody has it', async () => {
    const api = makeApi({
      get: jest.fn(async (path) => {
        if (path === '/friends') return directory;
        throw new Error('nope');
      }),
    });
    const { ref } = await mount(api, { kind: 'track', id: 'm5' });
    await settle();
    expect(ref.current.error).toBeTruthy();
  });

  test('a grant sends the right noun and redraws from the server roster', async () => {
    const api = makeApi();
    const { ref } = await mount(api, { kind: 'track', id: 'm5' });
    await settle();
    await act(async () => { await ref.current.grant({ id: 'u_cal', name: 'Cal' }); });
    expect(api.post).toHaveBeenCalledWith('/track-access', { trackId: 'm5', withUserId: 'u_cal' });
    // Not a locally appended person: the server folds a repeat grant into the
    // existing row, and its id is the one that actually revokes.
    expect(ref.current.people.map((p) => p.shareId)).toEqual(['s_bea', 's_cal']);
  });

  test('an album grant sends `album`, not `trackId`', async () => {
    const api = makeApi();
    const { ref } = await mount(api, { kind: 'album', id: 'Trip' });
    await settle();
    await act(async () => { await ref.current.grant({ id: 'u_cal' }); });
    expect(api.post).toHaveBeenCalledWith('/album-access', { album: 'Trip', withUserId: 'u_cal' });
  });

  test('a failed grant surfaces the server’s words and leaves the roster alone', async () => {
    const api = makeApi({ post: jest.fn(async () => ({ success: false, error: "That track isn't in your library." })) });
    const { ref } = await mount(api, { kind: 'track', id: 'm5' });
    await settle();
    await act(async () => { await ref.current.grant({ id: 'u_cal' }); });
    expect(ref.current.error).toBe("That track isn't in your library.");
    expect(ref.current.people.map((p) => p.userId)).toEqual(['u_bea']);
  });

  test('a revoke deletes by SHARE id and drops the row', async () => {
    const api = makeApi();
    const { ref } = await mount(api, { kind: 'track', id: 'm5' });
    await settle();
    await act(async () => { await ref.current.revoke(BEA); });
    expect(api.delete).toHaveBeenCalledWith('/track-access/s_bea');
    expect(ref.current.people).toEqual([]);
  });

  test('a failed revoke puts the person back', async () => {
    const api = makeApi({ delete: jest.fn(async () => { throw new Error('offline'); }) });
    const { ref } = await mount(api, { kind: 'track', id: 'm5' });
    await settle();
    await act(async () => { await ref.current.revoke(BEA); });
    expect(ref.current.people.map((p) => p.userId)).toEqual(['u_bea']);
    expect(ref.current.error).toBeTruthy();
  });

  test('disabled asks nothing at all', async () => {
    // A shut sheet must not be holding a subscription to the pond directory.
    const api = makeApi();
    await mount(api, { kind: 'track', id: 'm5', enabled: false });
    await settle();
    expect(api.get).not.toHaveBeenCalled();
  });

  test('a missing id asks nothing either', async () => {
    const api = makeApi();
    await mount(api, { kind: 'track', id: undefined });
    await settle();
    expect(api.get).not.toHaveBeenCalled();
  });

  test('onChanged fires after a write, not before', async () => {
    const onChanged = jest.fn();
    const api = makeApi();
    const { ref } = await mount(api, { kind: 'track', id: 'm5', onChanged });
    await settle();
    expect(onChanged).not.toHaveBeenCalled();
    await act(async () => { await ref.current.grant({ id: 'u_cal' }); });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
