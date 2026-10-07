import fs from 'fs';

/**
 * PUTTING SOMEBODY ON A TO-DO WRITTEN IN NOTES.
 *
 * A to-do here IS a task on the calendar, so "who is on it" is the task's own
 * `involvedUsers` column and the same PeoplePicker the calendar's form uses.
 * Two things about that are easy to get wrong in ways no unit test can see,
 * and both are silent:
 *
 *   1. WHO MAY SET IT. The pond lists `involvedUsers` among its owner-only
 *      keys and drops it from a participant's PATCH, answering `ignored`
 *      rather than failing. A people control shown to a participant would
 *      therefore accept a change, save without error, and change nothing.
 *
 *   2. ABSENT IS NOT EMPTY. The server replaces the stored list with whatever
 *      arrives. Sending `[]` from a composer that was not offering the control
 *      — a plain note, or a participant's edit — reads as "take everyone off"
 *      and quietly unshares the task.
 *
 * Both are about which code path runs, not about what renders, so they are
 * scanned at the source rather than rendered.
 */
const SRC = fs.readFileSync('screens/NotesScreen/index.jsx', 'utf8');

/** A named function's body, up to the next top-level declaration. */
const region = (start, end) => {
  const from = SRC.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = SRC.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return SRC.slice(from, to);
};

describe('the picker is the calendar\'s, not a second one', () => {
  test('it is imported rather than re-implemented', () => {
    // A to-do written here is a task there. Two ways to put somebody on one is
    // how the two surfaces start to disagree about what being "on" it means.
    expect(SRC).toMatch(/import PeoplePicker from '\.\.\/TasksScreen\/components\/PeoplePicker'/);
  });

  test('guests are deliberately not offered here', () => {
    // A guest is a name and a phone that rides in the task's meta and gets its
    // reminder as a text. That only means something next to the reminder
    // settings, which live on the calendar's form.
    const picker = region('<PeoplePicker', '/>');
    expect(picker).toMatch(/allowGuests=\{false\}/);
  });
});

describe('who may change who is on it', () => {
  test('the gate is the task OWNER against my own id', () => {
    expect(SRC).toMatch(/const taskOwnerId = isTaskTodo\(initialNote\)/);
    expect(SRC).toMatch(/const mayEditPeople = !taskOwnerId \|\| !meId \|\| taskOwnerId === meId;/);
  });

  test('my id comes from the roster already fetched, not a second request', () => {
    expect(SRC).toMatch(/import \{ useMyUserId \} from '\.\.\/\.\.\/utils\/usePondPeople'/);
    expect(SRC).toMatch(/const meId = useMyUserId\(\);/);
  });

  test('the control is rendered only for a to-do, and only to the owner', () => {
    // Both halves matter: a plain note has no task row to write to, and a
    // participant's change would be dropped by the pond.
    expect(SRC).toMatch(/\{mode === 'todo' && mayEditPeople && \(/);
  });
});

describe('absent is not the same as empty', () => {
  test('the composer sends them only when it was offering the controls', () => {
    const submit = region('const handleSubmit = async', 'setBusy(false);');
    expect(submit).toMatch(/\.\.\.\(type === 'todo' && mayEditPeople \? \{ involvedUsers, readOnly \} : null\)/);
    // An unconditional `involvedUsers,` in the payload is the bug: it would
    // send [] for every plain note and every participant edit.
    expect(submit).not.toMatch(/^\s*involvedUsers,\s*$/m);
  });

  test('both write paths hand it to the payload builder', () => {
    for (const fn of ['const createTodo = async', 'const editTodo = async']) {
      const body = region(fn, 'try {');
      expect(body).toMatch(/involvedUsers/);
      expect(body).toMatch(/todoTaskPayload\(\{[^}]*involvedUsers/s);
    }
  });

  test('an edit never blanks the people it was not given', () => {
    // `involvedUsers: payload.involvedUsers || []` on the optimistic row would
    // wipe the faces off a shared to-do every time a participant fixed a typo
    // — until the refresh put them back, which looks exactly like a bug.
    const body = region('const editTodo = async', 'try {');
    expect(body).toMatch(/involvedUsers: payload\.involvedUsers \|\| t\.involvedUsers/);
    expect(body).not.toMatch(/involvedUsers: payload\.involvedUsers \|\| \[\]/);
  });

  test('a new to-do shows its people before the refresh lands', () => {
    const body = region('const createTodo = async', 'try {');
    expect(body).toMatch(/involvedUsers: payload\.involvedUsers \|\| \[\]/);
  });
});

/**
 * The owner's opt-out. The pond's default is collaborative — being put on
 * something means being able to work on it — so this switch is the exception,
 * and it has to be possible to express "I did not touch this" distinctly from
 * "I turned it off".
 */
describe('locking a to-do to its owner', () => {
  test('the lock is offered to the owner, beside the people it governs', () => {
    expect(SRC).toMatch(/const \[readOnly, setReadOnly\] = useState\(false\);/);
    // Inside the people box, so it cannot be shown without the list it is
    // about, and only once somebody is actually on it.
    expect(SRC).toMatch(/\{involvedUsers\.length > 0 && \(/);
    expect(SRC).toMatch(/accessibilityRole="switch"/);
  });

  test('it is seeded from the item, so an edit does not silently unlock it', () => {
    expect(SRC).toMatch(/setReadOnly\(!!initialNote\?\.readOnly\);/);
  });

  test('an edit leaves the flag alone when the composer did not send one', () => {
    // `readOnly: !!payload.readOnly` on the optimistic row would read an
    // absent field as "unlocked" and flicker a locked to-do open.
    const body = region('const editTodo = async', 'try {');
    expect(body).toMatch(/readOnly: payload\.readOnly === undefined \? t\.readOnly : payload\.readOnly/);
  });
});
