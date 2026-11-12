import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { InteractionManager, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBar } from '@react-navigation/bottom-tabs';
import { CommonActions } from '@react-navigation/native';

import { commitSlotAt, dockOccupied, slotAtX } from './tabBarLayout';

/**
 * DockTabBar — the bottom nav, with a thumb you can DRAG along it.
 *
 * Tapping a tab was the only way to change tabs, which makes every switch a
 * lift-aim-press cycle even when you are moving one slot. Dragging makes the
 * dock a single control you scrub: the chip comes with your thumb, the pages
 * change as you cross each icon, and you can overshoot and come back without
 * ever letting go. Tapping is untouched — a press still goes straight to
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

export default function DockTabBar({ dragSlot, ...props }) {
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

  // Which tab the drag has already committed to, on the UI thread: without it
  // every frame of a drag would re-dispatch the same navigate.
  const committed = useSharedValue(-1);

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
    // "Already there" covers both the tab the drag started on and the frames
    // spent on an icon after it has been committed.
    if (!route || route.key === current.routes[current.index]?.key) return;
    // The same dispatch BottomTabBar's own onPress makes, minus the `tabPress`
    // event: nothing in the app listens for it, and emitting one per icon
    // crossed would turn a single scrub into five presses for anything that
    // later did.
    navigation.dispatch({ ...CommonActions.navigate(route), target: current.key });
  }, [navigation]);

  // Held for the duration of a drag so that a tab crossed on the way cannot
  // mount its real screen mid-gesture — withTabSkeleton waits on interactions,
  // so a passed-through tab shows its template and nothing else. The landed
  // tab mounts the moment the thumb lifts.
  const holdRef = useRef(null);
  const hold = useCallback(() => {
    if (holdRef.current == null) holdRef.current = InteractionManager.createInteractionHandle();
  }, []);
  const release = useCallback(() => {
    if (holdRef.current != null) {
      InteractionManager.clearInteractionHandle(holdRef.current);
      holdRef.current = null;
    }
  }, []);
  // A handle leaked by an unmount mid-drag would stall every deferred mount in
  // the app for the rest of the session.
  useEffect(() => release, [release]);

  const pan = useMemo(() => Gesture.Pan()
    .maxPointers(1)
    .activeOffsetX([-DRAG_SLOP, DRAG_SLOP])
    // Every callback below is a WORKLET — it runs on the UI thread, which is
    // the reason the chip keeps up with the thumb. Changing tabs is React work
    // and so is heavy by definition; if the chip's position were set from the
    // JS thread it would stutter on exactly the frames a tab is mounting. The
    // three things that genuinely need JS (navigate, and the interaction hold)
    // are hopped over with runOnJS and do not block the tracking.
    .onStart((e) => {
      runOnJS(hold)();
      // -1 rather than the focused index: "nothing committed yet". goToIndex
      // ignores the tab we are already on, so this cannot navigate to where
      // we already are — and it keeps the focused index out of the worklet's
      // closure, which is what makes the gesture stable for the whole drag.
      committed.value = -1;
      slot.value = slotAtX(e.absoluteX, width, count);
    })
    .onUpdate((e) => {
      const p = slotAtX(e.absoluteX, width, count);
      slot.value = p;
      // NOT Math.round: a thumb held near the midpoint between two icons is
      // never quite still, and plain rounding flipped the tab back and forth
      // under it several times a second. commitSlotAt keeps a dead band around
      // the tab you are on — see SLOT_COMMIT_HYSTERESIS.
      const i = commitSlotAt(p, committed.value);
      if (i !== committed.value) {
        committed.value = i;
        runOnJS(goToIndex)(i);
      }
    })
    // onFinalize, not onEnd: a gesture cancelled by the system (a call coming
    // in, a modal taking the touch) must still hand the chip back to the
    // focused tab and let deferred mounts run, or the dock stays stuck under a
    // finger that is no longer there.
    .onFinalize(() => {
      slot.value = -1;
      committed.value = -1;
      runOnJS(release)();
    }),
  [committed, count, goToIndex, hold, release, slot, width]);

  return (
    <GestureDetector gesture={pan}>
      <View
        // Fabric flattens a view with no props of its own, which would leave
        // the gesture attached to nothing.
        collapsable={false}
        pointerEvents="box-none"
        style={[styles.dock, { height: dockOccupied(insets.bottom) }]}
      >
        <BottomTabBar {...props} />
      </View>
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
