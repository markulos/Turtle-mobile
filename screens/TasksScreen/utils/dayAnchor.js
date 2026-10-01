/**
 * When the calendar re-anchors on TODAY, and what it may adopt from its pager.
 *
 * Pure, so the three decisions can be tested against a moved clock rather than
 * against a screenshot — every one of them is a bug you only see by opening the
 * app on the wrong day, which is the hardest thing to catch by looking.
 *
 * THE RULE the calendar has to keep: opening it shows TODAY, selected. It is
 * seeded that way at mount, and mount is not enough — this app stays resident
 * for days (the month and day lists are built once at bundle load and say so),
 * so "the day the view mounted" drifts away from "today" while nothing
 * re-renders.
 */

/** Local Y-M-D, so two Dates can be compared as calendar days. */
export const localDayKey = (date) => {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const sameLocalDay = (a, b) => localDayKey(a) === localDayKey(b);

/**
 * Milliseconds from `now` to the next local midnight.
 *
 * LOCAL, and computed by rolling the date forward rather than by adding 24h: a
 * DST boundary makes the day 23 or 25 hours long, and a fixed 86 400 000 would
 * fire an hour early or late twice a year — visibly, since the thing it drives
 * is "today".
 *
 * Never returns 0 or less. A timer armed with 0 in a callback that re-arms it is
 * a spin; the floor of one second means the worst case is one extra tick.
 */
export const msUntilNextLocalMidnight = (now = new Date()) => {
  const next = new Date(now);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + 1);
  return Math.max(1000, next.getTime() - now.getTime());
};

/**
 * Should the calendar jump back to today, and why not.
 *
 *   `anchoredDay` — the day the view last anchored on ("today", as it was then)
 *   `selected`    — the day the user currently has selected
 *   `now`         — the clock
 *   `reason`      — 'resume' (the app came back to the foreground) or
 *                   'rollover' (midnight passed while it was on screen)
 *
 * Returns the date to anchor on, or null to leave the view exactly as it is.
 *
 * A RESUME IS A FRESH LOOK at the app, so if the day has changed it re-anchors
 * whatever was selected: coming back the next morning to yesterday highlighted
 * as though it were today is the bug this exists for.
 *
 * A LIVE ROLLOVER is different — someone is holding the phone. If they were
 * sitting on today, today moves under them and the selection follows it. If
 * they had browsed to another day, they keep it: yanking the grid out from
 * under a finger at midnight would be a worse bug than the one being fixed.
 */
export function reanchorTarget({ anchoredDay, selected, now = new Date(), reason }) {
  if (!anchoredDay) return null;
  if (sameLocalDay(now, anchoredDay)) return null;
  if (reason === 'resume') return now;
  if (reason === 'rollover') return sameLocalDay(selected, anchoredDay) ? now : null;
  return null;
}

/**
 * What to do with the page a paged list says it landed on.
 *
 * Both of the calendar's pagers — the horizontal day pager and the vertical
 * month list — report through `onMomentumScrollEnd`, and the view adopts
 * whatever they land on. That is right for a swipe and WRONG for every scroll
 * the list performs on its own, of which there are more than there look to be:
 *
 *   · the scroll React Native does after mount to honour `initialScrollIndex`
 *   · a re-snap when `snapToInterval` changes, which happens the moment the
 *     month pages are measured and grow from their static estimate
 *   · any `scrollToIndex` the view itself issues after a resize
 *
 * None of those is a choice of date, and all of them can land somewhere other
 * than the page we asked for — the offset was computed against the OLD page
 * height. Adopting one silently redefines where "today" is: that is how the
 * month grid opened on May while today was September, four pages adrift
 * because the pages had grown ~7% taller under a fixed scroll offset.
 *
 *   'adopt'   — the user drove this, or it agrees with where we anchored
 *   'restore' — put the list back on the anchored page and change nothing
 *
 * The caller decides what `userDriven` means for its list. The month list
 * scopes it to ONE gesture (set on drag begin, cleared when that gesture's
 * momentum ends), so a later resize can't inherit a swipe's permission.
 */
export function landedPageAction({ landedIndex, anchorIndex, userDriven }) {
  if (userDriven) return 'adopt';
  return landedIndex === anchorIndex ? 'adopt' : 'restore';
}
