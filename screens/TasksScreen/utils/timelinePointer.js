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
 * Where the mark is, in the coordinate space FlashList's `getLayout` answers in.
 *
 * THE TRAP, and it cost two bad builds: those are not the same space as the
 * scroll offset. FlashList measures `firstItemOffset` — the distance from the
 * scroll view's top to its first child, i.e. the content container's
 * paddingTop — and hands its layout manager `scrollOffset - firstItemOffset`,
 * so every `getLayout(i).y` is PADDING-RELATIVE. (Its own `scrollToIndex` adds
 * the offset back for exactly this reason.)
 *
 * With no top padding the two spaces coincide and `scrollY + pointerTop` is
 * correct — which is why the pointer was right for its whole life until the
 * agenda grew a lead-in above its first card. Then every reading was that
 * padding further down the timeline than the mark really was: the wrong card
 * lit, and anything measuring distance to a card measured it to the wrong one.
 *
 * @param scrollOffset    contentOffset.y
 * @param pointerTop      the mark's y within the viewport
 * @param firstItemOffset list.getFirstItemOffset() — the content padding
 */
export function markContentY(scrollOffset, pointerTop, firstItemOffset = 0) {
  return scrollOffset + pointerTop - firstItemOffset;
}

/**
 * The index sitting under `targetY` (in the space `markContentY` returns),
 * searching only [from, to].
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
export function pointerParts(item, dateKey, dateLabel, clock, isEvent) {
  if (!dateKey) return null;
  const day = dateLabel(dateKey);
  // An event says what it IS where a task says when it is. It has a date but
  // no hour worth reporting, and the second line would otherwise sit empty —
  // so it names the kind instead. `kind: 'event'` is what tells the readout to
  // set that line entirely light: there is no hour to lead with, so leading
  // half of "Event" in bold would just look like a mistake.
  if (isEvent && isEvent(item)) return { day, time: 'Event', kind: 'event' };
  const hhmm = item?.dueDate && item.time ? String(item.time) : null;
  if (!hhmm) return { day, time: null, kind: 'clock' };
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return { day, time: null, kind: 'clock' };
  return { day, time: clock((h || 0) * 60 + (m || 0)), kind: 'clock' };
}

/**
 * The same reading as one string. The readout PRINTS the two parts on their
 * own lines (see TimelinePointer), so this exists for the callers that want a
 * single value to compare — notably the scroll handler, which only re-renders
 * when the printed reading actually changes and would otherwise have to
 * compare two fields by hand on every frame.
 *
 * Derived from `pointerParts` rather than repeating the rules, so the string
 * and the printed lines can never disagree about what the reading is.
 */
export function pointerLabel(item, dateKey, dateLabel, clock) {
  const parts = pointerParts(item, dateKey, dateLabel, clock);
  if (!parts) return null;
  return parts.time ? `${parts.day} · ${parts.time}` : parts.day;
}

/**
 * Each line of the readout is set in TWO weights: the part that identifies it
 * heavy, the part that qualifies it light. "Sep 28" is a month you are
 * steering by and a number that narrows it; "9 PM" is an hour and a half of
 * the day. Splitting here rather than in the view keeps it testable, and
 * keeps the view from having to know what a meridiem looks like.
 *
 * Both degrade to lead-only, which is the common case worth getting right:
 * "Today" has no qualifier, and a 24-hour clock has no AM/PM.
 */
/**
 * Which row the mark should be lighting, given where it landed.
 *
 * The agenda's CHROME — date dividers, band headers, the add-task template,
 * the past zone's placeholders — is interleaved with the rows, so the mark
 * spends part of every scroll sitting on something that is not a card.
 * Returning null there would drop every card to the dimmed state for those
 * frames, which reads as the whole list flickering rather than as one card
 * being singled out. The last real row keeps it until another one takes over.
 */
const CHROME = ['__agendaHeader', '__gap', '__addCard', '__divider', '__placeholder'];

export function activeRowIdAt(items, index, previousId = null) {
  const it = items?.[index];
  if (!it) return previousId;
  if (CHROME.some((flag) => it[flag])) return previousId;
  return it.id ?? previousId;
}

/**
 * How far the mark's reading is from today, as a word.
 *
 * Sits with the readout in the ~64pt of text the margin allows, so every value
 * has to fit ON ONE LINE at caption size — the column is narrow enough that
 * "Yesterday" set at the readout's own size wraps and leaves its "y" stranded
 * on a second line. The longest strings here are "yesterday" and "tomorrow",
 * and both clear it comfortably at 11.5pt; the numeric forms are shorter still.
 *
 * Lower case throughout, deliberately: this is an annotation on the reading,
 * not a second reading. The date above it carries the capital.
 *
 * @returns a word, or null when there is no offset to state.
 */
export function dayOffsetLabel(days) {
  if (!Number.isFinite(days)) return null;
  const n = Math.round(days);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n}d` : `${-n}d ago`;
}

/** A real card, as opposed to any of the agenda's chrome. */
export function isCardItem(item) {
  if (!item) return false;
  return !CHROME.some((flag) => item[flag]);
}

/**
 * The card CENTRE nearest the mark, in the same space as `markContentY`.
 *
 * Only cards attract — the mark passing a date divider or a band header should
 * feel nothing, because there is nothing there to settle on. `gap` is the
 * margin every row carries BELOW its card (ROW_GAP): a cell's box includes it,
 * so the cell's midpoint is half a gap below the card's and every centre in
 * the list would sit consistently low without this.
 *
 * Scans [from, to] — the on-screen range — rather than the whole agenda: this
 * runs on every scroll frame, and a card that is not on screen is not one the
 * mark could be near anyway.
 *
 * @returns {{index, center, distance, pitch}} or null when no card is in view.
 */
export function nearestCardCenter(items, from, to, getLayout, targetY, gap = 0) {
  let best = null;
  for (let i = from; i <= to; i++) {
    if (!isCardItem(items?.[i])) continue;
    let l = null;
    try { l = getLayout(i); } catch (e) { l = null; }
    if (!l || !(l.height > 0)) continue;
    const center = l.y + (l.height - gap) / 2;
    const distance = Math.abs(center - targetY);
    if (!best || distance < best.distance) best = { index: i, center, distance, pitch: l.height };
  }
  return best;
}

/**
 * How far the cards lean toward the mark, given a centre `delta` away.
 *
 * Zero AT the centre, zero again a whole `range` away, strongest between the
 * two — a raised cosine, so the lean has no corner at either end.
 *
 * The far end is load-bearing twice over. `range` is half the row pitch, so
 * the pull has faded to nothing by the point the nearest card changes hands:
 * nothing jumps at the handover, AND the lean is zero exactly where the row
 * under the mark is ambiguous. That second property is what lets the readout
 * ignore the lean entirely — where the lean is big enough to see, which card
 * the mark is on is not in question.
 *
 * Deliberately weak: this is weight in the movement, not the movement itself.
 * The last of the distance is closed by the scroll when it stops.
 */
export function magnetPull(delta, range, strength, max) {
  if (!(range > 0) || !Number.isFinite(delta)) return 0;
  const d = Math.abs(delta);
  if (d >= range) return 0;
  const falloff = (1 + Math.cos((Math.PI * d) / range)) / 2;
  const pull = delta * strength * falloff;
  return Math.max(-max, Math.min(max, pull));
}

export function splitDay(day) {
  const s = String(day ?? '');
  const i = s.indexOf(' ');
  return i === -1 ? { lead: s, tail: '' } : { lead: s.slice(0, i), tail: s.slice(i + 1) };
}

export function splitTime(time) {
  const s = String(time ?? '');
  const m = s.match(/^(.*?)\s*(AM|PM)$/i);
  return m ? { lead: m[1], tail: m[2] } : { lead: s, tail: '' };
}
