/**
 * Finding the note you mean, when linking one to a task.
 *
 * The picker used to be a `.includes()` over the first 200 notes: every
 * matching note scored the same, so you got the eight most RECENT matches
 * rather than the eight best, a two-word query only matched if those words sat
 * side by side, tags were invisible to it, and a note past the 200th could not
 * be found at all. With a few hundred notes that is the difference between
 * linking a note and giving up and typing the title into the task by hand.
 *
 * This module is the matching half, kept pure so it can be tested without
 * rendering: given a query and some notes, which ones match, in what order,
 * and what should the row say about WHY. The three tiers that FEED it
 * (loaded page → server FTS → trigram fuzzy) live in NoteLinkPicker, because
 * they are I/O.
 *
 * The AND-over-tokens rule is deliberately the same one the Notes screen and
 * the server's FTS use: a query matches when every word appears somewhere in
 * the note. Two surfaces disagreeing about what "matches" means is worse than
 * either rule being imperfect.
 */

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A note's display title: its first non-empty line. */
export function noteTitleOf(note, maxLen = 60) {
  const raw = String(note?.content || '').trim();
  if (!raw) return 'Untitled note';
  const first = (raw.split('\n').find((l) => l.trim()) || '').trim() || 'Untitled note';
  return first.length > maxLen ? `${first.slice(0, maxLen)}…` : first;
}

/**
 * Prepare a query once per keystroke instead of once per note.
 *
 * The word-boundary regexes are the reason this exists: scoring builds one per
 * token, and rebuilding them inside the loop is a few hundred RegExp
 * compilations per keystroke on a list this size.
 */
export function buildQuery(raw) {
  const text = String(raw || '').trim().toLowerCase();
  const tokens = text.split(/\s+/).filter(Boolean);
  return {
    text,
    tokens,
    // "starts a word" — `mil` hitting "milk" is a better signal than `mil`
    // hitting "familiar", and this is what tells them apart.
    boundaries: tokens.map((t) => new RegExp(`(^|[^a-z0-9])${escapeRe(t)}`, 'i')),
  };
}

/** The three fields a note is searched over, lowercased once. */
export function noteFields(note) {
  return {
    title: noteTitleOf(note, 200).toLowerCase(),
    content: String(note?.content || '').toLowerCase(),
    body: String(note?.description || '').toLowerCase(),
    tags: (Array.isArray(note?.tags) ? note.tags : []).join(' ').toLowerCase(),
  };
}

/**
 * How well a note answers the query — higher is better, null is "no match".
 *
 * The weights encode one idea: WHERE a word matched says more than how many
 * times it did. A query that is the note's whole title is almost certainly the
 * note you meant; the same words scattered through a long description usually
 * are not. Tags sit between the two, because a tag is a deliberate label
 * rather than incidental prose — the same reason the server's BM25 weights
 * rank them above the description.
 */
export function scoreNote(note, q) {
  if (!q || q.tokens.length === 0) return 0;
  const f = noteFields(note);
  const hay = `${f.content} ${f.body} ${f.tags}`;
  // Every token must land somewhere, or it isn't a match at all.
  for (const t of q.tokens) if (!hay.includes(t)) return null;

  let score = 0;
  if (f.title === q.text) score += 120;            // it IS that note
  else if (f.title.startsWith(q.text)) score += 70; // typed the start of it
  else if (f.title.includes(q.text)) score += 45;   // the phrase, intact
  else if (f.tags.includes(q.text)) score += 25;    // a board/label, intact

  for (let i = 0; i < q.tokens.length; i++) {
    const t = q.tokens[i];
    if (f.title.includes(t)) score += 12;
    if (q.boundaries[i].test(f.title)) score += 8;
    if (f.tags.includes(t)) score += 7;
    if (f.body.includes(t)) score += 3;
  }

  // A short title that matched is a more precise hit than a long one carrying
  // the same words among many others. Small — it breaks ties, it doesn't lead.
  if (f.title.length > 0) score += Math.max(0, 8 - Math.floor(f.title.length / 20));
  return score;
}

/** Sort key for equal scores: the more recent note first. */
const createdMs = (n) => {
  const v = n?.createdAt ?? n?.created_at;
  if (typeof v === 'number') return v;
  const parsed = Date.parse(String(v || ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Why this note is in the list, when the title alone doesn't show it.
 *
 * A hit buried in a long description is invisible on a row that only renders
 * the title — two notes called "Shopping" look identical and you have to open
 * both. This lifts the matching sentence out. Null when the title already
 * carries the query, so the common case stays uncluttered.
 */
export function matchSnippet(note, q, width = 64) {
  if (!q || q.tokens.length === 0) return null;
  const f = noteFields(note);
  if (q.tokens.some((t) => f.title.includes(t))) return null;

  const source = String(note?.description || '');
  const lower = source.toLowerCase();
  for (const t of q.tokens) {
    const at = lower.indexOf(t);
    if (at < 0) continue;
    const start = Math.max(0, at - Math.floor((width - t.length) / 2));
    const end = Math.min(source.length, start + width);
    const cut = source.slice(start, end).replace(/\s+/g, ' ').trim();
    return `${start > 0 ? '…' : ''}${cut}${end < source.length ? '…' : ''}`;
  }
  // Nothing in the body, so the match came from a tag — name it.
  const tags = Array.isArray(note?.tags) ? note.tags : [];
  const hit = tags.find((tag) => q.tokens.some((t) => String(tag).toLowerCase().includes(t)));
  return hit ? `#${hit}` : null;
}

/**
 * Rank a pool of notes against a query.
 *
 * With no query this is "the most recent notes", which is what the picker
 * should show before you have typed anything — the note you want to link is
 * very often the one you just wrote.
 *
 * `kind` narrows to notes or to-dos; the picker links either, and with a few
 * hundred of both that filter is often faster than refining the words.
 */
export function rankNotes(notes, query, { limit = 40, kind = 'all' } = {}) {
  const pool = [];
  const seen = new Set();
  for (const n of notes || []) {
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    const type = n.type === 'todo' ? 'todo' : 'note';
    if (kind !== 'all' && kind !== type) continue;
    pool.push(n);
  }

  const q = buildQuery(query);
  if (q.tokens.length === 0) {
    return pool.sort((a, b) => createdMs(b) - createdMs(a)).slice(0, limit);
  }

  const scored = [];
  for (const n of pool) {
    const score = scoreNote(n, q);
    if (score === null) continue;
    scored.push({ n, score });
  }
  scored.sort((a, b) => (b.score - a.score) || (createdMs(b.n) - createdMs(a.n)));
  return scored.slice(0, limit).map((s) => s.n);
}

/** "just now" / "4h" / "3d" / "12 Mar" — the age column on a result row. */
export function noteAgeLabel(note, now = Date.now()) {
  const ms = createdMs(note);
  if (!ms) return '';
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  const d = new Date(ms);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${d.getDate()} ${month}`;
}
