// Matching for the Music vault's search. Music had none at all before this,
// so every case here is something the vault simply could not do.
import {
  buildTrackQuery,
  rankTracks,
  scoreTrack,
  trackCountLabel,
  trackFields,
} from '../trackSearch';

const q = (s) => buildTrackQuery(s);
const fields = (over) => trackFields({}, { title: '', source: '', tags: [], ...over });

// The vault describes a row; the matcher never guesses at it (renames and
// playlist tags are the caller's business).
const describe_ = (row) => ({ title: row.title, source: row.source, tags: row.tags || [] });
const track = (id, title, source = '', tags = []) => ({ id, title, source, tags });

describe('scoreTrack', () => {
  it('requires every word, anywhere across the three fields', () => {
    const f = fields({ title: 'Nightcall', source: 'Kavinsky', tags: ['Drive'] });
    expect(scoreTrack(f, q('kavinsky drive'))).not.toBeNull();
    expect(scoreTrack(f, q('kavinsky opera'))).toBeNull();
  });

  it('searches playlists — a tag IS a playlist for audio', () => {
    // "gym" finds what is filed under Gym even though no title says it.
    expect(scoreTrack(fields({ title: 'Untitled 03', tags: ['Gym'] }), q('gym'))).not.toBeNull();
  });

  it('ranks a title hit above the same word in the source line', () => {
    const inTitle = fields({ title: 'Kavinsky live set' });
    const inSource = fields({ title: 'Nightcall', source: 'Kavinsky' });
    expect(scoreTrack(inTitle, q('kavinsky'))).toBeGreaterThan(scoreTrack(inSource, q('kavinsky')));
  });

  it('ranks the artist above a playlist that merely mentions the word', () => {
    const inSource = fields({ title: 'Track 1', source: 'Kavinsky' });
    const inTag = fields({ title: 'Track 1', tags: ['Kavinsky covers'] });
    expect(scoreTrack(inSource, q('kavinsky'))).toBeGreaterThan(scoreTrack(inTag, q('kavinsky')));
  });

  it('but a playlist named EXACTLY the query is a strong signal', () => {
    // Typing a playlist's name is as deliberate as typing a title — "Gym" is
    // not an incidental word that happens to appear on the track.
    const namedPlaylist = fields({ title: 'Track 1', tags: ['Gym'] });
    const mentioned = fields({ title: 'Track 1', source: 'Gym sessions vol 2' });
    expect(scoreTrack(namedPlaylist, q('gym'))).toBeGreaterThan(scoreTrack(mentioned, q('gym')));
  });

  it('puts an exact title above one that merely contains it', () => {
    const exact = fields({ title: 'Nightcall' });
    const contains = fields({ title: 'Nightcall (extended club mix)' });
    expect(scoreTrack(exact, q('nightcall'))).toBeGreaterThan(scoreTrack(contains, q('nightcall')));
  });

  it('prefers a word start over a match mid-word', () => {
    const start = fields({ title: 'Night drive' });
    const middle = fields({ title: 'Midnight rambler' });
    expect(scoreTrack(start, q('night'))).toBeGreaterThan(scoreTrack(middle, q('night')));
  });

  it('is not tripped up by regex characters', () => {
    const f = fields({ title: 'Bangarang (feat. Sirah)' });
    expect(() => scoreTrack(f, q('(feat.'))).not.toThrow();
    expect(scoreTrack(f, q('(feat.'))).not.toBeNull();
  });
});

describe('rankTracks', () => {
  const LIB = [
    track('1', 'Nightcall', 'Kavinsky', ['Drive']),
    track('2', 'Midnight City', 'M83'),
    track('3', 'Kavinsky live set', 'Radio'),
    track('4', 'Untitled 03', 'Phone', ['Gym']),
  ];

  it('leaves the library untouched when nothing is typed', () => {
    // Not searching must not re-sort the vault — the library's own order
    // (newest first) is meaningful.
    expect(rankTracks(LIB, '', describe_)).toBe(LIB);
    expect(rankTracks(LIB, '   ', describe_)).toBe(LIB);
  });

  it('orders by how well it matched', () => {
    const out = rankTracks(LIB, 'kavinsky', describe_);
    expect(out.map((t) => t.id)).toEqual(['3', '1']); // title hit before source hit
  });

  it('drops what does not match', () => {
    expect(rankTracks(LIB, 'midnight', describe_).map((t) => t.id)).toEqual(['2']);
  });

  it('finds a track by the playlist it is filed under', () => {
    expect(rankTracks(LIB, 'gym', describe_).map((t) => t.id)).toEqual(['4']);
  });

  it('honours the limit and survives an empty library', () => {
    expect(rankTracks(LIB, 'a', describe_, { limit: 1 }).length).toBeLessThanOrEqual(1);
    expect(rankTracks([], 'anything', describe_)).toEqual([]);
    expect(rankTracks(null, 'anything', describe_)).toEqual([]);
  });

  it('works without a describe function at all', () => {
    // Falls back to the row's own filename fields rather than throwing.
    const rows = [{ id: 'x', originalName: 'Nightcall.mp3' }];
    expect(rankTracks(rows, 'nightcall', undefined).map((t) => t.id)).toEqual(['x']);
  });
});

describe('trackCountLabel', () => {
  it('singularises', () => {
    expect(trackCountLabel(1)).toBe('1 track');
    expect(trackCountLabel(6)).toBe('6 tracks');
  });
});
