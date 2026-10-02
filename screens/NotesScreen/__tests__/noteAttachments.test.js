// The NOTE-specific half of the attachment rules: what a timeline row shows for
// its files, and how the bulk resolver decides what to ask for. The rules shared
// with the friends thread are in utils/__tests__/mediaAttachments.test.js.
import {
  collectMediaIds,
  fileCountLabel,
  missingLabel,
  rowThumb,
} from '../attachments';

const ORIGIN = 'http://pond.local';

describe('missingLabel', () => {
  it('says nothing when every id came back', () => {
    expect(missingLabel({ asked: 3, got: 3, failed: false })).toBeNull();
  });

  it('accounts for ids whose media was deleted', () => {
    expect(missingLabel({ asked: 3, got: 1, failed: false })).toBe('2 no longer in the vault.');
  });

  it('distinguishes a failed fetch from deleted files', () => {
    // Everything missing because the request died is not "deleted from the
    // vault" — saying so would be a lie the user can act on wrongly.
    expect(missingLabel({ asked: 3, got: 0, failed: true })).toBe('Could not load these right now.');
  });
});

describe('fileCountLabel', () => {
  it('singularises', () => {
    expect(fileCountLabel(1)).toBe('1 file');
    expect(fileCountLabel(4)).toBe('4 files');
  });
});

describe('collectMediaIds', () => {
  const notes = [
    { id: 'n1', mediaIds: ['a', 'b'] },
    { id: 'n2', mediaIds: [] },
    { id: 'n3', mediaIds: ['b', 'c'] },
  ];

  it('gathers every id once, in note order', () => {
    // Top-of-list ids come first so they land in the first batch.
    expect(collectMediaIds(notes, new Set())).toEqual(['a', 'b', 'c']);
  });

  it('skips ids already asked about', () => {
    expect(collectMediaIds(notes, new Set(['a', 'b']))).toEqual(['c']);
  });

  it('asks for nothing when a refresh brings back the same notes', () => {
    expect(collectMediaIds(notes, new Set(['a', 'b', 'c']))).toEqual([]);
  });

  it('is safe on notes with no mediaIds field at all (an older pond)', () => {
    expect(collectMediaIds([{ id: 'n1' }, null], new Set())).toEqual([]);
    expect(collectMediaIds(null, new Set())).toEqual([]);
  });
});

describe('rowThumb', () => {
  const resolved = new Map([
    ['doc', { id: 'doc', type: 'document', thumbnailUrl: null }],
    ['pic', { id: 'pic', type: 'image', thumbnailLgUrl: '/t/pic-lg.webp' }],
    ['pic2', { id: 'pic2', type: 'image', thumbnailLgUrl: '/t/pic2-lg.webp' }],
  ]);

  it('is null for a note carrying nothing', () => {
    expect(rowThumb(ORIGIN, { mediaIds: [] }, resolved)).toBeNull();
    expect(rowThumb(ORIGIN, {}, resolved)).toBeNull();
  });

  it('shows the first IMAGE, not the first attachment', () => {
    // A note whose first file is a PDF is still recognised by its screenshot.
    const t = rowThumb(ORIGIN, { mediaIds: ['doc', 'pic', 'pic2'] }, resolved);
    expect(t).toEqual({ uri: `${ORIGIN}/t/pic-lg.webp`, count: 3 });
  });

  it('counts every file, not just the pictures', () => {
    expect(rowThumb(ORIGIN, { mediaIds: ['pic', 'doc'] }, resolved).count).toBe(2);
  });

  it('still reports the count with no picture to show', () => {
    // Two cases, same answer: nothing has resolved yet, and nothing viewable
    // ever will. The row draws its frame + badge from the count either way.
    expect(rowThumb(ORIGIN, { mediaIds: ['doc'] }, resolved)).toEqual({ uri: null, count: 1 });
    expect(rowThumb(ORIGIN, { mediaIds: ['unknown'] }, resolved)).toEqual({ uri: null, count: 1 });
    expect(rowThumb(ORIGIN, { mediaIds: ['pic'] }, new Map())).toEqual({ uri: null, count: 1 });
  });
});
