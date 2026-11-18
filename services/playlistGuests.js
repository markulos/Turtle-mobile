/**
 * playlistGuests — somebody else's track, on one of my playlists.
 *
 * Mark, 2026-11-18: "make it possible to add shared with me tracks to my
 * personal playlists".
 *
 * ── Why this cannot be a tag ─────────────────────────────────────────────
 *
 * A playlist IS a tag on a media row (MusicVault says so, and so does
 * server/routes/albumAccess.js). Every playlist write in this app is therefore
 * `PUT /api/media/:id/tags` — and that statement ends
 * `WHERE id = ? AND user_id IS ?`. A track somebody shared with me is THEIR
 * row. The write does not fail loudly; it changes nothing and answers 404.
 *
 * And it should not succeed. Tags on a row are the owner's own filing: adding
 * a shared track to my "Sunday" playlist must not put the word Sunday on
 * somebody else's library row, where it would show up in THEIR playlists.
 *
 * So the membership is MINE, kept on my side: playlist name → the foreign
 * media ids I have put on it. My own tracks still use tags, unchanged — this
 * holds only the guests.
 *
 * ── Where it lives, and what that costs ──────────────────────────────────
 *
 * `users.settings`, through `PATCH /api/me/settings` — the per-user JSON blob
 * (server.js). No new table and no server deploy, which is the difference
 * between this shipping now and waiting on one.
 *
 * The blob is ONE column rewritten whole on every save, so everything here is
 * capped and nothing but ids and names is stored — never a title, never a URL.
 * Two consequences that are not obvious:
 *
 *   · it is PER-USER and last-writer-wins over the whole key. That is exactly
 *     right for "my playlists" and would be wrong for anything shared, which
 *     is why sharing a playlist out goes through real share rows instead.
 *   · a malformed entry must cost that entry and nothing else. The key sits
 *     beside every other setting in a store with no schema, so `decodeGuests`
 *     is written to survive anything.
 *
 * Names are matched CASE-INSENSITIVELY, because that is how a playlist name is
 * matched everywhere else (`COLLATE NOCASE` on the server, and the picker's own
 * search) — "Sunday" and "sunday" are one playlist to everything the user can
 * see, and two keys here would be a track that vanished.
 */

/** The settings key. Shared with every other per-user setting. */
export const GUESTS_KEY = 'musicPlaylistGuests';

/** Caps. One blob, rewritten whole — see the note above. */
export const MAX_PLAYLISTS = 60;
export const MAX_PER_PLAYLIST = 300;
export const MAX_NAME = 80;

const key = (name) => String(name || '').trim().toLowerCase();

/**
 * The stored blob → a usable map.
 *
 * Shape in, shape out: `{ [lowercased name]: { name, ids } }`. The display
 * name is carried so a playlist that exists ONLY as guests still has a name to
 * draw — adding a shared track to a brand-new playlist is a thing somebody
 * will do first.
 */
export function decodeGuests(raw) {
  const out = new Map();
  if (!raw || typeof raw !== 'object') return out;
  for (const [rawName, value] of Object.entries(raw)) {
    const name = String(rawName || '').trim().slice(0, MAX_NAME);
    if (!name) continue;
    // Two accepted shapes: the array it writes, and a `{ name, ids }` object,
    // so a future field cannot orphan everything written before it.
    const list = Array.isArray(value) ? value : (Array.isArray(value?.ids) ? value.ids : null);
    if (!list) continue;
    const ids = [];
    const seen = new Set();
    for (const id of list) {
      const clean = String(id ?? '').trim();
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      ids.push(clean);
      if (ids.length >= MAX_PER_PLAYLIST) break;
    }
    if (!ids.length) continue;
    const display = typeof value?.name === 'string' && value.name.trim()
      ? value.name.trim().slice(0, MAX_NAME)
      : name;
    out.set(key(name), { name: display, ids });
    if (out.size >= MAX_PLAYLISTS) break;
  }
  return out;
}

/** …and back, in the array shape (smaller, and what every reader accepts). */
export function encodeGuests(guests) {
  const out = {};
  for (const entry of guests.values()) {
    if (!entry?.ids?.length) continue;
    out[entry.name] = entry.ids.slice(0, MAX_PER_PLAYLIST);
  }
  return out;
}

/** The foreign ids on one playlist. */
export function guestIdsFor(guests, name) {
  return guests.get(key(name))?.ids || [];
}

/** Every playlist NAME one foreign track is on — the picker's ticks. */
export function guestPlaylistsOf(guests, mediaId) {
  const id = String(mediaId ?? '').trim();
  if (!id) return [];
  const names = [];
  for (const entry of guests.values()) {
    if (entry.ids.includes(id)) names.push(entry.name);
  }
  return names.sort((a, b) => a.localeCompare(b));
}

/**
 * Add a foreign track to a playlist. Returns a NEW map, or the same one when
 * there was nothing to do — so a caller can skip the save.
 *
 * Refuses past the caps rather than silently dropping the oldest: a playlist
 * that quietly forgets its first track is worse than one that says it is full.
 */
export function addGuest(guests, name, mediaId) {
  const clean = String(name || '').trim().slice(0, MAX_NAME);
  const id = String(mediaId ?? '').trim();
  if (!clean || !id) return { guests, added: false, full: false };
  const k = key(clean);
  const entry = guests.get(k);
  if (entry?.ids.includes(id)) return { guests, added: false, full: false };
  if (!entry && guests.size >= MAX_PLAYLISTS) return { guests, added: false, full: true };
  if (entry && entry.ids.length >= MAX_PER_PLAYLIST) return { guests, added: false, full: true };
  const next = new Map(guests);
  // The EXISTING display name wins: the picker matches case-insensitively, so
  // typing "sunday" into a playlist called "Sunday" must not rename it.
  next.set(k, { name: entry?.name || clean, ids: [...(entry?.ids || []), id] });
  return { guests: next, added: true, full: false };
}

/** Take a foreign track off a playlist; an emptied playlist drops out. */
export function removeGuest(guests, name, mediaId) {
  const k = key(name);
  const id = String(mediaId ?? '').trim();
  const entry = guests.get(k);
  if (!entry || !id || !entry.ids.includes(id)) return { guests, removed: false };
  const ids = entry.ids.filter((x) => x !== id);
  const next = new Map(guests);
  if (ids.length) next.set(k, { name: entry.name, ids });
  else next.delete(k);
  return { guests: next, removed: true };
}

/**
 * Forget a track entirely — every playlist it was on.
 *
 * For when a share is revoked or left: the track is gone from the pond list,
 * and an id that can never resolve again is dead weight in a capped blob.
 */
export function forgetGuest(guests, mediaId) {
  const id = String(mediaId ?? '').trim();
  if (!id) return { guests, removed: false };
  let removed = false;
  const next = new Map();
  for (const [k, entry] of guests) {
    if (!entry.ids.includes(id)) { next.set(k, entry); continue; }
    removed = true;
    const ids = entry.ids.filter((x) => x !== id);
    if (ids.length) next.set(k, { name: entry.name, ids });
  }
  return { guests: removed ? next : guests, removed };
}

/** Every playlist name that exists ONLY because of guests. */
export function guestNames(guests) {
  return Array.from(guests.values()).map((e) => e.name);
}

export default {
  GUESTS_KEY,
  MAX_PLAYLISTS,
  MAX_PER_PLAYLIST,
  addGuest,
  decodeGuests,
  encodeGuests,
  forgetGuest,
  guestIdsFor,
  guestNames,
  guestPlaylistsOf,
  removeGuest,
};
