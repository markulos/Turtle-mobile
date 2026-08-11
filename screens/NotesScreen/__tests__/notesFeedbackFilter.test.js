// The Feedback tab's predicates. They live in their own module precisely so
// this test needs no mocks — NotesScreen/index.jsx imports expo-video,
// Reanimated and the contexts, none of which these pure functions touch.
import { isFeedbackNote, matchesFilter } from '../feedbackFilter';

// Feedback is a TAG SHAPE, not a note type: the composer's Feedback mode and
// the dev gesture probe both write a to-do stamped with an app tag. If this
// predicate drifts, the tab silently empties (or fills with real todos).
const probeFinding = {
  id: 'n1',
  type: 'todo',
  content: 'Mobile feedback: viewer:swipe — 412ms',
  tags: ['Turtle App', 'Mobile app', 'perf'],
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
