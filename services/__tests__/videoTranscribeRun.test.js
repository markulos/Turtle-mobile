/**
 * Starting a video's transcription from Files.
 *
 * The shape of the run is what matters here, because no screen can be relied
 * on to watch it:
 *
 *   • "transcript only" submits the VIDEO's own media id and never touches
 *     the conversion endpoint — that is the half a pond needs nothing new for;
 *   • "audio file and transcript" converts FIRST, waits for the track, and
 *     submits the TRACK's id. Submitting the video would leave a transcript
 *     with no track beside it, which is the thing that was asked for;
 *   • a row exists in the recordings store from the first tap, so the panel
 *     has something to show and something to poll the moment an id arrives;
 *   • a conversion that fails ends as a failed row carrying the pond's own
 *     reason, and submits nothing.
 */
import { startVideoTranscription } from '../videoTranscribeRun';
import { __resetForTests, getRecordings } from '../transcriptionStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

const video = { id: 'media_clip', originalName: 'Standup.mp4', type: 'video', size: 2048 };

/** Let the runner's awaits drain without waiting out a real backoff. */
const settle = async (rounds = 12) => {
  for (let i = 0; i < rounds; i += 1) {
    jest.advanceTimersByTime(5000);
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

function stubApi({ statuses = [], postFails = null } = {}) {
  const calls = { post: [], get: [] };
  let statusIndex = 0;
  return {
    calls,
    api: {
      post: jest.fn((path, body) => {
        calls.post.push({ path, body });
        if (postFails && postFails(path)) return Promise.reject(postFails(path));
        if (path.endsWith('/extract-audio')) return Promise.resolve({ success: true, jobId: 'imp_1' });
        return Promise.resolve({ id: 'job_1', status: 'queued' });
      }),
      get: jest.fn((path) => {
        calls.get.push(path);
        const next = statuses[Math.min(statusIndex, statuses.length - 1)];
        statusIndex += 1;
        return Promise.resolve(next);
      }),
      put: jest.fn(() => Promise.resolve({})),
      patch: jest.fn(() => Promise.resolve({})),
      delete: jest.fn(() => Promise.resolve({})),
    },
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  __resetForTests([]);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('transcript only', () => {
  it('submits the video itself and never asks for a conversion', async () => {
    const { api, calls } = stubApi();
    startVideoTranscription(api, { item: video, mode: 'transcript' });
    await settle();

    expect(calls.post.map((p) => p.path)).toEqual(['/transcriptions']);
    expect(calls.post[0].body).toMatchObject({ mediaId: 'media_clip' });
    const [row] = getRecordings();
    expect(row).toMatchObject({ id: 'job_1', status: 'queued', mediaId: 'media_clip', name: 'Standup' });
  });

  it('leaves a row to look at from the very first tap', () => {
    const { api } = stubApi();
    startVideoTranscription(api, { item: video, mode: 'transcript' });
    const [row] = getRecordings();
    expect(row.status).toBe('uploading');
    expect(row.id).toBeNull();
    expect(row.name).toBe('Standup');
  });
});

describe('audio file and transcript', () => {
  it('converts first, then transcribes the track the conversion made', async () => {
    const { api, calls } = stubApi({
      statuses: [
        { phase: 'working', mediaId: null },
        { phase: 'completed', mediaId: 'media_track' },
      ],
    });
    const saved = [];
    startVideoTranscription(api, { item: video, mode: 'audio', onTrackSaved: (id) => saved.push(id) });
    await settle();

    expect(calls.post[0].path).toBe('/media/media_clip/extract-audio');
    expect(calls.get[0]).toBe('/media/extract-audio/imp_1');
    expect(calls.post[1].path).toBe('/transcriptions');
    expect(calls.post[1].body).toMatchObject({ mediaId: 'media_track' });
    expect(saved).toEqual(['media_track']);

    const [row] = getRecordings();
    // The transcript belongs to the TRACK, which is the link the music vault
    // follows to know it can read along with it.
    expect(row).toMatchObject({ id: 'job_1', mediaId: 'media_track' });
  });

  it('says what the pond said when the conversion fails, and submits nothing', async () => {
    const { api, calls } = stubApi({
      statuses: [{ phase: 'failed', mediaId: null, error: 'Media contains no audio stream' }],
    });
    startVideoTranscription(api, { item: video, mode: 'audio' });
    await settle();

    expect(calls.post.map((p) => p.path)).toEqual(['/media/media_clip/extract-audio']);
    const [row] = getRecordings();
    expect(row.status).toBe('failed');
    expect(row.error).toBe('Media contains no audio stream');
  });

  it('shows the conversion as its own step, since the pond reports no stage for it', () => {
    const { api } = stubApi({ statuses: [{ phase: 'working', mediaId: null }] });
    startVideoTranscription(api, { item: video, mode: 'audio' });
    const [row] = getRecordings();
    expect(row.note).toBe('Taking the audio out');
    expect(row.mediaId).toBeNull();
  });
});

describe('when the pond refuses outright', () => {
  it('ends as a failed row with a reason rather than retrying', async () => {
    const { api, calls } = stubApi({
      postFails: (path) => (path.endsWith('/extract-audio')
        ? Object.assign(new Error('409'), { status: 409 })
        : null),
    });
    startVideoTranscription(api, { item: video, mode: 'audio' });
    await settle();

    expect(calls.post).toHaveLength(1);
    const [row] = getRecordings();
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/no copy of that video/);
  });
});
