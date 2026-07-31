import React, { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';

/**
 * TabBarButton — the bottom nav's per-tab button.
 *
 * The default react-navigation button just tints a glyph, which reads flat next
 * to the rest of the app. This adds the two things a considered tab bar has:
 *
 *   1. A HIGHLIGHT that belongs to the active tab — a soft pill that springs in
 *      behind the icon, rather than colour alone carrying the whole state. It
 *      gives the selection a shape you can see at a glance in peripheral
 *      vision, which colour on a small glyph does not.
 *   2. MOTION with a source. The pill scales from the icon's centre and the
 *      icon lifts a hair as it becomes active, so selection feels like the tab
 *      rising to meet you instead of a texture swap. Press dips the whole
 *      button; releasing springs it back.
 *
 * Everything animates on the UI thread (Reanimated), so tab switching never
 * competes with the incoming screen's mount work on the JS thread — which is
 * exactly when a JS-driven animation would stutter.
 *
 * `brand` marks the Turtle tab: same mechanics, but the highlight is a circle
 * sized to its larger glyph and carries a touch more presence, so the brand
 * anchor stays distinct from the utility tabs beside it.
 */

// Spring shared by the highlight and the icon lift. Low bounce: this is a
// control, not a toy — it should settle, not wobble.
const SELECT_SPRING = { damping: 18, stiffness: 260, mass: 0.6 };
const PRESS_SCALE = 0.9;

export default function TabBarButton({
  children,
  onPress,
  onLongPress,
  accessibilityState,
  // react-navigation v7 reports selection as `aria-selected`, not through
  // accessibilityState. Reading only the latter left `focused` permanently
  // false, so the active highlight could never appear. Both are accepted so
  // this keeps working if the contract changes back.
  'aria-selected': ariaSelected,
  // MUST be kept and composed, not replaced: react-navigation passes the `flex`
  // that distributes the bar's width across the tabs in here (see
  // BottomTabItem's `style: [styles.tab, { flex, ... }]`). Dropping it collapsed
  // every button to zero width, so the whole bar rendered empty.
  style,
  brand = false,
  ...rest
}) {
  const { theme } = useTheme();
  const focused = !!(ariaSelected ?? (accessibilityState && accessibilityState.selected));

  const pressed = useSharedValue(0);
  // `focused` drives the springs from inside the style worklets rather than
  // through a shared value written during render — Reanimated warns on
  // render-phase writes, and this component re-renders on selection anyway, so
  // the extra value bought nothing.

  const onPressIn = useCallback(() => {
    pressed.value = withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) });
  }, [pressed]);
  const onPressOut = useCallback(() => {
    pressed.value = withSpring(0, SELECT_SPRING);
  }, [pressed]);

  // The highlight: scales out of nothing and fades in together, so it reads as
  // one gesture rather than a box that appears then colours itself.
  const highlightStyle = useAnimatedStyle(() => ({
    opacity: withSpring(focused ? 1 : 0, SELECT_SPRING),
    transform: [{ scale: withSpring(focused ? 1 : 0.72, SELECT_SPRING) }],
  }), [focused]);

  // The glyph itself: a small lift and swell on select, a dip on press. Kept
  // subtle — the icon must not change size enough to look like a different
  // icon, which is why the swell is 4% and not 15%.
  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: withSpring(focused ? 1.04 : 1, SELECT_SPRING)
          * (1 - pressed.value * (1 - PRESS_SCALE)),
      },
      { translateY: withSpring(focused ? -1.5 : 0, SELECT_SPRING) },
    ],
  }), [focused]);

  const size = brand ? styles.brandHighlight : styles.highlight;

  return (
    <Pressable
      {...rest}
      onPress={onPress}
      onLongPress={onLongPress}
      // Re-emit both forms so assistive tech still hears the selected state.
      aria-selected={focused}
      accessibilityState={{ ...(accessibilityState || {}), selected: focused }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      // A tab is a stationary target — a press here can never be the start of a
      // scroll, so it takes the immediate feedback rather than the tap-only
      // delay the scrolling surfaces use.
      style={[style, styles.button]}
    >
      <Reanimated.View
        pointerEvents="none"
        style={[
          size,
          {
            backgroundColor: brand
              ? theme.colors.textPrimary + '1F'
              : theme.colors.textPrimary + '14',
          },
          highlightStyle,
        ]}
      />
      <Reanimated.View style={iconStyle}>{children}</Reanimated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Composed ON TOP of navigation's own style, which owns the flex sizing and
  // padding. This layer only centres the glyph over the highlight — it must not
  // set flex, or it would override the width distribution it is meant to keep.
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  highlight: {
    position: 'absolute',
    width: 46,
    height: 32,
    borderRadius: 16,
  },
  brandHighlight: {
    position: 'absolute',
    width: 46,
    height: 46,
    borderRadius: 23,
  },
});
