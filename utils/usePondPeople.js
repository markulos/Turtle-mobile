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

/** baseUrl → Map(id → { userId, name, avatarUrl }). Resolved answers only. */
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
  return map;
}

export default function usePondPeople() {
  const { api, getBaseUrl } = useServer();
  const key = getBaseUrl();
  // Seeded from the cache, so a card mounting after the first one never renders
  // a frame of nameless discs.
  const [people, setPeople] = useState(() => cache.get(key) || EMPTY);

  useEffect(() => {
    const have = cache.get(key);
    if (have) { setPeople(have); return undefined; }

    let alive = true;
    let promise = inFlight.get(key);
    if (!promise) {
      promise = fetchPeople(api).then(
        (map) => { cache.set(key, map); inFlight.delete(key); return map; },
        (e) => { inFlight.delete(key); throw e; },
      );
      inFlight.set(key, promise);
    }
    promise.then((map) => { if (alive) setPeople(map); }).catch(() => { /* decoration */ });
    return () => { alive = false; };
  }, [api, key]);

  return people;
}

/** Forget what we know — for tests, and for a sign-out that changes who is who. */
export function __resetPondPeople() {
  cache.clear();
  inFlight.clear();
}
