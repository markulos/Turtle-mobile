import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigationState } from '@react-navigation/native';
import Reanimated, {
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import { TAB_SLOT, PILL_SIZE, PILL_RADIUS, clusterStart } from './tabBarLayout';

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

// Geometry is shared with the bar itself (see tabBarLayout) so the chip and the
// icons can never disagree about where a slot is.

export default function TabBarPill() {
  const { isDark } = useTheme();
  const [barWidth, setBarWidth] = useState(0);

  // Read straight from the navigator: `index` is the focused tab and `routes`
  // is what's actually rendered, so a hidden tab shifts the geometry correctly.
  const index = useNavigationState((state) => state?.index ?? 0);
  const count = useNavigationState((state) => state?.routes?.length ?? 1);

  // The tabs are a CENTRED CLUSTER of fixed-width slots, not items stretched
  // across the bar, so the chip is placed from the cluster's left edge — the
  // same edge the bar's own padding creates.
  const start = clusterStart(barWidth, count);
  const offset = start + (TAB_SLOT - PILL_SIZE) / 2;

  const pillStyle = useAnimatedStyle(() => ({
    // Nothing to place until the bar has been measured; staying invisible
    // avoids the square flashing at x=0 on the first frame.
    opacity: withSpring(barWidth > 0 ? 1 : 0, SLIDE_SPRING),
    transform: [{ translateX: withSpring(TAB_SLOT * index + offset, SLIDE_SPRING) }],
  }), [barWidth, index, offset]);

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
            // A white card in BOTH themes, carrying the accent-coloured glyph.
            // The shadow is what makes that work on light, where a white chip on
            // a near-white bar would otherwise have no edge at all — so it is
            // load-bearing there, not decoration. On dark it reads as the chip
            // lifting off the black bar.
            shadowOpacity: isDark ? 0.45 : 0.16,
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
    // bar reserves paddingTop: 6 above this, and the icon slot is the same 38pt
    // square, so the glyph lands dead centre.
    top: 6,
    left: 0,
    width: PILL_SIZE,
    height: PILL_SIZE,
    borderRadius: PILL_RADIUS,
    // The iOS superellipse rather than a circular arc — this is what separates
    // a squircle from a rounded square. iOS-only; Android ignores it and falls
    // back to the plain radius, which still reads correctly.
    borderCurve: 'continuous',
    backgroundColor: '#FFFFFF',
    // Subtle lift. Offset is small and the radius soft so it reads as a card
    // resting on the bar rather than floating above it; opacity is set per
    // theme where the chip is rendered.
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 4,
  },
});
