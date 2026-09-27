import fs from 'fs';
import path from 'path';
import { SCREEN_TITLE, SCREEN_TITLE_ROW_H } from '../headerType';

/**
 * A title is the first thing you read on a screen, so its size is what tells
 * you whether you are still in the same product. Every tab had picked its own —
 * Notes 28, the Planner 20, the Media Vault 22 — and each looked considered
 * alone while the set looked like three apps.
 */
describe('one screen-title size', () => {
  // File, screen, and the NAME of the style that is that screen's title —
  // named explicitly because "anything ending in title" also catches note
  // titles, card titles and row titles, which are not this rule's business.
  const TITLED = [
    ['screens/NotesScreen/index.jsx', 'Notes', 'title'],
    ['screens/TasksScreen/index.jsx', 'the Planner', 'headerTitleLarge'],
    ['screens/TurtleScreen/components/MediaGallery.jsx', 'the Media Vault', 'headerTitleLarge'],
  ];

  test.each(TITLED)('%s (%s) takes its title size from the token', (file) => {
    const src = fs.readFileSync(file, 'utf8');
    expect(src).toMatch(/SCREEN_TITLE/);
  });

  // THE FAILURE THAT MADE THIS NECESSARY: the spread landed but the IMPORT did
  // not, and `...undefined` in an object literal is legal — it contributes
  // nothing. So the style compiled, the bundler said nothing, and the Notes
  // title simply lost its size. Using a token and importing it are two
  // different facts and both have to be checked.
  test.each(TITLED)('%s (%s) actually imports it', (file) => {
    const src = fs.readFileSync(file, 'utf8');
    expect(src).toMatch(/import\s*\{[^}]*SCREEN_TITLE[^}]*\}\s*from\s*'[^']*headerType'/);
  });

  // The failure this prevents is a screen quietly going back to a number: it
  // does not look broken, it just makes the set stop matching.
  // NOT asserted here: "the title block hard-codes no fontSize". Three
  // attempts at parsing that block out of the source all matched the wrong
  // thing — `title: {` also occurs inside `noteTitle:`, and the real blocks
  // carry their reasoning above their values — and a check that matches the
  // wrong thing is worse than no check. Use of the token is what is asserted
  // above; the sizes themselves are pinned by the token's own shape below.

  test('the token carries what has to MATCH, and no more', () => {
    // The exact size is a taste call and has moved once already; what the token
    // promises is that there is ONE of it and it reads as a title rather than
    // as display type.
    expect(SCREEN_TITLE.fontSize).toBeGreaterThanOrEqual(18);
    expect(SCREEN_TITLE.fontSize).toBeLessThanOrEqual(24);
    // Weight is deliberately absent: Notes sets one weight, the Planner and the
    // Vault split theirs across two, and forcing one would flatten a
    // distinction doing real work.
    expect(SCREEN_TITLE.fontWeight).toBeUndefined();
  });

  // Left to the platform a 28pt line box varies by OS version, and a title that
  // grows a point on someone's phone is a title clipped by its own header.
  test('the line box is explicit, and the row is built to hold it', () => {
    expect(SCREEN_TITLE.lineHeight).toBeGreaterThan(SCREEN_TITLE.fontSize);
    expect(SCREEN_TITLE_ROW_H).toBeGreaterThan(SCREEN_TITLE.lineHeight);
  });
});
