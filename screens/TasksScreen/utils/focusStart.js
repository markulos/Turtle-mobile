/**
 * What starting a focus session should write onto the task it is for.
 *
 * A task sitting under "any time" has no place on a day's timeline, so the
 * moment you begin working on it the schedule is saying something that is no
 * longer true. Stamping the clock moves the card out of the To-Do list and onto
 * today's timeline at the minute the block began — which is also the answer to
 * "what did I do this morning" tomorrow.
 *
 * ─── The two rules ─────────────────────────────────────────────────────────
 *
 *   · THE TIME IS ONLY SET WHERE THERE IS NONE. A task you deliberately
 *     scheduled for 4 pm and started early keeps the 4 pm you gave it. That
 *     guard is also what makes the STAMP a first-block behaviour without anyone
 *     counting blocks: after the first one the task is timed, so a second start
 *     finds no time to set.
 *   · THE DAY MOVES ANYWAY. A timed task sitting on next Tuesday that you
 *     start a session on today comes to today and keeps its 4 pm — the block is
 *     real and it is happening now, and a slot on a day you were not working is
 *     a record of nothing. Starting a session is how a task lands on today; it
 *     is the default, not something you opt into.
 *   · EXCEPT A SERIES OR A FACT. A recurring task's dueDate is the anchor of
 *     every future occurrence, and an event or birthday is a fact about a day
 *     rather than a plan for one. Both keep their date; you can still focus on
 *     them.
 *   · THE DAY IS TODAY, because the session is happening now. `dueDate` rides
 *     along rather than being left alone because an untimed task can be an
 *     undated one — the backlog — and a time with no day is not a place on any
 *     timeline. A task parked on a later day that you start working on today
 *     moves to today for the same reason: the block is real and it is happening
 *     now, and a slot on a day you were not working is a record of nothing.
 *
 * Pure, and deliberately free of react-native imports: every way into a focus
 * session runs through this one function, so it is the thing worth testing on
 * its own.
 */

/** Today as `YYYY-MM-DD`, in LOCAL time (never toISOString, which is UTC). */
export function todayStr(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * startPatch — the patch to merge onto `task`, or null when there is nothing
 * to write.
 *
 * @param {object|null} task  the task the block is for (null for a loose block)
 * @param {Date|number} [now] when the block started; defaults to the real clock
 * @param {string} [dayStr]   override the day. Callers should not normally pass
 *                            this — it exists so a test can pin a day without
 *                            also having to pin the clock.
 */
export function startPatch(task, now = new Date(), dayStr) {
  if (!task) return null;
  const d = now instanceof Date ? now : new Date(now);
  const today = dayStr || todayStr(d);

  // A SERIES, or something that is not a task, keeps its own date. Moving the
  // dueDate of a recurring task shifts every future occurrence with it, and an
  // event or a birthday is a fact about a day rather than a plan for one — you
  // can focus on either without rewriting the calendar.
  const repeats = (task.recurring || task.recurrence || 'none') !== 'none';
  const kind = task.itemType || 'task';
  if (repeats || kind !== 'task') return null;

  // No time: the block's own minute becomes the task's slot, on today.
  if (!task.time) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return { dueDate: today, time: `${hh}:${mm}` };
  }

  // TIMED, BUT NOT ON TODAY. Starting a session is the moment the work is
  // really happening, so the task comes to today — and it KEEPS the time it was
  // given, because that time was a deliberate choice and this is a change of
  // day, not a re-plan. (A task already on today with a time is left entirely
  // alone: it is where it says it is.)
  if (task.dueDate !== today) return { dueDate: today };
  return null;
}
