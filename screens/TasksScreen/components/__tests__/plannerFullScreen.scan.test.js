import fs from 'fs';

/**
 * THE RAISED DAY PLANNER IS THE WHOLE SCREEN — notch and dock respected.
 *
 * Pulled all the way up, the sheet used to stop about a hundred points short
 * of the top: it lives inside the view pager, and the Planner's own header
 * chrome was in the layout above it. A sheet cannot paint over a header it is
 * nested under, so the header is what moves — it leaves the layout while the
 * planner is raised and the pager grows into the space, carrying the sheet to
 * the top of the screen.
 *
 * Three things hold this together, in two files, and each one on its own is
 * enough to break it:
 *
 *  1. The header (and its rule, and the filter chips) are gated on the raised
 *     flag, or the sheet has nowhere to grow into.
 *  2. The flag flips at the START of a raise and the END of a dock. Told at
 *     the settle instead, the page would grow under a sheet already parked at
 *     the top and jerk it upward by the header's height in one frame.
 *  3. The top stays under the hood (the root's safe-area padding) and the foot
 *     clears the floating dock (panelBottomInset, never a hand-tuned number —
 *     tabBarLayout.js documents this very sheet getting that wrong once).
 *
 * A source scan because none of it is visible in a render tree: it is layout,
 * and this repo has no device in CI (see noteCardFooter.scan.test.js).
 */
const read = (p) => fs.readFileSync(p, 'utf8');

/** Comments BLANKED, not deleted — the prose here describes the very rules
 *  being asserted, and offsets must still match the real file. */
const blankComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));

const SCREEN = blankComments(read('screens/TasksScreen/index.jsx'));
const CAL = blankComments(read('screens/TasksScreen/components/CalendarView.jsx'));

const region = (src, fromNeedle, toNeedle) => {
  const from = src.indexOf(fromNeedle);
  if (from < 0) throw new Error(`"${fromNeedle}" is gone — this scan is reading the wrong file`);
  const to = src.indexOf(toNeedle, from);
  if (to < 0) throw new Error(`"${toNeedle}" no longer follows "${fromNeedle}"`);
  return src.slice(from, to);
};

describe('the header gets out of the way', () => {
  test('the chrome, its rule and the filter chips are all gated on the raise', () => {
    // One gate over a MEASURED wrapper that holds the header block and its
    // groove — the measurement is what the page is handed back (see below).
    const gate = SCREEN.indexOf('{!dayPlannerOpen && (');
    expect(gate).toBeGreaterThan(-1);
    const wrapper = SCREEN.slice(gate, SCREEN.indexOf('{/* Project-picker overlay host', gate));
    expect(wrapper).toMatch(/setPlannerChromeH/);
    expect(wrapper).toMatch(/<View style=\{styles\.headerChrome\}>/);
    expect(wrapper).toMatch(/<View style=\{styles\.headerRule\} \/>/);
    // Chips too: a band between the notch and a "full screen" sheet is not
    // full screen.
    expect(SCREEN).toMatch(/\{!dayPlannerOpen && \(hasActiveFilters \|\| selectedProject !== 'All'\) && \(/);
  });

  test('nothing is stranded: the pager is locked while it is up anyway', () => {
    expect(SCREEN).toMatch(/scrollEnabled=\{!dayPlannerOpen && !boardsDrilled\}/);
  });

  test('the top of the screen is still under the hood, not through it', () => {
    // The sheet's "top" is the page's top, which is the root's padding edge.
    expect(SCREEN).toMatch(/styles\.container, \{ paddingTop: insets\.top \}/);
  });
});

describe('when the parent is told', () => {
  test('a raise is announced BEFORE the spring, a dock at its settle', () => {
    const snap = region(CAL, 'const snapSheet = useCallback((raise) => {', '}, [sheet, notifyPlanner]);');
    const early = snap.indexOf('if (raise) notifyPlanner(true);');
    const spring = snap.indexOf('withSpring');
    expect(early).toBeGreaterThan(-1);
    // Order is the whole trick: the page has to grow while the sheet is still
    // at the bottom, where its position is measured from the page's bottom
    // edge and therefore does not move.
    expect(early).toBeLessThan(spring);
    // And the settle still reports, which is what brings the header back.
    expect(snap).toMatch(/if \(finished\) runOnJS\(notifyPlanner\)\(raise\)/);
  });

  test('a finger on the handle counts as the start of a raise', () => {
    const pan = region(CAL, 'const headerPan = useMemo(() => Gesture.Pan()', '.onUpdate(');
    // Only from docked — a pull DOWN from raised must not announce a raise.
    expect(pan).toMatch(/if \(sheet\.value <= 0\) runOnJS\(notifyPlanner\)\(true\)/);
  });
});

describe('the foot clears the floating dock', () => {
  test('from the dock helper, not a hand-tuned number', () => {
    expect(CAL).toMatch(/const sheetBottomInset = panelBottomInset\(insets\.bottom, tabBarH > 0\)/);
    expect(CAL).toMatch(/bottomInset=\{sheetBottomInset\}/);
  });

  test('and that is what the sheet\'s scroller actually pads with', () => {
    expect(CAL).toMatch(/paddingBottom: Math\.max\(bottomInset, keyboardHeight \+ 20\)/);
    // The number it replaced. 100 points is not where the dock is.
    expect(CAL).not.toMatch(/Math\.max\(100, keyboardHeight/);
  });
});

/**
 * The calendar page behind the glass must not MOVE when the sheet comes up.
 *
 * The first pass let the page measure its new height from the pager, which
 * lands a frame after the render that dropped the chrome: for that frame the
 * page was still docked-height while the calendar inside it had already been
 * pushed down, so the month grid re-scaled (its cells grow to fill whatever
 * area they are given) and then re-scaled back. That is the offset the owner
 * reported, and these three lines are what cancel it.
 */
describe('nothing behind the sheet moves', () => {
  test('the page is TOLD its new height, in the same commit as the margin', () => {
    expect(SCREEN).toMatch(/height: pagerSize\.height \+ plannerReserve/);
    expect(SCREEN).toMatch(/topReserve=\{plannerReserve\}/);
  });

  test('the calendar is pushed down by exactly what the page gained', () => {
    expect(CAL).toMatch(/topReserve > 0 && \{ marginTop: topReserve \}/);
    // A MARGIN, not padding: the sheet is absolutely positioned and must not
    // be moved by it.
    expect(CAL).not.toMatch(/paddingTop: topReserve/);
  });

  test('the pager stops measuring itself while the planner is up', () => {
    const onLayout = region(SCREEN, 'const { width, height } = e.nativeEvent.layout;', 'style={styles.viewPager}');
    // Adopting the taller measurement would add the reserve a second time.
    expect(onLayout).toMatch(/if \(dayPlannerOpen\) \{/);
    expect(onLayout).toMatch(/\{ \.\.\.p, width \}/);
  });

  test('the reserve is measured, never guessed', () => {
    expect(SCREEN).toMatch(/const plannerReserve = dayPlannerOpen/);
    expect(SCREEN).toMatch(/setFilterChipsH/);
    // No hand-tuned header height anywhere in the sum.
    expect(SCREEN).not.toMatch(/plannerReserve = dayPlannerOpen \? \d/);
  });
});
