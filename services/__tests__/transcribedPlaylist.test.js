/**
 * Filing a transcribed track into its playlist.
 *
 * The rule with teeth: the tags route REPLACES the list, so this must always
 * send a union. Sending just ['Transcribed'] would empty every other playlist
 * the track was in — a data loss nobody would notice for weeks.
 */
jest.mock('../offlineQueue', () => ({ sendOrQueue: jest.fn(() => Promise.resolve({ queued: false })) }));

const { sendOrQueue } = require('../offlineQueue');
const { fileIntoTranscribedPlaylist, withTranscribedTag } = require('../transcribedPlaylist');
const { TRANSCRIBED_PLAYLIST } = require('../../utils/transcriptionRecordings');

beforeEach(() => sendOrQueue.mockClear());

describe('withTranscribedTag', () => {
  test('keeps every playlist the track was already in', () => {
    expect(withTranscribedTag(['Sermons', 'Ideas']))
      .toEqual(['Sermons', 'Ideas', TRANSCRIBED_PLAYLIST]);
  });

  test('does not add itself twice', () => {
    expect(withTranscribedTag(['Sermons', TRANSCRIBED_PLAYLIST]))
      .toEqual(['Sermons', TRANSCRIBED_PLAYLIST]);
  });

  test('copes with nothing, and with junk in the list', () => {
    expect(withTranscribedTag(undefined)).toEqual([TRANSCRIBED_PLAYLIST]);
    expect(withTranscribedTag([null, 3, '', 'Real'])).toEqual(['Real', TRANSCRIBED_PLAYLIST]);
  });
});

describe('fileIntoTranscribedPlaylist', () => {
  const api = {};

  test('writes the UNION, never a replacement', async () => {
    await fileIntoTranscribedPlaylist(api, { mediaId: '12', mediaTags: ['Sermons'] });
    expect(sendOrQueue).toHaveBeenCalledWith(api, expect.objectContaining({
      method: 'put',
      path: '/media/12/tags',
      body: { tags: ['Sermons', TRANSCRIBED_PLAYLIST] },
    }));
  });

  test('is keyed per track, so two offline attempts collapse to one', async () => {
    await fileIntoTranscribedPlaylist(api, { mediaId: '12', mediaTags: [] });
    expect(sendOrQueue.mock.calls[0][1].key).toBe('media:12:transcribed');
  });

  test('spends no request when the track is already filed', async () => {
    const done = await fileIntoTranscribedPlaylist(api, {
      mediaId: '12', mediaTags: [TRANSCRIBED_PLAYLIST],
    });
    expect(done).toBe(false);
    expect(sendOrQueue).not.toHaveBeenCalled();
  });

  test('a job with no vault track behind it writes nothing', async () => {
    expect(await fileIntoTranscribedPlaylist(api, { mediaId: null })).toBe(false);
    expect(await fileIntoTranscribedPlaylist(null, { mediaId: '12' })).toBe(false);
    expect(sendOrQueue).not.toHaveBeenCalled();
  });

  test('a refusal is swallowed — a missing playlist entry is not a lost transcript', async () => {
    sendOrQueue.mockRejectedValueOnce(new Error('HTTP 404'));
    await expect(fileIntoTranscribedPlaylist(api, { mediaId: '9', mediaTags: [] }))
      .resolves.toBe(false);
  });

  test('the id is escaped into the path', async () => {
    await fileIntoTranscribedPlaylist(api, { mediaId: 'a b/c', mediaTags: [] });
    expect(sendOrQueue.mock.calls[0][1].path).toBe('/media/a%20b%2Fc/tags');
  });
});
