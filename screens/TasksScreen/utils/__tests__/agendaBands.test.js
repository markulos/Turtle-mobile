/**
 * "Everything" appeared to do nothing on the Agenda, and was hunted twice
 * without being found — because every STATUS branch in the app was correct.
 * The wrong rule was the band split, which had no name and no test: it filed
 * a completed task into history whatever you had asked to see, and history is
 * above the seam, which is off the top of the screen. So picking Everything
 * added rows you could not see and the page looked identical to "To do".
 *
 * These are the two meanings of "past", pinned apart.
 */
import { duePassedToday, hasAgendaDate, isAgendaPast } from '../agendaBands';

const TODAY = '2026-11-02';
// 14:00 local on TODAY.
const NOW = new Date(2026, 10, 2, 14, 0, 0).getTime();
const at = (statusFilter) => ({ todayStr: TODAY, nowMs: NOW, statusFilter });

const task = (over = {}) => ({ id: 't', title: 'A task', completed: false, ...over });

describe('what the date says, in every mode', () => {
  test.each(['todo', 'done', 'all'])('a day that has been and gone is past (%s)', (mode) => {
    expect(isAgendaPast(task({ dueDate: '2026-11-01' }), at(mode))).toBe(true);
  });

  test.each(['todo', 'done', 'all'])('a day still to come is not (%s)', (mode) => {
    expect(isAgendaPast(task({ dueDate: '2026-11-03' }), at(mode))).toBe(false);
  });

  // Today is the interesting one: the band turns over at the task's TIME, not
  // at midnight, so an 09:00 task is already behind you at 14:00.
  test.each(['todo', 'done', 'all'])('today splits on the clock, not the date (%s)', (mode) => {
    expect(isAgendaPast(task({ dueDate: TODAY, time: '09:00' }), at(mode))).toBe(true);
    expect(isAgendaPast(task({ dueDate: TODAY, time: '18:00' }), at(mode))).toBe(false);
    // No time at all is not "midnight" — it is all day, so it is still ahead.
    expect(isAgendaPast(task({ dueDate: TODAY }), at(mode))).toBe(false);
  });

  test.each(['todo', 'done', 'all'])('undated open work is backlog, not history (%s)', (mode) => {
    expect(isAgendaPast(task({}), at(mode))).toBe(false);
  });
});

describe('what completion says, which depends on what you asked for', () => {
  // The archive. "Done" reads as a history list and this is why.
  test.each(['todo', 'done'])('asking for one kind of work files a tick into history (%s)', (mode) => {
    expect(isAgendaPast(task({ completed: true }), at(mode))).toBe(true);
    expect(isAgendaPast(task({ completed: true, dueDate: '2026-11-20' }), at(mode))).toBe(true);
  });

  // THE BUG. Under Everything the band has to go back to meaning WHEN, or the
  // rows the filter just added are all above the seam.
  test('asking for everything does not: a tick stays where its date puts it', () => {
    expect(isAgendaPast(task({ completed: true, dueDate: '2026-11-20' }), at('all'))).toBe(false);
    expect(isAgendaPast(task({ completed: true }), at('all'))).toBe(false);
  });

  // The one that makes the fix visible on the phone: you tick something off
  // today's list, switch to Everything, and it is still in today's list.
  test('…so today’s finished work is in today’s list, not off the top', () => {
    const doneToday = task({ completed: true, dueDate: TODAY, time: '18:00' });
    expect(isAgendaPast(doneToday, at('todo'))).toBe(true);   // excluded anyway
    expect(isAgendaPast(doneToday, at('all'))).toBe(false);   // visible, ticked
  });

  // A completed task whose day HAS gone is still history under Everything —
  // by its date, which is the whole rule.
  test('a tick from last week is past because last week is past', () => {
    expect(isAgendaPast(task({ completed: true, dueDate: '2026-10-26' }), at('all'))).toBe(true);
  });
});

describe('the small print', () => {
  test('no task is nothing, not a crash', () => {
    expect(isAgendaPast(null, at('all'))).toBe(false);
    expect(isAgendaPast(undefined, at('todo'))).toBe(false);
  });

  test('todo is the default, so a caller that forgets gets the old meaning', () => {
    expect(isAgendaPast(task({ completed: true }), { todayStr: TODAY, nowMs: NOW })).toBe(true);
  });

  test('hasAgendaDate is about a REAL date, not a blank one', () => {
    expect(hasAgendaDate({ dueDate: '2026-11-02' })).toBe(true);
    expect(hasAgendaDate({ dueDate: '' })).toBe(false);
    expect(hasAgendaDate({})).toBe(false);
    expect(hasAgendaDate(null)).toBe(false);
  });

  // The two bands must agree exactly or a row lands in both or neither.
  test('duePassedToday only ever speaks about today, and only with a time', () => {
    expect(duePassedToday({ dueDate: TODAY, time: '09:00' }, { todayStr: TODAY, nowMs: NOW })).toBe(true);
    expect(duePassedToday({ dueDate: TODAY }, { todayStr: TODAY, nowMs: NOW })).toBe(false);
    expect(duePassedToday({ dueDate: '2026-11-01', time: '09:00' }, { todayStr: TODAY, nowMs: NOW })).toBe(false);
  });
});
