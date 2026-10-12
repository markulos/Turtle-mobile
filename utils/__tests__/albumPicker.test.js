/**
 * Filing a photo into an album.
 *
 * The thing to keep straight, and the reason this module exists: on this pond
 * an album IS a registered tag — the tag routes auto-register every new tag
 * into the albums table, and a photo is in an album by carrying its name. So
 * these functions have to agree with the SERVER's idea of sameness, which is
 * case-insensitive (`GROUP BY tag COLLATE NOCASE`). Offer "new album
 * 'wedding'" to someone who already has "Wedding" and you have made a row
 * that silently merges into theirs.
 */
import {
  MAX_ALBUM_NAME,
  albumExists,
  albumSuggestions,
  cleanAlbumName,
  commonAlbums,
  isNewAlbumName,
  tagsToAdd,
} from '../albumPicker';

const ALBUMS = [
  { name: 'Wedding', count: 42 },
  { name: 'Trip — Rome 2024', count: 7 },
  { name: 'Kitchen', count: 0 },
];

describe('the name that actually gets written', () => {
  it('is trimmed, collapsed and capped', () => {
    expect(cleanAlbumName('  Summer   2024 ')).toBe('Summer 2024');
    expect(cleanAlbumName('x'.repeat(200))).toHaveLength(MAX_ALBUM_NAME);
    expect(cleanAlbumName(null)).toBe('');
  });
});

describe('whether to offer a NEW album', () => {
  it('offers one for a name nobody has', () => {
    expect(isNewAlbumName(ALBUMS, 'Garden')).toBe(true);
  });

  it('does NOT offer one that only differs by case or spacing', () => {
    // The server would merge it into the existing album, so offering it is a
    // promise the pond will not keep.
    expect(isNewAlbumName(ALBUMS, 'wedding')).toBe(false);
    expect(isNewAlbumName(ALBUMS, '  WEDDING  ')).toBe(false);
    expect(albumExists(ALBUMS, 'kitchen')).toBe(true);
  });

  it('offers nothing for an empty field', () => {
    // A "New album ''" row is a button that cannot work.
    expect(isNewAlbumName(ALBUMS, '')).toBe(false);
    expect(isNewAlbumName(ALBUMS, '   ')).toBe(false);
  });
});

describe('what the sheet lists', () => {
  it('is everything, busiest first, when nothing is typed', () => {
    expect(albumSuggestions(ALBUMS, '').map((a) => a.name))
      .toEqual(['Wedding', 'Trip — Rome 2024', 'Kitchen']);
  });

  it('matches anywhere in the name, not just the start', () => {
    // People name albums "Trip — Rome 2024" and then look for "rome".
    expect(albumSuggestions(ALBUMS, 'rome').map((a) => a.name)).toEqual(['Trip — Rome 2024']);
  });

  it('is case-insensitive, like the pond', () => {
    expect(albumSuggestions(ALBUMS, 'WEDD').map((a) => a.name)).toEqual(['Wedding']);
  });

  it('breaks ties by name, so the order never wobbles', () => {
    const tied = [{ name: 'Zebra', count: 3 }, { name: 'Apple', count: 3 }];
    expect(albumSuggestions(tied, '').map((a) => a.name)).toEqual(['Apple', 'Zebra']);
  });

  it('survives a ragged list', () => {
    expect(albumSuggestions([null, { name: '  ' }, { name: 'Real' }], '').map((a) => a.name))
      .toEqual(['Real']);
    expect(albumSuggestions(null, 'x')).toEqual([]);
  });
});

describe('what a filing writes', () => {
  it('is the one name, when the photo is not in it', () => {
    expect(tagsToAdd('Garden', ['Wedding'])).toEqual(['Garden']);
  });

  it('is NOTHING when it is already in there', () => {
    // No write, so no cache on the pond is invalidated for a change that is
    // not a change — and the sheet can just close.
    expect(tagsToAdd('Wedding', ['Wedding'])).toEqual([]);
    expect(tagsToAdd('wedding', ['Wedding'])).toEqual([]);
  });

  it('is nothing for a blank name', () => {
    expect(tagsToAdd('   ', [])).toEqual([]);
  });
});

describe('which albums a selection is ALREADY in', () => {
  const tagsOf = (it) => it.tags;

  it('is the names every one of them carries', () => {
    const items = [
      { id: 'a', tags: ['Wedding', 'Kitchen'] },
      { id: 'b', tags: ['Wedding'] },
    ];
    // Kitchen is only on one, so "add to Kitchen" is still worth offering.
    expect(commonAlbums(items, tagsOf)).toEqual(['Wedding']);
  });

  it('is empty for nothing, or for photos with nothing in common', () => {
    expect(commonAlbums([], tagsOf)).toEqual([]);
    expect(commonAlbums([{ id: 'a', tags: ['X'] }, { id: 'b', tags: ['Y'] }], tagsOf)).toEqual([]);
  });

  it('tolerates a photo with no tags at all', () => {
    expect(commonAlbums([{ id: 'a' }], tagsOf)).toEqual([]);
  });
});
