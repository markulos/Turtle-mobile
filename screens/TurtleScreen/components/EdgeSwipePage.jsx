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
// Left bezel zone the back-swipe must start in, and the commit thresholds —
// either drag a third of the way across, or flick rightward fast enough.
const EDGE_ZONE_PX = 28;
const COMMIT_DX = SCREEN_W * 0.33;
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
 *   onClose() — called when the page should be dismissed (X or a committed swipe).
 *   children  — the page content (laid out full-screen; add your own top inset).
 */
export default function EdgeSwipePage({ visible, onClose, children }) {
  const { theme } = useTheme();
  const tx = useRef(new Animated.Value(SCREEN_W)).current;
  const [mounted, setMounted] = useState(false);

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
          const startX = evt.nativeEvent.pageX - g.dx;
          return (
            startX < EDGE_ZONE_PX &&
            g.dx > 8 &&
            Math.abs(g.dx) > Math.abs(g.dy) * 1.5
          );
        },
        onPanResponderMove: (_, g) => {
          tx.setValue(Math.max(0, g.dx));
        },
        onPanResponderRelease: (_, g) => {
          if (g.dx > COMMIT_DX || g.vx > COMMIT_VX) {
            onCloseRef.current?.(); // caller flips `visible` → the effect slides it out
          } else {
            Animated.spring(tx, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(tx, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
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

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={() => onCloseRef.current?.()}>
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
    </Modal>
  );
}
