/**
 * The Notes screen's three pages, and the arithmetic that keeps the pager and
 * its segmented control agreeing about them.
 *
 * Mark, 2026-11-18: "similar to planner page have three tabs that can be
 * translate moved from one tab to the next that is split between to-do,
 * notes, feedback."
 *
 * The kind used to be a row of chips inside the filter sheet — one list, and
 * you went through a panel to change what it showed. Three pages you swipe
 * between is a different claim about the screen: these are not three filters
 * over one library, they are three places, and moving between them should
 * cost a thumb rather than two taps and a sheet.
 *
 * Here rather than in the screen for the same reason the planner's
 * `viewPages` is: the ORDER is a decision, not an implementation detail. The
 * pager's page positions, the sliding pill's translate and the tap targets
 * all derive from this one array, and if any of them disagreed the pill would
 * point at a page you were not on.
 *
 * ── Why these three, in this order ───────────────────────────────────────
 *
 * Mark's own order, and it puts Notes in the middle — one swipe from either
 * neighbour, which is the same reasoning that keeps the planner's calendar at
 * index 1. To-do leads because it is the page with work on it.
 *
 * `all` is gone. It was the fourth chip and it cannot be a page: a page is a
 * place, and "all of them at once" is a filter. Everything it showed is one
 * swipe away.
 *
 * The kind strings are the ones already threaded through the screen and its
 * predicates (`matchesFilter`, `TAB_COMPOSER_MODE`), so nothing downstream
 * has to learn a new vocabulary.
 */

/** Left to right. */
export const NOTE_PAGES = ['todo', 'note', 'feedback'];

/** Where the screen opens, and what an unrecognised kind falls back to. */
export const DEFAULT_NOTE_PAGE = 'todo';

/** One segment of the sliding control, in page order. */
export const NOTE_SEGMENTS = [
  { kind: 'todo', label: 'To-do', icon: 'checkbox-marked-circle-outline' },
  { kind: 'note', label: 'Notes', icon: 'note-text-outline' },
  { kind: 'feedback', label: 'Feedback', icon: 'message-text-outline' },
];

/**
 * Which page a kind is.
 *
 * Falls back to the default rather than to 0: an unknown kind — `all` from a
 * stale "clear filters", a typo in a caller — would otherwise silently mean
 * "the first page", which is a different page from the one the screen
 * believes it is showing.
 */
export function pageIndex(kind) {
  const i = NOTE_PAGES.indexOf(kind);
  return i < 0 ? NOTE_PAGES.indexOf(DEFAULT_NOTE_PAGE) : i;
}

/** Which kind a settled pager offset landed on. */
export function pageAtOffset(x, pageWidth) {
  if (!(pageWidth > 0)) return DEFAULT_NOTE_PAGE;
  const i = Math.round(x / pageWidth);
  return NOTE_PAGES[i] || DEFAULT_NOTE_PAGE;
}

/**
 * How far the pill has travelled, in page widths, for a live scroll offset.
 *
 * Clamped to the ends so an iOS rubber-band past the first or last page does
 * not carry the pill off its own track — the bounce is the list's to show,
 * not the control's.
 */
export function pillProgress(x, pageWidth) {
  if (!(pageWidth > 0)) return 0;
  const f = x / pageWidth;
  const last = NOTE_PAGES.length - 1;
  return f < 0 ? 0 : f > last ? last : f;
}

export default {
  DEFAULT_NOTE_PAGE, NOTE_PAGES, NOTE_SEGMENTS, pageAtOffset, pageIndex, pillProgress,
};
