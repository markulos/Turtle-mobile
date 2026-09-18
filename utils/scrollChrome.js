import { Animated } from 'react-native';

/**
 * chromeOffsetNode — how far the chrome is currently pushed off the top.
 *
 * The chrome behaves like the thing it looks like: content sitting at the top
 * of the page. Scroll down and it goes up with everything else, one point for
 * one point, until it is gone. It is back when you are back at the top. That is
 * the whole rule — `min(scrollY, maxTravel)`.
 *
 * ── Why this is a node and not arithmetic in a scroll callback ────────────
 * It used to be computed in the list's `onScroll` and pushed into an
 * Animated.Value with setValue. The maths were right and the motion still
 * stuttered, because of where it ran: native scroll → bridge → JS handler →
 * setValue → bridge → next frame. Two hops of latency on a good frame, and on a
 * bad one — a board cover decoding, a page landing, a re-render — no update at
 * all, so the chrome sat still while the list moved and then jumped to catch
 * up. No smoothing fixes that; the samples themselves arrive late and unevenly.
 *
 * An interpolation node fed by a `useNativeDriver: true` scroll event is
 * evaluated on the UI thread, on the same frame as the scroll it tracks. The JS
 * thread is never consulted and therefore cannot fall behind.
 *
 * ── Why there is no reveal-on-scroll-up ───────────────────────────────────
 * There was, briefly: an accumulator (diffClamp) that brought the chrome back
 * the moment you moved up, Pinterest-style. It needed a rebuild to reset, a
 * rebase to know where "home" was, and it made the chrome's position depend on
 * the PATH you took rather than on where you are. A position that is a pure
 * function of the scroll offset has none of that: nothing to reset, nothing to
 * strand, and it is obvious on screen — the search field is exactly where the
 * page says it is. Coming back from deep down is the
 * [`backToTopIntent`] button's job instead.
 *
 * Returns an Animated node in POINTS hidden, within [0, maxTravel].
 */
export function chromeOffsetNode(scrollY, maxTravel) {
  const max = Math.max(0, Number(maxTravel) || 0);
  // Nothing measured yet, or nothing to hide. Still a node, so callers can
  // style off the result unconditionally.
  if (!scrollY || max <= 0) return new Animated.Value(0);

  return scrollY.interpolate({
    inputRange: [0, max],
    outputRange: [0, max],
    // Both ends: rubber-band above the top must not push the chrome DOWN, and
    // past `max` there is nothing left to hide.
    extrapolate: 'clamp',
  });
}

/**
 * backToTopIntent — should the "back to top" button be offered?
 *
 * The chrome only comes back at the top, so a long way down the list the way
 * home is a lot of flicking. A fast upward flick is the user already trying to
 * do that; the button is the shortcut, offered exactly then and not as
 * permanent furniture.
 *
 * Speed is measured between scroll samples rather than read from a gesture,
 * because it has to work the same during momentum — the flick is usually over
 * by the time the page is really moving.
 *
 * Thresholds are in VIEWPORTS, not points: "two screens down" means the same
 * thing on a phone and a tablet, where "1200pt" does not. The show and hide
 * distances differ on purpose — one threshold would flicker the button on and
 * off around it while a fling coasted past.
 *
 * `anchor` is caller-owned mutable state (a ref). Returns 'show', 'hide', or
 * null for "no opinion, leave it as it is".
 */

/** An upward flick of at least this many points per millisecond asks for home. */
export const FLING_UP_SPEED = 1.1;
/** Only offered from this far down, in viewports. */
export const BACK_TO_TOP_FROM = 2;
/** Withdrawn once this close to the top, in viewports. */
export const BACK_TO_TOP_HOME = 0.75;

/** A fresh anchor. `y: null` means "first sample, just take a reading". */
export const newFlingAnchor = () => ({ y: null, t: 0 });

export function backToTopIntent(y, t, anchor, viewportH) {
  const view = Number(viewportH) > 0 ? Number(viewportH) : 600;
  const offset = Number.isFinite(y) ? y : 0;
  const prevY = anchor.y;
  const prevT = anchor.t;
  anchor.y = offset;
  anchor.t = t;

  // Close enough to the top that flicking there is no chore.
  if (offset <= view * BACK_TO_TOP_HOME) return 'hide';
  if (prevY == null) return null;

  const dt = t - prevT;
  if (!(dt > 0)) return null;
  const speed = (prevY - offset) / dt;   // positive = travelling up

  if (speed >= FLING_UP_SPEED && offset >= view * BACK_TO_TOP_FROM) return 'show';
  // Heading back down at a lick: whatever the button was for, it isn't that.
  if (speed <= -FLING_UP_SPEED) return 'hide';
  return null;
}

export default chromeOffsetNode;
