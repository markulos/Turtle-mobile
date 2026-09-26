import {
  dayKeyOf, isCompleted, actualMinutes, minutesByDay, focusStreak,
  formatMinutes, recentDays, focusStats, minutesByHour, bestDay,
  chatSessionToBlock, mergeFocusLog,
} from '../focusStats';

const MS_DAY = 86400000;
// A fixed local noon, so nothing here depends on the machine's clock and no
// case sits near a midnight it did not mean to.
const NOON = new Date(2026, 8, 26, 12, 0, 0).getTime(); // 2026-09-26
const at = (dayOffset, hour = 10) => new Date(2026, 8, 26 + dayOffset, hour, 0, 0).getTime();

const block = (over = {}) => ({
  id: 'p1',
  taskId: 't1',
  startedAt: at(0),
  completedAt: at(0) + 25 * 60000,
  durationMinutes: 25,
  status: 'completed',
  ...over,
});

describe('isCompleted', () => {
  // A block that was started and walked away from is not focus the work
  // received, and the page's headline figure must never include it.
  test('only a block seen through counts', () => {
    expect(isCompleted(block())).toBe(true);
    expect(isCompleted(block({ status: 'in_progress', completedAt: null }))).toBe(false);
    expect(isCompleted(block({ status: 'cancelled' }))).toBe(false);
    // Claims completion but never stamped an end — trust the stamp.
    expect(isCompleted(block({ completedAt: null }))).toBe(false);
    expect(isCompleted(null)).toBe(false);
  });
});

describe('actualMinutes', () => {
  // The CLOCK, not the plan. A 25-minute block stopped at 11 is eleven
  // minutes of focus; counting the plan would let a page of abandoned blocks
  // report a perfect day.
  test('it measures what ran, not what was planned', () => {
    expect(actualMinutes(block({ completedAt: at(0) + 11 * 60000 }))).toBe(11);
    expect(actualMinutes(block())).toBe(25);
  });

  test('with no usable stamps it falls back to the planned length', () => {
    expect(actualMinutes(block({ startedAt: null, completedAt: null }))).toBe(25);
    expect(actualMinutes({ durationMinutes: 50 })).toBe(50);
  });

  // A clock that moved, not a block that ran backwards.
  test('an end before its start never reads as negative', () => {
    const b = block({ completedAt: at(0) - 60000 });
    expect(actualMinutes(b)).toBe(25); // falls back rather than going below zero
    expect(actualMinutes({ startedAt: 5, completedAt: 1 })).toBe(0);
  });

  test('nothing at all is zero, not NaN', () => {
    expect(actualMinutes(null)).toBe(0);
    expect(actualMinutes({})).toBe(0);
  });
});

describe('minutesByDay', () => {
  // The day a block BELONGS to is the day it started. A block begun at 11:50pm
  // and finished after midnight is that evening's work, not the next day's.
  test('a block belongs to the day it started', () => {
    const late = new Date(2026, 8, 26, 23, 50, 0).getTime();
    const by = minutesByDay([block({ startedAt: late, completedAt: late + 25 * 60000 })]);
    expect(by['2026-09-26']).toBe(25);
    expect(by['2026-09-27']).toBeUndefined();
  });

  test('it sums a day and ignores what was abandoned', () => {
    const by = minutesByDay([
      block({ id: 'a' }),
      block({ id: 'b', completedAt: at(0) + 10 * 60000 }),
      block({ id: 'c', status: 'cancelled' }),
    ]);
    expect(by[dayKeyOf(at(0))]).toBe(35);
  });

  test('an empty run is an empty map, not a crash', () => {
    expect(minutesByDay([])).toEqual({});
    expect(minutesByDay(null)).toEqual({});
  });
});

describe('focusStreak', () => {
  const byDayOf = (...offsets) => minutesByDay(offsets.map((o, i) => block({ id: `b${i}`, startedAt: at(o), completedAt: at(o) + 25 * 60000 })));

  test('consecutive days count', () => {
    expect(focusStreak(byDayOf(0, -1, -2), NOON)).toBe(3);
  });

  // TODAY IS PENDING, NOT LOST. A streak that dies at midnight punishes you
  // for the hours before you have had a chance to keep it going.
  test('yesterday keeps it alive when today is still empty', () => {
    expect(focusStreak(byDayOf(-1, -2), NOON)).toBe(2);
  });

  test('a day with nothing in it ends it', () => {
    // Today and two days ago, but not yesterday.
    expect(focusStreak(byDayOf(0, -2), NOON)).toBe(1);
  });

  test('nothing recent is no streak', () => {
    expect(focusStreak(byDayOf(-2, -3), NOON)).toBe(0);
    expect(focusStreak({}, NOON)).toBe(0);
  });
});

describe('recentDays', () => {
  // Built from the CALENDAR, not from the data: a day with no focus still has
  // to draw its baseline, because the gaps are the point of the chart.
  test('it always returns the whole span, gaps included', () => {
    const week = recentDays(minutesByDay([block()]), NOON, 7);
    expect(week).toHaveLength(7);
    expect(week.filter((d) => d.minutes === 0)).toHaveLength(6);
  });

  test('oldest first, ending today', () => {
    const week = recentDays({}, NOON, 7);
    expect(week[6].key).toBe('2026-09-26');
    expect(week[0].key).toBe(dayKeyOf(NOON - 6 * MS_DAY));
  });
});

describe('formatMinutes', () => {
  test('under an hour reads in minutes', () => {
    expect(formatMinutes(0)).toBe('0m');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(59)).toBe('59m');
  });

  test('an exact hour drops the minutes rather than printing "1h 00m"', () => {
    expect(formatMinutes(60)).toBe('1h');
    expect(formatMinutes(120)).toBe('2h');
  });

  test('the minutes are padded so the figures line up in a column', () => {
    expect(formatMinutes(65)).toBe('1h 05m');
    expect(formatMinutes(155)).toBe('2h 35m');
  });

  test('rubbish reads as zero, never NaN', () => {
    expect(formatMinutes(null)).toBe('0m');
    expect(formatMinutes(-30)).toBe('0m');
    expect(formatMinutes(undefined)).toBe('0m');
  });
});

describe('focusStats', () => {
  const boardOf = (taskId) => ({ t1: 'Admin', t2: 'Garden' }[taskId] || null);
  const run = [
    block({ id: 'a', taskId: 't1' }),                                        // today, 25, Admin
    block({ id: 'b', taskId: 't2', completedAt: at(0) + 60 * 60000 }),        // today, 60, Garden
    block({ id: 'c', taskId: 't1', startedAt: at(-1), completedAt: at(-1) + 25 * 60000 }), // yesterday
    block({ id: 'd', taskId: 't1', status: 'cancelled' }),                   // abandoned
  ];
  const s = () => focusStats(run, NOON, boardOf);

  test('today is today, and only what was seen through', () => {
    expect(s().todayMinutes).toBe(85);
    expect(s().todaySessions).toBe(2);
  });

  test('the week covers the last seven days', () => {
    expect(s().weekMinutes).toBe(110);
    expect(s().week).toHaveLength(7);
  });

  // Shown so the completed figure above it means something — not as a scold.
  test('abandoned blocks are counted apart, never mixed in', () => {
    expect(s().abandoned).toBe(1);
    expect(s().totalSessions).toBe(3);
    expect(s().totalMinutes).toBe(110);
  });

  test('the average is over completed blocks only', () => {
    expect(s().averageMinutes).toBe(Math.round(110 / 3));
  });

  // The one question the block list cannot answer by itself.
  test('it says where the focus went, heaviest first', () => {
    const boards = s().boards;
    expect(boards[0]).toMatchObject({ name: 'Garden', minutes: 60, sessions: 1 });
    expect(boards[1]).toMatchObject({ name: 'Admin', minutes: 50, sessions: 2 });
  });

  // A block on a task with no board still has to land somewhere, or its time
  // vanishes from a page whose whole job is accounting for it.
  test('a boardless block lands under No Board rather than being dropped', () => {
    const st = focusStats([block({ taskId: 'unknown' })], NOON, boardOf);
    expect(st.boards).toHaveLength(1);
    expect(st.boards[0].name).toBe('No Board');
    expect(st.totalMinutes).toBe(25);
  });

  test('an empty pond reads as zeroes, not as blanks', () => {
    const st = focusStats([], NOON, boardOf);
    expect(st).toMatchObject({
      todayMinutes: 0, todaySessions: 0, weekMinutes: 0, streak: 0,
      totalSessions: 0, totalMinutes: 0, abandoned: 0, averageMinutes: 0,
    });
    expect(st.boards).toEqual([]);
    expect(st.week).toHaveLength(7);
  });

  test('no board lookup at all still aggregates', () => {
    expect(focusStats(run, NOON, null).boards[0].name).toBe('No Board');
  });
});

// ── When, as opposed to how much ────────────────────────────────────────────
describe('minutesByHour', () => {
  test('a block lands in the hour it STARTED', () => {
    const nine = new Date(2026, 8, 26, 9, 50, 0).getTime();
    // Starts at 9:50, runs 25 minutes — so it ends at 10:15, and it is 9am's.
    const by = minutesByHour([block({ startedAt: nine, completedAt: nine + 25 * 60000 })]);
    expect(by[9]).toBe(25);
    expect(by[10]).toBe(0);
  });

  // The night hours are part of the shape. A strip that only covered the hours
  // you have used would rescale itself every time you had an unusual morning.
  test('it is always 24 cells, zeroes and all', () => {
    const by = minutesByHour([]);
    expect(by).toHaveLength(24);
    expect(by.every((m) => m === 0)).toBe(true);
  });

  test('abandoned blocks leave no mark', () => {
    expect(minutesByHour([block({ status: 'cancelled' })]).every((m) => m === 0)).toBe(true);
  });

  test('an unreadable stamp is skipped rather than throwing', () => {
    expect(() => minutesByHour([block({ startedAt: 'nonsense' })])).not.toThrow();
  });
});

describe('bestDay', () => {
  test('the heaviest day on record', () => {
    expect(bestDay({ '2026-09-24': 40, '2026-09-25': 95, '2026-09-26': 20 }))
      .toEqual({ key: '2026-09-25', minutes: 95 });
  });

  // A day of zero is not a record, and nothing at all is not a day.
  test('no focus anywhere is no best day', () => {
    expect(bestDay({})).toBeNull();
    expect(bestDay({ '2026-09-25': 0 })).toBeNull();
    expect(bestDay(null)).toBeNull();
  });
});

describe('focusStats · recent blocks', () => {
  const boardOf = (taskId) => ({ t1: 'Admin' }[taskId] || null);

  test('newest first, capped, and carrying the board', () => {
    const many = Array.from({ length: 9 }, (_, i) => block({
      id: `r${i}`,
      taskId: 't1',
      startedAt: at(-i),
      completedAt: at(-i) + 25 * 60000,
    }));
    const { recent } = focusStats(many, NOON, boardOf);
    expect(recent).toHaveLength(6);
    expect(recent[0].id).toBe('r0');
    expect(recent[0].startedAt).toBeGreaterThan(recent[1].startedAt);
    expect(recent[0].board).toBe('Admin');
    expect(recent[0].minutes).toBe(25);
  });

  // The list is what a single session looks like as itself — an abandoned one
  // was not a session, and showing it here would contradict every figure above.
  test('an abandoned block never reaches the list', () => {
    const { recent } = focusStats([block({ id: 'x', status: 'cancelled' })], NOON, boardOf);
    expect(recent).toEqual([]);
  });
});

describe('chatSessionToBlock', () => {
  const session = (over = {}) => ({
    id: 's1',
    mode: 'focus',
    status: 'completed',
    startedAt: at(0),
    endedAt: at(0) + 25 * 60000,
    totalDuration: 1500,
    ...over,
  });

  test('a completed focus run becomes a completed, taskless block', () => {
    const b = chatSessionToBlock(session());
    expect(b).toMatchObject({ id: 's1', taskId: null, status: 'completed', durationMinutes: 25 });
    expect(isCompleted(b)).toBe(true);
    expect(actualMinutes(b)).toBe(25);
  });

  // A break is time spent NOT focusing. Letting it in would put it in the
  // totals, the streak and the board split.
  test('a break is not a focus block', () => {
    expect(chatSessionToBlock(session({ mode: 'break' }))).toBeNull();
  });

  test('a stopped run becomes cancelled — the task store\'s word for the same thing', () => {
    const b = chatSessionToBlock(session({ status: 'stopped' }));
    expect(b.status).toBe('cancelled');
    expect(b.completedAt).toBeNull();
    expect(isCompleted(b)).toBe(false);
  });

  test('junk is dropped rather than turned into a block with NaN in it', () => {
    expect(chatSessionToBlock(null)).toBeNull();
    expect(chatSessionToBlock({ mode: 'focus', startedAt: 'soon' })).toBeNull();
  });
});

describe('mergeFocusLog', () => {
  const session = (over = {}) => ({
    id: 's1', mode: 'focus', status: 'completed',
    startedAt: at(0), endedAt: at(0) + 25 * 60000, totalDuration: 1500, ...over,
  });

  test('a loose block the task store cannot hold still reaches the page', () => {
    const merged = mergeFocusLog([], [session({ id: 'loose' })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'loose', taskId: null });
  });

  // Starting from a TASK writes both rows. Concatenating would double every
  // figure on the page.
  test('one block written to both stores is counted once, keeping the task copy', () => {
    const taskRow = block({ id: 'task-copy', startedAt: at(0) + 700 });
    const merged = mergeFocusLog([taskRow], [session({ id: 'chat-copy', startedAt: at(0) })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('task-copy');
    expect(merged[0].taskId).toBe('t1');
  });

  test('two genuinely separate blocks are both kept', () => {
    const taskRow = block({ id: 'morning', startedAt: at(0, 9) });
    const merged = mergeFocusLog([taskRow], [session({ id: 'evening', startedAt: at(0, 20) })]);
    expect(merged).toHaveLength(2);
  });

  test('the result is newest first, so `recent` reads correctly off it', () => {
    const merged = mergeFocusLog(
      [block({ id: 'old', startedAt: at(-3) })],
      [session({ id: 'new', startedAt: at(0) })],
    );
    expect(merged.map((b) => b.id)).toEqual(['new', 'old']);
  });

  test('either store being absent or junk is an empty side, not a crash', () => {
    expect(mergeFocusLog(null, null)).toEqual([]);
    expect(mergeFocusLog([block()], undefined)).toHaveLength(1);
    expect(mergeFocusLog(undefined, [session()])).toHaveLength(1);
    expect(mergeFocusLog([null, block()], [null])).toHaveLength(1);
  });

  // The whole point of the merge: the stats must see a Focus-tab session.
  test('a loose block lands in the figures it should', () => {
    const stats = focusStats(
      mergeFocusLog([], [session({ startedAt: at(0), totalDuration: 1500 })]),
      NOON,
      // A loose block has no task, so the lookup finds nothing and it lands in
      // No Board — the same answer the screen's real resolver gives for a null id.
      (id) => (id === 't1' ? 'Admin' : null),
    );
    expect(stats.todayMinutes).toBe(25);
    expect(stats.todaySessions).toBe(1);
    expect(stats.boards).toEqual([{ name: 'No Board', minutes: 25, sessions: 1 }]);
  });
});
