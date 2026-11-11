import {
  LIBRARY_SCOPE,
  WEB_SCOPE,
  enqueueWebDownload,
  isWebRowId,
  pondMessage,
  searchWebMusic,
  shouldSearchWeb,
  webPreviewRow,
  webResultMeta,
  webRowId,
  webSearchStatus,
} from '../webMusicSearch';
import { mapMediaRowToTrack, sourceOf, titleOf } from '../musicTrackMapper';

const RESULT = {
  videoId: 'MV_3Dpw-BRY',
  title: 'Kavinsky - Nightcall',
  channel: 'Record Makers',
  duration: 257,
  durationLabel: '4:17',
  thumbnail: 'https://i.ytimg.com/vi/MV_3Dpw-BRY/mqdefault.jpg',
  url: 'https://www.youtube.com/watch?v=MV_3Dpw-BRY',
  previewUrl: '/api/music/web/preview/MV_3Dpw-BRY?token=abc.def',
};

describe('when the web is worth asking', () => {
  test('one character is not a search, two are', () => {
    expect(shouldSearchWeb('')).toBe(false);
    expect(shouldSearchWeb('  ')).toBe(false);
    expect(shouldSearchWeb('a')).toBe(false);
    expect(shouldSearchWeb(' a ')).toBe(false);
    expect(shouldSearchWeb('ab')).toBe(true);
    expect(shouldSearchWeb(null)).toBe(false);
  });

  test('the two scopes are distinct values', () => {
    expect(LIBRARY_SCOPE).not.toBe(WEB_SCOPE);
  });
});

describe('a web result as a row', () => {
  test('is dressed as the media row it would be if it were downloaded', () => {
    const row = webPreviewRow(RESULT, 'http://pond.local');
    // The pond proxies it — never YouTube directly, because a resolved
    // googlevideo URL is bound to the IP that asked for it.
    expect(row.rawUrl).toBe('http://pond.local/api/music/web/preview/MV_3Dpw-BRY?token=abc.def');
    expect(row.id).toBe('yt:MV_3Dpw-BRY');
    expect(row.duration).toBe(257);
  });

  test('a trailing slash on the base does not double up', () => {
    expect(webPreviewRow(RESULT, 'http://pond.local/').rawUrl)
      .toBe('http://pond.local/api/music/web/preview/MV_3Dpw-BRY?token=abc.def');
  });

  test('is null when there is nothing playable to build from', () => {
    expect(webPreviewRow(RESULT, '')).toBeNull();
    expect(webPreviewRow({ ...RESULT, previewUrl: undefined }, 'http://pond.local')).toBeNull();
    expect(webPreviewRow({ ...RESULT, videoId: undefined }, 'http://pond.local')).toBeNull();
    expect(webPreviewRow(null, 'http://pond.local')).toBeNull();
  });

  /**
   * The point of dressing a result as a media row: the player's existing
   * mapper has to accept it with no changes of its own. If this breaks, a
   * preview silently fails to queue.
   */
  test('the player\'s own mapper turns it into a playable queue item', () => {
    const row = webPreviewRow(RESULT, 'http://pond.local');
    const item = mapMediaRowToTrack(row, 'http://pond.local/api');
    expect(item).toMatchObject({
      mediaId: 'yt:MV_3Dpw-BRY',
      url: 'http://pond.local/api/music/web/preview/MV_3Dpw-BRY?token=abc.def',
      title: 'Kavinsky - Nightcall',
      duration: 257,
    });
    // The artist line comes off the watch URL, so a preview reads as YouTube.
    expect(item.artist).toBe('youtube.com');
    expect(item.artworkUrl).toBe(RESULT.thumbnail);
  });

  test('the title survives the mapper\'s extension stripping', () => {
    const row = webPreviewRow(RESULT, 'http://pond.local');
    expect(titleOf(row)).toBe('Kavinsky - Nightcall');
    expect(sourceOf(row)).toBe('youtube.com');
  });

  test('a web id is recognisable as one', () => {
    expect(isWebRowId(webRowId('MV_3Dpw-BRY'))).toBe(true);
    expect(isWebRowId('178')).toBe(false);
    expect(isWebRowId(undefined)).toBe(false);
  });

  test('the meta line is the uploader and the length', () => {
    expect(webResultMeta(RESULT)).toBe('Record Makers · 4:17');
    expect(webResultMeta({ channel: 'Someone' })).toBe('Someone');
    expect(webResultMeta({ durationLabel: '4:17' })).toBe('4:17');
    // Never blank: the row would lose a line and jump a few pixels taller.
    expect(webResultMeta({})).toBe('YouTube');
  });
});

describe('searching', () => {
  test('asks the pond, encoded, and hands back the rows', async () => {
    const api = { get: jest.fn(() => Promise.resolve({ success: true, query: 'nightcall', results: [RESULT] })) };
    const out = await searchWebMusic(api, '  nightcall & drive  ');
    expect(api.get).toHaveBeenCalledWith(
      '/api/music/web/search?q=nightcall%20%26%20drive&limit=15',
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(out.results).toEqual([RESULT]);
  });

  test('a search timeout longer than the pond\'s own would turn slow into broken', async () => {
    const api = { get: jest.fn(() => Promise.resolve({ results: [] })) };
    await searchWebMusic(api, 'x');
    // The pond gives up at 30s; the client must not give up first.
    expect(api.get.mock.calls[0][1].timeoutMs).toBeGreaterThan(30_000);
  });

  test('an empty query never leaves the phone', async () => {
    const api = { get: jest.fn() };
    expect(await searchWebMusic(api, '   ')).toEqual({ query: '', results: [] });
    expect(api.get).not.toHaveBeenCalled();
  });

  test('a reply with no results array is an empty list, not a crash', async () => {
    const api = { get: jest.fn(() => Promise.resolve({ success: true })) };
    expect((await searchWebMusic(api, 'x')).results).toEqual([]);
  });
});

describe('downloading', () => {
  test('sends the watch URL to the queue that already takes shared links', async () => {
    const api = { post: jest.fn(() => Promise.resolve({ success: true, id: 'job_1' })) };
    await enqueueWebDownload(api, RESULT);
    expect(api.post).toHaveBeenCalledWith('/api/downloads', {
      url: 'https://www.youtube.com/watch?v=MV_3Dpw-BRY',
      // The whole of "as audio" from the caller's side.
      outputKind: 'audio',
    });
  });

  test('a result with no link is refused before the request', async () => {
    const api = { post: jest.fn() };
    await expect(enqueueWebDownload(api, { videoId: 'x' })).rejects.toThrow(/no link/);
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('the pond\'s own words', () => {
  test('are lifted out of the error api.* threw', () => {
    const error = new Error(
      'API 503 on GET /api/music/web/search — {"success":false,"error":"This pond cannot search the web — yt-dlp is not installed."}',
    );
    expect(pondMessage(error)).toBe('This pond cannot search the web — yt-dlp is not installed.');
  });

  test('are null when there is nothing better than the caller\'s fallback', () => {
    expect(pondMessage(new Error('Network request failed'))).toBeNull();
    expect(pondMessage(new Error('API 502 on GET /x — not json {'))).toBeNull();
    expect(pondMessage(new Error('API 500 — {"success":false}'))).toBeNull();
    expect(pondMessage(new Error('API 500 — {"error":"   "}'))).toBeNull();
    expect(pondMessage(undefined)).toBeNull();
  });
});

describe('what the user is told', () => {
  const base = { query: 'nightcall', loading: false, error: null, results: [], searched: 'nightcall' };

  test('an empty field invites a search rather than reporting a failure', () => {
    expect(webSearchStatus({ ...base, query: '' })).toMatch(/Search YouTube/);
  });

  test('one character asks for another', () => {
    expect(webSearchStatus({ ...base, query: 'n' })).toBe('Keep typing…');
  });

  test('"nothing found" never appears over a search that has not happened', () => {
    // Mid-debounce: the query has moved on but the results on screen belong to
    // the previous one. Counting them would be a lie in either direction.
    expect(webSearchStatus({ ...base, query: 'nightcall two', searched: 'nightcall', results: [RESULT] }))
      .toMatch(/^Searching YouTube/);
    expect(webSearchStatus({ ...base, loading: true })).toMatch(/^Searching YouTube/);
  });

  test('counts what is actually on screen', () => {
    expect(webSearchStatus({ ...base, results: [RESULT] })).toBe('1 result on YouTube');
    expect(webSearchStatus({ ...base, results: [RESULT, RESULT] })).toBe('2 results on YouTube');
    expect(webSearchStatus(base)).toBe('Nothing on YouTube for “nightcall”.');
  });

  test('an error replaces the count — it is the more useful sentence', () => {
    expect(webSearchStatus({ ...base, error: 'This pond needs an update.', results: [RESULT] }))
      .toBe('This pond needs an update.');
  });
});
