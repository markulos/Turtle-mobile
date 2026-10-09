/**
 * A canvas board, as the phone reads it.
 *
 * A canvas board is the freeform wall you arrange on the desktop: photos from
 * the vault, notes, tasks and lines of text sitting where you put them, at the
 * size you made them. This is the phone's half of that — the READER.
 *
 * ─── Where the boards come from ────────────────────────────────────────────
 *
 * `users.settings.canvasBoards`, through `GET /api/me`. The same per-user JSON
 * store the avatar choice and the pinned notes already ride on, which is why
 * the phone can show the real boards with no server change at all: the web app
 * writes that key, and this reads it. Nothing here is a mobile copy of
 * anything.
 *
 * ─── This is a PORT, and the web file is the original ──────────────────────
 *
 * `web-app/src/components/canvas/canvasDoc.ts` is the source of truth: it owns
 * the shape, the caps and the encoder that writes the blob. This file is the
 * subset the phone needs to READ one — the shape, the caps, and the tolerant
 * decode — with the types stripped (this app is plain JS) and the mutators
 * left out, because nothing here writes yet.
 *
 * Keep the caps and the decode in step with that file. They are a contract
 * between two apps sharing one JSON column, and the failure mode of drifting
 * is quiet: a board that loads on the desktop and comes up empty in your hand.
 *
 * ─── Deliberately read-only, for now ───────────────────────────────────────
 *
 * A save rewrites the WHOLE boards array — last-writer-wins at the array
 * level, which the web file is explicit about. That is tolerable between two
 * browser tabs; with a phone in your pocket it becomes "the phone clobbers the
 * desktop you left open". So the phone reads and does not write, and the
 * conflict question gets answered before it does.
 */

/** What an item on a canvas stands for. */
export const CANVAS_KINDS = ['media', 'note', 'task', 'text'];

/**
 * Bounds. Not arbitrary: everything here shares ONE JSON column with the rest
 * of the user's settings and is rewritten whole on every save, so "no limit"
 * eventually means "no settings". Same numbers as the web file.
 */
export const MAX_BOARDS = 24;
export const MAX_ITEMS = 240;
export const MAX_NAME = 60;
export const MAX_LABEL = 80;
export const MAX_TEXT = 600;

/** Nothing may be smaller or larger than this, in world px. */
export const ITEM_MIN = 48;
export const ITEM_MAX = 4000;

/** Default size for an item whose own is missing, by kind. */
export const DEFAULT_SIZE = {
  media: { w: 220, h: 220 },
  note: { w: 240, h: 170 },
  task: { w: 250, h: 96 },
  text: { w: 240, h: 120 },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finite = (v, fallback = 0) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** A name that is safe to show and never blank. */
export function cleanName(raw, fallback = 'Untitled canvas') {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return s || fallback;
}

/**
 * Read the boards out of whatever is actually in `users.settings`.
 *
 * Tolerant on purpose, and that is the web file's reasoning kept rather than
 * copied: the blob is shared with every other setting, is hand-editable
 * through the generic API, and will outlive this version of the shape — so a
 * single malformed item must cost that item and nothing more. A throw here
 * would blank the whole feature; a filter costs one card.
 */
export function decodeBoards(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const b of raw.slice(0, MAX_BOARDS)) {
    if (!b || typeof b !== 'object') continue;
    const id = typeof b.id === 'string' && b.id ? b.id : null;
    if (!id) continue;
    const items = [];
    const rawItems = Array.isArray(b.items) ? b.items : [];
    for (const it of rawItems.slice(0, MAX_ITEMS)) {
      if (!it || typeof it !== 'object') continue;
      if (!CANVAS_KINDS.includes(it.kind)) continue;
      const itemId = typeof it.id === 'string' && it.id ? it.id : null;
      if (!itemId) continue;
      // A non-text item with no ref points at nothing and would paint as an
      // empty frame nobody can explain.
      const ref = typeof it.ref === 'string' ? it.ref : '';
      if (it.kind !== 'text' && !ref) continue;
      const base = DEFAULT_SIZE[it.kind];
      items.push({
        id: itemId,
        kind: it.kind,
        ref,
        x: finite(it.x),
        y: finite(it.y),
        w: clamp(finite(it.w, base.w), ITEM_MIN, ITEM_MAX),
        h: clamp(finite(it.h, base.h), ITEM_MIN, ITEM_MAX),
        z: finite(it.z, items.length),
        ...(typeof it.label === 'string' && it.label
          ? { label: it.label.slice(0, MAX_LABEL) } : {}),
        ...(typeof it.text === 'string' && it.text
          ? { text: it.text.slice(0, MAX_TEXT) } : {}),
        ...(it.page && finite(it.page, 0) > 1 ? { page: Math.round(finite(it.page, 1)) } : {}),
      });
    }
    const created = finite(b.createdAt, 0);
    out.push({
      id,
      name: cleanName(b.name),
      createdAt: created,
      updatedAt: finite(b.updatedAt, created),
      canvasX: b.canvasX == null ? null : finite(b.canvasX),
      canvasY: b.canvasY == null ? null : finite(b.canvasY),
      items,
    });
  }
  return out;
}

/** Back to front — the order they must be drawn in. */
export const stacked = (board) => [...(board?.items || [])]
  .sort((a, b) => a.z - b.z || String(a.id).localeCompare(String(b.id)));

/** The box every item of a board fits inside, in world units. Null when the
 *  board is empty — there is nothing to frame. */
export function boardBounds(board) {
  const items = board?.items || [];
  if (items.length === 0) return null;
  let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
  for (const i of items) {
    if (i.x < left) left = i.x;
    if (i.y < top) top = i.y;
    if (i.x + i.w > right) right = i.x + i.w;
    if (i.y + i.h > bottom) bottom = i.y + i.h;
  }
  return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
}

/** How far the phone may zoom. The floor is low because a board laid out on a
 *  27-inch monitor has to fit in a hand; the ceiling is for reading a label. */
export const MIN_ZOOM = 0.08;
export const MAX_ZOOM = 4;

/**
 * The view that puts a whole board on the screen.
 *
 * Returns the scale and the translation to apply to the world, in that order
 * (scale about the origin, then translate), so the board's bounds land centred
 * in the viewport with a margin. This is the single most important thing the
 * phone does differently from the desktop: a canvas is authored at desktop
 * scale, and opening one at 1:1 on a phone shows you one corner of one photo
 * with no way to tell what you are looking at.
 *
 * An empty board gets the identity view — there is nothing to fit, and
 * inventing a zoom for it would make the first item you add appear at some
 * arbitrary size.
 */
export function fitView(bounds, viewport, { margin = 24 } = {}) {
  const vw = Math.max(1, finite(viewport?.w, 1));
  const vh = Math.max(1, finite(viewport?.h, 1));
  if (!bounds) return { scale: 1, x: vw / 2, y: vh / 2 };
  const usableW = Math.max(1, vw - margin * 2);
  const usableH = Math.max(1, vh - margin * 2);
  const scale = clamp(Math.min(usableW / bounds.w, usableH / bounds.h), MIN_ZOOM, MAX_ZOOM);
  // Centre the bounds' MIDDLE in the viewport's middle.
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  return { scale, x: vw / 2 - cx * scale, y: vh / 2 - cy * scale };
}

/**
 * The item under a point, in WORLD coordinates — topmost first.
 *
 * Hit-testing here rather than hanging a touch handler on every item, for two
 * reasons. One: a handler on an image fires at the end of a DRAG as readily as
 * a tap, which is the app's "a tap is not a gesture" rule broken item by item.
 * Two: the stage already owns a tap gesture that knows whether the finger
 * held still, so the only thing missing was which item it landed on — and
 * that is arithmetic, which belongs here under test rather than in a view.
 *
 * Topmost wins, because that is what you can see.
 */
export function itemAtPoint(board, point) {
  const x = finite(point?.x, NaN);
  const y = finite(point?.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const front = stacked(board).slice().reverse();
  for (const i of front) {
    if (x >= i.x && x <= i.x + i.w && y >= i.y && y <= i.y + i.h) return i;
  }
  return null;
}

/**
 * A point on the SCREEN, in world coordinates.
 *
 * The inverse of the stage's transform (translate, then scale about the
 * origin). Written down because getting it backwards puts the tap somewhere
 * plausible but wrong — near the item at low zoom, nowhere near it at high.
 */
export function toWorld(point, view) {
  const scale = finite(view?.scale, 1) || 1;
  return {
    x: (finite(point?.x, 0) - finite(view?.x, 0)) / scale,
    y: (finite(point?.y, 0) - finite(view?.y, 0)) / scale,
  };
}

/** "12 items" / "1 item" / "Empty" — what a board's row says it holds. */
export function itemCountLabel(count) {
  const n = Number(count) || 0;
  if (n <= 0) return 'Empty';
  return `${n} item${n === 1 ? '' : 's'}`;
}
