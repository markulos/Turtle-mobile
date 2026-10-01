/**
 * THE TOP HOOD, scanned — every full-screen page clears the status bar itself.
 *
 * STYLE-RULES §4. This is a scan rather than a render test because the bug is
 * not in any one panel: it is a piece of REASONING that spreads. "This overlay
 * opens inside a screen whose header already cleared the status bar, so taking
 * the inset here would clear it twice" sounds right, is wrong, and got copied
 * from the Planner's filter panel into the Notes one word for word. Both then
 * drew their back key, their title and their Clear key straight through the
 * clock on a phone with a Dynamic Island.
 *
 * An EdgeSwipePage is an ABSOLUTE FILL (or, in its Modal form, explicitly
 * `statusBarTranslucent`). Neither form inherits an ancestor's safe-area
 * padding, so the hood is the page's own job — always, and not a judgement
 * call per panel, which is why there is a `panelTopInset` to call.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/** Every source file under the app's own trees (never node_modules, never tests). */
function sources() {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        walk(p);
      } else if (/\.jsx?$/.test(entry.name)) {
        out.push(p);
      }
    }
  })(path.join(ROOT, 'screens'));
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        walk(p);
      } else if (/\.jsx?$/.test(entry.name)) {
        out.push(p);
      }
    }
  })(path.join(ROOT, 'components'));
  return out;
}

const pages = sources()
  .filter((f) => /<EdgeSwipePage/.test(fs.readFileSync(f, 'utf8')))
  .map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));

// A page clears the hood by naming the inset somehow: the helper, the raw
// `insets.top`, or a prop it hands down to the page that renders the chrome
// (`topInset` / `insetTop` / `pageTopInset` are the names already in use).
const CLEARS_HOOD = /panelTopInset|insets\.top|\btopInset\b|\binsetTop\b|\bpageTopInset\b|\bsafeTop\b/;

/**
 * Comments stripped, because this file is full of prose ABOUT the hood and a
 * panel must not pass the scan by explaining the rule it is breaking — which
 * is exactly what the broken NotesFilterPanel did on the first run of this
 * test, its comment still naming `panelTopInset` after the call was gone.
 */
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('every EdgeSwipePage clears the top hood', () => {
  test('the scan actually found the pages (a silent zero would pass forever)', () => {
    expect(pages.length).toBeGreaterThan(10);
    expect(pages).toContain('screens/NotesScreen/NotesFilterPanel.jsx');
    expect(pages).toContain('screens/TasksScreen/components/PlannerFilterPanel.jsx');
  });

  test.each(pages)('%s says what it does about the status bar', (rel) => {
    expect(code(fs.readFileSync(path.join(ROOT, rel), 'utf8'))).toMatch(CLEARS_HOOD);
  });
});

describe('the exact regression that put a title through the clock', () => {
  // The two filter panels are the ones it happened to. Their header took a
  // bare `paddingTop: 8` — the breathing room with the hood left out.
  const FILTER_PANELS = [
    'screens/NotesScreen/NotesFilterPanel.jsx',
    'screens/TasksScreen/components/PlannerFilterPanel.jsx',
  ];

  test.each(FILTER_PANELS)('%s pads its header from the inset, not a constant', (rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    expect(src).toMatch(/paddingTop: panelTopInset\(insets\.top\)/);
    expect(src).not.toMatch(/s\.header, \{ paddingTop: 8 \}/);
  });

  // PlannerSearchPanel opted its overlay form out with a literal 0, which is
  // the same mistake wearing a prop. The hood is not conditional on the form.
  test('no caller opts an overlay out of the hood', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'screens/TasksScreen/components/PlannerSearchPanel.jsx'), 'utf8',
    );
    expect(src).not.toMatch(/insetTop=\{[^}]*\b0\b[^}]*\}/);
  });
});
