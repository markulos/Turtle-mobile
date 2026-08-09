// The filter model behind the vault's "Filter & arrange" sheet.
//
// URL building is the part worth pinning down: five call sites in MediaGallery
// used to hand-concatenate their own query strings and had already drifted
// apart. These tests are the contract they now share.
import {
  DEFAULT_FILTERS,
  activeFilterChips,
  buildBucketsUrl,
  buildGalleryUrl,
  isDirty,
  normalizeFilters,
  persistedSlice,
} from '../galleryFilters';

const q = (url) => {
  const [path, search] = url.split('?');
  const params = {};
  for (const pair of (search || '').split('&').filter(Boolean)) {
    const [k, v] = pair.split('=');
    params[k] = decodeURIComponent(v);
  }
  return { path, params };
};

describe('buildGalleryUrl', () => {
  it('hits the gallery endpoint with the defaults and nothing extra', () => {
    const { path, params } = q(buildGalleryUrl(DEFAULT_FILTERS, { limit: 100, offset: 0 }));
    expect(path).toBe('/media/gallery');
    expect(params.limit).toBe('100');
    expect(params.offset).toBe('0');
    expect(params.order).toBe('desc');
    expect(params.sortBy).toBe('original');
    // kind is the host screen's scope, not a filter — absent unless passed.
    expect(params.kind).toBeUndefined();
    expect(params.mediaType).toBeUndefined();
    expect(params.tag).toBeUndefined();
  });

  it('switches to the search endpoint when there is a query', () => {
    const { path, params } = q(
      buildGalleryUrl({ ...DEFAULT_FILTERS, q: 'beach sunset' }, { limit: 50, offset: 0 }),
    );
    expect(path).toBe('/media/search');
    expect(params.q).toBe('beach sunset');
    // Direction is a browse concept; search results are ranked, so `order`
    // would be a lie.
    expect(params.order).toBeUndefined();
  });

  it('sends the album as the tag, and multi-select tags as a comma union', () => {
    const one = q(buildGalleryUrl(DEFAULT_FILTERS, { limit: 10, offset: 0, album: 'Trip' }));
    expect(one.params.tag).toBe('Trip');

    const many = q(
      buildGalleryUrl({ ...DEFAULT_FILTERS, tag: ['Food', 'Trip'] }, { limit: 10, offset: 0 }),
    );
    expect(many.params.tag).toBe('Food,Trip');
  });

  it('intersects the open album with the chosen tag chips', () => {
    const { params } = q(
      buildGalleryUrl({ ...DEFAULT_FILTERS, tag: ['Food'] }, { limit: 10, offset: 0, album: 'Trip' }),
    );
    expect(params.tag).toBe('Trip,Food');
  });

  it('omits the All pseudo-album — it means "no tag filter"', () => {
    const { params } = q(buildGalleryUrl(DEFAULT_FILTERS, { limit: 10, offset: 0, album: 'All' }));
    expect(params.tag).toBeUndefined();
  });

  it('carries mediaType, sceneType, direction and the date range', () => {
    const { params } = q(
      buildGalleryUrl(
        {
          ...DEFAULT_FILTERS,
          mediaType: 'video',
          sceneType: 'screenshot',
          direction: 'asc',
          from: 1700000000000,
          to: 1800000000000,
        },
        { limit: 10, offset: 20 },
      ),
    );
    expect(params.mediaType).toBe('video');
    expect(params.sceneType).toBe('screenshot');
    expect(params.order).toBe('asc');
    expect(params.from).toBe('1700000000000');
    expect(params.to).toBe('1800000000000');
    expect(params.offset).toBe('20');
  });
});

describe('buildBucketsUrl', () => {
  it('carries the facet-relevant filters and drops paging and search', () => {
    const { path, params } = q(
      buildBucketsUrl({ ...DEFAULT_FILTERS, q: 'ignored', mediaType: 'photo' }, { album: 'Trip', kind: 'visual' }),
    );
    expect(path).toBe('/media/buckets');
    expect(params.kind).toBe('visual');
    expect(params.mediaType).toBe('photo');
    expect(params.tag).toBe('Trip');
    expect(params.sortBy).toBe('original');
    expect(params.limit).toBeUndefined();
    expect(params.q).toBeUndefined();
  });
});

describe('isDirty', () => {
  it('is false for the defaults', () => {
    expect(isDirty(DEFAULT_FILTERS)).toBe(false);
  });

  it('ignores column count — density is a viewing preference, not a filter', () => {
    expect(isDirty({ ...DEFAULT_FILTERS, cols: 5 })).toBe(false);
  });

  it('is true for anything that changes which items are shown, or their order', () => {
    expect(isDirty({ ...DEFAULT_FILTERS, q: 'dog' })).toBe(true);
    expect(isDirty({ ...DEFAULT_FILTERS, mediaType: 'video' })).toBe(true);
    expect(isDirty({ ...DEFAULT_FILTERS, direction: 'asc' })).toBe(true);
    expect(isDirty({ ...DEFAULT_FILTERS, sortBy: 'upload' })).toBe(true);
    expect(isDirty({ ...DEFAULT_FILTERS, tag: ['Food'] })).toBe(true);
    expect(isDirty({ ...DEFAULT_FILTERS, from: 1 })).toBe(true);
  });
});

describe('activeFilterChips', () => {
  it('is empty when nothing is applied', () => {
    expect(activeFilterChips(DEFAULT_FILTERS)).toEqual([]);
  });

  it('describes each applied filter in the user\'s words', () => {
    const chips = activeFilterChips({
      ...DEFAULT_FILTERS,
      q: 'dog',
      mediaType: 'video',
      sortBy: 'upload',
      direction: 'asc',
      tag: ['Food', 'Trip'],
      sceneType: 'screenshot',
      // Local, not UTC: the label is rendered with toLocaleDateString, so a
      // UTC midnight would read as the previous month west of Greenwich.
      from: new Date(2026, 0, 1).getTime(),
      to: new Date(2026, 2, 31).getTime(),
    });
    const byKey = Object.fromEntries(chips.map((c) => [c.key, c.label]));
    expect(byKey.q).toBe('“dog”');
    expect(byKey.mediaType).toBe('Videos');
    expect(byKey.sortBy).toBe('Date added');
    expect(byKey.direction).toBe('Oldest first');
    expect(byKey['tag:Food']).toBe('Food');
    expect(byKey['tag:Trip']).toBe('Trip');
    expect(byKey.sceneType).toBe('screenshot');
    expect(byKey.dateRange).toBe('Jan 2026 – Mar 2026');
  });
});

describe('normalizeFilters', () => {
  it('drops unknown keys and coerces bad values back to their defaults', () => {
    const out = normalizeFilters({
      sortBy: 'nonsense',
      direction: 'sideways',
      mediaType: 'sculpture',
      cols: 99,
      tag: 'Food',
      nope: true,
    });
    expect(out.sortBy).toBe('original');
    expect(out.direction).toBe('desc');
    expect(out.mediaType).toBe('all');
    expect(out.cols).toBe(5); // clamped to the pinch range, not reset
    expect(out.tag).toEqual(['Food']); // a bare string is a one-tag selection
    expect(out.nope).toBeUndefined();
  });
});

describe('persistedSlice', () => {
  it('persists how you browse, not what you searched for', () => {
    const slice = persistedSlice({
      ...DEFAULT_FILTERS,
      sortBy: 'upload',
      direction: 'asc',
      cols: 4,
      q: 'dog',
      tag: ['Food'],
      from: 1,
    });
    expect(slice).toEqual({ sortBy: 'upload', direction: 'asc', cols: 4 });
  });
});
