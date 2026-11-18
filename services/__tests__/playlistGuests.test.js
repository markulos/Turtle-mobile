import {
  GUESTS_KEY, MAX_PER_PLAYLIST, MAX_PLAYLISTS,
  addGuest, decodeGuests, encodeGuests, forgetGuest, guestIdsFor, guestNames,
  guestPlaylistsOf, removeGuest,
} from '../playlistGuests';

/**
 * Somebody else's track, on one of my playlists.
 *
 * Mark, 2026-11-18: "make it possible to add shared with me tracks to my
 * personal playlists". It could not be a tag write — `PUT /media/:id/tags`
 * ends `AND user_id IS ?`, so tagging a shared row changes nothing and
 * answers 404 — and it should not be: my filing has no business appearing in
 * somebody else's library.
 *
 * So this is a per-user map in a blob with no schema, which decides what is
 * worth testing: the caps (one column, rewritten whole), the case rules (a
 * playlist name is NOCASE everywhere else), and surviving junk (the key sits
 * beside every other setting in a store anything can write).
 */

const of = (obj) => decodeGuests(obj);

describe('decodeGuests', () => {
  test('reads the array shape it writes', () => {
    const g = of({ Sunday: ['m1', 'm2'], Chill: ['m3'] });
    expect(guestIdsFor(g, 'Sunday')).toEqual(['m1', 'm2']);
    expect(guestIdsFor(g, 'Chill')).toEqual(['m3']);
  });

  test('…and the object shape, so a later field cannot orphan what came before', () => {
    const g = of({ sunday: { name: 'Sunday', ids: ['m1'] } });
    expect(guestIdsFor(g, 'SUNDAY')).toEqual(['m1']);
    expect(guestNames(g)).toEqual(['Sunday']);
  });

  test('NAMES ARE CASE-INSENSITIVE, because they are everywhere else', () => {
    // COLLATE NOCASE on the server, and the picker's own search. Two keys here
    // would be a track that vanished from the playlist it was added to.
    const g = of({ Sunday: ['m1'] });
    expect(guestIdsFor(g, 'sunday')).toEqual(['m1']);
    expect(guestIdsFor(g, ' Sunday ')).toEqual(['m1']);
  });

  test('JUNK COSTS ITS OWN ROW AND NOTHING ELSE', () => {
    // The blob is shared with every other setting and editable through a
    // generic API. A throw here would blank the whole feature.
    const g = of({
      Good: ['m1'],
      '': ['m2'],
      Empty: [],
      NotAList: 'm3',
      Null: null,
      Nested: { nope: true },
      Numbers: [1, 2],
    });
    expect(guestIdsFor(g, 'Good')).toEqual(['m1']);
    expect(guestIdsFor(g, 'Numbers')).toEqual(['1', '2']);
    expect(guestNames(g).sort()).toEqual(['Good', 'Numbers']);
  });

  test('a missing or hostile blob is an empty map, not a throw', () => {
    for (const junk of [undefined, null, 'nope', 42, []]) {
      expect(decodeGuests(junk).size).toBe(0);
    }
  });

  test('duplicate ids collapse, and the caps hold', () => {
    expect(guestIdsFor(of({ A: ['m1', 'm1', 'm2'] }), 'A')).toEqual(['m1', 'm2']);
    const many = Array.from({ length: MAX_PER_PLAYLIST + 50 }, (_, i) => `m${i}`);
    expect(guestIdsFor(of({ A: many }), 'A')).toHaveLength(MAX_PER_PLAYLIST);
    const wide = {};
    for (let i = 0; i < MAX_PLAYLISTS + 10; i += 1) wide[`p${i}`] = ['m1'];
    expect(of(wide).size).toBe(MAX_PLAYLISTS);
  });
});

describe('round trip', () => {
  test('what is written reads back the same', () => {
    const g = of({ Sunday: ['m1', 'm2'] });
    expect(encodeGuests(g)).toEqual({ Sunday: ['m1', 'm2'] });
    expect(encodeGuests(of(encodeGuests(g)))).toEqual({ Sunday: ['m1', 'm2'] });
  });

  test('an emptied playlist is not written at all', () => {
    // A key with an empty array would accumulate forever in a capped blob and
    // would draw as a playlist with nothing in it.
    const { guests } = removeGuest(of({ Sunday: ['m1'] }), 'Sunday', 'm1');
    expect(encodeGuests(guests)).toEqual({});
  });

  test('the key is the one the settings blob is read with', () => {
    expect(GUESTS_KEY).toBe('musicPlaylistGuests');
  });
});

describe('addGuest', () => {
  test('adds, and reports that something changed', () => {
    const { guests, added } = addGuest(new Map(), 'Sunday', 'm1');
    expect(added).toBe(true);
    expect(guestIdsFor(guests, 'Sunday')).toEqual(['m1']);
  });

  test('a second add of the same track is a NO-OP, and says so', () => {
    // The caller skips the save on `added: false` — this is what stops a tap
    // on an already-ticked row rewriting the whole blob.
    const first = addGuest(new Map(), 'Sunday', 'm1');
    const second = addGuest(first.guests, 'Sunday', 'm1');
    expect(second.added).toBe(false);
    expect(second.guests).toBe(first.guests);
  });

  test('THE EXISTING NAME WINS — matching case-insensitively must not rename', () => {
    // The picker finds "Sunday" when you type "sunday". Taking the typed
    // spelling would quietly rename the playlist under its other tracks.
    const first = addGuest(new Map(), 'Sunday', 'm1');
    const { guests } = addGuest(first.guests, 'sunday', 'm2');
    expect(guestNames(guests)).toEqual(['Sunday']);
    expect(guestIdsFor(guests, 'Sunday')).toEqual(['m1', 'm2']);
  });

  test('a playlist that exists only as guests still has a name to draw', () => {
    // Adding a shared track to a brand-new playlist is the first thing
    // somebody will do, and there is no tagged row to name it.
    const { guests } = addGuest(new Map(), 'Road trip', 'm9');
    expect(guestNames(guests)).toEqual(['Road trip']);
  });

  test('IT REFUSES AT THE CAP rather than forgetting the first track', () => {
    // A playlist that quietly drops its oldest entry is worse than one that
    // says it is full — the caller turns `full` into a sentence.
    let guests = new Map();
    for (let i = 0; i < MAX_PER_PLAYLIST; i += 1) {
      ({ guests } = addGuest(guests, 'Big', `m${i}`));
    }
    const over = addGuest(guests, 'Big', 'one-more');
    expect(over.added).toBe(false);
    expect(over.full).toBe(true);
    expect(guestIdsFor(over.guests, 'Big')).toHaveLength(MAX_PER_PLAYLIST);
  });

  test('…and at the playlist count, while still letting the ones it has grow', () => {
    let guests = new Map();
    for (let i = 0; i < MAX_PLAYLISTS; i += 1) {
      ({ guests } = addGuest(guests, `p${i}`, 'm1'));
    }
    expect(addGuest(guests, 'one-more-list', 'm1').full).toBe(true);
    expect(addGuest(guests, 'p0', 'm2').added).toBe(true);
  });

  test('nothing to add is not a change', () => {
    for (const [name, id] of [['', 'm1'], ['A', ''], [null, null], ['   ', 'm1']]) {
      expect(addGuest(new Map(), name, id).added).toBe(false);
    }
  });
});

describe('removeGuest', () => {
  test('removes one, keeps the rest', () => {
    const { guests } = removeGuest(of({ Sunday: ['m1', 'm2'] }), 'Sunday', 'm1');
    expect(guestIdsFor(guests, 'Sunday')).toEqual(['m2']);
  });

  test('…and drops the playlist when that was the last of it', () => {
    const { guests, removed } = removeGuest(of({ Sunday: ['m1'] }), 'sunday', 'm1');
    expect(removed).toBe(true);
    expect(guests.size).toBe(0);
  });

  test('removing what is not there changes nothing', () => {
    const before = of({ Sunday: ['m1'] });
    const after = removeGuest(before, 'Sunday', 'nope');
    expect(after.removed).toBe(false);
    expect(after.guests).toBe(before);
    expect(removeGuest(before, 'Missing', 'm1').removed).toBe(false);
  });
});

describe('guestPlaylistsOf', () => {
  test('every playlist one shared track is on — the picker’s ticks', () => {
    const g = of({ Sunday: ['m1', 'm2'], Chill: ['m2'], Focus: ['m3'] });
    expect(guestPlaylistsOf(g, 'm2')).toEqual(['Chill', 'Sunday']);
    expect(guestPlaylistsOf(g, 'm3')).toEqual(['Focus']);
    expect(guestPlaylistsOf(g, 'nobody')).toEqual([]);
    expect(guestPlaylistsOf(g, null)).toEqual([]);
  });

  test('it reports the DISPLAY name, which is what the ticks match on', () => {
    const g = of({ sunday: { name: 'Sunday', ids: ['m1'] } });
    expect(guestPlaylistsOf(g, 'm1')).toEqual(['Sunday']);
  });
});

describe('forgetGuest', () => {
  test('a share that was revoked leaves no dead ids behind', () => {
    // The id can never resolve again, and this blob is capped.
    const g = of({ Sunday: ['m1', 'm2'], Chill: ['m1'] });
    const { guests, removed } = forgetGuest(g, 'm1');
    expect(removed).toBe(true);
    expect(guestIdsFor(guests, 'Sunday')).toEqual(['m2']);
    expect(guests.has('chill')).toBe(false);
  });

  test('a track that was never a guest is not a change', () => {
    const g = of({ Sunday: ['m1'] });
    const after = forgetGuest(g, 'm9');
    expect(after.removed).toBe(false);
    expect(after.guests).toBe(g);
  });
});
