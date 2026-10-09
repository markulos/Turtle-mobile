const fs = require('fs');
const path = require('path');

/**
 * A DOUBLE TAP IS TWO TOUCHES THAT HELD STILL.
 *
 * `Gesture.Tap().numberOfTaps(2)` with the library's defaults allows half a
 * second between the touches and, unless told otherwise, ANY amount of travel
 * during them. On a surface whose main gesture is scrolling, two quick flicks
 * are exactly that — so the double tap fires. That is the note composer
 * raising the keyboard in the middle of a scroll, which is the bug this scan
 * exists to stop coming back: the limits live in utils/pressBehavior as
 * DOUBLE_TAP, and every two-tap gesture in the app spreads them.
 *
 * It is the same shape as inputField.scan.test.js and the panel-inset scan: a
 * convention nobody enforces drifts back one call site at a time.
 */
const ROOTS = ['screens', 'components', 'utils', 'context'];
const SKIP = new Set(['node_modules', '__tests__', 'archive', '.worktrees']);

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Comments BLANKED, not deleted — a comment mentioning the rule must not
 *  answer for a gesture that does not follow it, and every offset reported
 *  here has to still match the real file. */
const blankComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));

/** Every `Gesture.Tap()` chain in a file, as text. A chain ends at `.onEnd(`
 *  or `.onBegin(` — the first handler — which is past every limit it sets. */
function tapChains(src) {
  const chains = [];
  const re = /Gesture\.Tap\(\)/g;
  let m = re.exec(src);
  while (m) {
    const from = m.index;
    const handler = src.slice(from).search(/\.on(End|Begin|Start|Finalize)\(/);
    chains.push(src.slice(from, from + (handler < 0 ? 400 : handler)));
    m = re.exec(src);
  }
  return chains;
}

const FILES = ROOTS.flatMap((r) => (fs.existsSync(r) ? sourceFiles(r) : []));

test('the scan is actually reading the app', () => {
  expect(FILES.length).toBeGreaterThan(100);
  // And it can see the gesture it is about.
  const anyTap = FILES.some((f) => blankComments(fs.readFileSync(f, 'utf8')).includes('Gesture.Tap()'));
  expect(anyTap).toBe(true);
});

test('every double tap declares how still it has to be', () => {
  const offenders = [];
  for (const file of FILES) {
    const src = blankComments(fs.readFileSync(file, 'utf8'));
    for (const chain of tapChains(src)) {
      if (!chain.includes('numberOfTaps(2)')) continue;
      const has = (name) => chain.includes(`.${name}(`);
      if (has('maxDistance') && has('maxDelay') && has('maxDuration')) continue;
      offenders.push(`${file}: a double tap without ${
        ['maxDuration', 'maxDelay', 'maxDistance'].filter((n) => !has(n)).join(' / ')
      }`);
    }
  }
  expect(offenders).toEqual([]);
});

test('and takes those numbers from the one place that defines them', () => {
  const loose = [];
  for (const file of FILES) {
    const src = blankComments(fs.readFileSync(file, 'utf8'));
    for (const chain of tapChains(src)) {
      if (!chain.includes('numberOfTaps(2)')) continue;
      // A literal here is a second opinion about what a double tap is.
      if (/\.max(Duration|Delay|Distance)\(\s*\d/.test(chain)) loose.push(file);
    }
  }
  expect(loose).toEqual([]);
});
