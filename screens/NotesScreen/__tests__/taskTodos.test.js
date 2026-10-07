// The Notes/Tasks unification. A to-do IS a task now — these are the rules
// that make one table read correctly as two screens.
import {
  inboxCountLabel,
  isInboxTodo,
  isTaskTodo,
  mergeNotesAndTasks,
  orderTodos,
  taskAsTodo,
  todoTaskPayload,
} from '../taskTodos';

const task = (over = {}) => ({
  id: 't1', title: 'Buy milk', description: '', tags: [], completed: false,
  createdAt: 1000, dueDate: null, time: null, priority: 'medium', project: null,
  itemType: 'task', meta: {}, ...over,
});

const note = (over = {}) => ({
  id: 'n1', content: 'A thought', description: '', tags: [], type: 'note',
  done: false, createdAt: 2000, ...over,
});

describe('taskAsTodo', () => {
  it('wears the note shape the rows already render', () => {
    const t = taskAsTodo(task({ title: 'Buy milk', description: 'oat', tags: ['Home'] }));
    expect(t).toMatchObject({
      id: 't1', content: 'Buy milk', description: 'oat', tags: ['Home'],
      type: 'todo', done: false, __task: true,
    });
  });

  it('carries the scheduling a note never had', () => {
    const t = taskAsTodo(task({ dueDate: '2026-10-01', time: '09:00', priority: 'high' }));
    expect(t).toMatchObject({ dueDate: '2026-10-01', time: '09:00', priority: 'high' });
  });

  it('reads attachments out of the task\'s meta', () => {
    // The tasks table has no media_ids column; adding one to carry what a JSON
    // blob already holds would be a migration for nothing.
    expect(taskAsTodo(task({ meta: { mediaIds: ['9'] } })).mediaIds).toEqual(['9']);
    expect(taskAsTodo(task()).mediaIds).toEqual([]);
  });

  it('keeps the whole meta blob for an edit to merge into', () => {
    // A recurring task's per-day ticks live there; an edit must not wipe them.
    const t = taskAsTodo(task({ meta: { completedDates: ['2026-01-01'] } }));
    expect(t.__meta).toEqual({ completedDates: ['2026-01-01'] });
  });

  it('spells out the notes-only decorations rather than leaving them undefined', () => {
    expect(taskAsTodo(task())).toMatchObject({ thumbUrl: null, sharedBy: null });
  });

  it('is null for junk', () => {
    expect(taskAsTodo(null)).toBeNull();
    expect(taskAsTodo({})).toBeNull();
  });
});

describe('isInboxTodo', () => {
  it('is an open task with no day on it', () => {
    expect(isInboxTodo(taskAsTodo(task()))).toBe(true);
  });

  it('is not a scheduled one — scheduling IS leaving the inbox', () => {
    expect(isInboxTodo(taskAsTodo(task({ dueDate: '2026-10-01' })))).toBe(false);
  });

  it('is not a finished one — an inbox is what is still to decide', () => {
    expect(isInboxTodo(taskAsTodo(task({ completed: true })))).toBe(false);
  });

  it('is not a plain note', () => {
    expect(isInboxTodo(note())).toBe(false);
    expect(isTaskTodo(note())).toBe(false);
  });
});

describe('orderTodos', () => {
  it('leads with the inbox, newest first inside each half', () => {
    const rows = [
      taskAsTodo(task({ id: 'dated-new', dueDate: '2026-10-01', createdAt: 900 })),
      taskAsTodo(task({ id: 'inbox-old', createdAt: 100 })),
      taskAsTodo(task({ id: 'inbox-new', createdAt: 800 })),
      taskAsTodo(task({ id: 'dated-old', dueDate: '2026-09-01', createdAt: 50 })),
    ];
    expect(orderTodos(rows).map((t) => t.id))
      .toEqual(['inbox-new', 'inbox-old', 'dated-new', 'dated-old']);
  });

  it('does not mutate what it was given', () => {
    const rows = [taskAsTodo(task({ id: 'a', dueDate: '2026-10-01' })), taskAsTodo(task({ id: 'b' }))];
    const copy = [...rows];
    orderTodos(rows);
    expect(rows).toEqual(copy);
  });
});

describe('mergeNotesAndTasks', () => {
  it('puts plain notes and tasks in one list, newest first', () => {
    const out = mergeNotesAndTasks(
      [note({ id: 'n1', createdAt: 2000 })],
      [task({ id: 't1', createdAt: 3000 }), task({ id: 't2', createdAt: 1000 })],
    );
    expect(out.map((x) => x.id)).toEqual(['t1', 'n1', 't2']);
  });

  it('drops events and birthdays — a birthday is not something you tick off', () => {
    const out = mergeNotesAndTasks([], [
      task({ id: 'a' }),
      task({ id: 'b', itemType: 'event' }),
      task({ id: 'c', itemType: 'birthday' }),
    ]);
    expect(out.map((x) => x.id)).toEqual(['a']);
  });

  it('leaves legacy note-todos out, so a migrated one is not shown twice', () => {
    const out = mergeNotesAndTasks(
      [note({ id: 'n1' }), note({ id: 'n2', type: 'todo' })],
      [task({ id: 't1' })],
    );
    expect(out.map((x) => x.id).sort()).toEqual(['n1', 't1']);
  });

  it('survives empty and missing inputs', () => {
    expect(mergeNotesAndTasks(null, null)).toEqual([]);
  });
});

describe('todoTaskPayload', () => {
  it('is the task fields a to-do sets', () => {
    expect(todoTaskPayload({ content: '  Buy milk ', description: ' oat ', tags: ['Home'] }))
      .toEqual({ title: 'Buy milk', description: 'oat', tags: ['Home'] });
  });

  it('omits meta entirely when there are no attachments', () => {
    // A PATCH that always carried meta would clobber a recurring task's ticks.
    expect(todoTaskPayload({ content: 'x' }).meta).toBeUndefined();
    expect(todoTaskPayload({ content: 'x', mediaIds: [] }).meta).toBeUndefined();
  });

  it('merges attachments INTO the existing meta', () => {
    const out = todoTaskPayload({ content: 'x', mediaIds: ['7'] }, { completedDates: ['2026-01-01'] });
    expect(out.meta).toEqual({ completedDates: ['2026-01-01'], mediaIds: ['7'] });
  });

  it('only sends completion when asked to', () => {
    expect(todoTaskPayload({ content: 'x' }).completed).toBeUndefined();
    expect(todoTaskPayload({ content: 'x', done: true }).completed).toBe(true);
  });

  /**
   * Who is on the task. The server REPLACES the stored list with whatever
   * arrives, so the difference between "no list" and "an empty list" is the
   * difference between leaving a shared to-do alone and taking everybody off
   * it — on an edit that was only ever meant to fix a typo.
   */
  describe('involvedUsers', () => {
    it('is absent when the caller did not pass one', () => {
      expect(todoTaskPayload({ content: 'x' })).not.toHaveProperty('involvedUsers');
      expect(todoTaskPayload({ content: 'x', involvedUsers: undefined }))
        .not.toHaveProperty('involvedUsers');
      // Not an array is not an instruction either.
      expect(todoTaskPayload({ content: 'x', involvedUsers: 'u1' }))
        .not.toHaveProperty('involvedUsers');
    });

    it('sends an EMPTY list, because taking everyone off is a real edit', () => {
      expect(todoTaskPayload({ content: 'x', involvedUsers: [] }).involvedUsers).toEqual([]);
    });

    it('sends the ids it was given', () => {
      expect(todoTaskPayload({ content: 'x', involvedUsers: ['u1', 'u2'] }).involvedUsers)
        .toEqual(['u1', 'u2']);
    });

    it('drops duplicates and anything that is not an id', () => {
      const out = todoTaskPayload({
        content: 'x',
        involvedUsers: ['u1', 'u1', ' u2 ', '', '   ', null, undefined, 7, {}],
      });
      expect(out.involvedUsers).toEqual(['u1', 'u2']);
    });

    it('rides beside attachments rather than inside meta', () => {
      // Participants are a COLUMN on the task; meta is the JSON blob a
      // recurring task keeps its ticks in. Folding them together would mean a
      // people change rewrote that blob.
      const out = todoTaskPayload({ content: 'x', involvedUsers: ['u1'], mediaIds: ['7'] });
      expect(out.involvedUsers).toEqual(['u1']);
      expect(out.meta).toEqual({ mediaIds: ['7'] });
    });
  });
});

describe('inboxCountLabel', () => {
  it('singularises, and says nothing about an empty inbox', () => {
    expect(inboxCountLabel(0)).toBeNull();
    expect(inboxCountLabel(1)).toBe('1 in the inbox');
    expect(inboxCountLabel(4)).toBe('4 in the inbox');
  });
});

/**
 * A to-do row is a TASK wearing a note's shape, and the Notes list is mostly
 * these rows. They carried no author at all, which is why the card byline was
 * invisible on nearly every card in that list while working perfectly on the
 * plain notes mixed in among them.
 */
describe('taskAsTodo — who is on it', () => {
  const task = (over = {}) => ({
    id: 't1', title: 'Fix the dock', userId: 'u1', ownerName: 'Mark', involvedUsers: [], ...over,
  });

  it('carries the task owner across as the row\'s author', () => {
    expect(taskAsTodo(task()).sharedBy).toEqual({
      userId: 'u1', name: 'Mark', avatarUrl: null,
    });
  });

  it('carries the people on the task across as its collaborators', () => {
    expect(taskAsTodo(task({ involvedUsers: ['u2', 'u3'] })).involvedUsers).toEqual(['u2', 'u3']);
  });

  it('leaves no author on a task that somehow has no owner', () => {
    expect(taskAsTodo(task({ userId: null })).sharedBy).toBeNull();
  });

  it('survives an owner with no name yet — the byline resolves the id to a face', () => {
    expect(taskAsTodo(task({ ownerName: undefined })).sharedBy)
      .toEqual({ userId: 'u1', name: null, avatarUrl: null });
  });

  it('is an empty list, never undefined, when nobody else is on it', () => {
    expect(taskAsTodo(task({ involvedUsers: undefined })).involvedUsers).toEqual([]);
    expect(taskAsTodo(task({ involvedUsers: 'nonsense' })).involvedUsers).toEqual([]);
  });
});
