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
});
