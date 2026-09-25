/**
 * One list of to-dos, two places to stand.
 *
 * Turtle had two kinds of "thing to do" and no relationship between them: a
 * `notes` row with `type='todo'`, and a `tasks` row. The Notes tab showed the
 * first, the calendar showed the second, and a to-do written in one was simply
 * invisible in the other. You had to remember which surface you had used.
 *
 * They are now ONE thing. The `tasks` table is the source of truth — it is the
 * richer of the two (due date, time, priority, recurrence, participants,
 * reminders), and a note-todo's fields are a strict subset of it — and the
 * Notes screen's Todos tab is a VIEW over it. So:
 *
 *   • every task in the calendar is a to-do in Notes, and
 *   • every to-do written in Notes is a task in the calendar,
 *
 * without any syncing, because there is only one row. Nothing can drift,
 * because there is nothing to drift from.
 *
 * The Notes tab's particular job in that arrangement is the INBOX: a task with
 * no due date is not on any calendar day, so the calendar can only file it
 * under "someday". That is exactly what a capture inbox is, and it is why
 * undated tasks lead the list here.
 *
 * This module is the translation layer, kept pure so it can be tested without
 * either screen: a task in, a note-shaped object out, and back again.
 */

/** Only these become to-dos. Events and birthdays are calendar-only ideas. */
export const TODO_ITEM_TYPE = 'task';

/**
 * A task, wearing the shape the Notes rows already render.
 *
 * Deliberately the note contract (`content`/`description`/`done`/`createdAt`)
 * rather than a new one: every row, filter, search tier and counter on that
 * screen already speaks it, and a second shape would mean touching all of them.
 *
 * `__task` marks the ones that came from here, so the screen knows which
 * endpoint a write belongs to. `dueDate`/`time`/`priority` ride along so a row
 * can show that this one is already on a day — the difference between the
 * inbox and the calendar is the only thing the merged list has to make visible.
 */
export function taskAsTodo(task) {
  if (!task || !task.id) return null;
  const meta = (task.meta && typeof task.meta === 'object') ? task.meta : {};
  return {
    id: task.id,
    content: task.title || '',
    description: task.description || '',
    tags: Array.isArray(task.tags) ? task.tags : [],
    type: 'todo',
    done: !!task.completed,
    createdAt: task.createdAt ?? null,
    updatedAt: null,
    // Attachments live in the task's meta — the tasks table has no media_ids
    // column, and adding one to carry what a JSON blob already holds would be
    // a migration for nothing.
    mediaIds: Array.isArray(meta.mediaIds) ? meta.mediaIds : [],
    // Notes-only decorations a task never has. Spelled out rather than left
    // undefined so the row components never have to guess.
    thumbUrl: null,
    sharedBy: null,
    // What makes this a task rather than only a note.
    __task: true,
    // The task's whole meta blob, carried so an edit can merge into it rather
    // than replace it — a recurring task keeps its per-day ticks in there, and
    // a PATCH that overwrote meta would wipe them.
    __meta: meta,
    dueDate: task.dueDate || null,
    time: task.time || null,
    priority: task.priority || 'medium',
    project: task.project || null,
  };
}

/** Did this row come from the tasks table? */
export const isTaskTodo = (n) => !!(n && n.__task);

/**
 * The inbox: open, and not on a day yet.
 *
 * Completed ones are out because an inbox is a queue of things still to
 * decide; a finished task is decided. Scheduled ones are out because they have
 * already left the inbox — that IS what scheduling one means.
 */
export function isInboxTodo(n) {
  if (!n || !isTaskTodo(n)) return false;
  return !n.done && !n.dueDate;
}

/**
 * Order the Todos tab: the inbox first, then everything with a day on it,
 * newest first within each.
 *
 * Inbox-first rather than one flat date sort because the two halves answer
 * different questions. The dated ones you will meet again on the calendar, on
 * the day they matter. The undated ones you will only ever meet HERE — so if
 * they sort below a month of scheduled work, the inbox is a place things go to
 * be forgotten.
 */
export function orderTodos(list) {
  const at = (n) => (typeof n?.createdAt === 'number' ? n.createdAt : Date.parse(n?.createdAt || '') || 0);
  const rank = (n) => (isInboxTodo(n) ? 0 : 1);
  return [...(list || [])].sort((a, b) => (rank(a) - rank(b)) || (at(b) - at(a)));
}

/**
 * What the composer sends when a to-do is created or edited.
 *
 * `mediaIds` is folded into meta rather than sent as a column, and only when
 * there are some — a PATCH that always carried `meta` would clobber the
 * completedDates a recurring task keeps there.
 */
export function todoTaskPayload({ content, description, tags, mediaIds, done }, prevMeta) {
  const payload = {
    title: String(content || '').trim(),
    description: String(description || '').trim(),
    tags: Array.isArray(tags) ? tags : [],
  };
  if (done !== undefined) payload.completed = !!done;
  if (Array.isArray(mediaIds) && mediaIds.length > 0) {
    payload.meta = { ...(prevMeta && typeof prevMeta === 'object' ? prevMeta : {}), mediaIds };
  }
  return payload;
}

/**
 * The merged timeline for the All tab: plain notes and tasks in one list,
 * newest first.
 *
 * Tasks whose item_type is an event or a birthday are dropped — they are
 * calendar furniture, not things you tick off, and a birthday in a to-do list
 * is noise you cannot act on.
 */
export function mergeNotesAndTasks(notes, tasks) {
  const at = (n) => (typeof n?.createdAt === 'number' ? n.createdAt : Date.parse(n?.createdAt || '') || 0);
  const todos = (tasks || [])
    .filter((t) => (t?.itemType || TODO_ITEM_TYPE) === TODO_ITEM_TYPE)
    .map(taskAsTodo)
    .filter(Boolean);
  // Plain notes only: a legacy `type='todo'` note would otherwise show up
  // beside the task it was migrated into. The migration marks those, but this
  // is the belt to that braces — an unmigrated pond still reads correctly.
  const plain = (notes || []).filter((n) => n && (n.type || 'note') !== 'todo');
  return [...plain, ...todos].sort((a, b) => at(b) - at(a));
}

/** "3 in the inbox" — what the Todos tab says about what is waiting. */
export function inboxCountLabel(n) {
  if (n <= 0) return null;
  return n === 1 ? '1 in the inbox' : `${n} in the inbox`;
}
