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

/**
 * THE KEY ON THE ROW, and the two ways it silently does nothing.
 *
 * It is a real button on each row of the search results now, not only a long
 * press. Two failure modes are worth pinning because both LOOK like a broken
 * button rather than a broken condition:
 *
 *  1. Gating on `searchOpen` instead of a non-empty query, which would put a
 *     send key on every note you own the moment the magnify is tapped.
 *  2. Leaving `showShare` out of the React.memo comparators. The prop flips when
 *     the field gains or loses its first character and nothing else about a row
 *     changes with it, so the rows would keep their previous state and the key
 *     would appear only where something else forced a re-render.
 */
describe('the share key on a search result row', () => {
  // Slice FORWARD from the start marker — `end` is searched for after it, not
  // from the top of the file, or a closing tag that also appears earlier gives
  // an empty window that passes nothing.
  const region = (start, end) => {
    const from = SRC.indexOf(start);
    expect(from).toBeGreaterThan(-1);
    const to = SRC.indexOf(end, from + start.length);
    expect(to).toBeGreaterThan(from);
    return SRC.slice(from, to);
  };

  test('a running search is a non-empty query, not merely an open bar', () => {
    expect(SRC).toMatch(/const searchActive = search\.trim\(\)\.length > 0;/);
    // The gate must not be the bar's open/closed state.
    expect(SRC).not.toMatch(/showShare=\{searchOpen\}/);
  });

  test('both row shapes get the key, gated on that', () => {
    // Plain notes and shared-link cards are different components, and the link
    // card is the shape you most want to forward — so it must not be the one
    // left out. Assert PER ELEMENT, not just that the props appear somewhere.
    for (const tag of ['<NoteRow', '<LinkNoteCard']) {
      const element = region(tag, '/>');
      expect(element).toMatch(/onShareAsText=\{shareNoteAsText\}/);
      expect(element).toMatch(/showShare=\{searchActive\}/);
    }
    // And nowhere else: a third caller would be a row shape nobody tested.
    expect((SRC.match(/showShare=\{searchActive\}/g) || []).length).toBe(2);
    expect((SRC.match(/onShareAsText=\{shareNoteAsText\}/g) || []).length).toBe(2);
  });

  test('both components accept the prop with a safe default', () => {
    expect(SRC).toMatch(/function NoteRowImpl\(\{[^}]*showShare = false/s);
    expect(SRC).toMatch(/function LinkNoteCardImpl\(\{[^}]*showShare = false/s);
  });

  test('both memo comparators compare showShare, or the key never appears', () => {
    const noteRowMemo = region('const NoteRow = React.memo', ');\n\nconst noteRowStyles');
    expect(noteRowMemo).toMatch(/prev\.showShare === next\.showShare/);
    const linkMemo = region('const LinkNoteCard = React.memo', ');\n\nconst linkCardStyles');
    expect(linkMemo).toMatch(/prev\.showShare === next\.showShare/);
  });

  // The WHOLE <TouchableOpacity> around a marker — the testID sits after the
  // attributes being asserted on, so slicing forward from it would miss them.
  const elementAround = (marker) => {
    const at = SRC.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    const open = SRC.lastIndexOf('<TouchableOpacity', at);
    const close = SRC.indexOf('</TouchableOpacity>', at);
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    return SRC.slice(open, close);
  };

  test('it is the app\'s own share glyph, and it is reachable', () => {
    for (const marker of ['testID={`note-row-share-', 'testID={`link-card-share-']) {
      const key = elementAround(marker);
      // share-variant is what the rest of the app shares with (3 other uses).
      expect(key).toMatch(/name="share-variant"/);
      expect(key).toMatch(/accessibilityLabel="Share as text"/);
      // A 17px glyph needs the same slop every other key on these rows gets.
      expect(key).toMatch(/hitSlop=/);
    }
  });

  test('the haptic is the light tap on press-in, not the impact', () => {
    for (const marker of ['testID={`note-row-share-', 'testID={`link-card-share-']) {
      const key = elementAround(marker);
      expect(key).toMatch(/onPressIn=\{\(\) => tapHaptic\(\)\}/);
      // impactHaptic is reserved for the Claude send, which is a heavier act.
      expect(key).not.toMatch(/impactHaptic/);
    }
  });
});
