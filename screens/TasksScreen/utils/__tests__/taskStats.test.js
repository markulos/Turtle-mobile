import { taskStats, dayKey, daysBetween, lastDays, currentStreak } from '../taskStats';

const TODAY = '2026-09-15';
/** Local noon, so a bucket key can never be dragged into a neighbouring day. */
const at = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).getTime();
};

const task = (over = {}) => ({
  id: String(Math.random()), title: 'A task', itemType: 'task', completed: false,
  project: 'Inbox', tags: [], ...over,
});
const doneOn = (ymd, over = {}) => task({ completed: true, completedAt: at(ymd), ...over });

describe('day maths', () => {
  test('dayKey is the LOCAL day, not a UTC slice', () => {
    // 11pm local on the 15th belongs to the 15th, whatever UTC thinks.
    expect(dayKey(new Date(2026, 8, 15, 23, 30))).toBe('2026-09-15');
    expect(dayKey(new Date(2026, 8, 15, 0, 10))).toBe('2026-09-15');
    expect(dayKey(NaN)).toBeNull();
  });

  test('daysBetween counts whole days either way', () => {
    expect(daysBetween('2026-09-10', '2026-09-15')).toBe(5);
    expect(daysBetween('2026-09-15', '2026-09-15')).toBe(0);
    expect(daysBetween('2026-09-20', '2026-09-15')).toBe(-5);
    expect(daysBetween('nonsense', '2026-09-15')).toBeNull();
  });

  test('lastDays ends on today, oldest first, and crosses a month boundary', () => {
    expect(lastDays('2026-09-02', 4)).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  });
});

describe('currentStreak', () => {
  const map = (days) => new Map(days.map((d) => [d, 1]));

  test('counts back from today', () => {
    expect(currentStreak(map(['2026-09-15', '2026-09-14', '2026-09-13']), TODAY)).toBe(3);
  });

  test('yesterday keeps it alive — a streak is not broken at 00:01', () => {
    expect(currentStreak(map(['2026-09-14', '2026-09-13']), TODAY)).toBe(2);
  });

  test('a two-day gap ends it', () => {
    expect(currentStreak(map(['2026-09-13', '2026-09-12']), TODAY)).toBe(0);
    expect(currentStreak(new Map(), TODAY)).toBe(0);
  });

  test('it stops at the first empty day, it does not count every day ever', () => {
    expect(currentStreak(map(['2026-09-15', '2026-09-13', '2026-09-12']), TODAY)).toBe(1);
  });
});

describe('taskStats', () => {
  test('counts tasks only — events and birthdays are not work', () => {
    const s = taskStats([
      task(), doneOn('2026-09-15'),
      { id: 'e', itemType: 'event', title: 'Dinner', completed: false },
      { id: 'b', itemType: 'birthday', title: 'Mum', completed: false },
    ], TODAY);
    expect(s.total).toBe(2);
    expect(s.done).toBe(1);
    expect(s.open).toBe(1);
    expect(s.completionPct).toBe(50);
  });

  test('late is open AND past due, never a completed one', () => {
    const s = taskStats([
      task({ dueDate: '2026-09-01' }),                       // late
      task({ dueDate: '2026-09-15' }),                       // today, not late
      task({ dueDate: '2026-12-01' }),                       // future
      doneOn('2026-09-15', { dueDate: '2026-01-01' }),       // done, never late
    ], TODAY);
    expect(s.late).toBe(1);
    expect(s.oldestOpen).toMatchObject({ dueDate: '2026-09-01', daysLate: 14 });
  });

  test('completions with no date are REPORTED, not silently dropped', () => {
    // The charts can only place what carries a completedAt; the panel says so.
    const s = taskStats([
      doneOn('2026-09-15'),
      task({ completed: true }),          // finished before completedAt existed
      task({ completed: true }),
    ], TODAY);
    expect(s.done).toBe(3);
    expect(s.datedCompletions).toBe(1);
    expect(s.undatedDone).toBe(2);
  });

  test('the heatmap is one cell per day, ending today', () => {
    const s = taskStats([doneOn('2026-09-15'), doneOn('2026-09-15'), doneOn('2026-09-10')], TODAY, { heatmapDays: 7 });
    expect(s.heat).toHaveLength(7);
    expect(s.heat[s.heat.length - 1]).toEqual({ day: '2026-09-15', count: 2 });
    expect(s.heat[0]).toEqual({ day: '2026-09-09', count: 0 });
    expect(s.heatMax).toBe(2);
    expect(s.busiestDay).toMatchObject({ day: '2026-09-15', count: 2 });
  });

  test('weekly buckets are 7 days each, oldest first, and sum the days inside', () => {
    const s = taskStats(
      [doneOn('2026-09-15'), doneOn('2026-09-14'), doneOn('2026-09-08')],
      TODAY,
      { weeks: 2 },
    );
    expect(s.weeks).toHaveLength(2);
    expect(s.weeks[1]).toMatchObject({ end: '2026-09-15', count: 2 });
    expect(s.weeks[0]).toMatchObject({ start: '2026-09-02', count: 1 });
    expect(s.weekMax).toBe(2);
  });

  test('the weekday profile names the best day', () => {
    // 2026-09-14 is a Monday; 09-15 a Tuesday.
    const s = taskStats([doneOn('2026-09-14'), doneOn('2026-09-14'), doneOn('2026-09-15')], TODAY);
    expect(s.bestWeekday).toMatchObject({ label: 'Mon', count: 2 });
    expect(s.weekdays).toHaveLength(7);
  });

  test('boards rank by OPEN work and fold the tail into one Other', () => {
    const s = taskStats([
      ...Array.from({ length: 3 }, () => task({ project: 'Big' })),
      ...Array.from({ length: 2 }, () => task({ project: 'Mid' })),
      task({ project: 'A' }), task({ project: 'B' }), task({ project: 'C' }),
      doneOn('2026-09-15', { project: 'Big' }),   // done work is not open work
    ], TODAY, { topBoards: 2 });

    expect(s.boards[0]).toMatchObject({ name: 'Big', count: 3 });
    expect(s.boards[1]).toMatchObject({ name: 'Mid', count: 2 });
    expect(s.boards[2]).toMatchObject({ name: '__other__', count: 3, otherOf: 3 });
    expect(s.boardMax).toBe(3);
  });

  test('an empty list produces zeros, not NaN or a crash', () => {
    const s = taskStats([], TODAY);
    expect(s).toMatchObject({
      total: 0, done: 0, open: 0, late: 0, completionPct: 0,
      streak: 0, busiestDay: null, bestWeekday: null, oldestOpen: null, weekAverage: 0,
    });
    expect(s.heat.every((c) => c.count === 0)).toBe(true);
    expect(taskStats(null, TODAY).total).toBe(0);
  });

  test('a recurring task ticked for today counts as done', () => {
    const s = taskStats([
      task({ recurring: 'daily', meta: { completedDates: [TODAY] } }),
    ], TODAY);
    expect(s.done).toBe(1);
    expect(s.open).toBe(0);
  });
});
