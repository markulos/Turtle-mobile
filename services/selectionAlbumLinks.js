/**
 * Turn a multi-selection into one public album link.
 *
 * The selection bar already had two ways to send things out of the vault, and
 * both scale badly past a handful of items: the OS share sheet pulls every
 * original onto the phone and uploads them again at the far end, and a
 * per-item link would drop twelve separate URLs into a chat.
 *
 * This is the third: name the selection, and it becomes a real album in the
 * vault with one link that opens the whole thing in a browser.
 *
 * ── The thing to understand before touching this ─────────────────────────
 * An album is NOT a snapshot. Server-side, `album_shares.album` is matched
 * against the tag index at request time, `COLLATE NOCASE`
 * (server/routes/albumShares.js). Album membership IS "carries this tag" —
 * there is no membership table. Two consequences, and the whole design of the
 * naming step follows from them:
 *
 *   1. Reusing an existing name shares EVERYTHING already carrying it. Type
 *      "Summer" when a 240-photo "Summer" exists and the link publishes 252
 *      photos, not the 12 that were selected. Case is no defence — "summer"
 *      collides too. So the caller must resolve a collision DELIBERATELY,
 *      which is what `findAlbumCollision` is for; it is not advisory.
 *
 *   2. The album keeps growing. Anything tagged with that name later joins the
 *      live link on its own. For a deliberately-reused album that's the point;
 *      for a fresh one it simply never happens.
 *
 * ── Why there is no waiting here ─────────────────────────────────────────
 * Unlike a single-video link (services/mediaShareLinks.js), nothing has to be
 * transcoded before the first unfurl. The album page's preview card is a
 * title, a count and a cover JPEG, all of which the server can produce on
 * demand — so the link is safe to hand out the moment it's minted.
 */

/** Album names are compared the way SQLite compares them: case-insensitively. */
const fold = (s) => String(s ?? '').trim().toLowerCase();

/**
 * "22 August 2026", "August 2026", "2019 – 2026".
 *
 * Deliberately the same shapes the server puts in the preview card's
 * description, so the name someone accepts here and the line their recipient
 * reads are visibly the same family rather than two different date dialects.
 * Months are spelled out because a shared link crosses date-format borders and
 * 03/08 is two different days depending on who opens it.
 */
export function suggestAlbumName(items) {
  const stamps = (Array.isArray(items) ? items : [])
    .map((it) => Number(it?.originalDate ?? it?.uploadDate ?? it?.date))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (!stamps.length) {
    const n = Array.isArray(items) ? items.length : 0;
    return n === 1 ? '1 photo' : `${n} photos`;
  }

  const from = new Date(Math.min(...stamps));
  const to = new Date(Math.max(...stamps));
  try {
    const month = (d) => d.toLocaleDateString('en-GB', { month: 'long' });
    if (from.toDateString() === to.toDateString()) {
      return to.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    if (from.getFullYear() !== to.getFullYear()) return `${from.getFullYear()} – ${to.getFullYear()}`;
    if (from.getMonth() !== to.getMonth()) return `${month(from)} – ${month(to)} ${to.getFullYear()}`;
    return `${month(to)} ${to.getFullYear()}`;
  } catch {
    return `${stamps.length} photos`;
  }
}

/**
 * The album registry, for collision checking.
 *
 * Returns `{ names, counts }` — `counts` keyed by the album's REAL casing, so
 * a collision can be reported with the name as it actually exists rather than
 * as it was typed.
 */
export async function loadAlbumIndex(api) {
  const res = await api.get('/media/albums');
  const names = Array.isArray(res?.albums) ? res.albums : [];
  return { names, counts: res?.counts || {} };
}

/**
 * Does this name already belong to an album? Returns `{ name, count }` with
 * the EXISTING spelling, or null.
 *
 * The count is what makes the warning worth reading: "already exists" is easy
 * to wave past, "240 photos" is not.
 */
export function findAlbumCollision(index, candidate) {
  const key = fold(candidate);
  if (!key) return null;
  const hit = (index?.names || []).find((n) => fold(n) === key);
  if (!hit) return null;
  return { name: hit, count: Number(index?.counts?.[hit]) || 0 };
}

/** Names that would work locally but produce a confusing or unusable album. */
export function validateAlbumName(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return 'Give the album a name.';
  if (trimmed.length > 120) return 'That name is too long.';
  // The tag index is the album index — a comma would read as two tags in
  // several of the older upload paths, and quotes break the preview markup's
  // escaping story for no benefit.
  if (/[",]/.test(trimmed)) return 'Names can’t contain commas or quotation marks.';
  return null;
}

/**
 * Add the selection to `album`, then mint a public link for it.
 *
 * Two calls, in this order and not the other: the tag write is what MAKES the
 * album (the bulk route registers a brand-new tag in the albums table as a
 * side effect), and minting a share for an album that doesn't exist yet would
 * produce a link that resolves to nothing for however long the write takes.
 *
 * `PUT /media/tags/bulk` is non-destructive and applies the whole batch in one
 * SQLite transaction — it appends the album tag and leaves every other tag on
 * every item alone, so this can be used to grow an existing album safely.
 *
 * @param {{get:Function,post:Function,put:Function}} api
 * @param {object} opts
 * @param {string[]} opts.ids           media ids in the selection
 * @param {string}   opts.album         album name (= the tag)
 * @param {string}   [opts.title]       what recipients see; defaults to `album`
 * @param {boolean}  [opts.allowDownload=true]
 * @param {boolean}  [opts.allowUpload=false]
 * @param {string}   [opts.password]
 * @returns {Promise<object>} the created share, including `url`
 */
export async function createAlbumLink(api, opts) {
  const {
    ids, album, title, allowDownload = true, allowUpload = false, password,
  } = opts || {};

  const name = String(album ?? '').trim();
  const problem = validateAlbumName(name);
  if (problem) throw new Error(problem);
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('Nothing selected.');

  const tagged = await api.put('/media/tags/bulk', {
    ids: ids.map(String),
    add: [name],
  });
  if (!tagged?.success) {
    throw new Error(tagged?.error || 'Could not save the album');
  }
  // `updated` counts rows the server actually found and wrote. A short count
  // means some ids no longer exist (deleted while the sheet was open), which
  // is survivable — but reporting the requested number would be a lie the
  // recipient discovers instead of the sender.
  const added = Number(tagged.updated) || 0;

  const res = await api.post('/album-shares', {
    album: name,
    title: (title || '').trim() || undefined,
    allowDownload,
    allowUpload,
    password: password || undefined,
  });
  if (!res?.share) throw new Error(res?.error || 'Could not create the link');

  return { ...res.share, added, requested: ids.length };
}
