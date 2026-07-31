import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigationState } from '@react-navigation/native';
import Reanimated, {
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';

/**
 * TabBarPill — ONE pill that slides from tab to tab behind the icons.
 *
 * Same motion idea as the Media Vault's picker: a single indicator that travels
 * to the selection rather than a per-item highlight that fades in and out. The
 * eye follows one object across the bar, so the bar reads as a single control
 * instead of five independent buttons.
 *
 * Rendered through `tabBarBackground`, which react-navigation composites behind
 * the tab buttons at the bar's full size. That matters: the alternative — a
 * custom `tabBarButton` — means taking over navigation's layout, selection and
 * accessibility contract, which is exactly what emptied this bar twice. Here
 * navigation still owns every button; this only paints underneath them.
 *
 * Position comes from the navigator's own state (`state.index` / route count),
 * so it can never disagree with which tab is actually focused — including when
 * a tab is hidden, since the route list shrinks with it.
 */

// Settles rather than wobbles: this tracks a selection, it isn't a flourish.
const SLIDE_SPRING = { damping: 20, stiffness: 220, mass: 0.7 };

const PILL_HEIGHT = 34;
// Inset from each slot's edges, so the pill is a touch narrower than the tab it
// sits under and neighbouring pills never look like one continuous bar.
const SLOT_INSET = 10;

export default function TabBarPill() {
  const { isDark } = useTheme();
  const [barWidth, setBarWidth] = useState(0);

  // Read straight from the navigator: `index` is the focused tab and `routes`
  // is what's actually rendered, so a hidden tab shifts the geometry correctly.
  const index = useNavigationState((state) => state?.index ?? 0);
  const count = useNavigationState((state) => state?.routes?.length ?? 1);

  const slot = count > 0 ? barWidth / count : 0;
  const width = Math.max(0, slot - SLOT_INSET * 2);

  const pillStyle = useAnimatedStyle(() => ({
    // Nothing to place until the bar has been measured; staying invisible
    // avoids a pill flashing at x=0 on the first frame.
    opacity: withSpring(slot > 0 ? 1 : 0, SLIDE_SPRING),
    transform: [{ translateX: withSpring(slot * index + SLOT_INSET, SLIDE_SPRING) }],
  }), [slot, index]);

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        setBarWidth((prev) => (prev === w ? prev : w));
      }}
    >
      <Reanimated.View
        style={[
          styles.pill,
          {
            width,
            // SOLID and fully inverted against the bar: white on dark, black on
            // light. The active icon flips with it (tabBarActiveTintColor is
            // the theme background, which is the exact inverse in both modes),
            // so the selected tab reads as a knocked-out chip rather than a
            // tinted wash. Neutral rather than accent-coloured on purpose — the
            // accent's job in this bar is the hairline above it, and colouring
            // both would leave the active tab competing with its own divider.
            backgroundColor: isDark ? '#FFFFFF' : '#000000',
          },
          pillStyle,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    // Sits against the top of the bar's content box, under the icon row. The
    // bar reserves paddingTop: 6 above this.
    top: 6,
    left: 0,
    height: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
    // No border: a solid chip needs no outline, and one at this contrast would
    // only muddy its edge.
  },
});
