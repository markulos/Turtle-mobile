/**
 * Everyone in the pond, by id — the name and the avatar, fetched ONCE per run.
 *
 * Things that store PEOPLE store ids (a note's `involvedUsers`, a task's
 * participants), and the server says so in as many words: resolving them on its
 * side would be a join per row. So the client resolves them — and the trap is
 * doing it per row. A list of sixty note cards each asking who its people are is
 * sixty requests for the same handful of names, fired during a scroll.
 *
 * So the answer is cached at MODULE scope, not in a component: a hook with its
 * own state would still fetch once per mounting card. Every card after the first
 * reads the map that is already there, synchronously, on its first render.
 *
 * ── Why /me as well as /friends ───────────────────────────────────────────
 * `/friends` is deliberately "everyone in my org EXCEPT me" (`id <> me`). A note
 * I am involved in therefore cannot find me in it, and I would be the one face
 * in the row with no name — which looks like a bug rather than like me. So the
 * two are fetched together and folded into one map.
 *
 * Keyed by base URL: the app is pointed at a dev pond and a real one, and a map
 * of dev names shown against production notes would be worse than no names.
 */
import { useEffect, useState } from 'react';
import { useServer } from '../context/ServerContext';

/**
 * baseUrl → { people: Map(id → { userId, name, avatarUrl }), meId }.
 *
 * `meId` rides along because /me is ALREADY fetched here — the map needs my own
 * name and face in it, since /friends is deliberately everyone-but-me. Which of
 * those ids is mine was being thrown away, and the alternative for a caller
 * that needs it is a second request for an answer this module already had.
 */
const cache = new Map();
/** baseUrl → the in-flight promise, so N cards mounting together share one. */
const inFlight = new Map();

const EMPTY = new Map();

/** Fold a /friends row or a /me user into the one shape a face row wants. */
function personOf(row) {
  const userId = String(row?.id || '').trim();
  if (!userId) return null;
  return {
    userId,
    name: row.name || row.displayName || null,
    avatarUrl: row.avatarUrl || null,
  };
}

async function fetchPeople(api) {
  const map = new Map();
  // Settled, not all: a pond that answers one and not the other should still
  // give up the names it has. Neither failing is worth shouting about — an
  // unresolved person falls back to a stable generated disc, which is the
  // correct degradation for a decoration.
  const [friends, me] = await Promise.all([
    api.get('/friends').catch(() => null),
    api.get('/me').catch(() => null),
  ]);
  for (const row of Array.isArray(friends?.friends) ? friends.friends : []) {
    const p = personOf(row);
    if (p) map.set(p.userId, p);
  }
  const mine = personOf(me?.user);
  if (mine) map.set(mine.userId, mine);
  return { people: map, meId: mine ? mine.userId : null };
}

/**
 * The shared resolve, as a hook: whatever is cached now, and a subscription to
 * the one in-flight fetch. Both public hooks below are a projection of it, so
 * asking for my id costs nothing on top of asking for the roster.
 */
function usePond() {
  const { api, getBaseUrl } = useServer();
  const key = getBaseUrl();
  // Seeded from the cache, so a card mounting after the first one never renders
  // a frame of nameless discs.
  const [entry, setEntry] = useState(() => cache.get(key) || null);

  useEffect(() => {
    const have = cache.get(key);
    if (have) { setEntry(have); return undefined; }

    let alive = true;
    let promise = inFlight.get(key);
    if (!promise) {
      promise = fetchPeople(api).then(
        (resolved) => { cache.set(key, resolved); inFlight.delete(key); return resolved; },
        (e) => { inFlight.delete(key); throw e; },
      );
      inFlight.set(key, promise);
    }
    promise.then((resolved) => { if (alive) setEntry(resolved); }).catch(() => { /* decoration */ });
    return () => { alive = false; };
  }, [api, key]);

  return entry;
}

export default function usePondPeople() {
  return usePond()?.people || EMPTY;
}

/**
 * My own user id, or null until /me has answered.
 *
 * For deciding what a screen may OFFER, never for deciding what is allowed —
 * the pond is the only thing that settles that. Treat null as "do not know
 * yet" rather than as "not me": hiding a control its owner needs is worse than
 * briefly showing one the server would ignore.
 */
export function useMyUserId() {
  return usePond()?.meId || null;
}

/** Forget what we know — for tests, and for a sign-out that changes who is who. */
export function __resetPondPeople() {
  cache.clear();
  inFlight.clear();
}
