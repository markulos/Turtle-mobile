/**
 * Starting a focus session on a task that is sitting under "any time" gives it
 * a slot on TODAY at the minute you started — because the moment you begin
 * working on it, "no time set" is no longer true.
 *
 * Pure, so it is tested without the screen: every way into a session (the Focus
 * tab's key, its search, a task card's key, the calendar's To-Do and timeline
 * rows) runs through this one function, and what it returns is the whole rule.
 */
import { startPatch, todayStr } from '../focusStart';

const at = (h, m) => new Date(2026, 8, 18, h, m, 0);

describe('startPatch', () => {
  test('stamps the hour and minute the block began', () => {
    expect(startPatch({ id: 't' }, at(14, 38)))
      .toEqual({ dueDate: '2026-09-18', time: '14:38' });
  });

  // "9:5" is not a time, and the rest of the app parses HH:MM.
  test('pads both halves', () => {
    expect(startPatch({ id: 't' }, at(9, 5)).time).toBe('09:05');
    expect(startPatch({ id: 't' }, at(0, 0)).time).toBe('00:00');
  });

  // A task you deliberately put at 4 pm and started early keeps its 4 pm. This
  // guard is also what makes the STAMP a first-block behaviour without counting
  // blocks: after the first, the task is timed and a second start finds no time
  // to set.
  test('a task already on today with a time is left entirely alone', () => {
    expect(startPatch({ id: 't', dueDate: '2026-09-18', time: '16:00' }, at(14, 38))).toBeNull();
  });

  // STARTING A SESSION IS HOW A TASK LANDS ON TODAY — the default, not an
  // opt-in. The time it was given is a deliberate choice and survives; the DAY
  // is the day the work is actually happening.
  test('a timed task parked on another day comes to today, keeping its time', () => {
    expect(startPatch({ id: 't', dueDate: '2026-12-25', time: '16:00' }, at(14, 38)))
      .toEqual({ dueDate: '2026-09-18' });
  });

  test('so does a timed task with no day at all — a time is not a place', () => {
    expect(startPatch({ id: 't', time: '16:00' }, at(14, 38)))
      .toEqual({ dueDate: '2026-09-18' });
  });

  // A SERIES KEEPS ITS ANCHOR. A recurring task's dueDate is where every future
  // occurrence is measured from, so moving it would drag the whole series onto
  // today — a far bigger edit than the one the user asked for by pressing start.
  test('a recurring task is never moved', () => {
    expect(startPatch({ id: 't', recurring: 'weekly', dueDate: '2026-12-25' }, at(14, 38))).toBeNull();
    expect(startPatch({ id: 't', recurrence: 'daily' }, at(14, 38))).toBeNull();
  });

  // An event or a birthday is a fact about a day, not a plan for one. You can
  // focus during one; the calendar does not get rewritten for it.
  test('an event or a birthday keeps its date', () => {
    expect(startPatch({ id: 'e', itemType: 'event', dueDate: '2026-12-25' }, at(14, 38))).toBeNull();
    expect(startPatch({ id: 'b', itemType: 'birthday' }, at(14, 38))).toBeNull();
  });

  // An untimed task can also be an undated one — the backlog. A time with no
  // day is not a place on any timeline, so the day rides along.
  test('carries the day, so an undated task lands somewhere real', () => {
    expect(startPatch({ id: 't' }, at(7, 0)).dueDate).toBe('2026-09-18');
  });

  // THE DAY IS THE DAY THE SESSION IS HAPPENING, not the one the task was
  // parked on. A slot on a day you were not working is a record of nothing.
  test('pulls a task parked on a later day onto today', () => {
    expect(startPatch({ id: 't', dueDate: '2026-12-25' }, at(14, 38)))
      .toEqual({ dueDate: '2026-09-18', time: '14:38' });
  });

  test('defaults to the real clock', () => {
    const patch = startPatch({ id: 't' });
    expect(patch.dueDate).toBe(todayStr());
    expect(patch.time).toMatch(/^\d{2}:\d{2}$/);
  });

  test('has nothing to say about a task that is not there', () => {
    expect(startPatch(null, at(7, 0))).toBeNull();
    expect(startPatch(undefined)).toBeNull();
  });

  test('takes a timestamp as readily as a Date', () => {
    expect(startPatch({ id: 't' }, at(14, 38).getTime()).time).toBe('14:38');
  });

  // The day override exists for callers that know better than the clock; it
  // must not silently win when nobody passes one.
  test('an explicit day overrides today', () => {
    expect(startPatch({ id: 't' }, at(14, 38), '2026-01-02').dueDate).toBe('2026-01-02');
  });
});

describe('todayStr', () => {
  // NEVER toISOString: that is UTC, and every pond west of Greenwich would get
  // yesterday's date for anything before the small hours.
  test('is local, not UTC', () => {
    expect(todayStr(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
    expect(todayStr(new Date(2026, 11, 31, 23, 45))).toBe('2026-12-31');
  });

  test('pads the month and the day', () => {
    expect(todayStr(new Date(2026, 4, 7, 12, 0))).toBe('2026-05-07');
  });
});
