/**
 * The Tasks screen's three pages, and the arithmetic that keeps the pager and
 * its segmented control agreeing about them.
 *
 * Here rather than in the screen because the ORDER is a decision, not an
 * implementation detail: the pager's page positions, the sliding pill's
 * translate and the tap targets all derive from this one array, and if any of
 * them ever disagreed the pill would point at a page you were not on.
 */

/**
 * Left to right, and the order is the navigation model: your list, the month
 * it sits in, the boards behind both, and the time you actually spend on them.
 * The calendar sits at index 1 so it is one swipe from the agenda either way.
 *
 * 'list' is the agenda's internal name and stays that way — it is the mode
 * string threaded through the screen, and renaming a stored value to match a
 * label is how a saved preference stops resolving. The LABEL is "Agenda",
 * which is what the code has called this view in its own comments all along.
 */
export const VIEW_PAGES = ['list', 'calendar', 'boards', 'focus'];

/** Where the screen opens, and what an unrecognised mode falls back to. */
export const DEFAULT_VIEW = 'calendar';

/** One segment of the header's sliding control, in page order. */
export const VIEW_SEGMENTS = [
  { mode: 'list', label: 'Agenda', icon: 'format-list-bulleted' },
  { mode: 'calendar', label: 'Calendar', icon: 'calendar-month' },
  { mode: 'boards', label: 'Boards', icon: 'view-dashboard-outline' },
  { mode: 'focus', label: 'Focus', icon: 'timer-outline' },
];

/**
 * Which page a mode is. Falls back to the default rather than to 0: an
 * unknown mode (a stale persisted value, a typo in a caller) would otherwise
 * silently mean "the first page", which is a different page from the one the
 * screen believes it is showing.
 */
export function viewIndex(mode) {
  const i = VIEW_PAGES.indexOf(mode);
  return i < 0 ? VIEW_PAGES.indexOf(DEFAULT_VIEW) : i;
}

/** Which mode a settled pager offset landed on. */
export function viewAtOffset(x, pageWidth) {
  if (!(pageWidth > 0)) return DEFAULT_VIEW;
  const i = Math.round(x / pageWidth);
  return VIEW_PAGES[i] || DEFAULT_VIEW;
}
