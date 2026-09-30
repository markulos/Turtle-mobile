/**
 * mediaRotation — the cache-bust token for a rotated photo.
 *
 * THE PROBLEM THIS EXISTS FOR. The pond serves every media tier with
 * `Cache-Control: public, max-age=2592000, immutable`, and a rotate overwrites
 * the thumbnail files IN PLACE (`<id>.webp` keeps its name) while the
 * display/preview tiers keep their `/api/media/display/<id>` URL. expo-image
 * caches by URL on disk. So a rotate that doesn't change the URL is INVISIBLE
 * on the phone — for up to thirty days — even though the server did the work.
 *
 * The fix is the same one avatars use (`/api/avatars/<id>.jpg?v=…`): put a
 * token in the query string. The server ignores `r`; it exists purely to give
 * each angle its own cache entry.
 *
 * `rotation === 0` returns the URL UNTOUCHED. That matters: it keeps every
 * already-cached thumbnail in the app valid, so shipping this costs nothing for
 * the overwhelming majority of photos that nobody has ever rotated.
 *
 * Dependency-free on purpose (no react-native imports) so it runs under plain
 * node as well as jest.
 */

/**
 * The item's rotation as one of 0 | 90 | 180 | 270.
 *
 * Tolerant by design — this reads rows that may predate the `rotation` column
 * (undefined), came back as NULL from SQLite, or arrived as a string.
 */
export function rotationOf(item) {
  const raw = item && item.rotation;
  const n = Math.round(Number(raw) || 0);
  if (!Number.isFinite(n)) return 0;
  return ((((Math.trunc(n / 90) % 4) + 4) % 4) * 90);
}

/**
 * Append the rotation token to a media URL, if there is one to append.
 *
 * An unusable URL (null, undefined, '') comes back as `null` rather than being
 * passed through — one shape for "nothing to load", so a caller never has to
 * tell an empty string apart from a missing one.
 *
 * @param {string|null|undefined} url
 * @param {number} rotation  already-normalized degrees, or anything rotationOf accepts
 * @returns {string|null} the URL, with `?r=<rotation>` when rotation is non-zero
 */
export function withRotation(url, rotation) {
  if (!url) return null;
  const deg = rotationOf({ rotation });
  if (!deg) return url;
  // Respect a URL that already carries a query string — the share/quality
  // paths build those, and a second '?' would break the request.
  return `${url}${url.includes('?') ? '&' : '?'}r=${deg}`;
}

/**
 * The common case: resolve a media path to a full URL and bust it for `item`'s
 * rotation in one step. Passing the item (rather than a bare angle) is what
 * keeps call sites from forgetting the token.
 *
 * @param {(path: string) => string} getFullUrl
 * @param {object|null} item      the media row
 * @param {string|null} [path]    defaults to the item's own thumbnail
 */
export function rotatedUrl(getFullUrl, item, path) {
  const p = path ?? (item && (item.thumbnailUrl || item.url));
  if (!p || typeof getFullUrl !== 'function') return null;
  return withRotation(getFullUrl(p), rotationOf(item));
}
