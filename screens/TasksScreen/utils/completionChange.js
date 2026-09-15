/**
 * completionChange — what ticking (or un-ticking) a task turns it into, and the
 * SMALLEST patch that records it.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * Completion used to be saved by POSTing the whole task list, and the server
 * answers that by deleting every row you own and re-inserting what it was
 * sent. Two devices then overwrite each other: whoever saves last republishes
 * its own snapshot, so a tick made on the phone disappears when the desktop
 * saves anything at all, and the other way round. The fix is to stop sending
 * lists for a tick — this returns the few fields that actually changed, which
 * the server merges into the one row (PATCH /api/tasks/:id).
 *
 * `next` is the task as the UI should paint it immediately; `patch` is what
 * goes to the server; `isTicking` says whether this was a completion (so the
 * caller can celebrate) rather than an undo.
 *
 * The recurrence rules are unchanged, and deliberately so — they are shared
 * with the web app:
 *   • a recurring task NEVER sets `completed`; the series stays alive and the
 *     day is recorded in meta.completedDates
 *   • ticking advances dueDate, un-ticking pulls it back, and an off-pattern
 *     day (an overdue series completed from a list with no day context) jumps
 *     to the next on-pattern date instead of moving the anchor
 */
import {
  advanceDueDate, minDate, maxDate, localTodayStr, lastCompletedDate,
  matchesRecurrence, nextOccurrenceAfter,
} from './taskHelpers';

/**
 * @param task            the task as it is now
 * @param occurrenceDate  the day being ticked, when the caller has one (the day
 *                        panel does; a flat list does not)
 * @param nowMs           clock, injectable for tests
 * @returns {{ next: object, patch: object, isTicking: boolean }}
 */
export function completionChange(task, occurrenceDate = null, nowMs = Date.now()) {
  const rec = task.recurring || task.recurrence || 'none';
  const nowIso = new Date(nowMs).toISOString();

  if (rec && rec !== 'none') {
    const today = localTodayStr();
    const last = lastCompletedDate(task);
    // done-now must MIRROR isTaskDoneNow (including a legacy completed=true
    // flag) or the row reads checked while this ticks, and the check can never
    // be cleared.
    const doneNow = task.completed || (!!last && last >= today);
    const occ = occurrenceDate || (doneNow ? last : (maxDate(task.dueDate, today) || today));
    const prev = Array.isArray(task.meta?.completedDates) ? task.meta.completedDates : [];
    const isTicking = !!occ && !prev.includes(occ);
    const nextCompletedDates = !occ
      ? prev
      : isTicking
        ? [...new Set([...prev, occ])] // dedup: a rapid double-tap can't duplicate the date
        : prev.filter((d) => d !== occ);

    let nextDueDate = task.dueDate;
    if (occ && task.dueDate) {
      if (isTicking) {
        const onPattern = occ === task.dueDate || occ < task.dueDate || matchesRecurrence(task.dueDate, rec, occ);
        const stepped = onPattern ? advanceDueDate(occ, rec) : nextOccurrenceAfter(task.dueDate, rec, occ);
        nextDueDate = maxDate(task.dueDate, stepped);
      } else {
        const onPattern = occ === task.dueDate || matchesRecurrence(occ, rec, task.dueDate) || matchesRecurrence(task.dueDate, rec, occ);
        nextDueDate = onPattern ? minDate(task.dueDate, occ) : task.dueDate;
      }
    }

    const meta = { ...(task.meta || {}), completedDates: nextCompletedDates };
    const next = {
      ...task,
      dueDate: nextDueDate,
      // A live series never holds the done-forever flag; clearing it also
      // un-sticks legacy completed=true recurring rows.
      completed: false,
      completedAt: isTicking ? nowMs : task.completedAt,
      completedTime: isTicking ? nowIso : task.completedTime,
      meta,
    };
    // `meta` goes whole because the column is one blob — but it is THIS task's
    // meta with one key replaced, never a rebuild, so nothing else in it is
    // lost.
    const patch = {
      completed: false,
      dueDate: nextDueDate ?? null,
      meta,
      ...(isTicking ? { completedAt: nowMs, completedTime: nowIso } : {}),
    };
    return { next, patch, isTicking };
  }

  const completed = !task.completed;
  const next = {
    ...task,
    completed,
    completedAt: completed ? nowMs : null,
    completedTime: completed ? nowIso : null,
  };
  return {
    next,
    patch: { completed, completedAt: next.completedAt, completedTime: next.completedTime },
    isTicking: completed,
  };
}

export default completionChange;
