import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { InteractionManager, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBar } from '@react-navigation/bottom-tabs';
import { CommonActions } from '@react-navigation/native';

import { dockOccupied, slotAtX } from './tabBarLayout';
import { PRESS_IN_MS, PRESS_OUT_MS, PRESS_SCALE, TAB_SWITCH_BEZIER } from './dockMotion';
import { holdEdgeSwipe } from '../utils/edgeSwipeGuard';

/**
 * DockTabBar — the bottom nav, with a thumb you can DRAG along it.
 *
 * Tapping a tab was the only way to change tabs, which makes every switch a
 * lift-aim-press cycle even when you are moving one slot. Dragging makes the
 * dock a single control you scrub, and the gesture has two halves that do not
 * overlap:
 *
 *   WHILE THE THUMB IS DOWN, the chip tracks it 1:1 and nothing else moves.
 *   No navigate, so no page swap and no icon changing colour mid-scrub. You
 *   can run the length of the dock and come back without having committed to
 *   anything.
 *
 *   ON RELEASE, the nearest tab to where you let go is the one you chose. It
 *   is a single navigate, so the page turns and the icons take their new
 *   colours once, together, while the chip travels to that slot on the app's
 *   tab-switch curve (dockMotion).
 *
 * That split is the whole design. The first version committed a tab per icon
 * crossed, which meant a scrub was five tab changes: five page transitions and
 * five sets of icons lighting and unlighting under a thumb that was still
 * moving. Tapping is untouched either way — a press still goes straight to
 * react-navigation's own button.
 *
 * ── Why this wraps BottomTabBar instead of replacing it ─────────────────────
 *
 * Everything the dock looks like is already in `screenOptions` (App.js) and in
 * TabBarPill, and both of those are built on react-navigation owning the
 * buttons — the comment in TabBarIcon records what rewriting `tabBarButton`
 * cost twice (an empty bar: the button's own `style` carries the flex that
 * sizes a tab, and v7 reports selection through `aria-selected`). So this adds
 * ONE gesture over the real bar and changes nothing else. Layout, a11y, the
 * long-press that opens the console, the ripple: all still the library's.
 *
 * ── Why the wrapper view is shaped the way it is ────────────────────────────
 *
 * GestureDetector needs a host view to attach to; BottomTabBar is a function
 * component and cannot take a ref. The wrapper is therefore a real view, and
 * it has to be exactly the dock's own footprint:
 *
 *   • `position: absolute` + `bottom: 0` with the dock's height, because the
 *     bar inside it positions itself against the bottom of its parent (v7's
 *     `styles.bottom` is start/end/bottom: 0) and `dockOccupied` is that same
 *     box measured up from the window edge. A full-screen wrapper would also
 *     work for the gesture and would put the pan handler over every page.
 *   • `pointerEvents="box-none"`, so the strip of wrapper NOT covered by the
 *     capsule — the home-indicator inset below it, the 10pt margins either
 *     side — stays transparent to touch. The dock floats over content; a
 *     wrapper that swallowed touches there would eat taps on the page.
 *
 * A gesture recogniser attached here still sees touches that land on the tab
 * buttons inside it, which is the whole point: the press and the drag are both
 * live until one of them wins. RNGH cancels the button's press the moment the
 * pan activates, so a scrub never also fires the tab you started on.
 *
 * ── The press ──────────────────────────────────────────────────────────────
 *
 * The whole dock swells a point and a half the instant a finger lands on it,
 * and HOLDS while the finger is down — so a press-and-scrub keeps the bar
 * lifted for the length of the drag rather than blinking at the start of it.
 * The numbers and the reasoning are in dockMotion.
 *
 * It hangs off onBegin/onFinalize rather than onStart/onEnd, and that is the
 * point: onStart fires only once the pan ACTIVATES, which a tap never does.
 * onBegin is the touch landing, whatever the gesture turns out to be, and
 * onFinalize is it leaving — including when the system cancels, which is the
 * one path that must never leave the dock stuck at its pressed size.
 *
 * Applied to THIS wrapper, the common ancestor of the capsule and the
 * buttons, so the bar and its contents scale as one object. Scaling the chip
 * separately would multiply its 1:1 drag tracking and slide it off the glyph
 * under the thumb.
 *
 * ── No haptic ──────────────────────────────────────────────────────────────
 *
 * Deliberate, twice over: tab switching is silent by request (see App.js), and
 * the app's rule is no touch feedback while a finger is MOVING — a tick per
 * crossed icon during a fast scrub is a buzz, not feedback.
 */

// How far the thumb must travel sideways before this becomes a drag. 8 was too
// little: the roll of a thumb settling onto an icon is a few points of sideways
// travel, so ordinary taps were being read as the start of a scrub. 12 is still
// inside the distance a deliberate slide covers in its first frames, so the
// drag has not become harder to start — only harder to start by accident.
const DRAG_SLOP = 12;

// The press timings, built ONCE here on the JS thread, with REANIMATED's
// Easing. The gesture callbacks that use them are worklets on the UI thread,
// and the UI thread can only call worklets: a helper function, or React
// Native's Easing (a plain JS closure), called from there throws "non-worklet
// function on the UI thread" — which a release build turns into a crash on
// the first touch of the dock. Plain objects holding a Reanimated easing are
// what a worklet can capture.
const PRESS_IN = { duration: PRESS_IN_MS, easing: Easing.bezier(...TAB_SWITCH_BEZIER) };
const PRESS_OUT = { duration: PRESS_OUT_MS, easing: Easing.bezier(...TAB_SWITCH_BEZIER) };

export default function DockTabBar({ dragSlot, leadSlot, pressLift, ...props }) {
  const { state, navigation } = props;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const count = state.routes.length;

  // The chip's live position, shared with TabBarPill (App.js owns the value and
  // hands it to both). -1 means "nobody is dragging" — one value rather than a
  // position plus a flag, so there is no frame where the pill believes a stale
  // position because the flag arrived first. The fallback keeps this component
  // renderable on its own, in a test or a screenshot harness.
  const ownSlot = useSharedValue(-1);
  const slot = dragSlot ?? ownSlot;

  // The slot the lifted thumb CHOSE, written on the UI thread at the moment of
  // release — before React has heard about the navigate, let alone re-rendered.
  // Without it the chip would aim at the old tab for the few frames the
  // navigator takes to agree, which is a visible flick backwards on the way to
  // the new one. See TabBarPill, which spends it as soon as `index` catches up.
  const ownLead = useSharedValue(-1);
  const lead = leadSlot ?? ownLead;

  // 0 at rest, 1 while a finger is down. Nothing outside the dock needs it —
  // the scale is applied to the dock's own wrapper — so this one is local,
  // with the same injectable fallback the two above use: a shared value the
  // UI thread writes is otherwise unreadable from a test.
  const ownPress = useSharedValue(0);
  const press = pressLift ?? ownPress;
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + press.value * (PRESS_SCALE - 1) }],
  }));

  // The navigator's state through a ref, NOT captured in the callback below.
  // `state` is a new object on every navigation — including the ones this
  // gesture makes — so depending on it would rebuild the Gesture object
  // mid-drag, several times per scrub, and hand GestureDetector a different
  // gesture while a finger is still down on the old one.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const goToIndex = useCallback((i) => {
    const current = stateRef.current;
    const route = current.routes[i];
    // A scrub that wanders off and comes back lands on the tab it started on,
    // and that is not a tab change — the chip simply returns to where it was.
    if (!route || route.key === current.routes[current.index]?.key) return;
    // The same dispatch BottomTabBar's own onPress makes, minus the `tabPress`
    // event: nothing in the app listens for it, and a drag is not a press.
    navigation.dispatch({ ...CommonActions.navigate(route), target: current.key });
  }, [navigation]);

  // Held for the duration of a drag so that nothing deferred runs under the
  // thumb. The chip tracks the finger 1:1 now, which means every frame of the
  // gesture is a frame someone can see go wrong; withTabSkeleton and anything
  // else waiting on interactions stands still until the thumb is up, and the
  // tab that was landed on mounts then.
  const holdRef = useRef(null);
  // …and, for the same duration, the EDGE-SWIPE GUARD. A scrub along the dock
  // is a rightward drag low on the screen, which is exactly the shape of the
  // back-swipe every pushed page listens for (EdgeSwipePage's grab zone is the
  // whole left panel). Without this, dragging the chip from the left of the
  // dock can close the page the dock is sitting on.
  const swipeRef = useRef(null);
  const hold = useCallback(() => {
    if (holdRef.current == null) holdRef.current = InteractionManager.createInteractionHandle();
    if (swipeRef.current == null) swipeRef.current = holdEdgeSwipe();
  }, []);
  const release = useCallback(() => {
    if (holdRef.current != null) {
      InteractionManager.clearInteractionHandle(holdRef.current);
      holdRef.current = null;
    }
    // Released from onFinalize, so a gesture the SYSTEM cancels gives the
    // guard back too. A leaked hold here would kill back-navigation app-wide
    // for the rest of the session.
    if (swipeRef.current != null) {
      swipeRef.current();
      swipeRef.current = null;
    }
  }, []);
  // A handle leaked by an unmount mid-drag would stall every deferred mount in
  // the app for the rest of the session.
  useEffect(() => release, [release]);

  const pan = useMemo(() => Gesture.Pan()
    .maxPointers(1)
    .activeOffsetX([-DRAG_SLOP, DRAG_SLOP])
    // THE TOUCH LANDING — before the pan has decided whether it is a drag, and
    // therefore for a tap too. A worklet, so the swell is on screen on the
    // next frame rather than after a hop to JS.
    .onBegin(() => {
      press.value = withTiming(1, PRESS_IN);
    })
    // Every callback below is a WORKLET — it runs on the UI thread, which is
    // the reason the chip keeps up with the thumb. Changing tabs is React work
    // and so is heavy by definition; if the chip's position were set from the
    // JS thread it would stutter on exactly the frames a tab is mounting. The
    // three things that genuinely need JS (navigate, and the interaction hold)
    // are hopped over with runOnJS and do not block the tracking.
    .onStart((e) => {
      runOnJS(hold)();
      slot.value = slotAtX(e.absoluteX, width, count);
    })
    // 1:1 with the finger, and NOTHING else. The chip is the only thing that
    // moves during a scrub: no navigate, so no page swap and no icon changing
    // colour under a thumb that has not decided yet. A drag is a question, and
    // the answer is given on release.
    .onUpdate((e) => {
      slot.value = slotAtX(e.absoluteX, width, count);
    })
    // THE DECISION, and the only one: the nearest tab to where the thumb let
    // go. Plain rounding is right HERE where it was wrong per-frame — a lift
    // happens once, so there is no midpoint for a wobbling thumb to flip
    // across, and nothing to hold a dead band against.
    //
    // onEnd, not onFinalize: this fires only for a real lift. A gesture the
    // system cancels (a call coming in, a modal taking the touch) must NOT
    // choose a tab on the user's behalf — it just hands the chip back.
    .onEnd(() => {
      const chosen = Math.round(slot.value);
      // Set BEFORE the chip is released below, so the frame that starts the
      // chip's travel already knows where it is going.
      lead.value = chosen;
      runOnJS(goToIndex)(chosen);
    })
    // Always, lift or cancel: the chip goes back to being the navigator's, and
    // deferred work runs again. A stuck -1 would leave it parked under a finger
    // that is no longer there.
    .onFinalize(() => {
      slot.value = -1;
      press.value = withTiming(0, PRESS_OUT);
      runOnJS(release)();
    }),
  [count, goToIndex, hold, lead, press, release, slot, width]);

  return (
    <GestureDetector gesture={pan}>
      <Reanimated.View
        // Fabric flattens a view with no props of its own, which would leave
        // the gesture attached to nothing.
        collapsable={false}
        pointerEvents="box-none"
        testID="dock-press-layer"
        style={[styles.dock, { height: dockOccupied(insets.bottom) }, pressStyle]}
      >
        <BottomTabBar {...props} />
      </Reanimated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
