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
 *   · ONLY WHERE THERE IS NO TIME YET. A task you deliberately scheduled for
 *     4 pm and started early keeps the 4 pm you gave it. That guard is also
 *     what makes this a FIRST-block behaviour without anyone counting blocks:
 *     after the first one the task is timed, so a second start finds nothing to
 *     set.
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
  if (!task || task.time) return null;
  const d = now instanceof Date ? now : new Date(now);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return { dueDate: dayStr || todayStr(d), time: `${hh}:${mm}` };
}
