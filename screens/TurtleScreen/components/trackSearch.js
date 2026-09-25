/**
 * Finding a track in the Music vault.
 *
 * Boards and Files have had a search for a while; Music had none at all, which
 * meant the only way to a track was to scroll the whole library. This is the
 * matching half of fixing that — pure, so it can be tested without a player.
 *
 * Three fields are worth searching, and they are not equal:
 *   • the TITLE, which is what you are almost always typing;
 *   • the SOURCE (the uploader/artist line under it);
 *   • the PLAYLISTS it is in — tags double as playlists for audio, so "gym"
 *     should find the tracks filed under Gym even though no title says it.
 *
 * Same AND-over-words rule as everywhere else in the app: every word has to
 * appear somewhere. Two surfaces disagreeing about what "matches" means is
 * worse than either rule being imperfect.
 */

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Tokenise once per keystroke; the word-boundary regexes are the expensive bit. */
export function buildTrackQuery(raw) {
  const text = String(raw || '').trim().toLowerCase();
  const tokens = text.split(/\s+/).filter(Boolean);
  return {
    text,
    tokens,
    boundaries: tokens.map((t) => new RegExp(`(^|[^a-z0-9])${escapeRe(t)}`, 'i')),
  };
}

/**
 * The searchable text of one track.
 *
 * `title`/`source` are passed in rather than imported, because the vault's own
 * mapper (services/musicTrackMapper) already owns how a row becomes a title —
 * including the local rename overrides — and this must not grow a second
 * opinion about it.
 */
export function trackFields(row, { title, source, tags } = {}) {
  const list = (Array.isArray(tags) ? tags : []).map((t) => String(t).toLowerCase());
  return {
    title: String(title ?? row?.originalName ?? row?.filename ?? '').toLowerCase(),
    source: String(source ?? '').toLowerCase(),
    // Both shapes, because the two questions are different: `tags` answers
    // "does this word appear in any playlist name", `tagList` answers "is a
    // playlist called exactly this" — and only the second deserves the big
    // bonus below. Joined alone, a playlist called "Kavinsky covers" would
    // score as though it were named "Kavinsky".
    tags: list.join(' '),
    tagList: list,
  };
}

/**
 * How well a track answers the query — higher is better, null is "no match".
 *
 * A title hit beats the same word in the source line, which beats a playlist
 * name; the reasoning is the one the note search uses and the server's BM25
 * weights encode — WHERE a word matched says more than how often.
 */
export function scoreTrack(fields, q) {
  if (!q || q.tokens.length === 0) return 0;
  const hay = `${fields.title} ${fields.source} ${fields.tags}`;
  for (const t of q.tokens) if (!hay.includes(t)) return null;

  let score = 0;
  if (fields.title === q.text) score += 120;
  else if (fields.title.startsWith(q.text)) score += 70;
  else if (fields.title.includes(q.text)) score += 45;
  // A playlist named EXACTLY the query — typing it is as deliberate as typing
  // a title, so it ranks with them rather than with incidental word hits.
  else if ((fields.tagList || []).includes(q.text)) score += 25;

  for (let i = 0; i < q.tokens.length; i++) {
    const t = q.tokens[i];
    if (fields.title.includes(t)) score += 12;
    if (q.boundaries[i].test(fields.title)) score += 8;
    if (fields.source.includes(t)) score += 6;
    if (fields.tags.includes(t)) score += 5;
  }
  return score;
}

/**
 * Rank a library against a query.
 *
 * `describe(row)` hands back `{ title, source, tags }` for one track — the
 * caller's job, because only it knows about renames and playlist tags.
 *
 * An empty query returns the library UNCHANGED, in its own order. That matters:
 * not searching has to leave the vault exactly as it was, not re-sort it.
 */
export function rankTracks(tracks, query, describe, { limit = 200 } = {}) {
  const list = Array.isArray(tracks) ? tracks : [];
  const q = buildTrackQuery(query);
  if (q.tokens.length === 0) return list;

  const scored = [];
  for (const row of list) {
    const score = scoreTrack(trackFields(row, describe ? describe(row) : {}), q);
    if (score === null) continue;
    scored.push({ row, score });
  }
  // Stable within a score: the library's own order is meaningful (newest
  // first), so equal matches must not be shuffled by the sort.
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.row);
}

/** "3 tracks" / "1 track" — what the results line says it found. */
export function trackCountLabel(n) {
  return n === 1 ? '1 track' : `${n} tracks`;
}
