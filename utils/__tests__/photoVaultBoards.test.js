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
      // The name begins with what was typed, so it outranks a board that
      // merely contains it. See the relevance tests below.
      matchRank: 1,
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

  // ── Best match first ─────────────────────────────────────────────────────
  // Plain substring matching made "Sum" and "Best of 2019 Summer" equally good
  // answers to "sum", so whichever was more recent won and the board you were
  // obviously reaching for sat second.
  const rank = (names, query, extra = {}) => buildPhotoVaultBoards({
    names,
    // Equal recency everywhere, so ordering can only come from relevance.
    latestDatesByName: Object.fromEntries(names.map((n) => [n, NOW - day])),
    query,
    sortMode: "recent",
    now: NOW,
    ...extra,
  }).map((b) => b.name);

  test("an exact name wins over a longer one that merely starts with it", () => {
    expect(rank(["Summer Holiday", "Summer"], "summer")).toEqual(["Summer", "Summer Holiday"]);
  });

  test("a prefix beats a mid-name hit", () => {
    expect(rank(["Best of Summer", "Summer Holiday"], "sum"))
      .toEqual(["Summer Holiday", "Best of Summer"]);
  });

  test("a later WORD start still beats a match buried inside one", () => {
    // normalizeBoardSearch flattens "Summer Trip" to "summertrip", losing the
    // boundary — so word starts are read off the original name. Without that,
    // "trip" ranks "Striptease Poster" and "Summer Trip" the same.
    expect(rank(["Striptease Poster", "Summer Trip"], "trip"))
      .toEqual(["Summer Trip", "Striptease Poster"]);
  });

  test("word starts are found across spaces, hyphens and underscores alike", () => {
    expect(rank(["xxday", "beach-day"], "day")).toEqual(["beach-day", "xxday"]);
    expect(rank(["xxday", "beach_day"], "day")).toEqual(["beach_day", "xxday"]);
  });

  test("within one relevance tier the chosen sort still decides", () => {
    const byLargest = buildPhotoVaultBoards({
      names: ["Summer A", "Summer B"],
      countsByName: { "Summer A": 2, "Summer B": 90 },
      query: "summer",
      sortMode: "largest",
      now: NOW,
    }).map((b) => b.name);
    expect(byLargest).toEqual(["Summer B", "Summer A"]);
  });

  test("searching outranks the Favourites pin", () => {
    // Favourites is pinned because it is the board you always want at hand
    // while browsing. Once a name has been typed, a pin that jumps the answer
    // is the pin getting in the way — and "s" alone used to do exactly that.
    expect(rank(["Favourites", "Summer"], "s")).toEqual(["Summer", "Favourites"]);
  });

  test("Favourites is still pinned when nothing is being searched", () => {
    expect(rank(["Summer", "Favourites"], "")).toEqual(["Favourites", "Summer"]);
  });

  test("relevance never widens the result set", () => {
    // Ranking reorders matches; it must not promote a board that does not
    // match at all.
    expect(rank(["Summer", "Winter"], "summer")).toEqual(["Summer"]);
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
});
