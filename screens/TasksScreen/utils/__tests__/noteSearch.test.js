// Ranking for the task form's "Linked note" picker. The old search was one
// `.includes()`, so every one of these cases either failed outright or ranked
// the wrong note first.
import {
  buildQuery,
  matchSnippet,
  noteAgeLabel,
  noteTitleOf,
  rankNotes,
  scoreNote,
} from '../noteSearch';

const note = (over = {}) => ({
  id: over.id || 'n1',
  content: '',
  description: '',
  tags: [],
  type: 'note',
  createdAt: 1_700_000_000_000,
  ...over,
});

const titles = (list) => list.map((n) => noteTitleOf(n));

describe('noteTitleOf', () => {
  it('is the first non-empty line', () => {
    expect(noteTitleOf(note({ content: '\n\nShopping list\nmilk\neggs' }))).toBe('Shopping list');
  });

  it('truncates rather than letting a paragraph become a chip', () => {
    expect(noteTitleOf(note({ content: 'x'.repeat(80) }), 60)).toBe(`${'x'.repeat(60)}…`);
  });

  it('names an empty note instead of rendering a blank row', () => {
    expect(noteTitleOf(note({ content: '   ' }))).toBe('Untitled note');
    expect(noteTitleOf(null)).toBe('Untitled note');
  });
});

describe('scoreNote', () => {
  const q = (s) => buildQuery(s);

  it('requires every word, anywhere — not as a phrase', () => {
    // The old substring search failed this: "milk bread" only matched if those
    // two words were adjacent.
    const n = note({ content: 'Shopping', description: 'bread, then milk' });
    expect(scoreNote(n, q('milk bread'))).not.toBeNull();
    expect(scoreNote(n, q('milk carrots'))).toBeNull();
  });

  it('searches tags, which the old one could not see at all', () => {
    const n = note({ content: 'Pick a venue', tags: ['wedding'] });
    expect(scoreNote(n, q('wedding'))).not.toBeNull();
  });

  it('ranks a title hit above the same word buried in a description', () => {
    const inTitle = note({ id: 'a', content: 'Milk run' });
    const inBody = note({ id: 'b', content: 'Errands', description: 'get milk on the way' });
    expect(scoreNote(inTitle, q('milk'))).toBeGreaterThan(scoreNote(inBody, q('milk')));
  });

  it('ranks a tag hit above a description hit', () => {
    // A tag is a deliberate label; prose is incidental. Same ordering the
    // server's BM25 weights use.
    const tagged = note({ id: 'a', content: 'Venue', tags: ['wedding'] });
    const prose = note({ id: 'b', content: 'Venue', description: 'for the wedding, maybe' });
    expect(scoreNote(tagged, q('wedding'))).toBeGreaterThan(scoreNote(prose, q('wedding')));
  });

  it('puts an exact title above a title that merely contains it', () => {
    const exact = note({ id: 'a', content: 'Taxes' });
    const contains = note({ id: 'b', content: 'Taxes and other admin for the quarter' });
    expect(scoreNote(exact, q('taxes'))).toBeGreaterThan(scoreNote(contains, q('taxes')));
  });

  it('prefers a word start over a match mid-word', () => {
    const start = note({ id: 'a', content: 'Mil run tomorrow' });
    const middle = note({ id: 'b', content: 'Familiar faces tomorrow' });
    expect(scoreNote(start, q('mil'))).toBeGreaterThan(scoreNote(middle, q('mil')));
  });

  it('scores everything equally with no query', () => {
    expect(scoreNote(note({ content: 'anything' }), q(''))).toBe(0);
  });

  it('is not confused by regex characters in the query', () => {
    // A stray '(' used to be a crash waiting to happen once tokens became
    // regexes; it is escaped.
    const n = note({ content: 'Budget (2026)' });
    expect(() => scoreNote(n, q('(2026)'))).not.toThrow();
    expect(scoreNote(n, q('(2026)'))).not.toBeNull();
  });
});

describe('rankNotes', () => {
  const milkTitle = note({ id: 'a', content: 'Milk run', createdAt: 1 });
  const milkBody = note({ id: 'b', content: 'Errands', description: 'buy milk', createdAt: 9 });
  const unrelated = note({ id: 'c', content: 'Call the plumber', createdAt: 5 });
  const milkTodo = note({ id: 'd', content: 'Get milk', type: 'todo', createdAt: 3 });

  it('orders by how well it matched, not by how recent it is', () => {
    // The whole point: the old picker sliced the 8 most recent matches, so the
    // best answer was routinely off the list.
    const out = rankNotes([milkBody, milkTitle], 'milk');
    expect(titles(out)).toEqual(['Milk run', 'Errands']);
  });

  it('drops notes that do not match', () => {
    const out = rankNotes([milkTitle, unrelated], 'milk');
    expect(out).toHaveLength(1);
  });

  it('shows the most recent notes before anything is typed', () => {
    const out = rankNotes([milkTitle, milkBody, unrelated], '');
    expect(out.map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('narrows to one kind', () => {
    expect(rankNotes([milkTitle, milkTodo], 'milk', { kind: 'todo' }).map((n) => n.id)).toEqual(['d']);
    expect(rankNotes([milkTitle, milkTodo], 'milk', { kind: 'note' }).map((n) => n.id)).toEqual(['a']);
    expect(rankNotes([milkTitle, milkTodo], 'milk', { kind: 'all' })).toHaveLength(2);
  });

  it('dedupes across the tiers it is handed', () => {
    // The loaded page and the server FTS overlap constantly — the same note
    // must not appear twice in the list.
    const out = rankNotes([milkTitle, { ...milkTitle }], 'milk');
    expect(out).toHaveLength(1);
  });

  it('breaks a score tie with recency', () => {
    const older = note({ id: 'x', content: 'Milk', createdAt: 1 });
    const newer = note({ id: 'y', content: 'Milk', createdAt: 2 });
    expect(rankNotes([older, newer], 'milk').map((n) => n.id)).toEqual(['y', 'x']);
  });

  it('honours the limit', () => {
    const many = Array.from({ length: 60 }, (_, i) => note({ id: `m${i}`, content: `milk ${i}` }));
    expect(rankNotes(many, 'milk', { limit: 10 })).toHaveLength(10);
  });

  it('survives junk in the pool', () => {
    expect(rankNotes([null, undefined, milkTitle], 'milk')).toHaveLength(1);
    expect(rankNotes(null, 'milk')).toEqual([]);
  });
});

describe('matchSnippet', () => {
  const q = (s) => buildQuery(s);

  it('says nothing when the title already shows the match', () => {
    expect(matchSnippet(note({ content: 'Milk run' }), q('milk'))).toBeNull();
  });

  it('lifts the matching text out of a long description', () => {
    // Two notes both called "Shopping" are identical on a title-only row; this
    // is what tells them apart without opening either.
    const n = note({ content: 'Shopping', description: `${'a '.repeat(60)}oat milk ${'b '.repeat(60)}` });
    const s = matchSnippet(n, q('milk'));
    expect(s).toContain('milk');
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
  });

  it('names the tag when that is what matched', () => {
    expect(matchSnippet(note({ content: 'Venue', tags: ['wedding'] }), q('wedding'))).toBe('#wedding');
  });

  it('is null with no query and when nothing explains the hit', () => {
    expect(matchSnippet(note({ content: 'Venue' }), q(''))).toBeNull();
    expect(matchSnippet(note({ content: 'Venue' }), q('zzz'))).toBeNull();
  });
});

describe('noteAgeLabel', () => {
  const now = Date.parse('2026-03-20T12:00:00Z');
  const at = (iso) => note({ createdAt: Date.parse(iso) });

  it('counts up through the units', () => {
    expect(noteAgeLabel(at('2026-03-20T11:59:40Z'), now)).toBe('just now');
    expect(noteAgeLabel(at('2026-03-20T11:20:00Z'), now)).toBe('40m');
    expect(noteAgeLabel(at('2026-03-20T05:00:00Z'), now)).toBe('7h');
    expect(noteAgeLabel(at('2026-03-17T12:00:00Z'), now)).toBe('3d');
  });

  it('switches to a date once a week has passed', () => {
    expect(noteAgeLabel(at('2026-03-01T12:00:00Z'), now)).toMatch(/^1 Mar$/);
  });

  it('reads the server\'s snake_case field too', () => {
    // GET /turtle/notes answers createdAt; an optimistic local row carries
    // created_at. Both reach this.
    expect(noteAgeLabel({ created_at: '2026-03-20T11:20:00Z' }, now)).toBe('40m');
    expect(noteAgeLabel({}, now)).toBe('');
  });
});
