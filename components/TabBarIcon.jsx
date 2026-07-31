import React from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { PILL_SIZE } from './tabBarLayout';

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
 * What it adds: the icon lifts slightly and swells 4% as it becomes active,
 * so selection reads as the tab rising to meet you. The swell is deliberately
 * small - past ~10% the glyph starts to look like a different icon. The
 * HIGHLIGHT itself is not here: it is one pill that slides between tabs
 * (TabBarPill), painted behind these icons through tabBarBackground.
 *
 * Both springs run on the UI thread and are driven from the `focused` prop
 * inside the style worklets — no shared value is written during render, which
 * Reanimated warns about.
 */

// Low bounce: this is a control, so it should settle rather than wobble.
const SELECT_SPRING = { damping: 18, stiffness: 260, mass: 0.6 };

export default function TabBarIcon({ focused, brand = false, children }) {
  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: withSpring(focused ? 1.04 : 1, SELECT_SPRING) },
      { translateY: withSpring(focused ? -1 : 0, SELECT_SPRING) },
    ],
  }), [focused]);

  return (
    <View style={styles.slot}>
      <Reanimated.View style={iconStyle}>{children}</Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Sized to the largest glyph (the 36pt turtle) so every tab's icon sits on
  // the same baseline and the highlights line up across the bar.
  // The SAME square as the chip — imported, not a matching literal, so the two
  // cannot drift apart when the chip is resized.
  slot: {
    width: PILL_SIZE,
    height: PILL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
