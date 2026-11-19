const fs = require('fs');
const path = require('path');

/**
 * A NOTE IS RICH TEXT, AND ITS LINKS ARE LINKS.
 *
 * Mark's to-do "Hyperlink in notes" (Turtle App · Mobile App): "make it
 * possible to have hyperlink in notes mobile and rich text."
 *
 * Nothing new had to be invented for the reading half — chat replies have
 * been drawn with utils/markdownLite + components/MarkdownText since the
 * Claude console landed, as nested <Text> with no WebView and no dependency.
 * A note is a paragraph of someone's writing exactly as a reply is. So the
 * change is that notes use the same renderer, and the composer grew the
 * three keys that write it.
 *
 * The arithmetic those keys do is pure and tested next door (richText.test).
 * What is pinned here is the wiring, and the two decisions that are easy to
 * undo by accident: that the body is drawn rather than printed, and that the
 * STORAGE did not change.
 */

const read = (...p) => fs.readFileSync(path.resolve(__dirname, '..', ...p), 'utf8');
const SRC = read('index.jsx');
const MD = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'components', 'MarkdownText.jsx'), 'utf8');

describe('a note is drawn, not printed', () => {
  test('the row renders its body through the markdown renderer', () => {
    expect(SRC).toMatch(/import MarkdownText from '\.\.\/\.\.\/components\/MarkdownText'/);
    expect(SRC).toMatch(/<MarkdownText\s+text=\{note\.content\}/);
    expect(SRC).toMatch(/<MarkdownText\s+text=\{note\.description\}/);
  });

  test('…CLAMPED, because a row is a preview and not the note', () => {
    // Two lines is what the row has always been. Rendering every block and
    // letting the row clip them is not the same thing: a half-drawn fence is
    // worse than the plain text it replaced, and the blocks below the fold
    // would still be laid out for every row in a scrolling list.
    expect(SRC).toMatch(/text=\{note\.content\}\s*\n\s*numberOfLines=\{2\}/);
    expect(MD).toMatch(/const blocks = numberOfLines > 0 \? all\.slice\(0, 1\) : all;/);
    // Selection off while clamped — a long-press on a row already means the
    // note's own actions, and selection handles would swallow it.
    expect(MD).toMatch(/numberOfLines > 0 \? \{ numberOfLines, selectable: false \} : null/);
  });

  test('a link is a link wherever it is drawn', () => {
    // The renderer's own job, and it already did it — worth pinning because
    // the notes work rests entirely on it.
    expect(MD).toMatch(/onPress=\{s\.link \? \(\) => openLink\(s\.link\) : undefined\}/);
    expect(MD).toMatch(/accessibilityRole=\{s\.link \? 'link' : undefined\}/);
  });
});

describe('the keys that write it', () => {
  test('bold, italic and a link — on the BODY, not the title', () => {
    // The title is one line; a bold title is a heading nobody asked for.
    for (const id of ['note-bold', 'note-italic', 'note-link']) {
      expect(SRC).toMatch(new RegExp(`testID="${id}"`));
    }
    expect(SRC).toMatch(/wrapSelection\(descriptionRef\.current \|\| '', bodySelRef\.current, '\*\*'\)/);
    expect(SRC).toMatch(/wrapSelection\(descriptionRef\.current \|\| '', bodySelRef\.current, '_'\)/);
  });

  test('THE CARET GOES WHERE THE KEY SAYS', () => {
    // Every helper hands back a selection, and it is worth nothing unless the
    // field is told. The release afterwards is the other half: a controlled
    // selection that never lets go pins the caret and the field cannot be
    // typed in at all.
    expect(SRC).toMatch(/selection=\{bodySelection \|\| undefined\}/);
    expect(SRC).toMatch(/if \(bodySelection\) setBodySelection\(null\);/);
  });

  test('the link key tries the CLIPBOARD first', () => {
    // The common case is that you copied a link and came here to put it
    // somewhere; that should be one tap, not a dialog.
    expect(SRC).toMatch(/Clipboard\.getStringAsync\(\)/);
    expect(SRC).toMatch(/if \(isUrlish\(clip\)\) url = clip;/);
    // …and a clipboard that cannot be read is not an error: the placeholder
    // path works on its own.
    expect(SRC).toMatch(/catch \(e\) \{[\s\S]{0,200}?\}\n\s*applyBodyEdit\(insertLink\(/);
  });

  test('a preview, and no formatting keys over a field you cannot see', () => {
    expect(SRC).toMatch(/testID="note-preview"/);
    expect(SRC).toMatch(/testID="note-body-preview"/);
    expect(SRC).toMatch(/\{!preview && \(/);
  });
});

describe('what did NOT change', () => {
  test('THE STORAGE IS STILL PLAIN TEXT', () => {
    // The body goes to the pond as the string that was typed. That is what
    // keeps a note readable on the web, in a share sheet and in a Claude
    // prompt — and it is why none of this needed a server change.
    expect(SRC).not.toMatch(/contentHtml|descriptionHtml|richContent|bodyJson/);
  });

  test('…and no WebView came in with it', () => {
    // A rich-text editor package would be a native dependency, which moves
    // the runtime fingerprint and means a build rather than an OTA.
    // In the CODE: this screen's comments say the word (twice, explaining
    // that there isn't one), and a note that says why is the thing that stops
    // somebody adding one.
    const code = SRC
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/WebView|react-native-pell|rich-editor/i);
    expect(MD).not.toMatch(/import .*WebView/);
  });
});
