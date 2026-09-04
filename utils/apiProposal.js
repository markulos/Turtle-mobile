/**
 * A proposed API call, as the chat card reads it.
 *
 * The assistant can look things up on its own, but anything that CHANGES data
 * comes back as a proposal instead of a result (server: `services/aiTools.js`).
 * This module turns that proposal into something a person can decide about in
 * one glance — because the decision is the whole point, and a card that shows
 * `PATCH /api/tasks/t-1729` and nothing else is asking for a rubber stamp
 * rather than a judgement.
 *
 * Pure and free of react-native imports, so the sentence-building and the
 * safety classification can be tested without a renderer — the same rule
 * `transcriptionProgress` and `statsFormat` follow.
 */

/** Risk levels the server assigns. Anything else is treated as the worst case. */
const KNOWN_RISKS = ['write', 'destructive'];

/**
 * Verbs, by method, for the one-line summary.
 *
 * Deliberately concrete: "Delete" rather than "modify", "Add" rather than
 * "perform". A card whose verb is vague reads as safe no matter what it does.
 */
const VERB = {
  POST: 'Create',
  PUT: 'Replace',
  PATCH: 'Update',
  DELETE: 'Delete',
};

/** Path segments that name a namespace rather than a thing. */
const NAMESPACES = new Set(['api', 'turtle']);

/**
 * The noun a path is about — the FIRST real segment under `/api`.
 *
 * `/api/tasks/single` → "task", `/api/tasks/t-17` → "task",
 * `/api/turtle/notes/n-3` → "note".
 *
 * First rather than last, which is the version this started as: walking
 * backwards finds the route's qualifier, not its subject, so `/api/tasks/single`
 * came out as "Create single" and `/api/media/heal` as "Create heal". The
 * leading segment is the resource in every route on this server, and it is
 * stable in a way the tail is not. Losing a little specificity on a nested path
 * (`/api/media/album/Trip` reads as "media") is the right trade — the full path
 * is on the card directly beneath.
 */
export function subjectOf(path) {
  const parts = String(path || '')
    .split('?')[0]
    .split('/')
    .filter(Boolean)
    .filter((segment) => !NAMESPACES.has(segment));
  const head = parts[0];
  if (!head) return 'the server';
  // Singular reads correctly for the single-item case these cards are almost
  // always about: "Delete task", not "Delete tasks". `ss` is excluded so
  // "passwords" survives as "password" while a word like "address" is left be.
  return /s$/.test(head) && !/ss$/.test(head) ? head.slice(0, -1) : head;
}

/**
 * Normalise whatever arrived in `intent.payload` into a renderable proposal,
 * or null if it is not one.
 *
 * The boundary is untrusted: this is a model-composed object that travelled
 * through a server and a socket. A card built from unvalidated fields is a
 * card that can lie about what the button does, so every field is checked and
 * anything unrecognised makes the whole thing null rather than "mostly fine".
 */
export function readProposal(intent) {
  if (!intent || intent.type !== 'TURTLE_API_CALL') return null;
  const payload = intent.payload;
  if (!payload || typeof payload !== 'object') return null;

  const method = String(payload.method || '').toUpperCase();
  const path = String(payload.path || '');
  if (!VERB[method]) return null;
  // Must be an in-app path. A proposal naming another host would render as if
  // it were local, which is the one thing the card must never do.
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) return null;

  return {
    method,
    path,
    query: payload.query && typeof payload.query === 'object' ? payload.query : null,
    body: payload.body && typeof payload.body === 'object' ? payload.body : null,
    // An unknown risk is treated as destructive. The card's job is to be
    // wrong in the direction that makes someone read it.
    risk: KNOWN_RISKS.includes(payload.risk) ? payload.risk : 'destructive',
    reason: typeof payload.reason === 'string' ? payload.reason.trim().slice(0, 200) : '',
    signature: typeof payload.signature === 'string' ? payload.signature : `${method} ${path}`,
  };
}

/** The headline: what pressing the button does, in one short sentence. */
export function summarise(proposal) {
  if (!proposal) return '';
  return `${VERB[proposal.method]} ${subjectOf(proposal.path)}`;
}

/**
 * The fields being sent, flattened for display.
 *
 * Values are stringified and clipped — a card is not a JSON viewer, and a
 * note body pasted in full would push the buttons off the screen. Nested
 * objects collapse to a type label rather than being rendered badly.
 */
export function fieldsOf(proposal, limit = 6) {
  if (!proposal) return [];
  const source = { ...(proposal.query || {}), ...(proposal.body || {}) };
  return Object.entries(source)
    .slice(0, limit)
    .map(([key, value]) => {
      let text;
      if (value === null || value === undefined) text = '—';
      else if (Array.isArray(value)) text = `${value.length} item${value.length === 1 ? '' : 's'}`;
      else if (typeof value === 'object') text = '…';
      else text = String(value);
      return { key, value: text.length > 80 ? `${text.slice(0, 80)}…` : text };
    });
}

/** How many fields the card is not showing, so it can say so rather than lie by omission. */
export function hiddenFieldCount(proposal, limit = 6) {
  if (!proposal) return 0;
  const total = Object.keys({ ...(proposal.query || {}), ...(proposal.body || {}) }).length;
  return Math.max(0, total - limit);
}

/**
 * The full path to request, query string included.
 *
 * Built here rather than in the component so the exact string the button will
 * send is the one the tests assert on — a card that displays one path and
 * requests another is the failure this feature cannot have.
 */
export function requestPath(proposal) {
  if (!proposal) return '';
  if (!proposal.query || !Object.keys(proposal.query).length) return proposal.path;
  const pairs = Object.entries(proposal.query)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return pairs.length ? `${proposal.path}?${pairs.join('&')}` : proposal.path;
}
