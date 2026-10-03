import fs from 'fs';

/**
 * THE FACES ON A NOTE CARD SIT AT THE SAME x ON EVERY CARD.
 *
 * That is the whole reason the byline trails its name rather than leading it,
 * and it is what makes a column of cards scannable: the one thing you track
 * down the list does not move.
 *
 * It was still wrong after that change, because pinning the stack to the right
 * of its ROW is only half of it — the row has to BE the card's width. The
 * footer used to live inside the body column, whose right edge moves inward by
 * a 46pt thumbnail on a note with attachments and by a Claude key on a to-do.
 * So the faces landed at up to three different x's in one screenful, which is
 * exactly what the anchoring was for.
 *
 * ─── Why a source scan and not a render test ───────────────────────────────
 *
 * Because what regressed is STRUCTURE — which parent the footer hangs off —
 * and in a render tree both arrangements put the same byline on screen with
 * the same props. Only a layout pass on a real device tells them apart, and
 * there is no device in CI. The nesting is the thing, so the nesting is what
 * is pinned.
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

describe('the byline hangs off the card, not off the body column', () => {
  test('the card is a column with a separate top line', () => {
    // The card used to BE the row. If `styles.main` is gone, the top line has
    // been folded back into the card and the footer is inside the body again.
    expect(noteRow).toMatch(/style=\{styles\.card\}/);
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
  const styles = (() => {
    const from = SRC.indexOf('const noteRowStyles');
    return SRC.slice(from, SRC.indexOf('\n});', from));
  })();

  test('the key column and the gap are named once and shared', () => {
    // Three places have to agree: both leading keys and the footer's inset. A
    // literal in any of them is how the timestamp quietly stops lining up with
    // the note's first word.
    expect(SRC).toMatch(/const ICON_COL = \d+;/);
    expect(SRC).toMatch(/const ICON_GAP = \d+;/);
    expect(styles).toMatch(/paddingLeft: ICON_COL \+ ICON_GAP/);
    for (const key of ['checkbox', 'noteIcon']) {
      const block = styles.slice(styles.indexOf(`${key}: {`));
      expect(block.slice(0, block.indexOf('}'))).toMatch(/width: ICON_COL/);
    }
  });
});

describe('a note card is filled with the chosen highlight', () => {
  const cardBlock = (factory) => {
    const from = SRC.indexOf(factory);
    expect(from).toBeGreaterThan(-1);
    const block = SRC.slice(from, SRC.indexOf('\n};', from));
    const card = block.slice(block.indexOf('card: {'));
    return card.slice(0, card.indexOf('\n  },'));
  };

  test.each(['const noteRowStyles', 'const linkCardStyles'])(
    '%s fills the card with the accent itself', (factory) => {
      // A neutral card among coloured ones reads as a different app, and these
      // two shapes sit in one list.
      expect(cardBlock(factory)).toMatch(/backgroundColor: theme\.colors\.accent,/);
    },
  );

  test.each(['const noteRowStyles', 'const linkCardStyles'])(
    '%s clips the gradient to its corners', (factory) => {
      // The gradient is an absolutely-filled CHILD. Without this it paints
      // square corners over the card's rounded ones.
      expect(cardBlock(factory)).toMatch(/overflow: 'hidden'/);
    },
  );

  test.each(['const noteRowStyles', 'const linkCardStyles'])(
    '%s draws its edge in ink, not in the accent', (factory) => {
      // cardEdge() is a wash of the accent. On a card MADE of the accent that
      // edge is invisible, which is the one thing it may not be — so the colour
      // is overridden after the spread.
      const card = cardBlock(factory);
      expect(card).toMatch(/\.\.\.cardEdge\(theme\),\s*\n\s*borderColor: inkAlpha\(ink, [\d.]+\),/);
    },
  );

  test('both shapes paint the gradient, and it never eats the press', () => {
    expect((SRC.match(/colors=\{cardFill\}/g) || []).length).toBe(2);
    expect((SRC.match(/accentGradient\(theme\.colors\.accent\)/g) || []).length).toBe(2);
    // A fill that swallowed the tap would make every card dead.
    const layers = SRC.split('colors={cardFill}').slice(1);
    for (const after of layers) {
      expect(after.slice(0, after.indexOf('/>'))).toMatch(/pointerEvents="none"/);
    }
  });

  test('nothing on a filled card is still coloured by the PAGE', () => {
    // Grey on orange reads as a second ink rather than as the first one said
    // quietly, and accentInfo IS the accent — invisible on a card made of it.
    for (const factory of ['const noteRowStyles', 'const linkCardStyles']) {
      const from = SRC.indexOf(factory);
      const block = SRC.slice(from, SRC.indexOf('\n};', from));
      for (const token of ['textPrimary', 'textSecondary', 'textMuted', 'surfaceElevated']) {
        expect(block).not.toMatch(new RegExp(`theme\\.colors\\.${token}`));
      }
    }
  });
});
