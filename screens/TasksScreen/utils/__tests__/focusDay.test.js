/**
 * A day's focus, and the two questions it cannot answer about itself: was
 * that a lot, and was it a lot FOR A TUESDAY.
 *
 * The arithmetic that has to be right is the context, not the sum — an
 * average that quietly includes today compares the day with itself and
 * flattens every comparison toward "about usual".
 */
import {
  WEEKDAY_NAMES, clockLabel, compareToAverage, focusDayStats, msOfDayKey, ordinal,
} from '../focusDay';

// 2026-11-03 is a TUESDAY. Every date below is chosen off that.
const at = (y, m, d, hh = 9, mm = 0) => new Date(y, m - 1, d, hh, mm, 0).getTime();
const TUE = at(2026, 11, 3, 12);

/** A completed block: started at `ms`, ran `mins`. */
const block = (ms, mins, over = {}) => ({
  id: `p-${ms}-${mins}`,
  status: 'completed',
  startedAt: ms,
  completedAt: ms + mins * 60000,
  durationMinutes: mins,
  ...over,
});

describe('the day itself', () => {
  const sessions = [
    block(at(2026, 11, 3, 9, 0), 25, { taskId: 't1' }),
    block(at(2026, 11, 3, 14, 30), 50, { taskId: 't2' }),
    // An attempt that was not seen through — never a minute, always counted.
    { id: 'x', status: 'cancelled', startedAt: at(2026, 11, 3, 16, 0), taskId: 't1' },
    // Another day entirely.
    block(at(2026, 11, 2, 10, 0), 40, { taskId: 't1' }),
  ];
  const boardOf = (id) => (id === 't1' ? 'Job search' : 'Larkin Architect');
  const stats = () => focusDayStats(sessions, TUE, boardOf);

  test('only the day’s completed blocks are its minutes', () => {
    const s = stats();
    expect(s.minutes).toBe(75);
    expect(s.blocks).toBe(2);
    expect(s.abandoned).toBe(1);
  });

  test('the shape of the day: longest, average, first and last', () => {
    const s = stats();
    expect(s.longest).toBe(50);
    expect(s.average).toBe(38); // 75 / 2, rounded
    expect(new Date(s.firstStart).getHours()).toBe(9);
    expect(new Date(s.lastEnd).getHours()).toBe(15); // 14:30 + 50m
  });

  test('where the time went, heaviest board first', () => {
    const s = stats();
    expect(s.boards.map((b) => [b.name, b.minutes])).toEqual([
      ['Larkin Architect', 50],
      ['Job search', 25],
    ]);
  });

  test('when it happened, by the hour it started', () => {
    const s = stats();
    expect(s.byHour[9]).toBe(25);
    expect(s.byHour[14]).toBe(50);
    expect(s.byHour[10]).toBe(0); // yesterday's block is not this day's
  });

  test('the blocks come back in the order they ran', () => {
    const s = stats();
    expect(s.sessions.map((b) => b.minutes)).toEqual([25, 50]);
    expect(s.sessions[0].board).toBe('Job search');
  });

  test('a task title rides along when the caller can supply one', () => {
    const s = focusDayStats(sessions, TUE, boardOf, (id) => ({ title: `Task ${id}` }));
    expect(s.sessions[0].title).toBe('Task t1');
  });

  test('a day with nothing on it is zeroes, not a crash', () => {
    const s = focusDayStats([], TUE, boardOf);
    expect(s.minutes).toBe(0);
    expect(s.blocks).toBe(0);
    expect(s.firstStart).toBeNull();
    expect(s.weekdayName).toBe('Tuesday');
  });
});

describe('the same weekday, all time', () => {
  // Three Tuesdays and a Wednesday, so the Wednesday must never leak in.
  const sessions = [
    block(at(2026, 11, 3, 9), 75),   // this Tuesday
    block(at(2026, 10, 27, 9), 30),  // Tuesday
    block(at(2026, 10, 20, 9), 90),  // Tuesday
    block(at(2026, 10, 28, 9), 600), // Wednesday — the biggest day on record
  ];
  const s = () => focusDayStats(sessions, TUE);

  test('it counts the Tuesdays and nothing else', () => {
    expect(s().weekday.days).toBe(3);
  });

  // THE ONE THAT MATTERS. Averaging today in compares the day with itself:
  // (75+30+90)/3 = 65, which would call a 75-minute day "15% above average"
  // when against the OTHER Tuesdays (60) it is 25% above.
  test('the average excludes today, or the day is compared with itself', () => {
    expect(s().weekday.averageMinutes).toBe(60);
  });

  test('the best Tuesday is a Tuesday, however big another day was', () => {
    expect(s().weekday.best.minutes).toBe(90);
  });

  test('and this one is placed among them', () => {
    expect(s().weekday.rank).toBe(2); // 90, then 75, then 30
  });

  test('a first-ever Tuesday says so instead of comparing with nothing', () => {
    const only = focusDayStats([block(at(2026, 11, 3, 9), 75)], TUE);
    expect(only.weekday.comparable).toBe(false);
    expect(only.weekday.averageMinutes).toBe(0);
    expect(only.weekday.rank).toBe(1);
  });

  // Ties share the better rank: order of the input must not decide it.
  test('a tie does not depend on which block the server listed first', () => {
    const tied = [block(at(2026, 11, 3, 9), 75), block(at(2026, 10, 27, 9), 75)];
    expect(focusDayStats(tied, TUE).weekday.rank).toBe(1);
    expect(focusDayStats(tied.slice().reverse(), TUE).weekday.rank).toBe(1);
  });
});

describe('every day, all time', () => {
  const sessions = [
    block(at(2026, 11, 3, 9), 75),
    block(at(2026, 10, 28, 9), 600),
    block(at(2026, 10, 27, 9), 30),
  ];
  const s = () => focusDayStats(sessions, TUE);

  test('days with focus, and the total across them', () => {
    expect(s().allTime.days).toBe(3);
    expect(s().allTime.minutes).toBe(705);
  });

  test('the daily average also leaves today out', () => {
    expect(s().allTime.averageMinutes).toBe(315); // (600 + 30) / 2
  });

  test('the best day on record, and where this one places', () => {
    expect(s().allTime.best.minutes).toBe(600);
    expect(s().allTime.rank).toBe(2);
  });

  // A day with no focus has no place in a ranking of days that had some.
  test('an empty day is unranked rather than last', () => {
    const empty = focusDayStats(sessions, at(2026, 11, 4, 12));
    expect(empty.allTime.rank).toBeNull();
    expect(empty.weekday.rank).toBeNull();
  });
});

describe('the words around the numbers', () => {
  test('a comparison is a signed percentage, or nothing honest to say', () => {
    expect(compareToAverage(75, 60)).toBe(25);
    expect(compareToAverage(45, 60)).toBe(-25);
    expect(compareToAverage(0, 60)).toBeNull();
    expect(compareToAverage(75, 0)).toBeNull();
  });

  test('ordinals, including the teens that break the rule', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(13)).toBe('13th');
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(0)).toBe('');
  });

  // `new Date('2026-11-03')` is UTC midnight, which is the 2nd anywhere west
  // of Greenwich — the bug the whole app parses date keys by hand to avoid.
  test('a day key parses to LOCAL midnight, not UTC', () => {
    const ms = msOfDayKey('2026-11-03');
    expect(new Date(ms).getDate()).toBe(3);
    expect(new Date(ms).getHours()).toBe(0);
    expect(msOfDayKey('nonsense')).toBeNull();
    expect(msOfDayKey(null)).toBeNull();
  });

  test('a clock label, and nothing for a non-time', () => {
    expect(clockLabel(at(2026, 11, 3, 9, 5))).toMatch(/9:05/);
    expect(clockLabel(null)).toBe('');
  });

  test('the weekday names line up with getDay()', () => {
    expect(WEEKDAY_NAMES[new Date(TUE).getDay()]).toBe('Tuesday');
  });
});
