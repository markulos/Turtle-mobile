/**
 * Which link in a message gets the card, how the text is split to draw them,
 * and what the card is told about the page.
 *
 * The splitting half is the part worth pinning: the segments are concatenated
 * back together by the renderer, so a matcher that eats a character changes
 * what someone said.
 */
import {
  firstLinkUrl,
  hostOf,
  isFreshEntry,
  linkSegments,
  NEGATIVE_TTL_MS,
  normalizeUrl,
  previewFromFlat,
  previewFromRow,
} from '../messageLinks';

/** Every segment's text, run back together — must equal the input exactly. */
const rejoin = (text) => linkSegments(text).map((s) => s.text).join('');

describe('linkSegments', () => {
  it('splits prose from a link and keeps the text intact', () => {
    const text = 'read https://example.com/story now';
    expect(linkSegments(text)).toEqual([
      { text: 'read ', url: null },
      { text: 'https://example.com/story', url: 'https://example.com/story' },
      { text: ' now', url: null },
    ]);
    expect(rejoin(text)).toBe(text);
  });

  it('leaves a full stop with the sentence, not the address', () => {
    const text = 'see https://example.com/page.';
    const segs = linkSegments(text);
    expect(segs[1]).toEqual({ text: 'https://example.com/page', url: 'https://example.com/page' });
    expect(segs[2]).toEqual({ text: '.', url: null });
    expect(rejoin(text)).toBe(text);
  });

  it('gives a scheme-less www. link one to open, without rewriting the text', () => {
    expect(linkSegments('www.example.com/x')).toEqual([
      { text: 'www.example.com/x', url: 'https://www.example.com/x' },
    ]);
  });

  it('handles several links in one message', () => {
    const text = 'https://one.com then https://two.com and that is all';
    const segs = linkSegments(text);
    expect(segs.filter((s) => s.url).map((s) => s.url)).toEqual(['https://one.com', 'https://two.com']);
    expect(rejoin(text)).toBe(text);
  });

  it('keeps its own state out of the next message (no shared lastIndex)', () => {
    // A module-level global regex would make the SECOND call wrong, not the
    // first — which is exactly the bug this guards.
    const text = 'https://a.com';
    expect(linkSegments(text)).toEqual(linkSegments(text));
  });

  it('leaves prose alone', () => {
    expect(linkSegments('no links here')).toEqual([{ text: 'no links here', url: null }]);
  });

  it('is not fooled by a bare domain mid-sentence', () => {
    expect(linkSegments('that was a big deal.com for us').every((s) => !s.url)).toBe(true);
  });

  it('leaves a local computer path as prose — it is not a web page', () => {
    expect(linkSegments('it lives in C:\\turtle\\mobile-release').every((s) => !s.url)).toBe(true);
  });

  it('survives an empty or missing body', () => {
    expect(linkSegments('')).toEqual([]);
    expect(linkSegments(null)).toEqual([]);
    expect(linkSegments(undefined)).toEqual([]);
  });

  it('keeps multi-line text, and its newlines, exactly', () => {
    const text = 'look:\nhttps://example.com/a\nand that is it';
    expect(rejoin(text)).toBe(text);
  });
});

describe('firstLinkUrl', () => {
  it('takes only the FIRST — a list of links is not a wall of cards', () => {
    expect(firstLinkUrl('https://one.com and https://two.com')).toBe('https://one.com');
  });
  it('is null when there is none', () => {
    expect(firstLinkUrl('just words')).toBeNull();
    expect(firstLinkUrl('')).toBeNull();
  });
});

describe('normalizeUrl', () => {
  it('leaves an http(s) address alone and gives everything else https', () => {
    expect(normalizeUrl('http://x.com')).toBe('http://x.com');
    expect(normalizeUrl('https://x.com')).toBe('https://x.com');
    expect(normalizeUrl('www.x.com')).toBe('https://www.x.com');
  });
});

describe('hostOf', () => {
  it('strips www., the port and any credentials', () => {
    expect(hostOf('https://www.example.com/a')).toBe('example.com');
    expect(hostOf('http://example.com:8080/a')).toBe('example.com');
    expect(hostOf('https://user:pw@example.com/a')).toBe('example.com');
  });
  it('is blank for anything unparseable rather than throwing', () => {
    expect(hostOf('not a url')).toBe('');
    expect(hostOf(null)).toBe('');
  });
});

describe('previewFromRow', () => {
  const url = 'https://www.example.com/story';

  it('reads the snake_case row the cache-only GET returns', () => {
    expect(previewFromRow(url, {
      status: 'ok',
      title: 'A story',
      description: 'What happened',
      thumb_url: '/api/media/thumbnails/linkthumb-abc.jpg',
      site_name: 'Example',
      media_type: 'link',
    })).toEqual({
      url,
      host: 'example.com',
      title: 'A story',
      description: 'What happened',
      thumbUrl: '/api/media/thumbnails/linkthumb-abc.jpg',
      mediaType: 'link',
    });
  });

  it('refuses a pending row, so the caller goes on to unfurl', () => {
    expect(previewFromRow(url, { status: 'pending' })).toBeNull();
  });

  it('refuses a recorded error — those are worth retrying', () => {
    expect(previewFromRow(url, { status: 'error', title: 'stale' })).toBeNull();
  });

  it('refuses a row carrying nothing but the hostname', () => {
    expect(previewFromRow(url, { status: 'ok', title: 'example.com' })).toBeNull();
  });

  it('shows a title-less row as long as it brought a thumbnail', () => {
    const p = previewFromRow(url, { status: 'ok', thumb_url: '/api/media/thumbnails/x.jpg' });
    expect(p.thumbUrl).toBe('/api/media/thumbnails/x.jpg');
    expect(p.title).toBe('example.com');
  });

  it('marks a video so the card can show a play badge', () => {
    expect(previewFromRow(url, { status: 'ok', title: 'A clip', media_type: 'video' }).mediaType)
      .toBe('video');
  });

  it('is null for a missing row', () => {
    expect(previewFromRow(url, null)).toBeNull();
    expect(previewFromRow(url, undefined)).toBeNull();
  });
});

describe('previewFromFlat', () => {
  const url = 'https://example.com/clip';

  it('reads the camelCase shape the unfurling POST returns', () => {
    expect(previewFromFlat(url, {
      host: 'example.com',
      title: 'A clip',
      description: 'Moving pictures',
      thumbUrl: '/api/media/thumbnails/clip.jpg',
      mediaType: 'video',
    })).toEqual({
      url,
      host: 'example.com',
      title: 'A clip',
      description: 'Moving pictures',
      thumbUrl: '/api/media/thumbnails/clip.jpg',
      mediaType: 'video',
    });
  });

  it('treats a null preview as "no card", a normal outcome', () => {
    expect(previewFromFlat(url, null)).toBeNull();
  });

  it('falls back to the site name, then the host, for a title', () => {
    expect(previewFromFlat(url, { siteName: 'Example', description: 'x' }).title).toBe('Example');
    expect(previewFromFlat(url, { description: 'x' }).title).toBe('example.com');
  });
});

describe('isFreshEntry', () => {
  const preview = {
    url: 'https://example.com', host: 'example.com', title: 'T',
    description: '', thumbUrl: null, mediaType: 'link',
  };

  it('has nothing to say about a URL never asked about', () => {
    expect(isFreshEntry(undefined, 1000)).toBe(false);
  });

  it('keeps a success for the whole session', () => {
    expect(isFreshEntry({ preview, at: 0 }, 10 * NEGATIVE_TTL_MS)).toBe(true);
  });

  it('keeps a failure only for the TTL, so a transient one heals', () => {
    expect(isFreshEntry({ preview: null, at: 1000 }, 1000 + NEGATIVE_TTL_MS - 1)).toBe(true);
    expect(isFreshEntry({ preview: null, at: 1000 }, 1000 + NEGATIVE_TTL_MS)).toBe(false);
  });
});
