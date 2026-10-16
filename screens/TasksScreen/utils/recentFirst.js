/**
 * Which boards and labels you have touched most recently.
 *
 * A filter panel that lists twenty-six boards alphabetically asks you to read
 * all twenty-six to find the two you are actually working on this week — and
 * the ones you are working on are never the ones beginning with A. "Recent" is
 * the cheap, honest proxy for "yours right now": the latest moment any task on
 * that board (or carrying that label) was made, finished, or given a day.
 *
 * Pure and dependency-free so it can be unit-tested without the screen, and so
 * the panel that renders the chips stays presentational.
 */

/**
 * When was this task last anything?
 *
 * Every stamp the task might carry, whichever is latest — a board whose only
 * task was COMPLETED this morning is more recent than one created last year,
 * and `createdAt` alone would say the opposite. `dueDate` is deliberately NOT
 * in here: a day in the future is not a thing that has happened.
 */
export function taskStamp(t) {
  if (!t) return 0;
  let best = 0;
  for (const v of [t.createdAt, t.updatedAt, t.completedAt]) {
    if (v == null) continue;
    const n = typeof v === 'number' ? v : Date.parse(v);
    if (Number.isFinite(n) && n > best) best = n;
  }
  return best;
}

/**
 * `names`, reordered so the most recently used come first.
 *
 * @param names  the full list, in the order it should fall back to (the
 *               panel's is alphabetical, which is the right tiebreak: a name
 *               nothing has touched has no recency to sort by, and shuffling
 *               those would make the tail of the list move for no reason).
 * @param tasks  every task in hand.
 * @param keysOf (task) => the names it counts towards — one board, or all of
 *               its labels. Returning several is the point for labels.
 *
 * Never mutates `names`, and never invents one: a stamp for a name that is not
 * in the list is dropped, so a task on a deleted board cannot resurrect it.
 */
export function recentFirst(names, tasks, keysOf) {
  const list = Array.isArray(names) ? names : [];
  if (list.length < 2) return [...list];
  const known = new Set(list);
  const stamp = new Map();
  for (const t of tasks || []) {
    const at = taskStamp(t);
    if (!at) continue;
    for (const key of (keysOf?.(t) || [])) {
      if (!known.has(key)) continue;
      if ((stamp.get(key) || 0) < at) stamp.set(key, at);
    }
  }
  // Decorate-sort-undecorate on the INDEX, so names with no stamp at all keep
  // the order they came in rather than being shuffled by an unstable sort.
  return list
    .map((name, i) => ({ name, i, at: stamp.get(name) || 0 }))
    .sort((a, b) => (b.at - a.at) || (a.i - b.i))
    .map((x) => x.name);
}

/**
 * The few chips a section shows before "Show more".
 *
 * Four, which is one wrapped row of chips on a phone and about as many as the
 * eye takes in without reading. Whatever is CURRENTLY PICKED is always among
 * them, wherever it fell in the order: a panel that hides the filter it is
 * applying is a panel that cannot be read, which is the whole reason the
 * heading states its own answer.
 */
export const CHIP_PREVIEW = 4;

export function previewChips(ordered, picked, limit = CHIP_PREVIEW) {
  const list = Array.isArray(ordered) ? ordered : [];
  const keep = new Set(
    (Array.isArray(picked) ? picked : [picked]).filter((p) => typeof p === 'string' && p),
  );
  const head = list.slice(0, limit);
  const missing = [...keep].filter((p) => list.includes(p) && !head.includes(p));
  return [...head, ...missing];
}
