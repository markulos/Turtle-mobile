import React, {
  createContext, useCallback, useContext, useMemo, useState,
} from 'react';

/**
 * BoardLink — a one-slot channel for "open this board over THERE".
 *
 * The boards canvas can show you that a board has 40 photos, 12 tasks and a
 * dozen notes, but it is a map: it is not where you actually work with any of
 * them. Every group on a frame therefore offers a way through to the surface
 * that owns that kind of thing — photos to the vault, notes to the Notes tab,
 * audio to the music player — with the board already filtered for.
 *
 * The screens that answer are tab screens: they take no props, they are already
 * mounted, and they each hold the filter state in question themselves. So the
 * canvas sets `pending` and navigates; the destination picks it up and applies
 * it. Exactly the shape of [[CommandBusContext]], and for the same reason —
 * routing this as navigation params would mean every one of those screens
 * growing a params reader for a message that is really "someone, somewhere,
 * wants this filter on".
 *
 * A destination MUST clear() what it consumed. The slot is single-use: leaving
 * a stale link in it would re-apply the filter every time that tab is focused,
 * which reads as a screen that refuses to be un-filtered.
 *
 * Surfaces:
 *   'photos'  → the media vault's board page, filtered to the board
 *   'audio'   → the vault's Music page, filtered to the board
 *   'notes'   → the Notes tab, with the board as the active topic
 *   'tasks'   → the Tasks tab, with the board as the selected project
 */
const BoardLinkContext = createContext({
  pending: null,
  open: () => {},
  clear: () => {},
});

export const BoardLinkProvider = ({ children }) => {
  const [pending, setPending] = useState(null);

  /**
   * `at` is a timestamp, and it is load-bearing: asking for the SAME board on
   * the SAME surface twice in a row must be two events, or the second one is a
   * no-op state write and the destination never re-runs its effect.
   */
  const open = useCallback((surface, board) => {
    if (!surface) return;
    setPending({ surface, board: board || null, at: Date.now() });
  }, []);

  const clear = useCallback(() => setPending(null), []);

  const value = useMemo(() => ({ pending, open, clear }), [pending, open, clear]);
  return (
    <BoardLinkContext.Provider value={value}>
      {children}
    </BoardLinkContext.Provider>
  );
};

export const useBoardLink = () => useContext(BoardLinkContext);

/**
 * Consume a link addressed to one surface.
 *
 * Wraps the "is it mine? then apply it and clear it" dance every destination
 * would otherwise repeat, including the part that is easy to get wrong: the
 * handler is held in a ref so a caller can pass an inline arrow without the
 * effect re-firing on every render, and the slot is cleared even when the
 * handler throws — a link that cannot be applied must not be retried forever.
 *
 * `enabled` exists because a surface is not always ONE component. The media
 * vault is mounted twice — once as the Photos tab, once as the overlay the
 * Turtle chat can open — and both would take the same link, in the same commit,
 * before either cleared it. The hidden one would then quietly filter itself to
 * a board nobody asked it about. Pass false from the copy that should not be
 * listening.
 */
export function useBoardLinkTarget(surface, handler, enabled = true) {
  const { pending, clear } = useBoardLink();
  const handlerRef = React.useRef(handler);
  handlerRef.current = handler;

  React.useEffect(() => {
    if (!enabled || !pending || pending.surface !== surface) return;
    try {
      handlerRef.current?.(pending.board);
    } finally {
      clear();
    }
  }, [pending, surface, clear, enabled]);
}
