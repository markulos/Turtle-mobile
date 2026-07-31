import React from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';

/**
 * TabBarIcon — the bottom nav's active-state treatment.
 *
 * Deliberately built as an ICON wrapper rather than a custom `tabBarButton`.
 * Replacing the button means taking over react-navigation's contract for
 * layout, selection state and accessibility, and getting any part of it wrong
 * silently empties the bar — the button's `style` carries the flex that sizes
 * the tab, and v7 reports selection as `aria-selected` rather than through
 * accessibilityState. `tabBarIcon` is the stable surface: it is handed
 * `focused` and its return value is placed inside navigation's own button, so
 * sizing, hit area, ripple, a11y and press behaviour all stay untouched.
 *
 * What it adds:
 *   • A HIGHLIGHT belonging to the active tab — a soft pill that springs in
 *     behind the glyph, so selection has a shape you catch peripherally rather
 *     than relying on colour alone on a 24pt icon.
 *   • MOTION with a source: the pill scales out of the icon's centre while the
 *     icon lifts slightly, so activating reads as the tab rising to meet you.
 *     The swell is 4% — enough to register, too little to make the glyph look
 *     like a different icon.
 *
 * `brand` is the Turtle tab: identical mechanics, but a circular highlight
 * sized to its larger mark so the brand anchor stays distinct from the utility
 * tabs beside it.
 *
 * Both springs run on the UI thread and are driven from the `focused` prop
 * inside the style worklets — no shared value is written during render, which
 * Reanimated warns about.
 */

// Low bounce: this is a control, so it should settle rather than wobble.
const SELECT_SPRING = { damping: 18, stiffness: 260, mass: 0.6 };

export default function TabBarIcon({ focused, brand = false, highlightColor, children }) {
  const highlightStyle = useAnimatedStyle(() => ({
    // Scale and fade together so it reads as one gesture, not a box that
    // appears and then colours itself.
    opacity: withSpring(focused ? 1 : 0, SELECT_SPRING),
    transform: [{ scale: withSpring(focused ? 1 : 0.72, SELECT_SPRING) }],
  }), [focused]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: withSpring(focused ? 1.04 : 1, SELECT_SPRING) },
      { translateY: withSpring(focused ? -1 : 0, SELECT_SPRING) },
    ],
  }), [focused]);

  return (
    <View style={styles.slot}>
      <Reanimated.View
        pointerEvents="none"
        style={[
          brand ? styles.brandHighlight : styles.highlight,
          { backgroundColor: highlightColor },
          highlightStyle,
        ]}
      />
      <Reanimated.View style={iconStyle}>{children}</Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Sized to the largest glyph (the 36pt turtle) so every tab's icon sits on
  // the same baseline and the highlights line up across the bar.
  slot: {
    width: 46,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlight: {
    position: 'absolute',
    width: 46,
    height: 32,
    borderRadius: 16,
  },
  brandHighlight: {
    position: 'absolute',
    width: 44,
    height: 38,
    borderRadius: 19,
  },
});
