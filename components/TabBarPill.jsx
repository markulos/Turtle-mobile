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
import { dockSurfaceStops } from './dockSurface';
import {
  chipShadeStops, chipSheenStops, CHIP_SHADE_SPAN, CHIP_SHEEN_SPAN,
} from './chipRecess';

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

// The dock's palette — ONE set for BOTH themes: a ghosted-black capsule, the
// dark treatment applied in light mode too. It reads as a floating piece of
// hardware over the page rather than a panel that restyles itself, and the
// glyph/chip contrast is then a single problem to solve instead of two.
//
//   surface — near-black, translucent enough that the blur still shows the page
//             moving behind it, and no longer FLAT: it runs from a lifted top
//             edge to a denser bottom one, because a slab is the one part of a
//             floating-object treatment that does not behave like an object.
//             The arithmetic, the two end colours and why the ramp is a
//             smoothstep rather than two stops are all in dockSurface.js;
//   edge    — a white hairline BEZEL: the device's thinnest renderable line, at
//             enough alpha to actually read as a rim around the capsule rather
//             than a barely-there seam. It's white in both themes because the
//             surface under it is black in both, and because a lit edge is what
//             makes the capsule sit as a physical object on the page instead of
//             a soft shadow of one. 0.12 was tuned against a WHITE light-mode
//             dock and disappeared once the surface went black;
//   chip    — the theme accent, the one saturated element and therefore what the
//             eye tracks as it slides. Its glyph is INKED AGAINST the accent
//             (`inkOn`, see tabBarActiveTintColor in App.js): white for every
//             saturated colour, near-black once the accent is pale enough that
//             white would disappear. The INACTIVE glyphs stay white-on-dark in
//             both themes regardless — they sit on the capsule, not the chip,
//             and a dark tint would vanish into it. The chip is CUT INTO the
//             capsule rather than resting on it — see the two hairlines below
//             and chipRecess.js;
//   groove  — the crack where the capsule's face meets the wall of the cut. It
//             is nearly-black on a nearly-black capsule and barely visible as a
//             colour, which is correct: its job is to stop the accent bleeding
//             straight into the capsule, so the chip has an EDGE rather than a
//             soft join;
//   lip     — the chamfer along the BOTTOM of the cut, the one face of the
//             recess that is tilted up into the light. This is the ridge: a
//             single point of it peeking out under the chip, following the same
//             squircle. It is the difference between a hole and a dark square.
const DOCK_EDGE = 'rgba(255,255,255,0.30)';
const CHIP_GROOVE = 'rgba(0,0,0,0.45)';
const CHIP_LIP = 'rgba(255,255,255,0.22)';
// 1.5pt, so the ridge is ~4px of lit edge at @3x — a line you can see, which
// is the whole point of it, while still being thinner than the glyph's own
// stroke so it reads as an edge rather than as a second shape under the chip.
const CHIP_LIP_DROP = 1.5;

// Built once: the stops do not depend on anything that changes — not the
// theme, not the width, not which tab is up. Same for the chip's two washes:
// they are black and white over whatever the accent happens to be, so they
// survive an accent change without being rebuilt.
const SURFACE = dockSurfaceStops();
const CHIP_SHADE_STOPS = chipShadeStops();
const CHIP_SHEEN_STOPS = chipSheenStops();

// Geometry is shared with the bar itself (see tabBarLayout) so the chip and the
// icons can never disagree about where a slot is.

export default function TabBarPill({ dragSlot, leadSlot }) {
  const { theme, dockIndicator } = useTheme();
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
        {/* …and the wash over it: lighter at the top edge, heavier at the
            bottom, so the capsule reads as a lit surface rather than a slab.
            Explicitly top-to-bottom rather than trusting the default, because
            the whole point of this element is its direction. */}
        <LinearGradient
          pointerEvents="none"
          colors={SURFACE.colors}
          locations={SURFACE.locations}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
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
          style={[styles.ridge, { left: x - StyleSheet.hairlineWidth / 2, backgroundColor: DOCK_EDGE }]}
        />
      ))}
      <Reanimated.View
        testID={underline ? 'dock-underline' : 'dock-chip'}
        style={[
          underline ? styles.underline : styles.pill,
          // The LINE is painted here; the CHIP is painted on the view inside,
          // because the recess needs something to hang off the outside of it
          // (the lip) as well as something clipped to the inside (the washes).
          underline && { backgroundColor: theme.colors.accent },
          pillStyle,
        ]}
      >
        {!underline && (
          <>
            {/* THE RIDGE. The same squircle as the chip, dropped a point and a
                half, so all that shows is a lit crescent along the bottom
                curve — the one face of a cut that tilts up into the light.
                Drawn first so the chip covers the rest of it. */}
            <View pointerEvents="none" testID="dock-chip-lip" style={styles.lip} />
            <View
              pointerEvents="none"
              testID="dock-chip-face"
              style={[
                styles.chip,
                {
                  // The highlight colour from Settings. On a white dock a white
                  // chip would disappear, so the chip is the saturated element
                  // and the glyph on it goes white. In underline mode the line
                  // takes the accent for the same reason, and the active glyph
                  // with it (tabBarActiveTintColor in App.js) — there is no
                  // chip under it to be inked against.
                  backgroundColor: theme.colors.accent,
                },
              ]}
            >
              {/* The well's shadowed top wall, and its lit bottom one. Both are
                  clipped to the squircle by the chip's overflow, so they follow
                  the corners instead of cutting across them. */}
              <LinearGradient
                pointerEvents="none"
                testID="dock-chip-shade"
                colors={CHIP_SHADE_STOPS.colors}
                locations={CHIP_SHADE_STOPS.locations}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.chipShade}
              />
              <LinearGradient
                pointerEvents="none"
                testID="dock-chip-sheen"
                colors={CHIP_SHEEN_STOPS.colors}
                locations={CHIP_SHEEN_STOPS.locations}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.chipSheen}
              />
            </View>
          </>
        )}
      </Reanimated.View>
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
  // The chip's FOOTPRINT — the travelling box, and nothing else. It carries no
  // colour, no corners and above all NO SHADOW: it used to have a 6pt drop
  // shadow offset 2pt down, which is the signature of a tile resting on a
  // surface, and it read as exactly that — bevelled outward, proud of the dock.
  // A recess is the same physics inverted, and every part of it is drawn by the
  // layers below instead.
  pill: {
    position: 'absolute',
    // Centre line of the card (see PILL_TOP). The icon slot is the same square
    // and centres itself in the same row, so chip and glyph share one centre.
    top: PILL_TOP,
    left: 0,
    width: PILL_SIZE,
    height: PILL_SIZE,
  },
  // The cut itself. Clips its two washes to the squircle, and carries the
  // groove hairline so the accent ends on an edge rather than fading into the
  // capsule.
  chip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: PILL_RADIUS,
    // The iOS superellipse rather than a circular arc — this is what separates
    // a squircle from a rounded square. iOS-only; Android ignores it and falls
    // back to the plain radius, which still reads correctly.
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CHIP_GROOVE,
    overflow: 'hidden',
  },
  // The ridge: the same shape, one point lower, so only its bottom curve is
  // ever visible. Sized from the slot rather than filling it, because a
  // bottom: -1 would be clipped by anything that ever clips this layer.
  lip: {
    position: 'absolute',
    top: CHIP_LIP_DROP,
    left: 0,
    width: PILL_SIZE,
    height: PILL_SIZE,
    borderRadius: PILL_RADIUS,
    borderCurve: 'continuous',
    backgroundColor: CHIP_LIP,
  },
  chipShade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: Math.round(PILL_SIZE * CHIP_SHADE_SPAN),
  },
  chipSheen: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: Math.round(PILL_SIZE * CHIP_SHEEN_SPAN),
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
