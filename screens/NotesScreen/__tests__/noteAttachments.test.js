// The pure rules behind a note's attachment strip — no rendering, no native
// graph. Kept in lockstep with the web app's NoteAttachments.test.ts: the two
// surfaces read the same rows from the same endpoint and must not disagree
// about what counts as an image or where its bytes live.
import {
  chunkIds,
  collectMediaIds,
  fileCountLabel,
  isImage,
  mediaUrl,
  missingLabel,
  rowThumb,
  splitAttachments,
  stripThumbUrl,
  viewerImageUrl,
  viewerImages,
} from '../attachments';

const ORIGIN = 'http://pond.local';

describe('isImage', () => {
  it('trusts the server type first', () => {
    expect(isImage({ type: 'image', mimeType: null })).toBe(true);
    // A typed row wins over the mime — a video with an image/* mime is a video.
    expect(isImage({ type: 'video', mimeType: 'image/jpeg' })).toBe(false);
  });

  it('falls back to the mime for an untyped row', () => {
    expect(isImage({ type: null, mimeType: 'image/png' })).toBe(true);
    expect(isImage({ type: null, mimeType: 'application/pdf' })).toBe(false);
    expect(isImage({ type: null, mimeType: null })).toBe(false);
  });

  it('is safe on nothing at all', () => {
    expect(isImage(null)).toBe(false);
    expect(isImage(undefined)).toBe(false);
  });
});

describe('splitAttachments', () => {
  const img = { id: '1', type: 'image', thumbnailLgUrl: '/api/t/1-lg.webp', thumbnailUrl: '/api/t/1.webp' };
  const doc = { id: '2', type: 'document', mimeType: 'application/pdf', name: 'spec.pdf' };
  const thumbless = { id: '3', type: 'image', thumbnailLgUrl: null, thumbnailUrl: null, name: 'broken.jpg' };

  it('puts viewable images in one row and everything else in the other', () => {
    const { images, others } = splitAttachments([img, doc]);
    expect(images.map((m) => m.id)).toEqual(['1']);
    expect(others.map((m) => m.id)).toEqual(['2']);
  });

  it('demotes an image with no thumbnail to the chip row', () => {
    // Nothing to render inline, but the filename still says what it is.
    const { images, others } = splitAttachments([thumbless]);
    expect(images).toEqual([]);
    expect(others.map((m) => m.id)).toEqual(['3']);
  });

  it('keeps the order it was given', () => {
    const { images } = splitAttachments([img, doc, { ...img, id: '9' }]);
    expect(images.map((m) => m.id)).toEqual(['1', '9']);
  });

  it('handles a null result set', () => {
    expect(splitAttachments(null)).toEqual({ images: [], others: [] });
  });
});

describe('url building', () => {
  it('resolves a server-relative path against the media origin', () => {
    expect(mediaUrl(ORIGIN, '/api/media/thumbnails/1.webp')).toBe(`${ORIGIN}/api/media/thumbnails/1.webp`);
  });

  it('leaves an already-absolute url alone', () => {
    expect(mediaUrl(ORIGIN, 'https://cdn.example/x.jpg')).toBe('https://cdn.example/x.jpg');
  });

  it('is null for a missing path', () => {
    expect(mediaUrl(ORIGIN, null)).toBeNull();
    expect(mediaUrl(ORIGIN, '')).toBeNull();
  });

  it('prefers the large thumbnail in the strip, falling back to the small one', () => {
    expect(stripThumbUrl(ORIGIN, { thumbnailLgUrl: '/a-lg.webp', thumbnailUrl: '/a.webp' }))
      .toBe(`${ORIGIN}/a-lg.webp`);
    expect(stripThumbUrl(ORIGIN, { thumbnailLgUrl: null, thumbnailUrl: '/a.webp' }))
      .toBe(`${ORIGIN}/a.webp`);
  });

  it('addresses the viewer image by id, not by a gallery row', () => {
    // This is the whole no-vault property: a note holds an id and the display
    // tier is reachable from the id alone.
    expect(viewerImageUrl(ORIGIN, { id: 'abc 1' })).toBe(`${ORIGIN}/api/media/display/abc%201`);
    expect(viewerImageUrl(ORIGIN, {})).toBeNull();
  });
});

describe('viewerImages', () => {
  it('carries the thumbnail along as the placeholder and fallback', () => {
    const list = viewerImages(ORIGIN, [
      { id: '7', name: 'shot.png', thumbnailLgUrl: '/t/7-lg.webp', thumbnailUrl: '/t/7.webp' },
    ]);
    expect(list).toEqual([{
      key: '7',
      uri: `${ORIGIN}/api/media/display/7`,
      previewUri: `${ORIGIN}/t/7-lg.webp`,
      name: 'shot.png',
    }]);
  });

  it('indexes in strip order so a tap maps straight onto it', () => {
    const list = viewerImages(ORIGIN, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(list.map((i) => i.key)).toEqual(['a', 'b', 'c']);
  });
});

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

describe('chunkIds', () => {
  it('splits a want-list into requests the server will accept', () => {
    expect(chunkIds(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('leaves a list inside the cap as one request', () => {
    expect(chunkIds(['a', 'b'], 200)).toEqual([['a', 'b']]);
    expect(chunkIds([], 200)).toEqual([]);
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
