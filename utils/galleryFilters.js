// The vault's browse model: every knob the "Filter & arrange" sheet offers,
// in one place, plus the URL builders every fetch site shares.
//
// This exists because MediaGallery held these as eight separate useStates and
// five call sites each hand-concatenated their own query string. They had
// already drifted — one sent `order=desc` unconditionally, another forgot the
// kind scope. One model, one builder, no drift.
//
// Pure functions only. The React binding lives in useGalleryFilters.js so this
// half stays trivially testable.

// Pinch-to-zoom column range, mirrored from MediaGallery's GRID_COL_MIN/MAX so
// the sheet's density stepper and the pinch gesture cannot disagree.
export const COLS_MIN = 2;
export const COLS_MAX = 5;

export const DEFAULT_FILTERS = {
  // Which date drives the timeline. 'original' = when the shot was taken,
  // 'upload' = when it landed in Turtle.
  sortBy: 'original',
  direction: 'desc',      // 'desc' = newest first
  mediaType: 'all',       // 'all' | 'photo' | 'video'
  tag: [],                // chosen tag chips, unioned (OR)
  sceneType: null,        // ai_scene_type facet
  from: null,             // epoch ms, inclusive
  to: null,               // epoch ms, inclusive
  q: '',
  cols: 3,
};

const SORT_BY = ['original', 'upload'];
const DIRECTION = ['desc', 'asc'];
const MEDIA_TYPE = ['all', 'photo', 'video'];

const clampCols = (n) => {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_FILTERS.cols;
  return Math.min(COLS_MAX, Math.max(COLS_MIN, v));
};

const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

const asTagList = (value) => {
  if (Array.isArray(value)) return value.map((t) => String(t).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    // A bare string is a single-tag selection — the shape persisted state and
    // deep links tend to arrive in.
    return value.split(',').map((t) => t.trim()).filter(Boolean);
  }
  return [];
};

const asEpoch = (value) => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Coerce anything (persisted JSON, a deep link, a partial patch) into a valid
 * filter object. Unknown keys are dropped rather than carried, so a stale
 * persisted blob can never smuggle a field into a query string.
 */
export function normalizeFilters(raw = {}) {
  return {
    sortBy: oneOf(raw.sortBy, SORT_BY, DEFAULT_FILTERS.sortBy),
    direction: oneOf(raw.direction, DIRECTION, DEFAULT_FILTERS.direction),
    mediaType: oneOf(raw.mediaType, MEDIA_TYPE, DEFAULT_FILTERS.mediaType),
    tag: asTagList(raw.tag),
    sceneType: raw.sceneType ? String(raw.sceneType) : null,
    from: asEpoch(raw.from),
    to: asEpoch(raw.to),
    q: typeof raw.q === 'string' ? raw.q : '',
    cols: raw.cols == null ? DEFAULT_FILTERS.cols : clampCols(raw.cols),
  };
}

/** The keys worth remembering between sessions: how you browse, not what you looked for. */
export function persistedSlice(filters) {
  return { sortBy: filters.sortBy, direction: filters.direction, cols: filters.cols };
}

/**
 * Does anything here change WHICH items are shown, or in what order?
 * Column count deliberately doesn't count — density is a viewing preference,
 * and badging the filter icon for it would cry wolf.
 */
export function isDirty(filters) {
  return (
    filters.sortBy !== DEFAULT_FILTERS.sortBy
    || filters.direction !== DEFAULT_FILTERS.direction
    || filters.mediaType !== DEFAULT_FILTERS.mediaType
    || (filters.tag && filters.tag.length > 0)
    || !!filters.sceneType
    || filters.from != null
    || filters.to != null
    || (filters.q || '').trim() !== ''
  );
}

// The album a board page is scoped to is itself a tag. Chips chosen inside the
// sheet intersect with it on the server via the comma list, so the open board
// always comes first.
function tagParam(filters, album) {
  const tags = [];
  if (album && album !== 'All') tags.push(album);
  for (const t of filters.tag || []) if (!tags.includes(t)) tags.push(t);
  return tags.length ? tags.join(',') : null;
}

function serialize(base, pairs) {
  const parts = [];
  for (const [key, value] of pairs) {
    if (value == null || value === '') continue;
    parts.push(`${key}=${encodeURIComponent(value)}`);
  }
  return parts.length ? `${base}?${parts.join('&')}` : base;
}

/**
 * The one URL every gallery fetch goes through. A non-empty query routes to
 * FTS search, which shares the gallery's response shape.
 *
 * `kind` scopes the media table's visual/audio split and comes from the host
 * screen, not the filter model: the Photos vault passes 'visual', while chat's
 * /photos gallery passes nothing and sees every row, as it always has.
 */
export function buildGalleryUrl(filters, { limit = 100, offset = 0, album = null, kind = null } = {}) {
  const f = normalizeFilters(filters);
  const query = (f.q || '').trim();
  const common = [
    ['limit', limit],
    ['offset', offset],
    ['sortBy', f.sortBy],
    ['kind', kind],
    ['mediaType', f.mediaType === 'all' ? null : f.mediaType],
    ['tag', tagParam(f, album)],
  ];

  if (query) {
    // Search results are bm25-ranked, so a direction would be meaningless, and
    // the server has no scene/date filter on this path.
    return serialize('/media/search', [...common, ['q', query]]);
  }

  return serialize('/media/gallery', [
    ...common,
    ['order', f.direction],
    ['sceneType', f.sceneType],
    ['from', f.from],
    ['to', f.to],
  ]);
}

/**
 * Facet + month-histogram source. Deliberately ignores the search query and
 * paging: facets describe the filtered scope, not the current page.
 */
export function buildBucketsUrl(filters, { album = null, kind = null } = {}) {
  const f = normalizeFilters(filters);
  return serialize('/media/buckets', [
    ['sortBy', f.sortBy],
    ['kind', kind],
    ['mediaType', f.mediaType === 'all' ? null : f.mediaType],
    ['tag', tagParam(f, album)],
    ['sceneType', f.sceneType],
    ['from', f.from],
    ['to', f.to],
  ]);
}

const MONTH_FMT = { month: 'short', year: 'numeric' };
const monthLabel = (ms) => new Date(ms).toLocaleDateString('en-US', MONTH_FMT);

/**
 * One removable chip per applied filter, in the user's words rather than the
 * API's. Tags get one chip each so they can be dropped individually.
 */
export function activeFilterChips(filters) {
  const f = normalizeFilters(filters);
  const chips = [];
  const query = (f.q || '').trim();
  if (query) chips.push({ key: 'q', label: `“${query}”` });
  if (f.mediaType !== 'all') {
    chips.push({ key: 'mediaType', label: f.mediaType === 'video' ? 'Videos' : 'Photos' });
  }
  if (f.sortBy !== DEFAULT_FILTERS.sortBy) chips.push({ key: 'sortBy', label: 'Date added' });
  if (f.direction !== DEFAULT_FILTERS.direction) chips.push({ key: 'direction', label: 'Oldest first' });
  for (const t of f.tag) chips.push({ key: `tag:${t}`, label: t });
  if (f.sceneType) chips.push({ key: 'sceneType', label: f.sceneType });
  if (f.from != null || f.to != null) {
    const label = f.from != null && f.to != null
      ? `${monthLabel(f.from)} – ${monthLabel(f.to)}`
      : f.from != null
        ? `From ${monthLabel(f.from)}`
        : `Until ${monthLabel(f.to)}`;
    chips.push({ key: 'dateRange', label });
  }
  return chips;
}

/** Clearing a chip: what patch does dropping this key imply? */
export function clearChipPatch(key, filters) {
  if (key === 'q') return { q: '' };
  if (key === 'mediaType') return { mediaType: 'all' };
  if (key === 'sortBy') return { sortBy: DEFAULT_FILTERS.sortBy };
  if (key === 'direction') return { direction: DEFAULT_FILTERS.direction };
  if (key === 'sceneType') return { sceneType: null };
  if (key === 'dateRange') return { from: null, to: null };
  if (key.startsWith('tag:')) {
    const name = key.slice(4);
    return { tag: (filters.tag || []).filter((t) => t !== name) };
  }
  return {};
}
