/**
 * The transcription client's newer half: the by-media submit, the job list and
 * the feature flags. Pinned so the URL shapes and the "send only what was
 * chosen" rule cannot drift from the server contract without a test noticing.
 */
jest.mock('../streamMultipartUpload', () => ({ streamMultipartUpload: jest.fn() }));

const {
  capabilityFeatures,
  cleanOptions,
  friendlySubmitError,
  listJobs,
  submitMediaTranscription,
} = require('../transcriptions');

const api = () => ({
  get: jest.fn(() => Promise.resolve({ success: true, jobs: [] })),
  post: jest.fn(() => Promise.resolve({ success: true, id: 'tr_9', status: 'queued', mediaId: '12' })),
});

describe('capabilityFeatures', () => {
  it('is all off on a pond that predates the flags', () => {
    expect(capabilityFeatures(null)).toEqual({ mediaSubmit: false, list: false, words: false });
    expect(capabilityFeatures({ models: ['small'] })).toEqual({ mediaSubmit: false, list: false, words: false });
  });

  it('reads only literal trues, so a stringly "false" cannot switch a feature on', () => {
    expect(capabilityFeatures({ features: { mediaSubmit: true, list: 'false', words: 1 } }))
      .toEqual({ mediaSubmit: true, list: false, words: false });
  });
});

describe('listJobs', () => {
  it('lists everything with no query at all', async () => {
    const a = api();
    a.get.mockResolvedValue({ success: true, jobs: [{ id: 'tr_1' }] });
    await expect(listJobs(a)).resolves.toEqual([{ id: 'tr_1' }]);
    expect(a.get).toHaveBeenCalledWith('/transcriptions');
  });

  it('narrows to one recording and caps the count', async () => {
    const a = api();
    await listJobs(a, { mediaId: 'ab c/12', limit: 5.7 });
    expect(a.get).toHaveBeenCalledWith('/transcriptions?mediaId=ab%20c%2F12&limit=5');
  });

  it('answers an empty list for a body without one, rather than something to crash on', async () => {
    const a = api();
    a.get.mockResolvedValue({ success: true });
    await expect(listJobs(a)).resolves.toEqual([]);
  });
});

describe('cleanOptions', () => {
  it('drops what was not chosen and sends the rest as strings, like the multipart fields', () => {
    expect(cleanOptions({ model: 'small', diarize: false, language: '', minSpeakers: 3, primaryName: null, batchSize: undefined }))
      .toEqual({ model: 'small', diarize: 'false', minSpeakers: '3' });
    expect(cleanOptions()).toEqual({});
  });
});

describe('submitMediaTranscription', () => {
  it('posts JSON with the media id and only the chosen options', async () => {
    const a = api();
    const body = await submitMediaTranscription(a, { mediaId: 12, options: { diarize: false, language: '' } });
    expect(a.post).toHaveBeenCalledWith('/transcriptions', { mediaId: '12', diarize: 'false' });
    expect(body).toMatchObject({ id: 'tr_9', status: 'queued' });
  });

  it('refuses to send nothing', async () => {
    const a = api();
    await expect(submitMediaTranscription(a, { mediaId: '' })).rejects.toThrow(/No recording/);
    expect(a.post).not.toHaveBeenCalled();
  });

  it('treats an answer without a job id as a refusal', async () => {
    const a = api();
    a.post.mockResolvedValue({ success: false, error: 'Not found' });
    await expect(submitMediaTranscription(a, { mediaId: '12' })).rejects.toThrow('Not found');
  });
});

describe('friendlySubmitError', () => {
  it('turns the status into a sentence someone pressed a button to get', () => {
    expect(friendlySubmitError(new Error('API Error 409: {"error":"no server copy"}'))).toMatch(/no copy on the pond/i);
    expect(friendlySubmitError(Object.assign(new Error('nope'), { status: 415 }))).toMatch(/cannot read that file/i);
    expect(friendlySubmitError(new Error('HTTP 503: busy'))).toMatch(/busy or offline/i);
    expect(friendlySubmitError(new Error('Network request failed'))).toMatch(/would not accept/i);
  });
});
