const fs = require('fs');
const path = require('path');

/**
 * STYLE-RULES §8, kept true: a column of tappable rows is a LIST.
 *
 * Rows separated by `insetRule`, with no per-row fill, border, radius or
 * shadow, and the leading glyph in `listGlyphInk` rather than the highlight
 * colour. The reasoning is in the rule; what this file does is stop the
 * convention drifting back, which is the only thing that ever happens to a
 * convention nobody enforces.
 *
 * Deliberately NOT a heuristic over the whole app. "A rounded bordered box"
 * is also a perfectly good summary card, hero or callout — §8 is about
 * COLUMNS OF PEERS, and no regex can tell those apart from a one-off panel
 * without guessing. So this pins the lists that have been converted, and the
 * ink, which has one correct source and no reason to be copied anywhere.
 */

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * The body of a named entry in a StyleSheet object, as text.
 *
 * `after` scopes the search, because a screen may legitimately hold two
 * entries of the same name in two different stylesheets — ProfileScreen has
 * a `card` for its stats panel (which IS a card, correctly) and a `card` for
 * its option rows (which is not). Matching the first would test the wrong
 * one and then pass or fail for the wrong reason.
 */
function styleBlock(src, name, after) {
  const start = after ? src.indexOf(after) : 0;
  if (after && start < 0) return null;
  const at = src.indexOf(`\n  ${name}: {`, start);
  const from = at >= 0 ? at : src.indexOf(`\n    ${name}: {`, start);
  if (from < 0) return null;
  const open = src.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

// The lists brought over to §8, and the style each row wears.
const LISTS = [
  {
    file: 'screens/ProfileScreen/index.jsx',
    row: 'card',
    after: 'const makeStyles',
    what: 'the Profile page’s options',
  },
  { file: 'screens/TurtleScreen/components/PhotoVaultBoardsPage.jsx', row: 'canvasRow', what: 'New album / Canvases' },
];

describe('STYLE-RULES §8 — rows are a list, not a stack of cards', () => {
  test.each(LISTS)('$what carries no per-row panel', ({ file, row, after }) => {
    const block = styleBlock(read(file), row, after);
    expect(block).not.toBeNull();
    // The four things that turn a row back into a card. A gap would do it
    // too, but `gap` inside the row is the spacing between its OWN glyph and
    // text, which is fine — only the container's gap would separate rows,
    // and the rule is what does that now.
    expect(block).not.toMatch(/backgroundColor/);
    expect(block).not.toMatch(/borderRadius/);
    expect(block).not.toMatch(/borderWidth/);
    expect(block).not.toMatch(/\.\.\.depth\(/);
  });

  test.each(LISTS)('$what separates its rows with insetRule', ({ file }) => {
    const src = read(file);
    expect(src).toMatch(/insetRule\(theme\)/);
    // An ELEMENT between rows, not a border on one: insetRule is two
    // hairlines a point apart and as a border it draws across the top edge
    // too. The giveaway is that it is spread into a style array on a View.
    expect(src).toMatch(/style=\{\[insetRule\(theme\)/);
  });

  test.each(LISTS)('$what inks its glyph from the one source', ({ file }) => {
    expect(read(file)).toMatch(/listGlyphInk\(theme\)/);
  });

  test('the PROFILE block is closed too — a rule above it and below', () => {
    // Same shape as the doors below, and for the same reason. The identity
    // block has no backdrop of its own (that was the point of de-carding it),
    // so a rule under it alone left it open at the top — hanging off the
    // status bar rather than sitting in a band of its own. Mark asked for the
    // second one by name: "put a full width ridge line above profile panel as
    // well."
    const src = read('screens/ProfileScreen/index.jsx');
    const scroll = src.slice(src.indexOf('refreshControl='), src.indexOf('{/* The options, as a LIST'));
    // Two full-bleed rules, one each side of the block…
    const bare = scroll.match(/style=\{insetRule\(theme\)\}/g) || [];
    expect(bare).toHaveLength(2);
    // …and the first of them comes BEFORE the block, not after it.
    expect(scroll.indexOf('style={insetRule(theme)}')).toBeLessThan(scroll.indexOf('styles.identityCard'));
    // FULL-BLEED, not the inset the option rows use between themselves: these
    // divide two REGIONS of the page, which is §8's other case.
    expect(scroll).not.toMatch(/insetRule\(theme\), styles\.cardSep/);
    // And the block still has no backdrop of its own — a rule above AND below
    // a panel that also has a fill is three claims about one edge.
    const card = styleBlock(src, 'identityCard', 'const makeStyles');
    expect(card).not.toMatch(/backgroundColor|borderRadius|borderWidth/);
  });

  test('the New album / Canvases group is CLOSED — a rule above it and below', () => {
    // Mark, 2026-11-15: "add a ridge line on the top and bottom of new album
    // and canvases". With only the score between them the pair read as two
    // loose lines of text between a card and a strip; bounded, they are a
    // block of doors.
    //
    // And the two edges are FULL-BLEED while the one between the rows is
    // inset — §8's own distinction: a rule dividing two REGIONS runs the
    // width, a rule dividing two ITEMS starts where their text does. Getting
    // that backwards is what makes a page look like it was ruled at random.
    const file = 'screens/TurtleScreen/components/PhotoVaultBoardsPage.jsx';
    const src = read(file);
    expect(src.match(/styles\.canvasEdge/g)).toHaveLength(2);
    const edge = styleBlock(src, 'canvasEdge');
    expect(edge).toMatch(/marginHorizontal:\s*-EDGE_PAD/);
    // …and the item rule is still the inset one, unchanged.
    expect(styleBlock(src, 'canvasSep')).toMatch(/marginLeft:\s*\d+/);
    expect(src.match(/styles\.canvasSep/g)).toHaveLength(1);
  });

  test('the ink is never copied — there is one of it', () => {
    // A hex pasted into a screen is a rule that holds until somebody retunes
    // the original and misses the copy.
    const { LIST_GLYPH_LIGHT } = require('../surfaceDepth');
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.git', '__tests__', 'ios', 'assets'].includes(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(jsx?|tsx?)$/.test(e.name)) {
          const src = fs.readFileSync(p, 'utf8');
          if (src.includes(LIST_GLYPH_LIGHT) && !p.endsWith(path.join('utils', 'surfaceDepth.js'))) {
            offenders.push(path.relative(ROOT, p).replace(/\\/g, '/'));
          }
        }
      }
    };
    for (const d of ['screens', 'components', 'utils']) walk(path.join(ROOT, d));
    expect(offenders).toEqual([]);
  });

  test('the rule is written down, not just practised', () => {
    // A convention that lives only in the code it was last applied to is one
    // the next person re-decides from scratch.
    const doc = read(path.join('docs', 'STYLE-RULES.md'));
    expect(doc).toMatch(/## 8\. A list of rows is a LIST/);
    expect(doc).toMatch(/listGlyphInk/);
    expect(doc).toMatch(/insetRule/);
  });
});
