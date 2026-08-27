import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useServer } from '../../../context/ServerContext';
import { MAX_ITEMS, groupKey } from '../../../utils/boardFrames';

/**
 * useBoardContents — what is actually in one GROUP of one board, fetched only
 * once you open that group.
 *
 * The canvas never needs a board's items to draw it. A frame's groups carry
 * their counts from `/projects-overview`, which the map already loaded, so
 * opening a board costs nothing at all. Only opening a group — Tasks, say —
 * asks the server for anything, and then only for that kind.
 *
 * Which is also why this fetches per KIND rather than taking the merged feed
 * and bucketing it: on a board with four hundred photos, the newest forty rows
 * are forty photos, and its handful of tasks are nowhere in them. The Tasks
 * group would sit there looking empty while claiming a count of four.
 *
 * The cache is keyed by board AND kind and never evicted within a visit —
 * closing and re-opening a group is instant, which matters because on a map
 * that is a thing you do constantly while looking for something. It IS
 * invalidated when a visit to the board's own timeline changed anything, and
 * wiped whole when the server changes (a different pond is a different set of
 * boards that may well share names with this one).
 *
 * @param keys  the open groups currently on screen, as `groupKey` strings.
 *              Fetching is driven by this rather than by every open group, so a
 *              group left open inside a board the user has since focused away
 *              from costs nothing until it is on screen again.
 * @returns {{ itemsOf, moreOf, invalidate }}
 */
export default function useBoardContents(keys) {
  const { api } = useServer();
  // { [`${board}/${kind}`]: { items: [...], hasMore: bool } }. Absent = never
  // fetched.
  const [contents, setContents] = useState({});
  // Keys with a request in flight or already answered, so a re-render can't
  // queue the same fetch twice. A ref, not state: it must be current DURING the
  // effect that reads it, not on the next render.
  const claimed = useRef(new Set());
  // Bumped when the whole cache stops being about the same pond. A response
  // that predates the bump is dropped rather than written into the new one.
  const generation = useRef(0);
  // Bumped to make the effect below LOOK again without anything having opened
  // or closed — how a targeted invalidate gets its refetch.
  const [nonce, setNonce] = useState(0);

  // A different server is a different pond — same names, different boards.
  useEffect(() => {
    generation.current += 1;
    claimed.current = new Set();
    setContents({});
  }, [api]);

  // Stable across renders that produce the same open groups, so the effect
  // below doesn't refire on every pan-induced re-render. Joined on a NUL,
  // which no board name can contain — a space could, and two different sets of
  // keys that join to the same string would look like no change at all.
  const wanted = useMemo(
    () => (Array.isArray(keys) ? [...new Set(keys.filter(Boolean))].sort() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [(Array.isArray(keys) ? keys : []).join('\u0000')],
  );

  useEffect(() => {
    for (const key of wanted) {
      if (claimed.current.has(key)) continue;
      claimed.current.add(key);
      // A group key is `board/kind`, and a board name may contain a slash —
      // so split off the LAST segment rather than the first.
      const cut = key.lastIndexOf('/');
      const name = key.slice(0, cut);
      const kind = key.slice(cut + 1);
      const gen = generation.current;
      // One past the cap, so "is there more?" needs no second call and no
      // reliance on the group's count (which counts rows this feed may merge
      // or scope differently).
      api.get(
        `/projects/${encodeURIComponent(name)}/timeline`
        + `?kind=${encodeURIComponent(kind)}&limit=${MAX_ITEMS + 1}`,
      )
        .then((r) => {
          if (gen !== generation.current) return;
          const rows = (r?.success && Array.isArray(r.items) ? r.items : []).map(normalise);
          setContents((prev) => ({
            ...prev,
            [key]: { items: rows.slice(0, MAX_ITEMS), hasMore: rows.length > MAX_ITEMS },
          }));
        })
        .catch(() => {
          // An unreachable group opens empty and says so — the rest of the map
          // stays usable, and the next open retries.
          if (gen !== generation.current) return;
          claimed.current.delete(key);
          setContents((prev) => (key in prev ? prev : { ...prev, [key]: { items: [], hasMore: false } }));
        });
    }
    // NO cleanup that cancels. This effect re-runs every time ANY group opens
    // or closes, and a per-run "is this still the live run?" flag — the obvious
    // thing to write here — throws away the answer to a request that is still
    // wanted. Its key stays claimed, so it is never asked for again: open a
    // second group while the first is loading and the first says "Loading…"
    // for the rest of the visit. What actually needs guarding is a response
    // arriving for a DIFFERENT pond, and that is what `generation` is for.
  }, [wanted, api, nonce]);

  const itemsOf = useCallback(
    (name, kind) => contents[groupKey(name, kind)]?.items || [],
    [contents],
  );

  /**
   * Whether the group holds more items than the map drew. Deliberately coarse —
   * one past the cap is all we asked for, so this is "there are more", not a
   * count. The node it feeds says "More" rather than a number for that reason.
   */
  const moreOf = useCallback(
    (name, kind) => (contents[groupKey(name, kind)]?.hasMore ? 1 : 0),
    [contents],
  );

  /**
   * Forget one board's groups (or all of them) and read them again.
   *
   * The re-read is the whole point and it does not happen by itself: dropping
   * the cache changes nothing the fetch effect watches, so without the nonce an
   * invalidated group that is currently OPEN just empties and stays empty.
   *
   * Claims are released outside the state updater, deliberately. React may call
   * an updater twice, and a set that a second pass has already emptied would
   * hide a key that is genuinely still in flight.
   */
  const invalidate = useCallback((name) => {
    if (!name) {
      generation.current += 1;
      claimed.current = new Set();
      setContents({});
      setNonce((n) => n + 1);
      return;
    }
    const prefix = `${name}/`;
    for (const key of [...claimed.current]) {
      if (key.startsWith(prefix)) claimed.current.delete(key);
    }
    setContents((prev) => {
      const next = {};
      let changed = false;
      for (const [key, value] of Object.entries(prev)) {
        if (key.startsWith(prefix)) changed = true;
        else next[key] = value;
      }
      return changed ? next : prev;
    });
    setNonce((n) => n + 1);
  }, []);

  return { itemsOf, moreOf, invalidate };
}

/**
 * One timeline row, flattened to what a 36pt disc can actually carry.
 *
 * The four kinds arrive with four different title fields (`title`, `content`,
 * `name`, `content`-again) because they are four different tables; the map
 * neither knows nor cares, so the difference stops here.
 */
function normalise(row) {
  const kind = row?.kind;
  const base = { id: `${kind}:${row?.id}`, kind, ts: row?.ts || 0 };
  if (kind === 'task') {
    return {
      ...base, title: row.title || 'Task', completed: !!row.completed, itemType: row.itemType || 'task',
    };
  }
  if (kind === 'note') {
    return {
      ...base, title: oneLine(row.content) || '(empty note)', done: !!row.done, noteType: row.noteType,
    };
  }
  if (kind === 'media') {
    return {
      ...base,
      title: row.name || 'Photo',
      thumbnailUrl: row.thumbnailUrl || null,
      mediaType: row.mediaType || 'image',
    };
  }
  return { ...base, title: oneLine(row?.content) || '(empty message)', role: row?.role };
}

const oneLine = (text) => String(text || '').replace(/\s+/g, ' ').trim();
