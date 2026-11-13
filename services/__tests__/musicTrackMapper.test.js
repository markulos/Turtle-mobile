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

describe('a storage filename is never a title', () => {
  // THE BUG, as reported: "on changing the name of a music track, the display
  // on screen lock becomes a bunch of numbers". The numbers are the pond's own
  // storage name — every uploaded and downloaded file is media_<epoch_ms>_<rand>
  // on disk — reaching the lock screen because titleOf fell through to
  // `filename` when `originalName` was missing.
  test('falls back to Unknown track rather than media_1794518356672_9l5iakewv', () => {
    expect(titleOf({ filename: 'media_1794518356672_9l5iakewv.m4a' })).toBe('Unknown track');
    expect(titleOf({ id: 'x', filename: 'media_1700000000000_abc123.mp3' })).toBe('Unknown track');
  });

  test('…and the player never carries one either', () => {
    const item = mapMediaRowToTrack(
      { id: 'media_1794518356672_9l5iakewv', filename: 'media_1794518356672_9l5iakewv.m4a', rawUrl: '/a.m4a' },
      'https://pond',
    );
    expect(item.title).toBe('Unknown track');
    expect(item.title).not.toMatch(/\d{10}/);
  });

  test('a REAL name on disk is still a name — the guard is narrow on purpose', () => {
    // A voice memo genuinely is called this on disk, and that IS its name.
    expect(titleOf({ filename: 'Voice memo.m4a' })).toBe('Voice memo');
    expect(titleOf({ filename: 'media_notes_from_monday.m4a' })).toBe('media_notes_from_monday');
    expect(titleOf({ filename: '2024 rehearsal.mp3' })).toBe('2024 rehearsal');
  });

  test('originalName always wins, storage-shaped or not', () => {
    expect(titleOf({
      originalName: 'Machinarium_OST.m4a',
      filename: 'media_1794498417429_yv9h0l9j8.m4a',
    })).toBe('Machinarium_OST');
  });
});
