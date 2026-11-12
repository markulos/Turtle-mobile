import { Easing } from 'react-native';

/**
 * How the dock MOVES — one curve, one duration, one travel, shared by the
 * indicator and the pages it belongs to.
 *
 * ── Why a curve and not a spring ────────────────────────────────────────────
 *
 * The chip used to travel on a spring (damping 20 / stiffness 220), and the
 * pages did not animate at all. Both halves of that were wrong in the same
 * direction: a stiff spring on a control that moves 60pt reads as a snap, and
 * an instant page swap under it reads as the app lurching rather than turning.
 * A timed curve does the thing a tab switch actually is — a short, deliberate
 * move with a settle at the end and no overshoot to notice.
 *
 * ── Why it is no longer 170ms of ease-out ───────────────────────────────────
 *
 * It still read as abrupt, and the two reasons were the same reason: the
 * motion was over before the eye could follow it, and it began at full speed.
 *
 *   • ease-out's velocity is at its MAXIMUM on the first frame. The page does
 *     not start moving, it is already moving — which is exactly how a cut
 *     looks. 94% of the old travel was done 104ms in.
 *   • 50pt in 170ms is ~300pt/s average and nearer 900pt/s at the start. That
 *     is a flick, not a turn.
 *
 * So: a curve that starts from REST and lands soft at both ends (the bezier
 * below has zero slope at t=0 and t=1), a duration long enough to be followed,
 * and a shorter travel so the longer duration does not read as slow. The move
 * is still effectively finished early — 94% of it by ~180ms — but the first
 * 30ms are an acceleration rather than a jump, and the last stretch is a
 * settle. That difference is the whole of "abrupt" versus "natural".
 *
 * ── Where the numbers come from ─────────────────────────────────────────────
 *
 * Meta publishes no motion spec, so none of this is a copied constant. 260ms
 * on a soft-ended curve is the band the platforms' own navigation motion sits
 * in (Material's standard transition is 300ms on cubic-bezier(0.2, 0, 0, 1);
 * iOS's default ease-in-out is 250ms) and it is comfortably inside the ~400ms
 * past which motion starts being read as waiting. They are three constants in
 * one file, so if it still feels slow or snappy on the phone it is a one-line
 * change here and the indicator and the pages move together regardless.
 *
 * ── Stated twice, on purpose ────────────────────────────────────────────────
 *
 * The navigator animates its scenes with RN's Animated (`transitionSpec`), and
 * the chip animates with Reanimated on the UI thread. Those are two different
 * Easing implementations, so the curve cannot be a single shared FUNCTION —
 * but the control points are shared data, and both sides build the same cubic
 * bezier from them. That is what keeps the chip and the page arriving together.
 */
export const TAB_SWITCH_MS = 260;

/**
 * The curve, as control points, because two Easing implementations have to
 * build it. Starts from rest (y1 = 0 with x1 > 0), front-weighted through the
 * middle, and arrives with zero velocity (y2 = 1): a glide with a landing.
 */
export const TAB_SWITCH_BEZIER = [0.3, 0, 0.2, 1];

/**
 * How far a page travels, in points. Down from the 'shift' preset's 50: a
 * slower move over a shorter distance is calmer than a faster one over a
 * longer distance, and 32pt is still plainly a direction — you can see which
 * way the selection went, which is what the sideways movement is FOR.
 */
export const TAB_TRAVEL_PT = 32;

/**
 * The opacity windows, in units of travel (|progress|).
 *
 * A page is fully opaque until it is SOLID_TO of the way out, and gone by
 * CLEAR_BY. Between them it dissolves. The two pages in a switch run the same
 * curve in opposite directions, so these windows decide how much of the move
 * you spend looking through one page at another:
 *
 *   • the old page holds at full opacity while it starts moving — no fade on
 *     the frames where the motion is being established;
 *   • they cross at ~57% each, which has no dip to the app background in it,
 *     so there is never an empty frame where the content was (what a true
 *     fade-through would give you, and it reads as a blink);
 *   • the new page is fully solid for the last third of its travel, so what
 *     you arrive at is a page, not a translucent one still catching up.
 *
 * Narrower than a plain cross-fade across the whole duration, which leaves the
 * incoming page washed out most of the way in.
 */
export const SCENE_SOLID_TO = 0.35;
export const SCENE_CLEAR_BY = 0.7;

/**
 * The navigator's spec for a tab change: see `transitionSpec` in App.js.
 */
export const TAB_SWITCH_SPEC = {
  animation: 'timing',
  config: {
    duration: TAB_SWITCH_MS,
    easing: Easing.bezier(...TAB_SWITCH_BEZIER),
  },
};

/**
 * How a page looks part-way through a switch — the `sceneStyleInterpolator`
 * App.js hands the navigator, in place of the 'shift' preset.
 *
 * `progress` is the navigator's own per-screen value: 0 for the focused page,
 * +1 for a page sitting to its right, -1 for one to its left. So a tab change
 * is both pages running between 0 and ±1 at once, and the SIGN is the
 * direction the selection moved — which is why translateX takes progress
 * straight: the arriving page comes in from the side it lives on, and the
 * leaving page goes out the other way.
 */
export function forTabTurn({ current }) {
  const { progress } = current;
  return {
    sceneStyle: {
      opacity: progress.interpolate({
        inputRange: [-1, -SCENE_CLEAR_BY, -SCENE_SOLID_TO, 0, SCENE_SOLID_TO, SCENE_CLEAR_BY, 1],
        outputRange: [0, 0, 1, 1, 1, 0, 0],
      }),
      transform: [{
        translateX: progress.interpolate({
          inputRange: [-1, 0, 1],
          outputRange: [-TAB_TRAVEL_PT, 0, TAB_TRAVEL_PT],
        }),
      }],
    },
  };
}

/**
 * The chip's follow while a thumb is dragging. Much shorter than a switch,
 * because this is not a transition — it is smoothing. A finger's position
 * arrives jittery and 1:1 tracking passes that jitter straight into the chip;
 * ~90ms of ease-out behind the thumb filters it out while still reading as
 * attached to the finger. Long enough to smooth, short enough not to lag.
 */
export const CHIP_FOLLOW_MS = 90;
