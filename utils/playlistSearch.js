import { matchesQuery, normalize } from './fuzzyMatch';

/**
 * What the playlist picker should show for what has been typed.
 *
 * One field does both jobs in that sheet: it FINDS a playlist, and when what
 * you typed is not one yet, it offers to make it. Keeping that decision here
 * rather than in the sheet is what makes "does this playlist exist?" a rule
 * with tests instead of a condition buried in a render.
 *
 * ── Why an exact match kills the create row ─────────────────────────────────
 *
 * Playlists here are TAGS (see MusicVault's tags write), so two playlists with
 * the same name are the same playlist — "create" would silently be "add to the
 * one you already have", by a path that looks like it made something new. The
 * comparison is the NORMALIZED one, because "coca cola", "Coca Cola" and
 * "Coca-Cola" are all the same tag to a person even where they are not to a
 * string compare. The name offered for creation is still what was typed,
 * though, spaces and capitals and all — normalize is for deciding, never for
 * what gets stored.
 *
 * ── Why the matches are ranked ──────────────────────────────────────────────
 *
 * The matcher is deliberately forgiving (typos, one word for two), so a loose
 * match can easily outrank the obvious one in library order. Ranking exact
 * first, then "starts with", then "contains", then everything else the matcher
 * let through, means the thing you are plainly typing is the first row — and
 * within a rank the library's own order is kept, so the list never shuffles
 * for reasons the user cannot see.
 */
export function playlistPicks(query, playlists = []) {
  const typed = String(query == null ? '' : query).trim();
  const names = (playlists || []).filter((n) => typeof n === 'string' && n.length > 0);
  if (!typed) return { matches: names.slice(), createName: null };

  // A query of pure punctuation normalizes to nothing: there is no token to
  // narrow by, so every playlist stays visible — and the name is still offered
  // for creation, unless a playlist already normalizes to the same nothing.
  const q = normalize(typed);
  const ranked = [];
  names.forEach((name, i) => {
    if (!matchesQuery(typed, name)) return;
    const n = normalize(name);
    const rank = n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3;
    ranked.push({ name, rank, i });
  });
  ranked.sort((a, b) => (a.rank - b.rank) || (a.i - b.i));

  return {
    matches: ranked.map((r) => r.name),
    createName: names.some((n) => normalize(n) === q) ? null : typed,
  };
}
