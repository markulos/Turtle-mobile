/**
 * The string that runs down the Inbox tab, and the one place its numbers live.
 *
 * Three surfaces draw on this thread — the lines you have just written
 * (InboxList), the board rows, and the tasks a board reveals when it opens —
 * and the whole effect depends on every bead landing on the SAME x. Two of them
 * agreeing and the third being two points off does not read as a near miss; it
 * reads as a bug, because a string with a kink in it is obviously not a string.
 *
 * So the numbers are here rather than in any of the three, for exactly the
 * reason `tabBarLayout` exists: a constant that two components each keep their
 * own copy of is a constant that will disagree with itself eventually.
 */

/**
 * How far in from the content edge the thread runs.
 *
 * A TAB, not a hairline against the margin. At 7 the string sat almost on the
 * page's own edge, where it read as a rule bounding the content rather than as
 * something the content hangs from — and inside a board's rectangle it was
 * close enough to the border to look like part of it. Indented, it is plainly a
 * spine with the list strung off it.
 */
export const THREAD_X = 16;

/** A bead on it — the mark a written line gets. */
export const BEAD = 9;

/** A smaller one, for the tasks a board reveals: subordinate to their board. */
export const BEAD_SMALL = 6;

/**
 * Air between the widest bead and the text that follows it. The one number to
 * tune if the titles ever want to sit closer in or further out.
 */
const TEXT_GAP = 13.5;

/**
 * How far a strung row's content starts from the content edge.
 *
 * DERIVED, not chosen: the thread, half the widest bead, and the gap. Every
 * strung row shares it, which is what makes the titles line up as a column of
 * their own — and computing it means moving the thread moves the text with it
 * instead of leaving the two a few points out of step, which is precisely the
 * kind of drift that only shows up as "something about this looks wrong".
 */
export const ROW_PAD_LEFT = THREAD_X + BEAD / 2 + TEXT_GAP;

/**
 * The reveal — the board's body rolling open, and shut.
 *
 * ONE animation, not two. It was a per-row stagger inside a container that was
 * also animating its own height, which is two things saying the same thing and
 * twice as much to go wrong; the roll alone reads as the list unrolling.
 *
 * Shorter out than in: leaving is a dismissal and a slow one feels like the app
 * arguing. Both decelerate into rest — a curve that ACCELERATES into the end is
 * what makes a close feel like a snap rather than a close, so "snappy" is the
 * duration, not the easing. (The same relationship VaultSearchDock's
 * SEARCH_ENTER / SEARCH_EXIT carry.)
 */
export const REVEAL_MS = 240;
export const REVEAL_OUT_MS = 170;

/** How far the body lifts as it rolls. Short: it is a reveal, not an entrance. */
export const REVEAL_RISE = 10;
