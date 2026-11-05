import {
  buildMusicQueue,
  mapMediaRowToTrack,
  resolveMediaUrl,
  sourceOf,
  titleOf,
} from '../musicTrackMapper';

describe('musicTrackMapper', () => {
  test('normalizes title, source, URLs, duration, artwork, and stable metadata', () => {
    const row = {
      id: 'media-7',
      originalName: 'Night Drive.mp3',
      rawUrl: '/api/media/raw/media-7',
      thumbUrl: '/api/media/thumb/media-7',
      sourceUrl: 'https://soundcloud.com/turtle/night-drive',
      duration: 183.4,
    };

    expect(titleOf(row)).toBe('Night Drive');
    expect(sourceOf(row)).toBe('soundcloud.com');
    expect(resolveMediaUrl(row.rawUrl, 'https://pond.example')).toBe(
      'https://pond.example/api/media/raw/media-7'
    );
    expect(mapMediaRowToTrack(row, 'https://pond.example')).toEqual({
      mediaId: 'media-7',
      url: 'https://pond.example/api/media/raw/media-7',
      title: 'Night Drive',
      artist: 'soundcloud.com',
      artworkUrl: 'https://pond.example/api/media/thumb/media-7',
      duration: 183.4,
      extras: { turtleMediaId: 'media-7' },
    });
  });

  test('filters unplayable rows and preserves the selected item index', () => {
    const rows = [
      { id: 'bad', originalName: 'Missing URL.mp3' },
      { id: 'one', filename: 'one.mp3', url: '/media/one.mp3' },
      { id: 'two', filename: 'two.mp3', rawUrl: '/media/two.mp3' },
    ];

    expect(buildMusicQueue(rows, 'two', 'https://pond.example')).toEqual({
      items: [
        expect.objectContaining({ mediaId: 'one', title: 'one' }),
        expect.objectContaining({ mediaId: 'two', title: 'two' }),
      ],
      startIndex: 1,
    });
  });

  test('rejects a selected row that is not playable without producing a queue', () => {
    expect(() =>
      buildMusicQueue(
        [{ id: 'bad', originalName: 'Missing URL.mp3' }],
        'bad',
        'https://pond.example'
      )
    ).toThrow('Selected track is not playable');
  });

  test('uses stable fallbacks and omits invalid optional metadata', () => {
    expect(
      mapMediaRowToTrack(
        { id: 12, filename: 'voice.aac', rawUrl: 'https://cdn.example/voice.aac', duration: -1 },
        'https://pond.example'
      )
    ).toEqual({
      mediaId: '12',
      url: 'https://cdn.example/voice.aac',
      title: 'voice',
      artist: 'Turtle Music',
      extras: { turtleMediaId: '12' },
    });
  });

  // Offline playback is entirely this: the queue points at a file on the
  // phone instead of at the pond. Everything else about the item is the same,
  // which is what keeps the lock screen and the transport unchanged.
  describe('a track kept on this device', () => {
    const row = { id: 7, originalName: 'Song.mp3', rawUrl: '/api/media/raw/7' };
    const LOCAL = 'file:///docs/music-offline/7';

    test('plays from the phone instead of the pond', () => {
      const item = mapMediaRowToTrack(row, 'https://pond.example', { 7: LOCAL });
      expect(item.url).toBe(LOCAL);
      expect(item.mediaId).toBe('7');
      expect(item.title).toBe('Song');
    });

    test('still streams when this particular track is not kept', () => {
      const item = mapMediaRowToTrack(row, 'https://pond.example', { 999: LOCAL });
      expect(item.url).toBe('https://pond.example/api/media/raw/7');
    });

    test('is unchanged when nothing is kept at all', () => {
      expect(mapMediaRowToTrack(row, 'https://pond.example')).toEqual(
        mapMediaRowToTrack(row, 'https://pond.example', undefined)
      );
    });

    test('a queue mixes local and streamed tracks without losing the index', () => {
      const rows = [
        { id: 1, originalName: 'A.mp3', rawUrl: '/api/media/raw/1' },
        { id: 2, originalName: 'B.mp3', rawUrl: '/api/media/raw/2' },
        { id: 3, originalName: 'C.mp3', rawUrl: '/api/media/raw/3' },
      ];
      const { items, startIndex } = buildMusicQueue(rows, 2, 'https://pond.example', {
        1: 'file:///docs/music-offline/1',
        3: 'file:///docs/music-offline/3',
      });

      expect(startIndex).toBe(1);
      expect(items.map((i) => i.url)).toEqual([
        'file:///docs/music-offline/1',
        'https://pond.example/api/media/raw/2',
        'file:///docs/music-offline/3',
      ]);
    });

    test('a row with no stream URL is still playable once it is downloaded', () => {
      // The pond can forget where a file came from; the bytes on the phone
      // are the one thing that cannot go stale.
      const item = mapMediaRowToTrack({ id: 8, originalName: 'Gone.mp3' }, null, { 8: LOCAL });
      expect(item?.url).toBe(LOCAL);
    });
  });
});
