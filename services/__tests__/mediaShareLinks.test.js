import {
  findLiveShareLink,
  createShareLink,
  waitForPlayable,
  prepareShareLink,
} from '../mediaShareLinks';

/**
 * The rule this module exists to enforce: a video's link must not reach the
 * OS share sheet before the server has an MP4 a chat app can play.
 *
 * That isn't a nicety. iMessage, WhatsApp and the rest fetch a link's preview
 * once and cache the result — so a URL handed out a second too early is a
 * conversation full of previews that never play, and re-sending it doesn't
 * fix them. Everything below is about the waiting.
 */

const share = (over = {}) => ({
  id: 7,
  slug: 'abc123',
  url: 'https://turtle.example.ts.net/m/abc123',
  mediaId: 'vid-1',
  mediaType: 'video',
  playable: false,
  preparing: true,
  prepareProgress: 0,
  prepareFailed: false,
  dead: false,
  reach: 'internet',
  ...over,
});

/** A fake ServerContext api wrapper with a scripted /status sequence. */
function makeApi({ shares = [], created = share(), statuses = [] } = {}) {
  const calls = { get: [], post: [], delete: [] };
  let statusIdx = 0;
  return {
    calls,
    get: jest.fn(async (endpoint) => {
      calls.get.push(endpoint);
      if (endpoint.startsWith('/media-shares?')) return { success: true, shares };
      if (/\/media-shares\/\d+\/status$/.test(endpoint)) {
        const next = statuses[Math.min(statusIdx, statuses.length - 1)];
        statusIdx += 1;
        return { success: true, share: next };
      }
      throw new Error(`unexpected GET ${endpoint}`);
    }),
    post: jest.fn(async (endpoint, body) => {
      calls.post.push({ endpoint, body });
      return { success: true, share: created };
    }),
    delete: jest.fn(async (endpoint) => {
      calls.delete.push(endpoint);
      return { success: true };
    }),
  };
}

// The poll sleeps for over a second between ticks; fake timers keep the suite
// instant without weakening what's being asserted.
beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

/** Run a promise to completion while auto-advancing the fake clock. */
async function settle(promise) {
  const done = promise.then(
    (v) => ({ ok: true, v }),
    (e) => ({ ok: false, e }),
  );
  let finished = false;
  done.then(() => { finished = true; });
  // Interleave: let pending microtasks run, then jump the next timer.
  for (let i = 0; i < 200 && !finished; i += 1) {
    await Promise.resolve();
    jest.advanceTimersByTime(1500);
    await Promise.resolve();
  }
  const res = await done;
  if (!res.ok) throw res.e;
  return res.v;
}

describe('findLiveShareLink', () => {
  test('reuses a live link so one photo does not scatter capabilities', async () => {
    const live = share({ playable: true, preparing: false });
    const api = makeApi({ shares: [live] });
    await expect(findLiveShareLink(api, 'vid-1')).resolves.toEqual(live);
    expect(api.calls.get[0]).toBe('/media-shares?mediaId=vid-1');
  });

  test('ignores revoked and expired links', async () => {
    const api = makeApi({ shares: [share({ dead: true, playable: true })] });
    await expect(findLiveShareLink(api, 'vid-1')).resolves.toBeNull();
  });

  test('url-encodes an id that would otherwise break the query', async () => {
    const api = makeApi();
    await findLiveShareLink(api, 'a b&c');
    expect(api.calls.get[0]).toBe('/media-shares?mediaId=a%20b%26c');
  });
});

describe('createShareLink', () => {
  test('surfaces a server refusal instead of returning a broken share', async () => {
    const api = makeApi();
    api.post = jest.fn(async () => ({ success: false, error: 'media not found' }));
    await expect(createShareLink(api, 'nope')).rejects.toThrow('media not found');
  });

  test('passes only the options that were actually set', async () => {
    const api = makeApi();
    await createShareLink(api, 'vid-1', { expiresInDays: 7 });
    expect(api.calls.post[0].body).toEqual({ mediaId: 'vid-1', expiresInDays: 7 });
  });
});

describe('waitForPlayable', () => {
  test('holds the link back until the server says the MP4 exists', async () => {
    const api = makeApi({
      statuses: [
        share({ prepareProgress: 0.3 }),
        share({ prepareProgress: 0.8 }),
        share({ playable: true, preparing: false, prepareProgress: 1 }),
      ],
    });
    const seen = [];
    const result = await settle(
      waitForPlayable(api, share(), { onProgress: (p) => seen.push(p) }),
    );

    expect(result.playable).toBe(true);
    // Progress was reported on the way, so the overlay isn't a mystery spinner.
    expect(seen).toEqual([0.3, 0.8, 1]);
  });

  test('returns immediately for something already playable', async () => {
    const api = makeApi();
    const result = await settle(waitForPlayable(api, share({ playable: true })));
    expect(result.playable).toBe(true);
    expect(api.get).not.toHaveBeenCalled();
  });

  test('stops on a failed conversion rather than polling forever', async () => {
    const api = makeApi({ statuses: [share({ prepareFailed: true, preparing: false })] });
    const result = await settle(waitForPlayable(api, share()));
    expect(result.prepareFailed).toBe(true);
    expect(result.playable).toBe(false);
  });

  test('a dropped poll is one more tick of waiting, not a failure', async () => {
    // Phones change networks mid-wait; the conversion carries on server-side.
    const api = makeApi({
      statuses: [share({ playable: true, preparing: false })],
    });
    const realGet = api.get;
    let first = true;
    api.get = jest.fn(async (endpoint) => {
      if (first && endpoint.includes('/status')) {
        first = false;
        throw new Error('Network request failed');
      }
      return realGet(endpoint);
    });

    const result = await settle(waitForPlayable(api, share()));
    expect(result.playable).toBe(true);
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  test('a cancelled wait resolves as cancelled and stops polling', async () => {
    const api = makeApi({ statuses: [share(), share(), share()] });
    let cancelled = false;
    const promise = waitForPlayable(api, share(), { isCancelled: () => cancelled });
    // Let one tick happen, then pull the plug.
    await Promise.resolve();
    jest.advanceTimersByTime(1500);
    await Promise.resolve();
    cancelled = true;

    const result = await settle(promise);
    expect(result.cancelled).toBe(true);
    expect(result.playable).toBe(false);
  });
});

describe('prepareShareLink', () => {
  test('a photo is shareable without a single status poll', async () => {
    const photo = share({ mediaType: 'image', playable: true, preparing: false });
    const api = makeApi({ created: photo });
    const result = await settle(prepareShareLink(api, 'img-1'));

    expect(result.playable).toBe(true);
    expect(api.calls.get.filter((e) => e.includes('/status'))).toHaveLength(0);
  });

  test('skips creating when a live, ready link already exists', async () => {
    const live = share({ playable: true, preparing: false });
    const api = makeApi({ shares: [live] });
    const result = await settle(prepareShareLink(api, 'vid-1'));

    expect(result).toEqual(live);
    expect(api.post).not.toHaveBeenCalled();
  });

  test('a live-but-unconverted link is waited on, not duplicated', async () => {
    // The half-finished case: someone tapped share, backed out, tapped again.
    // Minting a second capability for the same video would be one more thing
    // to remember to revoke, for no benefit.
    const pending = share({ playable: false });
    const api = makeApi({
      shares: [pending],
      created: pending,
      statuses: [share({ playable: true, preparing: false })],
    });
    const result = await settle(prepareShareLink(api, 'vid-1'));
    expect(result.playable).toBe(true);
  });

  test('creates when the vault has never shared this item', async () => {
    const api = makeApi({
      shares: [],
      created: share(),
      statuses: [share({ playable: true, preparing: false })],
    });
    const result = await settle(prepareShareLink(api, 'vid-1'));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(result.playable).toBe(true);
  });

  test('a lookup failure still lets the share proceed', async () => {
    // Not being able to LIST existing links is no reason to refuse to make one.
    const api = makeApi({ created: share({ playable: true, preparing: false }) });
    api.get = jest.fn(async () => { throw new Error('offline'); });
    const result = await settle(prepareShareLink(api, 'vid-1'));
    expect(result.playable).toBe(true);
  });
});
