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
export const PLATFORM_TAGS = { web: 'Web App', mobile: 'Mobile App' };

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

/**
 * The only tags a piece of feedback ever carries, in the web app's order:
 * which APP it is about, then which PLATFORM. The web Notes screen offers
 * exactly these as two small pickers (noteKinds.ts APP_TABS / PLATFORM_TABS)
 * rather than the whole tag universe, because they are the only answers a
 * feedback row can give.
 */
export const FEEDBACK_TOPICS = [...Object.values(APP_TAGS), ...Object.values(PLATFORM_TAGS)];

const hasTag = (n, tag) => Array.isArray(n?.tags)
  && n.tags.some((t) => String(t).trim().toLowerCase() === tag.toLowerCase());

/**
 * The topic chips worth offering for a kind filter.
 *
 * Every other kind browses the whole universe — note-derived topics merged with
 * every server board — which is right for notes and to-dos, because a note can
 * be filed under anything. Feedback cannot: it is stamped by one composer with
 * one of four tags, so offering the full list was offering dozens of chips that
 * could only ever return nothing. Narrowing it is what makes the panel's live
 * count trustworthy under this tab.
 *
 * All four are kept even at zero, badge-less (the panel hides a 0 count) —
 * the same way a board with no notes yet still lists, and the same way the web
 * pickers always show both apps and both platforms.
 */
export function topicChipsFor(filterKey, notes, allTopics) {
  if (filterKey !== 'feedback') return allTopics;
  const rows = (Array.isArray(notes) ? notes : []).filter(isFeedbackNote);
  return FEEDBACK_TOPICS.map((topic) => ({
    topic,
    count: rows.filter((n) => hasTag(n, topic)).length,
  }));
}
