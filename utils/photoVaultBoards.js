const DAY_MS = 24 * 60 * 60 * 1000;
const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

export const normalizeBoardSearch = (value) =>
  String(value ?? '').trim().toLowerCase().replace(/[-_\s]+/g, '');

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

export const formatBoardMetadata = (count, latestDate, now = Date.now()) => {
  const safe = safeCount(count);
  const itemLabel = `${safe} item${safe === 1 ? '' : 's'}`;
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
} = {}) => {
  const seen = new Set();
  const normalizedQuery = normalizeBoardSearch(query);

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
        metadata: formatBoardMetadata(count, latestDate, now),
      };
    })
    .filter((board) => !normalizedQuery || board.normalizedName.includes(normalizedQuery));

  const compareName = (a, b) => collator.compare(a.name, b.name);
  const compare = sortMode === 'largest'
    ? (a, b) => b.count - a.count || compareName(a, b)
    : sortMode === 'alphabetical'
      ? compareName
      : (a, b) => b.latestDate - a.latestDate || compareName(a, b);

  return boards.sort((a, b) => {
    const aFavourite = a.name.toLowerCase() === 'favourites';
    const bFavourite = b.name.toLowerCase() === 'favourites';
    if (aFavourite !== bFavourite) return aFavourite ? -1 : 1;
    return compare(a, b);
  });
};
