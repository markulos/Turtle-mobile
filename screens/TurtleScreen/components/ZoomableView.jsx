/**
 * ZoomableView — the photo viewer's pinch/pan/double-tap surface.
 *
 * Replaces the old iOS-only `ScrollView maximumZoomScale` cell. Everything runs
 * on the UI thread (Reanimated shared values driven by Gesture Handler), so the
 * transform never round-trips through JS, and the resting state is an explicit
 * transform — scale 1, translate (0, 0) — rather than a scroll offset the OS
 * owns. That is the fix for "zooming out always leaves the photo offset":
 * UIScrollView never re-centres content that has shrunk back inside its
 * viewport, so every pinch-out settled wherever the centroid happened to be.
 *
 * Behaviour (Apple Photos parity, minus the zoomed edge-to-next-photo handoff,
 * which the native pager below us owns):
 *   • Pinch with a live focal point — the pixels under the fingers stay under
 *     the fingers, including two-finger drag mid-pinch.
 *   • Pan only once zoomed (manual activation), so at rest the horizontal pager
 *     and the pull-to-dismiss responder keep every touch they had before.
 *   • Rubber-banding past the scale limits and past the image edges, springing
 *     back on release.
 *   • Flick-to-glide with `withDecay`, clamped to the image bounds.
 *   • Double-tap zooms to the tapped point (or back out to a centred 1×).
 *   • Single tap is forwarded, so the viewer's chrome toggle still works.
 *   • Pan bounds follow the LETTERBOXED image rect (from its aspect ratio), not
 *     the container, so you can never drag the photo off into the black bars.
 *
 * Resetting: any change of `resetKey` (media id) or `active` snaps back to
 * 1× / centred with no animation — recycled pager cells must never inherit the
 * previous photo's zoom or pan.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withTiming,
} from 'react-native-reanimated';
import {
  MIN_SCALE,
  MAX_SCALE,
  DOUBLE_TAP_SCALE,
  clamp,
  clampScale,
  containSize,
  fillScale,
  focalTranslate,
  panBound,
  rubberClamp,
  rubberScale,
  settle,
} from '../../../utils/zoomMath';
import { R_TIMING } from '../../../utils/motionReanimated';

// Snap-back / double-tap animation: the shared `settle` timing. Short and
// eased-out — long springs on a zoom surface read as lag when the user is
// already moving to their next gesture. This used to be a local 220ms against
// the canvas's 240ms, which is the kind of difference nobody sees in one file
// and everybody feels moving between two screens.

// A zoom is "engaged" (chrome hides, pager locks, HD layer forced) past this.
const ZOOMED_EPSILON = 1.01;
// Pinching a NOT-zoomed photo down past this raw scale closes the viewer, the
// way iOS Photos drops back to the grid. Measured on the raw gesture scale, not
// the rubber-banded display scale, so the threshold means what it says.
const PINCH_DISMISS_SCALE = 0.72;
// Below 1× the photo tracks the fingers almost 1:1 — in iOS Photos a pinch-in
// shrinks the photo the whole way toward the grid, it does not fight you. Above
// the ceiling the give stays stiff (that IS a limit, and should feel like one).
const UNDERSCALE_RUBBER = 0.9;

const ZoomableView = ({
  children,
  style,
  /** Changing this snaps the surface back to 1× / centred, un-animated. */
  resetKey,
  /** false → the cell is off-screen; also forces the reset. */
  active = true,
  /** Rendered media aspect ratio (w / h). Null/0 = unknown → container bounds. */
  aspectRatio,
  /** Coarse zoom signal: true once scale passes ZOOMED_EPSILON. */
  onZoomedChange,
  /** Single tap (double-tap-safe: fires only once the double-tap has failed). */
  onSingleTap,
  /** Pinch-in on an unzoomed photo, past PINCH_DISMISS_SCALE → close (iOS
   *  Photos' drop-back-to-the-grid gesture). */
  onPinchDismiss,
  maxScale = MAX_SCALE,
  doubleTapScale = DOUBLE_TAP_SCALE,
}) => {
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  // Container geometry, measured rather than assumed (the viewer's height band
  // is a fraction of the screen and has changed before).
  const containerW = useSharedValue(0);
  const containerH = useSharedValue(0);
  const aspect = useSharedValue(aspectRatio > 0 ? aspectRatio : 0);

  // Gesture bookkeeping.
  const savedScale = useSharedValue(1);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const isZoomedSv = useSharedValue(false);
  // Un-rubber-banded pinch scale, kept for the dismiss threshold.
  const rawScale = useSharedValue(1);

  useEffect(() => {
    aspect.value = aspectRatio > 0 ? aspectRatio : 0;
  }, [aspectRatio, aspect]);

  // Pan is MOUNTED-BUT-DISABLED until the photo is actually zoomed. See the
  // gesture's own note: an always-attached pan recognizer is what killed
  // page-to-page swiping.
  const [panEnabled, setPanEnabled] = useState(false);

  const reportZoomed = useCallback((z) => {
    setPanEnabled(z);
    if (onZoomedChange) onZoomedChange(z);
  }, [onZoomedChange]);

  // Coarse zoom edge-detection on the UI thread: one JS hop per state flip
  // instead of one per frame (the shell re-renders on this signal).
  useAnimatedReaction(
    () => scale.value > ZOOMED_EPSILON,
    (zoomed, previous) => {
      if (zoomed === previous) return;
      isZoomedSv.value = zoomed;
      runOnJS(reportZoomed)(zoomed);
    },
    [reportZoomed],
  );

  // Hard reset on photo change / deactivation. Un-animated on purpose: a
  // recycled cell must be at rest before its new image paints.
  useEffect(() => {
    cancelAnimation(scale);
    cancelAnimation(translateX);
    cancelAnimation(translateY);
    scale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    rawScale.value = 1;
    savedScale.value = 1;
    savedX.value = 0;
    savedY.value = 0;
    if (isZoomedSv.value) {
      isZoomedSv.value = false;
      reportZoomed(false);
    }
    // Shared values are stable refs; this must run only on identity/activity
    // changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, active]);

  const onLayout = useCallback((e) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    containerW.value = w;
    containerH.value = h;
  }, [containerW, containerH]);

  const pinch = useMemo(() => Gesture.Pinch()
    .onStart((e) => {
      'worklet';
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      cancelAnimation(scale);
      savedScale.value = scale.value;
      rawScale.value = scale.value;
      // Focal point relative to the container centre — the same frame the
      // translations live in.
      const fx = e.focalX - containerW.value / 2;
      const fy = e.focalY - containerH.value / 2;
      originX.value = (fx - translateX.value) / scale.value;
      originY.value = (fy - translateY.value) / scale.value;
    })
    .onUpdate((e) => {
      'worklet';
      const raw = savedScale.value * e.scale;
      rawScale.value = raw;
      const next = raw < MIN_SCALE
        ? rubberScale(raw, MIN_SCALE, maxScale, UNDERSCALE_RUBBER)
        : rubberScale(raw, MIN_SCALE, maxScale);
      const fx = e.focalX - containerW.value / 2;
      const fy = e.focalY - containerH.value / 2;
      scale.value = next;
      // Focal tracking doubles as two-finger panning: the focal point moves
      // with the fingers, so the anchored content point follows them.
      translateX.value = focalTranslate(fx, originX.value, next);
      translateY.value = focalTranslate(fy, originY.value, next);
    })
    .onEnd(() => {
      'worklet';
      // Pinched a fit-to-screen photo well below 1× → drop back to the grid.
      // Only from an unzoomed start: pinching out OF a zoom is just a zoom-out.
      if (onPinchDismiss && savedScale.value <= ZOOMED_EPSILON && rawScale.value < PINCH_DISMISS_SCALE) {
        runOnJS(onPinchDismiss)();
        return;
      }
      const rest = settle(
        translateX.value, translateY.value,
        containerW.value, containerH.value, aspect.value,
        clampScale(scale.value, MIN_SCALE, maxScale),
      );
      const timing = R_TIMING.settle;
      if (scale.value !== rest.scale) scale.value = withTiming(rest.scale, timing);
      if (translateX.value !== rest.x) translateX.value = withTiming(rest.x, timing);
      if (translateY.value !== rest.y) translateY.value = withTiming(rest.y, timing);
    }), [maxScale, onPinchDismiss, aspect, containerH, containerW, originX, originY, rawScale, savedScale, scale, translateX, translateY]);

  const pan = useMemo(() => Gesture.Pan()
    // ENABLED ONLY WHILE ZOOMED. The first cut used `manualActivation` and just
    // never called activate() at 1×, on the assumption that an undetermined
    // handler is invisible to the pager underneath. It is not: on iOS the
    // manual-activation recognizer sits in the began state for the whole touch,
    // and UIKit lets a began recognizer cancel the scroll view's pan — so
    // swiping from photo to photo stopped working entirely. A disabled gesture
    // attaches nothing, so at 1× the pager and the pull-to-dismiss responder
    // see exactly the touches they saw before this component existed.
    .enabled(panEnabled)
    .onStart(() => {
      'worklet';
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    })
    .onUpdate((e) => {
      'worklet';
      const content = containSize(containerW.value, containerH.value, aspect.value);
      const boundX = panBound(content.width, containerW.value, scale.value);
      const boundY = panBound(content.height, containerH.value, scale.value);
      translateX.value = rubberClamp(savedX.value + e.translationX, boundX);
      translateY.value = rubberClamp(savedY.value + e.translationY, boundY);
    })
    .onEnd((e) => {
      'worklet';
      const content = containSize(containerW.value, containerH.value, aspect.value);
      const boundX = panBound(content.width, containerW.value, scale.value);
      const boundY = panBound(content.height, containerH.value, scale.value);
      const timing = R_TIMING.settle;

      // Inside the bounds → glide with the flick and stop at the edge.
      // Outside (rubber-banded) → snap straight back.
      if (Math.abs(translateX.value) > boundX) {
        translateX.value = withTiming(clamp(translateX.value, boundX), timing);
      } else if (boundX > 0) {
        translateX.value = withDecay({ velocity: e.velocityX, clamp: [-boundX, boundX], deceleration: 0.985 });
      } else {
        translateX.value = withTiming(0, timing);
      }

      if (Math.abs(translateY.value) > boundY) {
        translateY.value = withTiming(clamp(translateY.value, boundY), timing);
      } else if (boundY > 0) {
        translateY.value = withDecay({ velocity: e.velocityY, clamp: [-boundY, boundY], deceleration: 0.985 });
      } else {
        translateY.value = withTiming(0, timing);
      }
    }), [panEnabled, aspect, containerH, containerW, savedX, savedY, scale, translateX, translateY]);

  const doubleTap = useMemo(() => Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(260)
    .maxDelay(260)
    // A tap is a POINT event. Without an explicit ceiling the recognizer's
    // tolerance is platform-defined, and short pager flicks were landing
    // inside it — every borderline swipe also "tapped" and flipped the
    // chrome. 16pt is deliberate slack for a fast double-tap's second touch.
    .maxDistance(16)
    .onEnd((e) => {
      'worklet';
      const timing = R_TIMING.settle;
      if (scale.value > ZOOMED_EPSILON) {
        // Already zoomed → back to a centred 1×.
        scale.value = withTiming(1, timing);
        translateX.value = withTiming(0, timing);
        translateY.value = withTiming(0, timing);
        return;
      }
      // Zoom in ON the tapped point, then clamp so the result can't sit
      // outside the image.
      //
      // Target = FILL THE SCREEN, which is what a double-tap does in iOS
      // Photos: a 16:9 shot in a portrait viewer jumps much further than a
      // near-square one, because Apple zooms until the photo covers the frame
      // rather than to a fixed factor. Only when the aspect is unknown (or the
      // photo already fills the box both ways) does the fixed scale apply.
      const fill = fillScale(containerW.value, containerH.value, aspect.value);
      const target = fill > 1.05
        ? Math.min(fill, maxScale)
        : Math.min(doubleTapScale, maxScale);
      const fx = e.x - containerW.value / 2;
      const fy = e.y - containerH.value / 2;
      const ox = (fx - translateX.value) / scale.value;
      const oy = (fy - translateY.value) / scale.value;
      const rest = settle(
        focalTranslate(fx, ox, target), focalTranslate(fy, oy, target),
        containerW.value, containerH.value, aspect.value, target,
      );
      scale.value = withTiming(rest.scale, timing);
      translateX.value = withTiming(rest.x, timing);
      translateY.value = withTiming(rest.y, timing);
    }), [doubleTapScale, maxScale, aspect, containerH, containerW, scale, translateX, translateY]);

  const singleTap = useMemo(() => Gesture.Tap()
    .numberOfTaps(1)
    .maxDuration(260)
    // Tighter than the double-tap: a single tap that travelled is a swipe
    // that failed, and must FAIL as a tap — not toggle the chrome as a
    // consolation prize. This is half of the "chrome flips while paging"
    // fix; the shell's pager-quiet guard is the other half.
    .maxDistance(12)
    .onEnd((_e, success) => {
      'worklet';
      if (success && onSingleTap) runOnJS(onSingleTap)();
    }), [onSingleTap]);

  const gesture = useMemo(() => Gesture.Race(
    Gesture.Simultaneous(pinch, pan),
    // Exclusive → the single tap waits for the double tap to fail, so a
    // double-tap zoom never also toggles the chrome.
    Gesture.Exclusive(doubleTap, singleTap),
  ), [pinch, pan, doubleTap, singleTap]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={[{ flex: 1, overflow: 'hidden' }, style]} onLayout={onLayout} collapsable={false}>
        <Animated.View style={[{ flex: 1 }, animatedStyle]}>
          {children}
        </Animated.View>
      </View>
    </GestureDetector>
  );
};

export default ZoomableView;
