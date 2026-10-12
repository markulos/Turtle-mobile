/**
 * albumPicker — the arithmetic behind "which album?".
 *
 * ─── An album is a registered tag ──────────────────────────────────────────
 *
 * On the pond, `PUT /media/:id/tags` and the bulk tag route auto-register
 * every new tag into the albums table, and a photo is "in" an album by
 * carrying its name as a tag. So filing a photo and tagging it are the same
 * write — which is why the album picker needs no server change, and why the
 * name matching here has to agree with the server's.
 *
 * The server matches album names CASE-INSENSITIVELY (`GROUP BY tag COLLATE
 * NOCASE`), so "Wedding" and "wedding" are one album there. Offering "New
 * album 'wedding'" to someone who already has "Wedding" would make a row that
 * silently merges into the existing one — so this does not offer it.
 *
 * Pure: no react-native, no network. The sheet draws what these return.
 */

/** The longest an album name may be. Long enough for a sentence, short enough
 *  that the row stays one line everywhere it is listed. */
export const MAX_ALBUM_NAME = 60;

/** Collapse whitespace, trim, cap. What actually gets written. */
export function cleanAlbumName(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ALBUM_NAME);
}

const lower = (v) => String(v ?? '').trim().toLowerCase();

/** Does an album by this name already exist, however it was capitalised? */
export function albumExists(albums, name) {
  const key = lower(name);
  if (!key) return false;
  return (Array.isArray(albums) ? albums : []).some((a) => lower(a?.name) === key);
}

/**
 * Should the sheet offer to make a new album from what has been typed?
 *
 * Only for a real name that is not already an album. The empty field offers
 * nothing — a "New album ''" row is a button that cannot work.
 */
export function isNewAlbumName(albums, raw) {
  const name = cleanAlbumName(raw);
  if (!name) return false;
  return !albumExists(albums, name);
}

/**
 * The albums to list, for what has been typed.
 *
 * Matches anywhere in the name, not just the start: people name albums
 * "Trip — Rome 2024" and then look for "rome". Ordered by how much is in them
 * so the albums you actually use are the ones under your thumb, with an
 * alphabetical tiebreak so the order never wobbles between renders.
 */
export function albumSuggestions(albums, query, limit = 60) {
  const q = lower(query);
  const list = (Array.isArray(albums) ? albums : [])
    .filter((a) => a && typeof a.name === 'string' && a.name.trim())
    .map((a) => ({ name: a.name, count: Number(a.count) || 0 }));
  const matched = q ? list.filter((a) => lower(a.name).includes(q)) : list;
  return matched
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/**
 * What a filing actually writes: the names to ADD, given what the photos are
 * already in.
 *
 * Empty when every photo is already there, which is the caller's cue to do
 * nothing at all rather than send a write that changes nothing and invalidates
 * every cache on the pond.
 */
export function tagsToAdd(name, inAlbums) {
  const clean = cleanAlbumName(name);
  if (!clean) return [];
  const have = new Set((Array.isArray(inAlbums) ? inAlbums : []).map(lower));
  return have.has(lower(clean)) ? [] : [clean];
}

/** The albums a set of photos is ALREADY in — the names every one of them
 *  carries. Shown ticked, so "add to Wedding" is not offered for a photo that
 *  is in Wedding. */
export function commonAlbums(items, tagsOf) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  if (list.length === 0) return [];
  let common = null;
  for (const it of list) {
    const tags = (typeof tagsOf === 'function' ? tagsOf(it) : it.tags) || [];
    const names = Array.isArray(tags) ? tags.filter((t) => typeof t === 'string') : [];
    common = common === null ? names.slice() : common.filter((t) => names.includes(t));
    if (common.length === 0) break;
  }
  return common || [];
}
