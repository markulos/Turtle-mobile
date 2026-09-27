import fs from 'fs';

/**
 * NOTES IS ONE LIST WITH TWO FILTERS, not four pages.
 *
 * The kinds — All, Notes, Todos, Feedback — used to be swipeable tabs, which
 * made the kind of a note a PLACE you had to be rather than a filter you could
 * apply, and put three of them at the same level as the screen itself so
 * "Notes" appeared to be one quarter of Notes. They are chips over a single
 * list now, the same chip the topic rail uses, because kind and topic are two
 * filters over one list and a list with two filters that look like different
 * kinds of control reads as two lists.
 *
 * ─── Why a source scan and not a render test ───────────────────────────────
 *
 * Because the thing that regressed here twice is STRUCTURE, and a render test
 * cannot see it: a four-page pager and a one-page list put the same rows in the
 * tree, so every assertion about what is on screen passes either way. What is
 * being pinned is that the pager did not come back — along with the state it
 * dragged behind it, which is where the real cost was.
 */
const SRC = fs.readFileSync('screens/NotesScreen/index.jsx', 'utf8');

describe('Notes is one list', () => {
  test('the screen is not a horizontal pager', () => {
    // `horizontal` + `pagingEnabled` on a ScrollView IS the pager.
    expect(SRC).not.toMatch(/pagingEnabled/);
  });

  // Each of these was load-bearing ONLY for the pager: the ref it scrolled, the
  // scroll offset that drove the underline, the page-index maths, and the label
  // measuring the underline's width needed. If one reappears, so has the pager.
  test.each([
    ['pagerRef', 'the ref the pager was scrolled by'],
    ['pageScrollX', 'the offset that drove the underline'],
    ['onPagerEnd', 'the settle that turned a page index back into a filter'],
    ['goToPage', 'the tab tap that scrolled to a page'],
    ['measureTabLabel', 'the label measuring the underline needed'],
  ])('%s is gone (%s)', (ident) => {
    expect(SRC).not.toMatch(new RegExp(`\\b${ident}\\b`));
  });

  test('the kinds and the topics are one control, in one place', () => {
    // Two filters over one list should be one control repeated. They are both
    // sections of NotesFilterPanel now — if the kinds ever get their own
    // control on the header again, they stop reading as a filter.
    expect(SRC).toMatch(/<NotesFilterPanel/);
    const panel = fs.readFileSync('screens/NotesScreen/NotesFilterPanel.jsx', 'utf8');
    expect(panel).toMatch(/title="Kind"/);
    expect(panel).toMatch(/title="Topic"/);
    // One Chip, used by both sections — not a KindChip beside a TopicChip.
    expect(panel.match(/^function \w*Chip\b/gm) || []).toHaveLength(1);
  });

  /**
   * THE HEADER STATES THE FILTERS IT IS HOLDING.
   *
   * The two rails said what was active by BEING on screen with one chip lit in
   * each. Folding them behind a key buys back a third of the screen and costs
   * exactly one thing if nobody watches it: a list can now be narrowed with
   * nothing on screen saying so. Two things say so, and both are pinned here —
   * the title's scope half and the chip row of active filters.
   */
  describe('nothing is filtered silently', () => {
    test('the title carries the active scope', () => {
      expect(SRC).toMatch(/const scopeLabel =/);
      expect(SRC).toMatch(/styles\.titleScope/);
    });

    test('the header has a filter key and a search key', () => {
      expect(SRC).toMatch(/testID="notes-filter-key"/);
      expect(SRC).toMatch(/testID="notes-search-key"/);
    });

    test('the active filters are on screen, and clearable', () => {
      expect(SRC).toMatch(/<ActiveFilterChip/);
      expect(SRC).toMatch(/testID="notes-clear-kind"/);
      expect(SRC).toMatch(/testID="notes-clear-topic"/);
    });

    // The rails, by the styles that were only ever theirs. A rail coming back
    // is not a bug a render test can see — it is just more chips on screen.
    test.each([
      ['kindRail', 'the four kinds, drawn all the time'],
      ['topicRail', 'every topic, drawn all the time'],
      ['topicSearchChip', "the rail head's magnify"],
    ])('%s is gone (%s)', (ident) => {
      expect(SRC).not.toMatch(new RegExp(`\\b${ident}\\b`));
    });
  });

  // The composer's default kind was keyed off `filter` and never off a page
  // index, which is the only reason capture behaviour survived the tabs going
  // away untouched. Worth pinning: keying it off a page would have been the
  // obvious implementation, and would silently break here.
  test('a fresh capture still takes its kind from the filter', () => {
    expect(SRC).toMatch(/TAB_COMPOSER_MODE\[filter\]/);
  });

  test('the list still renders for the active filter', () => {
    expect(SRC).toMatch(/renderPageBody\(filter\)/);
  });
});
