const DAY_MS = 24 * 60 * 60 * 1000;
const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

const objectMap = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export const normalizeAlbumsPayload = (response = {}) => ({
  names: Array.isArray(response.albums) ? response.albums : [],
  coversByName: objectMap(response.covers),
  countsByName: objectMap(response.counts),
  latestDatesByName: objectMap(response.latestDate),
});

export const normalizeBoardSearch = (value) =>
  String(value ?? '').trim().toLowerCase().replace(/[-_\s]+/g, '');

/**
 * How well a board name answers a query. Lower is better; 0 is exact.
 *
 * Plain `includes` treats "Sum" and "Best of 2019 Summer" as equally good
 * answers to "sum", so whichever happened to be more recent won — and the
 * board you were obviously reaching for sat second. These tiers put the
 * closest name first and leave everything else to the sort you picked.
 *
 * Tier 2 is the one worth explaining. `normalizeBoardSearch` strips spaces and
 * hyphens so that "beach-day" and "Beach Day" match each other, but that also
 * destroys word boundaries — "summertrip" gives no clue where "trip" starts.
 * So word starts are checked against the ORIGINAL name, split before it was
 * flattened. Typing "trip" should find "Summer Trip" ahead of a board that
 * merely contains the letters mid-word.
 */
const MATCH_EXACT = 0;
const MATCH_PREFIX = 1;
const MATCH_WORD_START = 2;
const MATCH_CONTAINS = 3;

export const boardMatchRank = (name, normalizedName, normalizedQuery) => {
  if (!normalizedQuery) return MATCH_CONTAINS;
  if (normalizedName === normalizedQuery) return MATCH_EXACT;
  if (normalizedName.startsWith(normalizedQuery)) return MATCH_PREFIX;
  const words = String(name ?? '').split(/[\s\-_]+/).filter(Boolean);
  for (const word of words) {
    if (normalizeBoardSearch(word).startsWith(normalizedQuery)) return MATCH_WORD_START;
  }
  return MATCH_CONTAINS;
};

const safeCount = (value) => {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

const safeTimestamp = (value) => {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
};

export const formatBoardRecency = (timestamp, now = Date.now()) => {
  const value = safeTimestamp(timestamp);
  if (!value) return null;
  const days = Math.max(0, Math.floor((Number(now) - value) / DAY_MS));
  if (days === 0) return 'today';
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
};

export const formatBoardItemLabel = (count) => {
  const safe = safeCount(count);
  return `${safe} item${safe === 1 ? '' : 's'}`;
};

// Single string, used for the accessibility label and by any caller that wants
// one blob. The CARD renders itemLabel and recency separately so the count and
// the age can carry different weights, as in the reference design.
export const formatBoardMetadata = (count, latestDate, now = Date.now()) => {
  const itemLabel = formatBoardItemLabel(count);
  const recency = formatBoardRecency(latestDate, now);
  return recency ? `${itemLabel} · ${recency}` : itemLabel;
};

export const buildPhotoVaultBoards = ({
  names = [],
  coversByName = {},
  countsByName = {},
  latestDatesByName = {},
  query = '',
  sortMode = 'recent',
  now = Date.now(),
  // Names of the boards that currently have a LIVE public link (Set or array,
  // matched case-insensitively). Published state is otherwise invisible from
  // the grid — you would have to open each board's menu to find out.
  liveAlbumNames = null,
} = {}) => {
  const seen = new Set();
  const normalizedQuery = normalizeBoardSearch(query);
  const liveNames = new Set(
    Array.from(liveAlbumNames || []).map((name) => String(name).toLowerCase()),
  );

  const boards = names
    .filter((name) => typeof name === 'string' && name.trim())
    .map((name) => name.trim())
    .filter((name) => {
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .map((name) => {
      const count = safeCount(countsByName?.[name]);
      const latestDate = safeTimestamp(latestDatesByName?.[name]);
      const normalizedName = normalizeBoardSearch(name);
      return {
        name,
        normalizedName,
        covers: Array.isArray(coversByName?.[name])
          ? coversByName[name].filter(Boolean).slice(0, 4)
          : [],
        count,
        latestDate,
        itemLabel: formatBoardItemLabel(count),
        recency: formatBoardRecency(latestDate, now),
        metadata: formatBoardMetadata(count, latestDate, now),
        isLive: liveNames.has(name.toLowerCase()),
        matchRank: boardMatchRank(name, normalizedName, normalizedQuery),
      };
    })
    .filter((board) => !normalizedQuery || board.normalizedName.includes(normalizedQuery));

  const compareName = (a, b) => collator.compare(a.name, b.name);
  const compare = sortMode === 'largest'
    ? (a, b) => b.count - a.count || compareName(a, b)
    : sortMode === 'alphabetical'
      ? compareName
      : (a, b) => b.latestDate - a.latestDate || compareName(a, b);

  // While SEARCHING, relevance outranks everything — including the Favourites
  // pin. Favourites is pinned because it's the one board you always want at
  // hand when browsing; when you have typed a name, the board you named is the
  // one you want, and a pin that overrides it is the pin getting in the way.
  // (It also stops a single letter like "s" floating Favourites above the
  // "Summer" you were clearly typing.) Within one relevance tier the sort
  // chips still decide, so they never stop meaning anything.
  if (normalizedQuery) {
    return boards.sort((a, b) => a.matchRank - b.matchRank || compare(a, b));
  }

  return boards.sort((a, b) => {
    const aFavourite = a.name.toLowerCase() === 'favourites';
    const bFavourite = b.name.toLowerCase() === 'favourites';
    if (aFavourite !== bFavourite) return aFavourite ? -1 : 1;
    return compare(a, b);
  });
};
