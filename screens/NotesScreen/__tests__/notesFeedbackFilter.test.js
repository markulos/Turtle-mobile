// The Feedback tab's predicates. They live in their own module precisely so
// this test needs no mocks — NotesScreen/index.jsx imports expo-video,
// Reanimated and the contexts, none of which these pure functions touch.
import { isFeedbackNote, matchesFilter, topicChipsFor, FEEDBACK_TOPICS } from '../feedbackFilter';

// Feedback is a TAG SHAPE, not a note type: the composer's Feedback mode and
// the dev gesture probe both write a to-do stamped with an app tag. If this
// predicate drifts, the tab silently empties (or fills with real todos).
const probeFinding = {
  id: 'n1',
  type: 'todo',
  content: 'Mobile feedback: viewer:swipe — 412ms',
  tags: ['Turtle App', 'Mobile App', 'perf'],
};
const typedFeedback = { id: 'n2', type: 'todo', content: 'Grid feels slow', tags: ['Turtle 3D'] };
const realTodo = { id: 'n3', type: 'todo', content: 'Buy milk', tags: ['Groceries'] };
const plainNote = { id: 'n4', type: 'note', content: 'Ideas', tags: ['Turtle App'] };

describe('isFeedbackNote', () => {
  test('accepts a probe finding and hand-typed feedback', () => {
    expect(isFeedbackNote(probeFinding)).toBe(true);
    expect(isFeedbackNote(typedFeedback)).toBe(true);
  });

  test('rejects a real to-do and a plain note that merely carries the tag', () => {
    expect(isFeedbackNote(realTodo)).toBe(false);
    // A NOTE tagged "Turtle App" is a note about the app, not feedback.
    expect(isFeedbackNote(plainNote)).toBe(false);
  });

  test('matches the app tag case- and whitespace-insensitively', () => {
    expect(isFeedbackNote({ type: 'todo', tags: [' turtle app '] })).toBe(true);
    expect(isFeedbackNote({ type: 'todo', tags: ['TURTLE 3D'] })).toBe(true);
  });

  test('survives a note with no tags at all', () => {
    expect(isFeedbackNote({ type: 'todo' })).toBe(false);
    expect(isFeedbackNote({ type: 'todo', tags: [] })).toBe(false);
    expect(isFeedbackNote(null)).toBe(false);
  });
});

describe('matchesFilter', () => {
  test('All takes everything', () => {
    for (const n of [probeFinding, realTodo, plainNote]) {
      expect(matchesFilter(n, 'all')).toBe(true);
    }
  });

  test('Todos still includes feedback — the Feedback tab is a lens, not a move', () => {
    expect(matchesFilter(probeFinding, 'todo')).toBe(true);
    expect(matchesFilter(realTodo, 'todo')).toBe(true);
  });

  test('Feedback excludes ordinary todos and notes', () => {
    expect(matchesFilter(probeFinding, 'feedback')).toBe(true);
    expect(matchesFilter(realTodo, 'feedback')).toBe(false);
    expect(matchesFilter(plainNote, 'feedback')).toBe(false);
  });

  test('an untyped row counts as a note', () => {
    expect(matchesFilter({ id: 'n5', content: 'legacy' }, 'note')).toBe(true);
    expect(matchesFilter({ id: 'n5', content: 'legacy' }, 'todo')).toBe(false);
  });
});

// ── What the filter panel offers under each kind ─────────────────────────
//
// The bug: picking Feedback left every note-derived topic and every server
// board on screen — dozens of chips, when a feedback row can only ever carry
// four tags. The web app offers exactly those four as two small pickers.

const ALL_TOPICS = [
  { topic: 'Groceries', count: 4 },
  { topic: 'moodboard', count: 11 },
  { topic: 'Turtle App', count: 2 },
  { topic: 'perf', count: 1 },
];
const NOTES = [probeFinding, typedFeedback, realTodo, plainNote];

describe('topicChipsFor', () => {
  test('feedback offers only the four stamps, apps before platforms', () => {
    const chips = topicChipsFor('feedback', NOTES, ALL_TOPICS);
    expect(chips.map((c) => c.topic)).toEqual(['Turtle App', 'Turtle 3D', 'Web App', 'Mobile App']);
    expect(chips).toHaveLength(FEEDBACK_TOPICS.length);
  });

  test('counts come from the feedback rows only, not the whole list', () => {
    const chips = topicChipsFor('feedback', NOTES, ALL_TOPICS);
    const count = (t) => chips.find((c) => c.topic === t).count;
    // 'Turtle App' is on the probe finding AND on a plain note — only the
    // feedback row counts, so 1 rather than the 2 the rail-wide chip claims.
    expect(count('Turtle App')).toBe(1);
    expect(count('Mobile App')).toBe(1);
    expect(count('Turtle 3D')).toBe(1);
    // Kept at zero rather than dropped, like a board with no notes yet.
    expect(count('Web App')).toBe(0);
  });

  test('every other kind browses the whole universe, untouched', () => {
    expect(topicChipsFor('all', NOTES, ALL_TOPICS)).toBe(ALL_TOPICS);
    expect(topicChipsFor('note', NOTES, ALL_TOPICS)).toBe(ALL_TOPICS);
    expect(topicChipsFor('todo', NOTES, ALL_TOPICS)).toBe(ALL_TOPICS);
  });

  test('survives no notes at all', () => {
    expect(topicChipsFor('feedback', null, ALL_TOPICS).every((c) => c.count === 0)).toBe(true);
    expect(topicChipsFor('feedback', [], ALL_TOPICS)).toHaveLength(4);
  });
});
