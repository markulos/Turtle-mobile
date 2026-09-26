/**
 * What the Focus tab reads: a run of focus blocks turned into the handful of
 * numbers worth putting on a page.
 *
 * Pure, and here rather than in the view, for the same reason the pointer's
 * arithmetic is: the aggregation has real edges — a block that was abandoned,
 * a streak broken by a day with nothing in it, a run that started before
 * midnight and ended after it — and every one of them is a rule you want
 * pinned by a test rather than discovered on the page.
 *
 * The input is `GET /pomodoros` as the screen already fetches it:
 *   { id, taskId, startedAt, completedAt, durationMinutes, status }
 * `status === 'completed'` means the block was SEEN THROUGH. Anything else was
 * started and abandoned, and must never count as focus received — but it is
 * still worth counting as an attempt, which is why both are returned.
 */

const MS_DAY = 86400000;

/**
 * ─── The pond keeps focus blocks in TWO stores ──────────────────────────────
 *
 * `task_pomodoros` (GET /pomodoros) holds blocks attached to a task. The
 * in-memory chat timer's history (GET /pomodoro/stats) holds the ones that were
 * not — a plain "Start focus" with nothing pinned to it, which is most of what
 * the Focus tab starts, since the tab's own key does not ask you to pick a task
 * first. The server will not accept a task_pomodoros row without a taskId, so
 * loose blocks can only live in the second store.
 *
 * Read only the first and every loose block is invisible: you would run a focus
 * session on the Focus tab, watch the ring count it down, and find nothing in
 * the stats afterwards. So the page reads both and joins them here.
 *
 * ─── And one block can be in BOTH ──────────────────────────────────────────
 *
 * Starting a block from a TASK writes both rows — the chat command starts the
 * shared timer, and a task row goes in beside it so the card can show its
 * countdown. Naively concatenating would therefore count every task-linked
 * block twice and double every figure on the page.
 *
 * The two copies are the same event, so they start at the same moment: the task
 * row lands a few hundred milliseconds after the chat command travels the bus
 * and the socket. A minute of tolerance is far more than that gap and far less
 * than any real interval between two deliberately started pomodoros, and when
 * the two do collide the task row is the one kept — it is the copy that knows
 * which task the time went to.
 */
const TWIN_MS = 60000;

/**
 * One chat-timer session as a focus block, or null if it is not one.
 *
 * Breaks are dropped: a break is time you spent NOT focusing, and letting it
 * into this list would put it in the totals, the streak and the board split.
 * A 'stopped' run becomes 'cancelled', which is the word the task store uses
 * for the same thing — one vocabulary downstream.
 */
export function chatSessionToBlock(s) {
  if (!s || s.mode !== 'focus') return null;
  const startedAt = Number(s.startedAt);
  const endedAt = Number(s.endedAt);
  if (!Number.isFinite(startedAt)) return null;
  const totalSec = Number(s.totalDuration);
  return {
    id: s.id,
    // No task, which the board split reads as 'No Board'. Honest: the time was
    // spent, it just was not spent on a named thing.
    taskId: null,
    startedAt,
    completedAt: s.status === 'completed' && Number.isFinite(endedAt) ? endedAt : null,
    durationMinutes: Number.isFinite(totalSec) && totalSec > 0 ? Math.round(totalSec / 60) : null,
    status: s.status === 'completed' ? 'completed' : 'cancelled',
    // Kept so a reader can tell where a block came from. Nothing aggregates on
    // it; it is there for the next person debugging a figure.
    source: 'chat',
  };
}

/**
 * The two stores as one run of blocks, newest first, with each block appearing
 * once. See the note above for why both, and why the task copy wins a tie.
 */
export function mergeFocusLog(taskBlocks, chatSessions) {
  const tasks = (Array.isArray(taskBlocks) ? taskBlocks : []).filter(Boolean);
  const taskStarts = tasks
    .map((p) => Number(p.startedAt))
    .filter(Number.isFinite);
  const loose = (Array.isArray(chatSessions) ? chatSessions : [])
    .map(chatSessionToBlock)
    .filter(Boolean)
    .filter((c) => !taskStarts.some((t) => Math.abs(t - c.startedAt) < TWIN_MS));
  return [...tasks, ...loose].sort((a, b) => Number(b.startedAt) - Number(a.startedAt));
}

/** Local YYYY-MM-DD for an epoch — the day a block BELONGS to is the day it started. */
export function dayKeyOf(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A block the user actually sat through. */
export function isCompleted(p) {
  return !!(p && p.status === 'completed' && p.completedAt);
}

/**
 * How long a block really ran, in minutes.
 *
 * Prefers the CLOCK over the plan: a 25-minute block stopped at 11 is eleven
 * minutes of focus, not twenty-five. Falls back to the planned length when the
 * stamps are unusable, and never returns a negative — a completedAt before its
 * startedAt is a clock that moved, not a block that ran backwards.
 */
export function actualMinutes(p) {
  if (!p) return 0;
  const start = Number(p.startedAt);
  const end = Number(p.completedAt);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return Math.max(0, Math.round((end - start) / 60000));
  }
  const planned = Number(p.durationMinutes);
  return Number.isFinite(planned) && planned > 0 ? Math.round(planned) : 0;
}

/**
 * Minutes of completed focus per day, keyed YYYY-MM-DD.
 *
 * Only completed blocks: the page's headline figure is time you spent, and an
 * abandoned block is time you did not.
 */
export function minutesByDay(list) {
  const out = {};
  for (const p of list || []) {
    if (!isCompleted(p)) continue;
    const key = dayKeyOf(Number(p.startedAt));
    if (!key) continue;
    out[key] = (out[key] || 0) + actualMinutes(p);
  }
  return out;
}

/**
 * The run of consecutive days ending today (or yesterday) with focus on them.
 *
 * Yesterday counts as alive: a streak that dies at midnight punishes you for
 * the hours before you have had a chance to keep it, and every habit tracker
 * worth using treats the current day as pending rather than as already lost.
 * It breaks on the first day with nothing in it.
 */
export function focusStreak(byDay, todayMs) {
  const today = dayKeyOf(todayMs);
  if (!today) return 0;
  const hasAny = (ms) => (byDay[dayKeyOf(ms)] || 0) > 0;
  // Where to start counting back from: today if it has focus, else yesterday
  // if it does — otherwise the streak is over.
  let cursor = todayMs;
  if (!hasAny(cursor)) {
    cursor -= MS_DAY;
    if (!hasAny(cursor)) return 0;
  }
  let n = 0;
  while (hasAny(cursor)) {
    n += 1;
    cursor -= MS_DAY;
  }
  return n;
}

/** Minutes as "1h 05m" / "45m" — terse enough for a stat tile. */
export function formatMinutes(mins) {
  const m = Math.max(0, Math.round(Number(mins) || 0));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${String(r).padStart(2, '0')}m`;
}

/**
 * The last `days` days, oldest first — the bar chart's spine.
 *
 * Built from the calendar rather than from the data so a day with NO focus is
 * still a bar of zero height: the gaps are the point of the chart.
 */
export function recentDays(byDay, todayMs, days = 7) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const ms = todayMs - i * MS_DAY;
    const key = dayKeyOf(ms);
    out.push({ key, ms, minutes: byDay[key] || 0 });
  }
  return out;
}

/**
 * Completed minutes by HOUR of the day a block started, 0–23.
 *
 * The one thing the totals cannot tell you: not how much you focus but WHEN —
 * whether your good hours are the ones you have been defending. Bucketed by
 * start for the same reason a block belongs to the day it started: that is the
 * hour you chose.
 */
export function minutesByHour(list) {
  const out = new Array(24).fill(0);
  for (const p of list || []) {
    if (!isCompleted(p)) continue;
    const d = new Date(Number(p.startedAt));
    if (Number.isNaN(d.getTime())) continue;
    out[d.getHours()] += actualMinutes(p);
  }
  return out;
}

/** The heaviest day on record: { key, minutes } — nulls when there is none. */
export function bestDay(byDay) {
  let best = null;
  for (const [key, minutes] of Object.entries(byDay || {})) {
    if (minutes > 0 && (!best || minutes > best.minutes)) best = { key, minutes };
  }
  return best;
}

/**
 * Everything the Focus page prints, in one pass.
 *
 * `boardOfTask` maps a taskId to the board it belongs to, so the page can say
 * WHERE the focus went — the one thing the block list cannot say by itself.
 */
export function focusStats(list, todayMs, boardOfTask) {
  const all = Array.isArray(list) ? list : [];
  const done = all.filter(isCompleted);
  const byDay = minutesByDay(all);
  const todayKey = dayKeyOf(todayMs);
  const week = recentDays(byDay, todayMs, 7);

  const boards = new Map();
  for (const p of done) {
    const board = (boardOfTask && boardOfTask(p.taskId)) || null;
    const name = board || 'No Board';
    const prev = boards.get(name) || { name, minutes: 0, sessions: 0 };
    prev.minutes += actualMinutes(p);
    prev.sessions += 1;
    boards.set(name, prev);
  }

  const totalMinutes = done.reduce((s, p) => s + actualMinutes(p), 0);
  return {
    // Headline
    todayMinutes: byDay[todayKey] || 0,
    todaySessions: done.filter((p) => dayKeyOf(Number(p.startedAt)) === todayKey).length,
    weekMinutes: week.reduce((s, d) => s + d.minutes, 0),
    streak: focusStreak(byDay, todayMs),
    // Totals across everything the server handed back
    totalSessions: done.length,
    totalMinutes,
    // Attempts that were not seen through. Not shown as a failure — shown so
    // the completed figure above it means something.
    abandoned: all.length - done.length,
    // The average block, which is the number that tells you whether your
    // 25 minutes is really 25 minutes.
    averageMinutes: done.length ? Math.round(totalMinutes / done.length) : 0,
    week,
    boards: [...boards.values()].sort((a, b) => b.minutes - a.minutes),
    // When, not how much.
    byHour: minutesByHour(all),
    best: bestDay(byDay),
    // The most recent blocks, newest first — the page's one piece of detail,
    // and the only place a single session is visible as itself.
    recent: [...done]
      .sort((a, b) => Number(b.startedAt) - Number(a.startedAt))
      .slice(0, 6)
      .map((p) => ({
        id: p.id,
        taskId: p.taskId,
        startedAt: Number(p.startedAt),
        minutes: actualMinutes(p),
        board: (boardOfTask && boardOfTask(p.taskId)) || null,
      })),
  };
}
