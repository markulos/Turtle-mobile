const fs = require('fs');
const path = require('path');

const { NEU_BLUR, NEU_GAP, NEU_OFFSET, NEU_PAGE_TOP } = require('../neumorph');

/**
 * STYLE-RULES §9, kept true: a neumorphic surface is ONE PLANE, deformed.
 *
 * `neumorph.test.js` already proves the maths — the tones come off the
 * surface's own colour, raised and pressed are mirrors, the reach stays inside
 * the gutter. What it cannot see is whether the SCREENS still use it that way,
 * and every failure on this style so far has been exactly that: a panel that
 * kept its old border, a grain laid without the panel's radius, a page that
 * kept `theme.colors.background` under panels painted a different colour.
 *
 * So this pins the two tabs that wear it (Focus, Inbox) by name, the same way
 * §8's scan pins the lists it converted. Not a heuristic over the whole app:
 * most surfaces are correctly NOT this style, and no regex can tell a card
 * that should be raised from one that should not.
 */

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/**
 * The same file with its prose taken out.
 *
 * These files are heavily commented, and the comments say what the code must
 * NOT do — "NOT insetCardPalette", "not `c.background`". Matching the raw text
 * fails on the very notes that explain the rule, which would teach the next
 * person to delete the explanation to get the test green.
 */
const code = (rel) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every file that draws one of the two neumorphic tabs. */
const SURFACES = [
  'screens/TasksScreen/components/FocusPage.jsx',
  'screens/TasksScreen/components/FocusStatsPanel.jsx',
  'screens/TasksScreen/components/OverviewPage.jsx',
  'screens/TasksScreen/components/InboxCapture.jsx',
  'screens/TasksScreen/components/InboxList.jsx',
];
/**
 * The ones that BUILD the palette, as opposed to being handed one.
 *
 * FocusStatsPanel takes `pal` as a prop from the page that pushed it, which is
 * the right arrangement — a pushed panel must not be able to disagree with the
 * page it came from about what colour the surface is.
 */
const OWNS_PALETTE = SURFACES.filter((rel) => !rel.endsWith('FocusStatsPanel.jsx'));
/**
 * …and the ones that are a PANEL, as opposed to a panel's contents.
 *
 * InboxList stopped being its own panel on 2026-11-16: Mark asked for the
 * capture box and the list it builds to be one object, so the list is now the
 * lower half of InboxCapture's deck. It still reads the §9 palette for the
 * colour of its rules, so the palette checks still apply to it — but it has
 * no ground to paint and no tooth to lay, because the panel it sits in
 * already did both.
 */
const PANELS = SURFACES.filter((rel) => !rel.endsWith('InboxList.jsx'));

describe('STYLE-RULES §9 — the neumorphic surfaces', () => {
  test('the rule is WRITTEN DOWN, which is the half that outlives the code', () => {
    const doc = read('docs/STYLE-RULES.md');
    const sec = doc.slice(doc.indexOf('## 9.'));
    expect(doc).toMatch(/##\s*9\./);
    // The three parts a later screen has to be able to find by searching.
    for (const part of ['neuRaised', 'focusSkin', 'Grain']) expect(sec).toContain(part);
    // And it is on the pre-ship checklist, or it is a document nobody opens.
    expect(doc.slice(doc.indexOf('## Checklist'))).toMatch(/§9/);
  });

  test('every neumorphic surface takes its light from utils/neumorph', () => {
    // Hand-rolled `boxShadow` on one of these pages is the drift that matters:
    // two tones picked by eye do not follow the theme, and nothing stops them
    // reaching past the gutter.
    for (const rel of SURFACES) {
      const src = code(rel);
      expect(src).toMatch(/from '(\.\.\/)+utils\/neumorph'/);
      expect(src).not.toMatch(/\bboxShadow\s*:/);
    }
  });

  test('…and its COLOUR from focusSkin, never from the inset card palette', () => {
    // insetCardPalette's `text` is WHITE IN BOTH MODES, because its card is a
    // charcoal recess on a page it stands off (§1). On a cream neumorphic
    // surface that ink is invisible, and the app has shipped it twice.
    // Nobody on these two tabs may reach for the other palette…
    for (const rel of SURFACES) {
      expect(code(rel)).not.toMatch(/insetCardPalette|boardCardPalette/);
    }
    // …and the ones that build their own build it from this one.
    for (const rel of OWNS_PALETTE) expect(code(rel)).toMatch(/focusSkin/);
  });

  test('THE GROUND IS THE PANEL’S COLOUR — there is no page colour left', () => {
    // The whole illusion is figure and ground sharing one colour. A page that
    // keeps `theme.colors.background` under panels painted `focusSkin().card`
    // turns every panel back into a card, which is the other style.
    for (const rel of OWNS_PALETTE.filter((r) => PANELS.includes(r))) {
      const src = code(rel);
      // The colour comes from the §9 palette — painted onto the ground, or
      // handed to neuRaised/neuPressed, which returns it as the panel's fill.
      expect(src).toMatch(/backgroundColor:\s*pal\.card|neu(Raised|Pressed)\(pal\.card/);
      // …and no page root falls back to the theme's own page colour. Scoped to
      // a ROOT rather than banned outright: `c.background` is still the right
      // ink ON a `textPrimary`-filled key, which is a contrast question and
      // not a ground.
      expect(src).not.toMatch(/styles\.page,\s*\{\s*backgroundColor:\s*c\./);
      expect(src).not.toMatch(/paddingTop:\s*pageTopInset,\s*backgroundColor:\s*c\./);
    }
  });

  test('the grain is laid with the panel’s own radius', () => {
    // A repeating fill is not clipped by the radius of the view it is laid in
    // (components/Grain owns that clip). A rounded panel whose grain has no
    // radius gets square corners of speckle over its own curve — which is the
    // first thing that shipped, and is invisible in jest.
    for (const rel of PANELS) {
      const src = code(rel);
      const tags = src.match(/<Grain\b[^/]*\/>/g) || [];
      expect(tags.length).toBeGreaterThan(0);
      // Every tag carries the level, so one setting moves all of them.
      for (const tag of tags) expect(tag).toMatch(/level=\{grain\}/);
      // And a rounded panel's grain is given that radius.
      if (/borderRadius/.test(src)) expect(src).toMatch(/<Grain\b[^/]*radius=/);
    }
  });

  test('…and takes its strength as a PROP, not from the theme directly', () => {
    // components/Grain must not import ThemeContext — it drags AsyncStorage
    // into every suite that mounts it, which is the documented trap in
    // utils/inputField. So the screen reads it once and threads it down.
    expect(code('components/Grain.jsx')).not.toMatch(/ThemeContext|useTheme/);
    for (const rel of SURFACES) expect(code(rel)).not.toMatch(/useTheme\(\)/);
    // The screen is where the read happens, and where it is handed over.
    const screen = code('screens/TasksScreen/index.jsx');
    expect(screen).toMatch(/,\s*grain\s*\}\s*=\s*useTheme\(\)/);
    expect(screen).toMatch(/grain=\{grain\}/);
  });

  test('the page’s top gutter is the shared number, on BOTH tabs', () => {
    // Mark asked for the margin twice — above the focus timer and above the
    // planner header — which is what made it a constant rather than a number
    // typed into two stylesheets.
    expect(NEU_PAGE_TOP).toBe(NEU_GAP * 2);
    // Still inside what the shading can live in: the gutter has to be at least
    // the reach, or the first panel's highlight is clipped by the chrome.
    expect(NEU_PAGE_TOP).toBeGreaterThanOrEqual(NEU_OFFSET + NEU_BLUR);
    for (const rel of ['screens/TasksScreen/components/FocusPage.jsx',
      'screens/TasksScreen/components/OverviewPage.jsx',
      'screens/TasksScreen/index.jsx']) {
      expect(code(rel)).toMatch(/NEU_PAGE_TOP/);
    }
  });
});
