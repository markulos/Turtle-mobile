/**
 * THE RULE: what says "active", "selected" or "today" on screen takes the USER'S
 * HIGHLIGHT COLOUR, and anything drawn on top of that colour is inked against it.
 *
 * Two defects this closes, both of which shipped:
 *
 *   1. A LITERAL COLOUR STANDING IN FOR THE ACCENT. The week strip's selected-day
 *      pill was `const WEEK_SELECT_BG = '#F5A623'` — the loudest mark in the
 *      planner, pinned to amber, so choosing violet in Settings left the planner
 *      orange and made the whole setting feel like a decoration.
 *   2. A FIXED INK ON AN ACCENT FILL. `color: '#fff'` on a key filled with the
 *      accent is correct for every saturated colour and invisible on a pale one
 *      (light pink is a preset now, and a custom colour can be paler still). The
 *      fix is `inkOn(...)` from utils/accentColor — ONE definition, shared with
 *      the board palette.
 *
 * A convention nobody enforces drifts back, so this scans the source rather than
 * trusting the sweep to have been final. It is deliberately narrow: it does not
 * police every colour in the app, only these two shapes.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DIRS = ['screens', 'components'];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walk(p, out);
    } else if (/\.jsx?$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

const FILES = DIRS.flatMap((d) => walk(path.join(ROOT, d)));

describe('nothing stands in for the highlight colour', () => {
  /**
   * A module-level `const NAME = '#hex'` whose NAME claims it is the selected /
   * active / today / highlight colour. That is the accent's job by definition,
   * and a literal cannot follow a setting.
   *
   * Names that describe a STATE rather than a selection are none of this test's
   * business — a done mint, a live red, a late red are semantic and must not
   * follow the accent.
   */
  test('no literal hex is named as a selection or highlight colour', () => {
    const CLAIMS = /(SELECT|ACTIVE|TODAY|HIGHLIGHT|ACCENT|CURRENT)/;
    const offenders = [];
    for (const file of FILES) {
      const src = fs.readFileSync(file, 'utf8');
      const re = /^(?:export )?const ([A-Z][A-Z_0-9]*) *= *'(#[0-9a-fA-F]{3,8})'/gm;
      let m;
      while ((m = re.exec(src)) !== null) {
        if (CLAIMS.test(m[1])) offenders.push(`${rel(file)}:${lineOf(src, m.index)} ${m[1]} = ${m[2]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('an accent fill carries derived ink', () => {
  /**
   * Every style block that paints a SOLID accent fill, with the file it is in.
   *
   * Crude on purpose: it finds `backgroundColor: <something>.accent…` inside a
   * StyleSheet and reports the style's name, which is enough to ask the only
   * question that matters — does this file know about `inkOn`?
   */
  const accentFills = [];
  for (const file of FILES) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const fill = /backgroundColor:\s*([A-Za-z_.]*\.(?:accent|accentInfo)\b[^,}\n]*)/.exec(line);
      if (!fill) return;
      // A TINT is not a fill: `accentInfo + '2E'` is a wash under ordinary ink,
      // which is exactly how an active chip is meant to work. Only a SOLID
      // accent needs derived ink on top of it.
      if (/\+\s*(['"`]|\()/.test(fill[1])) return;
      let name = '';
      for (let j = i; j >= 0 && j > i - 14; j -= 1) {
        const m = /^\s{2,8}([a-zA-Z0-9_]+):\s*\{/.exec(lines[j]);
        if (m) { name = m[1]; break; }
      }
      accentFills.push({ file, name, line: i + 1 });
    });
  }

  test('the scan reached the app — this is not passing on an empty set', () => {
    // The dock's chip, the Notes FAB, the filter panels' Done keys, the date
    // picker's selected day… there are well over a dozen.
    expect(accentFills.length).toBeGreaterThan(10);
  });

  /**
   * Styles that paint an accent fill and CARRY NOTHING — a 3pt underline, a
   * 8pt "shared" dot, the dock's chip (whose glyph is inked in App.js, where the
   * navigator hands every tab its colour). Nothing is drawn on top of these, so
   * there is no ink to derive.
   */
  const CARRIES_NO_INK = new Set([
    'screens/TasksScreen/index.jsx',                          // the header's active-page bar
    'screens/TurtleScreen/components/MediaGallery.jsx',       // the gallery's tab underline
    'screens/TurtleScreen/components/PhotoVaultBoardsPage.jsx', // the "live board" dot
    'components/TabBarPill.jsx',                              // chip; glyph inked in App.js
    'screens/TurtleScreen/components/FilesVault/DocumentRow.jsx', // a progress bar's fill
  ]);

  test('every file that fills with the accent knows how to ink it', () => {
    const offenders = [];
    for (const { file, name, line } of accentFills) {
      const r = rel(file);
      if (CARRIES_NO_INK.has(r)) continue;
      const src = fs.readFileSync(file, 'utf8');
      if (!/inkOn/.test(src)) offenders.push(`${r}:${line} [${name || 'inline'}]`);
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The specific ink that keeps being wrong. A literal white (or the PAGE
   * colour, which on the light theme is near-white) on the same style that fills
   * with the accent: legible on every saturated preset, gone on a pale one.
   */
  test('no accent-filled style pairs itself with a fixed white ink', () => {
    const WHITE = /color:\s*'#(fff|ffffff)'/i;
    const PAGE = /color:\s*[A-Za-z_.]*\.background\b/;
    const offenders = [];
    for (const { file, name } of accentFills) {
      if (!name || CARRIES_NO_INK.has(rel(file))) continue;
      const src = fs.readFileSync(file, 'utf8');
      // The ink for a style called `doneKey` lives in `doneKeyText` / `doneText`.
      const base = name.replace(/(Key|Btn|Button|Cell|Chip|Active|On)$/, '');
      const inkNames = [`${name}Text`, `${base}Text`, `${base}Label`];
      for (const ink of inkNames) {
        const m = new RegExp(`\\b${ink}:\\s*\\{([^}]*)\\}`).exec(src);
        if (m && (WHITE.test(m[1]) || PAGE.test(m[1]))) {
          offenders.push(`${rel(file)} ${ink} (on ${name})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
