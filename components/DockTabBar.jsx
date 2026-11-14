import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { InteractionManager, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  Easing, runOnJS, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBar } from '@react-navigation/bottom-tabs';

import { dockOccupied, slotAtX, slotUnderTouch } from './tabBarLayout';
import {
  CHIP_SLIDE_BASE_MS, CHIP_SLIDE_MAX_MS, PRESS_BEZIER, PRESS_IN_MS, PRESS_OUT_MS,
} from './dockMotion';
import { currentTabIndex, requestTab, useDockSettle } from './dockNav';
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
 * moving.
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
 * buttons inside it, which is the whole point.
 *
 * ── A TAP IS THE DOCK'S, TOO ───────────────────────────────────────────────
 *
 * This is the part that was rebuilt on 2026-11-14, and dockNav has the full
 * account of what was wrong before. In short: a tap used to be performed by
 * react-navigation's button, WATCHED by this gesture, and patched up by two
 * timers when the button did not answer — and there are four ordinary ways
 * for the button not to answer:
 *
 *   • the finger rests longer than 500ms. RN's Pressability drops `onPress`
 *     outright once a long press is possible, and BottomTabItem gives every
 *     tab an `onLongPress`;
 *   • the thumb rolls past DRAG_SLOP on the way down, the pan activates, and
 *     RNGH cancels the press beneath it;
 *   • the touch is on the dock but not on a button — the floating gap and the
 *     home-indicator inset are 42 of the dock's 111 points on a 34pt-inset
 *     phone, and v7 puts that inset on the bar's own container, so the touch
 *     reaches this gesture and nothing pressable;
 *   • the finger slides off the button's own rectangle before lifting.
 *
 * So the gesture now DECIDES a tap itself, with what it already knows, the
 * moment the finger lifts — no waiting to see whether somebody else will:
 *
 *   it never became a drag,
 *   the finger LIFTED (the system did not take the touch away),
 *   and it lifted on the dock, or within LIFT_SLACK above it.
 *
 * That is a tap on the slot the touch landed on, and it goes through
 * `requestTab`. react-navigation's button still fires for the same touch when
 * it can, and App.js routes it through the same `requestTab` — which is
 * idempotent, so the two arrive in either order and the tab changes once.
 * The button is no longer load-bearing for a touch, but it is still the whole
 * path for anything that is NOT a touch: VoiceOver's activate, a keyboard.
 *
 * What a tap is NOT, and what the old timers could not tell apart from one:
 *
 *   • a touch the SYSTEM cancels. The swipe up from the home indicator begins
 *     on this wrapper; so does Reachability's swipe down. They arrive as a
 *     touch that begins and is taken away, never lifted — and "any touch that
 *     did not become a drag" used to change tabs on the way out of the app;
 *   • a finger that wandered off the top of the dock and let go up there.
 *
 * Both leave the tab alone and give the chip straight back, on the UI thread,
 * in the same frame — there is nothing to wait for.
 *
 * ── The press ──────────────────────────────────────────────────────────────
 *
 * The capsule's wash fades the instant a finger lands on it, and HOLDS while
 * the finger is down — so a press-and-scrub keeps the dock lit for the length
 * of the drag rather than blinking at the start of it. This component only
 * DRIVES that value; TabBarPill paints it, because the wash is its layer.
 * The numbers and the reasoning are in dockMotion.
 *
 * It was a 1.5% SCALE on this wrapper, and that is why it moved: the capsule's
 * BlurView is a descendant, and a transform on a blur's ancestor makes iOS
 * re-sample the blur every frame — main-thread work landing on exactly the
 * frames of the chip's travel, on every tap. Fading a flat gradient costs
 * nothing and asks the glass for nothing.
 *
 * It hangs off onBegin/onFinalize rather than onStart/onEnd, and that is the
 * point: onStart fires only once the pan ACTIVATES, which a tap never does.
 * onBegin is the touch landing, whatever the gesture turns out to be, and
 * onFinalize is it leaving — including when the system cancels, which is the
 * one path that must never leave the dock stuck in its pressed state.
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

// How far ABOVE the dock a finger may have drifted and still be letting go of
// a tab. A touch that starts on the dock and wanders further than this before
// lifting was abandoned — the contract every native tab bar has (touch up
// outside cancels), and what RN's own Pressable does with its retention
// offset. Below the dock there is only the screen edge, so there is no lower
// bound to give.
export const LIFT_SLACK = 30;

// The press timings, built ONCE here on the JS thread, with REANIMATED's
// Easing. The gesture callbacks that use them are worklets on the UI thread,
// and the UI thread can only call worklets: a helper function, or React
// Native's Easing (a plain JS closure), called from there throws "non-worklet
// function on the UI thread" — which a release build turns into a crash on
// the first touch of the dock. Plain objects holding a Reanimated easing are
// what a worklet can capture.
// PRESS_BEZIER, not the chip's curve: the chip leaves at full speed on
// purpose, and a SWELL that does the same does not grow, it jumps to grown.
const PRESS_IN = { duration: PRESS_IN_MS, easing: Easing.bezier(...PRESS_BEZIER) };
const PRESS_OUT = { duration: PRESS_OUT_MS, easing: Easing.bezier(...PRESS_BEZIER) };

export default function DockTabBar({
  dragSlot, leadSlot, navSlot, slideMs, pressLift, probe, settle, suppressTap, ...props
}) {
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

  // The slot this touch is AIMED at, written on the UI thread at touch-down —
  // before React has heard about anything. It is what makes the chip leave on
  // the touch. Spent by the answer to this touch's own request (dockNav), or
  // by the touch being abandoned (onFinalize), and by nothing else.
  const ownLead = useSharedValue(-1);
  const lead = leadSlot ?? ownLead;

  // The chip's copy of where the navigator is. Only handed on to `settle`.
  const ownNav = useSharedValue(state.index);
  const nav = navSlot ?? ownNav;

  // How long the settle after a lift should take. Always the shortest clock
  // the dock has: the chip is already under the thumb, so what is left is a
  // fraction of a slot, and giving that the duration of a full crossing is
  // how a snap turns into a drift.
  const ownMs = useSharedValue(CHIP_SLIDE_BASE_MS);
  const ms = slideMs ?? ownMs;

  // 0 at rest, 1 while a finger is down. This component only drives the
  // value; TabBarPill fades the wash with it (see "The press" above).
  const ownPress = useSharedValue(0);
  const press = pressLift ?? ownPress;

  // How the chip is told what became of a request. App.js hands in the one it
  // shares with the button's path and with TabBarPill; the fallback keeps the
  // component self-contained.
  const ownSettle = useDockSettle(lead, nav);
  const answer = settle ?? ownSettle;

  // The navigator's state through a ref, NOT captured in the callback below.
  // `state` is a new object on every navigation — including the ones this
  // gesture makes — so depending on it would rebuild the Gesture object
  // mid-drag, several times per scrub, and hand GestureDetector a different
  // gesture while a finger is still down on the old one. It is only the
  // FALLBACK now: the truth is `navigation.getState()`, which is current on
  // the line after a dispatch, where this ref waits for an effect.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // THE TAB THIS TOUCH CHOSE — a tap's, or a scrub's lift. One call, and the
  // chip is answered inside it (requestTab always settles, whatever happened).
  const chooseTab = useCallback((i) => {
    // A LONG-PRESS is a different gesture with its own meaning: on Turtle it
    // opens the console. The finger that did it still has to come off the
    // glass, and that lift is not a tap. App.js raises this flag from
    // `tabLongPress`; both run on the JS thread, in the order they happened.
    if (suppressTap && suppressTap.current) {
      suppressTap.current = false;
      answer(i, currentTabIndex(navigation, stateRef.current));
      return;
    }
    requestTab(navigation, i, answer, stateRef.current);
  }, [answer, navigation, suppressTap]);

  // Held for the duration of a touch so that nothing deferred runs under the
  // thumb. The chip tracks the finger 1:1, which means every frame of the
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
    // A fresh touch owes nothing to the last one's long press.
    if (suppressTap) suppressTap.current = false;
    if (holdRef.current == null) holdRef.current = InteractionManager.createInteractionHandle();
    if (swipeRef.current == null) swipeRef.current = holdEdgeSwipe();
  }, [suppressTap]);
  // Held PAST the lift, for as long as the chip is travelling.
  //
  // A tab change ends in a screen waking up, and a screen waking up builds
  // native views on the main thread — the same thread the chip's animation is
  // composited on. Released at the lift, the mount landed one or two frames
  // into a ten-frame slide and ate most of the rest of them, which is the
  // chop.
  //
  // withTabSkeleton already waits on the interaction queue, so holding the
  // handle for the length of the travel costs nothing visible: the tab paints
  // its template immediately either way, and the real screen arrives a tenth
  // of a second later against a clear main thread.
  const releaseTimerRef = useRef(null);
  const release = useCallback(() => {
    if (releaseTimerRef.current != null) {
      clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    }
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
  const releaseAfterSlide = useCallback(() => {
    if (releaseTimerRef.current != null) clearTimeout(releaseTimerRef.current);
    releaseTimerRef.current = setTimeout(() => {
      releaseTimerRef.current = null;
      release();
      // The longest a slide can take, not the one this move is taking: the
      // handle is a backstop and a few spare frames cost nothing, where
      // releasing early puts the mount back on top of the travel.
    }, CHIP_SLIDE_MAX_MS);
  }, [release]);
  // A handle leaked by an unmount mid-drag would stall every deferred mount in
  // the app for the rest of the session. `release` clears the pending timer
  // too, so an unmount cannot leave one running against a dead component.
  useEffect(() => () => { release(); }, [release]);

  // ── WHAT THIS TOUCH TURNED OUT TO BE ───────────────────────────────────
  //
  // Four facts, all written on the UI thread by the gesture itself, and read
  // once, in onFinalize, to decide what the touch was. No JS, no clock.
  //
  // The slot the finger LANDED on. The lead is the same number at touch-down,
  // but the lead can be spent or re-aimed by somebody else; this is the
  // touch's own record, and "is the lead still mine" is `lead === aimed`.
  const aimed = useSharedValue(-1);
  // 1 from the moment the pan activates: this touch is a scrub.
  const dragged = useSharedValue(0);
  // 1 if the finger came off the glass on the dock (or within LIFT_SLACK above
  // it). Stays 0 for a touch that was taken away — which is the difference
  // between a tap and the start of a swipe home.
  const lifted = useSharedValue(0);
  // Has a touch event EVER arrived? `lifted` is only evidence if they do.
  // They are a long-standing part of RNGH and do on both platforms; but a
  // build where they did not would otherwise read every tap as abandoned, so
  // without them the gesture falls back to the old rule (any touch that did
  // not become a drag is a tap) rather than to a dock that ignores taps.
  // Sticky for the session — it describes the build, not the touch.
  const touchEvents = useSharedValue(0);

  const pan = useMemo(() => Gesture.Pan()
    .maxPointers(1)
    .activeOffsetX([-DRAG_SLOP, DRAG_SLOP])
    // THE TOUCH LANDING — before the pan has decided whether it is a drag, and
    // therefore for a tap too. A worklet, so the chip and the wash are on
    // screen on the next frame rather than after a hop to JS.
    .onBegin((e) => {
      press.value = withTiming(1, PRESS_IN);
      // WHEN THE FINGER LANDED, stamped on the UI thread before anything else
      // happens. The chip's travel is timed against this (dockMotionProbe).
      if (probe) probe.touchAt.value = Date.now();
      // ── THE CHIP LEAVES ON THE TOUCH ───────────────────────────────────
      //
      // The slot under the finger is known HERE, at touch-down, and the whole
      // chain from here is on the UI thread: this write, the reaction in
      // TabBarPill, the timing. No JS hop, so a busy JS thread cannot delay
      // the chip at all.
      //
      // slotAtX — CLAMPED, so a touch anywhere on the dock aims at a real tab.
      // The strip below the capsule has no button under it, but the dock
      // performs the tab change for it (onFinalize), so pointing the chip
      // there is a promise that gets kept.
      const s = Math.round(slotAtX(e.absoluteX, width, count));
      aimed.value = s;
      lead.value = s;
      dragged.value = 0;
      lifted.value = 0;
      // For the READOUT only. `slotUnderTouch` is -1 when there was no button
      // under the finger. See dockMotionProbe.
      if (probe) {
        probe.touchSlot.value = slotUnderTouch(e.absoluteX, e.y, width, count);
        probe.touchY.value = e.y;
        probe.panActivated.value = 0;
        probe.tapCompleted.value = 0;
      }
      // From the TOUCH, not from the drag: a tap never reaches onStart, and a
      // tap is the case where the mount lands on top of the slide. Holding
      // here covers both, and onFinalize always gives it back.
      runOnJS(hold)();
    })
    // The three touch callbacks exist for ONE fact: did the finger LIFT, and
    // where. A pan that never activates ends in the same state whether the
    // finger came up or iOS took the touch for a system gesture, so the
    // gesture's own state cannot tell a tap from a swipe home. These can:
    // a lift is an Up, and a touch that is taken away is a Cancelled.
    .onTouchesDown(() => {
      touchEvents.value = 1;
    })
    .onTouchesUp((e) => {
      touchEvents.value = 1;
      // `y` is measured from the top of this wrapper, so the dock is 0 and
      // down, and negative is above it.
      const t = e.changedTouches && e.changedTouches[0];
      const y = t && typeof t.y === 'number' ? t.y : 0;
      lifted.value = y >= -LIFT_SLACK ? 1 : 0;
    })
    .onTouchesCancelled(() => {
      touchEvents.value = 1;
      lifted.value = 0;
    })
    // Every callback here is a WORKLET — it runs on the UI thread, which is
    // the reason the chip keeps up with the thumb. Changing tabs is React work
    // and so is heavy by definition; if the chip's position were set from the
    // JS thread it would stutter on exactly the frames a tab is mounting. The
    // things that genuinely need JS (the navigate, and the interaction hold)
    // are hopped over with runOnJS and do not block the tracking.
    .onStart((e) => {
      slot.value = slotAtX(e.absoluteX, width, count);
      dragged.value = 1;
      if (probe) probe.panActivated.value = 1;
    })
    // 1:1 with the finger, and NOTHING else. The chip is the only thing that
    // moves during a scrub: no navigate, so no page swap and no icon changing
    // colour under a thumb that has not decided yet. A drag is a question, and
    // the answer is given on release.
    .onUpdate((e) => {
      slot.value = slotAtX(e.absoluteX, width, count);
    })
    // THE SCRUB'S DECISION: the nearest tab to where the thumb let go. Plain
    // rounding is right HERE where it was wrong per-frame — a lift happens
    // once, so there is no midpoint for a wobbling thumb to flip across.
    //
    // `success` is the whole point of the second argument. RNGH calls onEnd
    // for a drag the system CANCELS as well (a call coming in, a modal taking
    // the touch) — with `false`. This used to ignore it, so a cancelled scrub
    // chose a tab on the user's behalf, which the comment here said it must
    // never do.
    .onEnd((_e, success) => {
      if (!success) return;
      const chosen = Math.round(slot.value);
      // Set BEFORE the chip is released in onFinalize, so the frame that
      // starts the chip's settle already knows where it is going.
      aimed.value = chosen;
      lead.value = chosen;
      ms.value = CHIP_SLIDE_BASE_MS;
      runOnJS(chooseTab)(chosen);
    })
    // Always, lift or cancel: the chip stops being the finger's, deferred work
    // runs again — and the touch is decided.
    .onFinalize((_e, success) => {
      const wasDrag = dragged.value === 1;
      slot.value = -1;
      press.value = withTiming(0, PRESS_OUT);
      runOnJS(releaseAfterSlide)();

      if (wasDrag) {
        // A real lift already chose, in onEnd. A scrub the system cancelled
        // chose nothing: give the chip back to the navigator, now.
        if (!success && lead.value === aimed.value) lead.value = -1;
      } else {
        // Never a drag. A TAP if the finger lifted on the dock; without touch
        // events to say so, the old rule (see `touchEvents`).
        const tap = touchEvents.value === 1 ? lifted.value === 1 : true;
        if (tap) {
          if (probe) probe.tapCompleted.value = 1;
          runOnJS(chooseTab)(aimed.value);
        } else if (lead.value === aimed.value) {
          // Abandoned, or taken by the system. Nothing was asked of the
          // navigator, so nothing will answer: the lead is handed back here,
          // on the UI thread, in the same frame the finger went away.
          lead.value = -1;
        }
      }
      dragged.value = 0;
      lifted.value = 0;
    }),
  [aimed, chooseTab, count, dragged, hold, lead, lifted, ms, press, probe,
    releaseAfterSlide, slot, touchEvents, width]);

  return (
    <GestureDetector gesture={pan}>
      <Reanimated.View
        // Fabric flattens a view with no props of its own, which would leave
        // the gesture attached to nothing.
        collapsable={false}
        pointerEvents="box-none"
        testID="dock-press-layer"
        style={[styles.dock, { height: dockOccupied(insets.bottom) }]}
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
