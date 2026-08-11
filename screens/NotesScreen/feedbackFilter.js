/**
 * Notes tab predicates — pure, dependency-free, unit-tested.
 *
 * These live outside index.jsx on purpose: index.jsx imports expo-video,
 * Reanimated, gesture-handler and the contexts, so a test of these two tiny
 * functions would have to stub the whole native graph to reach them.
 *
 * The idea they encode: FEEDBACK IS A TAG SHAPE, NOT A NOTE TYPE. The notes
 * table only knows 'note' | 'todo'. App feedback is a to-do stamped with an app
 * tag — by the Notes composer's Feedback mode, or by the dev gesture probe,
 * which files its findings here rather than as real tasks (as tasks they landed
 * on the calendar's day to-do list, mixed into actual work).
 */

// The app a piece of feedback is about. Stamped as a tag so the cue rides along
// when the to-do is handed to a Claude session.
export const APP_TAGS = { 'turtle-app': 'Turtle App', 'turtle-3d': 'Turtle 3D' };
export const PLATFORM_TAGS = { web: 'Web app', mobile: 'Mobile app' };

// Matched case-insensitively (and trimmed) because tags are free text
// everywhere else in the app.
const APP_TAG_SET = new Set(Object.values(APP_TAGS).map((t) => t.toLowerCase()));

export const isFeedbackNote = (n) => (n?.type || 'note') === 'todo'
  && Array.isArray(n?.tags)
  && n.tags.some((t) => APP_TAG_SET.has(String(t).trim().toLowerCase()));

/**
 * The one predicate behind every tab — used by both the shared `visible` list
 * and the per-page `listFor`, so a page can never disagree with its own count.
 *
 * NOTE: feedback rows ARE to-dos, so they still appear on the Todos tab. The
 * Feedback tab is a lens onto them, not a move — a row that vanished from
 * Todos the moment it was tagged would read as lost.
 */
export const matchesFilter = (n, filterKey) => {
  if (filterKey === 'all') return true;
  if (filterKey === 'feedback') return isFeedbackNote(n);
  return (n.type || 'note') === filterKey;
};
