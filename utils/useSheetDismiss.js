// Pull-down-to-dismiss for bottom-sheet cards, iOS-style.
//
// APP-WIDE RULE: the drag works from ANYWHERE on the card, not just the header.
// Grabbing the middle of a sheet and pulling down closes it, the way Apple's
// own sheets behave. Spread `panHandlers` on the sheet CONTAINER and
// `sheetDragStyle` on that container (or an inner wrapper if the sheet already
// animates its own entrance transform — nested transforms compose).
//
// Because the card now covers scrollable content, the responder runs in the
// CAPTURE phase: a JS PanResponder parent cannot outrank a native ScrollView
// child any other way. To stop it from eating those lists' scrolling, it claims
// the gesture only when the content under the finger is already at the top.
// Spread `scrollProps` on the sheet's ScrollView/FlatList so the hook can see
// that offset (`scrollPropsFor(key)` when a sheet has more than one). A
// scrollable that reports nothing is treated as at-rest, so a sheet with no
// list needs no wiring at all.
//
// For surfaces that own their own vertical gesture and must never be stolen
// from — wheel pickers, vertical sliders — spread `noDragProps` on a wrapping
// View. It blocks the capture for the duration of that touch.
//
// The sheet tracks the finger 1:1 downward (rubber-banded upward), springs back
// from a short drag, and COMMITS past ~90px or a downward flick: it slides the
// rest of the way off, then fires onClose.
//
// Built on PanResponder + RN Animated (the codebase's proven idiom for sheets
// hosted inside RN <Modal>s — see TaskQuickInspector), with the mandatory
// latest-ref hygiene so the once-built responder never captures a stale
// onClose.
//
// Pass the sheet's `visible` flag as the second argument: the drag offset is
// re-zeroed when the sheet (re)opens — NOT right after a committed close.
// Resetting at close time made the sheet pop back to its resting position
// while the host's own async exit (a Modal slide-out, a fade, an animateOut)
// was still playing, so every drag-dismiss visibly closed twice. Leaving the
// sheet parked off-screen until the next open lets any exit animation play
// over an already-empty overlay.
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Dimensions, PanResponder } from 'react-native';

const SCREEN_H = Dimensions.get('window').height || 900;
export const COMMIT_DY = 90;
// PanResponder gesture velocity is in px/MILLISECOND (unlike RNGH's px/s).
export const COMMIT_VY = 0.6;
// Deliberate-drag threshold. Small enough to feel immediate, large enough that
// a sloppy tap on a row inside the sheet doesn't start dragging the card.
export const DRAG_SLOP = 6;
// A scrollable within this many px of its top still counts as "at rest" —
// covers sub-pixel offsets and iOS rubber-band overscroll (negative offsets).
const TOP_EPSILON = 1;

/**
 * True when every scrollable that has reported an offset is at its top.
 * An empty map means nothing inside the sheet scrolls (or nothing has been
 * scrolled yet), which is the common case and always draggable.
 */
export function isAtTop(offsets) {
  for (const y of offsets.values()) {
    if (y > TOP_EPSILON) return false;
  }
  return true;
}

/**
 * The capture-phase decision. Kept pure and exported because a wrong `true`
 * here silently steals scrolling from every list inside every sheet.
 */
export function shouldClaimDrag(gesture, { blocked, atTop }) {
  if (blocked || !atTop) return false;
  if (gesture.dy <= DRAG_SLOP) return false;
  return Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.2;
}

/** Past the distance threshold, or flicked down hard enough to mean it. */
export function shouldCommit(gesture) {
  return gesture.dy > COMMIT_DY || gesture.vy > COMMIT_VY;
}

export function useSheetDismiss(onClose, visible = true) {
  const dragY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Live scroll offsets of everything inside the sheet, keyed so a sheet with
  // several lists (a body plus a playlist, say) is gated by all of them.
  const offsetsRef = useRef(new Map());
  // Set while a touch is inside a `noDragProps` zone.
  const blockedRef = useRef(false);

  // Fresh position on every (re)open — also covers a close that happened
  // mid-drag (Android back / onRequestClose), which would otherwise leave a
  // stale offset on the next open.
  useEffect(() => {
    if (visible) {
      dragY.setValue(0);
      offsetsRef.current.clear();
      blockedRef.current = false;
    }
  }, [visible, dragY]);

  const responder = useRef(
    PanResponder.create({
      // Never claim on touch-down: taps must reach the buttons and rows the
      // card is made of.
      onStartShouldSetPanResponderCapture: () => false,
      // Capture, not bubble: the card sits above native scroll views, and the
      // bubble phase would only ever see gestures they declined.
      onMoveShouldSetPanResponderCapture: (_e, g) =>
        shouldClaimDrag(g, {
          blocked: blockedRef.current,
          atTop: isAtTop(offsetsRef.current),
        }),
      onPanResponderMove: (_e, g) => {
        dragY.setValue(g.dy > 0 ? g.dy : g.dy * 0.25); // rubber-band upward
      },
      onPanResponderRelease: (_e, g) => {
        if (shouldCommit(g)) {
          Animated.timing(dragY, {
            toValue: SCREEN_H,
            duration: 200,
            useNativeDriver: true,
          }).start(({ finished }) => {
            // The sheet stays parked off-screen through the host's own exit
            // animation; the visible-effect above re-zeroes it on next open.
            if (finished) onCloseRef.current?.();
          });
        } else {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
      },
    })
  ).current;

  // Stable across renders: these get spread onto scroll views and wrappers, so
  // a fresh object each render would churn their props.
  const helpers = useMemo(() => {
    const scrollPropsFor = (key = 'body') => ({
      scrollEventThrottle: 16,
      onScroll: (e) => {
        offsetsRef.current.set(key, e?.nativeEvent?.contentOffset?.y ?? 0);
      },
    });
    return {
      scrollPropsFor,
      scrollProps: scrollPropsFor('body'),
      // Capture-phase touch-start on the child runs AFTER the parent declines
      // at start (we always do) and BEFORE any move is evaluated, so the flag
      // is already set by the time the card's capture asks.
      noDragProps: {
        onStartShouldSetResponderCapture: () => {
          blockedRef.current = true;
          return false;
        },
        onTouchEnd: () => { blockedRef.current = false; },
        onTouchCancel: () => { blockedRef.current = false; },
      },
    };
  }, []);

  return {
    dragY,
    panHandlers: responder.panHandlers,
    sheetDragStyle: { transform: [{ translateY: dragY }] },
    ...helpers,
  };
}
