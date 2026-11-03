import fs from 'fs';

/**
 * THE PLANNER'S FULL-SCREEN SURFACES LIVE ON THE FRAME.
 *
 * Two of them, two bugs, one rule.
 *
 * ─── The search: it opens a Modal, so it cannot be one ─────────────────────
 *
 * A hit in the search opens the task's edit FORM, and TaskForm is mounted in
 * its Modal form (it takes an `overlay` prop and this screen does not pass
 * it). iOS will not present a second sibling Modal while the first is still
 * dismissing — EdgeSwipePage says so at the top of the file, TaskForm says it
 * again at its own — so a search panel in the Modal form slides away and the
 * form never arrives. SILENTLY: no warning, no crash, just a press that did
 * nothing. It shipped exactly once, in 08ef8e0.
 *
 * ─── The filter: it was clipped to the page under the chrome ───────────────
 *
 * It sat inside `dropdownHost` — `flex: 1` with `overflow: hidden`, i.e. the
 * area BELOW the header — and inside the shift layer, which carries an
 * animated translateY for the board picker's reveal. So the one absolute fill
 * meant to be the whole screen was clipped to the page and rode a slide that
 * has nothing to do with it. It opened pinned under the tab strip.
 *
 * ─── Which is why the fix is a PLACE, not a prop ───────────────────────────
 *
 * An absolute fill inside the padded container is laid out against a padding
 * box, inside whatever clips and transforms its ancestors carry. `screenFrame`
 * exists precisely so there is nothing to argue with: "out here there is no
 * padding", no clip, no transform. Mounted there, a panel is full-height on
 * its own AND leaves the only Modal in play to the form.
 *
 * A source scan because all of it is mounting and layout, and this repo has no
 * device in CI (see plannerFullScreen.scan.test.js for the same reasoning).
 */
// Newlines normalised: the working copy is CRLF on Windows and LF in the
// repo, and every anchor below is indentation after a line break.
const SCREEN = fs.readFileSync('screens/TasksScreen/index.jsx', 'utf8').replace(/\r\n/g, '\n');

/** The three search callers, by the state each one is opened with. */
const callerAt = (visibleProp) => {
  const needle = `<PlannerSearchPanel\n        visible={${visibleProp}}`;
  const at = SCREEN.indexOf(needle);
  if (at < 0) throw new Error(`no PlannerSearchPanel opened by ${visibleProp} — this scan is reading the wrong file`);
  return at;
};

/** A mounted element's props, from its tag to the tag's self-close. */
const propsFrom = (at) => {
  const to = SCREEN.indexOf('\n      />', at);
  expect(to).toBeGreaterThan(at);
  return SCREEN.slice(at, to);
};

const caller = (visibleProp) => propsFrom(callerAt(visibleProp));

const CONTAINER = '<View style={[styles.container, { paddingTop: insets.top }]}>';
const HOST = '<ScreenPortalHost />';
const FILTER = '<PlannerFilterPanel\n        visible={filterOpen}';

/**
 * Where the padded screen ends. Everything after it is on `screenFrame`, which
 * has no padding, no clip and no transform.
 */
const containerClosesAt = () => {
  const containerAt = SCREEN.indexOf(CONTAINER);
  expect(containerAt).toBeGreaterThan(-1);
  const hostAt = SCREEN.indexOf(HOST);
  expect(hostAt).toBeGreaterThan(containerAt);
  // The container's own closing tag: the last one at its indent before the
  // over-everything host.
  const closeAt = SCREEN.lastIndexOf('\n    </View>\n', hostAt);
  expect(closeAt).toBeGreaterThan(containerAt);
  return closeAt;
};

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

  test('it is mounted AFTER the padded container closes, not inside it', () => {
    expect(callerAt('searchOpen')).toBeGreaterThan(containerClosesAt());
    // …and still before the host, which must stay the last thing in the tree.
    expect(callerAt('searchOpen')).toBeLessThan(SCREEN.indexOf(HOST));
  });

  // The two pickers only set state. Nothing is presented over them, so they
  // keep the Modal form — and keeping them here says the rule is about what a
  // hit DOES, not a blanket ban.
  test('the two pickers, which open nothing, keep it', () => {
    expect(caller('boardPickerOpen')).toMatch(/\bfullScreen\b/);
    expect(caller('focusPickOpen')).toMatch(/\bfullScreen\b/);
  });
});

describe('what a search hit does', () => {
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

  // One scope, named in the title, obeyed by every tab — the search included.
  test('and it is scoped to the board the Planner is on', () => {
    expect(caller('searchOpen')).toMatch(/selectedProject=\{selectedProject\}/);
  });
});

describe('the filter panel is out on the frame too', () => {
  test('the scan found it (a renamed prop would silently pass)', () => {
    expect(SCREEN.indexOf(FILTER)).toBeGreaterThan(-1);
  });

  test('it is mounted after the padded container closes', () => {
    expect(SCREEN.indexOf(FILTER)).toBeGreaterThan(containerClosesAt());
    expect(SCREEN.indexOf(FILTER)).toBeLessThan(SCREEN.indexOf(HOST));
  });

  // The host is the specific thing that clipped it, and it is inside the
  // padded container — so "after the container" is also "out of the host".
  test('…which puts it outside the clipped, sliding dropdown host', () => {
    const hostOpensAt = SCREEN.indexOf('<View style={styles.dropdownHost}>');
    expect(hostOpensAt).toBeGreaterThan(-1);
    expect(hostOpensAt).toBeLessThan(containerClosesAt());
  });

  // It stays the in-tree overlay: its own board and label search is a nested
  // EdgeSwipePage overlay, which only works while this is not a Modal.
  test('it does not take the Modal form', () => {
    expect(propsFrom(SCREEN.indexOf(FILTER))).not.toMatch(/\bfullScreen\b/);
  });
});
