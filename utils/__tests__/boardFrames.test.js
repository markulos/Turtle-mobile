/**
 * boardFrames — opening a board turns it into a frame with its contents,
 * grouped by kind, inside.
 *
 * The property everything rests on is that NOTHING EVER OVERLAPS, and it comes
 * from two different places: inside a frame it is the row flow, between frames
 * it is the spiral's spacing. So the bulk of this file is one exhaustive check
 * run over increasingly awkward shapes — and it is stronger than "no overlaps",
 * because a frame whose contents stick out through its own border is the
 * specific failure this whole design exists to avoid. For every pair of boxes,
 * either one CONTAINS the other or they are disjoint. Anything else is a bug.
 *
 * The rest is the two things the grouping buys: a frame that can be drawn from
 * counts alone (so opening a board costs no fetch), and a frame whose size
 * still means how much the board holds even with every group shut.
 */
const { boardTree } = require('../boardTree');
const {
  boardFrameLayout,
  toggleExpanded,
  toggleGroup,
  groupKey,
  ITEM_GROUPS,
  ITEM_NODE,
  MORE_NODE,
  CHIP_HEIGHT,
  FRAME_PAD,
  FRAME_GAP,
  FRAME_HEADER,
  FRAME_FLOOR_MIN,
  FRAME_FLOOR_MAX,
  GROUP_FOOTER,
  GROUP_GAP,
} = require('../boardFrames');

const board = (name, parent = null, counts = {}) => {
  const c = {
    tasks: 0, notes: 0, media: 0, audio: 0, chat: 0, ...counts,
  };
  return {
    name,
    parent,
    counts: c,
    total: c.tasks + c.notes + c.media + c.audio + c.chat,
    lastTs: 0,
  };
};
const item = (id, kind) => ({ id: `${kind}:${id}`, kind, title: `${kind} ${id}` });

// Work ─ Q3 ─ Launch
//     └─ Admin
// Home
const TREE = [
  board('Work', null, { tasks: 12, notes: 3, chat: 5 }),
  board('Q3', 'Work', { tasks: 4 }),
  board('Launch', 'Q3', { media: 9 }),
  board('Admin', 'Work', { notes: 2 }),
  board('Home', null, { media: 40, tasks: 2 }),
];

const build = (rows, {
  open = [], groups = [], items = {}, more = {},
} = {}) => {
  const tree = boardTree(rows);
  return boardFrameLayout(tree, {
    roots: tree.childrenOf(null),
    expanded: new Set(open),
    openGroups: new Set(groups),
    itemsOf: (name, kind) => items[groupKey(name, kind)] || [],
    moreOf: (name, kind) => more[groupKey(name, kind)] || 0,
  });
};

const boards = (map) => map.nodes.filter((n) => n.kind === 'board');
const byName = (map, name) => map.nodes.find((n) => n.kind === 'board' && n.name === name);
const groupsOf = (map, name) => map.nodes.filter((n) => n.kind === 'group' && n.owner === name);
const overlaps = (a, b) => (
  a.left < b.left + b.w && b.left < a.left + a.w
  && a.top < b.top + b.h && b.top < a.top + a.h
);

/**
 * Either one box contains the other, or they are disjoint. Both halves matter:
 * escaping a frame is as wrong as colliding with one.
 */
const expectSoundBoxes = (map, tree) => {
  // Centring a row halves a difference of sums, so an edge sitting exactly on
  // its container's can land a float ULP outside it.
  const E = 1e-9;
  const inside = (child, frame) => (
    child.left >= frame.left - E && child.left + child.w <= frame.left + frame.w + E
    && child.top >= frame.top - E && child.top + child.h <= frame.top + frame.h + E
  );
  const contains = (frame, node) => {
    if (frame.kind === 'board' && frame.open) {
      if (node.kind === 'board') return tree.isInside(node.name, frame.name);
      return node.owner === frame.name || tree.isInside(node.owner, frame.name);
    }
    if (frame.kind === 'group' && frame.open) {
      return (node.kind === 'item' || node.kind === 'more')
        && node.owner === frame.owner && node.groupKind === frame.group.kind;
    }
    return false;
  };
  for (let i = 0; i < map.nodes.length; i += 1) {
    for (let j = i + 1; j < map.nodes.length; j += 1) {
      const a = map.nodes[i];
      const b = map.nodes[j];
      if (contains(a, b)) {
        if (!inside(b, a)) throw new Error(`"${b.key}" is inside "${a.key}" but escapes it`);
        continue;
      }
      if (contains(b, a)) {
        if (!inside(a, b)) throw new Error(`"${a.key}" is inside "${b.key}" but escapes it`);
        continue;
      }
      if (overlaps(a, b)) {
        throw new Error(`"${a.key}" and "${b.key}" overlap, and neither contains the other`);
      }
    }
  }
};

const check = (rows, options) => {
  const map = build(rows, options);
  expectSoundBoxes(map, boardTree(rows));
  return map;
};

/** Every group of every board, open. */
const allGroupKeys = (rows) => rows.flatMap((b) => ITEM_GROUPS
  .filter((g) => b.counts[g.countKey] > 0)
  .map((g) => groupKey(b.name, g.kind)));

const stockItems = (keys, n = 5) => Object.fromEntries(keys.map((key) => {
  const kind = key.slice(key.lastIndexOf('/') + 1);
  return [key, Array.from({ length: n }, (_, i) => item(`${key}-${i}`, kind))];
}));

describe('boardFrameLayout — closed', () => {
  it('is empty for no boards at all', () => {
    expect(build([])).toEqual({
      nodes: [], width: 0, height: 0, focusX: 0, focusY: 0,
    });
  });

  it('draws only the top of the tree until something is opened', () => {
    const map = build(TREE);
    expect(boards(map).map((n) => n.name).sort()).toEqual(['Home', 'Work']);
    expect(map.nodes.every((n) => !n.open)).toBe(true);
  });

  it('drops rows without a usable name', () => {
    const map = build([board('Real', null, { tasks: 3 }), { name: '  ' }, { total: 9 }, null]);
    expect(boards(map).map((n) => n.name)).toEqual(['Real']);
  });

  it('sizes a board by its whole subtree, and ranks it that way too', () => {
    const map = build(TREE);
    // Home holds 42 of its own; Work holds 20 across its whole subtree.
    expect(byName(map, 'Home').size).toBeGreaterThan(byName(map, 'Work').size);
    const home = byName(map, 'Home');
    expect(map.focusX).toBeCloseTo(home.left + home.w / 2, 5);
    expect(map.focusY).toBeCloseTo(home.top + home.h / 2, 5);
  });

  it('centres the map on its own bounding box', () => {
    const map = build(TREE);
    const left = Math.min(...map.nodes.map((n) => n.left));
    const right = Math.max(...map.nodes.map((n) => n.left + n.w));
    const top = Math.min(...map.nodes.map((n) => n.top));
    const bottom = Math.max(...map.nodes.map((n) => n.top + n.h));
    expect((left + right) / 2).toBeCloseTo(0, 5);
    expect((top + bottom) / 2).toBeCloseTo(0, 5);
    expect(map.width).toBeGreaterThan(right - left);
    expect(map.height).toBeGreaterThan(bottom - top);
  });
});

describe('boardFrameLayout — a board opens into a frame', () => {
  it('grows the board into a frame holding its sub-boards', () => {
    const map = build(TREE, { open: ['Work'] });

    expect(boards(map).map((n) => n.name).sort()).toEqual(['Admin', 'Home', 'Q3', 'Work']);
    // Launch is inside Q3, which is still closed — opening one board opens ONE
    // board, not everything under it.
    expect(boards(map).map((n) => n.name)).not.toContain('Launch');
    expect(byName(map, 'Work').open).toBe(true);
  });

  it('puts the contents INSIDE the frame, clear of its border', () => {
    const map = build(TREE, { open: ['Work'] });
    const work = byName(map, 'Work');
    const EPSILON = 1e-9;
    for (const child of map.nodes.filter((n) => n.owner === 'Work' && n !== work)) {
      expect(child.left).toBeGreaterThanOrEqual(work.left + FRAME_PAD - EPSILON);
      expect(child.left + child.w).toBeLessThanOrEqual(work.left + work.w - FRAME_PAD + EPSILON);
      // …and below the header, which is the board's own name and disc.
      expect(child.top).toBeGreaterThanOrEqual(work.top + FRAME_PAD + FRAME_HEADER - EPSILON);
      expect(child.top + child.h).toBeLessThanOrEqual(work.top + work.h - FRAME_PAD + EPSILON);
    }
  });

  it('nests a frame inside a frame, and grows the outer one to hold it', () => {
    const one = build(TREE, { open: ['Work'] });
    const two = build(TREE, { open: ['Work', 'Q3'] });

    expect(byName(two, 'Q3').open).toBe(true);
    expect(byName(two, 'Q3').w).toBeGreaterThan(byName(one, 'Q3').w);
    expect(byName(two, 'Work').h).toBeGreaterThan(byName(one, 'Work').h);
  });

  it('keeps two boards open at once, side by side', () => {
    const map = build(TREE, { open: ['Work', 'Home'] });
    expect(byName(map, 'Work').open).toBe(true);
    expect(byName(map, 'Home').open).toBe(true);
    expect(overlaps(byName(map, 'Work'), byName(map, 'Home'))).toBe(false);
  });

  it('is a pure function of what is open', () => {
    const options = { open: ['Work', 'Q3'], groups: ['Work/task'], items: stockItems(['Work/task']) };
    expect(build(TREE, options).nodes).toEqual(build(TREE, options).nodes);
  });

  it('keeps a frame roughly landscape — a phone is held upright', () => {
    const rows = [board('Hub', null, { tasks: 3 })];
    for (let i = 0; i < 9; i += 1) rows.push(board(`kid-${i}`, 'Hub', { notes: 1 }));
    const hub = byName(build(rows, { open: ['Hub'] }), 'Hub');
    expect(hub.w).toBeGreaterThan(hub.h);
  });
});

describe('boardFrameLayout — contents grouped by kind', () => {
  it('draws one chip per non-empty kind, in a fixed order', () => {
    const map = build(TREE, { open: ['Work'] });
    // Work has tasks, notes and chat but no photos or audio, so there are no
    // chips for those to tap and find nothing behind.
    expect(groupsOf(map, 'Work').map((n) => `${n.group.label}:${n.count}`))
      .toEqual(['Tasks:12', 'Notes:3', 'Chat:5']);
    expect(groupsOf(map, 'Work').every((n) => n.h === CHIP_HEIGHT)).toBe(true);
  });

  it('keeps audio apart from photos — two kinds, two places in the app', () => {
    const rows = [board('Trip', null, { media: 30, audio: 4 })];
    const map = build(rows, { open: ['Trip'] });
    expect(groupsOf(map, 'Trip').map((n) => `${n.group.label}:${n.count}`))
      .toEqual(['Photos:30', 'Audio:4']);
  });

  // Every group but Chat leads somewhere: the surface that actually owns that
  // kind of thing. Chat's home IS the board's own conversation, which every
  // item in it already opens.
  it('names a destination for every kind that has one', () => {
    expect(ITEM_GROUPS.filter((g) => g.surface).map((g) => [g.kind, g.surface]))
      .toEqual([['task', 'tasks'], ['note', 'notes'], ['media', 'photos'], ['audio', 'audio']]);
    expect(ITEM_GROUPS.find((g) => g.kind === 'chat').surface).toBeUndefined();
    // A destination with no words to put on the button is a button that says
    // "Open in undefined".
    for (const group of ITEM_GROUPS.filter((g) => g.surface)) {
      expect(typeof group.surfaceLabel).toBe('string');
      expect(group.surfaceLabel.length).toBeGreaterThan(0);
    }
  });

  it('reserves the strip its "open in" button sits in, and only where there is one', () => {
    const withButton = groupKey('Trip', 'media');
    const without = groupKey('Trip', 'chat');
    const rows = [board('Trip', null, { media: 2, chat: 2 })];
    const items = {
      [withButton]: [item(1, 'media'), item(2, 'media')],
      [without]: [item(1, 'chat'), item(2, 'chat')],
    };
    const map = build(rows, { open: ['Trip'], groups: [withButton, without], items });
    const photos = groupsOf(map, 'Trip').find((n) => n.group.kind === 'media');
    const chat = groupsOf(map, 'Trip').find((n) => n.group.kind === 'chat');
    // Same contents, same rows — the only difference is the footer, and the
    // gap that separates it from the last row (a group flows on GROUP_GAP, not
    // the frame's).
    expect(photos.h - chat.h).toBeCloseTo(GROUP_FOOTER + GROUP_GAP, 5);
  });

  // The counts come from the overview the map already loaded, so a frame is
  // fully drawable with nothing fetched at all.
  it('needs no items to draw the groups', () => {
    const map = build(TREE, { open: ['Work'] });
    expect(map.nodes.filter((n) => n.kind === 'item')).toEqual([]);
    expect(groupsOf(map, 'Work')).toHaveLength(3);
  });

  it('draws no groups for a board whose counts have not arrived', () => {
    // The fast names tier fills only name and parent; a frame opened before the
    // overview lands shows its sub-boards and waits.
    const map = build([{ name: 'Fresh', parent: null }], { open: ['Fresh'] });
    expect(groupsOf(map, 'Fresh')).toEqual([]);
    expect(byName(map, 'Fresh').empty).toBe(true);
  });

  it('opens a group into a frame of that kind\'s items', () => {
    const key = groupKey('Work', 'task');
    const map = build(TREE, {
      open: ['Work'],
      groups: [key],
      items: { [key]: [item(1, 'task'), item(2, 'task')] },
    });

    const group = groupsOf(map, 'Work').find((n) => n.group.kind === 'task');
    expect(group.open).toBe(true);
    expect(group.h).toBeGreaterThan(CHIP_HEIGHT * 2);
    const items = map.nodes.filter((n) => n.kind === 'item');
    expect(items).toHaveLength(2);
    expect(items.every((n) => n.owner === 'Work' && n.groupKind === 'task')).toBe(true);
    expect(items.every((n) => n.size === ITEM_NODE)).toBe(true);
  });

  it('opens one group without opening the others', () => {
    const key = groupKey('Work', 'task');
    const map = build(TREE, { open: ['Work'], groups: [key], items: stockItems([key]) });
    const open = groupsOf(map, 'Work').filter((n) => n.open);
    expect(open.map((n) => n.group.kind)).toEqual(['task']);
  });

  it('closes a full group with a "more" node', () => {
    const key = groupKey('Home', 'media');
    const map = build(TREE, {
      open: ['Home'], groups: [key], items: { [key]: [item(1, 'media')] }, more: { [key]: 1 },
    });
    const more = map.nodes.filter((n) => n.kind === 'more');
    expect(more).toHaveLength(1);
    expect(more[0].owner).toBe('Home');
    expect(more[0].size).toBe(MORE_NODE);
  });

  it('shows an open group whose items have not arrived as an empty group', () => {
    const key = groupKey('Home', 'media');
    const map = build(TREE, { open: ['Home'], groups: [key] });
    const group = groupsOf(map, 'Home').find((n) => n.group.kind === 'media');
    expect(group.open).toBe(true);
    expect(group.empty).toBe(true);
  });

  // An id is only unique within its own table, so a task and a photo can share
  // one. React keys that collide silently drop a node off the map.
  it('gives every node a unique key even when two kinds share an id', () => {
    const rows = [board('A', null, { tasks: 2, media: 2 })];
    const keys = [groupKey('A', 'task'), groupKey('A', 'media')];
    const map = build(rows, {
      open: ['A'],
      groups: keys,
      items: {
        [keys[0]]: [{ id: 'shared-7', kind: 'task', title: 't' }],
        [keys[1]]: [{ id: 'shared-7', kind: 'media', title: 'm' }],
      },
      more: { [keys[0]]: 1, [keys[1]]: 1 },
    });
    const all = map.nodes.map((n) => n.key);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('boardFrameLayout — a frame is as big as the board is busy', () => {
  // Without a floor that scales, a board with four hundred photos and every
  // group shut opens into the same little box as an empty one: four chips, and
  // no sense at all of the weight behind them.
  it('opens a busy board far larger than a quiet one, groups shut either way', () => {
    const map = build(
      [board('Busy', null, { media: 400 }), board('Quiet', null, { tasks: 1 })],
      { open: ['Busy', 'Quiet'] },
    );
    expect(byName(map, 'Busy').w).toBeGreaterThan(byName(map, 'Quiet').w * 1.5);
  });

  it('never opens smaller than the floor, or bigger than the ceiling needs', () => {
    const map = build(
      [board('Busy', null, { media: 400 }), board('Quiet', null, { tasks: 1 })],
      { open: ['Busy', 'Quiet'] },
    );
    expect(byName(map, 'Quiet').w).toBeGreaterThanOrEqual(FRAME_FLOOR_MIN);
    expect(byName(map, 'Busy').w).toBeLessThanOrEqual(FRAME_FLOOR_MAX + FRAME_PAD * 2 + 1);
  });

  it('still grows past the floor when the contents need it', () => {
    const rows = [board('Hub', null, { tasks: 1 })];
    for (let i = 0; i < 24; i += 1) rows.push(board(`kid-${i}`, 'Hub', { notes: 1 }));
    expect(byName(build(rows, { open: ['Hub'] }), 'Hub').w)
      .toBeGreaterThan(FRAME_FLOOR_MAX);
  });

  // Frames nest by ADDING their contents' size, not by multiplying it: eight
  // levels deep is eight paddings and eight headers, not an exponent.
  it('costs a padding and a header per level opened, not a multiple', () => {
    const chain = (depth) => Array.from(
      { length: depth },
      (_, i) => board(`n${i}`, i ? `n${i - 1}` : null, { tasks: 2 }),
    );
    const map = (depth) => {
      const rows = chain(depth);
      return build(rows, { open: rows.map((r) => r.name) });
    };
    const four = map(4);
    const eight = map(8);
    expect(eight.width).toBeGreaterThan(four.width);
    expect(eight.width).toBeLessThan(four.width * 3);
    expect(eight.width).toBeLessThan(6000);
  });
});

describe('boardFrameLayout — every box is either nested or clear', () => {
  it('with the map closed', () => {
    check(TREE);
  });

  it('with every board open and every group shut', () => {
    check(TREE, { open: TREE.map((b) => b.name) });
  });

  it('with every board and every group open', () => {
    const keys = allGroupKeys(TREE);
    check(TREE, {
      open: TREE.map((b) => b.name),
      groups: keys,
      items: stockItems(keys),
      more: Object.fromEntries(keys.map((k) => [k, 1])),
    });
  });

  // One enormous frame beside a closed disc is the case that breaks a top level
  // spaced by disc size rather than by the size of the thing actually drawn.
  it('with one huge frame next to small discs', () => {
    const rows = [
      board('Big', null, { tasks: 20 }),
      board('Small', null, { tasks: 1 }),
      board('Tiny', null, { notes: 1 }),
    ];
    for (let i = 0; i < 12; i += 1) rows.push(board(`kid-${i}`, 'Big', { media: 3 }));
    check(rows, { open: ['Big'] });
  });

  it.each([1, 2, 3, 5, 8, 13, 25, 60])('with a frame holding %i boards', (n) => {
    const rows = [board('Hub', null, { tasks: 3 })];
    for (let i = 0; i < n; i += 1) rows.push(board(`kid-${i}`, 'Hub', { notes: 2 }));
    check(rows, { open: ['Hub'] });
  });

  it.each([1, 3, 8, 12])('with a group holding %i items', (n) => {
    const key = groupKey('Solo', 'media');
    check([board('Solo', null, { media: n })], {
      open: ['Solo'],
      groups: [key],
      items: { [key]: Array.from({ length: n }, (_, i) => item(i, 'media')) },
    });
  });

  it.each([2, 3, 5, 9, 20, 60])('with %i closed boards on the map', (n) => {
    check(Array.from({ length: n }, (_, i) => board(`b${i}`, null, { tasks: 10 })));
  });

  it('down a chain opened all the way to the bottom, groups and all', () => {
    const rows = Array.from(
      { length: 8 },
      (_, i) => board(`n${i}`, i ? `n${i - 1}` : null, { tasks: 3, media: 2 }),
    );
    rows.push(board('bystander', null, { tasks: 40 }));
    const keys = allGroupKeys(rows);
    check(rows, {
      open: rows.map((r) => r.name),
      groups: keys,
      items: stockItems(keys, 2),
    });
  });

  it('leaves the flow gap between two things in the same frame', () => {
    const rows = [
      board('Hub', null, { tasks: 1 }),
      board('a', 'Hub', { tasks: 1 }),
      board('b', 'Hub', { tasks: 1 }),
    ];
    const map = build(rows, { open: ['Hub'] });
    const a = byName(map, 'a');
    const b = byName(map, 'b');
    const between = Math.max(
      b.left - (a.left + a.w),
      a.left - (b.left + b.w),
      b.top - (a.top + a.h),
      a.top - (b.top + b.h),
    );
    expect(between).toBeGreaterThanOrEqual(FRAME_GAP - 0.001);
  });
});

describe('toggleExpanded', () => {
  const tree = boardTree(TREE);

  it('opens a closed board', () => {
    expect([...toggleExpanded(tree, new Set(), 'Work')]).toEqual(['Work']);
  });

  it('returns a new set rather than mutating the one it was given', () => {
    const before = new Set(['Work']);
    const after = toggleExpanded(tree, before, 'Home');
    expect(after).not.toBe(before);
    expect([...before]).toEqual(['Work']);
  });

  // Otherwise re-opening a board silently unfolds a branch the user shut
  // minutes ago and has long forgotten about.
  it('closing a board also closes everything inside it, at any depth', () => {
    const open = new Set(['Work', 'Q3', 'Launch', 'Home']);
    expect([...toggleExpanded(tree, open, 'Work')].sort()).toEqual(['Home']);
  });

  it('leaves boards outside the closed branch alone', () => {
    const open = new Set(['Work', 'Admin', 'Home']);
    expect([...toggleExpanded(tree, open, 'Home')].sort()).toEqual(['Admin', 'Work']);
  });
});

describe('toggleGroup', () => {
  it('round-trips one group of one board', () => {
    const open = toggleGroup(new Set(), 'Work', 'task');
    expect([...open]).toEqual([groupKey('Work', 'task')]);
    expect([...toggleGroup(open, 'Work', 'task')]).toEqual([]);
  });

  it('keys by board AND kind, so two boards\' Tasks are separate', () => {
    let open = toggleGroup(new Set(), 'Work', 'task');
    open = toggleGroup(open, 'Home', 'task');
    expect([...open].sort()).toEqual([groupKey('Home', 'task'), groupKey('Work', 'task')]);
    expect([...toggleGroup(open, 'Work', 'task')]).toEqual([groupKey('Home', 'task')]);
  });

  it('returns a new set rather than mutating the one it was given', () => {
    const before = new Set();
    expect(toggleGroup(before, 'Work', 'task')).not.toBe(before);
    expect(before.size).toBe(0);
  });
});
