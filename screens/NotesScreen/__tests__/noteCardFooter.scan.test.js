import fs from 'fs';

/**
 * THE SHAPE OF THE NOTES TIMELINE: rows on the page, separated by a groove,
 * with the byline's faces at the same x on every one.
 *
 * ─── Why a source scan and not a render test ───────────────────────────────
 *
 * Because what regresses here is STRUCTURE — which parent the footer hangs
 * off, whether a row still carries a card's furniture — and in a render tree
 * every arrangement puts the same elements on screen with the same props. Only
 * a layout pass on a real device tells them apart, and there is no device in
 * CI. The nesting and the chrome are the thing, so they are what is pinned.
 */
const SRC = fs.readFileSync('screens/NotesScreen/index.jsx', 'utf8');

/** The body of NoteRowImpl, up to the memo that wraps it. */
const noteRow = (() => {
  const from = SRC.indexOf('function NoteRowImpl(');
  const to = SRC.indexOf('const NoteRow = React.memo', from);
  if (from < 0 || to < 0) throw new Error('NoteRowImpl not found — this scan is reading the wrong file');
  return SRC.slice(from, to);
})();

const at = (needle) => {
  const i = noteRow.indexOf(needle);
  expect(i).toBeGreaterThan(-1);
  return i;
};

/** A `const xStyles = …` factory, up to the line that closes it. */
const styleBlock = (factory) => {
  const from = SRC.indexOf(factory);
  expect(from).toBeGreaterThan(-1);
  return SRC.slice(from, SRC.indexOf('\n});', from));
};

/** One named style's body inside a factory. */
const styleNamed = (factory, name) => {
  const block = styleBlock(factory);
  const from = block.indexOf(`${name}: {`);
  expect(from).toBeGreaterThan(-1);
  return block.slice(from, block.indexOf('\n  },', from));
};

/**
 * The faces are an ANCHOR, so where they sit is the feature.
 *
 * Pinning the stack to the right of its ROW is only half of it — the row has to
 * BE the full width. The footer used to live inside the body column, whose right
 * edge moves inward by a 46pt thumbnail on a note with attachments and by a
 * Claude key on a to-do, so the faces landed at up to three different x's in one
 * screenful.
 */
describe('the byline hangs off the whole row, not off the body column', () => {
  test('the row is a column with a separate top line', () => {
    expect(noteRow).toMatch(/style=\{styles\.row\}/);
    expect(noteRow).toMatch(/<View style=\{styles\.main\}>/);
  });

  test('the footer comes AFTER the top line closes, not inside the body', () => {
    // The trailing furniture is what pushes the body's right edge inward, so
    // the footer has to be rendered past all of it.
    const body = at('<View style={styles.body}>');
    const thumb = at('{attachCount > 0 && (');
    const footer = at('<View style={styles.footer}>');
    expect(footer).toBeGreaterThan(body);
    expect(footer).toBeGreaterThan(thumb);
  });

  test('the byline is in that footer and nowhere else on the row', () => {
    expect((noteRow.match(/<NoteByline/g) || []).length).toBe(1);
    expect(at('<NoteByline')).toBeGreaterThan(at('<View style={styles.footer}>'));
  });
});

describe('the footer steps over the leading key by measurement, not by eye', () => {
  test('the key column and the gap are named once and shared', () => {
    // Three places have to agree: both leading keys and the footer's inset. A
    // literal in any of them is how the timestamp quietly stops lining up with
    // the note's first word.
    expect(SRC).toMatch(/const ICON_COL = \d+;/);
    expect(SRC).toMatch(/const ICON_GAP = \d+;/);
    expect(styleNamed('const noteRowStyles', 'footer')).toMatch(/paddingLeft: ICON_COL \+ ICON_GAP/);
    for (const key of ['checkbox', 'noteIcon']) {
      expect(styleNamed('const noteRowStyles', key)).toMatch(/width: ICON_COL/);
    }
  });
});

describe('a note is a row on the page, not a card', () => {
  test.each(['const noteRowStyles', 'const linkCardStyles'])(
    '%s has no card chrome left on its container', (factory) => {
      // Six pieces of furniture per note — fill, border, radius, shadow, gap —
      // every one of them saying what a single line between two rows says on
      // its own.
      const container = styleNamed(factory, 'row');
      expect(container).not.toMatch(/backgroundColor/);
      expect(container).not.toMatch(/cardEdge/);
      expect(container).not.toMatch(/borderWidth|borderColor/);
      expect(container).not.toMatch(/marginBottom/);
      expect(container).not.toMatch(/depth\(theme, 'card'\)/);
    },
  );

  test('neither shape still calls itself a card', () => {
    // `styles.card` surviving means one of the two kept its box, and the list
    // reads as two different things scrolling past each other.
    expect(SRC).not.toMatch(/styles\.card\b/);
  });

  test('the accent is no longer laid down as a surface here', () => {
    // The fill went with the card. These helpers were deleted with it; a
    // reference surviving means one of them grew a caller again.
    expect(SRC).not.toMatch(/accentGradient|inkAlpha|surfaceAccent/);
  });
});

describe("what separates two notes is the app's own groove", () => {
  test('the list draws a separator between rows', () => {
    expect(SRC).toMatch(/ItemSeparatorComponent=\{noteSeparator\}/);
  });

  test('it is insetRule — the same cut that sits under a tab header', () => {
    const block = styleNamed('const createStyles', 'noteSeparator');
    expect(block).toMatch(/\.\.\.insetRule\(theme\)/);
    // A groove SEPARATES; a ridge is the top edge of something. Used the wrong
    // way round they both still draw and the page quietly stops making sense.
    expect(block).not.toMatch(/ridgeRule/);
  });

  test('it is a View of its own, and takes no height of its own', () => {
    // insetRule IS two borders a point apart: they give the element exactly the
    // height it should have, and setting one collapsed a header to nothing the
    // last time it was tried.
    expect(styleNamed('const createStyles', 'noteSeparator')).not.toMatch(/height:/);
    expect(SRC).toMatch(/<View style=\{styles\.noteSeparator\} \/>/);
  });

  test('the separator component has a stable identity', () => {
    // Inline, FlatList tears down and rebuilds every separator in the list on
    // each render of the screen.
    expect(SRC).toMatch(/const noteSeparator = useCallback\(/);
  });
});
