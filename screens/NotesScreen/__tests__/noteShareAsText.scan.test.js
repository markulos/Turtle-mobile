import fs from 'fs';

/**
 * A NOTE CAN LEAVE AS AN ORDINARY MESSAGE.
 *
 * Everything else that shares out of Turtle shares a LINK — a board, a track, a
 * public album. That is the right shape when the point is access, and the wrong
 * one when the point is the information: a recipient with no account, or no
 * patience, gets a URL they cannot use. So the note's action sheet can also hand
 * its words to the OS share sheet as plain text, which any messaging app takes.
 *
 * ─── Why a source scan and not a render test ───────────────────────────────
 *
 * The action sheet is `Alert.alert`, which is a native call, not a tree. A
 * render test cannot press a button inside it or read its labels back, so the
 * only thing it could assert is that a long-press happened — the part that
 * already worked. What actually needs pinning is that the entry is IN the sheet
 * and that it goes through noteShareText rather than re-deriving the text
 * inline, which is how the two would drift apart. The text-building rules
 * themselves are covered properly in utils/__tests__/noteShareText.test.js.
 */
const SRC = fs.readFileSync('screens/NotesScreen/index.jsx', 'utf8');

describe('sharing a note as plain text', () => {
  test('the action sheet offers it, alongside Edit and Delete', () => {
    const sheet = SRC.slice(SRC.indexOf('const showNoteActions'));
    const body = sheet.slice(0, sheet.indexOf('\n  };'));
    expect(body).toMatch(/text: 'Share as text'/);
    // Still the sheet that owns Edit and Delete — this is an addition to the
    // existing menu, not a second menu that happens to share a long-press.
    expect(body).toMatch(/text: 'Edit'/);
    expect(body).toMatch(/text: 'Delete'/);
  });

  test('it is not offered above Edit or below Cancel', () => {
    const sheet = SRC.slice(SRC.indexOf('const showNoteActions'));
    const body = sheet.slice(0, sheet.indexOf('\n  };'));
    const at = (label) => body.indexOf(`text: '${label}'`);
    // Non-destructive first, the destructive one last, Cancel after everything:
    // a Share that sat under Delete would be one slip from the wrong tap.
    expect(at('Edit')).toBeLessThan(at('Share as text'));
    expect(at('Share as text')).toBeLessThan(at('Delete'));
    expect(at('Delete')).toBeLessThan(at('Cancel'));
  });

  test('the text comes from noteShareText, not from a second inline derivation', () => {
    expect(SRC).toMatch(/import \{ noteShareText \} from '\.\.\/\.\.\/utils\/noteShareText'/);
    const handler = SRC.slice(SRC.indexOf('const shareNoteAsText'));
    const body = handler.slice(0, handler.indexOf('}, []);'));
    expect(body).toMatch(/noteShareText\(note\)/);
    expect(body).toMatch(/Share\.share\(\{ message \}\)/);
  });

  test('it sends text and never a url — a link is the thing this exists to avoid', () => {
    const handler = SRC.slice(SRC.indexOf('const shareNoteAsText'));
    const body = handler.slice(0, handler.indexOf('}, []);'));
    expect(body).not.toMatch(/\burl\s*:/);
  });

  test('an empty note does not open a sheet that can only send nothing', () => {
    const handler = SRC.slice(SRC.indexOf('const shareNoteAsText'));
    const body = handler.slice(0, handler.indexOf('}, []);'));
    // The guard has to come BEFORE the share call, or it guards nothing.
    expect(body.indexOf('if (!message) return;')).toBeGreaterThan(-1);
    expect(body.indexOf('if (!message) return;')).toBeLessThan(body.indexOf('Share.share'));
  });

  test('Share is imported from react-native', () => {
    const importBlock = SRC.slice(SRC.indexOf('from \'react\';'), SRC.indexOf("} from 'react-native';"));
    expect(importBlock).toMatch(/^\s*Share,$/m);
  });
});
