/**
 * focusList — what the Focus deck's task list shows, and in what order.
 *
 * Mark, 2026-11-16: "in the focus tab for the timer panel can you have a list
 * of the most recent focus tasks underneath it as one panel and have a search
 * to search tasks and pin them to be on top then once the task is completed
 * it gets unpinned."
 *
 * Four rules, and they are all here rather than in the component because
 * every one of them is a thing that can be quietly wrong on a phone and
 * obvious in a table.
 *
 * ── Recent means recent TASKS, not recent blocks ──────────────────────────
 *
 * The page already lists recent BLOCKS further down, and that list repeats a
 * task once per session — six rows for an afternoon on one thing. This is the
 * list you start from, so it is one row per task, ordered by when you last
 * worked on it.
 *
 * ── Finished work leaves ──────────────────────────────────────────────────
 *
 * A completed task is not something to start a session on, so it drops out of
 * the recent list AND loses its pin. That is the unpinning Mark asked for and
 * it is derived, not an event: there is no "task completed" to listen for
 * here, and a pin that survived completion would sit at the top of the list
 * for ever on work that is done.
 */
import { isTaskDoneNow, localTodayStr } from './taskHelpers';

/** How many recent tasks the deck offers before you have to search. */
export const RECENT_LIMIT = 5;
/** …and how many a search may put on screen. */
export const SEARCH_LIMIT = 8;

/** Finished — the app's own test, so this list agrees with every other. */
const done = (task, todayStr) => !task || isTaskDoneNow(task, todayStr);

/**
 * The tasks you have most recently focused on, newest first, one row each.
 *
 * `sessions` is the pomodoro log (any order); `taskOfId` resolves an id to a
 * live task, or null once it has been deleted — in which case there is
 * nothing to start and the row is dropped rather than shown as a ghost.
 */
export function recentFocusTasks(sessions, taskOfId, { limit = RECENT_LIMIT, todayStr } = {}) {
  const today = todayStr || localTodayStr();
  const seen = new Set();
  const out = [];
  const rows = [...(sessions || [])]
    .filter((s) => s && s.taskId)
    .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0));
  for (const s of rows) {
    if (seen.has(s.taskId)) continue;
    seen.add(s.taskId);
    const task = taskOfId?.(s.taskId) || null;
    if (done(task, today)) continue;
    out.push(task);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Tasks matching what has been typed — every task, not only the recent ones,
 * because the point of the search is to reach something you have never put a
 * block on.
 *
 * Finished work is left out for the same reason it leaves the recent list:
 * you cannot start a session on it.
 */
export function searchTasks(tasks, query, { limit = SEARCH_LIMIT, todayStr } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const today = todayStr || localTodayStr();
  return (tasks || [])
    .filter((t) => t && !done(t, today) && String(t.title || '').toLowerCase().includes(q))
    .slice(0, limit);
}

/**
 * PINNED FIRST, in the order they were pinned, then everything else in the
 * order it came.
 *
 * A pinned task that is not in `list` is still shown — that is the whole
 * point of pinning something you found by searching, and without this it
 * would vanish the moment the search box was cleared.
 */
export function orderWithPins(list, pins, taskOfId, { todayStr } = {}) {
  const today = todayStr || localTodayStr();
  const ids = new Set();
  const top = [];
  for (const id of pins || []) {
    const task = taskOfId?.(id) || (list || []).find((t) => t?.id === id) || null;
    // A pin on finished or deleted work is not shown — see prunePins, which
    // is what actually forgets it.
    if (done(task, today)) continue;
    if (ids.has(task.id)) continue;
    ids.add(task.id);
    top.push(task);
  }
  const rest = (list || []).filter((t) => t && !ids.has(t.id));
  return { pinned: top, rest };
}

/**
 * The pins worth keeping: the ones whose task still exists and is still open.
 *
 * THIS is the unpinning. Completing a task does not fire anything here, so
 * the pin is dropped the next time the list is built — which is every render
 * the task list changes, i.e. immediately after the tick lands.
 */
export function prunePins(pins, taskOfId, { todayStr } = {}) {
  const today = todayStr || localTodayStr();
  return (pins || []).filter((id) => !done(taskOfId?.(id) || null, today));
}

/** Pin it, or unpin it. New pins go to the END, so the first stays the first. */
export function togglePin(pins, id) {
  const list = pins || [];
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export default {
  RECENT_LIMIT, SEARCH_LIMIT, orderWithPins, prunePins, recentFocusTasks, searchTasks, togglePin,
};
