// Who appears on a note card's byline, and in what order. The order IS the
// feature: FaceStack paints first-on-top, so "author first" is what makes the
// author's disc the one that overlaps rather than the one buried underneath.
import { notePeopleLabel, notePeopleRoster } from '../notePeople';

const people = new Map([
  ['u2', { userId: 'u2', name: 'Ada', avatarUrl: '/api/avatars/u2.jpg' }],
  ['u3', { userId: 'u3', name: 'Grace', avatarUrl: null }],
]);

const note = (over = {}) => ({
  id: 'n1',
  sharedBy: { userId: 'u1', name: 'Mark', avatarUrl: '/api/avatars/u1.jpg' },
  involvedUsers: [],
  ...over,
});

describe('notePeopleRoster', () => {
  it('is just the author for a note nobody else is on', () => {
    expect(notePeopleRoster(note(), people)).toEqual([
      { userId: 'u1', name: 'Mark', avatarUrl: '/api/avatars/u1.jpg' },
    ]);
  });

  it('puts the author FIRST and the collaborators behind, in their own order', () => {
    const roster = notePeopleRoster(note({ involvedUsers: ['u3', 'u2'] }), people);
    expect(roster.map((p) => p.userId)).toEqual(['u1', 'u3', 'u2']);
  });

  it('resolves a collaborator id to its name and picture', () => {
    const roster = notePeopleRoster(note({ involvedUsers: ['u2'] }), people);
    expect(roster[1]).toEqual({ userId: 'u2', name: 'Ada', avatarUrl: '/api/avatars/u2.jpg' });
  });

  it('takes the author from the NOTE, so that face never waits on the people map', () => {
    // u1 is not in `people` at all — the note's own row carries them.
    const roster = notePeopleRoster(note(), new Map());
    expect(roster[0].name).toBe('Mark');
    expect(roster[0].avatarUrl).toBe('/api/avatars/u1.jpg');
  });

  it('does not draw the author twice when they are also in involvedUsers', () => {
    // The server does not forbid this, and the card must not show one person
    // twice because of it.
    const roster = notePeopleRoster(note({ involvedUsers: ['u1', 'u2'] }), people);
    expect(roster.map((p) => p.userId)).toEqual(['u1', 'u2']);
  });

  it('collapses a repeated collaborator', () => {
    const roster = notePeopleRoster(note({ involvedUsers: ['u2', 'u2'] }), people);
    expect(roster.map((p) => p.userId)).toEqual(['u1', 'u2']);
  });

  it('still gives an unresolved id a face', () => {
    // A member removed from the pond, or a map that has not landed yet. A
    // nameless disc is a person we have not named; a missing one is a person
    // silently dropped off the note.
    const roster = notePeopleRoster(note({ involvedUsers: ['ghost'] }), people);
    expect(roster.map((p) => p.userId)).toEqual(['u1', 'ghost']);
    expect(roster[1].name).toBeNull();
  });

  it('works with no people map at all', () => {
    const roster = notePeopleRoster(note({ involvedUsers: ['u2'] }), null);
    expect(roster.map((p) => p.userId)).toEqual(['u1', 'u2']);
  });

  it('ignores blank ids rather than drawing an anonymous disc', () => {
    const roster = notePeopleRoster(note({ involvedUsers: ['', null, '  '] }), people);
    expect(roster.map((p) => p.userId)).toEqual(['u1']);
  });

  it('is empty for a note with no author (an older pond, pre-backfill)', () => {
    expect(notePeopleRoster({ id: 'n1' }, people)).toEqual([]);
    expect(notePeopleRoster(null, people)).toEqual([]);
  });

  it('still lists the collaborators of an authorless note', () => {
    const roster = notePeopleRoster({ involvedUsers: ['u2'] }, people);
    expect(roster.map((p) => p.userId)).toEqual(['u2']);
  });
});

describe('notePeopleLabel', () => {
  it('names the author alone', () => {
    expect(notePeopleLabel(notePeopleRoster(note(), people))).toBe('Written by Mark');
  });

  it('counts the others rather than reading out a list', () => {
    expect(notePeopleLabel(notePeopleRoster(note({ involvedUsers: ['u2'] }), people)))
      .toBe('Written by Mark, with 1 other person');
    expect(notePeopleLabel(notePeopleRoster(note({ involvedUsers: ['u2', 'u3'] }), people)))
      .toBe('Written by Mark, with 2 others');
  });

  it('falls back when the author has no name yet', () => {
    expect(notePeopleLabel([{ userId: 'u9', name: null }])).toBe('Written by A member');
  });

  it('says nothing about nobody', () => {
    expect(notePeopleLabel([])).toBe('');
    expect(notePeopleLabel(null)).toBe('');
  });
});
