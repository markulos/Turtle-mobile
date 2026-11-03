import { inboxDestination, inboxDestinationLabel, inboxTaskFrom, inboxTasks } from '../inboxDestination';

const NOW = new Date(2026, 8, 26, 12, 0, 0).getTime();

describe('where a captured task lands', () => {
  // Capturing into "no board" next to a board literally called Inbox would be
  // two inboxes — the exact confusion the tab exists to remove.
  test('a real Inbox board wins', () => {
    expect(inboxDestination(['Admin', 'Inbox', 'Travel'])).toBe('Inbox');
  });

  test('however it was capitalised, and whatever spacing it was typed with', () => {
    expect(inboxDestination(['inbox'])).toBe('inbox');
    expect(inboxDestination(['INBOX'])).toBe('INBOX');
    expect(inboxDestination([' Inbox '])).toBe(' Inbox ');
  });

  // The name is returned VERBATIM, not normalised: it has to match the board
  // the tasks are actually filed under, character for character.
  test('the board’s own spelling comes back, not a tidied copy', () => {
    expect(inboxDestination(['inbox'])).not.toBe('Inbox');
  });

  test('with no such board, no board at all — which the Planner already lists', () => {
    expect(inboxDestination(['Admin', 'Travel'])).toBe('');
    expect(inboxDestination([])).toBe('');
    expect(inboxDestination()).toBe('');
  });

  test('junk in the board list does not throw', () => {
    expect(inboxDestination([null, undefined, 42, 'Inbox'])).toBe('Inbox');
  });
});

describe('what the field says it will do', () => {
  test('it names their board when they have one', () => {
    expect(inboxDestinationLabel(['Inbox'])).toBe('Inbox');
  });

  // "No Board" reads like an error rather than a state, and the one thing a
  // first-time user needs to know is where the thing goes.
  test('and calls a boardless task Unsorted rather than "No Board"', () => {
    expect(inboxDestinationLabel(['Admin'])).toBe('Unsorted');
    expect(inboxDestinationLabel([])).toBe('Unsorted');
  });
});

describe('the task a captured line becomes', () => {
  test('a title, a home, and nothing else to decide', () => {
    const t = inboxTaskFrom('Ring the bank', ['Inbox'], { now: NOW });
    expect(t).toMatchObject({
      title: 'Ring the bank',
      project: 'Inbox',
      dueDate: '',
      completed: false,
      tags: [],
      subtasks: [],
    });
  });

  test('no date — asking for one at capture time is what stops people capturing', () => {
    expect(inboxTaskFrom('Something', [], { now: NOW }).dueDate).toBe('');
  });

  test('it lands in no board when there is no Inbox board', () => {
    expect(inboxTaskFrom('Something', ['Admin'], { now: NOW }).project).toBe('');
  });

  test('the title is trimmed, so a stray space is not part of the name', () => {
    expect(inboxTaskFrom('   Ring the bank  ', [], { now: NOW }).title).toBe('Ring the bank');
  });

  // An accidental Return on an empty field must not create an untitled task,
  // and the caller should not have to guard for it.
  test('a blank line is no task at all', () => {
    expect(inboxTaskFrom('', [], { now: NOW })).toBeNull();
    expect(inboxTaskFrom('   ', [], { now: NOW })).toBeNull();
    expect(inboxTaskFrom(null, [], { now: NOW })).toBeNull();
  });

  test('it carries a stamp the caller can key on', () => {
    const t = inboxTaskFrom('Something', [], { now: NOW });
    expect(t.createdAt).toBe(NOW);
    expect(t.id).toBe(String(NOW));
  });
});

describe('what is in the inbox', () => {
  const t = (over = {}) => ({ id: 'x', title: 'A thing', project: 'Inbox', createdAt: 1, ...over });

  test('only what lives where the capture field puts things', () => {
    const { items } = inboxTasks(
      [t({ id: 'a' }), t({ id: 'b', project: 'Admin' })],
      ['Inbox', 'Admin'],
    );
    expect(items.map((x) => x.id)).toEqual(['a']);
  });

  test('…and with no Inbox board, that means the boardless ones', () => {
    const { items } = inboxTasks(
      [t({ id: 'a', project: '' }), t({ id: 'b', project: 'Admin' })],
      ['Admin'],
    );
    expect(items.map((x) => x.id)).toEqual(['a']);
  });

  // Showing a board's finished tasks under a box you are adding to turns a
  // working list into an archive.
  test('open work only', () => {
    const { items } = inboxTasks(
      [t({ id: 'a' }), t({ id: 'b', completed: true }), t({ id: 'c', completedAt: 5 })],
      ['Inbox'],
    );
    expect(items.map((x) => x.id)).toEqual(['a']);
  });

  test('newest first — the line you just typed is the one you are looking at', () => {
    const { items } = inboxTasks(
      [t({ id: 'old', createdAt: 1 }), t({ id: 'new', createdAt: 99 })],
      ['Inbox'],
    );
    expect(items.map((x) => x.id)).toEqual(['new', 'old']);
  });

  // The cap is on what is DRAWN, not on what exists — `total` is the truth, and
  // it is what lets the list say "8 more" instead of quietly hiding them.
  test('the cap limits the list but never the count', () => {
    const many = Array.from({ length: 30 }, (_, i) => t({ id: `t${i}`, createdAt: i }));
    const { items, total } = inboxTasks(many, ['Inbox'], { limit: 5 });
    expect(items).toHaveLength(5);
    expect(total).toBe(30);
  });

  test('junk in the task list does not throw', () => {
    const { items } = inboxTasks([null, undefined, { title: 'no id' }, t({ id: 'a' })], ['Inbox']);
    expect(items.map((x) => x.id)).toEqual(['a']);
  });
});

/**
 * THE PLANNER HAS ONE SCOPE and every tab obeys it — except, until now, the one
 * with the text field in it. Scoped to a board, the Inbox tab still listed the
 * inbox and still captured into it.
 *
 * Both halves move together on purpose. A list showing one board above a field
 * that files somewhere else is worse than ignoring the scope altogether:
 * what you type disappears out of the list you are watching.
 */
describe('a picked board takes over the inbox', () => {
  const BOARDS = ['Admin', 'Inbox', 'Larkin Architect'];

  test('the destination is the board you are on, not the inbox', () => {
    expect(inboxDestination(BOARDS, 'Larkin Architect')).toBe('Larkin Architect');
    expect(inboxDestinationLabel(BOARDS, 'Larkin Architect')).toBe('Larkin Architect');
  });

  test('and what you capture is born there', () => {
    const t = inboxTaskFrom('Draw the stair', BOARDS, { now: NOW, scope: 'Larkin Architect' });
    expect(t.project).toBe('Larkin Architect');
  });

  test('the list under the field is that board’s open work', () => {
    const tasks = [
      { id: 'a', title: 'On the board', project: 'Larkin Architect', createdAt: 2 },
      { id: 'b', title: 'In the inbox', project: 'Inbox', createdAt: 3 },
      { id: 'c', title: 'Done there', project: 'Larkin Architect', completed: true, createdAt: 4 },
    ];
    const { items, total } = inboxTasks(tasks, BOARDS, { scope: 'Larkin Architect' });
    expect(items.map((t) => t.id)).toEqual(['a']);
    expect(total).toBe(1);
  });

  // Unscoped is the sentinel, not an empty string — the screen says 'All'.
  test('“All boards” is not a board: the inbox rule still decides', () => {
    expect(inboxDestination(BOARDS, 'All')).toBe('Inbox');
    expect(inboxDestination(BOARDS, undefined)).toBe('Inbox');
    expect(inboxDestination(BOARDS, '')).toBe('Inbox');
  });

  // "No Board" IS a choice — it means capture into no board and list the
  // boardless, which is also what a pond with no Inbox board does by default.
  test('“No Project” scopes to the boardless, rather than being ignored', () => {
    expect(inboxDestination(BOARDS, 'No Project')).toBe('');
    expect(inboxDestinationLabel(BOARDS, 'No Project')).toBe('Unsorted');
    const tasks = [
      { id: 'a', title: 'Loose', createdAt: 1 },
      { id: 'b', title: 'Filed', project: 'Inbox', createdAt: 2 },
    ];
    expect(inboxTasks(tasks, BOARDS, { scope: 'No Project' }).items.map((t) => t.id)).toEqual(['a']);
  });

  // The rule the whole tab rests on: list and field agree, always.
  test('the field and the list never disagree about where things go', () => {
    for (const scope of ['All', 'Larkin Architect', 'No Project', undefined]) {
      const made = inboxTaskFrom('Something', BOARDS, { now: NOW, scope });
      const { items } = inboxTasks([{ ...made, createdAt: NOW }], BOARDS, { scope });
      expect(items.map((t) => t.id)).toEqual([made.id]);
    }
  });
});
