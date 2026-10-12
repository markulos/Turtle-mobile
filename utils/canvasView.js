/**
 * canvasView — the geometry of LOOKING at a canvas board.
 *
 * Pure, side-effect-free and worklet-safe (the `'worklet'` directives are what
 * let the UI thread run these without a hop to JS), exactly like
 * utils/zoomMath, whose primitives this builds on rather than re-deriving:
 * `panBound`, `rubberClamp`, `rubberScale`, `clampScale`, `focalTranslate`.
 * The photo viewer's pinch has been through several rounds of "that feels
 * wrong" already; a second, subtly different implementation of the same
 * arithmetic is how two surfaces in one app end up feeling like two apps.
 *
 * ─── The model, once ───────────────────────────────────────────────────────
 *
 * The board's own coordinates are world units, and a board can sit anywhere in
 * them (nothing says a canvas starts at 0,0). So the view works in terms of
 * the board's CENTRE:
 *
 *   screen = viewportCentre + translate + scale × (world − boardCentre)
 *
 * which inverts to
 *
 *   world = boardCentre + (screen − viewportCentre − translate) / scale
 *
 * Translation is therefore measured from "the board is centred in the
 * viewport", and (0, 0) IS centred. That is not a convenience: it is what
 * makes zooming back out land the board in the middle of the screen every
 * time, instead of wherever a scroll offset happened to be — the same
 * reasoning zoomMath's header gives for the photo viewer.
 *
 * ─── What the limits mean ──────────────────────────────────────────────────
 *
 * You may not pan a board off the screen. `panLimits` gives the travel on each
 * axis — half the overflow — and it is ZERO on an axis where the board still
 * fits, which pins that axis dead centre rather than letting the board drift
 * about in empty space. A canvas you have flung into the void is a canvas you
 * have lost, and a double-tap to find it again is a worse answer than never
 * losing it.
 *
 * Zooming out stops at the FIT scale for the same reason: the whole board on
 * the screen is as far out as anyone needs to be, and past it the board just
 * becomes a stamp in a field of nothing.
 */
import {
  MAX_ZOOM as DOC_MAX_ZOOM,
  MIN_ZOOM as DOC_MIN_ZOOM,
} from './canvasDoc';
import { panBound } from './zoomMath';

/** Air left around a fitted board, in screen points. */
export const FIT_MARGIN = 24;

/** How far a double-tap zooms IN, as a multiple of the fit. Enough that a
 *  label becomes readable on a wall-sized board, capped by the absolute
 *  ceiling below. */
export const DOUBLE_TAP_FACTOR = 4;

/** Absolute zoom ceiling, world→screen. Past this a photo is mush and a text
 *  item is a billboard. */
export const MAX_SCALE = DOC_MAX_ZOOM;
/** Absolute floor, for the pathological board whose own fit is smaller. */
export const MIN_SCALE = DOC_MIN_ZOOM;

const finite = (v, fallback = 0) => {
  'worklet';
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * The scale at which the whole board fits the viewport, with a margin.
 *
 * This is also the view's zoom FLOOR — see the header. Returns 1 for a board
 * with nothing on it: there is nothing to fit, and inventing a zoom would make
 * whatever is added first appear at some arbitrary size.
 */
export function fitScale(bounds, viewport, margin = FIT_MARGIN) {
  'worklet';
  const vw = finite(viewport?.w, 0);
  const vh = finite(viewport?.h, 0);
  if (!bounds || !(vw > 0) || !(vh > 0)) return 1;
  const w = Math.max(1, finite(bounds.w, 1));
  const h = Math.max(1, finite(bounds.h, 1));
  const usableW = Math.max(1, vw - margin * 2);
  const usableH = Math.max(1, vh - margin * 2);
  const s = Math.min(usableW / w, usableH / h);
  if (!(s > 0) || !Number.isFinite(s)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/**
 * How far the view may be panned from centre, per axis, at a given scale.
 *
 * Zero on an axis with no overflow — that axis is pinned centred. Straight
 * from zoomMath, so the canvas and the photo viewer agree about what "the edge"
 * means.
 */
export function panLimits(bounds, viewport, scale) {
  'worklet';
  if (!bounds) return { x: 0, y: 0 };
  const s = finite(scale, 1);
  return {
    x: panBound(Math.max(1, finite(bounds.w, 1)), finite(viewport?.w, 0), s),
    y: panBound(Math.max(1, finite(bounds.h, 1)), finite(viewport?.h, 0), s),
  };
}

/**
 * A point on the screen, in world coordinates.
 *
 * The inverse of the transform in the header. Worth having written down and
 * tested: get it backwards and a tap lands somewhere plausible at low zoom and
 * nowhere near the finger at high.
 */
export function screenToWorld(point, { viewport, bounds, scale, x, y }) {
  'worklet';
  const s = finite(scale, 1) || 1;
  const cx = bounds ? finite(bounds.x) + finite(bounds.w) / 2 : 0;
  const cy = bounds ? finite(bounds.y) + finite(bounds.h) / 2 : 0;
  const vx = finite(viewport?.w, 0) / 2;
  const vy = finite(viewport?.h, 0) / 2;
  return {
    x: cx + (finite(point?.x, 0) - vx - finite(x, 0)) / s,
    y: cy + (finite(point?.y, 0) - vy - finite(y, 0)) / s,
  };
}

/**
 * A focal point in CENTRE-RELATIVE screen coordinates, which is what the
 * zoom maths wants: the pinch reports a point measured from the top-left, and
 * everything here is measured from the middle.
 */
export function focalFromCentre(point, viewport) {
  'worklet';
  return {
    x: finite(point?.x, 0) - finite(viewport?.w, 0) / 2,
    y: finite(point?.y, 0) - finite(viewport?.h, 0) / 2,
  };
}

/**
 * ─── How big a picture to actually fetch ───────────────────────────────────
 *
 * The pond generates an image at several sizes, addressed by id, and the one
 * a canvas wants depends entirely on how big the item is ON THE GLASS — which
 * is a property of the zoom, not of the board.
 *
 * A fitted wall draws a 220-unit photo at twenty points. Fetching the 1600px
 * tier for that is a third of a megabyte and a full-size decode to paint a
 * thumbnail, times every item on the board; the 768px tier is 50-120 KB and
 * is still more pixels than the screen can show until you have zoomed well in.
 * That is the single biggest thing between opening a canvas and seeing it.
 *
 * The rule is "enough pixels for the device", with a margin so a tier does not
 * flip back and forth at the boundary while someone pinches around it.
 */
export const PREVIEW_PX = 768;
export const DISPLAY_PX = 1600;
/** How far past a tier's own size an item may grow before the next one is
 *  fetched. Slack, so a pinch that hovers at the boundary does not thrash. */
const TIER_SLACK = 1.15;

/**
 * Which variant an item of this world width needs at this scale.
 *
 * `preview` or `display` — never `raw`: a canvas is a wall of pictures, and
 * the point at which 1600px stops being enough is well past the point at
 * which you would open the photo itself.
 */
export function tierFor(worldWidth, scale, pixelRatio = 1) {
  'worklet';
  const w = finite(worldWidth, 0);
  const s = finite(scale, 1);
  const dpr = Math.max(1, finite(pixelRatio, 1));
  const needed = w * s * dpr;
  return needed <= PREVIEW_PX * TIER_SLACK ? 'preview' : 'display';
}

/** The URL for one item's picture at a given tier. A capability URL the image
 *  loader can fetch directly — it carries no header, which is why the pond
 *  serves these unauthenticated by id. */
export function mediaUrlFor(origin, ref, tier) {
  return `${String(origin || '')}/api/media/${tier === 'display' ? 'display' : 'preview'}/${encodeURIComponent(String(ref || ''))}`;
}

/**
 * ─── What is actually on the screen ────────────────────────────────────────
 *
 * The world rectangle the viewport is currently showing, grown by a margin so
 * what is just off the edge is already there when you get to it.
 *
 * Used to leave the rest of the board unmounted. At the fit this is the whole
 * board and nothing is saved, which is correct — at the fit every item IS on
 * screen. Zoomed in on a corner of a two-hundred-item wall it is the
 * difference between decoding four pictures and decoding two hundred.
 */
export function visibleWorldRect({ viewport, centre, scale, x, y }, margin = 0.75) {
  const s = finite(scale, 1) || 1;
  const vw = finite(viewport?.w, 0);
  const vh = finite(viewport?.h, 0);
  if (!(vw > 0) || !(vh > 0)) return null;
  const halfW = (vw / 2) / s;
  const halfH = (vh / 2) / s;
  const cx = finite(centre?.x, 0) - finite(x, 0) / s;
  const cy = finite(centre?.y, 0) - finite(y, 0) / s;
  const padX = halfW * 2 * finite(margin, 0);
  const padY = halfH * 2 * finite(margin, 0);
  return {
    x: cx - halfW - padX,
    y: cy - halfH - padY,
    w: (halfW + padX) * 2,
    h: (halfH + padY) * 2,
  };
}

/** The items that overlap a world rectangle. Null rect means "no idea yet" —
 *  hand back everything rather than an empty board. */
export function itemsInRect(items, rect) {
  const list = Array.isArray(items) ? items : [];
  if (!rect) return list;
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  return list.filter((i) => (
    i.x <= right && i.x + i.w >= rect.x && i.y <= bottom && i.y + i.h >= rect.y
  ));
}

/**
 * Where a double-tap goes.
 *
 * Toggling, the way every photo viewer does it: zoomed out (at or near the
 * fit), go IN; anywhere else, come back to the fit. "Near" is a few percent,
 * because a pinch that ended at 1.02× fit is a user who meant the fit and
 * would be baffled to be sent further out.
 */
export function doubleTapScale(current, fit, max = MAX_SCALE) {
  'worklet';
  const now = finite(current, 1);
  const base = finite(fit, 1);
  const ceiling = Math.max(base, finite(max, base));
  if (now > base * 1.05) return base;
  return Math.min(ceiling, base * DOUBLE_TAP_FACTOR);
}
