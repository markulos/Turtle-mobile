import React from 'react';
import { StyleSheet, View } from 'react-native';
import { TAB_ICON_SLOT } from './tabBarLayout';
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

// The glyph is centred GEOMETRICALLY rather than by a tuned offset: the wrapper
// fills the tab button's box absolutely and pins the icon at 50%/50% with a
// -50%/-50% transform. That is dead centre of whatever box navigation gives us,
// so it no longer depends on the button's internal padding or on whether it
// reserves a row for the (hidden) label — the two things that made every
// fixed nudge wrong by a different amount.

export default function TabBarIcon({ focused, brand = false, children }) {
  // The centring transform lives HERE rather than in a static style: when two
  // styles are merged, a later `transform` REPLACES an earlier one wholesale
  // instead of concatenating — so keeping them apart would have silently
  // dropped the -50%/-50% the moment this animated style applied.
  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: withSpring(focused ? 1.04 : 1, SELECT_SPRING) },
      { translateY: withSpring(focused ? -1 : 0, SELECT_SPRING) },
    ],
  }), [focused]);

  return (
    <View style={styles.slot} pointerEvents="none">
      <Reanimated.View style={iconStyle}>{children}</Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // A REAL, in-flow square — this is the load-bearing part.
  //
  // The previous version made this absoluteFill so it would "fill the button".
  // An absolutely-positioned child contributes NO layout size, so v7's button
  // (justifyContent: 'flex-start', padding: 5) had no in-flow content and
  // collapsed to 10pt tall, pinned to the top of the bar — which is exactly why
  // the glyphs kept sitting high however the bar was padded.
  //
  // Giving the slot a real TAB_ICON_SLOT square makes the button measure
  // 5 + slot + 5 = PILL_SIZE: it fills the bar's inner box, and the glyph
  // centres inside it. Dead centre on the chip AND on the dock.
  slot: {
    width: TAB_ICON_SLOT,
    height: TAB_ICON_SLOT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
