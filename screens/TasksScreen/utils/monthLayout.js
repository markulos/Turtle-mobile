/**
 * Where a month page sits inside the calendar viewport, and how tall its cells
 * are. Pure geometry, kept out of CalendarView so it can be checked against
 * real device metrics instead of eyeballed on a phone.
 *
 * Two rules, in this order:
 *
 *  1. The month must CLEAR the docked task sheet. The sheet parks at
 *     `containerH - headerH - dockH`, and `bottomReserve` is that occupancy —
 *     the grid may never extend past it, or the last week of the month reads
 *     from behind a sheet.
 *
 *  2. Subject to that, the month is centred on the SCREEN — on `areaH`, not on
 *     the gap left above the sheet. Those are different positions and the
 *     screen is the one that looks right: the page carries ~106pt of title and
 *     weekday chrome above its grid, so centring the whole page in the gap
 *     leaves the DATES — the part anyone means by "the calendar" — sitting high
 *     with all the air pooled underneath them.
 *
 * On a phone-sized screen rule 2 overshoots into the sheet and the clamp is
 * what actually lands: the month goes as low as it can while staying clear.
 * Rule 2 governs on a screen tall enough to fit the month outright.
 *
 * Cells GROW to use a big screen (up to `maxCell`) but never shrink past
 * `minCell` — below that a cell can't hold its day number plus three task
 * pills, and an unreadable cell is worse than a short month. When even
 * `minCell` doesn't fit, `topInset` clamps to 0 and the page is top-anchored:
 * the viewport clips, and clipping the bottom is better than centring the
 * overflow and losing the month title off the top as well.
 *
 * Returns null when the area hasn't been measured yet — the caller falls back
 * to its static defaults for that first frame.
 */
export const WEEK_ROWS = 6;

export function monthLayout({ areaH, bottomReserve, chromeH, minCell, maxCell }) {
  if (!(areaH > 0)) return null;
  const usable = areaH - bottomReserve;
  if (usable <= 0) return null;

  const gridH = usable - chromeH;
  const cellH = Math.min(maxCell, Math.max(minCell, gridH / WEEK_ROWS));
  const monthH = chromeH + WEEK_ROWS * cellH;

  const centredOnScreen = (areaH - monthH) / 2;
  const lowestThatClears = usable - monthH;
  const topInset = Math.max(0, Math.min(centredOnScreen, lowestThatClears));

  return { cellH, monthH, topInset };
}
