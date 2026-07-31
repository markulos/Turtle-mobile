/**
 * What counts as a TAP, app-wide.
 *
 * The problem these props solve: React Native enters the "pressed" state on
 * finger-DOWN. Every scroll, swipe or drag begins with a finger-down on
 * whatever is under it, so a list row would light up (and, where a press-in
 * haptic is wired, buzz) the instant you started scrolling it. The press is
 * correctly cancelled once the scroll takes the responder — but by then the
 * feedback has already fired, which is what makes a gesture feel like a
 * mis-tap.
 *
 * A short press-in DELAY fixes it: a real tap holds still, so 60ms later it is
 * still a press and the feedback fires with no perceptible lag. A gesture has
 * moved by then, the responder is gone, and nothing ever fires.
 *
 * The tightened retention offset is the second half: RN keeps a press "live"
 * well outside the element by default, so sliding a finger off a row and
 * releasing still counted as a tap on it.
 *
 * Usage — spread onto the touchable, before any prop you want to override:
 *   <TouchableOpacity {...TAP_ONLY} onPress={...} />
 *   <Pressable {...TAP_ONLY_PRESSABLE} onPress={...} />
 *
 * Do NOT use on the composer's send button or anything else where the control
 * is stationary and the press cannot be the start of a scroll — the delay buys
 * nothing there.
 */

// Long enough that a scroll has taken the responder, short enough to read as
// instant. RN's own long-press threshold is 500ms, so this is well clear of it.
const PRESS_IN_DELAY_MS = 60;

// How far outside the element a live press may travel before it cancels. RN's
// default is generous (~20-30pt); a row-sized target wants it tighter so a
// drifting finger reads as a drag, not a tap.
const RETENTION = { top: 8, bottom: 8, left: 8, right: 8 };

/** For TouchableOpacity / TouchableHighlight / TouchableWithoutFeedback. */
export const TAP_ONLY = {
  delayPressIn: PRESS_IN_DELAY_MS,
  pressRetentionOffset: RETENTION,
};

/** For Pressable, which spells the same delay differently. */
export const TAP_ONLY_PRESSABLE = {
  unstable_pressDelay: PRESS_IN_DELAY_MS,
  pressRetentionOffset: RETENTION,
};
