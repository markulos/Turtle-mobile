/**
 * MOTION, Reanimated side — the same curves, built for the UI thread.
 *
 * Kept apart from ./motion for one hard reason: an `Easing.bezier` from
 * 'react-native' is a plain JS closure and an `Easing.bezier` from
 * 'react-native-reanimated' is workletised. They are not interchangeable, and
 * handing the wrong one to `withTiming` gets you an animation that either falls
 * back to the JS thread or refuses to run inside a gesture callback.
 *
 * So: the control points live once in ./motion as data (`BEZIER`), the duration
 * scale lives once there too (`DURATION`), and this file only re-binds them to
 * the other engine. Same names, same numbers, no second source of truth.
 *
 * Everything exported here is a plain value — a number or an Easing object —
 * and therefore safe to close over from inside a worklet. That matters: the
 * canvas and zoom surfaces build their timing configs inside gesture callbacks
 * (`.onEnd(() => { 'worklet'; ... })`), where calling back into a JS-thread
 * helper would throw.
 *
 * REDUCED MOTION is NOT handled here, because Reanimated already does it: every
 * withTiming/withSpring config defaults to `ReduceMotion.System` and resolves
 * the OS switch on the UI thread. The ./motion helpers exist to give RN Animated
 * the same behaviour, which it lacks entirely.
 */
import { Easing } from 'react-native-reanimated';

import { BEZIER, DURATION, SHEET } from './motion';

/** The house curves, workletised. Mirrors EASE in ./motion. */
export const R_EASE = {
  sheet: Easing.bezier(...BEZIER.sheet),
  keyboard: Easing.bezier(...BEZIER.keyboard),
  standard: Easing.bezier(...BEZIER.standard),
  settle: Easing.out(Easing.cubic),
  enter: Easing.out(Easing.quad),
  exit: Easing.in(Easing.quad),
  breathe: Easing.inOut(Easing.quad),
  linear: Easing.linear,
};

/**
 * Ready-made `withTiming` configs for the motions the app repeats. Frozen
 * objects rather than builder functions so a worklet can capture one directly:
 *
 *   scale.value = withTiming(next, R_TIMING.settle);
 */
export const R_TIMING = {
  /** A gesture-thrown surface coasting to rest — canvas pan, pinch zoom. */
  settle: Object.freeze({ duration: DURATION.settle, easing: R_EASE.settle }),
  /** The neutral state change. */
  base: Object.freeze({ duration: DURATION.base, easing: R_EASE.standard }),
  /** Small, fast, usually opacity. */
  fast: Object.freeze({ duration: DURATION.fast, easing: R_EASE.standard }),
  /** A bottom-anchored surface arriving and leaving, on the house curve. */
  sheetIn: Object.freeze({ duration: SHEET.in, easing: R_EASE.sheet }),
  sheetOut: Object.freeze({ duration: SHEET.out, easing: R_EASE.sheet }),
};

export { DURATION, BEZIER, SHEET } from './motion';
