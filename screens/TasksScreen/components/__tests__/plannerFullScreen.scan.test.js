import fs from 'fs';

/**
 * THE RAISED DAY PLANNER COVERS THE SCREEN — by overlaying it, not by
 * rearranging it.
 *
 * The sheet lives two levels inside the Planner's horizontal view pager, which
 * clips its children, so it cannot paint over the screen's own header. Two
 * earlier passes solved that by taking the header OUT OF THE LAYOUT while the
 * planner was up. Both worked and both cost the same thing: the pager
 * re-lays-out, the month grid re-scales to its new area, and it all happens
 * again in reverse on the way down — "the strange offset", then "hiding and
 * unhiding creates lag".
 *
 * So the sheet is PORTALLED into a host over the whole screen
 * (components/ScreenPortal). What this file pins is that the cure has not
 * quietly been replaced by the disease again:
 *
 *  1. The sheet renders through the portal, and the host is the LAST thing in
 *     the screen's root — paint order is tree order.
 *  2. NOTHING is hidden or resized for it: no gate on the header chrome, no
 *     reserve added to the page, no frozen measurement.
 *  3. Its geometry is the window's — the hood cleared at the top
 *     (panelTopInset), the floating dock at the foot (panelBottomInset).
 *
 * A source scan because all of it is layout, and this repo has no device in CI
 * (see noteCardFooter.scan.test.js for the same reasoning).
 */
const read = (p) => fs.readFileSync(p, 'utf8');

/** Comments BLANKED, not deleted — the prose here describes the very rules
 *  being asserted, and offsets must still match the real file. */
const blankComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));

const SCREEN = blankComments(read('screens/TasksScreen/index.jsx'));
const CAL = blankComments(read('screens/TasksScreen/components/CalendarView.jsx'));
const PORTAL = blankComments(read('components/ScreenPortal.jsx'));

const region = (src, fromNeedle, toNeedle) => {
  const from = src.indexOf(fromNeedle);
  if (from < 0) throw new Error(`"${fromNeedle}" is gone — this scan is reading the wrong file`);
  const to = src.indexOf(toNeedle, from);
  if (to < 0) throw new Error(`"${toNeedle}" no longer follows "${fromNeedle}"`);
  return src.slice(from, to);
};

describe('the sheet is portalled over the screen', () => {
  test('the card itself goes through the portal', () => {
    expect(CAL).toMatch(/<ScreenPortal id="planner-day-sheet">/);
    // Portal → the card's sliding page → the card. Nothing else between them:
    // anything that stayed behind would be a piece of the sheet still nailed
    // to the view pager.
    const inside = region(CAL, '<ScreenPortal id="planner-day-sheet">', 'sheetShapeStyle');
    expect(inside).toMatch(/<Animated\.View/);
    expect(inside).toMatch(/<Reanimated\.View style=\{\[sheetStyles\.sheet/);
  });

  test('the host is the LAST child of the screen root, inside the provider', () => {
    const root = region(SCREEN, '<ScreenPortalProvider>', '</ScreenPortalProvider>');
    const host = root.indexOf('<ScreenPortalHost />');
    expect(host).toBeGreaterThan(-1);
    // Nothing of the screen after it: paint order is tree order, and "over
    // everything" is the entire point.
    expect(root.slice(host)).toMatch(/^<ScreenPortalHost \/>\s*<\/View>\s*$/);
  });

  test('it RIDES the pager rather than being switched on and off', () => {
    // Mounting it on the settled view was the first answer: the card blinked
    // in and out a beat after the swipe instead of leaving with its page.
    expect(CAL).not.toMatch(/\{active \? \(/);
    expect(SCREEN).not.toMatch(/active=\{viewMode === 'calendar'\}/);
    // The host interpolates the pager's own offset…
    expect(SCREEN).toMatch(/const plannerSlideX = useMemo\(/);
    expect(SCREEN).toMatch(/slideX=\{plannerSlideX\}/);
    // …and the card's page is translated by it, natively.
    expect(CAL).toMatch(/transform: \[\{ translateX: slideX \}\]/);
  });

  test('the sliding page does not swallow the touches it covers', () => {
    const page = region(CAL, '<ScreenPortal id="planner-day-sheet">', '<Reanimated.View style={[sheetStyles.sheet');
    expect(page).toMatch(/pointerEvents="box-none"/);
    // It is an absolute fill, because the card positions itself against it.
    expect(page).toMatch(/StyleSheet\.absoluteFill/);
  });

  test('ONE thing decides how far the card travels: the window', () => {
    // The page used to write its own height here, and the page is shorter
    // than the window by the safe area plus the header — which parked the
    // docked card that much too high, showing its week strip and first task
    // instead of just its header.
    const writes = CAL.match(/containerH\.value = /g) || [];
    expect(writes).toHaveLength(1);
    expect(CAL).toMatch(/containerH\.value = windowH/);
    expect(CAL).not.toMatch(/containerH\.value = e\.nativeEvent/);
  });

  test('a touch that misses the card still reaches the screen', () => {
    // The host spans everything; without this the calendar behind it would be
    // dead to the touch.
    expect(PORTAL).toMatch(/pointerEvents="box-none"/);
  });

  test('the portal does not re-render the screen to deliver an update', () => {
    // The whole screen re-rendering per sheet update would be a worse version
    // of the lag this replaced — only the host subscribes.
    expect(PORTAL).toMatch(/listeners/);
    expect(PORTAL).toMatch(/useLayoutEffect/);
  });
});

describe('nothing is hidden or resized for it', () => {
  test('the header chrome, its rule and the chips are NOT gated on the planner', () => {
    expect(SCREEN).not.toMatch(/\{!dayPlannerOpen && \(\s*<View/);
    expect(SCREEN).not.toMatch(/\{!dayPlannerOpen && <View style=\{styles\.headerRule\}/);
    expect(SCREEN).not.toMatch(/\{!dayPlannerOpen && \(hasActiveFilters/);
  });

  test('the calendar page is an ordinary page', () => {
    expect(SCREEN).not.toMatch(/plannerReserve/);
    expect(SCREEN).not.toMatch(/topReserve/);
    expect(CAL).not.toMatch(/topReserve/);
  });

  test('the pager measures itself normally again', () => {
    const onLayout = region(SCREEN, 'const { width, height } = e.nativeEvent.layout;', 'style={styles.viewPager}');
    expect(onLayout).not.toMatch(/dayPlannerOpen/);
  });

  test('the flag it reports is only the pager lock now', () => {
    const uses = SCREEN.split('dayPlannerOpen').length - 1;
    // The state, the ref-free setter call site, and the pager's scrollEnabled.
    // Any more than that and something is keying layout off it again.
    expect(uses).toBeLessThanOrEqual(3);
    expect(SCREEN).toMatch(/scrollEnabled=\{!dayPlannerOpen && !boardsDrilled\}/);
  });

  test('the parent is told at the settle, as it was before all this', () => {
    const snap = region(CAL, 'const snapSheet = useCallback((raise) => {', '}, [sheet, notifyPlanner]);');
    expect(snap).toMatch(/if \(finished\) runOnJS\(notifyPlanner\)\(raise\)/);
    // No eager notify: there is no layout to prepare any more.
    expect(snap).not.toMatch(/if \(raise\) notifyPlanner/);
    const pan = region(CAL, 'const headerPan = useMemo(() => Gesture.Pan()', '.onUpdate(');
    expect(pan).not.toMatch(/notifyPlanner/);
  });
});

describe('the card reckons with the window, the hood and the dock', () => {
  test('its top is the hood plus the standard breath', () => {
    expect(CAL).toMatch(/const sheetTopInset = panelTopInset\(insets\.top\)/);
    expect(CAL).toMatch(/\{ top: sheetTopInset \}/);
    // The old constant is gone: it measured from a header the card now covers.
    expect(CAL).not.toMatch(/const SHEET_RAISED_GAP = /);
  });

  test('its travel is measured from the WINDOW, not from the page', () => {
    expect(CAL).toMatch(/const \{ height: windowH \} = useWindowDimensions\(\)/);
    expect(CAL).toMatch(/containerH\.value = windowH/);
    // And the same inset comes off the travel, or the docked peek drifts.
    expect(CAL).toMatch(/containerH\.value - headerH\.value - dockH - sheetTopInsetSV\.value/);
  });

  test('its foot clears the floating dock, from the helper', () => {
    expect(CAL).toMatch(/const sheetBottomInset = panelBottomInset\(insets\.bottom, tabBarH > 0\)/);
    expect(CAL).toMatch(/paddingBottom: Math\.max\(bottomInset, keyboardHeight \+ 20\)/);
  });
});
