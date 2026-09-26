/**
 * Focus stats over a PERIOD — the week, the month, the year, the lot.
 *
 * `focusStats` (next door) answers "what is today, and how is the run going" —
 * the figures the Focus page itself prints. This answers the question you ask
 * once a week instead: how did this month compare with last, which hours am I
 * actually defending, what is the longest run I have ever put together.
 *
 * ─── Calendar periods, not rolling windows ─────────────────────────────────
 *
 * "This month" means the month, not the last thirty days. That is what makes
 * the comparison meaningful — a rolling 30-day figure has nothing to be
 * compared WITH, whereas September has August. It is also what everybody means
 * by the words, and a stats page that redefines "this week" is a stats page you
 * have to translate.
 *
 * Weeks start SUNDAY, matching the rest of the app (taskStats' weekday table,
 * the calendar grid) and the server's own /api/pomodoro/stats. One convention,
 * everywhere, so two screens can never disagree about which week you are in.
 *
 * ─── Local time, and why every boundary is built from a Date ────────────────
 *
 * Month and year edges are built with the Date constructor and `setMonth`,
 * never by adding milliseconds. A month is not 30 × 86400000 ms, and across a
 * DST boundary a day is not 86400000 ms either — arithmetic on epochs puts the
 * first of the month at 11pm on the last of the previous one, which silently
 * files a whole evening's focus under the wrong month.
 *
 * Everything here is pure, and every rule below is pinned by a test, because
 * the edges (an empty period, a period that has not finished yet, a record set
 * on the only day with any data) are the cases you cannot see on the page.
 */

import { dayKeyOf, isCompleted, actualMinutes } from './focusStats';

/** The periods the panel offers, in the order it offers them. */
export const RANGES = ['week', 'month', 'year', 'all'];

/** Sunday-first, matching taskStats and the calendar. */
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The day carved into four named stretches.
 *
 * Bands rather than 24 bars because "you do your best work in the morning" is
 * the sentence you want out of this, and the hour strip already covers the
 * fine grain. The night band WRAPS midnight (22:00–04:59), which is why this is
 * a list of hours per band instead of a pair of bounds.
 */
export const DAY_BANDS = [
  { key: 'morning', label: 'Morning', caption: '5a–12p', hours: [5, 6, 7, 8, 9, 10, 11] },
  { key: 'afternoon', label: 'Afternoon', caption: '12p–5p', hours: [12, 13, 14, 15, 16] },
  { key: 'evening', label: 'Evening', caption: '5p–10p', hours: [17, 18, 19, 20, 21] },
  { key: 'night', label: 'Night', caption: '10p–5a', hours: [22, 23, 0, 1, 2, 3, 4] },
];

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Local midnight at the start of the day `ms` falls in. */
export function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local midnight on the Sunday of the week `ms` falls in. */
export function startOfWeek(ms) {
  const d = new Date(startOfDay(ms));
  d.setDate(d.getDate() - d.getDay());
  return d.getTime();
}

/** Local midnight on the 1st of the month `ms` falls in. */
export function startOfMonth(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** Local midnight on the 1st of January of the year `ms` falls in. */
export function startOfYear(ms) {
  return new Date(new Date(ms).getFullYear(), 0, 1).getTime();
}

/** `n` whole months on from a month start (n may be negative). */
function addMonths(ms, n) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
}

/** Whole days from `a` to `b`, counted by calendar date so DST cannot shift it. */
function dayCount(a, b) {
  let n = 0;
  const cursor = new Date(startOfDay(a));
  const end = startOfDay(b);
  while (cursor.getTime() < end) {
    n += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return n;
}

/**
 * A period's edges, its name, and the period before it to compare against.
 *
 * `to` is EXCLUSIVE — the instant the period ends, which is the start of the
 * next one. A block that started at 23:59:59 on the last day belongs to the
 * period; one that started at 00:00:00 on the first day of the next does not.
 *
 * 'all' has no predecessor, so `prev` is null and the panel simply omits the
 * comparison rather than printing "+0% vs nothing".
 */
export function rangeBounds(range, nowMs) {
  const now = Number(nowMs) || Date.now();
  const d = new Date(now);
  switch (range) {
    case 'week': {
      const from = startOfWeek(now);
      const next = new Date(from);
      next.setDate(next.getDate() + 7);
      const prevFrom = new Date(from);
      prevFrom.setDate(prevFrom.getDate() - 7);
      return {
        range, from, to: next.getTime(), label: 'This week',
        prev: { from: prevFrom.getTime(), to: from, label: 'last week' },
      };
    }
    case 'month': {
      const from = startOfMonth(now);
      return {
        range, from, to: addMonths(from, 1), label: MONTH_LONG[d.getMonth()],
        prev: { from: addMonths(from, -1), to: from, label: 'last month' },
      };
    }
    case 'year': {
      const from = startOfYear(now);
      return {
        range, from, to: new Date(d.getFullYear() + 1, 0, 1).getTime(),
        label: String(d.getFullYear()),
        prev: { from: new Date(d.getFullYear() - 1, 0, 1).getTime(), to: from, label: 'last year' },
      };
    }
    default:
      // Everything the server handed back. `to` is a tick past now so a block
      // started this instant is inside it.
      return { range: 'all', from: 0, to: now + 1, label: 'All time', prev: null };
  }
}

/** Completed blocks that STARTED inside [from, to). */
function completedWithin(list, from, to) {
  return (Array.isArray(list) ? list : []).filter((p) => {
    if (!isCompleted(p)) return false;
    const s = Number(p.startedAt);
    return Number.isFinite(s) && s >= from && s < to;
  });
}

/** Every block that started inside [from, to), seen through or not. */
function attemptsWithin(list, from, to) {
  return (Array.isArray(list) ? list : []).filter((p) => {
    const s = Number(p?.startedAt);
    return Number.isFinite(s) && s >= from && s < to;
  });
}

/** Minutes per day key, over an already-filtered run of completed blocks. */
function sumByDay(done) {
  const out = new Map();
  for (const p of done) {
    const key = dayKeyOf(Number(p.startedAt));
    if (key) out.set(key, (out.get(key) || 0) + actualMinutes(p));
  }
  return out;
}

/**
 * The chart's spine: one column per day for a week or a month, one per month
 * for a year or for all time.
 *
 * Built from the CALENDAR, not from the data, so a day with no focus is still a
 * column of zero height — the gaps are the shape. Days beyond today are still
 * drawn: a half-finished month should look half-finished rather than like a
 * month that fell off a cliff.
 *
 * All time spans the first block to now, capped at the last 24 months, because
 * a hundred four-pixel columns is a texture, not a chart. `truncated` says how
 * many months were dropped so the panel can admit it.
 */
export function rangeSeries(list, bounds, nowMs) {
  const now = Number(nowMs) || Date.now();
  const done = completedWithin(list, bounds.from, bounds.to);
  const byDay = sumByDay(done);

  if (bounds.range === 'week' || bounds.range === 'month') {
    const out = [];
    const cursor = new Date(bounds.from);
    while (cursor.getTime() < bounds.to) {
      const ms = cursor.getTime();
      const key = dayKeyOf(ms);
      out.push({
        key,
        ms,
        minutes: byDay.get(key) || 0,
        // A week names its days; a month has 31 columns and can only afford
        // numbers, thinned to every fifth so the axis stays readable.
        label: bounds.range === 'week'
          ? WEEKDAY_LABELS[cursor.getDay()]
          : (cursor.getDate() === 1 || cursor.getDate() % 5 === 0 ? String(cursor.getDate()) : ''),
        future: ms > now,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return { unit: 'day', points: out, truncated: 0 };
  }

  // Months. For a year that is the twelve; for all time, first block → now.
  let first = bounds.from;
  if (bounds.range === 'all') {
    const starts = done.map((p) => Number(p.startedAt)).filter(Number.isFinite);
    first = startOfMonth(starts.length ? Math.min(...starts) : now);
  }
  const last = bounds.range === 'all' ? startOfMonth(now) : addMonths(bounds.to, -1);

  const months = [];
  let cursor = first;
  while (cursor <= last) {
    months.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  const MAX = 24;
  const truncated = Math.max(0, months.length - MAX);
  const kept = months.slice(truncated);

  const byMonth = new Map();
  for (const p of done) {
    const k = startOfMonth(Number(p.startedAt));
    byMonth.set(k, (byMonth.get(k) || 0) + actualMinutes(p));
  }

  const points = kept.map((ms) => {
    const d = new Date(ms);
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      ms,
      minutes: byMonth.get(ms) || 0,
      // Januarys carry the year when the span crosses one, so a 24-month chart
      // is not two identical-looking halves.
      label: d.getMonth() === 0 && kept.length > 12 ? `'${String(d.getFullYear()).slice(2)}` : MONTH_SHORT[d.getMonth()],
      future: ms > startOfMonth(now),
    };
  });
  return { unit: 'month', points, truncated };
}

/**
 * What each period adds up to, for the Focus page's four keys.
 *
 * Just the headline — the figure on the key and the count behind it — so the
 * page can print "this month: 4h 20m" beside the way into the month's panel
 * without paying for four full stat passes (four charts' worth of spines,
 * weekday tables and board splits, none of which the key shows).
 *
 * `title` is the period as a NAME ("This month") because that is what a key
 * says; `label` is the period as an IDENTITY ("September") because a key that
 * can say WHICH month should. It is null where the two would be the same
 * sentence — a key reading "This week · This week" is a key that says nothing
 * twice.
 */
export function rangeSummaries(list, nowMs) {
  const now = Number(nowMs) || Date.now();
  const TITLES = { week: 'This week', month: 'This month', year: 'This year', all: 'All time' };
  return RANGES.map((range) => {
    const bounds = rangeBounds(range, now);
    const done = completedWithin(list, bounds.from, bounds.to);
    return {
      range,
      title: TITLES[range],
      label: bounds.label === TITLES[range] || range === 'all' ? null : bounds.label,
      minutes: done.reduce((s, p) => s + actualMinutes(p), 0),
      blocks: done.length,
    };
  });
}

/**
 * The longest run of consecutive days with focus on them, ever.
 *
 * A record, so it is deliberately NOT range-scoped: "your best was 11 days"
 * does not become a different fact in March. Counted over the day keys present
 * in the data — walking the calendar between the first and last block would be
 * the same answer at more cost.
 */
export function longestStreak(byDayMap) {
  const keys = [...(byDayMap?.keys?.() || [])]
    .filter((k) => (byDayMap.get(k) || 0) > 0)
    .sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const key of keys) {
    const d = new Date(`${key}T00:00:00`);
    if (prev) {
      const next = new Date(prev);
      next.setDate(next.getDate() + 1);
      run = dayKeyOf(next.getTime()) === key ? run + 1 : 1;
    } else {
      run = 1;
    }
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/**
 * The all-time records — the numbers that never change when you switch period.
 *
 * Kept apart from `focusRangeStats` for exactly that reason: a "best ever" that
 * quietly meant "best this week" would be the most misleading figure on the
 * page.
 */
export function focusRecords(list) {
  const done = (Array.isArray(list) ? list : []).filter(isCompleted);
  const byDay = sumByDay(done);

  let bestDay = null;
  for (const [key, minutes] of byDay) {
    if (minutes > 0 && (!bestDay || minutes > bestDay.minutes)) {
      bestDay = { key, minutes, ms: new Date(`${key}T00:00:00`).getTime() };
    }
  }

  let longestBlock = null;
  for (const p of done) {
    const minutes = actualMinutes(p);
    if (!longestBlock || minutes > longestBlock.minutes) {
      longestBlock = { id: p.id, minutes, startedAt: Number(p.startedAt) };
    }
  }

  const starts = done.map((p) => Number(p.startedAt)).filter(Number.isFinite);
  return {
    totalMinutes: done.reduce((s, p) => s + actualMinutes(p), 0),
    totalBlocks: done.length,
    activeDays: byDay.size,
    longestStreak: longestStreak(byDay),
    bestDay,
    longestBlock,
    firstBlockAt: starts.length ? Math.min(...starts) : null,
  };
}

/**
 * Everything one period's panel prints, in one pass.
 *
 * `boardOfTask` maps a taskId to its board. Blocks with no task — a plain
 * "Start focus" with nothing attached — fall into 'No Board', which is honest:
 * the time was spent, it just was not spent on a named thing.
 */
export function focusRangeStats(list, range, nowMs, boardOfTask) {
  const now = Number(nowMs) || Date.now();
  const bounds = rangeBounds(range, now);
  const done = completedWithin(list, bounds.from, bounds.to);
  const attempts = attemptsWithin(list, bounds.from, bounds.to);
  const byDay = sumByDay(done);

  const minutes = done.reduce((s, p) => s + actualMinutes(p), 0);

  // How much of the period has actually HAPPENED. A daily average that divides
  // September's focus by 30 on the 3rd of the month reports a tenth of the
  // truth; dividing by the days so far is the number you can act on.
  const spanDays = bounds.range === 'all'
    ? Math.max(1, byDay.size)
    : Math.max(1, dayCount(bounds.from, bounds.to));
  const elapsedDays = bounds.range === 'all'
    ? Math.max(1, byDay.size)
    : Math.max(1, Math.min(spanDays, dayCount(bounds.from, now) + 1));

  const byHour = new Array(24).fill(0);
  const byWeekday = new Array(7).fill(0);
  const boards = new Map();
  let longest = null;
  for (const p of done) {
    const d = new Date(Number(p.startedAt));
    const m = actualMinutes(p);
    if (!Number.isNaN(d.getTime())) {
      byHour[d.getHours()] += m;
      byWeekday[d.getDay()] += m;
    }
    const name = (boardOfTask && boardOfTask(p.taskId)) || 'No Board';
    const prev = boards.get(name) || { name, minutes: 0, sessions: 0 };
    prev.minutes += m;
    prev.sessions += 1;
    boards.set(name, prev);
    if (!longest || m > longest.minutes) {
      longest = { id: p.id, minutes: m, startedAt: Number(p.startedAt), board: name };
    }
  }

  let best = null;
  for (const [key, mins] of byDay) {
    if (mins > 0 && (!best || mins > best.minutes)) {
      best = { key, minutes: mins, ms: new Date(`${key}T00:00:00`).getTime() };
    }
  }

  // The same period, one period earlier — the only honest way to say whether
  // this month is going well. Compared on MINUTES, which is what the headline
  // figure is.
  let prev = null;
  if (bounds.prev) {
    const prevDone = completedWithin(list, bounds.prev.from, bounds.prev.to);
    const prevMinutes = prevDone.reduce((s, p) => s + actualMinutes(p), 0);
    prev = {
      label: bounds.prev.label,
      minutes: prevMinutes,
      blocks: prevDone.length,
      // A rise from nothing is not "+∞%" — it is simply new, and the panel
      // says so in words instead of printing a number nobody can read.
      deltaPct: prevMinutes > 0 ? Math.round(((minutes - prevMinutes) / prevMinutes) * 100) : null,
    };
  }

  const bands = DAY_BANDS.map((b) => ({
    key: b.key,
    label: b.label,
    caption: b.caption,
    minutes: b.hours.reduce((s, h) => s + byHour[h], 0),
  }));
  const bandPeak = bands.reduce((m, b) => Math.max(m, b.minutes), 0);

  return {
    range: bounds.range,
    label: bounds.label,
    from: bounds.from,
    to: bounds.to,

    minutes,
    blocks: done.length,
    attempts: attempts.length,
    abandoned: attempts.length - done.length,
    // Of everything you STARTED in this period, how much you saw through. The
    // number that tells you whether 25 minutes is the right length for you.
    followThroughPct: attempts.length ? Math.round((done.length / attempts.length) * 100) : null,
    averageMinutes: done.length ? Math.round(minutes / done.length) : 0,
    longest,

    activeDays: byDay.size,
    elapsedDays,
    spanDays,
    // Two averages, because they answer different questions: "how much focus
    // does a day of mine get" and "how much does a day I actually show up for".
    perDay: Math.round(minutes / elapsedDays),
    perActiveDay: byDay.size ? Math.round(minutes / byDay.size) : 0,
    // How often you show up at all, which is the habit behind the total.
    showUpPct: Math.round((byDay.size / elapsedDays) * 100),

    best,
    prev,
    byHour,
    byWeekday: byWeekday.map((mins, i) => ({ label: WEEKDAY_LABELS[i], minutes: mins })),
    bestWeekday: byWeekday.some((m) => m > 0)
      ? WEEKDAY_LABELS[byWeekday.indexOf(Math.max(...byWeekday))]
      : null,
    bands,
    peakBand: bandPeak > 0 ? bands.find((b) => b.minutes === bandPeak) : null,
    boards: [...boards.values()].sort((a, b) => b.minutes - a.minutes),
    series: rangeSeries(list, bounds, now),
  };
}
