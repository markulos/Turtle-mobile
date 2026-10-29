/**
 * "Single event (appointment)" — whether a task is pinned to one calendar slot.
 *
 * This used to be stored by overwriting the task's createdAt with midnight of
 * its dueDate. It is a flag hidden in a timestamp, and for an appointment in
 * the FUTURE it writes a creation time that has not happened yet — so the task
 * leads every newest-first list for as long as that date is ahead. The Notes
 * timeline merges notes and to-dos on createdAt, which is why Mark's December
 * office party sat above everything he had saved that week.
 *
 * The flag lives in `meta.appointment` now — a real field in the blob the pond
 * already round-trips. createdAt means when the row was made, and nothing else.
 */

/**
 * Both spellings of the legacy flag, still READ so an appointment made before
 * this change reads as one on a pond that has not restarted into the heal yet.
 * This app wrote LOCAL midnight of the due date and the web app wrote UTC
 * midnight, so the old encoding did not even agree with itself across the two.
 */
function legacyDays(createdAt) {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return [];
  const p = (n) => String(n).padStart(2, '0');
  return [
    d.toISOString().slice(0, 10),
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
  ];
}

/**
 * A task with a time is a fixed slot whatever its meta says — the rule the
 * pond's own rollover honours (services/taskRolloverService.js). Otherwise the
 * stored flag decides, falling back to the legacy encoding.
 */
export function isAppointment(task) {
  if (!task) return false;
  if (typeof task.time === 'string' && task.time.trim() !== '') return true;
  if (task.meta && typeof task.meta === 'object' && task.meta.appointment === true) return true;
  if (task.createdAt && task.dueDate) return legacyDays(task.createdAt).includes(task.dueDate);
  return false;
}
