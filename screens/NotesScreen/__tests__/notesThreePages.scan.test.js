import fs from 'fs';

/**
 * NOTES IS THREE PAGES YOU SWIPE BETWEEN.
 *
 * Mark, 2026-11-18: "similar to planner page have three tabs that can be
 * translate moved from one tab to the next that is split between to-do,
 * notes, feedback."
 *
 * This reverses a decision this file used to pin the other way. The kinds had
 * been four swipeable tabs, then one list with the kind as a chip inside the
 * filter sheet — on the grounds that kind and topic are two filters over one
 * list. Mark's call is that these three are PLACES, not filters: moving
 * between them should cost a thumb, not two taps and a sheet. "All" is gone
 * with the argument, because "all of them at once" really is a filter and
 * cannot be a place.
 *
 * ─── Why a source scan and not a render test ───────────────────────────────
 *
 * Because the thing that moves here is STRUCTURE, and a render test cannot
 * see it: a three-page pager and a one-page list put the same rows in the
 * tree, so every assertion about what is on screen passes either way.
 *
 * The arithmetic the pager and its pill share is pure and tested properly
 * next door (notePages.test) — what is pinned here is the wiring, and
 * especially the two places that would silently disagree with it.
 */
const SRC = fs.readFileSync('screens/NotesScreen/index.jsx', 'utf8');
const PANEL = fs.readFileSync('screens/NotesScreen/NotesFilterPanel.jsx', 'utf8');

describe('the three pages', () => {
  test('are a paging scroller, swiped between', () => {
    // `horizontal` + `pagingEnabled` on a ScrollView IS the pager.
    expect(SRC).toMatch(/pagingEnabled/);
    expect(SRC).toMatch(/testID="notes-pager"/);
    // One page per kind, from the one array that decides the order.
    expect(SRC).toMatch(/\{NOTE_PAGES\.map\(\(kind\) => \(/);
    expect(SRC).toMatch(/renderPageBody\(kind\)/);
  });

  test('…and the order is the module’s, never written out again here', () => {
    // Three consumers derive from NOTE_PAGES — the pages, the pill and the
    // tap targets. A literal list in the screen is how they start to differ.
    expect(SRC).toMatch(/from '\.\/notePages'/);
    expect(SRC).not.toMatch(/\['todo', 'note', 'feedback'\]/);
  });

  test('THE UNDERLINE TRACKS THE SWIPE, rather than snapping after it', () => {
    // The whole of "translate moved from one tab to the next": the bar's
    // offset is the pager's own, on the native thread.
    expect(SRC).toMatch(/onScroll=\{Animated\.event\(/);
    expect(SRC).toMatch(/contentOffset: \{ x: pagerScrollX \}/);
    expect(SRC).toMatch(/useNativeDriver: true/);
    expect(SRC).toMatch(/transform: \[\{ translateX: tabUnderlineX \}, \{ scaleX: tabUnderlineScale \}\]/);
    // Clamped, so an iOS rubber-band past either end leaves it on its track.
    expect(SRC).toMatch(/extrapolate: 'clamp'/);
  });

  test('BOTH ENDS OF THE BAR ARE TRANSFORMS, which is what keeps it native', () => {
    // Mark, 2026-11-18: the planner's underline, translation and active
    // animation. The native animated module handles transforms and opacity
    // only — animating `width` would silently drop the whole control onto
    // the JS thread and it would stutter against the swipe it is tracking.
    expect(SRC).toMatch(/const tabUnderlineX = pagerScrollX\.interpolate\(/);
    expect(SRC).toMatch(/const tabUnderlineScale = pagerScrollX\.interpolate\(/);
    expect(SRC).toMatch(/width: 1,/);
    expect(SRC).toMatch(/transformOrigin: 'left'/);
    const bar = SRC.slice(SRC.indexOf('tabUnderline: {'), SRC.indexOf('tabSeg: {'));
    expect(bar).not.toMatch(/borderRadius/);
  });

  test('the bar is sized to the tab it is under, which is MEASURED', () => {
    // A tab's width is not computable: font metrics, the icon and the user's
    // font scale all land in it. Each tab reports its own, and the ranges are
    // derived from the segment list — a hand-listed one is what parks the bar
    // under the wrong label the day a tab is added.
    expect(SRC).toMatch(/onLayout=\{\(e\) => measureTab\(seg\.kind, e\.nativeEvent\.layout\.x, e\.nativeEvent\.layout\.width\)\}/);
    expect(SRC).toMatch(/const tabBoxes = NOTE_SEGMENTS\.map\(/);
    expect(SRC).toMatch(/const pageStops = NOTE_SEGMENTS\.map\(/);
    // …and a no-op guard, or onLayout re-measuring loops.
    expect(SRC).toMatch(/if \(cur && cur\.x === nx && cur\.width === nw\) return prev;/);
  });

  test('the ACTIVE label cross-fades, and does not move the tab', () => {
    // Two stacked rows: an opacity rides the native driver and a colour does
    // not. The active row is absolute so the pair never affect each other's
    // layout — and so the tab's width does not jump by a point as the weight
    // changes under it.
    expect(SRC).toMatch(/const activeOp = pagerScrollX\.interpolate\(\{ inputRange, outputRange: \[0, 1, 0\]/);
    expect(SRC).toMatch(/const inactiveOp = pagerScrollX\.interpolate\(\{ inputRange, outputRange: \[0\.6, 0, 0\.6\]/);
    expect(SRC).toMatch(/tabSegRowActive: \{ position: 'absolute' \}/);
    // The same ink in both: a dimmer colour under a 60% opacity compounds
    // into a smudge.
    expect(SRC).toMatch(/tabSegTextActive: \{ fontWeight: '700', color: theme\.colors\.textPrimary \}/);
    expect(SRC).toMatch(/tabSegTextInactive: \{ fontWeight: '500', color: theme\.colors\.textPrimary \}/);
  });

  test('a tap glides, and a settle adopts — without the two fighting', () => {
    expect(SRC).toMatch(/const goToPage = useCallback\(\(kind\) => \{/);
    expect(SRC).toMatch(/pagerRef\.current\?\.scrollTo\(\{ x: pageIndex\(kind\) \* pagerWidth, y: 0, animated: true \}\)/);
    // The settle must NOT scroll: it would fight the programmatic glide.
    const settle = SRC.slice(SRC.indexOf('const onPagerSettle'), SRC.indexOf('const pagerSeeded'));
    expect(settle).toMatch(/pageAtOffset\(e\.nativeEvent\.contentOffset\.x, pagerWidth\)/);
    expect(settle).not.toMatch(/scrollTo/);
  });

  test('THE PAGE BOX IS MEASURED — a list needs a bounded height to scroll', () => {
    // Each page holds a FlatList, and a list inside a ScrollView with no
    // height has nothing to scroll within. The width is seeded from the
    // window so the first paint is not three pages at the wrong size.
    expect(SRC).toMatch(/useState\(\{ width: windowWidth, height: 0 \}\)/);
    expect(SRC).toMatch(/style=\{\{ width: pagerBox\.width, height: pagerBox\.height \|\| undefined \}\}/);
  });

  test('the opening page is SEEDED once, imperatively', () => {
    // Not with a `contentOffset` prop: rebuilding that object each render
    // makes RN re-apply it, which on Android yanks the scroll back mid-swipe
    // on any unrelated re-render. The planner carries the same note.
    expect(SRC).toMatch(/const pagerSeeded = useRef\(false\)/);
    expect(SRC).not.toMatch(/contentOffset=\{/);
    expect(SRC).toMatch(/requestAnimationFrame\(\(\) => \{[\s\S]{0,200}?animated: false/);
  });
});

describe('one source of truth for which page you are on', () => {
  test('THE SHEET NO LONGER OWNS THE KIND', () => {
    // A page you are standing on cannot also be a chip in a sheet: the two
    // would disagree, and the pager would be showing a page the sheet had
    // just switched away from.
    expect(PANEL).not.toMatch(/title="Kind"/);
    expect(PANEL).toMatch(/title="Topic"/);
    expect(SRC).not.toMatch(/onFilterChange=\{setFilter\}/);
  });

  test('…and clearing the filters does not move you to another page', () => {
    const clear = SRC.slice(SRC.indexOf('onClearAll={() => {'), SRC.indexOf('onClearAll={() => {') + 400);
    expect(clear).not.toMatch(/setFilter\(/);
    expect(clear).toMatch(/setTodoStatus\(TODO_STATUS_DEFAULT\)/);
    expect(clear).toMatch(/setSelectedTopic\(null\)/);
  });

  test('the kind is not counted as an active filter', () => {
    // It is true on every page, so counting it would make the header claim a
    // filter everywhere and the "clear" key never go quiet.
    expect(SRC).toMatch(/const kindScoped = false;/);
  });

  test('the screen opens ON A PAGE, not on "all"', () => {
    expect(SRC).toMatch(/useState\(DEFAULT_NOTE_PAGE\)/);
  });
});

/**
 * WHAT DID NOT CHANGE — the parts of the one-list work that were right, and
 * that a pager coming back would be the obvious moment to lose.
 */
describe('still true', () => {
  test('the chrome is rendered ONCE, above the pager', () => {
    // It used to ride as each page's ListHeaderComponent, so all three copies
    // swiped sideways and scrolled away with the notes.
    expect(SRC).toMatch(/\{renderChrome\(\)\}/);
    expect(SRC.match(/\{renderChrome\(\)\}/g)).toHaveLength(1);
  });

  test('nothing is filtered silently', () => {
    expect(SRC).toMatch(/const scopeLabel =/);
    expect(SRC).toMatch(/testID="notes-filter-key"/);
    expect(SRC).toMatch(/testID="notes-search-key"/);
    expect(SRC).toMatch(/<ActiveFilterChip/);
    expect(SRC).toMatch(/testID="notes-clear-topic"/);
  });

  test.each([
    ['kindRail', 'the four kinds, drawn all the time'],
    ['topicRail', 'every topic, drawn all the time'],
    ['measureTabLabel', 'the label measuring the OLD underline needed'],
  ])('%s is still gone (%s)', (ident) => {
    expect(SRC).not.toMatch(new RegExp(`\\b${ident}\\b`));
  });

  test('a fresh capture still takes its kind from the filter', () => {
    // Keyed off `filter` and never off a page index — which is the only
    // reason capture survived the tabs going away, and now their return.
    expect(SRC).toMatch(/TAB_COMPOSER_MODE\[filter\]/);
  });
});
