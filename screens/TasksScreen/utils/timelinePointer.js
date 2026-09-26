/**
 * The arithmetic behind the agenda's timeline pointer — the fixed mark on the
 * gutter's edge that reads whatever the list is scrolling past it.
 *
 * Pure functions, deliberately: the pointer resolves on EVERY scroll frame, so
 * the part that decides "which item is under the mark, and what does it say"
 * has to be cheap, and it has to be testable without a scroll view. The screen
 * supplies FlashList's geometry (computeVisibleIndices + getLayout) and these
 * turn it into an index, a day, and a string.
 */

/**
 * The index sitting under `targetY` (CONTENT coordinates — i.e. scroll offset
 * plus the pointer's offset into the viewport), searching only [from, to].
 *
 * A y that lands in the GAP between two items belongs to the item below it:
 * the mark is always on something, and the alternative (reporting "nothing")
 * would blank the readout every time the pointer crossed a row margin.
 *
 * @returns the index, or -1 when nothing on screen covers it.
 */
export function indexAtContentY(targetY, from, to, getLayout) {
  for (let i = from; i <= to; i++) {
    let l = null;
    try { l = getLayout(i); } catch (e) { l = null; }
    if (!l) continue;
    if (targetY < l.y + l.height) return i;
  }
  return -1;
}

/**
 * The day the agenda is showing at `hit`. Chrome items — band headers, the
 * gaps between bands, the dashed add-task card — carry no date of their own,
 * so walk BACK to the nearest thing that knows what day it is: a date divider
 * states its day outright, and any row states it with its dueDate.
 *
 * @returns a 'YYYY-MM-DD' key, or null when nothing above it has a date
 *          (the top of a band with no rows yet).
 */
export function dayKeyAt(items, hit) {
  for (let i = hit; i >= 0; i--) {
    const it = items[i];
    if (!it) continue;
    if (it.__divider && it.dateKey) return it.dateKey;
    if (it.dueDate) return it.dueDate;
  }
  return null;
}

/**
 * What the pointer prints. The DAY leads — it's what the buzz marks, and it's
 * the one thing the gutter's own labels never say — and the hour follows only
 * when the mark is actually sitting ON a timed row (a header or a gap has no
 * hour to report, and borrowing the previous row's would be a lie).
 *
 * `dateLabel` and `clock` are injected so this stays free of the screen's
 * date helpers (and of `Date.now()`, which is what makes it testable).
 */
export function pointerLabel(item, dateKey, dateLabel, clock) {
  if (!dateKey) return null;
  const day = dateLabel(dateKey);
  const hhmm = item?.dueDate && item.time ? String(item.time) : null;
  if (!hhmm) return day;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return day;
  return `${day} · ${clock((h || 0) * 60 + (m || 0))}`;
}
