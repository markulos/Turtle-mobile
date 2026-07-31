// Importing CalendarView pulls its whole graph (contexts, gesture handler,
// icons). These are pure date predicates, so the native-backed modules are
// stubbed rather than exercised.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

import { taskOccursOn, buildMonthCells } from '../CalendarView';

// "Show incomplete only" and RECURRING tasks. A repeating task never sets
// task.completed — completion is recorded per day in meta.completedDates — so
// the filter has to be evaluated per occurrence. The two halves that must both
// hold: a ticked day disappears, and the series' other days do not.

const weekly = {
  id: 'w1',
  title: 'Water the plants',
  itemType: 'task',
  dueDate: '2026-08-10',          // Monday
  recurring: 'weekly',
  completed: false,
  meta: { completedDates: ['2026-08-03'] },   // the PREVIOUS Monday, ticked
};

describe('incomplete-only filter over recurring occurrences', () => {
  test('hides only the ticked day, keeping the rest of the series', () => {
    // Off: the ticked day still shows (struck through in the UI).
    expect(taskOccursOn(weekly, '2026-08-03', true, false)).toBe(true);
    // On: that day drops out...
    expect(taskOccursOn(weekly, '2026-08-03', true, true)).toBe(false);
    // ...while the open occurrences stay, which is the half that must not
    // regress into "hide the whole repeating task".
    expect(taskOccursOn(weekly, '2026-08-10', true, true)).toBe(true);
    expect(taskOccursOn(weekly, '2026-08-17', true, true)).toBe(true);
  });

  test('a one-off completed day is unaffected when the filter is off', () => {
    expect(taskOccursOn(weekly, '2026-08-04', true, true)).toBe(false);   // not an occurrence at all
  });

  test('month cells drop the ticked day and keep the open ones', () => {
    const august = new Date(2026, 7, 1);

    const shown = buildMonthCells([weekly], august, false);
    const hidden = buildMonthCells([weekly], august, true);

    const dayOf = (cells, dateStr) => cells.find((c) => c && c.dateStr === dateStr);

    expect(dayOf(shown, '2026-08-03').tasks).toHaveLength(1);
    expect(dayOf(hidden, '2026-08-03').tasks).toHaveLength(0);

    // Every other Monday in the month is an open occurrence and must survive.
    for (const d of ['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31']) {
      expect(dayOf(hidden, d).tasks).toHaveLength(1);
    }
  });
});
