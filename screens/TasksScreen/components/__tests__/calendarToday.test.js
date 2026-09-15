/**
 * The calendar must open on TODAY — even on day three of the app being open.
 *
 * MONTHS_LIST and DAYS_LIST are built once at module load and anchored to the
 * day the JS bundle started, and this app stays resident for days. The
 * constants `TODAY_INDEX` / `DAY_TODAY_INDEX` therefore mean "the day the
 * bundle loaded", which is only today on the first day. Everything that seeds
 * mount state with "today" — the month page, the day pager's page, the week
 * strip's sliding pill, the centred-page bookkeeping — has to MEASURE it
 * instead.
 *
 * That is exactly what this asserts, and it is the property the component
 * seeds from: the module is imported ONCE, at a fixed date, and then the clock
 * is moved. A frozen constant cannot move with it; these two must.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

const BUNDLE_LOADED = new Date(2026, 8, 15, 9, 0, 0);   // Tue 15 Sep 2026, local

// Freeze the clock BEFORE the import so the lists are anchored to that day,
// the way a bundle loaded days ago is.
jest.useFakeTimers({ doNotFake: ['nextTick'] });
jest.setSystemTime(BUNDLE_LOADED);

const { todayDayIndex, todayMonthIndex } = require('../CalendarView');

/** The lists are ±DAY_RANGE / ±MONTH_RANGE around the load day. */
const DAY_ORIGIN = todayDayIndex();
const MONTH_ORIGIN = todayMonthIndex();

afterAll(() => { jest.useRealTimers(); });

describe('today, measured rather than frozen', () => {
  test('on the day the bundle loaded, both are the list centres', () => {
    jest.setSystemTime(BUNDLE_LOADED);
    expect(todayDayIndex()).toBe(DAY_ORIGIN);
    expect(todayMonthIndex()).toBe(MONTH_ORIGIN);
  });

  test('a day later, the day index moves with the clock', () => {
    // The bug: the pager opened on today while the week strip's pill was still
    // seeded on the bundle-load day, so "today" looked unselected.
    jest.setSystemTime(new Date(2026, 8, 16, 9, 0, 0));
    expect(todayDayIndex()).toBe(DAY_ORIGIN + 1);

    jest.setSystemTime(new Date(2026, 8, 22, 23, 59, 0));
    expect(todayDayIndex()).toBe(DAY_ORIGIN + 7);
  });

  test('across a month boundary the MONTH index moves too', () => {
    jest.setSystemTime(new Date(2026, 9, 2, 9, 0, 0));    // 2 Oct
    expect(todayMonthIndex()).toBe(MONTH_ORIGIN + 1);
    expect(todayDayIndex()).toBe(DAY_ORIGIN + 17);

    jest.setSystemTime(new Date(2026, 11, 25, 9, 0, 0));  // 25 Dec
    expect(todayMonthIndex()).toBe(MONTH_ORIGIN + 3);
  });

  test('late in the evening it is still that day, not tomorrow', () => {
    jest.setSystemTime(new Date(2026, 8, 15, 23, 45, 0));
    expect(todayDayIndex()).toBe(DAY_ORIGIN);
  });

  test('a clock far outside the built range clamps inside it rather than going negative', () => {
    jest.setSystemTime(new Date(2016, 0, 1));
    expect(todayDayIndex()).toBe(0);
    expect(todayMonthIndex()).toBe(0);
  });
});
