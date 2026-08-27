import {
  findLiveShareLink,
  createShareLink,
  waitForPlayable,
  prepareShareLink,
  loadShareExposure,
  revokeExposureLink,
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

/**
 * Exposure — "who can currently see this photo?"
 *
 * The only dangerous direction is under-reporting. A link missing from this
 * answer is a link the owner does not know exists and therefore cannot turn
 * off, so every case below is about not losing one.
 */
describe('loadShareExposure', () => {
  const directShare = (over = {}) => ({
    id: 1, slug: 'd1', url: 'https://s.t3d.ca/m/d1', viewCount: 3,
    createdAt: 2000, dead: false, ...over,
  });
  const albumShare = (over = {}) => ({
    id: 9, slug: 'a1', url: 'https://s.t3d.ca/s/a1', album: 'Wedding',
    hasPassword: false, viewCount: 12, createdAt: 1000, revokedAt: null,
    expiresAt: null, ...over,
  });

  /** api wrapper serving each router's list independently. */
  function exposureApi({ direct = [], albums = [], failDirect, failAlbums, unfiltered } = {}) {
    const asked = [];
    return {
      asked,
      get: jest.fn(async (endpoint) => {
        asked.push(endpoint);
        if (endpoint.startsWith('/media-shares?')) {
          if (failDirect) throw new Error('offline');
          return { success: true, shares: direct };
        }
        if (endpoint.startsWith('/album-shares?')) {
          if (failAlbums) throw new Error('offline');
          return { success: true, filteredBy: unfiltered ? null : 'mediaId', shares: albums };
        }
        throw new Error(`unexpected GET ${endpoint}`);
      }),
    };
  }

  test('asks BOTH routers — a photo is exposed by two different things', async () => {
    const api = exposureApi();
    await loadShareExposure(api, 'p1');
    expect(api.asked.some((e) => e.startsWith('/media-shares?'))).toBe(true);
    expect(api.asked.some((e) => e.startsWith('/album-shares?'))).toBe(true);
  });

  test('merges both kinds, newest first', async () => {
    const api = exposureApi({ direct: [directShare()], albums: [albumShare()] });
    const { links, liveCount } = await loadShareExposure(api, 'p1');
    expect(links.map((l) => l.kind)).toEqual(['direct', 'album']); // 2000 > 1000
    expect(liveCount).toBe(2);
    expect(links[1].album).toBe('Wedding');
  });

  test('an album link with no `dead` flag is still judged dead when revoked', async () => {
    // The two routers disagree on shape: media shares send `dead`, album
    // shares send the raw timestamps. Trusting `dead` alone would show a
    // revoked album link as live.
    const api = exposureApi({ albums: [albumShare({ revokedAt: 123 })] });
    const { links, liveCount } = await loadShareExposure(api, 'p1');
    expect(links[0].dead).toBe(true);
    expect(liveCount).toBe(0);
  });

  test('an expired album link counts as dead', async () => {
    const api = exposureApi({ albums: [albumShare({ expiresAt: Date.now() - 1000 })] });
    const { liveCount } = await loadShareExposure(api, 'p1');
    expect(liveCount).toBe(0);
  });

  test('a dead link is still LISTED — the owner may want the history', async () => {
    const api = exposureApi({ direct: [directShare({ dead: true })] });
    const { links, liveCount } = await loadShareExposure(api, 'p1');
    expect(links).toHaveLength(1);
    expect(liveCount).toBe(0);
  });

  test('one router failing does not claim the photo is unshared', async () => {
    // The under-report that matters: swallowing the error and returning an
    // empty list would render the viewer's badge as "not shared".
    const api = exposureApi({ albums: [albumShare()], failDirect: true });
    const { links, liveCount, errors } = await loadShareExposure(api, 'p1');
    expect(liveCount).toBe(1);
    expect(links[0].kind).toBe('album');
    expect(errors).toContain('direct');
  });

  test('both failing reports both, rather than throwing', async () => {
    const api = exposureApi({ failDirect: true, failAlbums: true });
    const { links, errors } = await loadShareExposure(api, 'p1');
    expect(links).toEqual([]);
    expect(errors.sort()).toEqual(['album', 'direct']);
  });


  test('an unfiltered answer is refused, not displayed as this photo’s links', async () => {
    // The bug this exists to stop: a server too old to understand ?mediaId=
    // ignored it and returned EVERY album link the user owns, which this
    // screen then showed under "where this photo is shared". Listing albums a
    // photo is not in, under that heading, invites revoking the wrong link.
    const api = exposureApi({
      albums: [albumShare(), albumShare({ id: 10, album: 'Unrelated' })],
      unfiltered: true,
    });
    const { links, liveCount, errors } = await loadShareExposure(api, 'p1');
    expect(links).toEqual([]);
    expect(liveCount).toBe(0);
    expect(errors).toContain('album');
  });

  test('a confirmed filter is trusted', async () => {
    const api = exposureApi({ albums: [albumShare()] });
    const { links, errors } = await loadShareExposure(api, 'p1');
    expect(links).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test('the media id is encoded, so an odd id cannot break the query', async () => {
    const api = exposureApi();
    await loadShareExposure(api, 'a b&c');
    expect(api.asked[0]).toContain('a%20b%26c');
  });
});

describe('revokeExposureLink', () => {
  test('routes each kind to its own router', async () => {
    const calls = [];
    const api = { delete: jest.fn(async (e) => { calls.push(e); return { success: true }; }) };
    await revokeExposureLink(api, { kind: 'direct', id: 4 });
    await revokeExposureLink(api, { kind: 'album', id: 7 });
    expect(calls).toEqual(['/media-shares/4', '/album-shares/7']);
  });

  test('a refusal is raised, not reported as success', async () => {
    const api = { delete: jest.fn(async () => ({ success: false, error: 'nope' })) };
    await expect(revokeExposureLink(api, { kind: 'album', id: 7 })).rejects.toThrow('nope');
  });
});
