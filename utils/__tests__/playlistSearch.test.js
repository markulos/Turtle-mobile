import { playlistPicks } from '../playlistSearch';

/**
 * The playlist picker's one decision: what you typed is either one of your
 * playlists, or it is the name of a new one.
 */

const LIBRARY = ['Audio', 'Classics', 'Coca Cola', 'Download', 'Fr Bishoy Kamel'];

describe('playlistPicks', () => {
  test('an empty field is the plain list, with nothing to create', () => {
    const { matches, createName } = playlistPicks('', LIBRARY);
    expect(matches).toEqual(LIBRARY);
    expect(createName).toBeNull();
  });

  test('whitespace is not a name', () => {
    expect(playlistPicks('   ', LIBRARY)).toEqual({ matches: LIBRARY, createName: null });
  });

  test('narrows as you type', () => {
    expect(playlistPicks('cla', LIBRARY).matches).toEqual(['Classics']);
    expect(playlistPicks('co', LIBRARY).matches).toEqual(['Coca Cola']);
  });

  test('forgives a typo — a near miss is not "no results"', () => {
    expect(playlistPicks('classsics', LIBRARY).matches).toEqual(['Classics']);
    expect(playlistPicks('bishoy kamal', LIBRARY).matches).toEqual(['Fr Bishoy Kamel']);
  });

  test('finds a two-word playlist typed as one word', () => {
    expect(playlistPicks('cocacola', LIBRARY).matches).toEqual(['Coca Cola']);
    expect(playlistPicks('frbishoy', LIBRARY).matches).toEqual(['Fr Bishoy Kamel']);
  });

  test('ignores case and punctuation in the NAME as well as the query', () => {
    expect(playlistPicks('COCA-COLA', LIBRARY).matches).toEqual(['Coca Cola']);
  });

  test('puts what you plainly typed first', () => {
    // 'ca' is in "Coca Cola" and in "Fr Bishoy Kamel"… but "Classics" starts
    // with 'cl', so ordering only matters where several survive.
    const { matches } = playlistPicks('col', ['Coldplay', 'Coca Cola', 'Col']);
    expect(matches[0]).toBe('Col');        // exact
    expect(matches[1]).toBe('Coldplay');   // starts with
    expect(matches[2]).toBe('Coca Cola');  // contains
  });

  test('offers to create a name that is not a playlist yet', () => {
    const { matches, createName } = playlistPicks('Road trip', LIBRARY);
    expect(matches).toEqual([]);
    expect(createName).toBe('Road trip');
  });

  test('offers to create even while something else matches', () => {
    // "Classic" is not "Classics". You may well want both.
    const { matches, createName } = playlistPicks('Classic', LIBRARY);
    expect(matches).toEqual(['Classics']);
    expect(createName).toBe('Classic');
  });

  test('does NOT offer to create one you already have', () => {
    expect(playlistPicks('Classics', LIBRARY).createName).toBeNull();
    // …however you typed it. A playlist is a TAG, so a second "classics" would
    // be the same playlist reached by a path that claimed to make a new one.
    expect(playlistPicks('classics', LIBRARY).createName).toBeNull();
    expect(playlistPicks('  Coca-Cola ', LIBRARY).createName).toBeNull();
  });

  test('keeps what was typed for the name, not the matching form', () => {
    // normalize decides; it never gets stored.
    expect(playlistPicks('  Road Trip  ', LIBRARY).createName).toBe('Road Trip');
  });

  test('a library of nothing is the first-playlist case', () => {
    expect(playlistPicks('Classics', [])).toEqual({ matches: [], createName: 'Classics' });
    expect(playlistPicks('', [])).toEqual({ matches: [], createName: null });
  });

  test('survives junk in the library', () => {
    expect(playlistPicks('a', [null, undefined, '', 'Audio']).matches).toEqual(['Audio']);
    expect(playlistPicks('x', undefined).matches).toEqual([]);
  });
});
