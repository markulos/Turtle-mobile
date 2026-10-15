import fs from 'fs';

/**
 * A TAP ON A "NO TIME SET" TO-DO OPENS THE EDITOR.
 *
 * The day pane has two lists of the same card: the timed schedule, and the
 * To-Do rows underneath it for tasks dated to the day with no hour yet. The
 * timed rows have always edited on a plain tap and inspected on a long press.
 * The To-Do rows were wired the other way round, which made the one list where
 * a task is most likely to still need writing the one list a tap would not let
 * you write in.
 *
 * ─── Why a source scan ─────────────────────────────────────────────────────
 *
 * Same reason as pendingOpensInbox.scan.test.js: CalendarView is thousands of
 * lines behind a sheet that only exists after a pan gesture, and what regresses
 * here is which handler a prop is bound to — plainly visible in the source.
 */
const read = (p) => fs.readFileSync(p, 'utf8');

/** Comments blanked so the prose can't answer for the code. */
const blankComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));

const CAL = blankComments(read('screens/TasksScreen/components/CalendarView.jsx'));
const SCREEN = blankComments(read('screens/TasksScreen/index.jsx'));

/** The To-Do card, by the testID only it carries. */
const todoCard = (() => {
  const at = CAL.indexOf('testID={`todo-card-${task.id}`}');
  if (at < 0) throw new Error('the To-Do card is gone — this scan is reading the wrong file');
  const from = CAL.lastIndexOf('<ScheduleCard', at);
  return CAL.slice(from, at);
})();

/** The timed schedule card, the row the To-Do rows must agree with. */
const timedCard = (() => {
  const at = CAL.indexOf('testID={`schedule-card-${task.id}`}');
  if (at < 0) throw new Error('the timed card is gone — this scan is reading the wrong file');
  const from = CAL.lastIndexOf('<ScheduleCard', at);
  return CAL.slice(from, at);
})();

describe('a To-Do with no time set edits on the first tap', () => {
  test('its tap is the edit handler, not the inspector', () => {
    expect(todoCard).toMatch(/onPress=\{onTaskLongPress \|\| onTaskPress\}/);
    expect(todoCard).not.toMatch(/onPress=\{onTaskInspect/);
  });

  test('the inspector is still there, one long press away', () => {
    expect(todoCard).toMatch(/onLongPress=\{onTaskInspect \|\| onTaskPress\}/);
  });

  test('both lists in the day pane use the same order', () => {
    const order = (card) => [
      card.match(/onPress=\{([^}]+)\}/)?.[1],
      card.match(/onLongPress=\{([^}]+)\}/)?.[1],
    ];
    expect(order(todoCard)).toEqual(order(timedCard));
  });
});

describe('the handler it is bound to really is the editor', () => {
  test('the screen hands the day pane its edit form as onTaskLongPress', () => {
    // Named for the gesture it was first wired to; it opens the task form.
    expect(SCREEN).toMatch(/onTaskLongPress=\{openEditForm\}/);
    expect(CAL).toMatch(/onTaskLongPress=\{onTaskLongPress\}/);
  });
});
