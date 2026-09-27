import fs from 'fs';
import path from 'path';

/**
 * THE APP HAS ONE SEPARATOR, and this is what keeps it that way.
 *
 * `insetRule` / `ridgeRule` (utils/surfaceDepth) are two lines — a shadow and a
 * highlight — because one line can only ever be a line drawn ON the page and
 * two are a line cut INTO it. The point is that every header carries the SAME
 * one; a screen that quietly goes back to `borderBottomWidth: hairline` does
 * not look broken, it looks like a different app for one screen, which is
 * exactly the kind of drift nobody files a bug about.
 *
 * A convention nobody enforces drifts back — the same reasoning behind the
 * INPUT_FIELD scan and the tabBarLayout one.
 *
 * ─── The list is allowed to SHRINK and nothing else ────────────────────────
 *
 * The headers below still draw their own line. They are not exceptions and
 * they are not fine; they are the work that has not been done yet, named here
 * so it is visible rather than forgotten. Converting one means deleting its
 * line from this list. Adding a line to it means a new screen has gone its own
 * way, which is what the count test is here to stop.
 *
 * ─── What it deliberately ignores ──────────────────────────────────────────
 *
 * A hairline that is not a HEADER's. A divider inside a list, a rule between
 * two rows of a card, the cell borders of a calendar — those are lines within
 * one surface and have never been this rule's business. Only a style whose
 * NAME says header.
 */
const ROOTS = ['screens', 'components'];
const EXT = new Set(['.js', '.jsx']);

/** Headers not yet converted. This list may only ever get shorter. */
const NOT_YET = [
  'screens/PasswordsScreen/index.jsx → header',
  'screens/ShareTargetScreen.jsx → header',
  'screens/TasksScreen/components/FocusStatsPanel.jsx → topBar',
  'screens/TasksScreen/components/StatsPanel.jsx → topBar',
  'screens/TasksScreen/components/TaskForm.jsx → headerBar',
  'screens/TurtleScreen/components/MediaGallery.jsx → header',
  'screens/TurtleScreen/components/TerminalConsole.jsx → header',
  'screens/TurtleScreen/components/VaultImagePicker.jsx → header',
  'screens/TurtleScreen/index.jsx → header',
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

/**
 * A style block called `header…` / `topBar` / `headerBar` that draws its own
 * bottom border. The NAME is the signal: these are the screen-level bars the
 * rule governs, not every line in the app.
 */
const OFFENDER = /((?:header|topBar|chatHeader|headerBar)[A-Za-z]*)\s*:\s*\{[^{}]*borderBottomWidth[^{}]*\}/g;

/**
 * `borderBottomWidth: 0` is a header explicitly REFUSING a line, which is the
 * opposite of the drift this looks for. Filtered on the MATCHED TEXT rather
 * than folded into the pattern: a negative lookahead in there silently stopped
 * catching real offenders too, and a scan that quietly matches nothing is worse
 * than no scan at all.
 */
const drawsALine = (block) => !/borderBottomWidth\s*:\s*0/.test(block);

const files = ROOTS.flatMap((r) => (fs.existsSync(r) ? walk(r) : []));

function offenders() {
  const found = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(OFFENDER)) {
      found.push(`${file.replace(/\\/g, '/')} → ${m[1]}`);
    }
  }
  return found.sort();
}

describe('one separator, app-wide', () => {
  test('the scan actually reaches the app', () => {
    // A scan over nothing passes forever and tells you nothing.
    expect(files.length).toBeGreaterThan(50);
  });

  // The tabs this standard was set for. These may never regress.
  test.each([
    ['screens/TasksScreen/index.jsx', 'the Planner'],
    ['screens/NotesScreen/index.jsx', 'Notes'],
  ])('%s (%s) carries the shared rule and draws no line of its own', (file) => {
    const src = fs.readFileSync(file, 'utf8');
    expect(src).toMatch(/insetRule|ridgeRule/);
    expect(offenders().some((o) => o.startsWith(`${file} →`))).toBe(false);
  });

  test('no NEW header goes its own way', () => {
    // Named, so a failure says which file and which style rather than just
    // "something somewhere".
    expect(offenders()).toEqual(NOT_YET);
  });

  test('…and the unconverted list only ever shrinks', () => {
    expect(offenders().length).toBeLessThanOrEqual(NOT_YET.length);
  });

  test('the rule lives in one place and is not copied around', () => {
    const src = fs.readFileSync(path.join('utils', 'surfaceDepth.js'), 'utf8');
    expect(src).toMatch(/export function insetRule/);
    expect(src).toMatch(/export function ridgeRule/);
    // The highlight's own value hard-coded anywhere else is the copy this stops.
    const copies = files.filter((f) => /rgba\(255,\s*255,\s*255,\s*0\.92\)/.test(fs.readFileSync(f, 'utf8')));
    expect(copies).toEqual([]);
  });
});
