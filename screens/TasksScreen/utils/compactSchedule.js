/**
 * buildCompactRows — the compact schedule's row model.
 *
 * The compact view used to be built from `buildCondensedRows`, which walks the
 * day HOUR BY HOUR and emits a row for every empty one. That is the right model
 * for a clock — it is what the expanded timeline draws — but in a list it meant
 * an 8am task and a 2pm task were separated by five dashed rows saying nothing
 * except that five hours exist. The list was mostly empty hours.
 *
 * This is the other model: the tasks, in order, with ONE row between any two of
 * them naming the gap. Same information, a fraction of the height, and the
 * reason the compact view is worth having as a separate mode at all.
 *
 * The ENDS are gaps too. The day runs midnight to midnight, so the empty run
 * before the first task and the one after the last are as real as any stretch
 * between two — and now that an open gap's hours are tap-to-create slots, they
 * are the only way to reach an hour outside the span you already have
 * something in. They stay COLLAPSED like every other gap, so the hour-by-hour
 * emptiness the compact view exists to avoid is still one line until asked
 * for. (This is a reversal: they were deliberately left out when a gap was
 * only a readout and padding the ends bought nothing.)
 *
 * Overlapping tasks produce no gap row (the arithmetic goes negative, and two
 * things at once is not a gap). Rows come back as:
 *   { kind: 'task', seg, minute }
 *   { kind: 'gap', minutes, from, to, edge? }   edge: 'start' | 'end' for the
 *                                               two that run to midnight,
 *                                               'day' for an empty day's one
 */

/** Gaps shorter than this are not worth a row of their own. */
export const MIN_GAP_MINUTES = 15;

/** The day's bounds, in minutes since midnight — what the end gaps run to. */
export const DAY_START = 0;
export const DAY_END = 24 * 60;

export function buildCompactRows(segments, { minGapMinutes = MIN_GAP_MINUTES } = {}) {
  const segs = (segments || [])
    .filter((s) => s && Number.isFinite(s.start))
    .slice()
    .sort((a, b) => a.start - b.start);
  // A day with nothing on it is ONE gap: midnight to midnight. It used to come
  // back as no rows at all, so the panel drew nothing and the only way to reach
  // an hour was the + in the toolbar. As a gap it is the same line every other
  // stretch of empty time is — "24h", tapped open into twenty-four slots — so
  // an empty day is the same component as a busy one with one row instead of
  // several, and the exploded view of an empty day is a full day's grid.
  if (!segs.length) {
    return [{ kind: 'gap', minutes: DAY_END - DAY_START, from: DAY_START, to: DAY_END, edge: 'day' }];
  }

  const rows = [];
  // The furthest point anything has run to so far — NOT simply the previous
  // task's end. A long task followed by a short one nested inside it must not
  // produce a gap measured from the short one.
  let covered = null;

  // Midnight → the first task.
  const leading = segs[0].start - DAY_START;
  if (leading >= minGapMinutes) {
    rows.push({ kind: 'gap', minutes: leading, from: DAY_START, to: segs[0].start, edge: 'start' });
  }

  for (const seg of segs) {
    const start = seg.start;
    const end = Math.max(Number(seg.end) || 0, start);

    if (covered != null) {
      const gap = start - covered;
      if (gap >= minGapMinutes) {
        rows.push({ kind: 'gap', minutes: gap, from: covered, to: start });
      }
    }

    rows.push({ kind: 'task', seg, minute: start });
    covered = covered == null ? end : Math.max(covered, end);
  }

  // The last task → midnight. Clamped: a task running past the end of the day
  // leaves no trailing gap rather than a negative one.
  const trailing = DAY_END - Math.min(covered, DAY_END);
  if (trailing >= minGapMinutes) {
    rows.push({ kind: 'gap', minutes: trailing, from: Math.min(covered, DAY_END), to: DAY_END, edge: 'end' });
  }

  return rows;
}

/**
 * gapHourMarks — the hours a gap row expands into.
 *
 * Tapping "6h30m" asks the obvious question: six and a half hours of WHAT? The
 * answer is the hour-by-hour read the expanded timeline gives, for that stretch
 * only — so this returns the clock hours the gap covers, as minutes-since-
 * midnight, one per row.
 *
 * It starts from the hour the gap STARTS IN, not the first whole hour after it:
 * a gap running 9:05 → 15:30 is partly in the 9 o'clock hour, and omitting that
 * row would make the expansion start an hour after the thing it expands.
 *
 * `cap` is a backstop, not a feature — a day has 24 hours, so nothing legitimate
 * reaches it, and the list has no business growing without bound on a bad value.
 */
export function gapHourMarks(from, to, { cap = 24 } = {}) {
  // `== null` before Number(): Number(null) is 0, a perfectly finite number,
  // and a missing bound read as midnight would expand the whole morning.
  if (from == null || to == null) return [];
  const start = Number(from);
  const end = Number(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const marks = [];
  for (let m = Math.floor(start / 60) * 60; m < end && marks.length < cap; m += 60) {
    marks.push(m);
  }
  return marks;
}

/**
 * gapNowOffset — where the current minute falls inside an OPENED gap, in points
 * down from the top of its hour rows, or null when it falls outside them.
 *
 * This is the whole of the "is there a now-line here" question. An open gap is
 * the only place on the schedule where a minute has a y: a closed one is a
 * single line standing for six and a half hours, and there is no honest point
 * on it for 2:41 PM. (A task card has its own answer — a proportion of the card
 * — because a card's height is not its duration.)
 *
 * `marks` are the hours the gap opens into (gapHourMarks), so this asks the
 * same function the rows themselves are built from: the line can only land on
 * an hour that was actually drawn, including the part-hour one at each end.
 *
 * `lineY` is where an hour's RULE sits inside its slot. It is not zero — a slot
 * is the rule with the empty band under it — so minute h:00 is `lineY` into the
 * slot and not at its top edge. Passing it in keeps this arithmetic honest
 * without teaching the row model what a slot looks like.
 */
export function gapNowOffset(from, to, nowMinutes, { hourHeight, lineY = 0 } = {}) {
  const now = Number(nowMinutes);
  const h = Number(hourHeight);
  if (!Number.isFinite(now) || !Number.isFinite(h)) return null;
  const marks = gapHourMarks(from, to);
  if (!marks.length) return null;
  const first = marks[0];
  if (now < first || now >= first + marks.length * 60) return null;
  return lineY + ((now - first) / 60) * h;
}

/** Stable identity for a gap row, so an expanded one survives a re-render. */
export const gapKey = (row) => `gap-${row.from}-${row.to}`;

export default buildCompactRows;

/**
 * Minutes since midnight → "HH:MM" — the form a task's `time` and the finder's
 * pendingTime are both kept in.
 *
 * Lives beside `gapHourMarks` because that is what produces the minutes: an
 * expanded gap's hours are tap targets that open the finder at that hour, so
 * the two ends of that trip belong together. Clamped to the day rather than
 * wrapping — a slot is always on the day you are looking at.
 */
export function minutesToTimeString(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n)) return '00:00';
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(n)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}
