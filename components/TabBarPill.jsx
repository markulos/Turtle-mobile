import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigationState } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { blurProps } from '../utils/frostedChat';
import Reanimated, {
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import { TAB_SLOT, PILL_SIZE, PILL_RADIUS, PILL_TOP, BAR_CONTENT_HEIGHT, clusterStart } from './tabBarLayout';

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

// The dock's palette — ONE set for BOTH themes: a ghosted-black capsule, the
// dark treatment applied in light mode too. It reads as a floating piece of
// hardware over the page rather than a panel that restyles itself, and the
// glyph/chip contrast is then a single problem to solve instead of two.
//
//   surface — near-black, translucent enough that the blur still shows the page
//             moving behind it. A shade stronger than the chat frost's 0.4 so it
//             still reads BLACK (not washed grey) over a light page;
//   edge    — a white hairline BEZEL: the device's thinnest renderable line, at
//             enough alpha to actually read as a rim around the capsule rather
//             than a barely-there seam. It's white in both themes because the
//             surface under it is black in both, and because a lit edge is what
//             makes the capsule sit as a physical object on the page instead of
//             a soft shadow of one. 0.12 was tuned against a WHITE light-mode
//             dock and disappeared once the surface went black;
//   chip    — the theme accent, the one saturated element and therefore what the
//             eye tracks as it slides. It carries a WHITE glyph, which is why
//             the inactive glyphs are white-on-dark in both themes too (see
//             tabBarInactiveTintColor in App.js — a dark inactive tint would
//             vanish into this surface).
const DOCK_SURFACE = 'rgba(18,18,20,0.52)';
const DOCK_EDGE = 'rgba(255,255,255,0.30)';

// Geometry is shared with the bar itself (see tabBarLayout) so the chip and the
// icons can never disagree about where a slot is.

export default function TabBarPill() {
  const { theme } = useTheme();
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
      {/* Ghosted-black frosted capsule, in BOTH themes. Blur params still come
          from the app's shared frost module so it's the same material as the
          chat composer; the tint is pinned to 'dark' rather than following the
          theme, because a light-tinted blur under a near-black overlay just
          milks it out. */}
      <View style={[styles.card, { borderColor: DOCK_EDGE }]}>
        <BlurView
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          {...blurProps(theme)}
          tint="dark"
        />
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: DOCK_SURFACE }]}
        />
      </View>
      <Reanimated.View
        style={[
          styles.pill,
          {
            // The highlight colour from Settings. On a white dock a white chip
            // would disappear, so the chip is the saturated element and the
            // glyph on it goes white.
            backgroundColor: theme.colors.accent,
          },
          pillStyle,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // The floating card itself: same hairline treatment as the composer's glass
  // card. overflow clips the blur and tint to the rounded corners, so the bezel
  // is the outermost thing drawn and nothing bleeds past it.
  card: {
    ...StyleSheet.absoluteFillObject,
    // Fully rounded ends — radius is half the height, so the card is a capsule
    // rather than a rounded rectangle.
    borderRadius: BAR_CONTENT_HEIGHT / 2,
    // The bezel. StyleSheet.hairlineWidth is the thinnest line the DEVICE can
    // draw (~0.33pt at @3x) — a literal 1 would render three times as thick on
    // a modern screen and read as a drawn outline rather than an edge.
    borderWidth: StyleSheet.hairlineWidth,
    // iOS superellipse, so the bezel follows the same curve as the capsule's
    // corners instead of a circular arc cutting across them.
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  pill: {
    position: 'absolute',
    // Centre line of the card (see PILL_TOP). The icon slot is the same square
    // and centres itself in the same row, so chip and glyph share one centre.
    top: PILL_TOP,
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
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 4,
  },
});
