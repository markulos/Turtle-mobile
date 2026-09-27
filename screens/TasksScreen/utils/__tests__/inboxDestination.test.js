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
    const t = inboxTaskFrom('Ring the bank', ['Inbox'], NOW);
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
    expect(inboxTaskFrom('Something', [], NOW).dueDate).toBe('');
  });

  test('it lands in no board when there is no Inbox board', () => {
    expect(inboxTaskFrom('Something', ['Admin'], NOW).project).toBe('');
  });

  test('the title is trimmed, so a stray space is not part of the name', () => {
    expect(inboxTaskFrom('   Ring the bank  ', [], NOW).title).toBe('Ring the bank');
  });

  // An accidental Return on an empty field must not create an untitled task,
  // and the caller should not have to guard for it.
  test('a blank line is no task at all', () => {
    expect(inboxTaskFrom('', [], NOW)).toBeNull();
    expect(inboxTaskFrom('   ', [], NOW)).toBeNull();
    expect(inboxTaskFrom(null, [], NOW)).toBeNull();
  });

  test('it carries a stamp the caller can key on', () => {
    const t = inboxTaskFrom('Something', [], NOW);
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
