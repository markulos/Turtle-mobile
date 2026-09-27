import { THREAD_X, BEAD, BEAD_SMALL, ROW_PAD_LEFT, REVEAL_MS, REVEAL_OUT_MS } from '../threadGeometry';

/**
 * Three surfaces draw on this string — the lines you have just written, the
 * board rows, and the tasks a board reveals. The whole effect depends on every
 * bead landing on the same x, so these are the invariants, not the values.
 */
describe('the string’s geometry', () => {
  test('it is indented from the page edge, not pinned to it', () => {
    // At a couple of points it read as a rule bounding the content rather than
    // as a spine the content hangs from.
    expect(THREAD_X).toBeGreaterThanOrEqual(12);
  });

  // The one relationship that actually matters: text must clear the widest
  // bead. Hand-tuning the two apart is how a title ends up sitting on a dot.
  test('a row’s text always clears the widest bead', () => {
    expect(ROW_PAD_LEFT).toBeGreaterThan(THREAD_X + BEAD / 2);
    expect(ROW_PAD_LEFT).toBeGreaterThan(THREAD_X + BEAD_SMALL / 2);
  });

  test('and it is DERIVED from the thread, so moving one moves the other', () => {
    // If this ever becomes a literal again, moving THREAD_X silently leaves the
    // text behind — which reads as "something about this looks wrong" and is
    // very hard to see directly.
    expect(ROW_PAD_LEFT - THREAD_X).toBeGreaterThan(BEAD / 2);
  });

  test('a board’s task bead is subordinate to its board’s', () => {
    expect(BEAD_SMALL).toBeLessThan(BEAD);
  });

  // Past about a quarter of a second a reveal stops being fluid and starts
  // being something you wait for.
  test('the reveal stays fluid rather than becoming a wait', () => {
    expect(REVEAL_MS).toBeLessThanOrEqual(260);
  });

  // Leaving is a dismissal: a slow one feels like the app arguing. The app's
  // own relationship, the same one VaultSearchDock's enter/exit carry.
  test('and leaving is quicker than arriving', () => {
    expect(REVEAL_OUT_MS).toBeLessThan(REVEAL_MS);
  });
});
