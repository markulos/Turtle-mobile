/**
 * boardFrames — the Boards canvas, where opening a board turns it INTO a frame.
 *
 * Tapping a board does not take you somewhere and does not sprout a diagram
 * around it. The disc grows into a bordered frame, in the board's own colour,
 * and everything the board holds is laid out INSIDE that border. Open a
 * sub-board and its own frame grows inside its parent's, which grows to hold
 * it. Containment is drawn as containment; there is nothing to trace with your
 * eye and nothing to remember.
 *
 * Pure geometry, no react-native imports — same rule as `boardCanvasLayout` and
 * `zoomMath`, so the arithmetic below is unit-testable without rendering.
 *
 * ── What is inside a frame ───────────────────────────────────────────────────
 *
 * Sub-boards, then the board's own contents GROUPED BY KIND: Tasks, Notes,
 * Photos, Chat. A closed group is one chip carrying its count; tapping it opens
 * a smaller frame inside the board's, holding those items.
 *
 * Grouping is what makes a real board legible. Ungrouped, a board's newest
 * handful is whatever it happens to have most of — forty photos, and the four
 * tasks that actually needed doing are nowhere on screen. Grouped, every kind
 * is visible as a count whether or not it is open, opening one is a decision
 * rather than a scroll, and the counts come from the overview the map already
 * loaded, so a frame opens with no fetch at all.
 *
 * ── How big a frame gets ─────────────────────────────────────────────────────
 *
 * Big enough for its contents, and never smaller than its FLOOR — a minimum
 * that scales with how much the board holds, by the same square-root-of-area
 * rule that sizes the disc. Without it a board with three hundred photos and
 * every group closed would open into the same little box as an empty one: four
 * chips, and no sense at all of the weight behind them. Size means activity on
 * the disc, and it has to keep meaning that when the disc becomes a frame.
 *
 * ── Why nothing ever overlaps ────────────────────────────────────────────────
 *
 * Inside a frame, the flow is the guarantee: boxes are laid end to end with a
 * gap and rows are stacked with a gap, so two boxes in a frame cannot touch by
 * construction. Nesting inherits it — a child frame's contents are inside that
 * child's box, which is one box in its parent's flow.
 *
 * At the top of the map, the spiral's spacing is solved for the widest thing on
 * it, measured as the circle that CIRCUMSCRIBES its box. Circles are what
 * PACKING is stated in, and a circle around a rectangle is a safe over-estimate
 * of it — costing at most √2 of slack, which on a surface you drag and pinch is
 * cheap next to the alternative of two frames sitting on top of each other.
 *
 * There is no relaxation pass and no simulation. The same boards opened the
 * same way always produce exactly the same map.
 */

import {
  nodeDiameter,
  rankBoards,
  spiralPoint,
  MIN_NODE,
  MAX_NODE,
  NODE_GAP,
  LABEL_BAND,
  LABEL_OVERHANG,
  CANVAS_PAD,
  PACKING,
} from './boardCanvasLayout';

/** Disc diameter for one item (a task, note, photo or message) on the map. */
export const ITEM_NODE = 36;
/** Room under an item's disc for its line or two of title. */
export const ITEM_LABEL_BAND = 26;
/** Diameter of the node that stands in for the rest of a group's items. */
export const MORE_NODE = 32;
/** How many of a group's items the map draws before deferring to "more". */
export const MAX_ITEMS = 12;

/** Clear space between a frame's border and the contents inside it. */
export const FRAME_PAD = 18;
/** The strip along the top of a frame carrying the board's own name and disc. */
export const FRAME_HEADER = 46;
/** Space between two things inside a frame, across and down. */
export const FRAME_GAP = 16;

/** A group's own padding, header strip and internal spacing. */
export const GROUP_PAD = 12;
export const GROUP_HEADER = 28;
export const GROUP_GAP = 12;
/**
 * The strip along the BOTTOM of an open group, carrying its "open in …" button.
 * Reserved by the layout rather than overlaid on the items, because a button
 * drawn on top of the last row of photos is a button you cannot press without
 * pressing a photo.
 */
export const GROUP_FOOTER = 30;
/** Height of a closed group's chip. */
export const CHIP_HEIGHT = 34;

/**
 * The content box an EMPTY board opens into, and the one the busiest board on
 * the map opens into. Everything in between is interpolated by the square root
 * of its share, so the floor grows with area rather than with diameter — the
 * same rule `nodeDiameter` uses, for the same reason.
 */
export const FRAME_FLOOR_MIN = 168;
export const FRAME_FLOOR_MAX = 470;
/** The smallest content box a group opens into. */
export const GROUP_FLOOR = 150;
/**
 * How much wider than tall a frame aims to be. A frame is read on a phone held
 * upright, so a tall narrow one costs more panning than it saves; this biases
 * the row flow towards landscape without ever forcing it.
 */
const FRAME_ASPECT = 1.5;

/**
 * The kinds a board's own contents are grouped into, in the order they are
 * always drawn. Fixed rather than sorted by size: a group that moves when its
 * count changes is a group you have to find again every time.
 *
 * `countKey` is the field in the overview's `counts` block, which is where the
 * numbers come from — so a frame can show every group with no fetch at all.
 */
export const ITEM_GROUPS = [
  {
    kind: 'task',
    countKey: 'tasks',
    label: 'Tasks',
    icon: 'checkbox-marked-circle-outline',
    // Where this kind of thing actually lives, for the group's "open in" button.
    // See BoardLinkContext for the surfaces; a group with no `surface` (chat)
    // simply doesn't offer one, because its home IS the board's own timeline.
    surface: 'tasks',
    surfaceLabel: 'To-do',
  },
  {
    kind: 'note',
    countKey: 'notes',
    label: 'Notes',
    icon: 'note-text-outline',
    surface: 'notes',
    surfaceLabel: 'Notes',
  },
  {
    kind: 'media',
    countKey: 'media',
    label: 'Photos',
    icon: 'image-outline',
    surface: 'photos',
    surfaceLabel: 'the photo vault',
  },
  {
    kind: 'audio',
    countKey: 'audio',
    label: 'Audio',
    icon: 'music-note-outline',
    surface: 'audio',
    surfaceLabel: 'the music player',
  },
  {
    kind: 'chat',
    countKey: 'chat',
    label: 'Chat',
    icon: 'message-text-outline',
  },
];

/** The key a group's open/closed state is held under. */
export const groupKey = (board, kind) => `${board}/${kind}`;

// A chip's width has to be decided HERE, because the layout places it — so it
// is estimated from the label rather than measured, and the renderer is given
// the number and told to fit. Roomy on purpose: over-estimating costs a few
// points of padding, under-estimating truncates a five-letter word.
const CHIP_CHAR = 7.4;
const CHIP_FIXED = 74; // icon + count pill + chevron + padding
const chipWidth = (label, count) => (
  CHIP_FIXED + String(label).length * CHIP_CHAR + String(count).length * CHIP_CHAR
);

/**
 * Flow boxes into rows no wider than `target`, in order.
 *
 * A box wider than the target gets a row to itself rather than being dropped or
 * squeezed — that is a nested frame, and it is allowed to set the width.
 */
function flowRows(boxes, target) {
  const rows = [];
  let row = [];
  let width = 0;
  for (const box of boxes) {
    const added = row.length ? FRAME_GAP + box.w : box.w;
    if (row.length && width + added > target) {
      rows.push({ boxes: row, w: width, h: Math.max(...row.map((b) => b.h)) });
      row = [];
      width = 0;
    }
    row.push(box);
    width += row.length === 1 ? box.w : FRAME_GAP + box.w;
  }
  if (row.length) rows.push({ boxes: row, w: width, h: Math.max(...row.map((b) => b.h)) });
  return rows;
}

/** The content and outer size a given row flow works out to. */
function sizeRows(rows, {
  pad, header, gap, floorW, floorH, footer = 0,
}) {
  const contentW = Math.max(floorW, ...rows.map((r) => r.w));
  const stack = rows.reduce((sum, r) => sum + r.h, 0) + gap * (rows.length - 1);
  const contentH = Math.max(floorH, stack);
  return {
    rows,
    contentW,
    contentH,
    stack,
    w: contentW + pad * 2,
    h: pad + header + gap + contentH + (footer ? gap + footer : 0) + pad,
  };
}

/**
 * Pick the row flow that comes out closest to FRAME_ASPECT.
 *
 * The obvious shortcut — take the square root of the total area, scaled by the
 * aspect — is wrong here, and visibly so: rows are made of whole boxes, so a
 * target of 453pt across boxes 119pt wide fits three of them and wastes the
 * other 96pt. Nine boards came out 378 × 464, portrait, when the whole point of
 * the number was to make it landscape.
 *
 * So try every width that fits a whole number of the boxes actually going in,
 * and keep the best. Scored on the LOG of the aspect ratio so that half as wide
 * and twice as wide are penalised equally; ties go to the earlier (narrower)
 * candidate, which keeps it deterministic. At the sizes a frame ever holds this
 * costs nothing worth measuring.
 */
function bestFlow(boxes, box) {
  const widest = Math.max(...boxes.map((b) => b.w));
  let best = null;
  let target = 0;
  for (let i = 0; i < boxes.length; i += 1) {
    target += (i ? FRAME_GAP : 0) + boxes[i].w;
    const sized = sizeRows(flowRows(boxes, Math.max(widest, target)), box);
    const score = Math.abs(Math.log((sized.w / sized.h) / FRAME_ASPECT));
    if (!best || score < best.score - 1e-9) best = { ...sized, score };
  }
  return best;
}

const emptyBox = ({
  pad, header, gap, floorW, floorH, footer = 0,
}) => ({
  rows: [],
  contentW: floorW,
  contentH: floorH,
  stack: 0,
  w: floorW + pad * 2,
  h: pad + header + gap + floorH + (footer ? gap + footer : 0) + pad,
});

/**
 * Lay the map out.
 *
 * @param tree     a `boardTree` over every board the viewer can see.
 * @param options
 *   roots        board rows to place at the top of the map (the current level).
 *   expanded     Set of board names the user has opened.
 *   openGroups   Set of `groupKey(board, kind)` the user has opened.
 *   itemsOf      (name, kind) => that group's items, newest first, ALREADY
 *                capped to MAX_ITEMS. Returns [] for a group whose contents
 *                have not arrived yet, so the group simply fills when they do.
 *   moreOf       (name, kind) => truthy when the group holds more than those.
 * @returns {{
 *   nodes: Array<{
 *     key, kind, name, board, item, group, count, owner, open, empty, depth,
 *     left, top, w, h, size,
 *   }>,                              // left/top are box corners, origin-centred
 *   width, height,                   // the canvas, padding included
 *   focusX, focusY,                  // the busiest board's centre — where to open
 * }}
 */
export function boardFrameLayout(tree, {
  roots = [],
  expanded = new Set(),
  openGroups = new Set(),
  itemsOf = () => [],
  moreOf = () => 0,
  minSize = MIN_NODE,
  maxSize = MAX_NODE,
  gap = NODE_GAP,
  labelBand = LABEL_BAND,
  padding = CANVAS_PAD,
} = {}) {
  const list = (Array.isArray(roots) ? roots : [])
    .filter((b) => b && typeof b.name === 'string' && b.name.trim());
  if (!list.length) {
    return {
      nodes: [], width: 0, height: 0, focusX: 0, focusY: 0,
    };
  }

  // A board's size comes from its whole subtree, so a folder of busy boards
  // reads as a big thing even with nothing filed directly on it — and the same
  // number ranks it, which is what puts it near the middle of the spiral.
  const heft = (board) => tree.subtreeWeight(board.name);
  const ranked = rankBoards(list, heft);
  const busiest = heft(ranked[0]);

  /** How big this board's frame opens, before its contents get a say. */
  const frameFloor = (board) => {
    if (!(busiest > 0)) return FRAME_FLOOR_MIN;
    const share = Math.min(1, Math.max(0, heft(board) / busiest));
    return FRAME_FLOOR_MIN + (FRAME_FLOOR_MAX - FRAME_FLOOR_MIN) * Math.sqrt(share);
  };

  const groupBox = (group) => ({
    pad: GROUP_PAD,
    header: GROUP_HEADER,
    gap: GROUP_GAP,
    floorW: GROUP_FLOOR,
    floorH: 0,
    // Only the kinds with somewhere to go reserve the strip.
    footer: group.surface ? GROUP_FOOTER : 0,
  });

  // ── 1. Measure ────────────────────────────────────────────────────────────
  // Keys are scoped to the GROUP, not just the board. An id is only unique
  // within its own table, so a task and a photo can share one — and React keys
  // that collide silently drop a node from the map.
  const measureItem = (item, owner, groupKind, depth) => {
    const more = item.kind === 'more';
    const size = more ? MORE_NODE : ITEM_NODE;
    return {
      kind: more ? 'more' : 'item',
      key: `${owner}/${groupKind} ${more ? 'more' : `item:${item.id}`}`,
      item,
      owner,
      groupKind,
      depth,
      size,
      w: size + LABEL_OVERHANG,
      h: size + ITEM_LABEL_BAND,
      rows: null,
    };
  };

  const measureGroup = (owner, group, count, depth) => {
    const open = openGroups.has(groupKey(owner, group.kind));
    const node = {
      kind: 'group',
      key: `group:${owner}/${group.kind}`,
      group,
      count,
      owner,
      depth,
      open,
      empty: false,
      rows: null,
      w: chipWidth(group.label, count),
      h: CHIP_HEIGHT,
    };
    if (!open) return node;

    const items = (itemsOf(owner, group.kind) || [])
      .map((item) => measureItem(item, owner, group.kind, depth + 1));
    if (moreOf(owner, group.kind)) {
      items.push(measureItem({ kind: 'more' }, owner, group.kind, depth + 1));
    }
    const shape = groupBox(group);
    const box = items.length ? bestFlow(items, shape) : emptyBox({ ...shape, floorH: 44 });
    node.empty = !items.length;
    node.rows = box.rows;
    node.contentW = box.contentW;
    node.contentH = box.contentH;
    node.stack = box.stack;
    node.pad = GROUP_PAD;
    node.header = GROUP_HEADER;
    node.gap = GROUP_GAP;
    node.w = box.w;
    node.h = box.h;
    return node;
  };

  const measureBoard = (board, depth) => {
    const { name } = board;
    const size = nodeDiameter(heft(board), busiest, minSize, maxSize);
    const node = {
      kind: 'board',
      key: `board:${name}`,
      name,
      board,
      owner: name,
      depth,
      open: expanded.has(name),
      size,
      w: size + LABEL_OVERHANG,
      h: size + labelBand,
      rows: null,
      empty: false,
    };
    if (!node.open) return node;

    // Sub-boards first, then this board's own contents as one chip per kind:
    // structure before contents, so a frame reads from the outside in.
    const children = rankBoards(tree.childrenOf(name), heft)
      .map((child) => measureBoard(child, depth + 1));
    const counts = board.counts || null;
    if (counts) {
      for (const group of ITEM_GROUPS) {
        const count = Number(counts[group.countKey]) || 0;
        if (count > 0) children.push(measureGroup(name, group, count, depth + 1));
      }
    }

    const floor = frameFloor(board);
    const BOARD_BOX = {
      pad: FRAME_PAD,
      header: FRAME_HEADER,
      gap: FRAME_GAP,
      floorW: floor,
      floorH: floor / FRAME_ASPECT,
    };
    const box = children.length ? bestFlow(children, BOARD_BOX) : emptyBox(BOARD_BOX);
    node.empty = !children.length;
    node.rows = box.rows;
    node.contentW = box.contentW;
    node.contentH = box.contentH;
    node.stack = box.stack;
    node.pad = FRAME_PAD;
    node.header = FRAME_HEADER;
    node.gap = FRAME_GAP;
    node.w = box.w;
    node.h = box.h;
    return node;
  };

  const branches = ranked.map((board) => measureBoard(board, 0));

  // ── 2. Place ──────────────────────────────────────────────────────────────
  const nodes = [];

  const place = (node, left, top) => {
    nodes.push({
      key: node.key,
      kind: node.kind,
      name: node.name,
      board: node.board,
      item: node.item,
      group: node.group,
      groupKind: node.groupKind,
      count: node.count,
      // The board this node belongs to — itself for a board, the board it is
      // inside for a group or an item. Tapping any item means "show me this in
      // its board", so every node knows which board that is without parsing a
      // key apart.
      owner: node.owner,
      open: !!node.open,
      empty: !!node.empty,
      depth: node.depth,
      size: node.size,
      left,
      top,
      w: node.w,
      h: node.h,
    });
    if (!node.rows || !node.rows.length) return;
    // The content block is centred in the content box, which matters because
    // the box has a floor: a busy board's frame is bigger than its contents
    // need, and its contents should sit in the middle of that rather than
    // huddling in the top-left corner of it.
    let y = top + node.pad + node.header + node.gap + (node.contentH - node.stack) / 2;
    for (const row of node.rows) {
      // Rows are centred rather than left-aligned: a last row holding one item
      // hanging off the left edge of a frame reads as a mistake.
      let x = left + node.pad + (node.contentW - row.w) / 2;
      for (const box of row.boxes) {
        place(box, x, y);
        x += box.w + FRAME_GAP;
      }
      y += row.h + node.gap;
    }
  };

  // The spiral has to hold the widest thing on the map, and an open board is a
  // far larger object than a closed one. PACKING is stated in circles, so each
  // box is measured by the circle around it — a safe over-estimate, and the one
  // line that keeps two open frames off each other.
  const reach = (node) => Math.hypot(node.w, node.h) / 2;
  const widestBranch = Math.max(...branches.map(reach));
  const spacing = (2 * widestBranch + gap) / PACKING;
  branches.forEach((branch, i) => {
    const { x, y } = spiralPoint(i, spacing);
    place(branch, x - branch.w / 2, y - branch.h / 2);
  });

  // ── 3. Frame it ───────────────────────────────────────────────────────────
  let minX = Infinity; let maxX = -Infinity;
  let minY = Infinity; let maxY = -Infinity;
  for (const node of nodes) {
    if (node.left < minX) minX = node.left;
    if (node.left + node.w > maxX) maxX = node.left + node.w;
    if (node.top < minY) minY = node.top;
    if (node.top + node.h > maxY) maxY = node.top + node.h;
  }

  // Re-centre on the bounding box so (0, 0) is the canvas's middle rather than
  // wherever the spiral happened to start.
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;
  for (const node of nodes) { node.left -= centreX; node.top -= centreY; }

  const first = nodes[0];
  return {
    nodes,
    width: (maxX - minX) + padding * 2,
    height: (maxY - minY) + padding * 2,
    focusX: first.left + first.w / 2,
    focusY: first.top + first.h / 2,
  };
}

/**
 * Toggle one board's open state, returning a NEW set (the canvas keeps this in
 * React state, so mutating it in place would not re-render).
 *
 * Closing a board also closes everything inside it. Leaving those open would
 * mean re-opening the parent silently unfolds a branch the user shut minutes
 * ago and has forgotten about — a frame should re-open exactly as small as it
 * was closed.
 */
export function toggleExpanded(tree, expanded, name) {
  const next = new Set(expanded);
  if (!next.has(name)) {
    next.add(name);
    return next;
  }
  next.delete(name);
  for (const open of expanded) {
    if (tree.isInside(open, name)) next.delete(open);
  }
  return next;
}

/** Toggle one group inside one board. Same new-set contract as above. */
export function toggleGroup(openGroups, board, kind) {
  const next = new Set(openGroups);
  const key = groupKey(board, kind);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}
