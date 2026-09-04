/**
 * boardTree — the containment structure behind the Boards canvas.
 *
 * The plain-tree cases are the easy half. The half worth having tests for is
 * what happens when the input is WRONG, because the canvas draws one level at a
 * time and anything the tree quietly loses is a board the user can no longer
 * reach from the map at all. So the load-bearing property throughout is
 * REACHABILITY: whatever the parent pointers say, every board must still turn
 * up somewhere under a walk from the top level.
 */
const { boardTree, pruneTrail, moveTargets } = require('../boardTree');

const board = (name, parent = null, total = 0) => ({ name, parent, total });

/** Every board a walk from the top level actually reaches. */
const reachable = (tree) => {
  const found = [];
  const walk = (parent) => {
    for (const row of tree.childrenOf(parent)) {
      found.push(row.name);
      walk(row.name);
    }
  };
  walk(null);
  return found.sort();
};

// Work ─ Q3 ─ Launch
//     └─ Admin
// Home
const NESTED = [
  board('Work', null, 1),
  board('Q3', 'Work', 2),
  board('Launch', 'Q3', 5),
  board('Admin', 'Work', 3),
  board('Home', null, 7),
];

describe('boardTree — a plain hierarchy', () => {
  const tree = boardTree(NESTED);

  it('puts the parentless boards at the top level', () => {
    expect(tree.childrenOf(null).map((r) => r.name)).toEqual(['Work', 'Home']);
  });

  it('groups each board under the one it names', () => {
    expect(tree.childrenOf('Work').map((r) => r.name)).toEqual(['Q3', 'Admin']);
    expect(tree.childrenOf('Launch')).toEqual([]);
  });

  it('counts the direct children and the whole subtree separately', () => {
    // The disc badge wants "how much is in here", not "how many lids down".
    expect(tree.childCount('Work')).toBe(2);
    expect(tree.descendantCount('Work')).toBe(3);
    expect(tree.descendantCount('Launch')).toBe(0);
  });

  it('rolls a subtree\'s items up into its root, so a folder reads as a big disc', () => {
    expect(tree.subtreeWeight('Work')).toBe(1 + 2 + 5 + 3);
    expect(tree.subtreeWeight('Q3')).toBe(2 + 5);
    expect(tree.subtreeWeight('Launch')).toBe(5);
  });

  it('gives the trail from the top down, inclusive — the breadcrumb bar', () => {
    expect(tree.trailTo('Launch')).toEqual(['Work', 'Q3', 'Launch']);
    expect(tree.trailTo('Home')).toEqual(['Home']);
    expect(tree.trailTo('Nothing')).toEqual([]);
  });

  it('knows containment at any depth, and that nothing contains itself', () => {
    expect(tree.isInside('Launch', 'Work')).toBe(true);
    expect(tree.isInside('Launch', 'Q3')).toBe(true);
    expect(tree.isInside('Home', 'Work')).toBe(false);
    expect(tree.isInside('Work', 'Work')).toBe(false);
    expect(tree.isInside('Work', null)).toBe(false);
  });

  it('flattens depth-first with the depth a picker indents by', () => {
    expect(tree.flatten().map((r) => `${r.depth}:${r.name}`))
      .toEqual(['0:Work', '1:Q3', '2:Launch', '1:Admin', '0:Home']);
  });
});

describe('moveTargets', () => {
  const tree = boardTree(NESTED);

  // The one rule that MUST hold: a board moved into its own descendant takes
  // that whole branch out of the tree, reachable from no root, with no way back
  // short of the database.
  it('offers no destination inside the board being moved', () => {
    expect(moveTargets(tree, 'Work').map((r) => r.name)).toEqual(['Home']);
    expect(moveTargets(tree, 'Q3').map((r) => r.name)).toEqual(['Work', 'Admin', 'Home']);
  });

  it('offers everything else, including the board it is in today', () => {
    expect(moveTargets(tree, 'Launch').map((r) => r.name))
      .toEqual(['Work', 'Q3', 'Admin', 'Home']);
  });

  it('offers nothing at all when there is only one board', () => {
    expect(moveTargets(boardTree([board('Only')]), 'Only')).toEqual([]);
  });
});

describe('boardTree — inputs that would otherwise lose a board', () => {
  it('treats a parent that is not in the list as no parent', () => {
    // Real, not hypothetical: a board shared with me out of the middle of
    // another member's tree names a parent I cannot see.
    const tree = boardTree([board('Shared', 'TheirPrivateBoard'), board('Mine')]);
    expect(tree.parentOf('Shared')).toBeNull();
    expect(reachable(tree)).toEqual(['Mine', 'Shared']);
  });

  it('keeps every board in a cycle reachable, cutting only the closing edge', () => {
    const tree = boardTree([
      { name: 'A', parent: 'B' },
      { name: 'B', parent: 'A' },
      { name: 'C', parent: 'A' },
    ]);
    expect(reachable(tree)).toEqual(['A', 'B', 'C']);
    // C hangs below the cycle and is innocent — it keeps its place rather than
    // being scattered to the top level with the boards that caused the problem.
    expect(tree.parentOf('C')).toBe('A');
  });

  it('resolves a cycle the same way whichever end it meets first', () => {
    const rows = [
      { name: 'A', parent: 'B' },
      { name: 'B', parent: 'A' },
      { name: 'C', parent: 'A' },
    ];
    const shape = (t) => t.flatten().map((r) => `${r.depth}:${r.name}`).sort();
    expect(shape(boardTree(rows.slice().reverse()))).toEqual(shape(boardTree(rows)));
  });

  it('roots a board that claims itself', () => {
    const tree = boardTree([{ name: 'Loop', parent: 'Loop' }]);
    expect(tree.parentOf('Loop')).toBeNull();
    expect(reachable(tree)).toEqual(['Loop']);
  });

  it('drops rows without a usable name, and keeps the first of a duplicate', () => {
    const tree = boardTree([board('X'), null, { name: '  ' }, { total: 3 }, board('X', 'Y')]);
    expect(tree.boards.map((r) => r.name)).toEqual(['X']);
    expect(tree.parentOf('X')).toBeNull();
  });

  it('survives no input at all', () => {
    for (const input of [[], null, undefined, 'nonsense']) {
      const tree = boardTree(input);
      expect(tree.childrenOf(null)).toEqual([]);
      expect(tree.flatten()).toEqual([]);
    }
  });

  // A hierarchy this deep is absurd, but a depth CAP is worse than none: it
  // would sever the chain at the cap and strand everything below it, and which
  // end got severed would depend on index order.
  it('carries a chain far deeper than anyone would build, from either end', () => {
    const chain = Array.from({ length: 300 }, (_, i) => board(`n${i}`, i ? `n${i - 1}` : null, 1));
    for (const rows of [chain, chain.slice().reverse()]) {
      const tree = boardTree(rows);
      expect(tree.childrenOf(null).map((r) => r.name)).toEqual(['n0']);
      expect(tree.trailTo('n299')).toHaveLength(300);
      expect(tree.descendantCount('n0')).toBe(299);
      expect(tree.subtreeWeight('n0')).toBe(300);
    }
  });
});

describe('pruneTrail', () => {
  const tree = boardTree(NESTED);

  it('keeps a trail that still describes the tree', () => {
    expect(pruneTrail(tree, ['Work', 'Q3', 'Launch'])).toEqual(['Work', 'Q3', 'Launch']);
  });

  // The canvas holds its descent as names while the world moves underneath —
  // a board gets renamed on the web app, or deleted from Tasks. Dropping the
  // user to the top level for one bad segment throws away the whole descent.
  it('stops at the first segment that has gone, keeping the rest of the descent', () => {
    expect(pruneTrail(tree, ['Work', 'Deleted', 'Launch'])).toEqual(['Work']);
  });

  it('stops when a segment is no longer inside the one before it', () => {
    // "Home" is real, but it is not in Work — someone moved it out from under us.
    expect(pruneTrail(tree, ['Work', 'Home'])).toEqual(['Work']);
  });

  it('returns the top level for a trail that means nothing any more', () => {
    expect(pruneTrail(tree, ['Gone'])).toEqual([]);
    expect(pruneTrail(tree, [])).toEqual([]);
    expect(pruneTrail(tree, null)).toEqual([]);
  });
});
