/**
 * ViewerStage — the viewer's ONE gesture tree, and the pop transform of the
 * page layer it wraps.
 *
 * Every gesture the viewer has lives here, on the UI thread, over the shared
 * values in `sv`:
 *
 *   Race(
 *     Simultaneous(pinch, pan),      // pan: page / dismiss / details / edge-back / zoomed pan
 *     Exclusive(doubleTap, singleTap),
 *   )
 *
 * Why one tree: the old viewer ran a native scroll view, Gesture Handler
 * recognizers inside every page and a JS PanResponder on the container, and
 * on iOS any of them sitting in `began` could cancel the others — a swipe that
 * started on the photo was unreliable while one that started beside it always
 * paged. Here nothing competes: one pan decides ONCE, from its first 8pt of
 * travel, what it is (`lockMode`), and keeps that decision until release.
 *
 * Paging (iOS Photos): the page follows the finger 1:1, rubber-bands past the
 * ends, moves at most one page per swipe, settles with a short ease-out, and
 * a new touch stops a settling page under the finger. A page commit RE-BASES:
 * activeIndex steps and pagerX shifts by the same distance in the opposite
 * direction, so nothing visibly jumps; pagerX then animates back to 0.
 *
 * Zoom: focal-anchored pinch with two-finger drag; pan while zoomed with
 * rubber-banded bounds and a flick glide; horizontal overflow past the image
 * edge spills into the pager (the iOS edge handoff); double-tap fills the
 * screen or returns to 1×; pinch-in on an unzoomed photo closes.
 *
 * JS is reached exactly at: pan activation (onDragBegin), rest (onRest), a
 * committed dismiss / edge-back / details / tap, and a zoom flip. Nothing else
 * crosses the bridge during a gesture.
 */
import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import {
  MODE,
  PAGE_DIRECTION,
  PINCH_DISMISS_SCALE,
  UNDERSCALE_RUBBER,
  ZOOMED_EPSILON,
  lockMode,
  pageTarget,
  pagerOffset,
  rebasePagerX,
  settleDuration,
  shouldCommitDismiss,
  shouldCommitEdgeBack,
  shouldHandoff,
  shouldOpenDetails,
  splitZoomPan,
} from '../../../../utils/viewerGestureMath';
import { DOUBLE_TAP } from '../../../../utils/pressBehavior';
import {
  DOUBLE_TAP_SCALE,
  MIN_SCALE,
  clamp,
  clampScale,
  containSize,
  fillScale,
  focalTranslate,
  panBound,
  rubberClamp,
  rubberScale,
  settle,
} from '../../../../utils/zoomMath';

/** Zoom snap-back / double-tap timing: short and eased-out. */
const ZOOM_SETTLE = { duration: 240, easing: Easing.out(Easing.cubic) };
/** A cancelled pull springing home, carrying the release velocity. */
const HOME_SPRING = { damping: 26, stiffness: 260, mass: 1 };
const PAGE_EASING = Easing.out(Easing.cubic);
const DECAY = 0.985;

export default function ViewerStage({
  sv,
  children,
  onDragBegin,
  onRest,
  onDismiss,
  onEdgeBack,
  onOpenDetails,
  onSingleTap,
  onZoomedChange,
  onPinchDismiss,
  /**
   * Arm the press-and-hold that plays an iOS Live Photo's clip. FALSE on an
   * ordinary photo, and that matters: a long press that activates wins the
   * race and cancels the pan, so an always-armed one would eat the swipe of
   * anyone who rests a finger for half a second before flicking. Enabled per
   * photo, it can only ever do that on a photo where holding means something.
   */
  motionEnabled = false,
  onMotionStart,
  onMotionEnd,
}) {
  // Per-gesture bookkeeping. Shared values, never React state.
  const mode = useSharedValue(MODE.NONE);
  const panActive = useSharedValue(false);
  const startX = useSharedValue(0);
  const basePagerX = useSharedValue(0);
  const baseTx = useSharedValue(0);
  const baseTy = useSharedValue(0);
  const pinchBaseScale = useSharedValue(1);
  const pinchRaw = useSharedValue(1);
  const pinchOriginX = useSharedValue(0);
  const pinchOriginY = useSharedValue(0);

  // Zoomed edge → one JS hop per flip (the chrome hides and stops taking touches).
  useAnimatedReaction(
    () => sv.scale.value > ZOOMED_EPSILON,
    (zoomed, previous) => {
      if (zoomed === previous) return;
      if (onZoomedChange) runOnJS(onZoomedChange)(zoomed);
    },
    [onZoomedChange],
  );

  const gesture = useMemo(() => {
    // ── helpers (worklets) ────────────────────────────────────────────────
    const resetZoom = () => {
      'worklet';
      sv.scale.value = 1;
      sv.tx.value = 0;
      sv.ty.value = 0;
      sv.zoomIndex.value = sv.activeIndex.value;
    };

    // A page commit: re-base, then settle pagerX back to 0. `step` is -1/0/+1.
    const finishPage = (step, vx) => {
      'worklet';
      if (step !== 0) {
        sv.activeIndex.value = sv.activeIndex.value + step;
        // Every page keeps the x it had; the settle to 0 below is what
        // carries the swipe through to the next photo (see rebasePagerX).
        sv.pagerX.value = rebasePagerX(sv.pagerX.value, step, sv.pageW);
      }
      sv.settling.value = 1;
      const remaining = Math.abs(sv.pagerX.value);
      sv.pagerX.value = withTiming(
        0,
        { duration: settleDuration(remaining, vx), easing: PAGE_EASING },
        (finished) => {
          // Interrupted by a new touch: that gesture owns the settle now.
          if (!finished) return;
          sv.settling.value = 0;
          // The zoomed page has left the screen — reset it silently and hand
          // the zoom transform to the page that is now active.
          if (step !== 0) resetZoom();
          runOnJS(onRest)(sv.activeIndex.value);
        },
      );
    };

    const springHome = (vx, vy) => {
      'worklet';
      sv.dragX.value = withSpring(0, { ...HOME_SPRING, velocity: vx });
      sv.dragY.value = withSpring(0, { ...HOME_SPRING, velocity: vy }, (finished) => {
        if (finished) runOnJS(onRest)(sv.activeIndex.value);
      });
    };

    const settleZoomPan = (vx, vy) => {
      'worklet';
      const content = containSize(sv.width, sv.height, sv.aspect.value);
      const boundX = panBound(content.width, sv.width, sv.scale.value);
      const boundY = panBound(content.height, sv.height, sv.scale.value);
      // Inside the bounds → glide with the flick and stop at the edge.
      // Outside (rubber-banded) → snap straight back.
      if (Math.abs(sv.tx.value) > boundX) {
        sv.tx.value = withTiming(clamp(sv.tx.value, boundX), ZOOM_SETTLE);
      } else if (boundX > 0) {
        sv.tx.value = withDecay({ velocity: vx, clamp: [-boundX, boundX], deceleration: DECAY });
      } else {
        sv.tx.value = withTiming(0, ZOOM_SETTLE);
      }
      if (Math.abs(sv.ty.value) > boundY) {
        sv.ty.value = withTiming(clamp(sv.ty.value, boundY), ZOOM_SETTLE);
      } else if (boundY > 0) {
        sv.ty.value = withDecay({ velocity: vy, clamp: [-boundY, boundY], deceleration: DECAY });
      } else {
        sv.ty.value = withTiming(0, ZOOM_SETTLE);
      }
    };

    // Release / cancel of the pan, whatever mode it was in. Runs once per
    // gesture: onEnd on a clean release, onFinalize when the system cancelled.
    const finishPan = (dx, dy, vx, vy) => {
      'worklet';
      if (!panActive.value) return;
      panActive.value = false;
      const m = mode.value;
      mode.value = MODE.NONE;

      if (m === MODE.PAGE) {
        finishPage(pageTarget({
          dx: sv.pagerX.value, vx, index: sv.activeIndex.value, count: sv.count.value, width: sv.width,
        }), vx);
        return;
      }
      if (m === MODE.DISMISS) {
        if (shouldCommitDismiss(dy, vy)) runOnJS(onDismiss)(vx, vy);
        else springHome(vx, vy);
        return;
      }
      if (m === MODE.EDGE_BACK) {
        if (shouldCommitEdgeBack(dx, vx)) runOnJS(onEdgeBack)();
        else springHome(vx, vy);
        return;
      }
      if (m === MODE.DETAILS) {
        if (shouldOpenDetails(dy, vy)) runOnJS(onOpenDetails)();
        runOnJS(onRest)(sv.activeIndex.value);
        return;
      }
      if (m === MODE.ZOOM_PAN) {
        const step = shouldHandoff(sv.pagerX.value, vx, sv.width);
        if (step !== 0) {
          finishPage(step, vx);
          return;
        }
        settleZoomPan(vx, vy);
        if (sv.pagerX.value !== 0) {
          // A partial spill springs back like any page settle: flagged, so a
          // new touch interrupts it the same way, and rest reported when done.
          sv.settling.value = 1;
          sv.pagerX.value = withTiming(0, ZOOM_SETTLE, (finished) => {
            if (!finished) return;
            sv.settling.value = 0;
            runOnJS(onRest)(sv.activeIndex.value);
          });
          return;
        }
        runOnJS(onRest)(sv.activeIndex.value);
        return;
      }
      // Never locked a mode (a wiggle): nothing moved, just hand the rest back.
      runOnJS(onRest)(sv.activeIndex.value);
    };

    // ── pan ───────────────────────────────────────────────────────────────
    const pan = Gesture.Pan()
      .minDistance(4)
      // Single finger only: two fingers are the pinch, whose focal tracking IS
      // the two-finger drag. Letting both read the same fingers made them
      // fight over tx/ty, and lifting one finger threw the photo.
      .maxPointers(1)
      .onBegin(() => {
        'worklet';
        // Touching a moving pager stops it under the finger (interruptible).
        if (sv.settling.value) {
          cancelAnimation(sv.pagerX);
          sv.settling.value = 0;
          // A settle interrupted mid-handoff: the zoomed page is mostly gone;
          // hand the zoom to the active page before the next gesture reads it.
          if (sv.zoomIndex.value !== sv.activeIndex.value) resetZoom();
          // The cancelled settle's completion callback never ran, so the shell
          // still thinks the PREVIOUS page is active: its mounted ±1 window,
          // the active-id store and selectedMedia all lag the shared index.
          // Two quick flicks in a row would drag toward a page that was never
          // mounted. Report the rest now, before this gesture moves anything.
          runOnJS(onRest)(sv.activeIndex.value);
        }
      })
      .onStart((e) => {
        'worklet';
        mode.value = MODE.NONE;
        panActive.value = true;
        startX.value = e.x;
        basePagerX.value = sv.pagerX.value;
        baseTx.value = sv.tx.value;
        baseTy.value = sv.ty.value;
        cancelAnimation(sv.tx);
        cancelAnimation(sv.ty);
        cancelAnimation(sv.dragX);
        cancelAnimation(sv.dragY);
        runOnJS(onDragBegin)();
      })
      .onUpdate((e) => {
        'worklet';
        if (mode.value === MODE.NONE) {
          mode.value = lockMode({
            dx: e.translationX, dy: e.translationY, startX: startX.value,
            zoomed: sv.scale.value > ZOOMED_EPSILON,
          });
          if (mode.value === MODE.NONE) return;
        }
        const m = mode.value;
        if (m === MODE.PAGE) {
          sv.pagerX.value = pagerOffset(
            basePagerX.value + e.translationX, sv.activeIndex.value, sv.count.value, sv.width,
          );
          return;
        }
        if (m === MODE.DISMISS || m === MODE.EDGE_BACK) {
          // Two-axis follow: the photo goes where the thumb goes.
          sv.dragX.value = e.translationX;
          sv.dragY.value = e.translationY;
          return;
        }
        if (m === MODE.ZOOM_PAN) {
          const content = containSize(sv.width, sv.height, sv.aspect.value);
          const boundX = panBound(content.width, sv.width, sv.scale.value);
          const boundY = panBound(content.height, sv.height, sv.scale.value);
          const split = splitZoomPan(baseTx.value + e.translationX, boundX);
          sv.tx.value = split.inside;
          // Past the image edge the overflow drives the pager: the next photo
          // slides in while this one stays zoomed.
          sv.pagerX.value = split.spill === 0
            ? 0
            : pagerOffset(split.spill, sv.activeIndex.value, sv.count.value, sv.width);
          sv.ty.value = rubberClamp(baseTy.value + e.translationY, boundY);
        }
        // DETAILS: the photo stays put; the release decides.
      })
      .onEnd((e) => {
        'worklet';
        finishPan(e.translationX, e.translationY, e.velocityX, e.velocityY);
      })
      .onFinalize((e) => {
        'worklet';
        // Cancelled by the system (or ended without onEnd): settle with no
        // velocity. A no-op after a clean onEnd — finishPan runs once.
        finishPan(e.translationX, e.translationY, 0, 0);
      });

    // ── pinch ─────────────────────────────────────────────────────────────
    const pinch = Gesture.Pinch()
      .onStart((e) => {
        'worklet';
        if (!sv.zoomEnabled.value) return;
        cancelAnimation(sv.tx);
        cancelAnimation(sv.ty);
        cancelAnimation(sv.scale);
        pinchBaseScale.value = sv.scale.value;
        pinchRaw.value = sv.scale.value;
        // Focal point relative to the stage centre — the frame the
        // translations live in.
        const fx = e.focalX - sv.width / 2;
        const fy = e.focalY - sv.height / 2;
        pinchOriginX.value = (fx - sv.tx.value) / sv.scale.value;
        pinchOriginY.value = (fy - sv.ty.value) / sv.scale.value;
      })
      .onUpdate((e) => {
        'worklet';
        if (!sv.zoomEnabled.value) return;
        const raw = pinchBaseScale.value * e.scale;
        pinchRaw.value = raw;
        const next = raw < MIN_SCALE
          ? rubberScale(raw, MIN_SCALE, sv.maxScale.value, UNDERSCALE_RUBBER)
          : rubberScale(raw, MIN_SCALE, sv.maxScale.value);
        const fx = e.focalX - sv.width / 2;
        const fy = e.focalY - sv.height / 2;
        sv.scale.value = next;
        // Focal tracking doubles as two-finger panning: the pixels under the
        // fingers stay under the fingers.
        sv.tx.value = focalTranslate(fx, pinchOriginX.value, next);
        sv.ty.value = focalTranslate(fy, pinchOriginY.value, next);
      })
      .onEnd(() => {
        'worklet';
        if (!sv.zoomEnabled.value) return;
        // Pinched a fit-to-screen photo well below 1× → drop back to the grid.
        // Only from an unzoomed start: pinching out OF a zoom is a zoom-out.
        if (pinchBaseScale.value <= ZOOMED_EPSILON && pinchRaw.value < PINCH_DISMISS_SCALE) {
          runOnJS(onPinchDismiss)();
          return;
        }
        const rest = settle(
          sv.tx.value, sv.ty.value, sv.width, sv.height, sv.aspect.value,
          clampScale(sv.scale.value, MIN_SCALE, sv.maxScale.value),
        );
        if (sv.scale.value !== rest.scale) sv.scale.value = withTiming(rest.scale, ZOOM_SETTLE);
        if (sv.tx.value !== rest.x) sv.tx.value = withTiming(rest.x, ZOOM_SETTLE);
        if (sv.ty.value !== rest.y) sv.ty.value = withTiming(rest.y, ZOOM_SETTLE);
      });

    // ── taps ──────────────────────────────────────────────────────────────
    // The three limits that make this a double TAP and not a pair of flicks
    // are the app's, not this file's — utils/pressBehavior says why each one
    // is the number it is. They were written out here first; the note
    // composer then shipped the same gesture without them and popped its
    // keyboard open mid-scroll, which is what made them a shared rule.
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(DOUBLE_TAP.maxDuration)
      .maxDelay(DOUBLE_TAP.maxDelay)
      .maxDistance(DOUBLE_TAP.maxDistance)
      .onEnd((e) => {
        'worklet';
        if (!sv.zoomEnabled.value || sv.settling.value) return;
        if (sv.scale.value > ZOOMED_EPSILON) {
          sv.scale.value = withTiming(1, ZOOM_SETTLE);
          sv.tx.value = withTiming(0, ZOOM_SETTLE);
          sv.ty.value = withTiming(0, ZOOM_SETTLE);
          return;
        }
        // Zoom to FILL the screen at the tapped point (iOS Photos), clamped so
        // the result can't sit outside the image; a fixed factor only when the
        // aspect is unknown or the photo already fills the frame.
        const fill = fillScale(sv.width, sv.height, sv.aspect.value);
        const target = fill > 1.05
          ? Math.min(fill, sv.maxScale.value)
          : Math.min(DOUBLE_TAP_SCALE, sv.maxScale.value);
        const fx = e.x - sv.width / 2;
        const fy = e.y - sv.height / 2;
        const ox = (fx - sv.tx.value) / sv.scale.value;
        const oy = (fy - sv.ty.value) / sv.scale.value;
        const rest = settle(
          focalTranslate(fx, ox, target), focalTranslate(fy, oy, target),
          sv.width, sv.height, sv.aspect.value, target,
        );
        sv.scale.value = withTiming(rest.scale, ZOOM_SETTLE);
        sv.tx.value = withTiming(rest.x, ZOOM_SETTLE);
        sv.ty.value = withTiming(rest.y, ZOOM_SETTLE);
      });

    const singleTap = Gesture.Tap()
      .numberOfTaps(1)
      .maxDuration(260)
      // Tighter than the double-tap: a tap that travelled is a swipe that
      // failed, and must fail as a tap — not toggle the chrome.
      .maxDistance(12)
      .onEnd((_e, success) => {
        'worklet';
        if (!success) return;
        // A tap on a moving page is a finger catching it, not a request.
        if (sv.settling.value || sv.pagerX.value !== 0) return;
        runOnJS(onSingleTap)();
      });

    // Press and hold a Live Photo to watch it move, exactly as in Photos.
    //
    // Safe to RACE against the pan because the pan needs 4pt of travel to
    // activate, so a still finger can't be both. `maxDistance` is the other
    // half of that: drift past it before the hold matures and this fails,
    // leaving the swipe to the pan.
    //
    // Release ends it through `onFinalize` rather than `onEnd` — onEnd does
    // not fire when the system cancels a gesture (a call arriving, the app
    // backgrounding), and a clip left playing under a still nobody is touching
    // is the one failure here anyone would notice.
    const longPress = Gesture.LongPress()
      .enabled(!!motionEnabled)
      .minDuration(320)
      .maxDistance(12)
      .onStart(() => {
        'worklet';
        // Not on a page that is still moving, and not while zoomed — the clip
        // renders at contain, so playing it under a zoomed still would jump.
        if (sv.settling.value || sv.pagerX.value !== 0 || sv.scale.value !== 1) return;
        runOnJS(onMotionStart)();
      })
      .onFinalize(() => {
        'worklet';
        runOnJS(onMotionEnd)();
      });

    return Gesture.Race(
      Gesture.Simultaneous(pinch, pan),
      // Exclusive → the single tap waits for the double tap to fail, so a
      // double-tap zoom never also toggles the chrome.
      Gesture.Exclusive(doubleTap, singleTap),
      longPress,
    );
    // The bookkeeping shared values are stable refs; only the callbacks and
    // the bundle can change identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `motionEnabled` is in here deliberately: it is the one input that
    // changes which gestures exist. It only moves at REST (the shell reads it
    // off the settled page), so the rebuild never lands mid-swipe.
  }, [sv, onDragBegin, onRest, onDismiss, onEdgeBack, onOpenDetails, onSingleTap, onPinchDismiss,
    motionEnabled, onMotionStart, onMotionEnd]);

  // Origin-anchored pop: the layer grows out of the tapped cell's position as
  // openProgress runs 0 → 1, and retreats toward it on close. During a
  // committed pull the page's own drag offset springs to 0 at the same time,
  // so the photo flies from the finger back into the grid.
  const popStyle = useAnimatedStyle(() => {
    const p = sv.openProgress.value;
    const from = sv.originScale.value;
    return {
      transform: [
        { translateX: sv.originX.value * (1 - p) },
        { translateY: sv.originY.value * (1 - p) },
        // From the grid cell's size (originScale) up to full size — and back
        // down into the cell on close.
        { scale: from + (1 - from) * p },
      ],
    };
  }, [sv]);

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[StyleSheet.absoluteFill, popStyle]} collapsable={false} testID="viewer-stage">
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
