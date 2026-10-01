/**
 * imageEditorGeometry — where a finger actually landed ON THE PHOTO.
 *
 * The editor's pen and its lasso both record a path and post it to the pond,
 * which draws it at the photo's own resolution (see server
 * services/imageMarkup.js). For that to work the two sides have to agree on one
 * thing: a point is a FRACTION OF THE PHOTO, 0..1 on each axis, origin at the
 * top-left of the photo as the user sees it.
 *
 * WHY NOT PIXELS, AND WHY NOT A FRACTION OF THE STAGE. The phone has no idea
 * what the photo's real dimensions are — it's looking at a `display` tier, or
 * at a 600 px thumbnail while that loads, inside a stage whose size depends on
 * the device, the notch and the tab bar. And the photo does not fill that
 * stage: `contentFit="contain"` letterboxes it, so the same touch is a
 * different fraction of the stage than it is of the photo. Normalizing against
 * the LETTERBOXED RECT is the whole job of this module — get it wrong and every
 * stroke lands offset by the size of the black bars, which is exactly the kind
 * of bug that looks right on a square test image and wrong on every real one.
 *
 * Pure functions on purpose: the arithmetic is the part that can be wrong in a
 * way nobody notices until a sticker is cut from the wrong place, so it's
 * testable without rendering anything.
 */

/**
 * Caps mirrored from the pond (services/imageMarkup.js). Mirrored rather than
 * fetched so the editor can enforce them while the finger is still down —
 * posting a drawing the pond will refuse is a round trip and an error toast for
 * something the phone already knew.
 */
export const MAX_STROKES = 60;
export const MAX_POINTS = 1500;

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/**
 * The rect the photo actually occupies inside the stage, under `contain`.
 *
 * Returns stage-space pixels: `x`/`y` are the letterbox offsets, `w`/`h` the
 * drawn size. A stage or photo with no size yet yields a zero rect, which every
 * caller here treats as "not ready" rather than dividing by it.
 */
export function fitRect(stage, natural) {
  const sw = Number(stage?.w) || 0;
  const sh = Number(stage?.h) || 0;
  const nw = Number(natural?.w) || 0;
  const nh = Number(natural?.h) || 0;
  if (sw <= 0 || sh <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  // No dimensions on the row (a pre-migration import, or a tunnel row that has
  // never been probed): fall back to the stage itself. The drawing is then
  // normalized against the same rect it was drawn in, so it is at worst
  // uniformly stretched — never offset, which is the version a person notices.
  if (nw <= 0 || nh <= 0) return { x: 0, y: 0, w: sw, h: sh };
  const scale = Math.min(sw / nw, sh / nh);
  const w = nw * scale;
  const h = nh * scale;
  return { x: (sw - w) / 2, y: (sh - h) / 2, w, h };
}

/**
 * A stage-space touch as a fraction of the photo.
 *
 * Clamped, not rejected: a finger that slides off the photo mid-stroke is
 * ordinary drawing, and the honest reading is a stroke that runs to the edge.
 * (The pond clamps too — this is belt and braces, not duplication: the clamp
 * here is what makes the PREVIEW match what gets saved.)
 */
export function toPhotoPoint(touch, rect) {
  if (!rect || rect.w <= 0 || rect.h <= 0) return null;
  const x = Number(touch?.x);
  const y = Number(touch?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [clamp01((x - rect.x) / rect.w), clamp01((y - rect.y) / rect.h)];
}

/**
 * True when the touch is outside the drawn photo altogether.
 *
 * Used to decide whether a finger-down STARTS a stroke. Points inside a stroke
 * are clamped (above) because the finger was already drawing; a tap that begins
 * in the letterbox was never aimed at the photo, and starting a stroke there
 * would stamp a dot on the nearest edge.
 */
export function isOutsidePhoto(touch, rect) {
  if (!rect || rect.w <= 0 || rect.h <= 0) return true;
  const x = Number(touch?.x);
  const y = Number(touch?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
  return x < rect.x || y < rect.y || x > rect.x + rect.w || y > rect.y + rect.h;
}

/**
 * Add a point to a stroke in progress, or don't.
 *
 * A move event fires per frame, so an unfiltered stroke is thousands of points
 * within a few millimetres of each other — a payload the pond caps at 1500 and
 * an SVG path nobody can read. Dropping anything closer than `minStep` to the
 * last kept point costs nothing visually (it's sub-pixel at the pen's own
 * width) and keeps a normal scribble in the low hundreds.
 *
 * Returns the same array when the point is dropped, so a caller can use
 * identity to skip a re-render.
 */
export function appendPoint(points, next, minStep = 0) {
  if (!next) return points;
  if (!Array.isArray(points) || points.length === 0) return [next];
  if (points.length >= MAX_POINTS) return points;
  const [lx, ly] = points[points.length - 1];
  if (Math.hypot(next[0] - lx, next[1] - ly) < minStep) return points;
  return [...points, next];
}

/**
 * An SVG `d` for a path of photo-space points, drawn in STAGE space.
 *
 * The preview's <Svg> is positioned over the photo's rect, so a point's screen
 * position is its fraction times the rect — the exact inverse of
 * toPhotoPoint, which is what makes the preview trustworthy as a preview.
 *
 * A one-point path returns '' rather than a bare `M`: SVG draws nothing for
 * that, and the editor renders a dot for it instead (as the pond does on save).
 */
export function svgPathIn(points, rect, { close = false } = {}) {
  if (!Array.isArray(points) || points.length < 2 || !rect || rect.w <= 0) return '';
  const d = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${(x * rect.w).toFixed(2)} ${(y * rect.h).toFixed(2)}`)
    .join(' ');
  return close ? `${d} Z` : d;
}

/**
 * The pen's on-screen thickness as the fraction of the photo's WIDTH that the
 * pond needs. A 6 px pen on a photo drawn 300 px wide is 2 % of the photo,
 * which is 2 % of it at full resolution too — so a stroke keeps the weight it
 * was drawn with however big the original is.
 */
export function widthFraction(screenPx, rect) {
  if (!rect || rect.w <= 0) return 0.006;
  return screenPx / rect.w;
}

/**
 * Does this trace enclose enough to be worth cutting out?
 *
 * The pond needs three points, but three points a millimetre apart is a
 * mis-tap, not a trace — it would return a 6 px PNG and look like the feature
 * is broken. The bounding box has to cover at least ~4 % of each axis, which is
 * about a fingertip.
 */
export function isUsableOutline(points) {
  if (!Array.isArray(points) || points.length < 3) return false;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return (maxX - minX) >= 0.04 && (maxY - minY) >= 0.04;
}
