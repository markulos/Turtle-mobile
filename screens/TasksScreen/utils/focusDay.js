/**
 * ONE DAY OF FOCUS, and the two questions a single day cannot answer about
 * itself: was that a lot, and is that a lot FOR A TUESDAY.
 *
 * The Focus page's Today tile prints one number — 50m, 2 blocks. A number with
 * nothing beside it is not a fact you can act on: 50 minutes is a poor
 * Saturday and an excellent Monday, and knowing which is the whole reason to
 * open it. So everything here is the day plus its context.
 *
 * ─── Three frames, deliberately ────────────────────────────────────────────
 *
 *   · THE DAY — its blocks, when they ran, where the time went, and the
 *     attempts that did not finish (shown so the completed figure above them
 *     means something, the same way the Focus page treats them).
 *   · THE SAME WEEKDAY, ALL TIME — your Tuesdays, averaged, with the best one
 *     and where this one places among them. The comparison people actually
 *     make is against the same day of the week, because that is what has the
 *     same shape: the same meetings, the same commute, the same evening.
 *   · EVERY DAY, ALL TIME — the day against your record as a whole, so a good
 *     Tuesday that is also a good DAY reads as one.
 *
 * ─── What counts ───────────────────────────────────────────────────────────
 *
 * Completed blocks only for every minute figure, and a block belongs to the
 * day it STARTED — both rules are focusStats', reused rather than restated so
 * the panel can never disagree with the tile that opened it.
 *
 * Ranks are over days that HAVE focus. Ranking a day among every date in the
 * calendar would make "your 4th best Tuesday" mean nothing except how long
 * you have had the app.
 */
import {
  actualMinutes,
  dayKeyOf,
  isCompleted,
  minutesByDay,
} from './focusStats';

export const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/** A 'YYYY-MM-DD' key back to local midnight — never `new Date(key)`, which
 *  reads a date-only string as UTC and lands on the day before, west of it. */
export function msOfDayKey(key) {
  const parts = String(key || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/**
 * Where `minutes` places among `values`, 1 = best. Ties share the better
 * rank, which is the only answer that does not depend on array order.
 */
function rankOf(minutes, values) {
  if (!(minutes > 0)) return null;
  let above = 0;
  for (const v of values) if (v > minutes) above += 1;
  return above + 1;
}

const mean = (values) => (values.length
  ? Math.round(values.reduce((s, v) => s + v, 0) / values.length)
  : 0);

/**
 * @param sessions     every pomodoro the server handed back
 * @param dayMs        any instant inside the day in question
 * @param boardOfTask  (taskId) => board name, so the day can say WHERE it went
 * @param taskOfId     (taskId) => task, for a block's title
 */
export function focusDayStats(sessions, dayMs, boardOfTask, taskOfId) {
  const all = Array.isArray(sessions) ? sessions : [];
  const dayKey = dayKeyOf(dayMs);
  const weekdayIndex = new Date(dayMs).getDay();

  const onDay = all.filter((p) => dayKeyOf(Number(p.startedAt)) === dayKey);
  const done = onDay.filter(isCompleted);
  const minutesOf = done.map(actualMinutes);
  const minutes = minutesOf.reduce((s, m) => s + m, 0);

  // Where the time went. Same shape focusStats uses, so the two read alike.
  const boards = new Map();
  for (const p of done) {
    const name = (boardOfTask && boardOfTask(p.taskId)) || 'No Board';
    const prev = boards.get(name) || { name, minutes: 0, sessions: 0 };
    prev.minutes += actualMinutes(p);
    prev.sessions += 1;
    boards.set(name, prev);
  }

  const byHour = new Array(24).fill(0);
  for (const p of done) {
    const d = new Date(Number(p.startedAt));
    if (!Number.isNaN(d.getTime())) byHour[d.getHours()] += actualMinutes(p);
  }

  const starts = done.map((p) => Number(p.startedAt)).filter(Number.isFinite);
  const ends = done
    .map((p) => Number(p.completedAt))
    .filter(Number.isFinite);

  // ── The context. Both frames read the same by-day map ────────────────────
  const byDay = minutesByDay(all);
  const activeDays = Object.entries(byDay).filter(([, m]) => m > 0);

  // The same weekday, every time it has come round — excluding this one, so
  // "better than your average Tuesday" is not partly a comparison with
  // itself. With no other Tuesday on record there is nothing to compare to,
  // which the panel says rather than printing a 0.
  const sameWeekday = [];
  for (const [key, m] of activeDays) {
    const ms = msOfDayKey(key);
    if (ms == null || new Date(ms).getDay() !== weekdayIndex) continue;
    sameWeekday.push({ key, ms, minutes: m });
  }
  const otherSameWeekday = sameWeekday.filter((d) => d.key !== dayKey);
  const weekdayValues = sameWeekday.map((d) => d.minutes);
  const weekdayBest = sameWeekday.reduce(
    (best, d) => (!best || d.minutes > best.minutes ? d : best),
    null,
  );

  const allValues = activeDays.map(([, m]) => m);
  const otherDays = activeDays.filter(([key]) => key !== dayKey);
  const allBest = activeDays.reduce(
    (best, [key, m]) => (!best || m > best.minutes ? { key, minutes: m } : best),
    null,
  );

  return {
    dayKey,
    dayMs,
    weekdayIndex,
    weekdayName: WEEKDAY_NAMES[weekdayIndex],

    // ── The day ──
    minutes,
    blocks: done.length,
    // Not every attempt finished. Said plainly, as context for the figure
    // above it rather than as a telling-off.
    abandoned: onDay.length - done.length,
    longest: minutesOf.length ? Math.max(...minutesOf) : 0,
    average: done.length ? Math.round(minutes / done.length) : 0,
    firstStart: starts.length ? Math.min(...starts) : null,
    lastEnd: ends.length ? Math.max(...ends) : null,
    boards: [...boards.values()].sort((a, b) => b.minutes - a.minutes),
    byHour,
    sessions: done
      .slice()
      .sort((a, b) => Number(a.startedAt) - Number(b.startedAt))
      .map((p) => ({
        id: p.id,
        taskId: p.taskId,
        startedAt: Number(p.startedAt),
        minutes: actualMinutes(p),
        board: (boardOfTask && boardOfTask(p.taskId)) || null,
        title: (taskOfId && taskOfId(p.taskId)?.title) || null,
      })),

    // ── The same weekday, all time ──
    weekday: {
      // How many of this weekday have ever had focus on them, this one
      // included — the denominator behind the rank.
      days: sameWeekday.length,
      // The average EXCLUDING today, which is what "better than usual" means.
      averageMinutes: mean(otherSameWeekday.map((d) => d.minutes)),
      best: weekdayBest,
      rank: rankOf(minutes, weekdayValues),
      // Null when there is no other one to compare with, so the panel can say
      // "your first Tuesday" instead of claiming a 100% improvement.
      comparable: otherSameWeekday.length > 0,
    },

    // ── Every day, all time ──
    allTime: {
      days: activeDays.length,
      minutes: allValues.reduce((s, m) => s + m, 0),
      // Excluding today, for the same reason the weekday average does.
      averageMinutes: mean(otherDays.map(([, m]) => m)),
      best: allBest,
      rank: rankOf(minutes, allValues),
    },
  };
}

/**
 * "12% more than your average Tuesday" — or null when there is nothing honest
 * to say, which is either no history or no focus today.
 *
 * Returns the SIGNED percentage, so the caller picks the words and the colour.
 */
export function compareToAverage(minutes, averageMinutes) {
  if (!(minutes > 0) || !(averageMinutes > 0)) return null;
  return Math.round(((minutes - averageMinutes) / averageMinutes) * 100);
}

/** "9:12 AM" — a block's start, in the reader's own clock format. */
export function clockLabel(ms, use24h = false) {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString([], {
    hour: use24h ? '2-digit' : 'numeric',
    minute: '2-digit',
    hour12: !use24h,
  });
}

/** 1 → "1st", 2 → "2nd" … for "your 3rd best Tuesday". */
export function ordinal(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 1) return '';
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  switch (v % 10) {
    case 1: return `${v}st`;
    case 2: return `${v}nd`;
    case 3: return `${v}rd`;
    default: return `${v}th`;
  }
}
