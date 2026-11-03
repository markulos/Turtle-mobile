/**
 * The finder's key used to COPY in every case. Pulling an open task forward
 * therefore left the original sitting on the day you were trying to move it
 * off, and you tidied up by hand. These pin the three answers apart.
 */
import {
  BRING_CONTINUE, BRING_HERE, BRING_READD,
  bringToDay, isFinishedTask, repeatsTask,
} from '../finderReadd';

const DAY = '2026-11-03';
const task = (over = {}) => ({ id: 't1', title: 'Ring the bank', ...over });

describe('an open task MOVES — it is the same piece of work', () => {
  test('a task from another day comes to this one', () => {
    const { action, patch } = bringToDay(task({ dueDate: '2026-10-28' }), DAY);
    expect(action).toBe(BRING_CONTINUE);
    expect(patch).toEqual({ dueDate: DAY });
  });

  test('so does undated backlog, which is the commonest case of all', () => {
    const { action, patch } = bringToDay(task(), DAY);
    expect(action).toBe(BRING_CONTINUE);
    expect(patch).toEqual({ dueDate: DAY });
  });

  // The patch carries only what CHANGES: everything else about the task — its
  // board, description, subtasks and their progress — comes along by not
  // being touched. That is the whole advantage of moving over copying.
  test('the patch is the change and nothing else', () => {
    const { patch } = bringToDay(task({ dueDate: '2026-10-28', project: 'Admin', subtasks: [{ id: 's' }] }), DAY);
    expect(Object.keys(patch)).toEqual(['dueDate']);
  });

  test('a pending time rides along with the move', () => {
    const { action, patch } = bringToDay(task({ dueDate: '2026-10-28' }), DAY, { time: '09:30' });
    expect(action).toBe(BRING_CONTINUE);
    expect(patch).toEqual({ dueDate: DAY, time: '09:30' });
  });

  // No time on the chip means "no opinion", not "make it untimed" — clearing
  // a time nobody asked to clear is how a scheduled task loses its slot.
  test('no pending time never clears the time it already has', () => {
    const { patch } = bringToDay(task({ dueDate: '2026-10-28', time: '14:00' }), DAY);
    expect(patch).toEqual({ dueDate: DAY });
    expect(patch).not.toHaveProperty('time');
  });
});

describe('a finished task is COPIED — doing it again is a new instance', () => {
  test('completed, however the task spells it', () => {
    expect(bringToDay(task({ completed: true, dueDate: '2026-10-28' }), DAY).action).toBe(BRING_READD);
    expect(bringToDay(task({ completedAt: 1762000000000 }), DAY).action).toBe(BRING_READD);
  });

  // The original stays where it is: it is the record that you did it then,
  // and a move would rewrite that history.
  test('a copy carries no patch — nothing about the original changes', () => {
    expect(bringToDay(task({ completed: true }), DAY).patch).toBeUndefined();
  });

  test('even one finished ON this very day — that is the point of re-adding', () => {
    expect(bringToDay(task({ completed: true, dueDate: DAY }), DAY).action).toBe(BRING_READD);
  });
});

/**
 * A repeater's dueDate is the SERIES ANCHOR, not an instance. Moving it drags
 * every future occurrence along — the day pane's time editor already refuses
 * for this reason, and this is the same rule at the second call site.
 */
describe('a repeating task is copied even while open', () => {
  test.each(['daily', 'weekly', 'monthly'])('recurring: %s', (every) => {
    expect(bringToDay(task({ recurring: every, dueDate: '2026-10-28' }), DAY).action).toBe(BRING_READD);
  });

  test('and under the other spelling of the same field', () => {
    expect(bringToDay(task({ recurrence: 'weekly' }), DAY).action).toBe(BRING_READD);
  });

  test('“none” is not repeating, so it still moves', () => {
    expect(bringToDay(task({ recurring: 'none' }), DAY).action).toBe(BRING_CONTINUE);
  });
});

describe('already here — so there is nothing to offer', () => {
  test('open, on this day, nothing pending', () => {
    expect(bringToDay(task({ dueDate: DAY }), DAY).action).toBe(BRING_HERE);
  });

  test('…and with a time that is already the one it has', () => {
    expect(bringToDay(task({ dueDate: DAY, time: '09:30' }), DAY, { time: '09:30' }).action).toBe(BRING_HERE);
  });

  // But a DIFFERENT pending time is a real change, so the key has work to do.
  test('a new time on a task already here is still a move', () => {
    const { action, patch } = bringToDay(task({ dueDate: DAY, time: '09:30' }), DAY, { time: '16:00' });
    expect(action).toBe(BRING_CONTINUE);
    expect(patch).toEqual({ time: '16:00' });
  });
});

describe('the small print', () => {
  test('no task is a copy, not a crash', () => {
    expect(bringToDay(null, DAY).action).toBe(BRING_READD);
  });

  test('isFinishedTask is the app’s rule, not a new one', () => {
    expect(isFinishedTask({ completed: true })).toBe(true);
    expect(isFinishedTask({ completedAt: 1 })).toBe(true);
    expect(isFinishedTask({ completed: false })).toBe(false);
    expect(isFinishedTask(null)).toBe(false);
  });

  test('repeatsTask reads both spellings and neither', () => {
    expect(repeatsTask({ recurring: 'daily' })).toBe(true);
    expect(repeatsTask({ recurrence: 'weekly' })).toBe(true);
    expect(repeatsTask({ recurring: 'none' })).toBe(false);
    expect(repeatsTask({})).toBe(false);
  });
});
