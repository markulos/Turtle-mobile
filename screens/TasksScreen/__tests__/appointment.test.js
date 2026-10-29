/**
 * The bug this file exists for: "single event (appointment)" used to be stored
 * by overwriting createdAt with midnight of the due date, so a December
 * appointment claimed a creation time in the future and led every newest-first
 * list — Notes above all, which merges notes and to-dos on createdAt. Mark's
 * office party and the building show sat at the top of his notes for weeks.
 */
import { isAppointment } from '../utils/appointment';

describe('isAppointment', () => {
  test('a task with a time is a fixed slot, flag or no flag', () => {
    expect(isAppointment({ time: '13:28', dueDate: '2026-12-17', createdAt: 1791912529009 })).toBe(true);
    expect(isAppointment({ time: '   ', dueDate: '2026-12-17', createdAt: 1791912529009 })).toBe(false);
  });

  test('reads the flag out of meta', () => {
    expect(isAppointment({ dueDate: '2026-12-17', meta: { appointment: true } })).toBe(true);
    expect(isAppointment({ dueDate: '2026-12-17', meta: { colour: 'blue' } })).toBe(false);
  });

  test('still reads both spellings of the legacy createdAt encoding', () => {
    // What this app wrote: LOCAL midnight of the due date.
    expect(isAppointment({ dueDate: '2026-12-17', createdAt: new Date(2026, 11, 17).getTime() })).toBe(true);
    // What the web app wrote: UTC midnight. The old encoding never agreed with
    // itself across the two, which is a reason of its own to be rid of it.
    expect(isAppointment({ dueDate: '2026-12-17', createdAt: Date.UTC(2026, 11, 17) })).toBe(true);
  });

  test('an ordinary dated task is not an appointment', () => {
    expect(isAppointment({ dueDate: '2026-12-17', createdAt: 1791912529009 })).toBe(false);
    expect(isAppointment({})).toBe(false);
    expect(isAppointment(null)).toBe(false);
  });
});
