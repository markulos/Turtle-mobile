/**
 * The proposal card's reading of a model-composed object.
 *
 * This is a trust boundary: the payload was written by a language model and
 * travelled through a server, and the card built from it carries a button that
 * changes the user's data. So the rules worth pinning are the refusals — an
 * unrecognised shape must produce no card at all, and an unknown risk must be
 * treated as the dangerous kind rather than the safe one.
 */
const {
  fieldsOf,
  hiddenFieldCount,
  readProposal,
  requestPath,
  subjectOf,
  summarise,
} = require('../apiProposal');

const intent = (payload) => ({ type: 'TURTLE_API_CALL', payload });

describe('readProposal', () => {
  it('reads a well-formed proposal', () => {
    const p = readProposal(intent({
      method: 'post', path: '/api/tasks/single', body: { title: 'Buy milk' },
      risk: 'write', reason: 'You asked to be reminded.', signature: 'POST /api/tasks/single',
    }));
    expect(p).toMatchObject({
      method: 'POST', path: '/api/tasks/single', risk: 'write', reason: 'You asked to be reminded.',
    });
    expect(p.body).toEqual({ title: 'Buy milk' });
  });

  it('ignores anything that is not a Turtle API proposal', () => {
    expect(readProposal(null)).toBeNull();
    expect(readProposal({ type: 'API_CALL', payload: { executable: 'ms-graph' } })).toBeNull();
    expect(readProposal({ type: 'TURTLE_API_CALL' })).toBeNull();
  });

  it('refuses a method that cannot change anything, so a read never renders as a proposal', () => {
    // A GET should already have been executed server-side. One arriving here
    // means something is confused; a card offering to "do" a read is noise.
    expect(readProposal(intent({ method: 'GET', path: '/api/tasks' }))).toBeNull();
  });

  it('refuses a path that is not on this server', () => {
    // The card renders a path as if it were local. A proposal naming another
    // host would be a phishing surface with a Confirm button on it.
    for (const path of ['https://evil.test/api/x', '//evil.test/x', 'api/tasks', '']) {
      expect(readProposal(intent({ method: 'POST', path }))).toBeNull();
    }
  });

  it('treats an unknown risk as destructive', () => {
    // Wrong in the direction that makes someone read the card.
    expect(readProposal(intent({ method: 'PATCH', path: '/api/x', risk: 'harmless' })).risk).toBe('destructive');
    expect(readProposal(intent({ method: 'PATCH', path: '/api/x' })).risk).toBe('destructive');
    expect(readProposal(intent({ method: 'PATCH', path: '/api/x', risk: 'write' })).risk).toBe('write');
  });

  it('drops junk in the optional fields rather than rendering it', () => {
    const p = readProposal(intent({
      method: 'DELETE', path: '/api/tasks/t-1', risk: 'destructive',
      body: 'not an object', query: 7, reason: 42,
    }));
    expect(p.body).toBeNull();
    expect(p.query).toBeNull();
    expect(p.reason).toBe('');
  });
});

describe('summarise', () => {
  it('names the action and the thing in a concrete verb', () => {
    expect(summarise(readProposal(intent({ method: 'POST', path: '/api/tasks/single', risk: 'write' }))))
      .toBe('Create task');
    expect(summarise(readProposal(intent({ method: 'DELETE', path: '/api/tasks/t-1729', risk: 'destructive' }))))
      .toBe('Delete task');
  });

  it('names the resource, not the route qualifier that follows it', () => {
    // The bug this pins: reading the LAST segment turns /api/tasks/single into
    // "Create single" and /api/media/heal into "Create heal".
    expect(subjectOf('/api/tasks/single')).toBe('task');
    expect(subjectOf('/api/media/heal')).toBe('media');
    expect(subjectOf('/api/tasks/t-1729')).toBe('task');
    expect(subjectOf('/api/media/album/Trip%20to%20Rome')).toBe('media');
    // `turtle` is a namespace, not a thing.
    expect(subjectOf('/api/turtle/notes/n-3?x=1')).toBe('note');
    expect(subjectOf('')).toBe('the server');
  });
});

describe('fieldsOf', () => {
  it('flattens query and body into displayable pairs', () => {
    const p = readProposal(intent({
      method: 'POST', path: '/api/x', risk: 'write',
      query: { limit: 5 }, body: { title: 'Buy milk', tags: ['a', 'b'], meta: { deep: true }, empty: null },
    }));
    expect(fieldsOf(p)).toEqual([
      { key: 'limit', value: '5' },
      { key: 'title', value: 'Buy milk' },
      // An array is summarised by count, not rendered.
      { key: 'tags', value: '2 items' },
      { key: 'meta', value: '…' },
      { key: 'empty', value: '—' },
    ]);
  });

  it('clips a long value rather than pushing the buttons off screen', () => {
    const p = readProposal(intent({
      method: 'POST', path: '/api/x', risk: 'write', body: { note: 'x'.repeat(200) },
    }));
    const [field] = fieldsOf(p);
    expect(field.value.length).toBeLessThanOrEqual(81);
    expect(field.value.endsWith('…')).toBe(true);
  });

  it('says how many fields it is not showing', () => {
    const body = {};
    for (let i = 0; i < 10; i += 1) body[`k${i}`] = i;
    const p = readProposal(intent({ method: 'POST', path: '/api/x', risk: 'write', body }));
    expect(fieldsOf(p)).toHaveLength(6);
    expect(hiddenFieldCount(p)).toBe(4);
  });
});

describe('requestPath', () => {
  it('is the exact string the button will send', () => {
    const bare = readProposal(intent({ method: 'DELETE', path: '/api/tasks/t-1', risk: 'destructive' }));
    expect(requestPath(bare)).toBe('/api/tasks/t-1');

    const withQuery = readProposal(intent({
      method: 'POST', path: '/api/media/heal', risk: 'write', query: { scope: 'all photos', n: 2 },
    }));
    expect(requestPath(withQuery)).toBe('/api/media/heal?scope=all%20photos&n=2');
  });

  it('drops empty values instead of sending "undefined"', () => {
    const p = readProposal(intent({
      method: 'POST', path: '/api/x', risk: 'write', query: { a: 1, b: null, c: undefined },
    }));
    expect(requestPath(p)).toBe('/api/x?a=1');
  });
});
