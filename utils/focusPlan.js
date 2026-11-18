/**
 * How long a focus session runs, how long the break after it is, and when
 * that break is a long one.
 *
 * ── The same four keys the web app uses ──────────────────────────────────
 * Stored per USER in `users.settings.focusTimer` through
 * `GET /api/me` + `PATCH /api/me/settings` — the store the account accent
 * already rides on. Set a session length here and the desktop starts at it
 * too, and the other way round.
 *
 * The web half is `src/context/focusPlan.ts` in the web repo. The KEYS and
 * the CLAMPS have to agree: the server runs whatever minutes it is handed
 * (clamped to 1..240 in routes/pomodoro.js), so a plan one app considers
 * legal and the other does not is a timer that changes length depending on
 * which device you started it from.
 *
 * ── The long break ───────────────────────────────────────────────────────
 * Every `longBreakEvery`-th break is `longBreak` minutes. The count is of
 * focus sessions FINISHED, not breaks taken — a break you skip should not
 * move you further from your long one, because the long break is earned by
 * the work and not by the resting.
 */

export const FOCUS_PLAN_SETTING = 'focusTimer';
export const FOCUS_CYCLE_SETTING = 'focusCycle';

export const DEFAULT_PLAN = { focus: 25, break: 5, longBreak: 15, longBreakEvery: 4 };

/** What the server will actually run. */
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 240;
export const MAX_EVERY = 12;

/**
 * Absent, checked BEFORE coercing. `Number(null)` and `Number('')` are both
 * 0 and both finite, so a cleared or deleted key would clamp to the MINIMUM
 * and hand somebody a one-minute focus session instead of the default.
 */
const absent = (v) => v === null || v === undefined || v === '' || typeof v === 'boolean';

const clampMinutes = (v, fallback) => {
  if (absent(v)) return fallback;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, n));
};

const clampEvery = (v, fallback) => {
  if (absent(v)) return fallback;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  if (n <= 0) return 0;
  return Math.min(MAX_EVERY, Math.max(2, n));
};

/** A stored blob, made safe. Anything can write to that JSON store. */
export function normalisePlan(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    focus: clampMinutes(o.focus, DEFAULT_PLAN.focus),
    break: clampMinutes(o.break, DEFAULT_PLAN.break),
    longBreak: clampMinutes(o.longBreak, DEFAULT_PLAN.longBreak),
    longBreakEvery: clampEvery(o.longBreakEvery, DEFAULT_PLAN.longBreakEvery),
  };
}

export function readPlan(me) {
  const settings = me && me.user && me.user.settings;
  return normalisePlan(settings ? settings[FOCUS_PLAN_SETTING] : null);
}

export function planPatch(plan) {
  return { [FOCUS_PLAN_SETTING]: normalisePlan(plan) };
}

/** Zero finished sessions is not a fourth break. */
export function isLongBreak(finishedFocus, plan) {
  const every = plan.longBreakEvery;
  if (every <= 0) return false;
  const n = Math.floor(finishedFocus);
  if (!Number.isFinite(n) || n <= 0) return false;
  return n % every === 0;
}

/** How many minutes the next run of `mode` should be. The one answer. */
export function plannedMinutes(mode, plan, finishedFocus) {
  if (mode === 'focus') return plan.focus;
  return isLongBreak(finishedFocus, plan) ? plan.longBreak : plan.break;
}

/** Sessions still to go before the long break. 0 = it is next, -1 = off. */
export function untilLongBreak(finishedFocus, plan) {
  const every = plan.longBreakEvery;
  if (every <= 0) return -1;
  const n = Math.max(0, Math.floor(finishedFocus) || 0);
  return (every - (n % every)) % every;
}

/** Local, not UTC: the day that resets is the one you are living in. */
export function localDay(at) {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Focus sessions finished today. Resets with the day — see the web header. */
export function readCycle(me, today) {
  const settings = me && me.user && me.user.settings;
  const raw = settings ? settings[FOCUS_CYCLE_SETTING] : null;
  const o = raw && typeof raw === 'object' ? raw : {};
  if (o.day !== today) return 0;
  const n = Math.floor(Number(o.done));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function cyclePatch(done, day) {
  return { [FOCUS_CYCLE_SETTING]: { done: Math.max(0, Math.floor(done) || 0), day } };
}
