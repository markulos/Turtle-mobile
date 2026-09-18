import { buildCompactRows, gapHourMarks, gapKey, MIN_GAP_MINUTES, DAY_START, DAY_END } from '../compactSchedule';

const seg = (start, end, id = `${start}`) => ({ start, end, task: { id, title: `t${id}` } });
const kinds = (rows) => rows.map((r) => r.kind);
// Every day now opens with a gap back to midnight and closes with one running
// to it (see "the ends of the day"), so the tests about what happens BETWEEN
// tasks read the middle.
const middle = (rows) => kinds(rows.filter((r) => !r.edge));

describe('buildCompactRows', () => {
  // A day with nothing on it is the whole day as one gap — the same row a
  // stretch between two tasks is, spanning midnight to midnight. It used to be
  // no rows at all, which left the panel with nothing to draw.
  test('a day with nothing on it is ONE gap, midnight to midnight', () => {
    const empty = [{ kind: 'gap', minutes: DAY_END, from: DAY_START, to: DAY_END, edge: 'day' }];
    expect(buildCompactRows([])).toEqual(empty);
    expect(buildCompactRows(null)).toEqual(empty);
    expect(buildCompactRows(undefined)).toEqual(empty);
  });

  test('that one gap opens into the whole day, hour by hour', () => {
    const [day] = buildCompactRows([]);
    expect(gapHourMarks(day.from, day.to)).toHaveLength(24);
    expect(gapKey(day)).toBe('gap-0-1440');
  });

  // 'day' rather than 'start'/'end': it is neither end of anything, it is the
  // whole of it, and a caller asking "is this a stretch BETWEEN tasks" must not
  // get a yes for a day with no tasks in it.
  test('marks the empty day so it reads as neither end nor middle', () => {
    expect(buildCompactRows([])[0].edge).toBe('day');
    expect(buildCompactRows([seg(480, 540)]).some((r) => r.edge === 'day')).toBe(false);
  });

  test('a single task is one row, between the two ends of the day', () => {
    expect(middle(buildCompactRows([seg(480, 540)]))).toEqual(['task']);
    expect(kinds(buildCompactRows([seg(480, 540)]))).toEqual(['gap', 'task', 'gap']);
  });

  test('puts exactly ONE gap row between two tasks, whatever the distance', () => {
    // 8:00–9:00 then 14:00. The old hour-walking model emitted five rows here.
    const rows = buildCompactRows([seg(480, 540), seg(840, 900)]);
    expect(middle(rows)).toEqual(['task', 'gap', 'task']);
    expect(rows.find((r) => r.kind === 'gap' && !r.edge)).toMatchObject({ minutes: 300, from: 540, to: 840 });
  });

  test('sorts by start, so the caller need not', () => {
    const rows = buildCompactRows([seg(840, 900, 'late'), seg(480, 540, 'early')]);
    expect(rows.filter((r) => r.kind === 'task').map((r) => r.seg.task.id)).toEqual(['early', 'late']);
  });

  test('back-to-back tasks get no gap row', () => {
    expect(middle(buildCompactRows([seg(480, 540), seg(540, 600)]))).toEqual(['task', 'task']);
  });

  test('swallows a gap too short to be worth a row', () => {
    const rows = buildCompactRows([seg(480, 540), seg(540 + MIN_GAP_MINUTES - 1, 600)]);
    expect(middle(rows)).toEqual(['task', 'task']);
  });

  test('keeps a gap that exactly meets the threshold', () => {
    const rows = buildCompactRows([seg(480, 540), seg(540 + MIN_GAP_MINUTES, 600)]);
    expect(middle(rows)).toEqual(['task', 'gap', 'task']);
    expect(rows.find((r) => r.kind === 'gap' && !r.edge).minutes).toBe(MIN_GAP_MINUTES);
  });

  test('overlapping tasks are not a gap', () => {
    // Two things at once; the arithmetic goes negative and must not surface.
    expect(middle(buildCompactRows([seg(480, 600), seg(510, 570)]))).toEqual(['task', 'task']);
  });

  // The subtle one: a long task with a short one nested inside it. The gap
  // after them is measured from the LONG task's end, not from whichever task
  // happened to be last in the list.
  test('measures the gap from the furthest point covered, not the previous row', () => {
    const rows = buildCompactRows([seg(480, 720, 'long'), seg(510, 540, 'nested'), seg(780, 840, 'after')]);
    expect(middle(rows)).toEqual(['task', 'task', 'gap', 'task']);
    expect(rows.find((r) => r.kind === 'gap' && !r.edge)).toMatchObject({ minutes: 60, from: 720, to: 780 });
  });

  test('ignores segments with no usable start', () => {
    const rows = buildCompactRows([seg(480, 540), { start: null }, { nope: true }, seg(840, 900)]);
    expect(middle(rows)).toEqual(['task', 'gap', 'task']);
  });

  test('treats a missing end as a zero-length point rather than dropping it', () => {
    const rows = buildCompactRows([{ start: 480, task: { id: 'a' } }, seg(600, 660)]);
    expect(middle(rows)).toEqual(['task', 'gap', 'task']);
    expect(rows.find((r) => r.kind === 'gap' && !r.edge)).toMatchObject({ from: 480, to: 600, minutes: 120 });
  });
});

describe('gapHourMarks', () => {
  test('lists one mark per clock hour the gap covers', () => {
    // 9:00 → 12:00: the 9, 10 and 11 o'clock hours are free. Noon is where the
    // next task starts, so it is not part of the gap.
    expect(gapHourMarks(540, 720)).toEqual([540, 600, 660]);
  });

  // The gap the screenshot shows: 9 AM → 3:30 PM, read as "6h30m".
  test('includes the hour a gap ENDS part-way through', () => {
    expect(gapHourMarks(540, 930)).toEqual([540, 600, 660, 720, 780, 840, 900]);
  });

  // Starting at the containing hour is what keeps the expansion lined up with
  // the row it came from.
  test('starts from the hour the gap begins in, not the next whole one', () => {
    expect(gapHourMarks(545, 720)).toEqual([540, 600, 660]);
  });

  test('a gap inside a single hour still expands to that hour', () => {
    expect(gapHourMarks(545, 575)).toEqual([540]);
  });

  test('is empty for a gap that does not go forwards', () => {
    expect(gapHourMarks(600, 600)).toEqual([]);
    expect(gapHourMarks(700, 600)).toEqual([]);
    expect(gapHourMarks(null, 600)).toEqual([]);
    expect(gapHourMarks(600, undefined)).toEqual([]);
  });

  test('caps the row count rather than growing without bound', () => {
    expect(gapHourMarks(0, 60 * 1000)).toHaveLength(24);
    expect(gapHourMarks(0, 60 * 1000, { cap: 3 })).toEqual([0, 60, 120]);
  });

  test('keys a gap by the stretch it spans, so an expansion survives a re-render', () => {
    const rows = buildCompactRows([seg(480, 540), seg(840, 900)]);
    const gap = rows.find((r) => r.kind === 'gap' && !r.edge);
    expect(gapKey(gap)).toBe('gap-540-840');
    expect(gapKey(buildCompactRows([seg(480, 540), seg(840, 900)]).find((r) => r.kind === 'gap' && !r.edge)))
      .toBe(gapKey(gap));
  });

  test('the two ends key differently from each other and from the middle', () => {
    // Otherwise opening the morning would open the evening with it.
    const rows = buildCompactRows([seg(480, 540), seg(840, 900)]);
    const keys = rows.filter((r) => r.kind === 'gap').map(gapKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(['gap-0-480', 'gap-540-840', 'gap-900-1440']);
  });
});

// An expanded gap's hours are SLOTS: tapping one opens the finder with that
// hour already pending. gapHourMarks gives the minutes, this gives the "HH:MM"
// the finder and the task record both speak — so the two ends of that trip are
// tested against each other here.
describe('minutesToTimeString', () => {
  const { minutesToTimeString } = require('../compactSchedule');

  test('writes the hour the slot is labelled with', () => {
    expect(minutesToTimeString(0)).toBe('00:00');
    expect(minutesToTimeString(9 * 60)).toBe('09:00');
    expect(minutesToTimeString(16 * 60)).toBe('16:00');
    expect(minutesToTimeString(23 * 60)).toBe('23:00');
  });

  test('pads both halves, because "9:0" is not a time', () => {
    expect(minutesToTimeString(5 * 60 + 5)).toBe('05:05');
  });

  test('every mark a gap can produce round-trips to a real time', () => {
    for (const minute of gapHourMarks(3 * 60, 22 * 60)) {
      expect(minutesToTimeString(minute)).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
    }
  });

  test('stays inside the day rather than wrapping past midnight', () => {
    expect(minutesToTimeString(24 * 60)).toBe('23:59');
    expect(minutesToTimeString(-30)).toBe('00:00');
  });

  test('survives nonsense rather than writing NaN into a task', () => {
    expect(minutesToTimeString(undefined)).toBe('00:00');
    expect(minutesToTimeString('x')).toBe('00:00');
  });
});

// The ends of the day. They were deliberately left out while a gap was only a
// readout — padding the ends bought nothing but height. Now that an open gap's
// hours are tap-to-create slots, they are the only way to reach an hour outside
// the span you already have something in.
describe('the ends of the day', () => {
  test('opens with a gap back to midnight and closes with one running to it', () => {
    const rows = buildCompactRows([seg(480, 540)]);
    expect(rows[0]).toMatchObject({ kind: 'gap', edge: 'start', from: DAY_START, to: 480, minutes: 480 });
    expect(rows[rows.length - 1]).toMatchObject({ kind: 'gap', edge: 'end', from: 540, to: DAY_END, minutes: 900 });
  });

  test('marks them so a caller can tell an end from a stretch between tasks', () => {
    const rows = buildCompactRows([seg(480, 540), seg(840, 900)]);
    expect(rows.filter((r) => r.edge === 'start')).toHaveLength(1);
    expect(rows.filter((r) => r.edge === 'end')).toHaveLength(1);
    expect(rows.find((r) => r.kind === 'gap' && !r.edge).edge).toBeUndefined();
  });

  test('a task at midnight gets no leading gap, one at the end none trailing', () => {
    expect(buildCompactRows([seg(0, 60)])[0]).toMatchObject({ kind: 'task' });
    const late = buildCompactRows([seg(DAY_END - 60, DAY_END)]);
    expect(late[late.length - 1]).toMatchObject({ kind: 'task' });
  });

  test('a task running past midnight leaves no negative tail', () => {
    const rows = buildCompactRows([seg(DAY_END - 30, DAY_END + 120)]);
    expect(rows.filter((r) => r.edge === 'end')).toHaveLength(0);
  });

  test('the ends obey the same threshold as any other gap', () => {
    // A task starting 10 minutes in is not worth a row saying so.
    const rows = buildCompactRows([seg(MIN_GAP_MINUTES - 5, 600)]);
    expect(rows.filter((r) => r.edge === 'start')).toHaveLength(0);
  });

  test('they expand to the hours they cover, like any gap', () => {
    const rows = buildCompactRows([seg(480, 540)]);
    const start = rows.find((r) => r.edge === 'start');
    // Midnight through 7 o'clock — the 8 o'clock hour is where the task is.
    expect(gapHourMarks(start.from, start.to)).toHaveLength(8);
    const end = rows.find((r) => r.edge === 'end');
    // 9 AM through 11 PM.
    expect(gapHourMarks(end.from, end.to)).toHaveLength(15);
  });

  test('an empty day is ONE gap, not two ends around nothing', () => {
    // Midnight→midnight as a single row. Two edge rows would be a leading gap
    // and a trailing gap with no task between them to be either side of.
    const rows = buildCompactRows([]);
    expect(rows).toHaveLength(1);
    expect(rows.filter((r) => r.edge === 'start' || r.edge === 'end')).toHaveLength(0);
  });
});

// The red now-line. It exists exactly where the schedule has given the minutes
// room to exist: inside a gap that has been OPENED into its hours. A closed gap
// is one line standing for six and a half hours, and there is no honest y on it
// for 2:41 PM — so there is no line on it either.
describe('gapNowOffset', () => {
  const { gapNowOffset } = require('../compactSchedule');
  // The slot geometry the schedule actually draws with: a 48 pt hour whose rule
  // sits 9 pt in (half an 18 pt rule row).
  const at = (from, to, now) => gapNowOffset(from, to, now, { hourHeight: 48, lineY: 9 });

  test('lands on the hour rule at the top of the hour', () => {
    // 9:00 inside a 9 → 12 gap: the first rule, 9 pt into the rows.
    expect(at(540, 720, 540)).toBe(9);
    // 11:00 is two hours further down.
    expect(at(540, 720, 660)).toBe(9 + 96);
  });

  test('sits proportionally through an hour, not snapped to it', () => {
    expect(at(540, 720, 570)).toBe(9 + 24);   // 9:30 — half a slot
    expect(at(540, 720, 555)).toBe(9 + 12);   // 9:15 — a quarter
  });

  // A gap starting at 9:05 still draws the 9 o'clock row (gapHourMarks starts
  // from the containing hour), so 9:02 is inside the rows even though it is
  // outside the gap. The line follows the ROWS — it is drawn among them.
  test('measures from the first hour DRAWN, not from the gap edge', () => {
    expect(at(545, 720, 540)).toBe(9);
    expect(at(545, 720, 570)).toBe(9 + 24);
  });

  test('is nothing when the clock is outside the hours drawn', () => {
    expect(at(540, 720, 480)).toBeNull();     // an hour before
    expect(at(540, 720, 720)).toBeNull();     // the hour after the last one drawn
    expect(at(540, 720, 1439)).toBeNull();
  });

  test('is nothing for a gap with no hours to draw', () => {
    expect(at(600, 600, 600)).toBeNull();
    expect(at(null, 720, 600)).toBeNull();
  });

  test('survives nonsense rather than placing a line at NaN', () => {
    expect(at(540, 720, undefined)).toBeNull();
    expect(gapNowOffset(540, 720, 600, {})).toBeNull();
    expect(gapNowOffset(540, 720, 600)).toBeNull();
  });

  // An empty day is one 24 h gap, so opening it puts the line on the day at
  // whatever the hour is — the read the hour grid used to be the only way to get.
  test('an opened empty day carries the line anywhere in it', () => {
    const [day] = buildCompactRows([]);
    expect(gapNowOffset(day.from, day.to, 0, { hourHeight: 48, lineY: 9 })).toBe(9);
    expect(gapNowOffset(day.from, day.to, 15 * 60 + 30, { hourHeight: 48, lineY: 9 })).toBe(9 + 15 * 48 + 24);
    expect(gapNowOffset(day.from, day.to, 1439, { hourHeight: 48, lineY: 9 })).not.toBeNull();
  });
});
