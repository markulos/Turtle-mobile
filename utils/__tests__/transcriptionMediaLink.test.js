/**
 * The link between a transcription job and the vault track it came from.
 *
 * Without `mediaId` a transcript is a document in Settings; with it, the music
 * vault knows which of its tracks can read along as they play, and which
 * belong in the Transcribed playlist. These are the selectors that answer
 * those two questions, plus the one that stops a track being sent twice.
 */
import {
  TRANSCRIBED_PLAYLIST,
  normaliseRecording,
  pendingRowForMedia,
  transcribedMediaIds,
  transcriptRowForMedia,
} from '../transcriptionRecordings';

const row = (over) => normaliseRecording({ key: 'k', name: 'Recording', ...over });

describe('the media link survives the storage boundary', () => {
  test('mediaId and the track\'s playlists are kept, as strings', () => {
    const r = row({ mediaId: 12, mediaTags: ['Sermons'] });
    expect(r.mediaId).toBe('12');
    expect(r.mediaTags).toEqual(['Sermons']);
  });

  test('a job with no vault track behind it has neither', () => {
    const r = row({ name: 'A video from the camera roll' });
    expect(r.mediaId).toBeNull();
    expect(r.mediaTags).toEqual([]);
  });

  test('junk written by an older build does not become junk tags', () => {
    expect(row({ mediaTags: 'Sermons' }).mediaTags).toEqual([]);
    expect(row({ mediaTags: [null, 7, 'Real'] }).mediaTags).toEqual(['Real']);
  });
});

describe('transcriptRowForMedia', () => {
  const list = [
    row({ key: 'a', id: 'job-a', mediaId: '12', status: 'completed', createdAt: 100 }),
    row({ key: 'b', id: 'job-b', mediaId: '12', status: 'completed', createdAt: 900 }),
    row({ key: 'c', id: 'job-c', mediaId: '99', status: 'failed', createdAt: 500 }),
    row({ key: 'd', id: 'job-d', mediaId: '77', status: 'transcribing', createdAt: 500 }),
  ];

  test('newest wins — re-transcribing replaces what you follow along with', () => {
    expect(transcriptRowForMedia(list, '12').id).toBe('job-b');
  });

  test('only a FINISHED job counts', () => {
    expect(transcriptRowForMedia(list, '99')).toBeNull();
    expect(transcriptRowForMedia(list, '77')).toBeNull();
  });

  test('accepts a numeric id, because the vault rows carry numbers', () => {
    expect(transcriptRowForMedia(list, 12).id).toBe('job-b');
  });

  test('no track, no list, no answer — not a crash', () => {
    expect(transcriptRowForMedia(list, null)).toBeNull();
    expect(transcriptRowForMedia(undefined, '12')).toBeNull();
  });
});

describe('transcribedMediaIds', () => {
  test('is every track with a finished transcript, once each', () => {
    const ids = transcribedMediaIds([
      row({ key: 'a', id: 'j', mediaId: '12', status: 'completed' }),
      row({ key: 'b', id: 'j', mediaId: '12', status: 'completed' }),
      row({ key: 'c', id: 'j', mediaId: '13', status: 'failed' }),
      row({ key: 'd', id: 'j', status: 'completed' }), // a camera-roll video
    ]);
    expect([...ids]).toEqual(['12']);
  });
});

describe('pendingRowForMedia', () => {
  test('finds a job still in flight, so the same audio is not sent twice', () => {
    const list = [row({ key: 'a', id: 'j', mediaId: '12', status: 'transcribing' })];
    expect(pendingRowForMedia(list, '12').key).toBe('a');
  });

  test('a finished or failed job is not pending — re-transcribing is allowed', () => {
    for (const status of ['completed', 'failed', 'cancelled']) {
      expect(pendingRowForMedia([row({ key: 'a', mediaId: '12', status })], '12')).toBeNull();
    }
  });

  test('an upload that has not been accepted yet still counts', () => {
    // It has no job id, but the bytes are going up the wire right now.
    expect(pendingRowForMedia([row({ key: 'a', mediaId: '12', status: 'uploading' })], '12')).toBeTruthy();
  });
});

test('the playlist has one name, shared by everything that writes it', () => {
  expect(TRANSCRIBED_PLAYLIST).toBe('Transcribed');
});
