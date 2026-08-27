/**
 * zoomMath — pure geometry for the photo viewer's pinch/pan zoom surface.
 *
 * Kept free of react-native / reanimated imports on purpose: every function is
 * a plain, side-effect-free calculation, so it is unit-testable in jest AND
 * callable from a Reanimated worklet (the `'worklet'` directives below are what
 * let the UI thread run them without a JS-thread hop).
 *
 * The model, once, so the rest of the viewer can stop re-deriving it:
 *
 *   • The CONTAINER is the fixed on-screen box the photo lives in (screen
 *     width × the viewer's 85% height band).
 *   • The CONTENT is the letterboxed image rect inside it — `contain` fit, so
 *     it matches the container on one axis and is smaller on the other.
 *   • translateX/translateY are measured from the CONTAINER'S CENTRE, and the
 *     content is centred at (0, 0). This is the whole reason zoom-out lands
 *     centred: "no offset" is literally the origin, not a scroll position that
 *     has to be driven back to zero.
 *
 * The old implementation used iOS's native UIScrollView zoom
 * (maximumZoomScale + scrollResponderZoomTo). There, "centred" is a contentOffset
 * that UIScrollView recomputes from the pinch centroid and never re-centres when
 * the zoomed content shrinks back inside the viewport — so pinching out always
 * left the photo parked off-centre (and Android got no pinch zoom at all,
 * since those props are iOS-only).
 */

/** Scale floor — the photo at rest exactly fills its `contain` box. */
export const MIN_SCALE = 1;
/** Scale ceiling. 6× on a 1600px display variant is still sharp-ish, and it is
 *  where Apple Photos lands for a typical phone-camera image. */
export const MAX_SCALE = 6;
/** Where a double-tap zooms to (and back from). */
export const DOUBLE_TAP_SCALE = 2.5;
/** How much of an out-of-bounds drag is actually applied (iOS-style drag). */
export const PAN_RUBBER = 0.35;
/** How much of an over/under-scale pinch is applied past the limits. */
export const SCALE_RUBBER = 0.35;

/**
 * `contain`-fit the given aspect ratio inside the container.
 * @param {number} containerW
 * @param {number} containerH
 * @param {number} aspect  content width / height. 0, NaN or negative means
 *                         "unknown" → fall back to the full container, which
 *                         degrades to the pre-existing (looser) pan bounds
 *                         rather than to something wrong.
 */
export function containSize(containerW, containerH, aspect) {
  'worklet';
  if (!(containerW > 0) || !(containerH > 0)) return { width: 0, height: 0 };
  if (!(aspect > 0) || !Number.isFinite(aspect)) {
    return { width: containerW, height: containerH };
  }
  const containerAspect = containerW / containerH;
  if (aspect > containerAspect) {
    // Wider than the box → pillarboxed: full width, short height.
    return { width: containerW, height: containerW / aspect };
  }
  // Taller than the box → letterboxed: full height, narrow width.
  return { width: containerH * aspect, height: containerH };
}

/**
 * Half the travel available on one axis: how far the centre of the content may
 * move before an edge of the content would leave the container. 0 when the
 * scaled content still fits — which is what pins a not-yet-overflowing axis to
 * dead centre instead of letting it drift.
 */
export function panBound(contentDim, containerDim, scale) {
  'worklet';
  const overflow = contentDim * scale - containerDim;
  return overflow > 0 ? overflow / 2 : 0;
}

/** Hard clamp to ±limit. */
export function clamp(value, limit) {
  'worklet';
  if (value > limit) return limit;
  // `limit === 0 ? 0` avoids handing back -0, which would read as an offset in
  // a strict comparison even though it renders identically.
  if (value < -limit) return limit === 0 ? 0 : -limit;
  return value;
}

/** Clamp to ±limit, but let the excess through at `resistance` strength so the
 *  photo can be dragged slightly past its edge and spring back. */
export function rubberClamp(value, limit, resistance = PAN_RUBBER) {
  'worklet';
  if (value > limit) return limit + (value - limit) * resistance;
  if (value < -limit) return -limit + (value + limit) * resistance;
  return value;
}

/** Same idea in scale space: pinching below MIN or past MAX gives, then snaps. */
export function rubberScale(scale, min = MIN_SCALE, max = MAX_SCALE, resistance = SCALE_RUBBER) {
  'worklet';
  if (scale < min) return min - (min - scale) * resistance;
  if (scale > max) return max + (scale - max) * resistance;
  return scale;
}

/** Hard clamp for scale, used when a gesture ends. */
export function clampScale(scale, min = MIN_SCALE, max = MAX_SCALE) {
  'worklet';
  if (!(scale > 0) || !Number.isFinite(scale)) return min;
  if (scale < min) return min;
  if (scale > max) return max;
  return scale;
}

/**
 * The scale at which the `contain`-fitted image COVERS the container — i.e.
 * what iOS Photos zooms to on a double-tap. Apple does not use a fixed 2×: a
 * double-tap fills the screen with the photo (cropping the long axis), so a
 * panorama zooms far more than a near-square shot. Returns 1 when the aspect is
 * unknown or already fills the box; callers fall back to DOUBLE_TAP_SCALE.
 */
export function fillScale(containerW, containerH, aspect) {
  'worklet';
  const content = containSize(containerW, containerH, aspect);
  if (!(content.width > 0) || !(content.height > 0)) return 1;
  const byWidth = containerW / content.width;
  const byHeight = containerH / content.height;
  return byWidth > byHeight ? byWidth : byHeight;
}

/**
 * Zoom ceiling derived from the SOURCE pixels, the way iOS caps zoom at "you
 * are now looking at real pixels" (plus a little overshoot, since Photos does
 * let you push past 1:1 into softness).
 *
 * @param sourcePx     original image width in pixels (DB metadata / decoder)
 * @param contentPt    displayed width of the fitted image, in points
 * @param pixelRatio   screen scale factor
 */
export function nativeMaxScale(sourcePx, contentPt, pixelRatio, floor = 2.5, ceiling = MAX_SCALE) {
  'worklet';
  if (!(sourcePx > 0) || !(contentPt > 0) || !(pixelRatio > 0)) return ceiling;
  const oneToOne = sourcePx / (contentPt * pixelRatio);
  const allowed = oneToOne * 1.4; // Apple's overshoot past 1:1
  if (allowed < floor) return floor;
  if (allowed > ceiling) return ceiling;
  return allowed;
}

/**
 * Translation that keeps the content point currently under `focal` pinned
 * under `focal` at the new scale.
 *
 * `origin` is that content point in unscaled, centre-relative content space:
 *   origin = (focalAtStart - translateAtStart) / scaleAtStart
 * so the inverse is simply focal - origin * nextScale.
 */
export function focalTranslate(focal, origin, nextScale) {
  'worklet';
  return focal - origin * nextScale;
}

/**
 * The pan baseline that leaves the surface exactly where it is.
 *
 * A pan is applied as `position = start + translation`, so re-anchoring means
 * choosing the `start` that reproduces the CURRENT position under the CURRENT
 * translation. Used whenever something other than the finger has moved the
 * surface — another gesture writing to it, or a jump in what "translation" is
 * being measured from.
 */
export function panBaseline(position, translation) {
  'worklet';
  return position - translation;
}

/**
 * The pan baseline that absorbs a discontinuity in the measured translation.
 *
 * Gesture Handler measures a multi-touch pan from the AVERAGE of the fingers on
 * the glass. Lift one of two and that average leaps, instantly, by half the
 * distance between them — with no hand movement at all. Feeding that leap
 * straight into `start + translation` throws the surface across the screen
 * towards whichever finger stayed down, which is exactly what a pinch looks
 * like when it ends one finger at a time.
 *
 * Shifting the baseline by the size of the leap cancels it: the surface keeps
 * the position it had, and the finger that remains carries on from there.
 */
export function absorbTouchJump(start, lastTranslation, translation) {
  'worklet';
  return start + lastTranslation - translation;
}

/**
 * The resting position for a given scale: translation clamped inside the pan
 * bounds, and both axes forced to 0 on any axis with no overflow. Used at the
 * end of every gesture — this is the single place that guarantees a zoom-out
 * always settles perfectly centred.
 */
export function settle(tx, ty, containerW, containerH, aspect, scale) {
  'worklet';
  const nextScale = clampScale(scale);
  const content = containSize(containerW, containerH, aspect);
  const boundX = panBound(content.width, containerW, nextScale);
  const boundY = panBound(content.height, containerH, nextScale);
  return {
    scale: nextScale,
    x: clamp(tx, boundX),
    y: clamp(ty, boundY),
    boundX,
    boundY,
  };
}
