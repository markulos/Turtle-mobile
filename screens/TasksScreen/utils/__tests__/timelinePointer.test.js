import { indexAtContentY, dayKeyAt, pointerLabel } from '../timelinePointer';

// A stand-in for FlashList's geometry: items stacked from y=0, each its own
// height, with the gaps the agenda actually leaves between rows.
const stack = (heights, gap = 0) => {
  const layouts = [];
  let y = 0;
  for (const h of heights) { layouts.push({ x: 0, y, width: 300, height: h }); y += h + gap; }
  return (i) => layouts[i];
};

describe('indexAtContentY', () => {
  const getLayout = stack([100, 60, 40]);

  test('finds the item the mark is sitting inside', () => {
    expect(indexAtContentY(0, 0, 2, getLayout)).toBe(0);
    expect(indexAtContentY(99, 0, 2, getLayout)).toBe(0);
    expect(indexAtContentY(100, 0, 2, getLayout)).toBe(1);
    expect(indexAtContentY(159, 0, 2, getLayout)).toBe(1);
    expect(indexAtContentY(160, 0, 2, getLayout)).toBe(2);
  });

  // The mark is always ON something. Reporting "nothing" in the margin between
  // two rows would blank the readout every time the pointer crossed one.
  test('a y in the gap between rows belongs to the row below it', () => {
    const gapped = stack([100, 60], 12); // 0–100, gap 100–112, 112–172
    expect(indexAtContentY(105, 0, 1, gapped)).toBe(1);
  });

  test('searches only the window it was given', () => {
    // y=0 is inside item 0, but item 0 isn't on screen — don't report it.
    expect(indexAtContentY(0, 1, 2, getLayout)).toBe(1);
  });

  test('-1 when nothing on screen covers the mark', () => {
    expect(indexAtContentY(9999, 0, 2, getLayout)).toBe(-1);
  });

  // getLayout throws for indices FlashList hasn't laid out yet; a pointer that
  // crashed the scroll handler would take the whole list with it.
  test('an index the list cannot lay out is skipped, not thrown', () => {
    const flaky = (i) => { if (i === 0) throw new Error('not laid out'); return stack([100, 60])(i); };
    expect(() => indexAtContentY(120, 0, 1, flaky)).not.toThrow();
    expect(indexAtContentY(120, 0, 1, flaky)).toBe(1);
    expect(indexAtContentY(120, 0, 1, () => undefined)).toBe(-1);
  });
});

describe('dayKeyAt', () => {
  // The agenda as it really is: chrome, dividers, rows, gaps, all one array.
  const items = [
    { __agendaHeader: 'upcoming' },          // 0 — no date of its own
    { __addCard: true },                     // 1 — nor this
    { __divider: true, dateKey: '2026-09-28' }, // 2
    { id: 'a', dueDate: '2026-09-28', time: '21:00' }, // 3
    { __divider: true, dateKey: '2026-10-01' }, // 4
    { id: 'b', dueDate: '2026-10-01' },      // 5
    { __gap: true },                         // 6 — nor this
  ];

  test('a row states its own day', () => {
    expect(dayKeyAt(items, 3)).toBe('2026-09-28');
    expect(dayKeyAt(items, 5)).toBe('2026-10-01');
  });

  test('a divider states it outright', () => {
    expect(dayKeyAt(items, 4)).toBe('2026-10-01');
  });

  // Headers, gaps and the add card carry no date — the pointer sitting on one
  // should report the day it is still inside, not go blank.
  test('chrome inherits the day above it', () => {
    expect(dayKeyAt(items, 6)).toBe('2026-10-01'); // the gap after the last row
  });

  test('null above the first dated thing, rather than a wrong day', () => {
    expect(dayKeyAt(items, 0)).toBeNull();
    expect(dayKeyAt(items, 1)).toBeNull();
  });
});

describe('pointerLabel', () => {
  const dateLabel = (k) => ({ '2026-09-28': 'Today', '2026-10-06': 'Oct 6' }[k] || k);
  const clock = (mins) => `${(Math.floor(mins / 60) % 12) || 12}${mins % 60 ? `:${String(mins % 60).padStart(2, '0')}` : ''} ${mins >= 720 ? 'PM' : 'AM'}`;

  test('the day leads, and a timed row adds its hour', () => {
    const row = { dueDate: '2026-09-28', time: '21:00' };
    expect(pointerLabel(row, '2026-09-28', dateLabel, clock)).toBe('Today · 9 PM');
  });

  // A header or a gap has no hour to report, and borrowing the previous row's
  // would state a time the pointer isn't actually on.
  test('chrome and untimed rows print the day alone', () => {
    expect(pointerLabel({ __gap: true }, '2026-10-06', dateLabel, clock)).toBe('Oct 6');
    expect(pointerLabel({ dueDate: '2026-10-06' }, '2026-10-06', dateLabel, clock)).toBe('Oct 6');
  });

  test('a malformed time degrades to the day, not to "NaN"', () => {
    const bad = { dueDate: '2026-10-06', time: 'lunchtime' };
    expect(pointerLabel(bad, '2026-10-06', dateLabel, clock)).toBe('Oct 6');
  });

  test('no day → nothing to print', () => {
    expect(pointerLabel({ dueDate: '2026-10-06' }, null, dateLabel, clock)).toBeNull();
  });
});
