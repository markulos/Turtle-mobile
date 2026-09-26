import {
  RANGES, DAY_BANDS, WEEKDAY_LABELS,
  startOfDay, startOfWeek, startOfMonth, startOfYear,
  rangeBounds, rangeSeries, rangeSummaries, longestStreak, focusRecords, focusRangeStats,
} from '../focusRanges';

// A fixed local instant so nothing here depends on the machine's clock.
// 2026-09-26 is a SATURDAY, which makes it a useful "now": the Sunday-start
// week it belongs to began on the 20th, and it is the last day of that week —
// so a week boundary off by one is visible rather than hidden mid-week.
const NOW = new Date(2026, 8, 26, 14, 30, 0).getTime();

/** A completed block at a given local date/time, of a given length. */
const at = (y, m, d, h = 10, min = 0) => new Date(y, m, d, h, min, 0).getTime();
const block = (over = {}) => {
  const startedAt = over.startedAt ?? at(2026, 8, 26);
  const minutes = over.minutes ?? 25;
  return {
    id: over.id || `p-${startedAt}`,
    taskId: over.taskId === undefined ? 't1' : over.taskId,
    startedAt,
    completedAt: over.completedAt === undefined ? startedAt + minutes * 60000 : over.completedAt,
    durationMinutes: 25,
    status: over.status || 'completed',
  };
};

describe('period edges', () => {
  test('a week starts on the Sunday before, at local midnight', () => {
    // Saturday the 26th → Sunday the 20th.
    const from = startOfWeek(NOW);
    const d = new Date(from);
    expect(d.getDay()).toBe(0);
    expect(d.getDate()).toBe(20);
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([0, 0, 0, 0]);
  });

  test('a day/month/year all land on local midnight of their first instant', () => {
    expect(new Date(startOfDay(NOW)).getDate()).toBe(26);
    expect(new Date(startOfDay(NOW)).getHours()).toBe(0);
    expect(new Date(startOfMonth(NOW)).getDate()).toBe(1);
    expect(new Date(startOfMonth(NOW)).getMonth()).toBe(8);
    expect(new Date(startOfYear(NOW)).getMonth()).toBe(0);
    expect(new Date(startOfYear(NOW)).getDate()).toBe(1);
  });

  // A month is not 30 days of milliseconds. Built by epoch arithmetic, the
  // "1st" lands at 11pm on the last of the previous month across a DST edge and
  // files that evening's focus under the wrong month.
  test('month edges are calendar-built, so a 31-day month is 31 days', () => {
    const jul = rangeBounds('month', at(2026, 6, 15));
    expect(new Date(jul.from).getDate()).toBe(1);
    expect(new Date(jul.to).getMonth()).toBe(7);
    expect(new Date(jul.to).getDate()).toBe(1);
    const feb = rangeBounds('month', at(2026, 1, 15));
    expect(new Date(feb.to).getMonth()).toBe(2);
  });
});

describe('rangeBounds', () => {
  test('each period names itself and knows the one before it', () => {
    expect(rangeBounds('week', NOW).label).toBe('This week');
    expect(rangeBounds('month', NOW).label).toBe('September');
    expect(rangeBounds('year', NOW).label).toBe('2026');
    expect(rangeBounds('all', NOW).label).toBe('All time');

    const w = rangeBounds('week', NOW);
    // The previous period ends exactly where this one starts — no gap, no overlap.
    expect(w.prev.to).toBe(w.from);
    expect(new Date(w.prev.from).getDate()).toBe(13);
    expect(rangeBounds('month', NOW).prev.label).toBe('last month');
    expect(new Date(rangeBounds('year', NOW).prev.from).getFullYear()).toBe(2025);
  });

  test('all time has no predecessor to compare with', () => {
    expect(rangeBounds('all', NOW).prev).toBeNull();
    expect(rangeBounds('all', NOW).from).toBe(0);
  });

  test('an unknown range falls back to all time rather than to an empty period', () => {
    expect(rangeBounds('decade', NOW).range).toBe('all');
    expect(rangeBounds(undefined, NOW).range).toBe('all');
  });

  test('to is exclusive: a block at the first instant of the next period is out', () => {
    const w = rangeBounds('week', NOW);
    const list = [block({ startedAt: w.to, id: 'next-week' }), block({ startedAt: w.to - 60000, id: 'this-week' })];
    const s = focusRangeStats(list, 'week', NOW);
    expect(s.blocks).toBe(1);
  });
});

describe('rangeSeries', () => {
  test('a week is seven named day columns, built from the calendar', () => {
    const s = rangeSeries([block({ startedAt: at(2026, 8, 22) })], rangeBounds('week', NOW), NOW);
    expect(s.unit).toBe('day');
    expect(s.points).toHaveLength(7);
    expect(s.points.map((p) => p.label)).toEqual(WEEKDAY_LABELS);
    // Tuesday the 22nd carries the 25; the empty days are still columns.
    expect(s.points[2].minutes).toBe(25);
    expect(s.points.filter((p) => p.minutes === 0)).toHaveLength(6);
  });

  test('a month draws every one of its days, thinning the axis labels', () => {
    const s = rangeSeries([], rangeBounds('month', NOW), NOW);
    expect(s.points).toHaveLength(30);        // September
    expect(s.points[0].label).toBe('1');
    expect(s.points[4].label).toBe('5');
    expect(s.points[1].label).toBe('');       // the 2nd goes unlabelled
  });

  // A half-finished month should LOOK half-finished. The remaining columns are
  // drawn and flagged, so the panel can grey them instead of implying a collapse.
  test('days still to come are drawn and flagged as future', () => {
    const s = rangeSeries([], rangeBounds('month', NOW), NOW);
    expect(s.points.filter((p) => p.future)).toHaveLength(4);   // the 27th–30th
    expect(s.points[25].future).toBe(false);                    // the 26th is today
  });

  test('a year is twelve month columns', () => {
    const s = rangeSeries(
      [block({ startedAt: at(2026, 2, 3), minutes: 40 }), block({ startedAt: at(2026, 2, 9), minutes: 20 })],
      rangeBounds('year', NOW),
      NOW,
    );
    expect(s.unit).toBe('month');
    expect(s.points).toHaveLength(12);
    expect(s.points[2]).toMatchObject({ label: 'Mar', minutes: 60 });
    expect(s.points[9].future).toBe(true);
  });

  test('all time spans the first block to now, and says what it dropped', () => {
    const s = rangeSeries([block({ startedAt: at(2026, 5, 2) })], rangeBounds('all', NOW), NOW);
    // June → September inclusive.
    expect(s.points).toHaveLength(4);
    expect(s.points[0].label).toBe('Jun');
    expect(s.truncated).toBe(0);

    // A hundred columns is a texture, not a chart: the last 24 months only,
    // and the drop is reported rather than silent.
    const old = rangeSeries([block({ startedAt: at(2022, 0, 5) })], rangeBounds('all', NOW), NOW);
    expect(old.points).toHaveLength(24);
    expect(old.truncated).toBeGreaterThan(0);
    // Crossing a year, Januarys carry it so the halves are tellable apart.
    expect(old.points.some((p) => /^'\d\d$/.test(p.label))).toBe(true);
  });

  test('all time with no blocks at all is the current month, not an empty chart', () => {
    const s = rangeSeries([], rangeBounds('all', NOW), NOW);
    expect(s.points).toHaveLength(1);
    expect(s.points[0].label).toBe('Sep');
  });
});

describe('rangeSummaries', () => {
  test('one summary per period, in the order the keys are offered', () => {
    const list = [
      block({ startedAt: at(2026, 8, 26), minutes: 25 }),          // this week
      block({ startedAt: at(2026, 8, 4), minutes: 30, id: 'm' }),  // this month, not this week
      block({ startedAt: at(2026, 2, 4), minutes: 45, id: 'y' }),  // this year, not this month
      block({ startedAt: at(2025, 2, 4), minutes: 60, id: 'o' }),  // last year
    ];
    const s = rangeSummaries(list, NOW);
    expect(s.map((r) => r.range)).toEqual(RANGES);
    expect(s.map((r) => r.minutes)).toEqual([25, 55, 100, 160]);
    expect(s.map((r) => r.blocks)).toEqual([1, 2, 3, 4]);
  });

  // The key says the period's NAME, and adds WHICH one where that is a
  // different sentence. "This week · This week" says nothing twice.
  test('each key names its period, and identifies it only when that adds something', () => {
    const s = rangeSummaries([], NOW);
    expect(s.map((r) => r.title)).toEqual(['This week', 'This month', 'This year', 'All time']);
    expect(s.map((r) => r.label)).toEqual([null, 'September', '2026', null]);
  });

  test('no history is four zeroes, not four blanks', () => {
    expect(rangeSummaries([], NOW).every((r) => r.minutes === 0 && r.blocks === 0)).toBe(true);
  });
});

describe('longestStreak', () => {
  const dayMap = (...keys) => new Map(keys.map((k) => [k, 25]));

  test('it is the longest consecutive run, not the latest one', () => {
    // A 4-day run in the past, a 2-day run now. The record is the 4.
    expect(longestStreak(dayMap(
      '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
      '2026-09-25', '2026-09-26',
    ))).toBe(4);
  });

  test('it counts across month and year boundaries', () => {
    expect(longestStreak(dayMap('2026-08-30', '2026-08-31', '2026-09-01'))).toBe(3);
    expect(longestStreak(dayMap('2025-12-31', '2026-01-01'))).toBe(2);
  });

  test('a day with zero minutes breaks the run instead of extending it', () => {
    const m = new Map([['2026-09-01', 25], ['2026-09-02', 0], ['2026-09-03', 25]]);
    expect(longestStreak(m)).toBe(1);
  });

  test('nothing at all is zero, not one', () => {
    expect(longestStreak(new Map())).toBe(0);
    expect(longestStreak(undefined)).toBe(0);
  });
});

describe('focusRecords', () => {
  test('records are all-time and ignore the period being viewed', () => {
    const r = focusRecords([
      block({ startedAt: at(2025, 0, 6), minutes: 90, id: 'monster' }),
      block({ startedAt: at(2026, 8, 26), minutes: 25 }),
      block({ startedAt: at(2026, 8, 26, 15), minutes: 25, id: 'second-today' }),
    ]);
    expect(r.totalBlocks).toBe(3);
    expect(r.totalMinutes).toBe(140);
    expect(r.activeDays).toBe(2);
    expect(r.longestBlock).toMatchObject({ id: 'monster', minutes: 90 });
    // Today's two blocks add up to 50, which beats the single 90-minute day?
    // No — 50 < 90, so the record day is the one in January.
    expect(r.bestDay.minutes).toBe(90);
    expect(r.firstBlockAt).toBe(at(2025, 0, 6));
  });

  test('abandoned blocks set no records', () => {
    const r = focusRecords([
      block({ startedAt: at(2026, 8, 26), minutes: 200, status: 'cancelled', id: 'walked-away' }),
      block({ startedAt: at(2026, 8, 25), minutes: 25 }),
    ]);
    expect(r.totalBlocks).toBe(1);
    expect(r.longestBlock.minutes).toBe(25);
  });

  test('an empty history reports zeroes and nulls, never NaN', () => {
    const r = focusRecords([]);
    expect(r).toMatchObject({ totalMinutes: 0, totalBlocks: 0, activeDays: 0, longestStreak: 0 });
    expect(r.bestDay).toBeNull();
    expect(r.longestBlock).toBeNull();
    expect(r.firstBlockAt).toBeNull();
  });
});

describe('focusRangeStats', () => {
  // Three this week (Mon 25m, Mon 35m, Sat 25m), one last week.
  const list = [
    block({ startedAt: at(2026, 8, 21, 9), minutes: 25, id: 'mon-a' }),
    block({ startedAt: at(2026, 8, 21, 14), minutes: 35, id: 'mon-b' }),
    block({ startedAt: at(2026, 8, 26, 20), minutes: 25, id: 'sat' }),
    block({ startedAt: at(2026, 8, 16, 9), minutes: 60, id: 'last-week' }),
  ];

  test('the headline figures cover the period and nothing outside it', () => {
    const s = focusRangeStats(list, 'week', NOW);
    expect(s.minutes).toBe(85);
    expect(s.blocks).toBe(3);
    expect(s.activeDays).toBe(2);
    expect(s.averageMinutes).toBe(28);
    expect(s.label).toBe('This week');
  });

  test('it compares against the same period one period back', () => {
    const s = focusRangeStats(list, 'week', NOW);
    expect(s.prev).toMatchObject({ label: 'last week', minutes: 60, blocks: 1 });
    // 85 from 60 is +42%.
    expect(s.prev.deltaPct).toBe(42);
  });

  // "+∞%" is not a figure anyone can read, and neither is "+0%".
  test('a rise from nothing has no percentage', () => {
    const s = focusRangeStats([block({ startedAt: at(2026, 8, 26) })], 'week', NOW);
    expect(s.prev.minutes).toBe(0);
    expect(s.prev.deltaPct).toBeNull();
  });

  test('all time has nothing to compare against', () => {
    expect(focusRangeStats(list, 'all', NOW).prev).toBeNull();
  });

  // The average must divide by the days that have HAPPENED. Dividing
  // September's focus by 30 on the 3rd reports a tenth of the truth.
  test('the daily average divides by the elapsed period, not the whole of it', () => {
    const month = focusRangeStats(list, 'month', NOW);
    expect(month.spanDays).toBe(30);
    expect(month.elapsedDays).toBe(26);         // the 1st through today
    expect(month.perDay).toBe(Math.round(145 / 26));
    // Per day you actually showed up is a different, larger number.
    expect(month.perActiveDay).toBe(Math.round(145 / 3));
    expect(month.showUpPct).toBe(Math.round((3 / 26) * 100));
  });

  test('follow-through counts what was seen through against what was started', () => {
    const withWalkaways = [
      ...list,
      block({ startedAt: at(2026, 8, 24, 9), status: 'cancelled', completedAt: null, id: 'quit-1' }),
    ];
    const s = focusRangeStats(withWalkaways, 'week', NOW);
    expect(s.attempts).toBe(4);
    expect(s.abandoned).toBe(1);
    expect(s.followThroughPct).toBe(75);
  });

  test('a period with nothing started has no follow-through rate to report', () => {
    const s = focusRangeStats([], 'week', NOW);
    expect(s.attempts).toBe(0);
    expect(s.followThroughPct).toBeNull();
    expect(s.best).toBeNull();
    expect(s.longest).toBeNull();
    expect(s.bestWeekday).toBeNull();
    expect(s.peakBand).toBeNull();
    expect(s.minutes).toBe(0);
    expect(s.perDay).toBe(0);
  });

  test('when in the day and when in the week the focus fell', () => {
    const s = focusRangeStats(list, 'week', NOW);
    expect(s.byHour[9]).toBe(25);
    expect(s.byHour[14]).toBe(35);
    expect(s.byHour[20]).toBe(25);
    // Monday holds 60 of the 85, so Monday is the day.
    expect(s.bestWeekday).toBe('Mon');
    expect(s.byWeekday[1].minutes).toBe(60);
    expect(s.byWeekday[6].minutes).toBe(25);
  });

  test('the four bands add up to the whole, and the night band wraps midnight', () => {
    const s = focusRangeStats(list, 'week', NOW);
    expect(s.bands.reduce((a, b) => a + b.minutes, 0)).toBe(s.minutes);
    // 9am's 25 in the morning, 2pm's 35 in the afternoon, 8pm's 25 in the
    // evening — the afternoon has the most of it.
    expect(s.peakBand.key).toBe('afternoon');
    expect(s.bands.map((b) => b.minutes)).toEqual([25, 35, 25, 0]);

    // A 1am block lands in Night, not in Morning.
    const late = focusRangeStats([block({ startedAt: at(2026, 8, 24, 1), minutes: 30 })], 'week', NOW);
    expect(late.peakBand.key).toBe('night');
    expect(DAY_BANDS.find((b) => b.key === 'night').hours).toContain(1);
  });

  test('where the time went, by board, heaviest first', () => {
    const boardOf = (taskId) => (taskId === 't1' ? 'Deep work' : null);
    const s = focusRangeStats(
      [block({ startedAt: at(2026, 8, 26, 9), minutes: 50, taskId: 't1' }),
        block({ startedAt: at(2026, 8, 26, 11), minutes: 20, taskId: null, id: 'loose' })],
      'week', NOW, boardOf,
    );
    expect(s.boards).toEqual([
      { name: 'Deep work', minutes: 50, sessions: 1 },
      { name: 'No Board', minutes: 20, sessions: 1 },
    ]);
  });

  test('the longest block of the period, and the best day of it', () => {
    const s = focusRangeStats(list, 'week', NOW);
    expect(s.longest).toMatchObject({ id: 'mon-b', minutes: 35 });
    expect(s.best.minutes).toBe(60);
    expect(s.best.key).toBe('2026-09-21');
  });

  test('every range carries its own spine', () => {
    for (const range of RANGES) {
      const s = focusRangeStats(list, range, NOW);
      expect(s.series.points.length).toBeGreaterThan(0);
      expect(s.range).toBe(range);
    }
  });

  test('a junk list is an empty period, not a crash', () => {
    for (const junk of [null, undefined, 'nope', [null, {}, { startedAt: 'x' }]]) {
      const s = focusRangeStats(junk, 'week', NOW);
      expect(s.minutes).toBe(0);
      expect(s.blocks).toBe(0);
    }
  });
});
