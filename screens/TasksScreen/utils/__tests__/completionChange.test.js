/**
 * The tick, as data. These pin the two things the sync bug turned on: the
 * patch is SMALL (so the server merges it into one row instead of the client
 * republishing a whole list), and the recurrence rules are unchanged.
 */
import { completionChange } from '../completionChange';

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0); // 2026-09-15T12:00:00Z
const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

describe('completionChange', () => {
  test('a one-off task ticks, and the patch carries only completion fields', () => {
    const task = { id: 't1', title: 'Water the plants', completed: false };
    const { next, patch, isTicking } = completionChange(task, null, NOW);

    expect(isTicking).toBe(true);
    expect(next.completed).toBe(true);
    expect(next.completedAt).toBe(NOW);
    expect(patch).toEqual({
      completed: true,
      completedAt: NOW,
      completedTime: new Date(NOW).toISOString(),
    });
    // The whole point: no title, no project, no subtasks — nothing that could
    // overwrite what another device changed.
    expect(Object.keys(patch).sort()).toEqual(['completed', 'completedAt', 'completedTime']);
  });

  test('un-ticking a one-off clears the stamps', () => {
    const task = { id: 't1', completed: true, completedAt: 1, completedTime: 'x' };
    const { next, patch, isTicking } = completionChange(task, null, NOW);
    expect(isTicking).toBe(false);
    expect(next.completed).toBe(false);
    expect(patch).toEqual({ completed: false, completedAt: null, completedTime: null });
  });

  test('a recurring occurrence is recorded by DATE and never completes the series', () => {
    const task = {
      id: 'r1', recurring: 'daily', dueDate: '2026-09-15', completed: false,
      meta: { completedDates: [], linkedNote: 'n1' },
    };
    const { next, patch, isTicking } = completionChange(task, '2026-09-15', NOW);

    expect(isTicking).toBe(true);
    expect(next.completed).toBe(false);                       // the series lives on
    expect(next.meta.completedDates).toEqual(['2026-09-15']);
    expect(next.dueDate).toBe('2026-09-16');                  // the next one shows
    expect(patch.completed).toBe(false);
    expect(patch.dueDate).toBe('2026-09-16');
    expect(patch.meta.completedDates).toEqual(['2026-09-15']);
    // Other meta keys ride along untouched rather than being rebuilt.
    expect(patch.meta.linkedNote).toBe('n1');
  });

  test('un-ticking a recurring day removes it and pulls the due date back', () => {
    const task = {
      id: 'r1', recurring: 'daily', dueDate: '2026-09-16', completed: false,
      meta: { completedDates: ['2026-09-15'] },
    };
    const { next, patch, isTicking } = completionChange(task, '2026-09-15', NOW);
    expect(isTicking).toBe(false);
    expect(next.meta.completedDates).toEqual([]);
    expect(next.dueDate).toBe('2026-09-15');
    expect(patch.meta.completedDates).toEqual([]);
    // An undo leaves the completion stamps alone rather than back-dating them.
    expect('completedAt' in patch).toBe(false);
  });

  test('ticking the same day twice cannot duplicate it', () => {
    const task = {
      id: 'r1', recurring: 'daily', dueDate: '2026-09-16', completed: false,
      meta: { completedDates: ['2026-09-15'] },
    };
    const again = completionChange(task, '2026-09-15', NOW);
    expect(again.isTicking).toBe(false);
    expect(again.next.meta.completedDates).toEqual([]);
  });

  test('a recurring task with no day context records TODAY, not a missed day', () => {
    const task = {
      id: 'r1', recurring: 'weekly', dueDate: '2026-01-05', completed: false,
      meta: { completedDates: [] },
    };
    const { next, isTicking } = completionChange(task, null, NOW);
    expect(isTicking).toBe(true);
    expect(next.meta.completedDates).toEqual([todayStr()]);
  });

  test('a legacy recurring row stuck with completed=true can be cleared', () => {
    const task = { id: 'r1', recurring: 'daily', completed: true, meta: { completedDates: [] } };
    const { next, patch } = completionChange(task, null, NOW);
    expect(next.completed).toBe(false);
    expect(patch.completed).toBe(false);
  });
});
