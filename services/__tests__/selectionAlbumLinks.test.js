import {
  suggestAlbumName,
  loadAlbumIndex,
  findAlbumCollision,
  validateAlbumName,
  createAlbumLink,
} from '../selectionAlbumLinks';

/**
 * The rule this module exists to enforce: an album name is a TAG QUERY, so
 * reusing an existing name publishes everything already carrying it.
 *
 * That's the failure worth testing. Someone selects 12 photos, types "Summer"
 * because it's descriptive, and hands out a link to the 240-photo Summer album
 * they made two years ago. There is no undo — the link is already in a chat,
 * and the recipient has already seen whatever was in it. So the collision path
 * has to be detected reliably, including the case-folding SQLite does.
 */

/** A fake ServerContext api wrapper. */
function makeApi({ albums = [], counts = {}, updated = null, share = null } = {}) {
  const calls = { get: [], post: [], put: [] };
  return {
    calls,
    get: jest.fn(async (endpoint) => {
      calls.get.push(endpoint);
      if (endpoint === '/media/albums') return { success: true, albums, counts };
      throw new Error(`unexpected GET ${endpoint}`);
    }),
    put: jest.fn(async (endpoint, body) => {
      calls.put.push({ endpoint, body });
      return { success: true, updated: updated ?? body.ids.length };
    }),
    post: jest.fn(async (endpoint, body) => {
      calls.post.push({ endpoint, body });
      return {
        success: true,
        share: share || { id: 3, slug: 'sluggy', url: 'https://s.t3d.ca/s/sluggy' },
      };
    }),
  };
}

const at = (y, m, d) => ({ originalDate: Date.UTC(y, m, d, 12) });

describe('suggestAlbumName', () => {
  test('one day becomes that day, spelled out', () => {
    expect(suggestAlbumName([at(2026, 7, 22), at(2026, 7, 22)])).toBe('22 August 2026');
  });

  test('one month collapses to the month', () => {
    expect(suggestAlbumName([at(2026, 2, 3), at(2026, 2, 28)])).toBe('March 2026');
  });

  test('several months in one year keep both ends', () => {
    expect(suggestAlbumName([at(2026, 2, 3), at(2026, 7, 9)])).toBe('March – August 2026');
  });

  test('across years it degrades to a year range', () => {
    expect(suggestAlbumName([at(2019, 4, 2), at(2026, 1, 9)])).toBe('2019 – 2026');
  });

  test('undated items still get a usable name rather than "Invalid Date"', () => {
    expect(suggestAlbumName([{}, {}, {}])).toBe('3 photos');
  });

  test('falls back through originalDate → uploadDate → date', () => {
    expect(suggestAlbumName([{ uploadDate: Date.UTC(2026, 7, 22, 12) }])).toBe('22 August 2026');
    expect(suggestAlbumName([{ date: Date.UTC(2026, 7, 22, 12) }])).toBe('22 August 2026');
  });
});

describe('findAlbumCollision', () => {
  const index = { names: ['Summer', 'Wedding'], counts: { Summer: 240, Wedding: 12 } };

  test('reports the existing album and how big it is', () => {
    expect(findAlbumCollision(index, 'Summer')).toEqual({ name: 'Summer', count: 240 });
  });

  test('folds case the way SQLite does — this is the leak', () => {
    // COLLATE NOCASE means "summer" resolves to the same 240 photos. Missing
    // this is how the warning gets skipped on the exact input most likely to
    // be typed by someone who forgot the album exists.
    expect(findAlbumCollision(index, 'summer')).toEqual({ name: 'Summer', count: 240 });
    expect(findAlbumCollision(index, 'SUMMER')).toEqual({ name: 'Summer', count: 240 });
  });

  test('ignores surrounding whitespace, which the server trims anyway', () => {
    expect(findAlbumCollision(index, '  Summer  ')).toEqual({ name: 'Summer', count: 240 });
  });

  test('a free name is null, and so is an empty one', () => {
    expect(findAlbumCollision(index, 'Beach day')).toBeNull();
    expect(findAlbumCollision(index, '   ')).toBeNull();
  });

  test('an album with no count still reports zero rather than NaN', () => {
    expect(findAlbumCollision({ names: ['Empty'], counts: {} }, 'Empty'))
      .toEqual({ name: 'Empty', count: 0 });
  });
});

describe('validateAlbumName', () => {
  test('a blank name is refused', () => {
    expect(validateAlbumName('   ')).toBeTruthy();
  });

  test('commas and quotes are refused', () => {
    expect(validateAlbumName('Trip, day 2')).toBeTruthy();
    expect(validateAlbumName('The "big" trip')).toBeTruthy();
  });

  test('an ordinary name passes', () => {
    expect(validateAlbumName('Beach day')).toBeNull();
  });
});

describe('loadAlbumIndex', () => {
  test('survives a server that answers without counts', async () => {
    const api = makeApi({ albums: ['A'], counts: undefined });
    const index = await loadAlbumIndex(api);
    expect(index.names).toEqual(['A']);
    expect(findAlbumCollision(index, 'A')).toEqual({ name: 'A', count: 0 });
  });
});

describe('createAlbumLink', () => {
  test('tags first, then mints — an album has to exist before it is shared', async () => {
    const api = makeApi();
    await createAlbumLink(api, { ids: ['a', 'b'], album: 'Beach day' });

    expect(api.calls.put[0].endpoint).toBe('/media/tags/bulk');
    expect(api.calls.put[0].body).toEqual({ ids: ['a', 'b'], add: ['Beach day'] });
    expect(api.calls.post[0].endpoint).toBe('/album-shares');
    expect(api.put.mock.invocationCallOrder[0])
      .toBeLessThan(api.post.mock.invocationCallOrder[0]);
  });

  test('adds ONLY the album tag — every other tag on the item survives', async () => {
    const api = makeApi();
    await createAlbumLink(api, { ids: ['a'], album: 'Beach day' });
    // No `remove` key at all: the bulk route treats it as "append and leave
    // the rest alone". Sending one would strip tags the user never touched.
    expect(api.calls.put[0].body.remove).toBeUndefined();
  });

  test('ids are stringified — a numeric id must not become a miss', async () => {
    const api = makeApi();
    await createAlbumLink(api, { ids: [1, 2], album: 'Nums' });
    expect(api.calls.put[0].body.ids).toEqual(['1', '2']);
  });

  test('reports what was actually written, not what was asked for', async () => {
    // Two of the three ids were deleted while the sheet was open.
    const api = makeApi({ updated: 1 });
    const share = await createAlbumLink(api, { ids: ['a', 'b', 'c'], album: 'Gone' });
    expect(share.added).toBe(1);
    expect(share.requested).toBe(3);
  });

  test('a failed tag write does NOT go on to mint a link', async () => {
    const api = makeApi();
    api.put = jest.fn(async () => ({ success: false, error: 'disk full' }));
    await expect(createAlbumLink(api, { ids: ['a'], album: 'Nope' }))
      .rejects.toThrow('disk full');
    expect(api.post).not.toHaveBeenCalled();
  });

  test('an empty selection is refused before anything is written', async () => {
    const api = makeApi();
    await expect(createAlbumLink(api, { ids: [], album: 'Empty' })).rejects.toThrow();
    expect(api.put).not.toHaveBeenCalled();
  });

  test('a bad name is refused before anything is written', async () => {
    const api = makeApi();
    await expect(createAlbumLink(api, { ids: ['a'], album: '  ' })).rejects.toThrow();
    expect(api.put).not.toHaveBeenCalled();
  });

  test('options ride through, and blanks become undefined rather than empty', async () => {
    const api = makeApi();
    await createAlbumLink(api, {
      ids: ['a'], album: 'Locked', title: 'Our trip', password: 'hunter2',
      allowDownload: false, allowUpload: true,
    });
    expect(api.calls.post[0].body).toEqual({
      album: 'Locked',
      title: 'Our trip',
      allowDownload: false,
      allowUpload: true,
      password: 'hunter2',
    });

    const plain = makeApi();
    await createAlbumLink(plain, { ids: ['a'], album: 'Plain', title: '   ' });
    // An empty title must not be sent as '' — the server would render a
    // blank preview card instead of falling back to the album name.
    expect(plain.calls.post[0].body.title).toBeUndefined();
    expect(plain.calls.post[0].body.password).toBeUndefined();
  });
});
