/**
 * THE EDGE-SWIPE GUARD — "something else owns this drag, keep your hands off".
 *
 * Every pushed page in the app can be dragged back from the left (see
 * EdgeSwipePage), and its grab zone is the whole LEFT PANEL — 40% of the
 * screen — because hunting for a 44pt bezel is worse. That is the right
 * default and it has one failure mode: any OTHER control that owns a
 * horizontal drag and happens to live in that panel is also, to the page
 * underneath, a back-swipe. Drag a colour slider to the right and the Settings
 * page it is sitting on slides away and closes.
 *
 * EdgeSwipePage already takes `swipeEnabled`, but only its HOST can pass it,
 * and the control with the problem is several layers deeper — a sheet inside a
 * screen inside the page. Threading a callback up through all of that is a prop
 * per layer and a new one every time a sheet is added. So the guard is a module
 * store instead: the control says "I am dragging" and every page listens.
 *
 * COUNTED, not a boolean. Two things can hold it at once (a sheet open while
 * the dock is being dragged), and the second one to release must not re-enable
 * the swipe while the first is still live.
 *
 * OPT-IN. Nothing is suppressed unless a control asks for it, so no page's
 * behaviour changes except where a real conflict exists.
 *
 *   useSuppressEdgeSwipe(active)   — a component's whole lifetime, or a flag
 *                                    (a sheet's `visible`)
 *   const release = holdEdgeSwipe() — imperative, for a gesture's start/end
 *                                    callbacks. ALWAYS release in the
 *                                    gesture's finalize, not its end: a
 *                                    cancelled gesture that never releases
 *                                    kills back-navigation for the session.
 */
import { useEffect, useSyncExternalStore } from 'react';

let held = 0;
const listeners = new Set();

const emit = () => { listeners.forEach((l) => l()); };

const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const getSnapshot = () => held > 0;

/**
 * Take the guard. Returns the release, which is idempotent — a gesture that
 * fires both onEnd and onFinalize must not decrement twice and leave the count
 * negative (which would then swallow a LATER, real hold).
 */
export function holdEdgeSwipe() {
  held += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held -= 1;
    emit();
  };
}

/** Whether any control is currently holding the guard. */
export function useEdgeSwipeSuppressed() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Hold the guard for as long as `active` is true — and on unmount, always. */
export function useSuppressEdgeSwipe(active) {
  useEffect(() => {
    if (!active) return undefined;
    return holdEdgeSwipe();
  }, [active]);
}

/** Tests only: start from a known count. */
export function __resetEdgeSwipeGuard() {
  held = 0;
  emit();
}
