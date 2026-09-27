import fs from 'fs';

/**
 * EVERY WAY INTO A FOCUS SESSION STAMPS THE TASK.
 *
 * Starting a block on an untimed task gives it a slot on today at the minute it
 * began (utils/focusStart). That rule used to live inside the CALENDAR, wrapped
 * around the start keys on its To-Do and timeline rows — so whether working on
 * something put it on the timeline depended on which key you happened to press.
 * The Focus tab's own key, its search, and a task card's key all started the
 * same kind of block and left the schedule saying "any time".
 *
 * ─── Why a source scan and not a render test ───────────────────────────────
 *
 * Because what regressed is COVERAGE, not behaviour. Each handler works; the
 * bug is a fourth one being written next year without the stamp, and no render
 * test fails for a path it does not know exists. The count assertion below is
 * the actual guard: add a task-linked start and this test fails until the new
 * path is named here.
 */
const SRC = fs.readFileSync('screens/TasksScreen/index.jsx', 'utf8');

/**
 * The CALL that starts a task-linked block — every caller must stamp.
 *
 * `api.post(` is part of the pattern on purpose: matching the bare endpoint
 * counted the prose about it in the handlers' own comments, which is a scan
 * that fails when someone documents the thing it is guarding. A fresh RegExp
 * per use, because a /g regex carries `lastIndex` between assertions.
 */
const startCall = () => /api\.post\('\/pomodoro\/start-task'/g;

/** The three handlers, by what presses them. */
const PATHS = [
  ['startFocusHere', "the Focus tab's own start key"],
  ['startFocusOnTask', "the Focus tab's search"],
  ['startPomodoroFor', "a task card's key, and the calendar's start keys"],
];

/**
 * A handler's body: from its declaration to the next top-level `const`. Bodies
 * are indented four spaces, so a two-space `const` is always the next sibling
 * and never something inside this one.
 */
function body(name) {
  const start = SRC.indexOf(`const ${name} = useCallback`);
  expect(start).toBeGreaterThan(-1);
  const end = SRC.indexOf('\n  const ', start + 1);
  return SRC.slice(start, end === -1 ? SRC.length : end);
}

describe('starting a focus session takes a slot on today', () => {
  test.each(PATHS)('%s stamps the task (%s)', (name) => {
    const src = body(name);
    // The slice really is a start path — otherwise the assertion below would
    // pass over the wrong function and prove nothing.
    expect(src).toMatch(startCall());
    expect(src).toMatch(/stampFocusSlotRef\.current\?\.\(/);
  });

  test('there are no OTHER task-linked start paths', () => {
    // One per handler above. A fourth means somebody added a way to start a
    // block — check it stamps, then name it in PATHS.
    expect(SRC.match(startCall())).toHaveLength(PATHS.length);
  });

  test('the rule itself lives in one place', () => {
    // The screen writes; utils/focusStart decides. A second copy of the rule is
    // how the calendar came to be the only place that had it.
    expect(SRC).toMatch(/import \{ startPatch \} from '\.\/utils\/focusStart'/);
    const cal = fs.readFileSync('screens/TasksScreen/components/CalendarView.jsx', 'utf8');
    expect(cal).not.toMatch(/function startPatch/);
  });
});
