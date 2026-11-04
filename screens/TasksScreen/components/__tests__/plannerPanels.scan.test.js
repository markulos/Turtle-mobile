import fs from 'fs';

/**
 * THE LATEST PANEL GOES OVER EVERYTHING.
 *
 * Paint order is tree order, so a full-screen panel belongs in the Planner's
 * PANEL LAYER — after the portal host, outside the padded screen, outside
 * every clip and transform. Three panels got this wrong in three different
 * ways, and each arrived as its own bug report:
 *
 *   · THE SEARCH, inside the padded container: an absolute fill is laid out
 *     against a padding box, so it began under the header. Making it the
 *     Modal form fixed the height and broke the hand-off — a hit opens the
 *     edit FORM, which is a Modal, and iOS will not present a sibling Modal
 *     while the first is still dismissing. It slid away and nothing came
 *     back, silently. Shipped once, in 08ef8e0.
 *   · THE FILTER, inside `dropdownHost` — flex:1, overflow:hidden, and the
 *     board picker's shift transform. Clipped to the page under the chrome
 *     AND riding a slide belonging to something else: it opened pinned under
 *     the tab strip.
 *   · THE PROFILE, before the portal host. The raised day sheet is portalled
 *     there, so a face tapped on a task's avatar stack opened the card
 *     UNDERNEATH the To-Do sheet.
 *
 * So the rule is a PLACE, not a prop, and what this scan pins is the place —
 * plus the one prop that cannot change with it: none of the three may take
 * EdgeSwipePage's Modal form, because each is opened from, or opens, another
 * Modal.
 *
 * A source scan because all of it is mounting and layout, and this repo has
 * no device in CI (see plannerFullScreen.scan.test.js for the same
 * reasoning).
 */
// Newlines normalised: the working copy is CRLF on Windows and LF in the
// repo, and every anchor below is indentation after a line break.
const SCREEN = fs.readFileSync('screens/TasksScreen/index.jsx', 'utf8').replace(/\r\n/g, '\n');

const CONTAINER = '<View style={[styles.container, { paddingTop: insets.top }]}>';
const HOST = '<ScreenPortalHost />';

/** The three search callers, by the state each one is opened with. */
const searchAt = (visibleProp) => {
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

const caller = (visibleProp) => propsFrom(searchAt(visibleProp));

/**
 * Everything in the panel layer, by the tag that opens it. Each must come
 * after the host; the host is what the layer is defined as being after.
 */
const LAYER = {
  'the task search': () => searchAt('searchOpen'),
  'the filter panel': () => SCREEN.indexOf('<PlannerFilterPanel\n        visible={filterOpen}'),
  'the profile card': () => SCREEN.indexOf('<FriendCard\n        friend={profileFriend}'),
};

describe('the panel layer is after the portal host', () => {
  test('the scan found every panel it is meant to police', () => {
    for (const [name, at] of Object.entries(LAYER)) {
      expect([name, at()]).not.toEqual([name, -1]);
    }
    expect(SCREEN.indexOf(HOST)).toBeGreaterThan(-1);
  });

  test.each(Object.keys(LAYER))('%s is mounted after the host', (name) => {
    expect(LAYER[name]()).toBeGreaterThan(SCREEN.indexOf(HOST));
  });

  // Which is also, necessarily, outside the padded screen and outside the
  // clipped dropdown host inside it.
  test('…which puts all three outside the padded screen', () => {
    const containerAt = SCREEN.indexOf(CONTAINER);
    expect(containerAt).toBeGreaterThan(-1);
    const closeAt = SCREEN.lastIndexOf('\n    </View>\n', SCREEN.indexOf(HOST));
    expect(closeAt).toBeGreaterThan(containerAt);
    for (const at of Object.values(LAYER)) expect(at()).toBeGreaterThan(closeAt);
  });

  test('and outside the clipped, sliding dropdown host within it', () => {
    const hostOpensAt = SCREEN.indexOf('<View style={styles.dropdownHost}>');
    expect(hostOpensAt).toBeGreaterThan(-1);
    expect(hostOpensAt).toBeLessThan(SCREEN.indexOf(HOST));
  });

  // The profile is the one that can open while another panel is up — a face
  // tapped on a task's avatar stack — so it is last of the three.
  test('the profile card is last, since it opens over the others', () => {
    expect(LAYER['the profile card']()).toBeGreaterThan(LAYER['the task search']());
    expect(LAYER['the profile card']()).toBeGreaterThan(LAYER['the filter panel']());
  });
});

describe('none of them may become a Modal', () => {
  test('the task search, which opens the edit form', () => {
    expect(caller('searchOpen')).not.toMatch(/\bfullScreen\b/);
  });

  test('the filter panel, which has a nested search page', () => {
    expect(propsFrom(LAYER['the filter panel']())).not.toMatch(/\bfullScreen\b/);
  });

  // The two PICKERS only set state — nothing is presented over them — so they
  // keep the Modal form. Keeping them here says the rule is about what a
  // panel DOES, not a blanket ban.
  test('but the two pickers, which open nothing, keep it', () => {
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
