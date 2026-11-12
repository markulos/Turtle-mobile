import {
  LIBRARY_SCOPE,
  WARM_COALESCE_MS,
  WEB_SCOPE,
  createRowWarmer,
  enqueueWebDownload,
  isWebRowId,
  pondMessage,
  searchWebMusic,
  shouldSearchWeb,
  unwarmedIds,
  warmWebMusic,
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
    // NO `/api` PREFIX: getBaseUrl() already ends in /api and api.* appends to
    // it, so asserting the prefixed path here is what let the doubled-/api 404
    // ship green in the first place (fixed in 5784625; this expectation was
    // left behind pointing at the broken shape).
    expect(api.get).toHaveBeenCalledWith(
      '/music/web/search?q=nightcall%20%26%20drive&limit=15',
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
    // Relative to /api, like every other api.* call. See above.
    expect(api.post).toHaveBeenCalledWith('/downloads', {
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

describe('warming the rows on screen', () => {
  test('names them to the pond, relative to /api', async () => {
    const api = { post: jest.fn(() => Promise.resolve({ success: true, accepted: 2 })) };
    expect(await warmWebMusic(api, ['MV_3Dpw-BRY', 'OcDiOUQBFd4'])).toBe(true);
    expect(api.post).toHaveBeenCalledWith('/music/web/warm', {
      videoIds: ['MV_3Dpw-BRY', 'OcDiOUQBFd4'],
    });
  });

  test('an empty list never leaves the phone', async () => {
    const api = { post: jest.fn() };
    expect(await warmWebMusic(api, [])).toBe(false);
    expect(await warmWebMusic(api, null)).toBe(false);
    expect(await warmWebMusic(api, [null, 42, ''])).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
  });

  test('a pond that has no such route is not an error on a screen', async () => {
    // An older pond 404s this, and the preview still works — it is just
    // slower. A hint that failed is a hint that did not happen.
    const api = { post: jest.fn(() => Promise.reject(new Error('API 404 on POST /music/web/warm'))) };
    expect(await warmWebMusic(api, ['MV_3Dpw-BRY'])).toBe(false);
  });

  test('only the rows the pond has not been told about are sent', () => {
    const asked = new Set(['MV_3Dpw-BRY']);
    // Scrolling fires a viewability change per row that crosses the line, and
    // the same row crosses it over and over.
    expect(unwarmedIds(['MV_3Dpw-BRY', 'OcDiOUQBFd4', 'OcDiOUQBFd4'], asked))
      .toEqual(['OcDiOUQBFd4']);
    expect(unwarmedIds(['MV_3Dpw-BRY'], asked)).toEqual([]);
    // The caller adds to `asked` itself, so a send that failed can be retried.
    expect(asked.has('OcDiOUQBFd4')).toBe(false);
  });

  test('library rows are not web rows, so they ask for nothing', () => {
    // The same FlatList draws both scopes; a library row has no videoId.
    expect(unwarmedIds([undefined, null, ''], new Set())).toEqual([]);
    expect(unwarmedIds(undefined, new Set())).toEqual([]);
  });
});

describe('the row warmer a list reports visibility to', () => {
  const viewable = (...results) => ({ viewableItems: results.map((item) => ({ item })) });
  const SECOND = { ...RESULT, videoId: 'OcDiOUQBFd4' };

  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('a flick of the thumb is one request, not one per row', () => {
    const send = jest.fn();
    const warmer = createRowWarmer({ send });

    // Several viewability changes in quick succession, as a scroll produces.
    warmer.onVisible(viewable(RESULT));
    warmer.onVisible(viewable(RESULT, SECOND));
    expect(send).not.toHaveBeenCalled();

    jest.advanceTimersByTime(WARM_COALESCE_MS);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith([RESULT.videoId, SECOND.videoId]);
  });

  test('the same rows crossing the line again cost nothing', () => {
    const send = jest.fn();
    const warmer = createRowWarmer({ send });

    warmer.onVisible(viewable(RESULT));
    jest.advanceTimersByTime(WARM_COALESCE_MS);
    // Scrolling back up over a row the pond is already holding a URL for.
    warmer.onVisible(viewable(RESULT));
    jest.advanceTimersByTime(WARM_COALESCE_MS * 4);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('rows with no video id are not rows the pond can warm', () => {
    const send = jest.fn();
    const warmer = createRowWarmer({ send });

    // A library match: an id, a filename, no videoId.
    warmer.onVisible(viewable({ id: 'one', filename: 'Nightcall.mp3' }));
    warmer.onVisible({ viewableItems: [] });
    warmer.onVisible(undefined);
    jest.advanceTimersByTime(WARM_COALESCE_MS * 4);
    expect(send).not.toHaveBeenCalled();
  });

  test('a new result set starts over — the old ids mean nothing now', () => {
    const send = jest.fn();
    const warmer = createRowWarmer({ send });

    warmer.onVisible(viewable(RESULT));
    jest.advanceTimersByTime(WARM_COALESCE_MS);
    // The same query, searched again: the pond may have dropped that URL, and
    // re-naming the row is how it gets resolved again.
    warmer.reset();
    warmer.onVisible(viewable(RESULT));
    jest.advanceTimersByTime(WARM_COALESCE_MS);
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('a reset mid-flick drops the batch it was about to send', () => {
    const send = jest.fn();
    const warmer = createRowWarmer({ send });

    warmer.onVisible(viewable(RESULT));
    warmer.reset();
    jest.advanceTimersByTime(WARM_COALESCE_MS * 4);
    expect(send).not.toHaveBeenCalled();
  });

  test('leaving the screen cancels a request for rows nobody is looking at', () => {
    const send = jest.fn();
    const warmer = createRowWarmer({ send });

    warmer.onVisible(viewable(RESULT));
    warmer.cancel();
    jest.advanceTimersByTime(WARM_COALESCE_MS * 4);
    expect(send).not.toHaveBeenCalled();
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

describe('the playlist form, when the pond offers one', () => {
  // YouTube's audio is DASH-segmented fMP4; AVPlayer will not stream it as a
  // bare file past about an hour. hlsUrl is the same bytes as a playlist.
  it('plays the playlist in preference to the file', () => {
    const row = webPreviewRow(
      { ...RESULT, hlsUrl: '/api/music/web/hls/MV_3Dpw-BRY/playlist.m3u8?token=abc.def' },
      'http://pond.local/api'
    );
    expect(row.rawUrl).toBe('http://pond.local/api/music/web/hls/MV_3Dpw-BRY/playlist.m3u8?token=abc.def');
  });

  it('falls back to the file on a pond that has not deployed it', () => {
    // The phone updates over the air and the pond waits for a restart, so this
    // IS the normal order of events, not an edge case.
    expect(webPreviewRow(RESULT, 'http://pond.local/api').rawUrl)
      .toBe('http://pond.local/api/music/web/preview/MV_3Dpw-BRY?token=abc.def');
    expect(webPreviewRow({ ...RESULT, hlsUrl: '' }, 'http://pond.local/api').rawUrl)
      .toBe('http://pond.local/api/music/web/preview/MV_3Dpw-BRY?token=abc.def');
  });
});
