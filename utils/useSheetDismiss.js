// Pull-down-to-dismiss for bottom-sheet cards, iOS-style.
//
// Usage: attach `panHandlers` to the sheet's HEADER (grab handle / title zone
// — never the scrollable body, so lists inside the sheet don't fight the pan),
// and spread `sheetDragStyle` onto the sheet container (or an inner wrapper if
// the sheet already animates its own entrance transform — nested transforms
// compose). The sheet then tracks the finger 1:1 downward (rubber-banded
// upward), springs back from a short drag, and COMMITS past ~90px or a
// downward flick: it slides the rest of the way off, then fires onClose.
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
import { useEffect, useRef } from 'react';
import { Animated, Dimensions, PanResponder } from 'react-native';

const SCREEN_H = Dimensions.get('window').height || 900;
const COMMIT_DY = 90;
// PanResponder gesture velocity is in px/MILLISECOND (unlike RNGH's px/s).
const COMMIT_VY = 0.6;

export function useSheetDismiss(onClose, visible = true) {
  const dragY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Fresh position on every (re)open — also covers a close that happened
  // mid-drag (Android back / onRequestClose), which would otherwise leave a
  // stale offset on the next open.
  useEffect(() => {
    if (visible) dragY.setValue(0);
  }, [visible, dragY]);

  const responder = useRef(
    PanResponder.create({
      // Claim only a deliberate, mostly-vertical downward drag — taps and
      // horizontal swipes fall through to whatever is underneath.
      onMoveShouldSetPanResponder: (_, g) =>
        g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2,
      onPanResponderMove: (_, g) => {
        dragY.setValue(g.dy > 0 ? g.dy : g.dy * 0.25); // rubber-band upward
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > COMMIT_DY || g.vy > COMMIT_VY) {
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

  return {
    dragY,
    panHandlers: responder.panHandlers,
    sheetDragStyle: { transform: [{ translateY: dragY }] },
  };
}
