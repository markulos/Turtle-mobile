import {
  buildPhotoVaultBoards,
  formatBoardMetadata,
  formatBoardRecency,
  normalizeAlbumsPayload,
  normalizeBoardSearch,
} from '../photoVaultBoards';

const NOW = Date.UTC(2026, 6, 29, 12);
const day = 24 * 60 * 60 * 1000;

describe('photoVaultBoards', () => {
  test('normalizes board search across case, spaces, hyphens, and underscores', () => {
    expect(normalizeBoardSearch(' Warm-Interior_spaces ')).toBe('warminteriorspaces');
  });

  test('formats deterministic relative recency and missing dates', () => {
    expect(formatBoardRecency(NOW - 4 * 60 * 60 * 1000, NOW)).toBe('today');
    expect(formatBoardRecency(NOW - 3 * day, NOW)).toBe('3d');
    expect(formatBoardRecency(NOW - 75 * day, NOW)).toBe('2mo');
    expect(formatBoardRecency(NOW - 800 * day, NOW)).toBe('2y');
    expect(formatBoardRecency(0, NOW)).toBeNull();
  });

  test('formats true item counts with singular, plural, and recency', () => {
    expect(formatBoardMetadata(1, NOW - day, NOW)).toBe('1 item · 1d');
    expect(formatBoardMetadata(47, NOW - 2 * day, NOW)).toBe('47 items · 2d');
    expect(formatBoardMetadata(undefined, undefined, NOW)).toBe('0 items');
  });

  test('builds safe view models and filters normalized names', () => {
    const result = buildPhotoVaultBoards({
      names: ['Warm Interior Spaces', 'Office_ind'],
      coversByName: { 'Warm Interior Spaces': ['/one', '/two', '/three', '/four'] },
      countsByName: { 'Warm Interior Spaces': 47 },
      latestDatesByName: { 'Warm Interior Spaces': NOW - 2 * day },
      query: 'warm-interior',
      sortMode: 'recent',
      now: NOW,
    });

    expect(result).toEqual([{
      name: 'Warm Interior Spaces',
      normalizedName: 'warminteriorspaces',
      covers: ['/one', '/two', '/three', '/four'],
      count: 47,
      latestDate: NOW - 2 * day,
      // Count and age are also exposed separately so the card can weight them
      // differently; `metadata` remains the joined form for accessibility.
      itemLabel: '47 items',
      recency: '2d',
      metadata: '47 items · 2d',
      isLive: false,
      // Always present, always an array — the card's face stack never has to
      // guard, and an absent board means "shared with nobody".
      sharedWith: [],
    }]);
  });

  test('flags boards with a live public link, matching names case-insensitively', () => {
    const result = buildPhotoVaultBoards({
      names: ['Picco', 'Turtle 3D'],
      countsByName: { Picco: 73, 'Turtle 3D': 4 },
      sortMode: 'alphabetical',
      now: NOW,
      // The gallery keeps this set lower-cased; board names are not.
      liveAlbumNames: new Set(['picco']),
    });

    expect(result.map((board) => [board.name, board.isLive]))
      .toEqual([['Picco', true], ['Turtle 3D', false]]);
  });

  test.each([
    ['recent', ['Favourites', 'Recent', 'Alpha', 'Large']],
    ['largest', ['Favourites', 'Large', 'Alpha', 'Recent']],
    ['alphabetical', ['Favourites', 'Alpha', 'Large', 'Recent']],
  ])('sorts by %s with Favourites pinned and stable name tie-breaks', (sortMode, expected) => {
    const result = buildPhotoVaultBoards({
      names: ['Recent', 'Favourites', 'Alpha', 'Large'],
      coversByName: {},
      countsByName: { Large: 200, Recent: 2, Alpha: 2, Favourites: 1 },
      latestDatesByName: { Recent: NOW, Large: NOW - day, Alpha: NOW - day },
      sortMode,
      now: NOW,
    });

    expect(result.map((board) => board.name)).toEqual(expected);
  });

  test('deduplicates invalid names and tolerates malformed metadata maps', () => {
    const result = buildPhotoVaultBoards({
      names: ['Board', 'Board', '', null],
      coversByName: { Board: 'not-an-array' },
      countsByName: { Board: -5 },
      latestDatesByName: { Board: 'bad' },
      now: NOW,
    });

    expect(result).toEqual([expect.objectContaining({
      name: 'Board',
      covers: [],
      count: 0,
      latestDate: 0,
      metadata: '0 items',
    })]);
  });

  test('normalizes current and older /media/albums payloads', () => {
    expect(normalizeAlbumsPayload({
      albums: ['One'],
      covers: { One: ['/cover'] },
      counts: { One: 9 },
      latestDate: { One: 123 },
    })).toEqual({
      names: ['One'],
      coversByName: { One: ['/cover'] },
      countsByName: { One: 9 },
      latestDatesByName: { One: 123 },
    });

    expect(normalizeAlbumsPayload({ albums: ['Legacy'] })).toEqual({
      names: ['Legacy'],
      coversByName: {},
      countsByName: {},
      latestDatesByName: {},
    });
  });

  // The pond half of sharing: GET /api/album-access/mine answers one map for
  // the whole grid, keyed lower-case, and these boards draw it as a face stack.
  describe('sharedByName', () => {
    const bea = { shareId: 's1', userId: 'u_bea', name: 'Bea', permission: 'view' };
    const cal = { shareId: 's2', userId: 'u_cal', name: 'Cal', permission: 'view' };

    test('hangs the people on the board they were given, matching case-insensitively', () => {
      const [priv, trip] = buildPhotoVaultBoards({
        names: ['Trip', 'Private'],
        sortMode: 'alphabetical',
        sharedByName: { trip: [bea, cal] },
        now: NOW,
      });
      expect(priv.name).toBe('Private');
      expect(priv.sharedWith).toEqual([]);
      expect(trip.name).toBe('Trip');
      expect(trip.sharedWith.map((p) => p.userId)).toEqual(['u_bea', 'u_cal']);
    });

    test('a board nobody has gets an empty array, never undefined', () => {
      const [board] = buildPhotoVaultBoards({ names: ['Alone'], sharedByName: {}, now: NOW });
      expect(board.sharedWith).toEqual([]);
      const [none] = buildPhotoVaultBoards({ names: ['Alone'], now: NOW });
      expect(none.sharedWith).toEqual([]);
    });

    test('a junk payload is treated as nobody rather than thrown on', () => {
      // The endpoint is allowed to fail; what it must never do is take the grid
      // down with it.
      for (const junk of [null, 'nope', [], { trip: 'not-an-array' }]) {
        const [board] = buildPhotoVaultBoards({ names: ['Trip'], sharedByName: junk, now: NOW });
        expect(board.sharedWith).toEqual([]);
      }
    });

    test('the board does not alias the caller’s map', () => {
      const map = { trip: [bea] };
      const [board] = buildPhotoVaultBoards({ names: ['Trip'], sharedByName: map, now: NOW });
      board.sharedWith.push(cal);
      expect(map.trip).toHaveLength(1);
    });
  });
});
