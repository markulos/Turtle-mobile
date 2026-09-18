// globalSearch — one query, every domain. Fans out to the server's existing
// FTS endpoints (tasks, notes, media) in parallel and matches boards by name
// on the client; each domain fails on its own (a slow vault never hides the
// tasks). Everything-style ranking: within a domain, hits whose TITLE starts
// with the query come first, then the server's own relevance order.

/** FTS snippets carry literal <mark> tags — plain text for a native label. */
export function stripMarks(s) {
  return String(s || '').replace(/<\/?mark>/g, '');
}

/**
 * Prefix-first, stable: items whose `textOf(item)` starts with the query
 * (case-insensitive) move ahead; relative order is kept on both sides.
 */
export function rankPrefixFirst(items, query, textOf) {
  const q = String(query || '').trim().toLowerCase();
  if (!q || !Array.isArray(items)) return Array.isArray(items) ? items : [];
  const first = [];
  const rest = [];
  for (const it of items) {
    const t = String(textOf(it) || '').trim().toLowerCase();
    (t.startsWith(q) ? first : rest).push(it);
  }
  return first.concat(rest);
}

/** Boards by name: prefix matches first, then substring; `limit` at most. */
export function matchBoards(names, query, limit = 8) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const list = (Array.isArray(names) ? names : []).filter((n) => typeof n === 'string');
  const hits = list.filter((n) => n.toLowerCase().includes(q));
  return rankPrefixFirst(hits, q, (n) => n).slice(0, limit);
}

const taskTitle = (t) => t?.title || '';
const noteTitle = (n) => (n?.content || '').split('\n')[0];
const mediaTitle = (m) => m?.originalName || m?.filename || '';

/**
 * Query every domain at once. Never rejects: a failed domain comes back empty
 * and is named in `errors`.
 *   api    — ServerContext's api ({ get })
 *   query  — the raw text
 *   boards — board names already in hand (GET /projects), matched locally
 */
export async function searchEverything(api, query, { boards = [], limits = {} } = {}) {
  const q = String(query || '').trim();
  const empty = { query: q, tasks: [], notes: [], media: [], documents: [], boards: [], errors: [] };
  if (!q) return empty;
  const enc = encodeURIComponent(q);
  const lim = { tasks: 20, notes: 20, media: 24, documents: 20, ...limits };
  const [tasks, notes, media, documents] = await Promise.allSettled([
    api.get(`/tasks/search?q=${enc}&scope=all&limit=${lim.tasks}`),
    api.get(`/turtle/notes/search?q=${enc}&limit=${lim.notes}`),
    api.get(`/media/search?q=${enc}&kind=visual&limit=${lim.media}`),
    api.get(`/media/search?q=${enc}&kind=document&limit=${lim.documents}`),
  ]);
  const errors = [];
  const take = (settled, key, name) => {
    if (settled.status !== 'fulfilled') { errors.push(name); return []; }
    const v = settled.value && settled.value[key];
    return Array.isArray(v) ? v : [];
  };
  return {
    query: q,
    tasks: rankPrefixFirst(take(tasks, 'results', 'tasks'), q, taskTitle),
    notes: rankPrefixFirst(take(notes, 'notes', 'notes'), q, noteTitle),
    media: rankPrefixFirst(take(media, 'items', 'media'), q, mediaTitle),
    documents: rankPrefixFirst(take(documents, 'items', 'documents'), q, mediaTitle),
    boards: matchBoards(boards, q),
    errors,
  };
}
