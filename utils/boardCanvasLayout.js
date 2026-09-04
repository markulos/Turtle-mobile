/**
 * boardCanvasLayout — the shared geometry primitives behind the Boards canvas.
 *
 * Kept free of react-native imports on purpose (same rule as `zoomMath`): this
 * is plain, side-effect-free geometry, so it is unit-testable in jest without
 * rendering anything.
 *
 * Two ideas live here, and `boardMindMap` builds the actual map out of them.
 *
 * SIZE is activity, but by AREA rather than diameter (√ of the fraction of the
 * busiest board). A board with ten times the content should read as bigger;
 * scaling the diameter directly would make it a screen-filling blob sitting
 * next to a speck.
 *
 * PLACE, for the boards at the top of the map, is a phyllotaxis spiral — the
 * sunflower-seed arrangement: the i-th board sits at angle i × the golden angle,
 * radius ∝ √(i + ½). It fills a plane evenly with no rings or rows to line up on
 * (which is what makes it read as a map rather than a grid that lost its grid),
 * and its closest pair is a FIXED multiple of the spacing constant (see
 * PACKING). That last property is why there is no collision-relaxation pass
 * anywhere: solve the spacing for "the largest thing plus a gap" and nothing can
 * overlap, by construction, at any number of boards.
 *
 * ORDER is activity too. Boards rank by how much is actually on them, busiest
 * first — then by last activity, then by name, so the order can never wobble
 * between two loads that carry the same numbers. Since index 0 lands nearest the
 * middle of the spiral, ranking is also what puts the busiest board at the
 * centre of the map.
 */

/** Disc diameter for an empty board. Big enough to hold a 4-up collage. */
export const MIN_NODE = 62;
/** Disc diameter for the busiest board. */
export const MAX_NODE = 104;
/**
 * Clear space between one node's footprint and its nearest neighbour's.
 * It has to be at least LABEL_BAND: the name hangs BELOW the disc and is part
 * of the node, so two nodes stacked vertically need the label's height between
 * their discs.
 */
export const NODE_GAP = 44;
/**
 * Room reserved under each disc for its name + count line. The caller must keep
 * a label no wider than `size + LABEL_OVERHANG`, which is what stops two
 * side-by-side labels from touching.
 */
export const LABEL_BAND = 36;
/** How far a name may stick out past its own disc, on each side combined. */
export const LABEL_OVERHANG = 28;
/**
 * Slack around the outermost node, so the canvas can be dragged a little past
 * its own edge instead of stopping dead on a disc.
 */
export const CANVAS_PAD = 110;

// The golden angle, ~137.5°. Successive points share no common divisor of a
// full turn, which is exactly why the spiral never forms visible spokes.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
// Half a step of radial offset, so no board sits exactly on the origin. Without
// it, points 0 and 1 are only ONE spacing unit apart while every other pair is
// ~1.9 — the whole map would have to be spread to that worst case, and the
// result looks like scattered dust. Offsetting costs nothing and lifts the
// closest pair to PACKING below.
const RADIAL_OFFSET = 0.5;
/**
 * The closest pair in that spiral, measured in spacing units. It converges at
 * (0, 3) from five boards on and never drops below ~1.546 at any count, so this
 * is that figure rounded DOWN — the guarantee has to hold, not nearly hold.
 *
 * Read it as: `spiralPoint`s that are `spacing` apart in the parameter are at
 * least `PACKING × spacing` apart on the plane. Solve `spacing` for the widest
 * thing you are placing and nothing can collide.
 */
export const PACKING = 1.54;

const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/**
 * How much is on a board. Prefers the server's own `total`, falls back to
 * summing the counts block, and treats a names-only board (the fast-path tier,
 * which has neither) as empty — so the first paint is a field of equal discs
 * that grow in place when the overview lands.
 */
export function boardWeight(board) {
  if (!board) return 0;
  if (Number.isFinite(Number(board.total))) return Math.max(0, Number(board.total));
  const counts = board.counts;
  if (counts && typeof counts === 'object') {
    return Math.max(
      0,
      finite(counts.tasks) + finite(counts.notes)
      + finite(counts.media) + finite(counts.audio) + finite(counts.chat),
    );
  }
  return 0;
}

/**
 * Disc diameter for a board carrying `weight`, against the busiest board's
 * `busiest`. Square-rooted so the AREA is proportional to the weight.
 */
export function nodeDiameter(weight, busiest, min = MIN_NODE, max = MAX_NODE) {
  if (!(busiest > 0)) return min;
  const fraction = Math.min(1, Math.max(0, finite(weight) / busiest));
  return min + (max - min) * Math.sqrt(fraction);
}

/** The i-th point of the phyllotaxis spiral, centred on the origin. */
export function spiralPoint(index, spacing) {
  const angle = index * GOLDEN_ANGLE;
  const radius = spacing * Math.sqrt(index + RADIAL_OFFSET);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/**
 * Busiest first; ties settled by recency, then name. Never mutates the input.
 *
 * `weightOf` is pluggable because the map ranks a board by its whole SUBTREE
 * (a folder of busy boards is a busy thing) while other callers mean the board
 * itself.
 */
export function rankBoards(boards, weightOf = boardWeight) {
  return boards.slice().sort((left, right) => (
    (weightOf(right) - weightOf(left))
    || (finite(right.lastTs) - finite(left.lastTs))
    || String(left.name).localeCompare(String(right.name))
  ));
}

/**
 * The scale at which the whole canvas fits inside the viewport, with a little
 * breathing room. Capped at 1 — a three-board canvas should not be blown up
 * past its natural size just because it would fit.
 */
export function canvasFitScale(canvasW, canvasH, viewW, viewH, inset = 24) {
  if (!(canvasW > 0) || !(canvasH > 0) || !(viewW > 0) || !(viewH > 0)) return 1;
  const fit = Math.min(
    (viewW - inset * 2) / canvasW,
    (viewH - inset * 2) / canvasH,
  );
  if (!(fit > 0)) return 1;
  return Math.min(1, fit);
}
