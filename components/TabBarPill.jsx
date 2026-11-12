import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigationState } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { blurProps } from '../utils/frostedChat';
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import {
  TAB_SLOT, PILL_SIZE, PILL_RADIUS, PILL_TOP, BAR_CONTENT_HEIGHT, clusterStart,
  UNDERLINE_W, UNDERLINE_H, indicatorOffset, ridgeOffsets,
} from './tabBarLayout';
import { TAB_SWITCH_BEZIER, TAB_SWITCH_MS } from './dockMotion';
import { dockSkin } from './dockSkins';

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
 *
 * …EXCEPT while a thumb is dragging along the dock (DockTabBar), when it comes
 * from `dragSlot` instead: a FRACTIONAL slot position written on the UI thread.
 * The two cannot drift, because a slot is converted to pixels here, once, by
 * the formula below — whether the number came from the navigator or from a
 * finger.
 *
 * Under the thumb that position is taken RAW: no timing, no spring, no
 * smoothing of any kind, so the chip is exactly where the finger is on every
 * frame. (It briefly ran ~90ms behind, as a jitter filter. A filter is still a
 * lag, and a control held directly under a fingertip is the one place a lag
 * has something to be measured against.) Off the thumb the position is the
 * tab's own slot and the chip TRAVELS there, on the same curve as the page.
 */

// A timed curve, NOT a spring — and the same curve, from the same control
// points, that the pages travel on, so the chip and the screen it selects move
// as one thing and arrive together. See dockMotion for every number in here,
// including why it starts from rest rather than at full speed.
const SLIDE = {
  duration: TAB_SWITCH_MS,
  easing: Easing.bezier(...TAB_SWITCH_BEZIER).factory(),
};

// The dock's palette lives in dockSkins — one entry per SKIN, because what the
// capsule is made of is a setting now (Settings → Navigation) rather than a
// constant. Every colour below comes from the chosen skin:
//
//   wash    — the fill over the blur. 'smoked' is near-black and darkest along
//             its TOP edge, lifting toward the bottom, which is a channel cut
//             into the page rather than a lozenge resting on it (the ramp and
//             why it runs this way round are in dockSurface.js). 'paper' is
//             flat white and describes no depth at all;
//   edge    — the hairline around the capsule: the device's thinnest
//             renderable line, DIM on smoked because a bright rim all the way
//             round is a lit object sitting on the page, dark on paper because
//             the surface under it went white. Either way it keeps the
//             capsule's outline from dissolving into the blur;
//   lip     — the lit hairline along the INSIDE of the bottom edge, drawn
//             inside the card's clip so a straight strip follows the capsule's
//             curve into both ends. null on a skin with no depth to describe;
//   ridge   — the hairlines between the icons. Grooves across the floor rather
//             than part of the rim, so they keep their own value rather than
//             following the edge;
//   chip    — the theme accent, the one saturated element and therefore what
//             the eye tracks as it slides. Skin-independent: its glyph is
//             INKED AGAINST the accent (`inkOn`, see tabBarActiveTintColor in
//             App.js) — white for every saturated colour, near-black once the
//             accent is pale enough that white would disappear. The INACTIVE
//             glyphs are the skin's business, because they sit on the capsule
//             rather than on the chip (dockSkins' inactiveTint).

// How thick the lip is, for the skins that have one: 1.5pt, ~4px at @3x. A
// hairline disappears under the capsule's own curve at this radius, and 2pt
// starts to read as a second bar.
const DOCK_LIP_H = 1.5;

// Geometry is shared with the bar itself (see tabBarLayout) so the chip and the
// icons can never disagree about where a slot is.

export default function TabBarPill({ dragSlot, leadSlot }) {
  const { theme, dockIndicator, dockStyle, dockColor } = useTheme();
  // Every colour the capsule draws, from the skin chosen in Settings. The
  // colour is only consulted by the 'custom' skin, and is passed always rather
  // than conditionally so there is one call shape here and in App.js.
  const skin = dockSkin(dockStyle, dockColor);
  const [barWidth, setBarWidth] = useState(0);
  // Not dragging, and no dock to drag on (a test, a screenshot harness): -1 is
  // the resting contract, so an absent value behaves exactly like a lifted
  // finger. The hooks run unconditionally — the fallback is the VALUE, not the
  // call.
  const ownSlot = useSharedValue(-1);
  const ownLead = useSharedValue(-1);
  const slot = dragSlot ?? ownSlot;
  const lead = leadSlot ?? ownLead;

  // Read straight from the navigator: `index` is the focused tab and `routes`
  // is what's actually rendered, so a hidden tab shifts the geometry correctly.
  const index = useNavigationState((state) => state?.index ?? 0);
  const count = useNavigationState((state) => state?.routes?.length ?? 1);

  const underline = dockIndicator === 'underline';

  // The tabs are a CENTRED CLUSTER of fixed-width slots, not items stretched
  // across the bar, so the indicator is placed from the cluster's left edge —
  // the same edge the bar's own padding creates. Both treatments go through
  // indicatorOffset, which is why swapping them cannot move the travel line.
  const start = clusterStart(barWidth, count);
  const offset = indicatorOffset(start, underline ? UNDERLINE_W : PILL_SIZE);
  const ridges = useMemo(
    () => (barWidth > 0 ? ridgeOffsets(barWidth, count) : []),
    [barWidth, count],
  );

  // THE NAVIGATOR IS THE SLOWEST OF THE THREE THINGS THAT KNOW.
  //
  // `index` arrives through React: the press is handled, a navigate is
  // dispatched, the tree re-renders, and only then does this component learn
  // where the chip belongs — and on a tab whose screen is mounting, that chain
  // lands a few frames late. That lateness WAS the indicator's delay. So the
  // chip takes its aim from whichever of the three knows first:
  //
  //   drag — a thumb on the capsule, fractional, straight off the UI thread;
  //   lead — the slot a tap landed on, written by DockTabBar at touch-up,
  //          before React has done anything about it;
  //   index — the navigator, which is the truth and has the last word.
  //
  // A lead is spent the moment the navigator agrees with it (the effect below),
  // so these never fight: the lead gets the chip moving, `index` confirms the
  // same target, and withTiming is handed a value it is already travelling to —
  // which Reanimated continues rather than restarts. That is what makes the
  // travel one smooth move instead of a start, a hitch and a finish.
  useEffect(() => { lead.value = -1; }, [index, lead]);

  const pillStyle = useAnimatedStyle(() => {
    const dragging = slot.value >= 0;
    // ONE formula for all three: a slot (whole or fractional) times the slot
    // width, from the cluster's own left edge. A dragged chip, a led chip and a
    // navigated chip therefore all land in exactly the same place.
    const aim = dragging ? slot.value : (lead.value >= 0 ? lead.value : index);
    return {
      // Nothing to place until the bar has been measured; staying invisible
      // avoids the square flashing at x=0 on the first frame.
      opacity: withTiming(barWidth > 0 ? 1 : 0, SLIDE),
      transform: [{
        // Two states, and only one of them is an animation. Under the thumb
        // the indicator IS the finger — the position is written straight out,
        // so there is nothing between the two. Off the thumb it TRAVELS to the
        // slot that was chosen, on the same curve and duration as the page
        // behind it, which is what makes the release read as one movement
        // rather than a snap followed by a page.
        translateX: dragging
          ? TAB_SLOT * aim + offset
          : withTiming(TAB_SLOT * aim + offset, SLIDE),
      }],
    };
  }, [barWidth, index, offset]);

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        setBarWidth((prev) => (prev === w ? prev : w));
      }}
    >
      {/* The frosted capsule, in whichever material Settings chose. Blur params
          still come from the app's shared frost module so it's the same glass
          as the chat composer; only the TINT is the skin's, and it follows the
          skin rather than the theme — a light-tinted blur under a near-black
          wash just milks it out, and a dark one under a white wash greys it. */}
      <View testID="dock-card" style={[styles.card, { borderColor: skin.edge }]}>
        <BlurView
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          {...blurProps(theme)}
          tint={skin.blurTint}
        />
        {/* …and the wash over it. Always painted as a gradient even for a flat
            skin, which hands it the same colour twice — one code path rather
            than a branch per skin. Explicitly top-to-bottom rather than
            trusting the default, because for the skins that DO shade, the
            direction is the whole point of the element. */}
        <LinearGradient
          pointerEvents="none"
          testID="dock-wash"
          colors={skin.wash.colors}
          locations={skin.wash.locations}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {/* The lit floor of the channel. Inside the card, so the card's own
            overflow clips this straight strip to the capsule's shape and it
            curves up into both ends on its own. */}
        {skin.lip && (
          <View
            pointerEvents="none"
            testID="dock-lip"
            style={[styles.lip, { backgroundColor: skin.lip }]}
          />
        )}
      </View>
      {/* The ridges: one hairline between each pair of icons, drawn BEFORE the
          indicator so the chip passes over them rather than under. They are
          beside the chip, not behind it — a 57pt chip in a 67pt slot leaves 5pt
          of clearance either side, which is where these sit. */}
      {ridges.map((x) => (
        <View
          key={x}
          pointerEvents="none"
          testID="dock-ridge"
          style={[styles.ridge, { left: x - StyleSheet.hairlineWidth / 2, backgroundColor: skin.ridge }]}
        />
      ))}
      <Reanimated.View
        testID={underline ? 'dock-underline' : 'dock-chip'}
        style={[
          underline ? styles.underline : styles.pill,
          {
            // The highlight colour from Settings. On a white dock a white chip
            // would disappear, so the chip is the saturated element and the
            // glyph on it goes white. The LINE is the accent for the same
            // reason, and in that mode the active glyph takes the accent too
            // (tabBarActiveTintColor in App.js) — there is no chip under it to
            // be inked against.
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
  // The channel's lit floor — the skin supplies its colour. Full width and
  // clipped to the
  // capsule rather than inset by the radius, which is what lets it follow the
  // curve into both rounded ends.
  lip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: DOCK_LIP_H,
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
  // The other treatment: a line under the glyph instead of a card behind it.
  // Positioned from the BOTTOM of the same content block the chip fills, so the
  // two travel on one line and neither can drift from the glyphs — and so the
  // 36pt brand turtle clears it (see UNDERLINE_W/H).
  underline: {
    position: 'absolute',
    top: PILL_TOP + PILL_SIZE - UNDERLINE_H - 4,
    left: 0,
    width: UNDERLINE_W,
    height: UNDERLINE_H,
    borderRadius: UNDERLINE_H / 2,
    // No shadow: a 3pt line with a drop shadow reads as a smudge, and the line
    // is ON the capsule rather than resting on it the way the chip is.
  },
  // One ridge. A hairline, full height of the icon block less a breath at each
  // end, so it reads as a groove between two cells rather than as a divider
  // cutting the capsule in half.
  ridge: {
    position: 'absolute',
    top: PILL_TOP + 10,
    width: StyleSheet.hairlineWidth,
    height: PILL_SIZE - 20,
  },
});
