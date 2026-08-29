import {
  actionsOf,
  blocksCoverProposal,
  drawableBlocks,
  mergeFormBody,
  missingRequired,
  tabForScreen,
} from '../chatBlocks';

/**
 * The decisions a board makes before anything is sent: what a form puts in the
 * body, whether it may send at all, where an "open" button goes, and whether
 * the older intent card should stand down because a block already offers the
 * same change. All pure, and all the kind of thing that breaks silently.
 */

const fields = [
  { id: 'f0', name: 'title', label: 'What', type: 'text', required: true },
  { id: 'f1', name: 'duration', label: 'Minutes', type: 'number' },
  { id: 'f2', name: 'priority', label: 'Priority', type: 'select', options: [{ label: 'High', value: 'high' }] },
];

describe('mergeFormBody', () => {
  test('folds filled values in over the assistant’s pre-filled body', () => {
    const body = mergeFormBody(fields, { title: 'Ring the vet', duration: '30' }, { title: 'Something', source: 'chat' });
    expect(body).toEqual({ title: 'Ring the vet', duration: 30, source: 'chat' });
  });

  test('drops blanks rather than sending empty strings', () => {
    // "" means "leave it out", not "set it to nothing" — an endpoint that
    // stores an empty string would clear a field the user never touched.
    expect(mergeFormBody(fields, { title: 'x', duration: '', priority: '' })).toEqual({ title: 'x' });
  });

  test('sends numbers as numbers and leaves unparseable ones as text', () => {
    expect(mergeFormBody(fields, { duration: '45' }).duration).toBe(45);
    expect(mergeFormBody(fields, { duration: 'half an hour' }).duration).toBe('half an hour');
  });

  test('carries fixed body keys the form never showed', () => {
    expect(mergeFormBody(fields, { title: 'x' }, { taskId: 't-1' }).taskId).toBe('t-1');
  });
});

describe('missingRequired', () => {
  test('is empty once every required field is filled', () => {
    expect(missingRequired(fields, { title: 'Ring the vet' })).toEqual([]);
  });

  test('names fields by label, and whitespace does not count as filled', () => {
    expect(missingRequired(fields, { title: '   ' })).toEqual(['What']);
  });
});

describe('tabForScreen', () => {
  test('maps the screens this app actually has', () => {
    expect(tabForScreen('tasks')).toBe('Tasks');
    expect(tabForScreen('passwords')).toBe('Vault');
    expect(tabForScreen('settings')).toBe('Profile');
    expect(tabForScreen('chat')).toBe('Turtle');
  });

  test('returns null for a screen that is not a tab here', () => {
    // The server's list is shared with the web app, and music / boards /
    // downloads live INSIDE the Turtle tab on this one. Navigating to a guess
    // is worse than saying the screen isn't here.
    for (const screen of ['music', 'boards', 'downloads', 'activity', 'pomodoro', 'nonsense', '']) {
      expect(tabForScreen(screen)).toBeNull();
    }
  });
});

describe('drawableBlocks', () => {
  test('keeps the kinds this build can draw', () => {
    const blocks = [
      { id: 'b0', kind: 'note', title: 'Hi' },
      { id: 'b1', kind: 'actions', actions: [] },
    ];
    expect(drawableBlocks(blocks)).toHaveLength(2);
  });

  test('drops a kind from a newer server rather than guessing at it', () => {
    // The reply text stands on its own — that is the whole reason blocks are
    // an additive field, and why this app is allowed to be older than its pond.
    const blocks = [{ id: 'b0', kind: 'timeline', items: [] }, { id: 'b1', kind: 'note', body: 'ok' }];
    expect(drawableBlocks(blocks).map((b) => b.kind)).toEqual(['note']);
  });

  test('survives a missing or malformed field', () => {
    expect(drawableBlocks(null)).toEqual([]);
    expect(drawableBlocks(undefined)).toEqual([]);
    expect(drawableBlocks([null, {}, { kind: 'note' }])).toEqual([]);
  });
});

describe('actionsOf', () => {
  test('finds actions wherever a block puts them', () => {
    const block = {
      id: 'b0',
      kind: 'list',
      actions: [{ id: 'a' }],
      submit: { id: 'b' },
      items: [{ actions: [{ id: 'c' }] }, { action: { id: 'd' } }],
    };
    expect(actionsOf(block).map((a) => a.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  test('is empty for a block with none', () => {
    expect(actionsOf({ id: 'b0', kind: 'note' })).toEqual([]);
    expect(actionsOf(null)).toEqual([]);
  });
});

describe('blocksCoverProposal', () => {
  const proposal = { method: 'POST', path: '/api/tasks/single', signature: 'POST /api/tasks/single' };

  test('a matching call action means the intent card should stand down', () => {
    // Two buttons for one change is worse than none — the user cannot tell
    // whether pressing both does it twice.
    const blocks = [{
      id: 'b0',
      kind: 'actions',
      actions: [{ id: 'b0.a0', kind: 'call', signature: 'POST /api/tasks/single' }],
    }];
    expect(blocksCoverProposal(blocks, proposal)).toBe(true);
  });

  test('matches on method and path when the signature is absent', () => {
    const blocks = [{
      id: 'b0',
      kind: 'actions',
      actions: [{ id: 'b0.a0', kind: 'call', method: 'POST', path: '/api/tasks/single' }],
    }];
    expect(blocksCoverProposal(blocks, proposal)).toBe(true);
  });

  test('an unrelated button does not suppress the card', () => {
    const blocks = [{
      id: 'b0',
      kind: 'actions',
      actions: [{ id: 'b0.a0', kind: 'call', signature: 'GET /api/tasks' }],
    }];
    expect(blocksCoverProposal(blocks, proposal)).toBe(false);
  });

  test('a non-call action never covers a proposal', () => {
    // An `ask` button that happens to mention the same path does not run it.
    const blocks = [{
      id: 'b0',
      kind: 'actions',
      actions: [{ id: 'b0.a0', kind: 'ask', signature: 'POST /api/tasks/single' }],
    }];
    expect(blocksCoverProposal(blocks, proposal)).toBe(false);
  });

  test('no blocks and no proposal are both safely false', () => {
    expect(blocksCoverProposal([], proposal)).toBe(false);
    expect(blocksCoverProposal(null, proposal)).toBe(false);
    expect(blocksCoverProposal([{ id: 'b0', kind: 'actions', actions: [] }], null)).toBe(false);
  });
});
