import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigationState } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { blurProps } from '../utils/frostedChat';
import Reanimated, {
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import {
  TAB_SLOT, PILL_SIZE, PILL_RADIUS, PILL_TOP, BAR_CONTENT_HEIGHT, clusterStart,
  UNDERLINE_W, UNDERLINE_H, indicatorOffset, ridgeOffsets,
} from './tabBarLayout';
import { CHIP_SLIDE_BASE_MS, TAB_SWITCH_BEZIER, chipAim, chipSlideMs } from './dockMotion';
import { dockSkin } from './dockSkins';
import { resolveDockSkin } from './dockThemes';

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

// A timed curve, NOT a spring — the same curve the pages travel on, so the
// move has one shape across the whole dock, but on the chip's own short clock
// rather than the pages'. See dockMotion for every number in here: why it
// leaves at full speed and only decelerates (the chip IS the selection you
// just made, and a selection that eases IN reads as hesitation), and why it
// now lands well before the page it selected does.
// The curve, built once. `.factory()` is what makes it callable from the UI
// thread. The DURATION is no longer part of it: how long the move takes is a
// property of the MOVE — of how far it goes — rather than of the control, so
// it arrives per-move through `slideMs` (see chipSlideMs in dockMotion).
const EASE = Easing.bezier(...TAB_SWITCH_BEZIER).factory();
// The first-layout fade-in, which is not a travel and has no distance.
const FADE = { duration: CHIP_SLIDE_BASE_MS, easing: EASE };
// The settle after a lifted thumb: always the shortest clock, because what is
// left of the move is a fraction of a slot.
const SETTLE = { duration: CHIP_SLIDE_BASE_MS, easing: EASE };

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

export default function TabBarPill({ dragSlot, leadSlot, slideMs, probe }) {
  const { theme, dockIndicator, dockStyle, dockColor, dockTheme } = useTheme();
  // Every colour the capsule draws, from the skin chosen in Settings — a
  // named theme if one is on, otherwise the chosen material. One resolver,
  // shared with App.js, so the glyph tints cannot disagree with the capsule.
  const skin = resolveDockSkin({ dockTheme, dockStyle, dockColor }, dockSkin);
  const [barWidth, setBarWidth] = useState(0);
  // Not dragging, and no dock to drag on (a test, a screenshot harness): -1 is
  // the resting contract, so an absent value behaves exactly like a lifted
  // finger. The hooks run unconditionally — the fallback is the VALUE, not the
  // call.
  const ownSlot = useSharedValue(-1);
  const ownLead = useSharedValue(-1);
  const ownMs = useSharedValue(CHIP_SLIDE_BASE_MS);
  const slot = dragSlot ?? ownSlot;
  const lead = leadSlot ?? ownLead;
  // How long THIS move should take, written by whoever started it. A number,
  // not a function call: the UI thread reads it and never computes it.
  const ms = slideMs ?? ownMs;

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
  // A lead is spent the moment the navigator agrees with it, so these never
  // fight: the lead gets the chip moving and `index` lands on the same slot,
  // which the driver below sees as no change at all.
  //
  // WHICH ORDER THE SPEND HAPPENS IN IS THE WHOLE THING — see the effect below,
  // where it now lives. It used to be an effect of its own, declared above the
  // one that mirrors `index`, and React runs effects in declaration order.

  // ── THE CHIP'S POSITION ────────────────────────────────────────────────
  //
  // One shared value, in pixels, and the style does nothing but read it.
  //
  // This used to be computed inside useAnimatedStyle, with withTiming called
  // in the style itself — and that is what jittered. A style worklet re-runs
  // on every re-render AND on every change to any value it reads, and a
  // `withTiming` inside it is re-created each time: a single tab change ran it
  // four times (the duration arrives, the lead arrives, the navigator commits,
  // the lead is spent), and each re-creation restarts the timing from the
  // chip's current position with a fresh full duration. On a curve whose
  // velocity is at its MAXIMUM on the first frame, a restart is a visible
  // kick — four of them in 160ms is the jitter, and the repeatedly-restarted
  // clock is why it also finished late.
  //
  // So the animation is started imperatively, exactly once per move, from the
  // one place that can tell a move from a re-render: a reaction watching what
  // the chip is actually aimed at. React can re-render as often as it likes
  // now — the style reads a number, and nothing it does can restart a travel
  // that is already in flight.
  const x = useSharedValue(0);
  const fade = useSharedValue(0);

  // `index` and the geometry live in React state; the driver runs on the UI
  // thread, so they are mirrored into shared values it can read.
  const indexSV = useSharedValue(index);
  const offsetSV = useSharedValue(offset);
  // ── THE HANDOVER, AND WHY IT IS ONE EFFECT IN THIS ORDER ────────────────
  //
  // Two writes, and both of them are a SEPARATE job on the UI thread: a
  // shared value assigned from JS compiles to `runOnUI(() => { sv.value = v })`
  // (see mutables.ts), and each assignment runs the reaction below before the
  // next one lands. So the chip sees every intermediate state these three
  // writes pass through, and one wrong order is a visible move.
  //
  // This is the bug Mark described as the chip "trying to snap to each tab as
  // it travels", worst across the full width of the bar. The spend used to be
  // an effect of its own, declared ABOVE this one, so on the commit where the
  // navigator agreed the order was:
  //
  //   lead = -1        → aim falls through to `indexSV`, which is STILL THE
  //                      SLOT THE CHIP LEFT. The aim has changed, so a full
  //                      travel starts — BACKWARDS, to where it came from.
  //   indexSV = 5      → the aim changes again, so a THIRD travel starts, from
  //                      wherever the backward kick had got to, on a fresh
  //                      full duration.
  //
  // Three travels per tab change, the middle one reversed, and the further the
  // move the bigger the kick — which is exactly why it read as worst crossing
  // the whole dock. Nothing about the curve could have fixed it.
  //
  // In one effect, in this order, no intermediate state changes the aim:
  // `indexSV` arrives while the lead still holds the same slot (aim unchanged),
  // and only then is the lead spent (aim unchanged again). It is also correct
  // if Reanimated ever coalesces these into one job, because the END state is
  // the same — the order is no longer load-bearing for correctness, only for
  // the frames in between.
  useEffect(() => {
    // The duration used to be written here too, for a tab change made from
    // SOMEWHERE ELSE — a deep link, the /command console, a guard bouncing you
    // out of a tab — which has no press behind it to have said how far the
    // chip is about to go. The reaction works that out for itself now, from
    // the distance it is actually covering, so every move is timed the same
    // way whoever started it and there is nothing to write ahead.
    //
    // The truth first, which the lead is already pointing at.
    indexSV.value = index;
    // ONLY THEN the spend. Last, so the fall-through from `lead` to `indexSV`
    // happens between two values that agree.
    lead.value = -1;
  }, [index, indexSV, lead]);
  useEffect(() => { offsetSV.value = offset; }, [offset, offsetSV]);

  // Nothing to place until the bar has been measured; staying invisible avoids
  // the chip flashing at x=0 on the first frame.
  useEffect(() => {
    fade.value = withTiming(barWidth > 0 ? 1 : 0, FADE);
  }, [barWidth, fade]);

  useAnimatedReaction(
    () => {
      const dragging = slot.value >= 0;
      return {
        dragging,
        // ONE formula for all three sources: a slot (whole or fractional)
        // times the slot width, from the cluster's own left edge. A dragged
        // chip, a led chip and a navigated chip land in the same place.
        aim: chipAim(dragging, slot.value, lead.value, indexSV.value),
        offset: offsetSV.value,
      };
    },
    (cur, prev) => {
      const px = TAB_SLOT * cur.aim + cur.offset;
      // Under the thumb the chip IS the finger: written straight out, every
      // frame, with nothing in between.
      if (cur.dragging) { x.value = px; return; }
      // First run, and any time the bar's geometry changes underneath it (a
      // rotation, a tab being hidden in Settings): a layout is not a move, so
      // the chip is PLACED rather than sent travelling.
      if (!prev || cur.offset !== prev.offset) { x.value = px; return; }
      // The thumb let go. What is left is a fraction of a slot, so it settles
      // on the shortest clock the dock has rather than a full crossing's.
      if (prev.dragging) { x.value = withTiming(px, SETTLE); return; }
      // A real move, and the only path that starts a travel: the aim changed.
      // Re-renders do not reach here, which is the whole point.
      if (cur.aim !== prev.aim) {
        // ARM THE PROBE. This is the one instant in the app that knows a
        // travel is beginning, so it is where the measurement starts — see
        // dockMotionProbe for why it is written inline here rather than
        // handed over as a function to call. Reset at the START of a move, so
        // a move that gets interrupted leaves no half-filled numbers behind.
        if (probe) {
          const now = Date.now();
          probe.startedAt.value = now;
          // -1 for a move with no touch behind it — a deep link, the /command
          // console, a guard bouncing you out of a tab. There is no delay to
          // report when there was no finger.
          probe.startLate.value = probe.touchAt.value === 0 ? -1 : now - probe.touchAt.value;
          probe.touchAt.value = 0;
          probe.frames.value = 0;
          probe.worst.value = 0;
          probe.best.value = 0;
          probe.pressBusy.value = 0;
          probe.sampling.value = 1;
        }
        // HOW LONG, worked out from the move that is actually happening.
        //
        // It used to be read out of `ms`, written by whoever started the move
        // on the JS thread. That stopped being possible when the chip began
        // leaving on the TOUCH rather than on the lift: at touch-down no JS
        // has run yet, so `ms` still holds the LAST move's duration, and a
        // one-slot hop would take a dock-crossing's time (or the reverse).
        // The distance is right here — the aim it is leaving and the aim it is
        // going to — so the clock is derived rather than delivered.
        const duration = chipSlideMs(cur.aim - prev.aim);
        // Written back for the probe, whose sampling window is `travel + tail`
        // and would otherwise close against a duration this move never used.
        ms.value = duration;
        x.value = withTiming(px, { duration, easing: EASE });
      }
    },
    [],
  );

  // Pure reads. No animation is created in here, so a re-render cannot
  // restart one.
  const pillStyle = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateX: x.value }],
  }));

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
        // THE CHIP TRAVELS AS A CACHED BITMAP.
        //
        // It is a rounded, SHADOWED layer (see styles.pill) moving across a
        // blur view. Without this, iOS re-renders that shadow offscreen on
        // every frame of the travel — a shadow has no `shadowPath` here, so
        // its shape is derived from the layer each time — and because the
        // shadow is translucent over the capsule's glass, the blur underneath
        // has to be recomposited everywhere the shadow's alpha lands. That is
        // per-frame offscreen work on the main thread, which is the thread
        // compositing the animation, so the chip competes with itself: the
        // faster it moves, the more it costs.
        //
        // Rasterized, the whole thing — fill, corner curve and shadow — is
        // drawn once into a texture and the texture is what moves. Correct
        // because nothing about the chip's CONTENT changes while it travels;
        // only its position does. (A layer whose content changed every frame
        // would be re-cached every frame and this would make it worse.)
        //
        // Fabric sets `rasterizationScale` to the display scale alongside
        // this, so the cache is retina and the chip does not go soft —
        // verified in RCTViewComponentView.mm rather than assumed, because a
        // blurry chip would be a worse bug than a stuttering one.
        shouldRasterizeIOS
        renderToHardwareTextureAndroid
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
