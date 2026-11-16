import {
  RECENT_LIMIT, SEARCH_LIMIT,
  orderWithPins, prunePins, recentFocusTasks, searchTasks, togglePin,
} from '../focusList';

/**
 * The Focus deck's task list.
 *
 * Mark, 2026-11-16: recent focus tasks under the timer, a search to reach
 * the rest, pinning to the top, and a pin that lets go once the task is
 * done. The rules live away from the component because each of them is the
 * kind of thing that is quietly wrong on a phone and plain in a table.
 */

const TODAY = '2026-11-16';
const task = (id, over = {}) => ({ id, title: `Task ${id}`, completed: false, ...over });
const index = (list) => (id) => list.find((t) => t.id === id) || null;
const block = (taskId, startedAt) => ({ id: `p${taskId}-${startedAt}`, taskId, startedAt });

describe('recentFocusTasks', () => {
  const tasks = [task('a'), task('b'), task('c')];
  const at = index(tasks);

  test('ONE ROW PER TASK, newest first — not one per block', () => {
    // The page already lists recent BLOCKS further down, where an afternoon
    // on one thing is six rows. This is the list you start FROM.
    const sessions = [
      block('a', 100), block('b', 200), block('a', 300), block('c', 50),
    ];
    expect(recentFocusTasks(sessions, at, { todayStr: TODAY }).map((t) => t.id))
      .toEqual(['a', 'b', 'c']);
  });

  test('a FINISHED task is not something to start, so it is not offered', () => {
    const withDone = [task('a'), task('b', { completed: true })];
    const sessions = [block('b', 300), block('a', 200)];
    expect(recentFocusTasks(sessions, index(withDone), { todayStr: TODAY }).map((t) => t.id))
      .toEqual(['a']);
  });

  test('…nor is one that has since been DELETED', () => {
    // The log keeps the id after the task is gone. A row naming nothing has
    // nothing to start.
    const sessions = [block('zz', 300), block('a', 200)];
    expect(recentFocusTasks(sessions, at, { todayStr: TODAY }).map((t) => t.id)).toEqual(['a']);
  });

  test('blocks with no task at all are skipped, not counted as one', () => {
    const sessions = [{ id: 'x', startedAt: 400 }, block('a', 100)];
    expect(recentFocusTasks(sessions, at, { todayStr: TODAY })).toHaveLength(1);
  });

  test('it is a short list — the search is for the rest', () => {
    const many = Array.from({ length: 20 }, (_, i) => task(`t${i}`));
    const sessions = many.map((t, i) => block(t.id, 1000 - i));
    expect(recentFocusTasks(sessions, index(many), { todayStr: TODAY })).toHaveLength(RECENT_LIMIT);
    expect(RECENT_LIMIT).toBeLessThanOrEqual(8);
  });

  test('nothing in, nothing out — and no throw on junk', () => {
    expect(recentFocusTasks(null, at)).toEqual([]);
    expect(recentFocusTasks([], null)).toEqual([]);
    expect(recentFocusTasks([null, undefined], at)).toEqual([]);
  });
});

describe('searchTasks', () => {
  const tasks = [task('a', { title: 'Write the changelog' }), task('b', { title: 'Change the oil' }),
    task('c', { title: 'Done thing', completed: true })];

  test('searches EVERY task, which is the point of having it', () => {
    // The recent list is five rows. The search is how you reach something
    // you have never put a block on.
    expect(searchTasks(tasks, 'chang').map((t) => t.id)).toEqual(['a', 'b']);
  });

  test('case does not matter, and finished work still does not appear', () => {
    expect(searchTasks(tasks, 'DONE')).toEqual([]);
    expect(searchTasks(tasks, 'OIL').map((t) => t.id)).toEqual(['b']);
  });

  test('an empty box is not a search for everything', () => {
    for (const q of ['', '   ', null, undefined]) expect(searchTasks(tasks, q)).toEqual([]);
  });

  test('and it is capped, so one letter cannot fill the panel', () => {
    const many = Array.from({ length: 40 }, (_, i) => task(`t${i}`, { title: `thing ${i}` }));
    expect(searchTasks(many, 'thing')).toHaveLength(SEARCH_LIMIT);
  });
});

describe('orderWithPins', () => {
  const tasks = [task('a'), task('b'), task('c'), task('d')];
  const at = index(tasks);

  test('pinned first, in the order they were pinned', () => {
    const { pinned, rest } = orderWithPins([task('a'), task('b'), task('c')], ['c', 'a'], at, { todayStr: TODAY });
    expect(pinned.map((t) => t.id)).toEqual(['c', 'a']);
    expect(rest.map((t) => t.id)).toEqual(['b']);
  });

  test('A PINNED TASK SHOWS EVEN IF IT IS NOT IN THE LIST', () => {
    // The whole point of pinning something you found by searching: without
    // this it vanishes the moment the box is cleared.
    const { pinned } = orderWithPins([task('a')], ['d'], at, { todayStr: TODAY });
    expect(pinned.map((t) => t.id)).toEqual(['d']);
  });

  test('…but a FINISHED pin does not, which is the unpinning', () => {
    const withDone = [task('a'), task('d', { completed: true })];
    const { pinned, rest } = orderWithPins([task('a')], ['d'], index(withDone), { todayStr: TODAY });
    expect(pinned).toEqual([]);
    expect(rest.map((t) => t.id)).toEqual(['a']);
  });

  test('a task is never in both halves', () => {
    const { pinned, rest } = orderWithPins([task('a'), task('b')], ['a'], at, { todayStr: TODAY });
    expect(pinned.map((t) => t.id)).toEqual(['a']);
    expect(rest.map((t) => t.id)).toEqual(['b']);
  });

  test('the same id pinned twice is still one row', () => {
    const { pinned } = orderWithPins([], ['a', 'a'], at, { todayStr: TODAY });
    expect(pinned.map((t) => t.id)).toEqual(['a']);
  });
});

describe('prunePins', () => {
  test('COMPLETING A TASK UNPINS IT — derived, not an event', () => {
    // Nothing fires "task completed" at this list. The pin is dropped the
    // next time it is built, which is the render after the tick lands.
    const at = index([task('a'), task('b', { completed: true })]);
    expect(prunePins(['a', 'b'], at, { todayStr: TODAY })).toEqual(['a']);
  });

  test('…and so does deleting it', () => {
    expect(prunePins(['a', 'gone'], index([task('a')]), { todayStr: TODAY })).toEqual(['a']);
  });

  test('a recurring task done TODAY counts as done', () => {
    // The app's own test (isTaskDoneNow), so this list agrees with the rest.
    // `meta.completedDates`, which is where the app actually records a
    // recurring tick (taskHelpers.lastCompletedDate) — not a top-level field.
    const rec = task('r', { recurring: 'daily', meta: { completedDates: [TODAY] } });
    expect(prunePins(['r'], index([rec]), { todayStr: TODAY })).toEqual([]);
  });

  test('nothing in, nothing out', () => {
    expect(prunePins(null, () => null)).toEqual([]);
  });
});

describe('togglePin', () => {
  test('on, then off', () => {
    expect(togglePin([], 'a')).toEqual(['a']);
    expect(togglePin(['a'], 'a')).toEqual([]);
  });

  test('a new pin goes to the END, so the first stays the first', () => {
    expect(togglePin(['a'], 'b')).toEqual(['a', 'b']);
  });

  test('it never mutates what it was given', () => {
    const pins = ['a'];
    togglePin(pins, 'b');
    expect(pins).toEqual(['a']);
  });
});
