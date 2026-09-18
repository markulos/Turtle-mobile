import { matchBoards, rankPrefixFirst, searchEverything, stripMarks } from '../globalSearch';

test('stripMarks drops the FTS highlight tags', () => {
  expect(stripMarks('Buy <mark>milk</mark> today')).toBe('Buy milk today');
  expect(stripMarks(null)).toBe('');
});

test('rankPrefixFirst moves title-prefix hits ahead, keeps order otherwise', () => {
  const items = [{ t: 'Garden tasks' }, { t: 'Tax return' }, { t: 'taxi receipt' }, { t: 'Other' }];
  expect(rankPrefixFirst(items, 'ta', (i) => i.t).map((i) => i.t))
    .toEqual(['Tax return', 'taxi receipt', 'Garden tasks', 'Other']);
  expect(rankPrefixFirst(items, '', (i) => i.t)).toBe(items);
});

test('matchBoards: substring hits, prefix first, capped', () => {
  expect(matchBoards(['Work', 'Homework', 'Home', 'Garden'], 'ho')).toEqual(['Homework', 'Home']);
  expect(matchBoards(['A', 'B'], '')).toEqual([]);
});

test('searchEverything fans out to the three endpoints, boards locally, and isolates a failure', async () => {
  const calls = [];
  const api = {
    get: jest.fn(async (path) => {
      calls.push(path);
      if (path.startsWith('/tasks/search')) return { success: true, results: [{ id: 't1', title: 'Beach day' }, { id: 't2', title: 'Book beach house' }] };
      if (path.startsWith('/turtle/notes/search')) throw new Error('Network request failed');
      if (path.startsWith('/media/search')) return { success: true, items: [{ id: 'm1', originalName: 'beach.jpg' }] };
      return {};
    }),
  };
  const r = await searchEverything(api, 'beach', { boards: ['Beach trip', 'Work'] });
  expect(calls.find((p) => p.startsWith('/tasks/search'))).toContain('scope=all');
  expect(r.tasks.map((t) => t.id)).toEqual(['t1', 't2']);
  expect(r.notes).toEqual([]);
  expect(r.errors).toEqual(['notes']);
  expect(r.media.map((m) => m.id)).toEqual(['m1']);
  expect(r.boards).toEqual(['Beach trip']);
  const blank = await searchEverything(api, '   ');
  expect(blank.tasks).toEqual([]);
});

it('asks for documents as their own section and keeps Photos visual', async () => {
  const calls = [];
  const api = { get: jest.fn((p) => { calls.push(p); return Promise.resolve(p.includes('kind=document') ? { items: [{ id: 'd1', originalName: 'lease.pdf', type: 'document' }] } : { items: [], results: [], notes: [] }); }) };
  const r = await searchEverything(api, 'lease');
  expect(calls.find((p) => p.startsWith('/media/search') && !p.includes('kind=document'))).toContain('kind=visual');
  expect(calls.some((p) => p.includes('/media/search') && p.includes('kind=document'))).toBe(true);
  expect(r.documents.map((d) => d.id)).toEqual(['d1']);
});
