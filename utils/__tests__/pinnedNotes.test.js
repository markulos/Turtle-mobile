/**
 * Pinned notes: held at the top of the Notes tab, remembered on the device and
 * mirrored to the pond.
 *
 * Three things are worth pinning here:
 *  - The ORDER. A pin lifts a note and moves nothing else. Get this wrong and
 *    pinning one note quietly reshuffles the timeline around it.
 *  - The PRECEDENCE. A pin is written locally first and the pond is told
 *    behind it, so the pond's own answer landing a moment later must not undo
 *    it — the same race avatarChoice.test.js pins, and it would look like the
 *    app forgetting what you just did.
 *  - That nothing is PRUNED. The notes list is paged, so an id that matches
 *    nothing loaded is a note further down the library, not a note that is
 *    gone.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SETTINGS_KEY,
  adoptServerPinnedNotes,
  isNotePinned,
  normalizePinnedIds,
  pinnedNoteIds,
  pinnedNotesKnown,
  sortPinnedFirst,
  subscribePinnedNotes,
  toggleNotePin,
  togglePinnedIds,
  unpinNote,
  __resetPinnedNotes,
} from '../pinnedNotes';

const STORAGE_KEY = 'notes:pinned';

const note = (id, over = {}) => ({ id, content: `note ${id}`, ...over });

beforeEach(async () => {
  __resetPinnedNotes();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('what a pin does to the list', () => {
  const list = [note('a'), note('b'), note('c'), note('d')];

  test('lifts the pinned note and moves nothing else', () => {
    expect(sortPinnedFirst(list, ['c']).map((n) => n.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  test('keeps the list\'s own order among the pinned ones', () => {
    // NOT the order they were pinned in: 'd' was pinned first and still sits
    // below 'b', because the timeline is what decides between two pinned notes.
    expect(sortPinnedFirst(list, ['d', 'b']).map((n) => n.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  test('a pin on a note that is not loaded changes nothing', () => {
    // The list is paged; an id from page three is not an error.
    expect(sortPinnedFirst(list, ['zz'])).toBe(list);
  });

  test('hands back the SAME array when nothing on it is pinned', () => {
    // Identity matters: a new array every render would re-render the whole list.
    expect(sortPinnedFirst(list, [])).toBe(list);
    expect(sortPinnedFirst(list, new Set())).toBe(list);
  });

  test('takes a Set as readily as a list, and survives an empty one', () => {
    expect(sortPinnedFirst(list, new Set(['b'])).map((n) => n.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(sortPinnedFirst([], ['a'])).toEqual([]);
  });
});

describe('the ids themselves', () => {
  test('are cleaned: strings, trimmed, no blanks, no duplicates', () => {
    expect(normalizePinnedIds(['a', 'a', ' b ', '', null, 7, {}])).toEqual(['a', 'b', '7']);
    expect(normalizePinnedIds('nope')).toEqual([]);
    expect(normalizePinnedIds(undefined)).toEqual([]);
  });

  test('toggle puts the newest pin first, and takes one back off', () => {
    expect(togglePinnedIds(['a'], 'b')).toEqual(['b', 'a']);
    expect(togglePinnedIds(['b', 'a'], 'b')).toEqual(['a']);
  });
});

describe('pinning a note', () => {
  test('is readable immediately, without awaiting storage', async () => {
    const save = toggleNotePin('n1');
    // SYNCHRONOUS: the list reads this on the render that follows the press.
    expect(isNotePinned('n1')).toBe(true);
    await save;
    expect(JSON.parse(await AsyncStorage.getItem(STORAGE_KEY))).toEqual(['n1']);
  });

  test('pressing it again unpins it', async () => {
    await toggleNotePin('n1');
    await toggleNotePin('n1');
    expect(isNotePinned('n1')).toBe(false);
    expect(pinnedNoteIds()).toEqual([]);
  });

  test('subscribers hear about it, so the list and the row agree at once', async () => {
    const heard = [];
    const off = subscribePinnedNotes(() => heard.push(pinnedNoteIds().join(',')));
    await toggleNotePin('n1');
    await toggleNotePin('n2');
    off();
    await toggleNotePin('n3');
    expect(heard).toEqual(['n1', 'n2,n1']);
  });

  test('is mirrored to the pond, as the WHOLE list', async () => {
    const api = { patch: jest.fn().mockResolvedValue({ success: true }) };
    await toggleNotePin('n1', api);
    await toggleNotePin('n2', api);
    // PATCH /me/settings merges at the top level, so a partial array here
    // would BE the new list rather than a patch of it.
    expect(api.patch).toHaveBeenLastCalledWith('/me/settings', { [SETTINGS_KEY]: ['n2', 'n1'] });
  });

  test('a pond that refuses the write does not lose the pin', async () => {
    const api = { patch: jest.fn().mockRejectedValue(new Error('offline')) };
    await toggleNotePin('n1', api);
    expect(isNotePinned('n1')).toBe(true);
    expect(JSON.parse(await AsyncStorage.getItem(STORAGE_KEY))).toEqual(['n1']);
  });

  test('a deleted note drops its pin without toggling one on', async () => {
    await toggleNotePin('n1');
    await unpinNote('n1');
    expect(pinnedNoteIds()).toEqual([]);
    // And unpinning something that was never pinned is not a pin.
    await unpinNote('n9');
    expect(pinnedNoteIds()).toEqual([]);
  });
});

describe('the pond\'s copy', () => {
  test('fills a gap on a device that has never pinned anything', () => {
    expect(pinnedNotesKnown()).toBe(false);
    adoptServerPinnedNotes({ [SETTINGS_KEY]: ['x', 'y'] });
    expect(pinnedNoteIds()).toEqual(['x', 'y']);
    expect(pinnedNotesKnown()).toBe(true);
  });

  test('never overwrites what this device already decided', async () => {
    await toggleNotePin('mine');
    // The answer to a /me that was already in flight when the pin was made.
    adoptServerPinnedNotes({ [SETTINGS_KEY]: ['stale'] });
    expect(pinnedNoteIds()).toEqual(['mine']);
  });

  test('is ignored when it has nothing to say', () => {
    adoptServerPinnedNotes(null);
    adoptServerPinnedNotes({});
    adoptServerPinnedNotes({ [SETTINGS_KEY]: [] });
    adoptServerPinnedNotes({ [SETTINGS_KEY]: 'not a list' });
    expect(pinnedNoteIds()).toEqual([]);
    // Still a gap, so a real answer later can still fill it.
    expect(pinnedNotesKnown()).toBe(false);
  });
});
