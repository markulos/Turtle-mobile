/**
 * MOTION — one vocabulary for everything in the app that moves.
 *
 * WHY THIS EXISTS
 *
 * The app already had a motion signature; it just had no home. Four bottom
 * sheets each declared their own copy of
 *
 *     const SHEET_EASING = Easing.bezier(0.32, 0.72, 0, 1);
 *     const OPEN_MS = 260;
 *     const CLOSE_MS = 200;
 *
 * with a comment on top explaining that it matched the others "so every card in
 * the app enters with one motion signature". A fifth (GalleryFilterSheet) had
 * quietly drifted to 240/180 on a different curve, and the two canvas surfaces
 * disagreed about how long a "settle" takes (240 vs 220). That is what a
 * copy-pasted constant does: the intent is shared, the value is not, and the
 * drift is invisible until you put two screens side by side.
 *
 * So this module is deliberately NOT a new animation framework. It is the set
 * of NAMES the app already animates by, in one file, so that changing the house
 * curve is one edit instead of nine, and so a new surface has an obvious right
 * answer instead of a nearby file to copy.
 *
 * TWO ENGINES, ON PURPOSE
 *
 * The app runs RN Animated and Reanimated side by side, and that is correct
 * rather than a mess to clean up:
 *
 *   • RN Animated drives the sheets, because they are built on PanResponder and
 *     hosted in <Modal>s (see useSheetDismiss) — and an RN Animated value and a
 *     Reanimated style cannot drive the same node.
 *   • Reanimated drives the gesture-continuous surfaces (canvas, zoom, keyboard
 *     tracking) where the work has to stay off the JS thread.
 *
 * The CURVES are the same shapes either way, so the control points live here as
 * plain data (`BEZIER`) and each engine builds its own easings from them. The
 * Reanimated bindings are in ./motionReanimated — same names, same numbers.
 *
 * REDUCED MOTION
 *
 * Reanimated already honours the OS "Reduce Motion" switch by itself: every
 * withTiming/withSpring defaults to ReduceMotion.System and resolves it on the
 * UI thread. RN Animated has no such notion, which means the ~95 Animated
 * timings and springs in this app — every sheet, every console, every pill —
 * ignored the setting entirely.
 *
 * The helpers below close exactly that gap: `timing`, `spring` and `layoutNext`
 * collapse to a sub-frame duration when the switch is on, so the UI still moves
 * through all its states (and every `.start()` callback still fires, which is
 * what un-mounts a closing sheet) — it just doesn't travel. Nothing else in a
 * call site has to change.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, LayoutAnimation } from 'react-native';

// ── Curves ─────────────────────────────────────────────────────────────────

/**
 * Cubic-bezier control points, as data, because the two engines need to build
 * their own easing objects from them (RN's Easing.bezier and Reanimated's are
 * not interchangeable — one is a plain JS closure, the other is workletised).
 */
export const BEZIER = {
  // The house sheet curve: a weighted ease-out that leaves fast and lands soft.
  // Every bottom-anchored card enters and leaves on this.
  sheet: [0.32, 0.72, 0, 1],
  // Matches the iOS keyboard's own frame curve, for anything that has to travel
  // WITH the keyboard rather than after it (composers, consoles).
  keyboard: [0.17, 0.59, 0.4, 0.77],
  // Material's standard curve — the neutral choice for a change of state that
  // is neither entering nor leaving.
  standard: [0.4, 0, 0.2, 1],
};

/** RN Animated easings. Reanimated's equivalents live in ./motionReanimated. */
export const EASE = {
  sheet: Easing.bezier(...BEZIER.sheet),
  keyboard: Easing.bezier(...BEZIER.keyboard),
  standard: Easing.bezier(...BEZIER.standard),
  // What a gesture-thrown surface does when the finger leaves: decelerate into
  // its resting place. Used by the canvas and the zoom view.
  settle: Easing.out(Easing.cubic),
  // Something arriving under its own power, and the mirror for leaving.
  enter: Easing.out(Easing.quad),
  exit: Easing.in(Easing.quad),
  // For loops that breathe rather than travel — symmetric, so the seam between
  // repetitions is invisible.
  breathe: Easing.inOut(Easing.quad),
  linear: Easing.linear,
};

// ── Durations ──────────────────────────────────────────────────────────────

/**
 * The app's duration scale, in milliseconds.
 *
 * These are not invented: they are the values the codebase had already
 * converged on (200 was in use 23 times, 260/200 across four sheets, 620 for
 * the celebration beats), with the one-off neighbours — 183, 220, 250, 280 —
 * rounded onto the nearest step. A number that isn't on this scale should be a
 * deliberate local choice with a comment, not a coin flip.
 */
export const DURATION = {
  /** Micro-feedback: a chip filling, a toggle flipping. Barely a transition. */
  snap: 90,
  /** Small things leaving, opacity-only changes. */
  fast: 160,
  /** The default. If you have no reason to pick another, pick this. */
  base: 200,
  /** A gesture-thrown surface coasting to rest. */
  settle: 240,
  /** Something large enough that `base` would look hurried. */
  slow: 320,
  /** Deliberate, look-at-me beats — the celebration sequence. */
  deliberate: 620,
  /** One half of a breathing loop (a "live" dot, a pulsing badge). */
  breath: 900,
};

/** The one sheet signature: asymmetric, because leaving should undercut arriving. */
export const SHEET = {
  in: 260,
  out: DURATION.base,
  easing: EASE.sheet,
};

/**
 * RN Animated spring configs, named for what they're for. The codebase had
 * damping 16–22 / stiffness 205–260 / tension 40–90 / friction 8–14 scattered
 * across it with no way to tell which differences were intentional.
 */
export const SPRING = {
  /** Snapping back from a drag that didn't commit. Barely overshoots. */
  settle: { bounciness: 4, useNativeDriver: true },
  /** A control answering a press. Enough life to feel physical. */
  press: { friction: 12, tension: 80, useNativeDriver: true },
  /** Something arriving with a bit of character (a FAB, a badge). */
  bouncy: { friction: 8, tension: 90, useNativeDriver: true },
};

// ── Reduced motion ─────────────────────────────────────────────────────────

/**
 * Short enough to be imperceptible at any refresh rate, long enough to still be
 * a real animation: RN Animated fires `.start()` callbacks and native-driver
 * teardown on the normal path, so a closing sheet still un-mounts itself and a
 * sequence still advances. Zero is avoided because a duration of 0 is a
 * documented special case in more than one animation backend.
 */
const REDUCED_MS = 1;

// Cached at module level and refreshed by the OS event, so the hundreds of
// call sites that ask this per animation never touch the async bridge.
let reduceMotion = false;

// A platform that cannot answer is treated as "animate normally" — the same
// thing it did before this module existed. Wrapped rather than chained directly
// because this runs at import time, on a platform API that is allowed not to
// exist: a throw here would take down every screen that animates.
Promise.resolve()
  .then(() => AccessibilityInfo.isReduceMotionEnabled?.())
  .then((enabled) => { reduceMotion = !!enabled; })
  .catch(() => {});

AccessibilityInfo.addEventListener?.('reduceMotionChanged', (enabled) => {
  reduceMotion = !!enabled;
});

/** Is the OS "Reduce Motion" switch on? Synchronous; safe to call per-frame. */
export function isReduceMotionEnabled() {
  return reduceMotion;
}

/**
 * Collapse a duration when the user has asked for less motion.
 * Every helper below already does this — reach for it directly only when you
 * are hand-rolling an animation this module doesn't cover.
 */
export function duration(ms) {
  return reduceMotion ? REDUCED_MS : ms;
}

/**
 * Re-renders when the OS switch changes, for the rare case where reduced motion
 * should change WHAT you render rather than how fast it moves — swapping a
 * looping pulse for a static dot, say, since a loop that never rests is the one
 * thing a shorter duration cannot fix.
 */
export function useReduceMotion() {
  const [enabled, setEnabled] = useState(reduceMotion);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => { if (alive) setEnabled(!!v); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => {
      if (alive) setEnabled(!!v);
    });
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return enabled;
}

// ── RN Animated builders ───────────────────────────────────────────────────

/**
 * `Animated.timing` with the house defaults and reduced-motion already applied.
 * Returns the composed animation UNSTARTED, exactly like Animated.timing does,
 * so `.start(cb)`, Animated.sequence and Animated.loop all still work:
 *
 *   timing(anim, 1, { duration: SHEET.in, easing: SHEET.easing }).start();
 */
export function timing(value, toValue, opts = {}) {
  const {
    duration: ms = DURATION.base,
    easing = EASE.standard,
    useNativeDriver = true,
    ...rest
  } = opts;
  return Animated.timing(value, {
    toValue,
    duration: duration(ms),
    easing,
    useNativeDriver,
    ...rest,
  });
}

/**
 * `Animated.spring` with a named config from SPRING.
 *
 * The config REPLACES the default rather than merging with it, which is not the
 * usual options-object courtesy but is the only correct behaviour here: RN
 * describes a spring in three mutually exclusive vocabularies — bounciness/speed,
 * tension/friction, and stiffness/damping/mass — and throws outright if a config
 * mixes two. Defaulting by spread would silently weld `bounciness` from the
 * fallback onto a caller's `tension/friction` and crash at the call site.
 *
 * A spring has no duration to shorten, so reduced motion is honoured the only
 * way it can be — by going straight there. `Animated.timing` at REDUCED_MS lands
 * on the same value with the same callback contract.
 */
export function spring(value, toValue, opts) {
  const { useNativeDriver = true, ...rest } = opts || SPRING.settle;
  if (reduceMotion) {
    return Animated.timing(value, {
      toValue,
      duration: REDUCED_MS,
      easing: EASE.linear,
      useNativeDriver,
    });
  }
  return Animated.spring(value, { toValue, useNativeDriver, ...rest });
}

/**
 * `LayoutAnimation.configureNext` for the next commit, reduced-motion aware.
 *
 * Called bare it is the app's standard "the list just changed shape" easing —
 * which is what all ten `LayoutAnimation.Presets.easeInEaseOut` call sites
 * meant. Pass a config to keep a bespoke one and still get the accessibility
 * behaviour.
 */
export function layoutNext(config) {
  if (reduceMotion) return;
  LayoutAnimation.configureNext(config || LayoutAnimation.Presets.easeInEaseOut);
}

/** Test seam: force the cached flag. Not for app code. */
export function __setReduceMotionForTests(enabled) {
  reduceMotion = !!enabled;
}
