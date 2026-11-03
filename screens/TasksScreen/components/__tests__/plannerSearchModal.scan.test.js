import fs from 'fs';

/**
 * THE TASK SEARCH OPENS A MODAL, SO IT CANNOT BE ONE.
 *
 * A hit in the Planner's search opens the task's edit FORM, and TaskForm is
 * mounted in its Modal form (it takes an `overlay` prop and this screen does
 * not pass it). iOS will not present a second sibling Modal while the first is
 * still dismissing — EdgeSwipePage says so at the top of the file, TaskForm
 * says it again at its own — so a search panel in the Modal form slides away
 * and the form never arrives. SILENTLY: no warning, no crash, just a press
 * that did nothing. It shipped exactly once, in 08ef8e0.
 *
 * The overlay form has the opposite problem and it is a layout one, which is
 * why the fix is a PLACE and not just a prop: an absolute fill inside the
 * padded container does not reliably reach the top of the screen, which is
 * what `screenFrame` exists for ("out here there is no padding to argue
 * about"). Mounted there, the panel is full-height AND leaves the only Modal
 * in play to the form.
 *
 * So the rule this pins is the pair, because either half alone is a bug:
 *
 *   the task search is an OVERLAY, mounted on the UNPADDED FRAME.
 *
 * A source scan because all of it is mounting and layout, and this repo has no
 * device in CI (see plannerFullScreen.scan.test.js for the same reasoning).
 */
// Newlines normalised: the working copy is CRLF on Windows and LF in the
// repo, and every anchor below is indentation after a line break.
const SCREEN = fs.readFileSync('screens/TasksScreen/index.jsx', 'utf8').replace(/\r\n/g, '\n');

/** The three callers, by the state each one is opened with. */
const callerAt = (visibleProp) => {
  const needle = `<PlannerSearchPanel\n        visible={${visibleProp}}`;
  const at = SCREEN.indexOf(needle);
  if (at < 0) throw new Error(`no PlannerSearchPanel opened by ${visibleProp} — this scan is reading the wrong file`);
  return at;
};
/** That caller's props, up to the tag's close. */
const caller = (visibleProp) => {
  const from = callerAt(visibleProp);
  const to = SCREEN.indexOf('\n      />', from);
  expect(to).toBeGreaterThan(from);
  return SCREEN.slice(from, to);
};

const CONTAINER = '<View style={[styles.container, { paddingTop: insets.top }]}>';

describe('the task search is an overlay, on the unpadded frame', () => {
  test('the scan found all three callers (a silent zero would pass forever)', () => {
    expect(callerAt('searchOpen')).toBeGreaterThan(-1);
    expect(callerAt('boardPickerOpen')).toBeGreaterThan(-1);
    expect(callerAt('focusPickOpen')).toBeGreaterThan(-1);
  });

  // The half that was the bug: `fullScreen` is EdgeSwipePage's Modal form.
  test('it does not take the Modal form', () => {
    expect(caller('searchOpen')).not.toMatch(/\bfullScreen\b/);
  });

  // The half that makes the overlay acceptable. Inside the padded screen it is
  // an absolute fill against a padding box; outside it there is nothing to
  // argue with.
  test('it is mounted AFTER the padded container closes, not inside it', () => {
    const containerAt = SCREEN.indexOf(CONTAINER);
    expect(containerAt).toBeGreaterThan(-1);
    const hostAt = SCREEN.indexOf('<ScreenPortalHost />');
    expect(hostAt).toBeGreaterThan(containerAt);
    // The container's own closing tag: the last one at its indent before the
    // over-everything host.
    const closeAt = SCREEN.lastIndexOf('\n    </View>\n', hostAt);
    expect(closeAt).toBeGreaterThan(containerAt);
    expect(callerAt('searchOpen')).toBeGreaterThan(closeAt);
    // …and still before the host, which must stay the last thing in the tree.
    expect(callerAt('searchOpen')).toBeLessThan(hostAt);
  });

  // The two pickers only set state. Nothing is presented over them, so they
  // keep the Modal form — and keeping them here says the rule is about what a
  // hit DOES, not a blanket ban.
  test('the two pickers, which open nothing, keep it', () => {
    expect(caller('boardPickerOpen')).toMatch(/\bfullScreen\b/);
    expect(caller('focusPickOpen')).toMatch(/\bfullScreen\b/);
  });
});

describe('what a hit does', () => {
  test('it opens the edit form, not the read-only detail sheet', () => {
    const search = caller('searchOpen');
    expect(search).toMatch(/openEditForm\(/);
    expect(search).not.toMatch(/openDetail\(/);
  });

  // The row is a snapshot of an index rebuilt on its own beat; the form has to
  // open on the row the pond holds now.
  test('and it edits the live row, not the search result', () => {
    expect(caller('searchOpen')).toMatch(/tasks \|\| \[\]\)\.find\(\(t\) => t && t\.id === task\.id\)/);
  });

  // The errand no longer changes with the page underneath it.
  test('it searches tasks on every tab', () => {
    expect(caller('searchOpen')).toMatch(/mode="list"/);
    expect(caller('searchOpen')).not.toMatch(/mode=\{viewMode\}/);
  });
});
