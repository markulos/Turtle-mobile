import React, { useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { NavigationHelpersContext, useNavigationState } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { blurProps } from '../utils/frostedChat';
import DockGlow from './DockGlow';
import {
  SHADE_PEAK, SPOT_H, SPOT_PEAK, SPOT_W, glowStrength, pickedGlowColor, rimColor, shadeColor,
} from './dockLight';
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
import {
  CHIP_CATCH_MS, CHIP_SLIDE_BASE_MS, PRESS_DIM, TAB_SWITCH_BEZIER, chipAim, chipSlideMs,
} from './dockMotion';
import { currentTabIndex, useDockSettle } from './dockNav';
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
// A chip a thumb has just picked up, closing the gap it had (see CHIP_CATCH_MS).
const CATCH = { duration: CHIP_CATCH_MS, easing: EASE };

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

// THE SPOT — the underline's light.
//
// A pool of the highlight colour standing on the line and fading up over the
// glyph. It was first tried as the line's own shadow, coloured and thrown
// upward, and could not be seen: a 3pt line is almost no source, and a
// gaussian that wide spreads it to about a twentieth of its strength. Then
// as stacked gradient bands, which could be seen but were a staircase
// standing in for a curve. Now it is the curve: one RADIAL gradient, as a
// vector (DockGlow), centred on the line so only its upper half shows.
// Rasterised once and moved as a bitmap, exactly like the indicator.
// Its numbers live in dockLight, shared with the live preview in Settings.

// How thick the lip is, for the skins that have one: 1.5pt, ~4px at @3x. A
// hairline disappears under the capsule's own curve at this radius, and 2pt
// starts to read as a second bar.
const DOCK_LIP_H = 1.5;

// Geometry is shared with the bar itself (see tabBarLayout) so the chip and the
// icons can never disagree about where a slot is.

export default function TabBarPill({
  dragSlot, leadSlot, navSlot, chipPos, chipFrom, chipTo, slideMs, probe, pressLift,
}) {
  const {
    theme, dockIndicator, dockStyle, dockColor, dockTheme, dockGlow, dockGlowColor,
  } = useTheme();
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
  const ownPress = useSharedValue(0);
  const slot = dragSlot ?? ownSlot;
  const lead = leadSlot ?? ownLead;
  // How long THIS move should take, written by whoever started it. A number,
  // not a function call: the UI thread reads it and never computes it.
  const ms = slideMs ?? ownMs;
  // 0 at rest, 1 while a finger is on the dock. DockTabBar owns the gesture
  // that drives it; the wash is drawn here, so the press is painted here.
  const press = pressLift ?? ownPress;

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

  // HOW STRONG THE GLOW IS — the Settings step (0 is off, 1 as designed).
  // Undefined in a harness with no such setting, which means "as designed".
  const glow = glowStrength(dockGlow);
  // The underline's spot, on every dock. It began dark-only (on a light bar
  // a tinted pool was judged a stain); the owner asked for it on light bars
  // too, in the highlight colour, so now only "Off" removes it.
  const spot = underline && glow > 0;
  // WHAT COLOUR THE LIGHT IS. A colour picked in Settings wins: it is the
  // spot's colour, and the colour of the chip's rim. Otherwise the spot is
  // the highlight colour — it is the line's own light — and the rim is plain
  // light. The chip's SHADE follows the chip, not this; see dockLight.
  const pickedGlow = pickedGlowColor(dockGlowColor);
  const spotColor = pickedGlow || theme.colors.accent;
  // The chip's shade: its own colour, deeper. Null for a white chip.
  const chipShade = shadeColor(theme.colors.accent);

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

  // The thumb's catch-up: how far the chip was from the finger on the frame a
  // drag began, run down to zero (CHIP_CATCH_MS). Added to `x` in the style, so
  // `x` itself stays the raw position under the thumb.
  const catchUp = useSharedValue(0);

  // THE ENDS OF THE TRAVEL, for the icons: the slot the chip is leaving and
  // the slot it is going to. Only those two glyphs change ink (TabBarIcon) —
  // the one behind fades out as the chip pulls away, the one ahead fades in
  // as it arrives, and anything in between is passed over untouched. -2 is
  // "no ends": a thumb has the chip, and whatever it is over lights.
  const ownFrom = useSharedValue(-2);
  const ownTo = useSharedValue(-2);
  const endFrom = chipFrom ?? ownFrom;
  const endTo = chipTo ?? ownTo;

  // `index` and the geometry live in React state; the driver runs on the UI
  // thread, so they are mirrored into shared values it can read. App.js owns
  // the index's mirror and hands it in, because the dock writes it too (the
  // moment it asks for a tab — see dockNav); the fallback keeps this component
  // renderable on its own. App's starts at -1, "not known yet", which the
  // driver below treats as a placement rather than a travel.
  const ownNav = useSharedValue(index);
  const indexSV = navSlot ?? ownNav;
  const offsetSV = useSharedValue(offset);
  // ── THE HANDOVER ────────────────────────────────────────────────────────
  //
  // When the navigator's index changes, the chip is told two things: where
  // the navigator is, and that the lead pointing there has done its job. This
  // is the oldest source of trouble in the dock, and it has been wrong in two
  // different ways.
  //
  // FIRST, the order. The lead used to be spent in an effect of its own,
  // ABOVE the one that mirrored the index, so for one UI-thread job the aim
  // fell through to an index that was still the slot the chip had LEFT — a
  // full travel backwards, then a third one forwards. Fixed by doing both in
  // one place, index first.
  //
  // SECOND, and this is what was still making the chip refuse a press: the
  // lead was spent UNCONDITIONALLY, and the index written was the one this
  // RENDER saw. Both are late by however long React took to commit, and on a
  // tab whose screen is waking up that is long enough to put a finger down on
  // the next tab. That next touch aims the chip at touch-down, on the UI
  // thread — and then this effect arrived from the PREVIOUS change, cleared
  // the new aim and pointed the chip back at the tab being left. The chip sat
  // there until the second press was finally processed: "the guide sometimes
  // doesn't move to the tab I pressed".
  //
  // So both halves are now exact rather than assumed:
  //
  //   • the index is read from the navigator's STORE at the moment the effect
  //     runs (it is synchronous — see dockNav), not taken from the render that
  //     scheduled the effect. A late effect therefore reports the present,
  //     never the past;
  //   • the lead is spent only if it points at that index (leadAfterSettle).
  //     A lead that points anywhere else belongs to a touch this commit knows
  //     nothing about, and is left exactly as it is.
  //
  // One UI-thread job, index first (useDockSettle), so the first rule still
  // holds for every intermediate frame.
  // The TAB navigator's own helpers — the same object DockTabBar is handed as
  // `navigation`. Taken from the navigator's context rather than from
  // useNavigation(), which out here (the bar is not inside any screen) would
  // be the root container, and only happens to be the same thing while the
  // tabs are the app's root navigator.
  const navigation = useContext(NavigationHelpersContext);
  const settle = useDockSettle(lead, indexSV);
  useEffect(() => {
    const live = currentTabIndex(navigation, null);
    const now = live >= 0 ? live : index;
    settle(now, now);
  }, [index, navigation, settle]);
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
      if (cur.dragging) {
        endTo.value = -2;
        // …except on the frame the thumb TAKES it. The chip is wherever it
        // was — resting half a slot from the finger, or still crossing the
        // dock on its way to the touch — and written raw from there it
        // teleports. The gap is carried as an offset and run down to zero;
        // `x` is still the raw position, so nothing about the tracking lags.
        if (prev && !prev.dragging) {
          catchUp.value = x.value - px;
          catchUp.value = withTiming(0, CATCH);
        }
        x.value = px;
        return;
      }
      // First run, any time the bar's geometry changes underneath it (a
      // rotation, a tab being hidden in Settings), and the moment the
      // navigator's index is first KNOWN (it starts as -1): none of those is a
      // move, so the chip is PLACED rather than sent travelling.
      if (!prev || cur.offset !== prev.offset || prev.aim < 0) {
        x.value = px;
        endFrom.value = cur.aim;
        endTo.value = cur.aim;
        return;
      }
      // The thumb let go. What is left is a fraction of a slot, so it settles
      // on the shortest clock the dock has rather than a full crossing's.
      if (prev.dragging) {
        x.value = withTiming(px, SETTLE);
        // The thumb let go on (or beside) one icon: that one is both ends.
        endFrom.value = cur.aim;
        endTo.value = cur.aim;
        return;
      }
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
        // The ends of THIS travel. "From" is where the last travel was
        // going rather than the nearest slot: at rest those are the same
        // icon, and if the chip is re-aimed in flight it is the one icon
        // that may already be part-lit — so it fades out from where it is
        // instead of some passed-over neighbour snapping on.
        endFrom.value = endTo.value >= 0 ? endTo.value : Math.round(prev.aim);
        endTo.value = cur.aim;
        const duration = chipSlideMs(cur.aim - prev.aim);
        // Written back for the probe, whose sampling window is `travel + tail`
        // and would otherwise close against a duration this move never used.
        ms.value = duration;
        x.value = withTiming(px, { duration, easing: EASE });
      }
    },
    [],
  );

  // WHERE THE CHIP IS, for the icons. A fractional slot — 2.4 is "four tenths
  // of the way from the third icon to the fourth" — written every frame the
  // chip moves, on the UI thread. Each TabBarIcon turns it into how much of
  // the chip is under it, and inks and swells itself by that amount, so the
  // glyphs change WITH the chip rather than when React gets round to saying
  // which tab is focused. Slots rather than pixels, so the icons need to know
  // nothing about the bar's geometry; -1 while the navigator's index is not
  // known yet, which the icons read as "fall back to `focused`".
  const ownChipPos = useSharedValue(-1);
  const pos = chipPos ?? ownChipPos;
  useAnimatedReaction(
    () => (indexSV.value < 0 && lead.value < 0 && slot.value < 0
      ? -1
      : (x.value + catchUp.value - offsetSV.value) / TAB_SLOT),
    (now, before) => {
      if (now !== before) pos.value = now;
    },
    [],
  );

  // THE PRESS, PAINTED. A flat gradient fading — nothing is asked of the blur
  // underneath it, which is the whole point of the change: this used to be a
  // scale on the dock's wrapper, and a transform above a BlurView makes iOS
  // re-sample the glass on every frame of it. See dockMotion's note on
  // PRESS_DIM. The timing is DockTabBar's; this only reads the value.
  const washStyle = useAnimatedStyle(() => ({
    opacity: 1 - press.value * (1 - PRESS_DIM),
  }));

  // Pure reads. No animation is created in here, so a re-render cannot
  // restart one.
  const pillStyle = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateX: x.value + catchUp.value }],
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
        <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, washStyle]}>
          <LinearGradient
            pointerEvents="none"
            testID="dock-wash"
            colors={skin.wash.colors}
            locations={skin.wash.locations}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Reanimated.View>
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
      {spot ? (
        <Reanimated.View
          pointerEvents="none"
          testID="dock-spot"
          shouldRasterizeIOS
          renderToHardwareTextureAndroid
          style={[styles.spot, pillStyle]}
        >
          <DockGlow
            id="dock-spot-glow"
            width={SPOT_W}
            height={SPOT_H}
            color={spotColor}
            peak={SPOT_PEAK * glow}
            cy={1}
            ry={1}
          />
        </Reanimated.View>
      ) : null}
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
          // The chip's translucent ridge. Not the line's: a 3pt line with
          // a border is just a thicker line.
          underline ? null : [styles.rim, { borderColor: rimColor(pickedGlow) }],
          pillStyle,
        ]}
      >
        {/* THE CHIP'S SHADE — a deeper tone of its own colour in its middle,
            so with the lit rim it reads as a piece of glass set INTO the bar
            rather than a flat fill. Never black, and none on a white chip.
            Inside the chip, so it is part of the same cached bitmap and
            travels with it for nothing. */}
        {!underline && glow > 0 && chipShade ? (
          <View pointerEvents="none" style={styles.shade} testID="dock-chip-shade">
            <DockGlow
              id="dock-chip-glow"
              width={PILL_SIZE}
              height={PILL_SIZE}
              color={chipShade}
              peak={SHADE_PEAK * glow}
            />
          </View>
        ) : null}
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
  // THE SPOT's box: SPOT_W wide, centred on the line (which is UNDERLINE_W
  // wide and starts at the indicator's own left edge), and standing on it.
  spot: {
    position: 'absolute',
    top: PILL_TOP + PILL_SIZE - UNDERLINE_H - 4 - SPOT_H,
    left: -(SPOT_W - UNDERLINE_W) / 2,
    width: SPOT_W,
    height: SPOT_H,
  },
  // THE CHIP'S EDGE: a translucent ridge of light round it, so the chip reads
  // as a raised piece of glass rather than a flat fill. A full point rather
  // than a hairline — at a third of a point it disappears into the accent.
  rim: {
    borderWidth: 1,
    // The colour is set where it is drawn: dockLight's rimColor.
    borderColor: 'transparent',
  },
  // …and its shade sits exactly over it.
  shade: { position: 'absolute', top: -1, left: -1 },
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
