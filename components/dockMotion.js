import { Easing } from 'react-native';

/**
 * How the dock MOVES — one curve, one duration, three places that use it.
 *
 * ── Why a curve and not a spring ────────────────────────────────────────────
 *
 * The chip used to travel on a spring (damping 20 / stiffness 220), and the
 * pages did not animate at all. Both halves of that were wrong in the same
 * direction: a stiff spring on a control that moves 60pt reads as a snap, and
 * an instant page swap under it reads as the app lurching rather than turning.
 * A short ease-out does the thing a tab switch actually is — fast at the start,
 * settled by the time you look at it, no overshoot to notice.
 *
 * ── Where the number comes from ─────────────────────────────────────────────
 *
 * Meta publishes no motion spec, so this is NOT a copied constant; it is the
 * band everyone who has measured this agrees on. react-navigation's own tab
 * presets are 150ms. The platform guidance for a control used dozens of times
 * a session is 150-200ms (past ~400ms motion is read as waiting). 170 sits in
 * the middle of that, which is where "quick but not curt" lives — and it is
 * ONE constant, so if it still feels slow or snappy on the phone it is a
 * one-line change here and everything moves together.
 *
 * ── Stated twice, on purpose ────────────────────────────────────────────────
 *
 * The navigator animates its scenes with RN's Animated (`transitionSpec`), and
 * the chip animates with Reanimated on the UI thread. Those are two different
 * Easing implementations, so the curve cannot be a single shared object — but
 * it IS the same curve, ease-out cubic, and the duration below is shared, which
 * is what keeps the chip and the page it belongs to arriving together.
 */
export const TAB_SWITCH_MS = 170;

/**
 * The navigator's spec for a tab change: see `animation`/`transitionSpec` in
 * App.js. Paired with the 'shift' preset, which is the fade-and-translate — the
 * outgoing page fades out and slides 50pt the way your thumb is going, the
 * incoming one arrives from the other side.
 */
export const TAB_SWITCH_SPEC = {
  animation: 'timing',
  config: { duration: TAB_SWITCH_MS, easing: Easing.out(Easing.cubic) },
};

/**
 * The chip's follow while a thumb is dragging. Much shorter than a switch,
 * because this is not a transition — it is smoothing. A finger's position
 * arrives jittery and 1:1 tracking passes that jitter straight into the chip;
 * ~90ms of ease-out behind the thumb filters it out while still reading as
 * attached to the finger. Long enough to smooth, short enough not to lag.
 */
export const CHIP_FOLLOW_MS = 90;
