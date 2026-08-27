import { useCallback, useEffect, useRef, useState } from 'react';
import { useServer } from '../../../context/ServerContext';

/**
 * useBoardsOverview — the board list, loaded the way the app loads board lists.
 *
 * Two surfaces need the identical thing (the conversations inbox and the boards
 * canvas): every board this user can see, with its latest item, its per-kind
 * counts, a collage of its most recent photos, and which board it sits INSIDE.
 * The loading is not a single fetch — it is a tiered, generation-guarded
 * sequence that took some care to get right, so it lives here once rather than
 * being copied and left to drift.
 *
 * Instagram-style loading: the names list is INSTANT, everything else hydrates
 * in place. Three tiers —
 *   0. stale-while-revalidate: whatever list we already have stays visible;
 *   1. GET /projects/tree (cheap names + nesting query) paints rows within ~1
 *      round-trip;
 *   2. GET /projects-overview (counts + latest item per board, the expensive
 *      merge) replaces the list with previews + activity ordering when it lands.
 * A generation counter + an overview-applied flag keep the merges ordered: a
 * slow names response can never overwrite a newer overview.
 *
 * Tier 1 carries `parent` — not just the names — on purpose. The canvas draws
 * one LEVEL of the tree at a time, so a names-only first paint would put every
 * board at the top level and then re-nest the whole map a beat later when the
 * overview lands. Same query cost, no flash. An older server that doesn't know
 * the endpoint falls back to the flat /projects list (everything top-level,
 * which is what a server without nesting means).
 *
 * @param active  the surface is on screen — flipping it true triggers a load.
 * @returns {{
 *   boards, avatars, mediaBase, loading, refreshing, loadFailed, load,
 *   createBoard, moveBoard, deleteBoard,
 * }}  `boards` rows are { name, parent, counts, total, lastTs, latest }; the
 *     names tier fills only `name`/`parent` (with zeroes/null for the rest), so
 *     every consumer must treat the extras as optional.
 */
/**
 * The server's own sentence out of the api client's thrown Error.
 *
 * It formats a failure as `API Error 409: {"error":"…"}` — right for a log,
 * wrong for a sheet. A refused create or move is nearly always something the
 * user can act on ("You already have a board named X"), so the envelope comes
 * off and the message goes through; anything unparseable falls back.
 */
function serverMessage(error, fallback) {
  const text = String(error?.message || '');
  const brace = text.indexOf('{');
  if (brace >= 0) {
    try {
      const parsed = JSON.parse(text.slice(brace));
      if (parsed && typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error;
    } catch { /* not JSON after all — fall through to the fallback */ }
  }
  return fallback;
}

export default function useBoardsOverview(active) {
  const { api, getBaseUrl, getMediaBaseUrl } = useServer();
  // Same origin selection as MediaGallery's getFullUrl: prefer the HTTP/2 media
  // origin when the probe succeeded (shared expo-image cache, faster
  // multiplexed loads), fall back to the http origin. thumbnailUrl paths
  // already start with /api/, so strip the base's own /api suffix.
  const mediaBase = (getMediaBaseUrl ? getMediaBaseUrl() : getBaseUrl()).replace(/\/api$/, '');

  const [boards, setBoards] = useState([]);
  // { [boardName]: [thumbnailUrl, ...] } — lazily hydrated collage avatars.
  const [avatars, setAvatars] = useState({});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // True when BOTH tiers failed while we had nothing to show — drives the
  // "couldn't reach the server" + Retry state instead of the misleading
  // "No boards yet" empty state.
  const [loadFailed, setLoadFailed] = useState(false);

  const loadGen = useRef(0);
  const boardsLenRef = useRef(0);
  boardsLenRef.current = boards.length;

  const load = useCallback(async ({ isRefresh } = {}) => {
    const gen = ++loadGen.current;
    let overviewApplied = false;
    isRefresh ? setRefreshing(true) : setLoading(true);

    // Tier 1 — instant names + nesting (only fills an EMPTY list; never
    // downgrades previews already on screen).
    if (boardsLenRef.current === 0) {
      api.get('/projects/tree').then((r) => {
        if (gen !== loadGen.current || overviewApplied) return;
        const rows = (r?.success && Array.isArray(r.boards) ? r.boards : [])
          .filter((b) => b && typeof b.name === 'string' && b.name.trim())
          .map((b) => ({
            name: b.name,
            parent: typeof b.parent === 'string' && b.parent.trim() ? b.parent : null,
            lastTs: 0,
            latest: null,
            counts: null,
            total: null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (rows.length) {
          setBoards((prev) => (prev.length ? prev : rows));
          setLoadFailed(false);
          setLoading(false);
        }
      }).catch(() => {
        // A server from before board nesting has no /projects/tree. Fall back to
        // the flat name list so the first paint still beats the overview — every
        // board reads as top-level, which is exactly what that server means.
        api.get('/projects').then((r) => {
          if (gen !== loadGen.current || overviewApplied) return;
          const names = (Array.isArray(r) ? r : [])
            .filter((n) => typeof n === 'string' && n.trim())
            .sort((a, b) => a.localeCompare(b));
          if (names.length) {
            setBoards((prev) => (prev.length ? prev : names.map((name) => ({
              name, parent: null, lastTs: 0, latest: null, counts: null, total: null,
            }))));
            setLoadFailed(false);
            setLoading(false);
          }
        }).catch(() => { /* overview below is the authoritative path */ });
      });
    }

    // Tier 3 — lazy avatar hydration, riding the same trigger as the list
    // (open / pull-to-refresh / board-close) so collages track renames,
    // deletions, and new photos. Non-blocking; failure keeps initial discs.
    api.get('/boards/avatars')
      .then((r) => { if (gen === loadGen.current && r?.success && r.avatars) setAvatars(r.avatars); })
      .catch(() => { /* initial discs stay */ });

    // Tier 2 — the full inbox (own + shared boards, latest item per board,
    // sorted by most recent activity).
    try {
      const r = await api.get('/projects-overview');
      if (gen !== loadGen.current) return;
      if (r?.success && Array.isArray(r.boards)) {
        overviewApplied = true;
        setBoards(r.boards.map((b) => ({
          name: b.name,
          // Absent on a pre-nesting server — every board is then top-level.
          parent: typeof b.parent === 'string' && b.parent.trim() ? b.parent : null,
          lastTs: b.lastTs || 0,
          latest: b.latest || null,
          counts: b.counts || null,
          total: Number.isFinite(Number(b.total)) ? Number(b.total) : null,
        })));
        setLoadFailed(false);
      }
    } catch {
      // The names tier (or the previous list) stays on screen when we have
      // one; with NOTHING on screen this is a real failure — say so instead
      // of pretending the user has no boards.
      if (gen === loadGen.current && boardsLenRef.current === 0) setLoadFailed(true);
    } finally {
      if (gen === loadGen.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [api]);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  /**
   * Create a board, optionally inside `parent`. Resolves to `{ ok, error }` —
   * the caller keeps the composer open and shows the server's own message on a
   * failure (a duplicate name, a parent that has since been deleted) rather
   * than swallowing it.
   *
   * The row is added OPTIMISTICALLY so the new disc appears under the finger
   * that made it, then reconciled by the refresh: without that, a board created
   * on a slow link lands a full round-trip later, which reads as a dropped tap.
   */
  const createBoard = useCallback(async (name, parent = null) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return { ok: false, error: 'Give the board a name.' };
    try {
      const r = await api.post('/projects/add', { name: trimmed, parent: parent || null });
      if (r && r.success === false) return { ok: false, error: r.error || 'Could not create that board.' };
      setBoards((prev) => (
        prev.some((b) => b.name === trimmed)
          ? prev
          : [...prev, {
            name: trimmed, parent: parent || null, lastTs: Date.now(), latest: null, counts: null, total: 0,
          }]
      ));
      load({ isRefresh: true });
      return { ok: true, name: trimmed };
    } catch (e) {
      return { ok: false, error: serverMessage(e, 'Could not create that board.') };
    }
  }, [api, load]);

  /** Move a board under `parent` (null = top level). Same contract as create. */
  const moveBoard = useCallback(async (name, parent) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return { ok: false, error: 'No board to move.' };
    try {
      const r = await api.patch(
        `/projects/${encodeURIComponent(trimmed)}/parent`,
        { parent: parent || null },
      );
      if (r && r.success === false) return { ok: false, error: r.error || 'Could not move that board.' };
      setBoards((prev) => prev.map((b) => (
        b.name === trimmed ? { ...b, parent: parent || null } : b
      )));
      load({ isRefresh: true });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: serverMessage(e, 'Could not move that board.') };
    }
  }, [api, load]);

  /**
   * Delete a board. Same contract again.
   *
   * The optimistic update mirrors what the server actually does, which is NOT a
   * cascade: boards nested inside the deleted one are handed to ITS parent (the
   * top level, if it had none) rather than going with it. Guessing wrong here
   * would flash a subtree out of existence and back in a round-trip later.
   */
  const deleteBoard = useCallback(async (name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return { ok: false, error: 'No board to delete.' };
    try {
      const r = await api.delete(`/projects/${encodeURIComponent(trimmed)}`);
      if (r && r.success === false) return { ok: false, error: r.error || 'Could not delete that board.' };
      setBoards((prev) => {
        const heir = prev.find((b) => b.name === trimmed)?.parent ?? null;
        return prev
          .filter((b) => b.name !== trimmed)
          .map((b) => (b.parent === trimmed ? { ...b, parent: heir } : b));
      });
      load({ isRefresh: true });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: serverMessage(e, 'Could not delete that board.') };
    }
  }, [api, load]);

  // A different server is a different pond — the tier-0 stale cache must not
  // carry across origins. Wipe it and orphan any in-flight old-server fetches.
  const prevOriginRef = useRef(mediaBase);
  useEffect(() => {
    if (prevOriginRef.current === mediaBase) return;
    prevOriginRef.current = mediaBase;
    loadGen.current += 1;
    setBoards([]);
    setAvatars({});
    if (active) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaBase]);

  return {
    boards,
    avatars,
    mediaBase,
    loading,
    refreshing,
    loadFailed,
    load,
    createBoard,
    moveBoard,
    deleteBoard,
  };
}
