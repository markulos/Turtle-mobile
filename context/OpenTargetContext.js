import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

/**
 * OpenTarget — a one-slot, TYPED channel for "open this thing on its own
 * screen" from anywhere (the global search page, a notification, a link).
 * The sibling of CommandBusContext (which carries slash-command strings into
 * the chat). A producer calls `open({ kind, id, item })` and navigates to the
 * owning tab; the screen that owns that kind consumes `pending` in an effect,
 * clears it, and opens the item through its own existing open path — so a
 * search hit opens exactly as a tap in that screen would.
 *
 *   kind: 'task' | 'note' | 'media' | 'board' | 'folder' | 'document'
 *   id:   the item's id (board: its name)
 *   item: the object the producer holds (a search hit) — enough to open with
 *         when the owning screen has not loaded that row itself.
 */
const OpenTargetContext = createContext({
  pending: null,
  open: () => {},
  clear: () => {},
});

export const OpenTargetProvider = ({ children }) => {
  const [pending, setPending] = useState(null);
  const open = useCallback((target) => setPending(target && target.kind ? target : null), []);
  const clear = useCallback(() => setPending(null), []);
  const value = useMemo(() => ({ pending, open, clear }), [pending, open, clear]);
  return (
    <OpenTargetContext.Provider value={value}>
      {children}
    </OpenTargetContext.Provider>
  );
};

export const useOpenTarget = () => useContext(OpenTargetContext);
