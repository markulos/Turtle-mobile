import { Easing } from 'react-native';

/**
 * How the dock MOVES — one curve and one travel, shared by the indicator and
 * the pages it belongs to, on two clocks: the chip is quick and scales its
 * time with the distance it is covering (chipSlideMs), and the pages take the
 * flat, longer TAB_SWITCH_MS behind it.
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
 * ── Why it leaves at full speed (and why it once did not) ───────────────────
 *
 * This file argued the opposite case for a while. The argument is kept because
 * the reasoning was sound and the conclusion was still wrong on the phone. It
 * ran: ease-out's velocity is at its MAXIMUM on the first frame, so the chip
 * does not start moving, it is already moving — which is how a cut looks. The
 * answer then was a curve starting from REST, cubic-bezier(0.3, 0, 0.2, 1)
 * over 260ms, soft at both ends.
 *
 * Mark watched that on the phone (2026-11-13) and read the soft start as the
 * chip HESITATING — the more expensive mistake of the two. The arithmetic says
 * why: on that curve the chip had covered 1.7% of its travel one frame after
 * the tap. Nothing had visibly happened yet, and the one thing a navbar owes a
 * touch is evidence that the touch landed.
 *
 * What the old note missed is WHAT IS MOVING. For a page — a big surface that
 * was not under your finger — a jump into motion reads as a cut. For the chip,
 * which IS the selection you just made, leaving at speed reads as the control
 * answering you. So the chip no longer eases in at all: cubic-bezier(0, 0,
 * 0.2, 1), 21% of the travel done on frame one, visually arrived by ~110ms,
 * and the rest of the duration spent settling rather than stopping.
 *
 * The press keeps the old soft-ended curve — see PRESS_BEZIER, and the note
 * above it for why a swell is the one thing here that must NOT jump.
 *
 * ── Where the numbers come from ─────────────────────────────────────────────
 *
 * Meta publishes no motion spec, so none of this is a copied constant. 200ms
 * on a decelerating curve is the band the platforms' own navigation motion
 * sits in — Material's decelerate standard is 200-250ms on
 * cubic-bezier(0, 0, 0.2, 1), the same control points — and it is comfortably
 * inside the ~400ms past which motion starts being read as waiting. A
 * decelerating move wants to be SHORTER than a soft-started one, because the
 * tail is the part you watch: the same 260ms on this curve reads as drifting.
 * They are three constants in one file, so if it still feels slow or snappy on
 * the phone it is a one-line change here and the indicator and the pages move
 * together regardless.
 *
 * ── Stated twice, on purpose ────────────────────────────────────────────────
 *
 * The navigator animates its scenes with RN's Animated (`transitionSpec`), and
 * the chip animates with Reanimated on the UI thread. Those are two different
 * Easing implementations, so the curve cannot be a single shared FUNCTION —
 * but the control points are shared data, and both sides build the same cubic
 * bezier from them. They share the SHAPE of the move; they no longer share its
 * length (see chipSlideMs).
 */
export const TAB_SWITCH_MS = 200;

/**
 * The chip's own clock — the numbers here Mark set by eye.
 *
 * They used to be the same number, and the argument for that was that the
 * selection and the screen it selects should arrive together. In practice the
 * chip is a 60pt object sitting under the thumb that just moved it, and the
 * page is the whole display: the same 200ms that reads as a turn on a screen
 * reads as a delay on a chip, because the eye is already at the chip when the
 * move starts and has nowhere else to be during it.
 *
 * ── Why it is not ONE number ───────────────────────────────────────────────
 *
 * It was, and that was the thing that read as erratic. A slot is 67pt, so a
 * fixed duration means tapping the next tab along and tapping across the
 * whole dock are the same move at five times the speed: the same object
 * behaving like five different ones depending on where your thumb happened to
 * be. This is the one piece of motion guidance every platform spec agrees on
 * — Material states it outright ("duration grows with distance"), and the
 * reason is physical: a thing that covers five times the ground in the same
 * time is not the same thing moving.
 *
 * So the duration GROWS with the distance, and sub-linearly. True constant
 * velocity would put a dock-wide move at ~675ms, which is well past the
 * ~400ms where motion stops reading as motion and starts reading as waiting.
 * A base plus a per-slot increment is the shape every implementation of this
 * guidance uses, and it narrows the speed spread from 5x to under 3x:
 *
 *   settle under a lifted thumb   110ms   (a fraction of a slot)
 *   one slot                      135ms
 *   two slots                     160ms   ← the number Mark settled on by eye
 *   across the whole dock         235ms
 *
 * 160 is still in there, as the two-slot move it was judged on. The curve is
 * unchanged — it is the clock that varies, never the shape.
 */
export const CHIP_SLIDE_BASE_MS = 110;
export const CHIP_SLIDE_PER_SLOT_MS = 25;
/** The ceiling, for the longest move the dock can be asked to make. */
export const CHIP_SLIDE_MAX_MS = 240;

/**
 * How long the chip should take to cross `slots` slots.
 *
 * A WORKLET, so the answer can be worked out where the move is — which since
 * the chip started leaving on the TOUCH is the only place that knows. The aim
 * is now written by the dock's `onBegin`, on the UI thread, before any JS has
 * run; nothing on the JS thread has yet had the chance to say how far the move
 * goes, so a duration pushed in from there would be the PREVIOUS move's. The
 * chip's reaction therefore computes it from the distance it is actually about
 * to cover, and writes it back for the probe's window.
 *
 * This used to be JS-only, deliberately, with the note "the UI thread never
 * calls a function to find out how long to take; it reads a number" — because
 * a non-worklet called on the UI thread is a release-build crash and the dock
 * has been taken down that way three times. The directive is what makes it
 * safe to call from both sides, and `workletSafety.scan.test.js` now fails the
 * build if it ever loses it. Pure arithmetic, so there is nothing else in here
 * that the UI runtime could trip over.
 */
export function chipSlideMs(slots) {
  'worklet';
  const d = Number.isFinite(slots) ? Math.abs(slots) : 0;
  return Math.min(CHIP_SLIDE_MAX_MS, Math.round(CHIP_SLIDE_BASE_MS + CHIP_SLIDE_PER_SLOT_MS * d));
}


/**
 * WHERE THE CHIP IS AIMED, from the three things that might know.
 *
 * Extracted from the reaction below so that the HANDOVER between them is
 * testable. The rule itself is one line; what needed pinning is what happens
 * across the sequence of writes a single tab change makes, because a
 * disagreement between two of these sources for even one UI-thread job starts
 * a whole travel in the wrong direction (the note on the handover effect has
 * the history). A render test cannot see any of this — the component mounts,
 * the style is valid, every assertion about colour and geometry passes, and
 * the bug is only in the frames.
 *
 * Precedence, strongest first:
 *
 *   drag   a thumb on the capsule. Fractional, straight off the UI thread, and
 *          it outranks everything — while a finger is down the chip IS the
 *          finger and the navigator's opinion is irrelevant.
 *   lead   the slot a tap or a lift chose, written before React has heard
 *          about it. -1 once spent.
 *   index  the navigator, which is the truth and has the last word.
 */
export const chipAim = (dragging, slot, lead, index) => {
  'worklet';
  if (dragging) return slot;
  return lead >= 0 ? lead : index;
};

/**
 * WHAT IS LEFT OF A LEAD once a request has been answered.
 *
 * A lead is one touch's optimistic aim. It is spent when the navigator says
 * where it now is — and ONLY if it is still that request's own lead:
 *
 *   • it equals `requested` — this is the touch whose request was just
 *     answered, whatever the answer was (the tab changed, or it was refused
 *     and the chip must come back);
 *   • it equals `current` — the navigator is already where the lead points,
 *     so there is nothing left for it to say.
 *
 * Anything else is a NEWER touch that has already re-aimed the chip, and it
 * is left alone. That condition is the fix for the chip going back on itself:
 * the lead used to be cleared unconditionally whenever the navigator's index
 * changed, from an effect that runs late on a busy JS thread — so a commit for
 * the PREVIOUS tab change landed on top of the next touch, wiped its aim, and
 * sent the chip back to a tab the user had already left. See dockNav.
 */
export const leadAfterSettle = (lead, requested, current) => {
  'worklet';
  return lead === requested || lead === current ? -1 : lead;
};

/**
 * How long a chip that a thumb has just picked up takes to arrive under it.
 *
 * Under a thumb the chip is written raw, one frame per touch sample — but the
 * frame the drag BEGINS on, the chip is somewhere else: half a slot from the
 * finger if it was resting, or most of the dock away if it was still
 * travelling to the touch (a tap whose thumb rolled past the drag slop, which
 * is most common on exactly the long reaches). Written raw on that frame it
 * teleports. So the gap it had is carried as an offset and run down to zero
 * over this long; after that the chip IS the finger again, with nothing in
 * between. Short enough that it is over before a deliberate scrub has gone
 * anywhere.
 */
export const CHIP_CATCH_MS = 120;

/**
 * THE PAGE FOLLOWS THE CHIP — how far through its travel the chip must be
 * before the tab change is dispatched.
 *
 * A tab change is the heaviest thing the dock causes: React re-renders the
 * navigator, focus effects fire in the screens, and two full-screen pages
 * start cross-fading. All of it lands on the frames straight after the lift.
 * On a short hop that does not matter — the chip left on the touch and has
 * arrived by the time the finger comes up. On a long move it is still
 * crossing the dock, and it shares the main thread and the compositor with
 * everything the tab change just started: that is the hitch that was left.
 *
 * So the two are put in sequence instead of on top of each other. The chip's
 * curve leaves at full speed and only decelerates, so at 65% of its TIME it
 * has covered about 97% of its distance; a tab change dispatched then lands
 * on the last few points of a crawl, where a dropped frame cannot be seen.
 *
 * What it costs is measured from the touch, not from the lift, so it is
 * small: a move across the whole dock asks for ~150ms after touch-down, and
 * an ordinary tap has already spent 70–120 of those with the finger still on
 * the glass. Moves of one or two slots never wait at all.
 */
export const PAGE_FOLLOWS_AT = 0.65;

/**
 * The curve, as control points, because two Easing implementations have to
 * build it. Leaves at full speed (x1 = y1 = 0, so there is no ease-in to sit
 * through) and arrives with zero velocity (y2 = 1): a departure and a landing,
 * which is the shape of "instant, then smooth".
 */
export const TAB_SWITCH_BEZIER = [0, 0, 0.2, 1];

/**
 * The press's curve — the OLD tab-switch points, kept for the one mover here
 * that still wants a soft start. See the press note further down: a swell that
 * begins at full speed does not grow, it jumps to grown, and a bar that jumps
 * under a resting fingertip reads as a twitch rather than as an answer.
 */
export const PRESS_BEZIER = [0.3, 0, 0.2, 1];

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
 * NOTHING HERE APPLIES WHILE A THUMB IS DOWN.
 *
 * There was briefly a CHIP_FOLLOW_MS — ~90ms of ease-out behind the finger, to
 * filter the jitter a touch stream carries. It is gone: a filter is a lag, and
 * under a fingertip there is something to measure the lag against. The chip
 * takes the drag position raw (TabBarPill) and this curve is for the TRAVEL
 * that happens after the release, when the dock is choosing a tab rather than
 * being held.
 */

/**
 * THE PRESS — the dock answering the touch before anything else happens.
 *
 * A tab change is the dock's slowest promise: a navigate, a React commit, a
 * screen mounting. The touch itself should be acknowledged long before any of
 * that, and by the BAR rather than by the chip — the chip is already busy
 * being the selection, and a control that only responds where you happened to
 * land tells you less than one that responds as a whole.
 *
 * So the capsule and everything on it swell, a point and a half, and HOLD
 * while the finger is down. That last part is the half that matters on a
 * drag: a scrub along the dock keeps the bar lifted for its whole length, so
 * the state reads as "I have this" rather than as a blink at the start.
 *
 * ── Why 1.5% ────────────────────────────────────────────────────────────────
 *
 * The capsule is ~370pt wide, so this is under three points of total width
 * and well under one of height. Big enough that the edge visibly moves
 * against the screen edge it is parallel to; small enough that nothing
 * re-reads as a different size. Scale rather than a tint, because the dock
 * now has four skins and a user-chosen colour, and geometry is the one
 * language all of them speak.
 *
 * ── Why the press still starts from rest ────────────────────────────────────
 *
 * Here — and only here — frame-one velocity is the thing to avoid. An ease-out
 * press would be at full speed on its first frame: the bar would not grow, it
 * would jump to grown. A SIZE that jumps under a resting finger reads as a
 * twitch, where a POSITION that jumps reads as obedience, which is why the
 * chip's curve changed and this one did not. The press keeps the soft-ended
 * bezier the tab switch used to use (PRESS_BEZIER), just much shorter: fast
 * enough to feel like a response, with the jump taken out of its first frame.
 *
 * Out is slower than in. Pressing is a thing you did; releasing is a thing
 * that stops, and a release that snaps back draws attention to the end of an
 * interaction rather than to its result.
 */
/**
 * ── WHY THIS IS AN OPACITY AND NOT A SCALE ─────────────────────────────────
 *
 * It was a scale — the whole dock swelling 1.5% — and that was a transform on
 * an ANCESTOR OF THE BLUR. iOS derives a UIVisualEffectView's content from
 * whatever is behind it, so changing the geometry of anything above it makes
 * the blur re-sample every frame, on the main thread, which is the same
 * thread compositing the chip's travel. The press and the travel overlap on
 * every single tap — the lift releases the swell at the moment the chip is
 * given its aim — so the dock's most expensive per-frame work was guaranteed
 * to land on the frames of its most-watched animation. `pressBusy` in the
 * probe exists because of exactly this, and it is true on every tap.
 *
 * Mark put it as "there's two animations happening — maybe make the navbar
 * not do the blurry thing, maybe the backdrop lowers opacity instead".
 *
 * So the press now fades the WASH — the flat gradient painted over the blur —
 * and the blur itself is never touched. Fading a plain colour layer is a
 * GPU-side alpha blend with nothing to recompute; the capsule lightens under
 * the finger and the glass behind it is not asked to do anything at all. The
 * icons and the chip keep their full strength, because the chip is the thing
 * you are watching and dimming it would be the opposite of feedback.
 */
export const PRESS_DIM = 0.72;
export const PRESS_IN_MS = 110;
export const PRESS_OUT_MS = 200;

// There is deliberately no ready-made timing spec for the press here. The
// press runs inside the dock's gesture worklets, on the UI thread, and this
// file's Easing is React Native's — a plain JS closure the UI thread cannot
// call. A helper that built the spec was called from those worklets and
// crashed the app on the first touch of the dock (release builds turn
// Reanimated's "non-worklet function on the UI thread" into a fatal error).
// DockTabBar builds the spec once, with REANIMATED's Easing, from these
// numbers and PRESS_BEZIER.
