import {
  classifySharedFile,
  isHttpImportUrl,
  supportedAudioVideoFiles,
} from '../shareMediaClassifier';

describe('shareMediaClassifier', () => {
  test.each([
    [{ path: 'file:///tmp/not-really.pdf', mimeType: 'audio/mpeg' }, 'audio'],
    [{ path: 'file:///tmp/not-really.doc', mimeType: 'VIDEO/QUICKTIME' }, 'video'],
    [{ path: 'file:///tmp/photo.bin', mimeType: 'image/jpeg' }, 'image'],
  ])('uses a specific MIME type before the file extension', (entry, expected) => {
    expect(classifySharedFile(entry)).toBe(expected);
  });

  test.each([
    [{ path: 'file:///tmp/VOICE.M4A', mimeType: 'application/octet-stream' }, 'audio'],
    [{ path: 'content://share/clip', fileName: 'HOLIDAY.MOV', mimeType: '*/*' }, 'video'],
    [{ path: 'file:///tmp/interview.WAV', mimeType: '   ' }, 'audio'],
    [{ path: 'file:///tmp/COVER.JPEG' }, 'image'],
    [{ path: 'file:///tmp/session.OPUS?token=temporary' }, 'audio'],
  ])('falls back to a case-insensitive extension for missing or generic MIME', (entry, expected) => {
    expect(classifySharedFile(entry)).toBe(expected);
  });

  test('does not let an audio-looking extension override a specific document MIME', () => {
    expect(
      classifySharedFile({
        path: 'file:///tmp/meeting.mp3',
        fileName: 'meeting.mp3',
        mimeType: 'application/pdf',
      })
    ).toBe('unsupported');
  });

  test.each([
    { path: 'file:///tmp/recording.mp3', mimeType: 'audio/' },
    { path: 'file:///tmp/movie.mov', mimeType: 'video/ ' },
    { path: 'file:///tmp/recording.mp3', mimeType: 7 },
    { path: 'file:///tmp/movie.mov', mimeType: { type: 'video/mp4' } },
    { path: 'file:///tmp/recording.mp3', mimeType: null },
    { path: 'file:///tmp/movie.mov', mimeType: undefined },
    { path: 'file:///tmp/recording.mp3', mimeType: 'audio/m peg' },
  ])('does not use a media extension when a present MIME value is malformed', (entry) => {
    expect(classifySharedFile(entry)).toBe('unsupported');
  });

  test.each([
    null,
    undefined,
    'file:///tmp/song.mp3',
    {},
    { path: 42 },
    { mimeType: 7 },
    { mimeType: 'audio/mpeg' },
  ])(
    'treats malformed native entries as unsupported',
    (entry) => {
      expect(classifySharedFile(entry)).toBe('unsupported');
    }
  );

  test('returns only supported audio and video entries without rewriting them', () => {
    const audio = { path: 'file:///tmp/song.mp3', mimeType: 'audio/mpeg' };
    const video = { path: 'file:///tmp/movie.mp4', mimeType: 'video/mp4' };
    const document = { path: 'file:///tmp/notes.pdf', mimeType: 'application/pdf' };

    expect(supportedAudioVideoFiles([audio, null, document, video])).toEqual([audio, video]);
    expect(supportedAudioVideoFiles({ files: [audio] })).toEqual([]);
  });

  test.each([
    ['https://example.com/watch?v=7', true],
    ['HTTP://EXAMPLE.COM/live', true],
    ['  https://example.com/audio  ', true],
    ['ftp://example.com/song.mp3', false],
    ['file:///tmp/song.mp3', false],
    ['data:audio/mpeg;base64,AAA', false],
    ['example.com/song.mp3', false],
    ['not a url', false],
    [null, false],
  ])('accepts only valid HTTP(S) import URLs', (value, expected) => {
    expect(isHttpImportUrl(value)).toBe(expected);
  });
});
