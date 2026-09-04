import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Animated,
  PanResponder,
  Dimensions,
  StyleSheet,
  View,
} from 'react-native';
import { useTheme } from '../../../context/ThemeContext';

const { width: SCREEN_W } = Dimensions.get('window');
// Where a back-swipe may START. Not a bezel strip — the whole LEFT PANEL of the
// page, app-wide: a 44pt bezel meant you had to hunt for the edge, and every
// page in the app shares this default so the gesture feels the same everywhere.
//
// Safe to make this wide because the responder below is `onMoveShouldSetPanResponder`,
// NOT the Capture variant: children get the gesture first, so a horizontal
// ScrollView (chip rail, pager, carousel) sitting in the left panel still wins
// its own drags. Only gestures no child claims reach the page.
const EDGE_ZONE_PX = Math.round(SCREEN_W * 0.4);
// Commit thresholds — either drag a third of the way across, or flick rightward
// fast enough.
const COMMIT_DX = SCREEN_W * 0.3;
const COMMIT_VX = 0.5;

/**
 * EdgeSwipePage — an Instagram-style pushed PAGE (vs a sheet). It's a
 * transparent, over-full-screen Modal (so it reliably stacks over other pages
 * on iOS — see the nested-pageSheet gotcha) whose opaque content slides in from
 * the RIGHT edge and can be dragged back with a left-edge swipe. Releasing past
 * a threshold (or a fast flick) calls onClose; a short drag springs back.
 *
 * Dragging the page rightward reveals whatever sits beneath it (the page below,
 * or the Turtle tab), so a left-edge swipe "goes back" exactly like a nav stack.
 *
 * Props:
 *   visible   — show/hide. Toggling it animates the page in/out.
 *   onClose() — called when the page should be dismissed (X or a committed
 *               swipe). Return TRUE to say "I handled that back myself and the
 *               page is staying" — the swipe then springs home instead of
 *               sliding out. That is for a page with its own levels to pop
 *               (the boards canvas drilling into nested boards); every other
 *               caller returns nothing and gets the normal dismissal.
 *   children  — the page content (laid out full-screen; add your own top inset).
 *   overlay   — render as an in-tree absolute-fill overlay instead of a Modal.
 *               REQUIRED when stacking over another EdgeSwipePage/Modal: iOS
 *               won't present a second sibling Modal while the first is up, so a
 *               nested page must live INSIDE the parent page's tree, not as its
 *               own modal. (Top-level pages over a tab use the Modal form.)
 *   edgeZone  — how far in from the left a back-swipe may start. Defaults to the
 *               whole left panel (EDGE_ZONE_PX); only narrow it for a page whose
 *               left side needs raw horizontal drags a child can't claim.
 */
export default function EdgeSwipePage({ visible, onClose, children, overlay = false, swipeEnabled = true, edgeZone = EDGE_ZONE_PX }) {
  const { theme } = useTheme();
  const tx = useRef(new Animated.Value(SCREEN_W)).current;
  const [mounted, setMounted] = useState(false);

  // How wide the left grab zone is. Defaults to the bezel strip; callers can
  // widen it (e.g. the quick task form wants the whole left edge to pull back).
  // Mirrored to a ref so the memoised pan responder reads the live value.
  const edgeZoneRef = useRef(edgeZone);
  edgeZoneRef.current = edgeZone;
  // Latest swipeEnabled read on the JS thread by the pan responder. Mirrored to
  // a ref so the responder (memoised on [tx]) never rebuilds — the guard reads
  // .current live. Callers set swipeEnabled={false} while an in-tree overlay
  // (e.g. an open lightbox) is up, so the left-edge back-swipe can't leak
  // through and close the whole page from under it.
  const swipeEnabledRef = useRef(swipeEnabled);
  swipeEnabledRef.current = swipeEnabled;

  // Keep the last-visible children so the page still renders its content while
  // animating OUT (after the caller has already cleared the backing data).
  const lastChildren = useRef(null);
  if (visible) lastChildren.current = children;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      tx.setValue(SCREEN_W);
      Animated.timing(tx, { toValue: 0, duration: 260, useNativeDriver: true }).start();
    } else {
      // Animate out from wherever the page currently is (mid-drag or fully open)
      // then unmount. Harmless no-op on the very first (never-shown) render.
      Animated.timing(tx, { toValue: SCREEN_W, duration: 220, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
    // Intentionally only react to `visible`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (evt, g) => {
          if (!swipeEnabledRef.current) return false;
          const startX = evt.nativeEvent.pageX - g.dx;
          return (
            startX < edgeZoneRef.current &&
            g.dx > 8 &&
            Math.abs(g.dx) > Math.abs(g.dy) * 1.5
          );
        },
        onPanResponderMove: (_, g) => {
          tx.setValue(Math.max(0, g.dx));
        },
        onPanResponderRelease: (_, g) => {
          if (g.dx > COMMIT_DX || g.vx > COMMIT_VX) {
            // Continue the motion straight off the right edge from EXACTLY where
            // the finger let go — don't wait for the parent's `visible`
            // round-trip to start the exit (that left a frame of stall
            // mid-swipe, which read as "not smooth"). Carry the fling velocity:
            // a fast flick whips out, a slow drag glides. onClose still fires so
            // the page unmounts; the effect's own out-timing then no-ops from
            // ~SCREEN_W.
            //
            // Unless the host CONSUMED the back. A page with levels of its own
            // (the boards canvas drilling into nested boards) pops one and stays
            // put, and it says so by returning true — without that, `visible`
            // never flips, the out-effect never runs, and the page sits parked
            // off the right edge: mounted, interactive, and invisible. onClose
            // is called first either way, and synchronously, so nothing here
            // waits a frame longer than it used to.
            const remaining = SCREEN_W - Math.max(0, g.dx);
            const duration = Math.max(
              120,
              Math.min(300, g.vx > 0.1 ? remaining / g.vx : 240),
            );
            if (onCloseRef.current?.() === true) {
              Animated.spring(tx, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 18 }).start();
              return;
            }
            Animated.timing(tx, { toValue: SCREEN_W, duration, useNativeDriver: true }).start();
          } else {
            // Short drag → glide back to fully-open with a soft, quick settle.
            Animated.spring(tx, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 18 }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(tx, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 18 }).start();
        },
      }),
    [tx],
  );

  // Dim the layer beneath as the page covers it; lifts as you drag back.
  const dimOpacity = tx.interpolate({
    inputRange: [0, SCREEN_W],
    outputRange: [0.35, 0],
    extrapolate: 'clamp',
  });

  const content = visible ? children : lastChildren.current;

  const inner = (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: dimOpacity }]}
        pointerEvents="none"
      />
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: theme.colors.background, transform: [{ translateX: tx }] },
        ]}
        {...responder.panHandlers}
      >
        {content}
      </Animated.View>
    </View>
  );

  // Overlay form: an absolute-fill layer drawn inside the parent's tree (used
  // when nesting over another page — no second native modal, which iOS drops).
  //
  // The zIndex is load-bearing, not decoration. Being LAST in the tree is not
  // enough: any earlier sibling that sets a zIndex of its own (even 1, on a
  // nested element) is lifted out of document order and drawn over this page.
  // That's what put the Notes screen's All/Notes/Todos tabs on top of the note
  // composer. A page that absolutely fills its parent is by definition meant to
  // cover that parent's other children, so it declares that explicitly — and
  // `elevation` says the same thing to Android, which ignores zIndex for
  // stacking.
  if (overlay) {
    return mounted ? <View style={[StyleSheet.absoluteFill, styles.overlayLayer]}>{inner}</View> : null;
  }

  // Top-level form: its own transparent over-full-screen modal.
  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={() => onCloseRef.current?.()}>
      {inner}
    </Modal>
  );
}

const styles = StyleSheet.create({
  // High enough to clear any incidental zIndex a host screen's chrome sets, low
  // enough to stay under the app-level overlays (the vault sits at 200).
  overlayLayer: { zIndex: 150, elevation: 150 },
});
