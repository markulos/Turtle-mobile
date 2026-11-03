/**
 * Which BAND an agenda row belongs to — history above, or the list below.
 *
 * The agenda is one flat chat-style list with a seam in it: "Past" scrolls up
 * out of view, "Upcoming" starts at the top of the screen. Which side a task
 * lands on decides whether you SEE it, because the page opens on the seam.
 *
 * ─── Why this is a module and not four lines in the screen ─────────────────
 *
 * It was four lines in the screen, inside a 400-line useMemo, and it carried a
 * bug nobody could find twice: picking "Everything" in the filter appeared to
 * do nothing at all. Every status branch in the app was checked and every one
 * of them was right — the rule that was wrong was this one, and it was the one
 * piece with no name and no test. So it has both now.
 *
 * ─── Completion is not a date ──────────────────────────────────────────────
 *
 * "Past" means two different things depending on what you asked to see:
 *
 *   · To do / Done — you asked for ONE KIND of work, so the band is a
 *     timeline of it and a finished task is behind you by definition. This is
 *     what "Done" relies on to read as an archive.
 *   · Everything — you asked for BOTH KINDS, so the band has to go back to
 *     meaning WHEN. Otherwise every completed task is filed above the seam,
 *     which is off-screen, and "Everything" looks exactly like "To do": the
 *     rows it added are all in the part of the list you are not looking at.
 *     That was the bug.
 *
 * So under Everything a task sits where its DATE puts it, ticked, and today's
 * finished work is visible in today's list — which is the thing picking
 * Everything was asking for.
 */
import { isTaskDoneNow } from './taskHelpers';

/** A task with a due date, as the agenda counts one. */
export const hasAgendaDate = (t) => typeof t?.dueDate === 'string' && !!t.dueDate;

/**
 * A task dated TODAY whose time has already gone by. Overdue, not upcoming —
 * and the two bands must agree on it exactly, or a row lands in both or
 * neither.
 */
export function duePassedToday(t, { todayStr, nowMs }) {
  if (!t || t.dueDate !== todayStr || !t.time) return false;
  const [h, m] = String(t.time).split(':').map(Number);
  const due = new Date(nowMs);
  due.setHours(h || 0, m || 0, 0, 0);
  return due.getTime() < nowMs;
}

/**
 * Is this row history?
 *
 * @param t             the task
 * @param todayStr      'YYYY-MM-DD' local today
 * @param nowMs         the clock, passed in so this stays pure and testable
 * @param statusFilter  'todo' | 'done' | 'all' — see the note above; only
 *                      'all' changes what the band MEANS
 */
export function isAgendaPast(t, { todayStr, nowMs, statusFilter = 'todo' }) {
  if (!t) return false;
  // Done is behind you — unless you asked for everything, where the band is
  // about when and a tick is just a tick.
  if (statusFilter !== 'all' && (t.completed || isTaskDoneNow(t))) return true;
  if (hasAgendaDate(t)) {
    if (t.dueDate < todayStr) return true;
    return duePassedToday(t, { todayStr, nowMs });
  }
  // Undated and not filed by completion: it is backlog, which lives below the
  // seam with the rest of the work you have not done.
  return false;
}
