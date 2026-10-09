/**
 * The canvas boards, as the phone sees them: read, and only read.
 *
 * One `GET /api/me`, decoded through utils/canvasDoc. No write path exists in
 * this file and that is the feature, not an omission — see canvasDoc's header
 * for the clobber the desktop's last-writer-wins save would become with a
 * phone in the loop. When the phone does start editing, the conflict question
 * is answered first and the writing lands here.
 *
 * ─── Why a module store rather than component state ────────────────────────
 *
 * The same reason the web's own store gives: the list is wanted by the page
 * that lists the boards AND by the one that draws a board, and the second
 * mounts as the first unmounts. Fetching per screen means the canvas you just
 * tapped is fetched again before it can be drawn, so opening a board shows a
 * spinner for a list that was already in memory. One list, loaded once,
 * refreshed when it is asked for.
 *
 * It is also what makes the open instant on the way back: the list survives
 * the push and the pop.
 */
import { useCallback, useEffect, useState } from 'react';
import { decodeBoards } from './canvasDoc';

let boards = [];
let loaded = false;
let inFlight = null;
const listeners = new Set();

const announce = () => {
  for (const l of listeners) { try { l(); } catch { /* a listener's own problem */ } }
};

/** Whatever the phone currently knows. Empty until the first load lands. */
export function canvasBoards() {
  return boards;
}

/** Has a load ever succeeded? The difference between "you have no boards" and
 *  "we have not looked yet", which are two very different empty screens. */
export function canvasBoardsLoaded() {
  return loaded;
}

/**
 * Read the boards. Shared: N callers during one navigation make one request.
 *
 * A failure leaves what was already in hand — a board list that empties itself
 * because one refresh failed is worse than a stale one, and `loaded` stays
 * false so the screen can still tell the two empties apart.
 */
export async function loadCanvasBoards(api, { force = false } = {}) {
  if (!api?.get) return boards;
  if (!force && loaded) return boards;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const me = await api.get('/me');
      boards = decodeBoards(me?.user?.settings?.canvasBoards);
      loaded = true;
      announce();
      return boards;
    } catch {
      return boards;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function subscribeCanvasBoards(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Reset. For tests — and for a sign-out, where another account's boards must
 *  not be what the next person sees. */
export function __resetCanvasBoards() {
  boards = [];
  loaded = false;
  inFlight = null;
  listeners.clear();
}

/**
 * The boards, with the load wired to the caller's lifetime.
 *
 * `refresh` is the pull-to-refresh: it re-reads even when a list is already in
 * hand, which is how a board arranged on the desktop a minute ago arrives.
 */
export function useCanvasBoards(api) {
  const [value, setValue] = useState(() => ({ boards: canvasBoards(), loaded: canvasBoardsLoaded() }));
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const sync = () => setValue({ boards: canvasBoards(), loaded: canvasBoardsLoaded() });
    sync();
    const off = subscribeCanvasBoards(sync);
    loadCanvasBoards(api).then(sync).catch(() => {});
    return off;
  }, [api]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await loadCanvasBoards(api, { force: true }); }
    finally { setRefreshing(false); }
  }, [api]);

  return { boards: value.boards, loaded: value.loaded, refreshing, refresh };
}

export default useCanvasBoards;
