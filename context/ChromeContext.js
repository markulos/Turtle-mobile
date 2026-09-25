import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * ChromeContext — one latch for "an immersive surface is up, take the dock
 * away".
 *
 * The floating tab dock is rendered by the Tab.Navigator, which sits ABOVE
 * every screen's own tree. A full-screen page pushed from inside a screen
 * (the PDF reader) therefore cannot cover it, no matter what zIndex it
 * claims — the dock paints over the reader's own bottom bar, which is exactly
 * the overlap in the bug report. The only thing that actually hides it is
 * `tabBarStyle.display`, and that lives in App.js's screenOptions, so the
 * request has to travel up there.
 *
 * A COUNT, not a boolean: two immersive surfaces can overlap (open the reader,
 * then something else that also wants the dock gone), and with a boolean the
 * first one to close would hand the dock back while the second is still up.
 * Retain/release pairs make that impossible.
 */
const ChromeContext = createContext({
  dockHidden: false,
  retainDockHidden: () => {},
  releaseDockHidden: () => {},
});

export const ChromeProvider = ({ children }) => {
  const [holds, setHolds] = useState(0);
  const retainDockHidden = useCallback(() => setHolds((n) => n + 1), []);
  const releaseDockHidden = useCallback(() => setHolds((n) => Math.max(0, n - 1)), []);
  const value = useMemo(
    () => ({ dockHidden: holds > 0, retainDockHidden, releaseDockHidden }),
    [holds, retainDockHidden, releaseDockHidden],
  );
  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
};

export const useChrome = () => useContext(ChromeContext);

/**
 * Hide the dock for as long as `active` is true, and — the part that matters —
 * give it back when the caller unmounts. The reader is unmounted rather than
 * hidden when it closes, so a release that only ran on `active` going false
 * would never fire and the dock would be gone for the rest of the session.
 */
export function useHideDock(active) {
  const { retainDockHidden, releaseDockHidden } = useContext(ChromeContext);
  useEffect(() => {
    if (!active) return undefined;
    retainDockHidden();
    return releaseDockHidden;
  }, [active, retainDockHidden, releaseDockHidden]);
}
