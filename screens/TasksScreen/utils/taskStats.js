/**
 * taskStats — everything the Stats panel draws, computed once, in plain JS.
 *
 * Pure and free of react-native imports (same rule as `overviewStats` and
 * `statsFormat`), so every number here is testable without rendering a chart.
 * The panel's job is then only to draw what this returns.
 *
 * ─── What gets counted, and what deliberately does not ──────────────────────
 *
 * TASKS ONLY. Events and birthdays live in the same list but are not work — an
 * "87% complete" that counted birthdays would be measuring the calendar, not
 * the person. Same rule `overviewStats` already applies.
 *
 * COMPLETION TIME comes from `completedAt` (epoch ms) where a task carries one.
 * A task finished before that field existed has no date to sit on, so the
 * activity charts are explicitly "of the N completions we can date" rather than
 * a silent undercount — see `datedCompletions` / `undatedDone`, which the panel
 * shows rather than hides.
 *
 * A DAY IS A LOCAL DAY. Every bucket key is the local YYYY-MM-DD, not a UTC
 * slice of an epoch: a task finished at 11pm belongs to that evening, and west
 * of UTC the two disagree.
 */

import { isTaskDoneNow, itemTypeOf, localTodayStr, parseLocalYMD } from './taskHelpers';

const MS_PER_DAY = 86400000;

/** Local YYYY-MM-DD for an epoch ms / Date. */
export function dayKey(when) {
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole days between two YYYY-MM-DD strings (b - a), or null if either is bad. */
export function daysBetween(a, b) {
  const da = parseLocalYMD(a);
  const db = parseLocalYMD(b);
  if (!da || !db) return null;
  return Math.round((db.getTime() - da.getTime()) / MS_PER_DAY);
}

/** The last `n` local day keys, oldest first, ending on `todayStr`. */
export function lastDays(todayStr, n) {
  const end = parseLocalYMD(todayStr) || new Date();
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const d = new Date(end);
    d.setDate(end.getDate() - (n - 1 - i));
    out[i] = dayKey(d);
  }
  return out;
}

/**
 * Consecutive days ending today (or yesterday) with at least one completion.
 *
 * Yesterday counts as alive: a streak should not be declared broken at 00:01
 * just because today has not started yet. It breaks on the first day with
 * nothing, looking back.
 */
export function currentStreak(byDay, todayStr) {
  const end = parseLocalYMD(todayStr);
  if (!end) return 0;
  const has = (d) => (byDay.get(dayKey(d)) || 0) > 0;
  const cursor = new Date(end);
  if (!has(cursor)) {
    cursor.setDate(cursor.getDate() - 1);
    if (!has(cursor)) return 0;   // nothing today and nothing yesterday
  }
  let n = 0;
  while (has(cursor)) {
    n += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * @param {object[]} tasks   every item on the screen (events/birthdays included; filtered here)
 * @param {string} todayStr  local YYYY-MM-DD
 * @param {object} [opts]    { heatmapDays = 91, weeks = 8, topBoards = 6 }
 */
export function taskStats(tasks, todayStr = localTodayStr(), opts = {}) {
  const { heatmapDays = 91, weeks = 8, topBoards = 6 } = opts;

  const items = (tasks || []).filter((t) => t && itemTypeOf(t) === 'task');
  const byDay = new Map();          // day → completions
  const byWeekday = new Array(7).fill(0);
  const boardOpen = new Map();      // board → open count
  let done = 0;
  let open = 0;
  let late = 0;
  let datedCompletions = 0;
  let oldestOpen = null;            // { title, dueDate, daysLate }

  for (const t of items) {
    const isDone = !!(t.completed || isTaskDoneNow(t, todayStr));
    if (isDone) {
      done += 1;
      const key = t.completedAt ? dayKey(t.completedAt) : null;
      if (key) {
        datedCompletions += 1;
        byDay.set(key, (byDay.get(key) || 0) + 1);
        const d = parseLocalYMD(key);
        if (d) byWeekday[d.getDay()] += 1;
      }
    } else {
      open += 1;
      const board = t.project || '';
      boardOpen.set(board, (boardOpen.get(board) || 0) + 1);
      if (t.dueDate && t.dueDate < todayStr) {
        late += 1;
        const overdueBy = daysBetween(t.dueDate, todayStr);
        if (overdueBy != null && (!oldestOpen || overdueBy > oldestOpen.daysLate)) {
          oldestOpen = { id: t.id, title: t.title || 'Untitled', dueDate: t.dueDate, daysLate: overdueBy };
        }
      }
    }
  }

  const total = done + open;

  // ── activity heatmap: one cell per local day ───────────────────────────────
  const heatDays = lastDays(todayStr, heatmapDays);
  const heat = heatDays.map((day) => ({ day, count: byDay.get(day) || 0 }));
  const heatMax = heat.reduce((m, c) => Math.max(m, c.count), 0);

  // ── weekly columns: `weeks` buckets of 7 days, oldest first ────────────────
  const weekDays = lastDays(todayStr, weeks * 7);
  const weekBuckets = [];
  for (let i = 0; i < weeks; i += 1) {
    const slice = weekDays.slice(i * 7, i * 7 + 7);
    weekBuckets.push({
      start: slice[0],
      end: slice[slice.length - 1],
      count: slice.reduce((n, d) => n + (byDay.get(d) || 0), 0),
    });
  }
  const weekMax = weekBuckets.reduce((m, w) => Math.max(m, w.count), 0);

  // ── weekday profile ───────────────────────────────────────────────────────
  const weekdayMax = byWeekday.reduce((m, n) => Math.max(m, n), 0);
  const weekdays = byWeekday.map((count, i) => ({ label: WEEKDAYS[i], count }));
  const bestWeekday = weekdayMax > 0
    ? weekdays.reduce((best, w) => (w.count > best.count ? w : best), weekdays[0])
    : null;

  // ── boards carrying the open work ─────────────────────────────────────────
  // Top N by open count, with the tail folded into one "Other" row rather than
  // given colours of its own — past ~7 classes adjacent bins stop being
  // tellable apart, and the story here is magnitude, not identity.
  const boardsAll = Array.from(boardOpen.entries())
    .map(([name, count]) => ({ name: name || null, count }))
    .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
  const boards = boardsAll.slice(0, topBoards);
  const tail = boardsAll.slice(topBoards);
  if (tail.length) {
    boards.push({ name: '__other__', count: tail.reduce((n, b) => n + b.count, 0), otherOf: tail.length });
  }
  const boardMax = boards.reduce((m, b) => Math.max(m, b.count), 0);

  const busiestDay = heat.reduce((best, c) => (c.count > (best?.count || 0) ? c : best), null);

  return {
    total,
    done,
    open,
    late,
    completionPct: total > 0 ? Math.round((done / total) * 100) : 0,
    // Honesty about the activity charts' coverage: completions we can place on
    // a day, and the ones we cannot.
    datedCompletions,
    undatedDone: done - datedCompletions,
    heat,
    heatMax,
    weeks: weekBuckets,
    weekMax,
    weekAverage: weeks > 0 ? Math.round(weekBuckets.reduce((n, w) => n + w.count, 0) / weeks) : 0,
    weekdays,
    weekdayMax,
    bestWeekday,
    boards,
    boardMax,
    streak: currentStreak(byDay, todayStr),
    busiestDay: busiestDay && busiestDay.count > 0 ? busiestDay : null,
    oldestOpen,
  };
}

export default taskStats;
