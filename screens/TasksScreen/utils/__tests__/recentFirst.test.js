/**
 * "Recent" is the proxy for "yours right now". A filter panel that lists
 * twenty-six boards alphabetically asks you to read all twenty-six to find the
 * two you are working on this week — and those are never the ones beginning
 * with A.
 */
import { CHIP_PREVIEW, previewChips, recentFirst, taskStamp } from '../recentFirst';

const at = (over = {}) => ({ project: 'Admin', tags: [], ...over });

describe('taskStamp', () => {
  it('is the LATEST thing that happened to the task', () => {
    // A board whose only task was finished this morning is more recent than
    // one created last year; createdAt alone says the opposite.
    expect(taskStamp(at({ createdAt: 100, completedAt: 900 }))).toBe(900);
    expect(taskStamp(at({ createdAt: 900, updatedAt: 100 }))).toBe(900);
  });

  it('reads an ISO string as well as a number', () => {
    expect(taskStamp(at({ createdAt: '2026-01-01T00:00:00Z' }))).toBe(Date.parse('2026-01-01T00:00:00Z'));
  });

  it('ignores a due date — a day in the future is not something that happened', () => {
    expect(taskStamp(at({ dueDate: '2099-01-01' }))).toBe(0);
  });

  it('survives junk rather than returning NaN', () => {
    expect(taskStamp(null)).toBe(0);
    expect(taskStamp(at({ createdAt: 'not a date' }))).toBe(0);
  });
});

describe('recentFirst', () => {
  const NAMES = ['Admin', 'Gym', 'Thesis'];
  const byBoard = (t) => [t.project];

  it('leads with the most recently touched', () => {
    const tasks = [
      at({ project: 'Admin', createdAt: 10 }),
      at({ project: 'Thesis', createdAt: 500 }),
      at({ project: 'Gym', createdAt: 100 }),
    ];
    expect(recentFirst(NAMES, tasks, byBoard)).toEqual(['Thesis', 'Gym', 'Admin']);
  });

  it('takes a board\'s LATEST task, not its first', () => {
    const tasks = [
      at({ project: 'Admin', createdAt: 1 }),
      at({ project: 'Admin', createdAt: 999 }),
      at({ project: 'Thesis', createdAt: 500 }),
    ];
    expect(recentFirst(NAMES, tasks, byBoard)[0]).toBe('Admin');
  });

  it('counts a task towards EVERY label it carries', () => {
    const tasks = [at({ tags: ['home', 'urgent'], createdAt: 900 }), at({ tags: ['later'], createdAt: 10 })];
    expect(recentFirst(['later', 'home', 'urgent'], tasks, (t) => t.tags))
      .toEqual(['home', 'urgent', 'later']);
  });

  it('leaves the untouched ones in the order they came — alphabetical stays alphabetical', () => {
    // Shuffling names with no recency to sort by would make the tail of the
    // list move for no reason.
    expect(recentFirst(NAMES, [], byBoard)).toEqual(NAMES);
    expect(recentFirst(NAMES, [at({ project: 'Gym', createdAt: 5 })], byBoard))
      .toEqual(['Gym', 'Admin', 'Thesis']);
  });

  it('never invents a name the list does not have', () => {
    // A task left on a deleted board must not resurrect it as a chip.
    const out = recentFirst(NAMES, [at({ project: 'Deleted', createdAt: 999 })], byBoard);
    expect(out).toEqual(NAMES);
  });

  it('does not mutate what it was given', () => {
    const names = [...NAMES];
    recentFirst(names, [at({ project: 'Thesis', createdAt: 9 })], byBoard);
    expect(names).toEqual(NAMES);
  });

  it('survives empty and missing inputs', () => {
    expect(recentFirst(null, null, byBoard)).toEqual([]);
    expect(recentFirst(['one'], null, byBoard)).toEqual(['one']);
  });
});

describe('previewChips', () => {
  const ORDER = ['a', 'b', 'c', 'd', 'e', 'f'];

  it('is the head of the order', () => {
    expect(previewChips(ORDER, null)).toEqual(['a', 'b', 'c', 'd']);
    expect(CHIP_PREVIEW).toBe(4);
  });

  // A panel that hides the filter it is applying cannot be read.
  it('always carries what is picked, however far down it fell', () => {
    expect(previewChips(ORDER, 'f')).toEqual(['a', 'b', 'c', 'd', 'f']);
  });

  it('carries every pick when the section is a multi-pick', () => {
    expect(previewChips(ORDER, ['e', 'f'])).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('does not repeat a pick that is already in the head', () => {
    expect(previewChips(ORDER, 'b')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('ignores a pick that is not in the list at all', () => {
    expect(previewChips(ORDER, 'zzz')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('is the whole list when the list is short', () => {
    expect(previewChips(['a', 'b'], null)).toEqual(['a', 'b']);
  });
});
