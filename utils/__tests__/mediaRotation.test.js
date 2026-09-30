/**
 * utils/mediaRotation — the cache-bust token for a rotated photo.
 *
 * The rule worth pinning: an UNROTATED photo's URL must come back BYTE-FOR-BYTE
 * unchanged. Every thumbnail already cached on every phone depends on it, and
 * the grid's prefetcher warms the same string the cells request — if this helper
 * started decorating unrotated URLs, every warmed entry in the app would miss.
 */
import { rotationOf, withRotation, rotatedUrl } from '../mediaRotation';

describe('rotationOf', () => {
  it('reads a normal angle', () => {
    expect(rotationOf({ rotation: 0 })).toBe(0);
    expect(rotationOf({ rotation: 90 })).toBe(90);
    expect(rotationOf({ rotation: 180 })).toBe(180);
    expect(rotationOf({ rotation: 270 })).toBe(270);
  });

  it('treats a row with no rotation at all as unrotated', () => {
    // Rows cached before the column existed, and SQLite NULLs, both land here.
    expect(rotationOf({})).toBe(0);
    expect(rotationOf({ rotation: null })).toBe(0);
    expect(rotationOf({ rotation: undefined })).toBe(0);
    expect(rotationOf(null)).toBe(0);
    expect(rotationOf(undefined)).toBe(0);
  });

  it('coerces strings and wraps out-of-range angles', () => {
    expect(rotationOf({ rotation: '90' })).toBe(90);
    expect(rotationOf({ rotation: 360 })).toBe(0);
    expect(rotationOf({ rotation: 450 })).toBe(90);
    expect(rotationOf({ rotation: -90 })).toBe(270);
  });

  it('degrades garbage to unrotated rather than producing NaN in a URL', () => {
    expect(rotationOf({ rotation: 'abc' })).toBe(0);
    expect(rotationOf({ rotation: NaN })).toBe(0);
    expect(rotationOf({ rotation: Infinity })).toBe(0);
    expect(rotationOf({ rotation: {} })).toBe(0);
  });
});

describe('withRotation', () => {
  it('leaves an unrotated URL EXACTLY as it was', () => {
    const url = 'https://pond/api/media/thumbnails/abc.webp';
    expect(withRotation(url, 0)).toBe(url);
    expect(withRotation(url, null)).toBe(url);
    expect(withRotation(url, undefined)).toBe(url);
  });

  it('adds the token for a rotated photo', () => {
    expect(withRotation('https://pond/api/media/display/abc', 90))
      .toBe('https://pond/api/media/display/abc?r=90');
    expect(withRotation('https://pond/api/media/display/abc', 270))
      .toBe('https://pond/api/media/display/abc?r=270');
  });

  it('joins with & when the URL already has a query string', () => {
    // The share/quality paths build URLs with params; a second '?' would make
    // the whole request unparseable.
    expect(withRotation('https://pond/api/media/display/abc?q=hi', 180))
      .toBe('https://pond/api/media/display/abc?q=hi&r=180');
  });

  it('passes a missing URL straight through instead of inventing one', () => {
    expect(withRotation(null, 90)).toBeNull();
    expect(withRotation(undefined, 90)).toBeNull();
    expect(withRotation('', 90)).toBeNull();
  });
});

describe('rotatedUrl', () => {
  const getFullUrl = (p) => `https://pond${p}`;

  it('resolves and busts in one step', () => {
    expect(rotatedUrl(getFullUrl, { rotation: 90 }, '/api/media/display/a'))
      .toBe('https://pond/api/media/display/a?r=90');
  });

  it('is a plain resolve for an unrotated photo', () => {
    expect(rotatedUrl(getFullUrl, { rotation: 0 }, '/api/media/display/a'))
      .toBe('https://pond/api/media/display/a');
  });

  it('falls back to the item own thumbnail when no path is given', () => {
    expect(rotatedUrl(getFullUrl, { rotation: 90, thumbnailUrl: '/api/media/thumbnails/a.webp' }))
      .toBe('https://pond/api/media/thumbnails/a.webp?r=90');
    // Local device assets have `url` and no generated thumbnail.
    expect(rotatedUrl(getFullUrl, { url: 'file:///a.jpg' })).toBe('https://pondfile:///a.jpg');
  });

  it('returns null rather than throwing when it has nothing to work with', () => {
    expect(rotatedUrl(getFullUrl, null)).toBeNull();
    expect(rotatedUrl(getFullUrl, {})).toBeNull();
    expect(rotatedUrl(null, { thumbnailUrl: '/a' })).toBeNull();
  });
});
