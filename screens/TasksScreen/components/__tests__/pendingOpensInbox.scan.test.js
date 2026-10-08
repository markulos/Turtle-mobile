import fs from 'fs';

/**
 * THE DAY SHEET'S "PENDING TASKS" LINE IS A DOOR, NOT A DRAWER.
 *
 * It used to unfold the entire backlog — every overdue and undated task in the
 * library, as full ScheduleCards with avatars, focus state and a schedule key
 * each — inside a sheet already carrying a 24-hour grid. On a phone with a real
 * backlog that one tap was the slowest thing in the app. It hands over to the
 * Inbox page instead, where the backlog has room to be the whole page.
 *
 * ─── Why a source scan ─────────────────────────────────────────────────────
 *
 * CalendarView is four and a half thousand lines behind a sheet that only
 * exists after a pan gesture, with no render harness in this repo (its
 * siblings here test its exported date predicates, not its tree). What
 * regresses is STRUCTURE: a list mounted under the line again, or a handler
 * that no longer reaches it. Both are visible in the source, and a scan that
 * reads them costs nothing per run.
 */
const read = (p) => fs.readFileSync(p, 'utf8');

/**
 * Comments BLANKED, not deleted — this scan asserts that no card list is
 * mounted in a region, and the prose explaining why would otherwise answer
 * for the code. Blanked so every offset still matches the real file (the trap
 * inputField.scan.test.js documents: deleting takes the newlines too).
 */
const blankComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));

const CAL = blankComments(read('screens/TasksScreen/components/CalendarView.jsx'));
const SCREEN = blankComments(read('screens/TasksScreen/index.jsx'));

/** The Pending section of the day pane, by its two landmarks. */
const pendingSection = (() => {
  const from = CAL.indexOf('{stripTasks.length > 0 && (');
  if (from < 0) throw new Error('the Pending section is gone — this scan is reading the wrong file');
  const to = CAL.indexOf('</ScrollView>', from);
  if (to < 0) throw new Error('no </ScrollView> after the Pending section');
  return CAL.slice(from, to);
})();

describe('the line hands over instead of unfolding', () => {
  test('it opens the inbox, and says so to a screen reader', () => {
    expect(pendingSection).toMatch(/onOpenInbox\?\.\(\)/);
    expect(pendingSection).toMatch(/Opens the inbox/);
    // The chevron points the way OUT, not down into a drawer.
    expect(pendingSection).toMatch(/name="chevron-right"/);
    expect(pendingSection).not.toMatch(/chevron-down|chevron-up/);
  });

  test('it still says how many are waiting — the reason to go', () => {
    expect(pendingSection).toMatch(/\{stripTasks\.length\}/);
  });

  test('it mounts NO card list of its own', () => {
    // The whole point: not one ScheduleCard, not a lazy section, not a list.
    expect(pendingSection).not.toMatch(/ScheduleCard/);
    expect(pendingSection).not.toMatch(/TaskSectionFrontier/);
    expect(pendingSection).not.toMatch(/FlatList/);
  });

  test('nothing is left of the fold it used to be', () => {
    // State, toggle and the LayoutAnimation that ran on every open.
    expect(CAL).not.toMatch(/untimedCollapsed/);
    expect(CAL).not.toMatch(/toggleUntimedCollapsed/);
  });
});

describe('the way out actually leads somewhere', () => {
  test('the sheet is docked on the way, or the Inbox cannot swipe back', () => {
    // The parent locks the pager while the sheet is raised
    // (onPlannerOpenChange), so leaving it up would strand the next page.
    const handler = CAL.slice(
      CAL.indexOf('const openInboxFromDay = useCallback('),
      CAL.indexOf('}, [snapSheet, onOpenInbox]);'),
    );
    expect(handler).toMatch(/snapSheet\(false\)/);
    expect(handler).toMatch(/onOpenInbox\?\.\(\)/);
    // And it is the DOCKING handler the day pane is given, not the raw prop.
    expect(CAL).toMatch(/onOpenInbox=\{openInboxFromDay\}/);
  });

  test('the screen points it at the Inbox page', () => {
    // 'boards' is that page's internal mode string; "Inbox" is only its label
    // (utils/viewPages is emphatic about the two not being the same thing).
    expect(SCREEN).toMatch(/onOpenInbox=\{\(\) => goToView\('boards'\)\}/);
  });
});
