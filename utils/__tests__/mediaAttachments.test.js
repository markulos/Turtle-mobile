// The pure rules behind any strip of vault media — a note's files, a message's
// photos. No rendering, no native graph.
//
// Kept in lockstep with the web app's mediaAttachments.test.ts: the two surfaces
// read the same rows from the same endpoint and must not disagree about what
// counts as an image or where its bytes live.
import {
  chunkIds,
  isImage,
  mediaUrl,
  splitAttachments,
  stripThumbUrl,
  viewerImageUrl,
  viewerImages,
} from '../mediaAttachments';

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

describe('chunkIds', () => {
  it('splits a want-list into requests the server will accept', () => {
    expect(chunkIds(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('leaves a list inside the cap as one request', () => {
    expect(chunkIds(['a', 'b'], 200)).toEqual([['a', 'b']]);
    expect(chunkIds([], 200)).toEqual([]);
  });
});
