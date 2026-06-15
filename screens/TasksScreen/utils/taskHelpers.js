// Format a "HH:MM" 24-hour time string into a 12-hour label, e.g.
// "14:05" → "2:05 PM". Pass { meridiem: false } for the compact subtask
// badge that omits the AM/PM suffix ("2:05"). Returns '' for empty input.
export const formatTime12h = (time, { meridiem = true } = {}) => {
  if (!time || typeof time !== 'string') return '';
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  const isPM = h >= 12;
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const base = `${displayH}:${m.toString().padStart(2, '0')}`;
  return meridiem ? `${base} ${isPM ? 'PM' : 'AM'}` : base;
};

// Format a YYYY-MM-DD due date into a short, human-friendly label for
// badges: "Today", "Tomorrow", "Yesterday", or "Mon, Jun 8" (the year
// is appended only when it differs from the current year). Returns ''
// for tasks with no due date so callers can conditionally render.
export const formatDueDate = (dueDate) => {
  if (!dueDate || typeof dueDate !== 'string') return '';
  const parts = dueDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return dueDate;
  const [y, m, d] = parts;
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return dueDate;

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((date - startOfToday) / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';

  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (y !== today.getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString('en-US', opts);
};

// True when a due date is strictly before today (an unmet deadline) —
// drives the red "overdue" tint on due-date badges.
export const isOverdue = (dueDate) => {
  if (!dueDate || typeof dueDate !== 'string') return false;
  const parts = dueDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return false;
  const [y, m, d] = parts;
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return date < startOfToday;
};

// Advance a recurring task's dueDate by one period. Used when a recurring
// task is completed from a task card — instead of marking it done forever,
// the dueDate moves to the next occurrence so the task stays active and
// reappears on its next scheduled day. Mirrors the web app's
// utils/recurrence.ts `advanceDueDate` so both clients behave identically
// (the field is `recurring` on mobile / the synced server column; values:
// none | daily | weekly | biweekly | monthly). Dates are YYYY-MM-DD local
// strings — we avoid `new Date(str)` so date-only strings aren't shifted by
// the UTC-midnight parse in timezones west of UTC.
export const advanceDueDate = (currentDueDate, recurring) => {
  if (!currentDueDate || typeof currentDueDate !== 'string') return currentDueDate;
  if (!recurring || recurring === 'none') return currentDueDate;
  const parts = currentDueDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return currentDueDate;
  const [y, m, d] = parts;
  const base = new Date(y, m - 1, d);
  if (Number.isNaN(base.getTime())) return currentDueDate;

  const next = new Date(base);
  switch (recurring) {
    case 'daily':
      next.setDate(next.getDate() + 1);
      break;
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'biweekly':
      next.setDate(next.getDate() + 14);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      // Re-pin day-of-month: if the next month is short and JS rolled us
      // into the following month, clamp to the last day of the intended
      // month so the task doesn't skip a period entirely.
      if (next.getDate() !== base.getDate()) next.setDate(0);
      break;
    default:
      return currentDueDate;
  }

  const ny = next.getFullYear();
  const nm = String(next.getMonth() + 1).padStart(2, '0');
  const nd = String(next.getDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
};

// ── Calendar item-type helpers ────────────────────────────────────────
// Birthdays/events ride on the same task object as ordinary tasks (see
// ITEM_TYPES in constants). These helpers centralise the "what kind is this"
// reads so the calendar, day planner, and detail card all agree.

// The item's kind, defaulting to 'task' for every legacy row.
export const itemTypeOf = (item) => (item && item.itemType) || 'task';

// Per-type default colours (kept here to avoid a constants import cycle with
// rendering code that already imports taskHelpers).
const TYPE_FALLBACK_COLOR = { event: '#2196F3', birthday: '#E91E63' };

// The colour to render an item with: its explicit meta.color, else a per-type
// default, else null (plain tasks fall back to their project/priority colour).
export const itemColorOf = (item) => {
  const m = item && item.meta;
  if (m && typeof m.color === 'string' && m.color) return m.color;
  return TYPE_FALLBACK_COLOR[itemTypeOf(item)] || null;
};

// MaterialCommunityIcons glyph for each item type — used as the leading icon
// on day-planner rows and the detail card.
export const itemIconOf = (item) => {
  switch (itemTypeOf(item)) {
    case 'event':    return 'calendar-star';
    case 'birthday': return 'cake-variant';
    default:         return 'check-circle-outline';
  }
};

// Birthdays repeat every year (unless meta.yearly was explicitly turned off).
export const isYearlyOccasion = (item) =>
  itemTypeOf(item) === 'birthday' && !(item.meta && item.meta.yearly === false);

// True when `dateStr` (YYYY-MM-DD) falls on the same month+day as `dueDate`,
// ignoring the year — the match used to recur birthdays across every year.
export const sameMonthDay = (dueDate, dateStr) => {
  if (!dueDate || !dateStr) return false;
  return dueDate.slice(5) === dateStr.slice(5);
};

export const normalizeTags = (tags) => {
  if (Array.isArray(tags)) return tags;
  if (!tags) return [];
  return tags.split(',').map(t => t.trim()).filter(Boolean);
};

export const parseTags = (input) => 
  input.split(/[,\s]+/).map(t => t.trim().toLowerCase()).filter(Boolean);

export const sortTasks = (a, b) => {
  // First sort by completion status (incomplete first)
  if (a.completed !== b.completed) {
    return a.completed ? 1 : -1;
  }
  
  // Then sort by time (earliest to latest) if both have time
  if (a.time && b.time) {
    return a.time.localeCompare(b.time);
  }
  
  // Tasks with time come before tasks without time
  if (a.time && !b.time) return -1;
  if (!a.time && b.time) return 1;
  
  // Finally sort by createdAt (newest first)
  return (b.createdAt || 0) - (a.createdAt || 0);
};

export const getPriorityColor = (priority, theme) => {
  if (theme) {
    // Use theme colors for dark mode
    const colors = { 
      high: theme.colors.accentError, 
      medium: theme.colors.accentWarning, 
      low: theme.colors.accentSuccess 
    };
    return colors[priority] || theme.colors.textTertiary;
  }
  // Fallback for non-theme usage
  const colors = { high: '#f44336', medium: '#ff9800', low: '#4caf50' };
  return colors[priority] || '#999';
};

// NEW: Subtask utilities
export const areAllSubtasksCompleted = (subtasks) => {
  if (!subtasks || subtasks.length === 0) return false;
  return subtasks.every(st => st.completed);
};

export const toggleSubtaskComplete = (subtasks, subtaskId) => {
  return subtasks.map(st => {
    if (st.id !== subtaskId) return st;
    const newCompleted = !st.completed;
    return {
      ...st,
      completed: newCompleted,
      completedAt: newCompleted ? Date.now() : null,
      completedTime: newCompleted ? new Date().toISOString() : null
    };
  });
};

export const addSubtask = (subtasks, title, time = null) => {
  return [...(subtasks || []), {
    id: Date.now().toString(),
    title: title.trim(),
    completed: false,
    createdAt: Date.now(),
    time: time
  }];
};

export const deleteSubtask = (subtasks, subtaskId) => {
  return subtasks.filter(st => st.id !== subtaskId);
};

export const updateSubtask = (subtasks, subtaskId, updates) => {
  return subtasks.map(st =>
    st.id === subtaskId ? { ...st, ...updates } : st
  );
};

// ── Countdown / pending-age timers ────────────────────────────────────
// Mirrors the web app's utils/countdown.ts so both clients label tasks
// identically. Every incomplete task gets a live "timer":
//   upcoming → counting DOWN to a future dueDate(+time)
//   started  → a timed dueDate that passed → NEGATIVE counter
//   today    → an all-day task (dueDate, no time) due today
//   pending  → no dueDate → counting UP from createdAt (age)
// Completed tasks have no timer (getTaskTimer → null). Dates are parsed
// as LOCAL (never `new Date("YYYY-MM-DD")`) so they don't shift west of UTC.
const _MS = { sec: 1000, min: 60000, hour: 3600000, day: 86400000 };

const _startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const _targetDate = (task) => {
  if (!task || !task.dueDate || typeof task.dueDate !== 'string') return null;
  const parts = task.dueDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [y, m, d] = parts;
  if (task.time && typeof task.time === 'string') {
    const [h, mi] = task.time.split(':').map(Number);
    if (!Number.isNaN(h) && !Number.isNaN(mi)) return new Date(y, m - 1, d, h, mi);
  }
  return new Date(y, m - 1, d);
};

// Compact duration like "3d 2h", "2h 15m", "5m 12s", "45s", "<1m".
export const formatDuration = (ms, withSeconds = false) => {
  const t = Math.max(0, Math.floor(ms));
  if (!withSeconds && t < _MS.min) return '<1m';
  let totalSec = Math.floor(t / 1000);
  const d = Math.floor(totalSec / 86400); totalSec -= d * 86400;
  const h = Math.floor(totalSec / 3600); totalSec -= h * 3600;
  const mn = Math.floor(totalSec / 60); const s = totalSec - mn * 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (mn) parts.push(`${mn}m`);
  if (withSeconds || parts.length === 0) parts.push(`${s}s`);
  return parts.slice(0, 2).join(' ');
};

// Classify a task's live timer relative to `now`. null for completed tasks.
export const getTaskTimer = (task, now = Date.now()) => {
  if (!task || task.completed) return null;
  if (task.dueDate) {
    const target = _targetDate(task);
    if (!target || Number.isNaN(target.getTime())) return null;
    if (task.time) {
      const delta = target.getTime() - now;
      const abs = Math.abs(delta);
      return delta >= 0
        ? { state: 'upcoming', ms: delta, withSeconds: abs < _MS.hour }
        : { state: 'started',  ms: abs,   withSeconds: abs < _MS.hour };
    }
    const days = Math.round(
      (_startOfDay(target).getTime() - _startOfDay(new Date(now)).getTime()) / _MS.day
    );
    if (days > 0) return { state: 'upcoming', ms: days * _MS.day, dayMode: true };
    if (days === 0) return { state: 'today', ms: 0, dayMode: true };
    return { state: 'started', ms: -days * _MS.day, dayMode: true };
  }
  const created = typeof task.createdAt === 'number' ? task.createdAt : now;
  return { state: 'pending', ms: Math.max(0, now - created) };
};

// Human label for a timer descriptor. 'started' renders as a negative
// counter; 'pending' returns the bare age (the badge prefixes "pending").
export const timerLabel = (timer) => {
  if (!timer) return '';
  switch (timer.state) {
    case 'today':   return 'Today';
    case 'started': return `-${formatDuration(timer.ms, timer.withSeconds)}`;
    case 'pending': return formatDuration(timer.ms, false);
    default:        return formatDuration(timer.ms, timer.withSeconds);
  }
};