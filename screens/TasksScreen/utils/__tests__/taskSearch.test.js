import {
  buildQuery, buildTaskIndex, indexTask, scoreTask, rankTasks, taskSearchMeta, startOfToday,
  needsCreateRow,
} from '../taskSearch';

const NOW = new Date(2026, 8, 26, 12, 0, 0).getTime();
const day = (offset) => {
  const d = new Date(2026, 8, 26 + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const task = (over = {}) => ({
  id: over.id || `t-${Math.random()}`,
  title: 'Renew the passport',
  project: 'Admin',
  tags: [],
  completed: false,
  ...over,
});

const rank = (tasks, q, opts) => rankTasks(buildTaskIndex(tasks), q, { now: NOW, ...opts });
const titles = (list) => list.map((t) => t.title);

describe('what counts as a match', () => {
  // The app's one rule, shared with noteSearch, the Notes screen and the
  // server's FTS: every word has to appear somewhere. Two surfaces disagreeing
  // about "matches" is worse than either rule being imperfect.
  test('every word must land somewhere — not just the first', () => {
    const t = [task({ id: 'a', title: 'Renew the passport' })];
    expect(rank(t, 'renew passport')).toHaveLength(1);
    expect(rank(t, 'renew licence')).toHaveLength(0);
  });

  test('the words need not be adjacent, or in order', () => {
    const t = [task({ id: 'a', title: 'Book the ferry to Calais' })];
    expect(rank(t, 'calais book')).toHaveLength(1);
  });

  test('a substring finds it — typing the middle of a word is still typing', () => {
    const t = [task({ id: 'a', title: 'Mayfield Construction invoice' })];
    expect(rank(t, 'cons')).toHaveLength(1);
  });

  test('the board and the tags are searchable, not just the title', () => {
    const t = [
      task({ id: 'a', title: 'Call the plumber', project: 'House', tags: ['urgent'] }),
      task({ id: 'b', title: 'Call the plumber', project: 'Work', tags: [] }),
    ];
    expect(rank(t, 'house')).toHaveLength(1);
    expect(rank(t, 'urgent')).toHaveLength(1);
  });

  test('so is the description, which is where a detail you half-remember lives', () => {
    const t = [task({ id: 'a', title: 'Ring the bank', description: 'ask about the overdraft' })];
    expect(rank(t, 'overdraft')).toHaveLength(1);
  });

  test('case is irrelevant in both directions', () => {
    const t = [task({ id: 'a', title: 'RENEW the Passport' })];
    expect(rank(t, 'renew')).toHaveLength(1);
    expect(rank(t, 'PASSPORT')).toHaveLength(1);
  });
});

describe('the order the answers come back in', () => {
  test('the task that IS the query beats the one that merely contains it', () => {
    const t = [
      task({ id: 'a', title: 'Pay the electricity bill for the flat' }),
      task({ id: 'b', title: 'Bill' }),
    ];
    expect(titles(rank(t, 'bill'))[0]).toBe('Bill');
  });

  test('a title hit beats a description hit', () => {
    const t = [
      task({ id: 'a', title: 'Something else', description: 'remember the ferry' }),
      task({ id: 'b', title: 'Ferry tickets' }),
    ];
    expect(titles(rank(t, 'ferry'))[0]).toBe('Ferry tickets');
  });

  // You are far more often looking for something still to do — and on Focus,
  // where the result means "start a block on this", a finished task rarely is.
  test('open work outranks finished work at the same relevance', () => {
    const t = [
      task({ id: 'a', title: 'Invoice', completed: true }),
      task({ id: 'b', title: 'Invoice', completed: false }),
    ];
    expect(rank(t, 'invoice')[0].id).toBe('b');
  });

  test('ties break by date then name, so the same query never reshuffles', () => {
    const t = [
      task({ id: 'a', title: 'Ferry', dueDate: day(5) }),
      task({ id: 'b', title: 'Ferry', dueDate: day(1) }),
    ];
    expect(rank(t, 'ferry').map((x) => x.id)).toEqual(['b', 'a']);
    expect(rank(t, 'ferry').map((x) => x.id)).toEqual(['b', 'a']);
  });
});

describe('an empty field is not an empty answer', () => {
  // A search that answers "nothing" before you type teaches you it is broken.
  // On the Focus tab the whole errand is "pick something to work on", so the
  // useful answer to no query is "here is what is next".
  test('no query lists what is coming up, soonest first', () => {
    const t = [
      task({ id: 'a', title: 'Later', dueDate: day(9) }),
      task({ id: 'b', title: 'Soon', dueDate: day(1) }),
    ];
    expect(titles(rank(t, ''))).toEqual(['Soon', 'Later']);
  });

  test('undated work sits behind dated work — "no date" is not "far away"', () => {
    const t = [
      task({ id: 'a', title: 'Someday' }),
      task({ id: 'b', title: 'Friday', dueDate: day(4) }),
    ];
    expect(titles(rank(t, ''))).toEqual(['Friday', 'Someday']);
  });
});

describe('the scopes', () => {
  const pool = [
    task({ id: 'open', title: 'Open thing', dueDate: day(2) }),
    task({ id: 'late', title: 'Late thing', dueDate: day(-3) }),
    task({ id: 'shut', title: 'Shut thing', dueDate: day(-3), completed: true }),
  ];

  test('to do hides what is finished', () => {
    expect(rank(pool, '', { scope: 'todo' }).map((t) => t.id).sort()).toEqual(['late', 'open']);
  });

  test('done shows only what is finished', () => {
    expect(rank(pool, '', { scope: 'done' }).map((t) => t.id)).toEqual(['shut']);
  });

  // A finished task that happened to be late is not something you need to find.
  test('overdue means late AND still open', () => {
    expect(rank(pool, '', { scope: 'overdue' }).map((t) => t.id)).toEqual(['late']);
  });

  test('a scope narrows the query rather than replacing it', () => {
    expect(rank(pool, 'thing', { scope: 'overdue' }).map((t) => t.id)).toEqual(['late']);
    expect(rank(pool, 'nothing', { scope: 'overdue' })).toHaveLength(0);
  });
});

describe('the index', () => {
  // The note picker's old 200-item ceiling is the cautionary tale: a task the
  // index leaves out is a task that cannot be found.
  test('nothing is capped on the way in', () => {
    const many = Array.from({ length: 400 }, (_, i) => task({ id: `t${i}`, title: `Task ${i}` }));
    expect(buildTaskIndex(many)).toHaveLength(400);
    expect(rank(many, 'Task 399')).toHaveLength(1);
  });

  test('duplicates and junk are dropped rather than indexed twice', () => {
    const t = task({ id: 'same' });
    expect(buildTaskIndex([t, t, null, undefined, { title: 'no id' }])).toHaveLength(1);
  });

  test('a record carries its fields lowercased once, for scoring to reuse', () => {
    const rec = indexTask(task({ title: 'LOUD', project: 'Admin', tags: ['Urgent'] }));
    expect(rec.title).toBe('loud');
    expect(rec.board).toBe('admin');
    expect(rec.tags).toBe('urgent');
    expect(rec.hay).toContain('loud');
    expect(rec.hay).toContain('urgent');
  });

  test('scoring a non-match is null, not zero — zero is a real score', () => {
    const rec = indexTask(task({ title: 'Passport' }));
    expect(scoreTask(rec, buildQuery('ferry'))).toBeNull();
    expect(scoreTask(rec, buildQuery(''))).toBe(0);
  });

  test('the limit caps the ANSWER, not the corpus', () => {
    const many = Array.from({ length: 80 }, (_, i) => task({ id: `t${i}`, title: `Thing ${i}` }));
    expect(rank(many, 'thing', { limit: 10 })).toHaveLength(10);
  });
});

describe('what a result row says about a task', () => {
  const meta = (t) => taskSearchMeta(t, { now: NOW });

  test('the board and the day', () => {
    expect(meta(task({ project: 'Admin', dueDate: day(0) }))).toBe('Admin · Today');
    expect(meta(task({ project: 'Admin', dueDate: day(1) }))).toBe('Admin · Tomorrow');
    expect(meta(task({ project: 'Admin', dueDate: day(-1) }))).toBe('Admin · Yesterday');
  });

  test('a day this week is named; further out is a date', () => {
    expect(meta(task({ project: '', dueDate: day(3) }))).toBe('Tuesday');
    expect(meta(task({ project: '', dueDate: day(20) }))).toBe('Oct 16');
  });

  test('how late it is, when it is late', () => {
    expect(meta(task({ project: '', dueDate: day(-9) }))).toBe('9d ago');
  });

  // "No board · —" is three characters of nothing pretending to be information.
  test('a task with nothing set gets a short honest line, not filler', () => {
    expect(meta(task({ project: '', dueDate: null }))).toBe('');
  });

  test('the time rides along, and done says so', () => {
    expect(meta(task({ project: 'Admin', dueDate: day(0), time: '09:00', completed: true })))
      .toBe('Admin · Today · 09:00 · Done');
  });
});

describe('startOfToday', () => {
  test('is this morning’s midnight, local', () => {
    const t = new Date(startOfToday(NOW));
    expect(t.getHours()).toBe(0);
    expect(t.getDate()).toBe(26);
  });
});

/**
 * The create row's rule. Two finders ask it — the Planner's day finder and the
 * Focus picker — so it is tested once, here, rather than twice in their
 * component tests.
 */
describe('needsCreateRow', () => {
  const rows = [{ title: 'Call Omar' }, { title: 'Book the ferry' }];

  test('an empty field offers nothing — there is no task to make yet', () => {
    expect(needsCreateRow('', rows)).toBe(false);
    expect(needsCreateRow('   ', rows)).toBe(false);
    expect(needsCreateRow(null, rows)).toBe(false);
  });

  test('something nobody carries can be made', () => {
    expect(needsCreateRow('Wash the car', rows)).toBe(true);
  });

  // A partial match is still a new task: "Call" is not "Call Omar", and the
  // person typing it may well want both.
  test('a query that only PREFIXES an answer can still be made', () => {
    expect(needsCreateRow('Call', rows)).toBe(true);
  });

  // The whole point of the rule: this is how a list ends up with two of
  // everything, one of them lowercase.
  test('an exact title is the one that exists, whatever the case or padding', () => {
    expect(needsCreateRow('Call Omar', rows)).toBe(false);
    expect(needsCreateRow('call omar', rows)).toBe(false);
    expect(needsCreateRow('  CALL OMAR  ', rows)).toBe(false);
  });

  test('answers with no title at all do not block a create', () => {
    expect(needsCreateRow('Wash the car', [{}, { title: null }])).toBe(true);
  });

  // Nothing matched is the case that MOST needs the row: an empty list used to
  // be a dead end that said "no task matches that".
  test('no answers at all still offers the create', () => {
    expect(needsCreateRow('Wash the car')).toBe(true);
    expect(needsCreateRow('Wash the car', [])).toBe(true);
  });
});
