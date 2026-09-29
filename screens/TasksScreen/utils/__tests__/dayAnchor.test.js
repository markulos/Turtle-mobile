/**
 * The calendar opens on TODAY — on day three of the app being open, at 11pm, and
 * after the pager has scrolled itself.
 *
 * Every case here is a bug that can only be SEEN by opening the app on the wrong
 * day, which is why the decisions were pulled out of the component: a clock can
 * be moved in a test, and a screenshot of the right day proves nothing.
 *
 * `calendarToday.test.js` covers the other half — that "where is today" is
 * MEASURED against the day lists rather than frozen at bundle load.
 */
import {
  landedDayAction,
  localDayKey,
  msUntilNextLocalMidnight,
  reanchorTarget,
  sameLocalDay,
} from '../dayAnchor';

const at = (y, m, d, h = 12, min = 0) => new Date(y, m, d, h, min, 0, 0);

describe('localDayKey / sameLocalDay', () => {
  test('two times on one day are the same day', () => {
    expect(sameLocalDay(at(2026, 8, 28, 0, 1), at(2026, 8, 28, 23, 59))).toBe(true);
  });

  test('a minute either side of midnight is not', () => {
    expect(sameLocalDay(at(2026, 8, 28, 23, 59), at(2026, 8, 29, 0, 1))).toBe(false);
  });

  test('it is LOCAL, not UTC — an evening here can be tomorrow in UTC', () => {
    // Zero-padded local Y-M-D, so it cannot silently become a UTC date the way
    // toISOString() does for anyone west of Greenwich.
    expect(localDayKey(at(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

describe('msUntilNextLocalMidnight', () => {
  test('a few minutes before midnight is a few minutes', () => {
    expect(msUntilNextLocalMidnight(at(2026, 8, 28, 23, 50))).toBe(10 * 60 * 1000);
  });

  test('just after midnight is nearly a whole day', () => {
    expect(msUntilNextLocalMidnight(at(2026, 8, 28, 0, 1))).toBe((24 * 60 - 1) * 60 * 1000);
  });

  test('never zero or negative — the timer that re-arms itself would spin', () => {
    // Exactly midnight: the boundary has just passed, so the next one is a day
    // out; the floor is what protects the re-arm in any case.
    expect(msUntilNextLocalMidnight(at(2026, 8, 28, 0, 0))).toBeGreaterThan(0);
    for (let h = 0; h < 24; h += 1) {
      expect(msUntilNextLocalMidnight(at(2026, 8, 28, h, 59))).toBeGreaterThanOrEqual(1000);
    }
  });

  // A fixed +86 400 000 would fire an hour early or late twice a year, on the
  // one thing whose whole job is to be right about which day it is.
  test('it rolls the DATE forward rather than adding 24 hours', () => {
    const across = msUntilNextLocalMidnight(at(2026, 2, 8, 12, 0)); // a US DST date
    const plain = msUntilNextLocalMidnight(at(2026, 5, 8, 12, 0));
    // On a 23-hour day the answer is an hour shorter; on any normal day the two
    // agree. Either way it lands ON midnight, which is what this asserts.
    const next = new Date(at(2026, 2, 8, 12, 0).getTime() + across);
    expect(next.getHours()).toBe(0);
    expect(next.getMinutes()).toBe(0);
    const nextPlain = new Date(at(2026, 5, 8, 12, 0).getTime() + plain);
    expect(nextPlain.getHours()).toBe(0);
  });
});

describe('reanchorTarget', () => {
  const YESTERDAY = at(2026, 8, 27);
  const TODAY = at(2026, 8, 28, 9, 30);

  test('same day: nothing moves, whatever the reason', () => {
    // Answering a message and coming back must leave the day you were on.
    for (const reason of ['resume', 'rollover']) {
      expect(reanchorTarget({
        anchoredDay: at(2026, 8, 28, 1, 0), selected: at(2026, 9, 14), now: TODAY, reason,
      })).toBeNull();
    }
  });

  describe('coming back to the app — a fresh look', () => {
    test('a new day re-anchors on today', () => {
      const target = reanchorTarget({
        anchoredDay: YESTERDAY, selected: YESTERDAY, now: TODAY, reason: 'resume',
      });
      expect(target).not.toBeNull();
      expect(sameLocalDay(target, TODAY)).toBe(true);
    });

    // THE reported bug: the app sat open overnight, so yesterday was still the
    // selected day and looked like today.
    test('it re-anchors even if the user had browsed elsewhere', () => {
      const target = reanchorTarget({
        anchoredDay: YESTERDAY, selected: at(2026, 11, 3), now: TODAY, reason: 'resume',
      });
      expect(sameLocalDay(target, TODAY)).toBe(true);
    });
  });

  describe('midnight passing while the calendar is on screen', () => {
    test('someone sitting on today follows today across the boundary', () => {
      const target = reanchorTarget({
        anchoredDay: YESTERDAY, selected: YESTERDAY, now: TODAY, reason: 'rollover',
      });
      expect(sameLocalDay(target, TODAY)).toBe(true);
    });

    test('someone browsing another day keeps it — no grid yanked out from under a finger', () => {
      expect(reanchorTarget({
        anchoredDay: YESTERDAY, selected: at(2026, 11, 3), now: TODAY, reason: 'rollover',
      })).toBeNull();
    });
  });

  test('no anchor yet, or a reason it does not know, changes nothing', () => {
    expect(reanchorTarget({ anchoredDay: null, selected: TODAY, now: TODAY, reason: 'resume' })).toBeNull();
    expect(reanchorTarget({
      anchoredDay: YESTERDAY, selected: YESTERDAY, now: TODAY, reason: 'whatever',
    })).toBeNull();
  });
});

describe('landedDayAction', () => {
  // The scroll React Native performs itself to honour `initialScrollIndex`
  // arrives as a momentum end before any touch. Adopting the page it lands on is
  // how the selection slid off today on some launches and not others.
  test('an untouched pager that landed somewhere else is put back, not believed', () => {
    expect(landedDayAction({ landedIndex: 0, anchorIndex: 801, userDriven: false })).toBe('restore');
    expect(landedDayAction({ landedIndex: 799, anchorIndex: 801, userDriven: false })).toBe('restore');
  });

  test('an untouched pager that agrees with the anchor is harmless', () => {
    expect(landedDayAction({ landedIndex: 801, anchorIndex: 801, userDriven: false })).toBe('adopt');
  });

  test('once the finger has driven it, every landing is a choice of day', () => {
    // Including landing back where it started, and including index 0 — someone
    // CAN swipe to the end of the list.
    expect(landedDayAction({ landedIndex: 802, anchorIndex: 801, userDriven: true })).toBe('adopt');
    expect(landedDayAction({ landedIndex: 0, anchorIndex: 801, userDriven: true })).toBe('adopt');
    expect(landedDayAction({ landedIndex: 801, anchorIndex: 801, userDriven: true })).toBe('adopt');
  });
});
