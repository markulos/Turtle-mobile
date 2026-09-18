import React from 'react';

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

// ── The second half of the problem: a slide that never leaves the element ───
//
// `delayPressIn` handles the common case — a scroll takes the responder within
// 60ms and the press never fires. `pressRetentionOffset` handles the finger
// that wanders OFF the control. Neither catches the third case: a drag that
// starts and ends inside one large target. A 48pt timeline slot, a tall list
// row, a full-width card — swipe across one to page the view and, if the
// parent never claims the responder, the release still reads as a tap on it.
//
// So the tap is also judged by DISTANCE: remember where the finger went down,
// and if it has travelled further than a thumb's wobble by the time it comes
// up, that was a gesture and there is no press.

/** How far a finger may drift and still be a tap, in points. */
export const TAP_SLOP = 10;

/** Did the finger travel far enough to be a gesture rather than a tap? */
export function movedBeyond(start, end, slop = TAP_SLOP) {
  if (!start || !end) return false;
  const dx = Number(end.x) - Number(start.x);
  const dy = Number(end.y) - Number(start.y);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
  return Math.sqrt(dx * dx + dy * dy) > slop;
}

const pointOf = (e) => {
  const t = e?.nativeEvent;
  if (!t) return null;
  const x = t.pageX ?? t.locationX;
  const y = t.pageY ?? t.locationY;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
};

/**
 * useTapOnly — props for a Pressable that only fires on a real TAP, and only
 * shows its pressed state for one.
 *
 * Spread the returned props LAST (they include the delay and the retention
 * offset), and drive any highlight from the returned `settled` rather than
 * from Pressable's own `pressed`:
 *
 *   const tap = useTapOnly(() => addTaskAt(minute));
 *   <Pressable {...tap.props}>
 *     {({ pressed }) => <View style={pressed && tap.settled && styles.lit} />}
 *   </Pressable>
 *
 * `settled` flips false the moment the finger travels, so the highlight leaves
 * mid-gesture instead of sitting lit under a scroll that already took over.
 */
export function useTapOnly(onPress, { slop = TAP_SLOP } = {}) {
  const startRef = React.useRef(null);
  const movedRef = React.useRef(false);
  const [settled, setSettled] = React.useState(true);

  const onTouchStart = React.useCallback((e) => {
    startRef.current = pointOf(e);
    movedRef.current = false;
    setSettled(true);
  }, []);

  const onTouchMove = React.useCallback((e) => {
    if (movedRef.current) return;               // one flip per gesture, not per frame
    if (!movedBeyond(startRef.current, pointOf(e), slop)) return;
    movedRef.current = true;
    setSettled(false);
  }, [slop]);

  const handlePress = React.useCallback((e) => {
    if (movedRef.current) return;               // that was a gesture
    onPress?.(e);
  }, [onPress]);

  return {
    settled,
    props: {
      ...TAP_ONLY_PRESSABLE,
      onTouchStart,
      onTouchMove,
      onPress: handlePress,
    },
  };
}
