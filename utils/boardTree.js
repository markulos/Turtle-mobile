/**
 * boardTree — the containment structure behind the Boards canvas.
 *
 * A board can live INSIDE another board, arbitrarily deep. The server stores
 * that as one nullable `parent` name per board; everything the canvas needs to
 * navigate it (who is at this level, what is the trail back to the top, how
 * much is under this disc, where may this board legally be moved) is derived
 * here, once, from that flat list.
 *
 * Kept free of react-native imports on purpose — same rule as `boardCanvasLayout`
 * and `zoomMath`. This is plain data, so it is unit-testable without rendering.
 *
 * Two hostile inputs shape the whole module, because both arrive in practice:
 *
 *   • A DANGLING parent — a board whose parent isn't in the list. That happens
 *     for real, not just through corruption: a board shared with me out of the
 *     middle of someone else's tree carries a parent I can't see. The board must
 *     still be reachable, so a parent that doesn't resolve is no parent at all
 *     and the board sits at the top level.
 *
 *   • A CYCLE. The server refuses to create one, but a restored backup or a
 *     hand-edited row can still produce it, and a cycle is uniquely nasty here:
 *     every board in the loop is somebody's child, so NO root lists them and
 *     they vanish from the canvas completely — with no way back short of the
 *     database. Boards in a cycle are therefore promoted to the top level. A
 *     visible board in the wrong place beats an invisible one.
 *
 * Both rules share a single implementation: a parent is only honoured if
 * walking up from it actually terminates at a root.
 */

import { boardWeight } from './boardCanvasLayout';

const usableName = (board) => (
  board && typeof board.name === 'string' && board.name.trim() ? board.name : null
);

/**
 * Index a flat board list into the tree the canvas navigates.
 *
 * @param boards  rows as /projects-overview returns them — `{ name, parent,
 *                counts, total, lastTs, latest }` — or the bare `{ name, parent }`
 *                rows from the fast tree tier. Anything without a usable name is
 *                dropped, and the first row wins on a duplicate name.
 * @returns {{
 *   boards: object[],                    // the accepted rows, input order
 *   has: (name) => boolean,
 *   get: (name) => object|undefined,
 *   parentOf: (name) => string|null,     // resolved: dangling/cyclic → null
 *   childrenOf: (name|null) => object[], // null = the top level
 *   childCount: (name|null) => number,
 *   descendantCount: (name) => number,   // every board below, all depths
 *   subtreeWeight: (name) => number,     // own items + everything below
 *   trailTo: (name) => string[],         // top-level → …→ name, inclusive
 *   isInside: (name, ancestor) => boolean,
 *   flatten: () => Array<{ name, depth, board }>,  // depth-first, for pickers
 * }}
 */
export function boardTree(boards) {
  const rows = (Array.isArray(boards) ? boards : []).filter(usableName);

  const byName = new Map();
  for (const row of rows) {
    if (!byName.has(row.name)) byName.set(row.name, row);
  }
  const accepted = [...byName.values()];

  // Resolve every parent pointer ONCE. `raw` is what a row claims; `parent` is
  // what we honour — a claim to a board that isn't here is dropped, and a claim
  // that closes a loop is dropped at exactly the edge that closes it.
  //
  // Walk UP from each unresolved board, colouring the chain as we go, and stop
  // at the first board that is already settled, has no parent, or is coloured
  // by THIS walk. That last case is the cycle, and the board we landed back on
  // is the one whose pointer goes: the loop opens into a chain and everything
  // hanging below it keeps its shape. (The obvious alternative — "walk up, and
  // if anything repeats, root the board we started from" — condemns every
  // innocent board below a cycle too, scattering a whole subtree across the top
  // level.)
  //
  // Iterative rather than recursive, and with no depth cap, because both of
  // those turn out to be correctness issues rather than style: a cap makes the
  // result depend on which board the loop happened to visit first (the deep end
  // of a chain gets severed, the shallow end doesn't), and recursion on a chain
  // this walks in full would put the tree's depth on the JS stack.
  const parent = new Map();
  const state = new Map(); // name → 'visiting' | 'done'
  const rawParentOf = (name) => {
    const claimed = byName.get(name)?.parent;
    return typeof claimed === 'string' && claimed.trim() && byName.has(claimed) ? claimed : null;
  };
  for (const start of byName.keys()) {
    if (state.has(start)) continue;
    const chain = [];
    let cursor = start;
    while (cursor && !state.has(cursor)) {
      state.set(cursor, 'visiting');
      chain.push(cursor);
      cursor = rawParentOf(cursor);
    }
    // Landing back on a board this same walk is still resolving is the only way
    // a cycle can present. Cut it there.
    if (cursor && state.get(cursor) === 'visiting') {
      parent.set(cursor, null);
      state.set(cursor, 'done');
    }
    for (const name of chain) {
      if (state.get(name) === 'done') continue; // the back-edge we just cut
      parent.set(name, rawParentOf(name));
      state.set(name, 'done');
    }
  }

  // Children, bucketed by resolved parent. The `null` bucket is the top level.
  // Input order is preserved inside each bucket — the canvas layout does its
  // own ranking, and a picker wants a stable order rather than a re-sorted one.
  const children = new Map([[null, []]]);
  for (const row of accepted) {
    const key = parent.get(row.name);
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(row);
  }

  const childrenOf = (name) => children.get(name ?? null) || [];

  // Subtree rollups, memoised: a canvas with a deep tree asks for these once
  // per node per layout, and each answer is the sum of the answers below it.
  const weightCache = new Map();
  const countCache = new Map();
  const subtreeWeight = (name) => {
    if (weightCache.has(name)) return weightCache.get(name);
    // Seeded before recursing so a cycle that somehow survived resolution
    // terminates at 0 instead of overflowing the stack.
    weightCache.set(name, 0);
    const total = childrenOf(name).reduce(
      (sum, child) => sum + subtreeWeight(child.name),
      boardWeight(byName.get(name)),
    );
    weightCache.set(name, total);
    return total;
  };
  const descendantCount = (name) => {
    if (countCache.has(name)) return countCache.get(name);
    countCache.set(name, 0);
    const total = childrenOf(name).reduce(
      (sum, child) => sum + 1 + descendantCount(child.name),
      0,
    );
    countCache.set(name, total);
    return total;
  };

  // Both walks below are unbounded on purpose: `parent` is acyclic by
  // construction above, so there is no loop left for a cap to protect against —
  // and a cap would silently truncate a legitimately deep hierarchy instead.
  const trailTo = (name) => {
    if (!byName.has(name)) return [];
    const trail = [name];
    let cursor = parent.get(name);
    while (cursor) {
      trail.unshift(cursor);
      cursor = parent.get(cursor);
    }
    return trail;
  };

  const isInside = (name, ancestor) => {
    if (!ancestor || name === ancestor) return false;
    let cursor = parent.get(name);
    while (cursor) {
      if (cursor === ancestor) return true;
      cursor = parent.get(cursor);
    }
    return false;
  };

  const flatten = () => {
    const out = [];
    const walk = (parentName, depth) => {
      for (const row of childrenOf(parentName)) {
        out.push({ name: row.name, depth, board: row });
        walk(row.name, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  };

  return {
    boards: accepted,
    has: (name) => byName.has(name),
    get: (name) => byName.get(name),
    parentOf: (name) => parent.get(name) ?? null,
    childrenOf,
    childCount: (name) => childrenOf(name).length,
    descendantCount,
    subtreeWeight,
    trailTo,
    isInside,
    flatten,
  };
}

/**
 * The deepest still-valid prefix of a navigation trail.
 *
 * The canvas remembers where you drilled to as a list of board names, and that
 * list can go stale under it — a board is renamed on the web app, deleted from
 * Tasks, or moved out from under the one you are standing in. Rather than
 * bouncing you to the top level (losing the whole descent for one bad segment),
 * this keeps everything up to the first segment that no longer holds.
 */
export function pruneTrail(tree, trail) {
  const kept = [];
  for (const name of Array.isArray(trail) ? trail : []) {
    if (!tree.has(name)) break;
    // Each step must still be a child of the step before it, or the trail is
    // describing a containment that no longer exists.
    if (tree.parentOf(name) !== (kept.length ? kept[kept.length - 1] : null)) break;
    kept.push(name);
  }
  return kept;
}

/**
 * Where `name` may be moved to: every board except itself and everything
 * already inside it (which would close a loop), plus its current parent marked
 * so the picker can show where it stands today.
 *
 * Returns the flattened depth-first order, so a picker can indent straight from
 * `depth` and read as the tree it is choosing from.
 */
export function moveTargets(tree, name) {
  return tree.flatten().filter((row) => row.name !== name && !tree.isInside(row.name, name));
}
