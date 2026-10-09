import fs from 'fs';

/**
 * PINNED NOTES ARE WIRED ALL THE WAY THROUGH.
 *
 * ─── Why a source scan and not a render test ───────────────────────────────
 *
 * NotesScreen is four thousand lines with no render harness (see
 * noteCardFooter.scan.test.js for the same reasoning), and the ordering itself
 * is already pinned properly by utils/__tests__/pinnedNotes.test.js. What is
 * left to protect is the WIRING — three separate places that each silently
 * disable the feature on their own:
 *
 *  - the list has to sort by the pins (a pin that sorts nothing is a no-op),
 *  - both row shapes have to be TOLD they are pinned, and their memo
 *    comparators have to compare it — pinning changes the list's order but not
 *    the note object, so a row would otherwise travel to the top still wearing
 *    no pin,
 *  - the long-press sheet has to offer it, since that is the only way in.
 */
/**
 * The source with its comments BLANKED — not deleted.
 *
 * Blanked because this scan asserts on ORDER (pin above delete), and a comment
 * that merely says the word "Delete" would answer for the entry itself.
 * Blanked rather than removed so every offset still lines up with the real
 * file, which is the trap inputField.scan.test.js documents: deleting takes
 * the newlines with it and every line this then reports points somewhere else.
 */
const blankComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));

const SRC = blankComments(fs.readFileSync('screens/NotesScreen/index.jsx', 'utf8'));

/**
 * A source region, by its two landmarks. Throws rather than asserting, so a
 * landmark that has been renamed says WHICH one — a scan that reports
 * "expected -1 to be greater than -1" sends the next person reading the wrong
 * thing. (This jest's `expect` takes no message argument.)
 */
const between = (fromNeedle, toNeedle) => {
  const from = SRC.indexOf(fromNeedle);
  if (from < 0) throw new Error(`"${fromNeedle}" is gone — this scan is reading the wrong file`);
  const to = SRC.indexOf(toNeedle, from);
  if (to < 0) throw new Error(`"${toNeedle}" no longer follows "${fromNeedle}"`);
  return SRC.slice(from, to);
};

test('the store is the one the pond and the device share', () => {
  // Not a local useState: pins outlive the screen and follow the account.
  expect(SRC).toMatch(/from '\.\.\/\.\.\/utils\/pinnedNotes'/);
  expect(SRC).toMatch(/usePinnedNoteIds\(\)/);
});

test('the list is ordered by the pins, after the tab has had its say', () => {
  const list = between('const listFor = useCallback(', '}, [visibleNotes');
  // Pinned last in the pipeline — so it outranks orderTodos' inbox-first rule
  // rather than being overturned by it.
  expect(list.indexOf('orderTodos')).toBeLessThan(list.indexOf('sortPinnedFirst'));
  // And the set it reads has to be a dependency, or the list never re-sorts.
  expect(SRC).toMatch(/}, \[visibleNotes, selectedTopic, pinnedSet\]\)/);
});

describe('both row shapes know they are pinned', () => {
  const cases = [
    ['NoteRow', 'function NoteRowImpl(', 'const NoteRow = React.memo', 'const NoteRow = React.memo', '\n);'],
    ['LinkNoteCard', 'function LinkNoteCardImpl(', 'const LinkNoteCard = React.memo', 'const LinkNoteCard = React.memo', '\n);'],
  ];

  test.each(cases)('%s takes the pin, shows it, and offers the way back', (_name, from, to) => {
    const body = between(from, to);
    expect(body).toMatch(/pinned = false/);
    expect(body).toMatch(/onTogglePin/);
    // The marker itself: a pin glyph, drawn only when pinned.
    expect(body).toMatch(/\{pinned && \(/);
    expect(body).toMatch(/name="pin"/);
  });

  test.each(cases)('%s compares `pinned` in its memo', (_name, _f, _t, memoFrom, memoTo) => {
    expect(between(memoFrom, memoTo)).toMatch(/prev\.pinned === next\.pinned/);
  });

  test.each(cases)('%s is handed the pin by the list', (name) => {
    // Newline-agnostic on purpose: this repo checks out with CRLF on Windows,
    // and a scan with a bare `\n` in its needle passes or fails depending on
    // which machine last wrote the file.
    const tag = SRC.search(new RegExp(`<${name}\\s*\\r?\\n`));
    if (tag < 0) throw new Error(`<${name} …> is not rendered by the list any more`);
    const props = SRC.slice(tag, SRC.indexOf('/>', tag));
    expect(props).toMatch(/pinned=\{pinnedSet\.has\(String\(item\.id\)\)\}/);
    expect(props).toMatch(/onTogglePin=\{togglePin\}/);
  });
});

test('the long press offers to pin, and says which way it goes', () => {
  const sheet = between('const showNoteActions = (note) => {', 'Cancel');
  expect(sheet).toMatch(/Pin to top/);
  expect(sheet).toMatch(/Unpin from top/);
  expect(sheet).toMatch(/togglePin\(note\)/);
  // Above the destructive one, where a reversible action belongs.
  expect(sheet.indexOf('Pin to top')).toBeLessThan(sheet.indexOf('Delete'));
});

test('a deleted note takes its pin with it, but only once the delete lands', () => {
  // Landmarks have to be CODE: the comments are blanked above.
  const del = between('const performDelete = async (note) => {', 'const openEditNote = useCallback(');
  expect(del).toMatch(/unpinNote\(note\.id, api\)/);
  // After the await, not before it: a delete that fails puts the note back,
  // and it must come back pinned.
  expect(del.indexOf('await sendOrQueue')).toBeLessThan(del.indexOf('dropPin()'));
});
