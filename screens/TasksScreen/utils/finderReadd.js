/**
 * What the key beside a finder row actually DOES — which is not one thing.
 *
 * The day planner's finder lists tasks you already have, and offers to put one
 * on the day you are looking at. That offer used to be a single verb: COPY.
 * Every press made a fresh task, whatever the original was, so pulling an open
 * task forward left you with two of it — the old one still sitting on the day
 * you were trying to move it off.
 *
 * Which it should be depends entirely on the task:
 *
 *   · FINISHED — you did it, and you are doing it again. A copy is right, and
 *     the original stays where it is as the record that you did it then.
 *   · OPEN — it is the same piece of work, not a second one. It MOVES. This is
 *     "continue it", and a copy here is a duplicate you then have to tidy up.
 *   · ALREADY ON THIS DAY — nothing to do. The offer should not be made at
 *     all, which is the caller's job; this names the case so it can be asked.
 *
 * ─── The repeating exception ───────────────────────────────────────────────
 *
 * A repeating task's `dueDate` is the SERIES ANCHOR, not an instance: moving it
 * drags every future occurrence along with it. So a repeater is copied even
 * when it is open — you get a one-off on this day and the series carries on
 * untouched. The day pane's time editor already refuses to move a repeater for
 * exactly this reason; this is the same rule, said once more where the second
 * caller can reach it.
 */

/** The app's rule for "finished", the same one taskSearch's scopes use. */
export const isFinishedTask = (t) => !!(t?.completed || t?.completedAt);

/** A repeater, however the task spells it. */
export const repeatsTask = (t) => String(t?.recurring || t?.recurrence || 'none') !== 'none';

export const BRING_CONTINUE = 'continue';
export const BRING_READD = 're-add';
export const BRING_HERE = 'already-here';

/**
 * Decide what pressing the key on `task` means, for the day `dayStr`.
 *
 * @param task    the row's task
 * @param dayStr  'YYYY-MM-DD', the day the finder is adding to
 * @param time    'HH:MM' pending on the finder's clock chip, or null
 * @returns { action, patch } — `patch` is set only for a continue, and holds
 *          exactly the fields that are actually changing.
 */
export function bringToDay(task, dayStr, { time = null } = {}) {
  if (!task) return { action: BRING_READD };
  // Done is done: this is a new go at it, and the old one stays as the record.
  if (isFinishedTask(task)) return { action: BRING_READD };
  // A repeater cannot be moved without moving the series, so it is copied.
  if (repeatsTask(task)) return { action: BRING_READD };

  const patch = {};
  if (dayStr && task.dueDate !== dayStr) patch.dueDate = dayStr;
  // A time is only ever ADDED here, never cleared: arriving with no time set
  // on the chip means "no opinion", not "make it untimed".
  if (time && task.time !== time) patch.time = time;

  // Open, here, and nothing to change — so there is nothing to offer.
  if (Object.keys(patch).length === 0) return { action: BRING_HERE };
  return { action: BRING_CONTINUE, patch };
}
