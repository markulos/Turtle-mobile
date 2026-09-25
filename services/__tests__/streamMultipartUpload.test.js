import * as FileSystem from 'expo-file-system/legacy';
import { streamMultipartUpload } from '../streamMultipartUpload';

jest.mock('expo-file-system/legacy', () => ({
  FileSystemUploadType: { MULTIPART: 'multipart' },
  createUploadTask: jest.fn(),
  // Answers undefined unless a test says otherwise → "size unknown" → one body.
  getInfoAsync: jest.fn(),
}));
// The part-wise transport, proven in chunkedUpload.test.js; here only WHEN it
// is chosen matters.
const mockChunkedUpload = jest.fn();
jest.mock('../chunkedUpload', () => ({
  chunkedUpload: (...args) => mockChunkedUpload(...args),
}));

const MB = 1024 * 1024;
// The pond's admission gate, byte for byte (routes/media.js).
const busyRefusal = (retryAfter = '1') => ({
  uploadAsync: jest.fn().mockResolvedValue({
    status: 503,
    headers: { 'Retry-After': retryAfter },
    body: '{"success":false,"retryable":true,"error":"Upload ingress is busy; retry shortly"}',
  }),
  cancelAsync: jest.fn().mockResolvedValue(undefined),
});

describe('streamMultipartUpload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const uploadArgs = {
    url: 'https://pond.example/api/media/upload',
    fileUri: 'file:///owned/song.mp3',
    mimeType: 'audio/mpeg',
    parameters: { outputKind: 'audio', album: 'Audio' },
    token: 'token-7',
    label: 'song.mp3',
  };

  test('streams a native multipart upload with auth, flat parameters, and monotonic completion progress', async () => {
    const onProgress = jest.fn();
    FileSystem.createUploadTask.mockImplementation((url, fileUri, options, progress) => {
      progress({ totalBytesSent: 5, totalBytesExpectedToSend: 10 });
      return {
        uploadAsync: jest.fn().mockResolvedValue({ status: 202, body: '{"queued":true}' }),
        cancelAsync: jest.fn().mockResolvedValue(undefined),
      };
    });

    await expect(
      streamMultipartUpload({
        url: 'https://pond.example/api/media/upload',
        fileUri: 'file:///owned/song.mp3',
        mimeType: 'audio/mpeg',
        parameters: { outputKind: 'audio', album: 'Audio' },
        token: 'token-7',
        label: 'song.mp3',
        onProgress,
      })
    ).resolves.toEqual({ status: 202, body: '{"queued":true}' });

    expect(FileSystem.createUploadTask).toHaveBeenCalledWith(
      'https://pond.example/api/media/upload',
      'file:///owned/song.mp3',
      {
        httpMethod: 'POST',
        uploadType: 'multipart',
        fieldName: 'media',
        mimeType: 'audio/mpeg',
        parameters: { outputKind: 'audio', album: 'Audio' },
        headers: { Authorization: 'Bearer token-7' },
      },
      expect.any(Function)
    );
    expect(onProgress).toHaveBeenNthCalledWith(1, 50);
    expect(onProgress).toHaveBeenLastCalledWith(100);
  });

  test('does not retry a non-transient client rejection', async () => {
    FileSystem.createUploadTask.mockReturnValue({
      uploadAsync: jest.fn().mockResolvedValue({ status: 415, body: 'unsupported' }),
      cancelAsync: jest.fn().mockResolvedValue(undefined),
    });

    await expect(
      streamMultipartUpload({
        url: 'https://pond.example/api/media/upload',
        fileUri: 'file:///owned/notes.pdf',
        mimeType: 'application/pdf',
        parameters: {},
        token: null,
        label: 'notes.pdf',
      })
    ).rejects.toThrow('HTTP 415');

    expect(FileSystem.createUploadTask).toHaveBeenCalledTimes(1);
  });

  test('retries a transient response after the existing linear backoff and clears timers', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-29T12:00:00Z'));
    FileSystem.createUploadTask
      .mockReturnValueOnce({
        uploadAsync: jest.fn().mockResolvedValue({ status: 500, body: 'temporary' }),
        cancelAsync: jest.fn().mockResolvedValue(undefined),
      })
      .mockReturnValueOnce({
        uploadAsync: jest.fn().mockResolvedValue({ status: 202, body: '{"queued":true}' }),
        cancelAsync: jest.fn().mockResolvedValue(undefined),
      });

    const upload = streamMultipartUpload(uploadArgs);
    await Promise.resolve();
    await Promise.resolve();

    expect(FileSystem.createUploadTask).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1499);
    expect(FileSystem.createUploadTask).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);

    await expect(upload).resolves.toEqual({ status: 202, body: '{"queued":true}' });
    expect(FileSystem.createUploadTask).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('cancels a stalled transfer, retries, and leaves no watchdog timer behind', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-29T12:00:00Z'));
    const firstTask = {
      uploadAsync: jest.fn(() => new Promise(() => {})),
      cancelAsync: jest.fn().mockResolvedValue(undefined),
    };
    FileSystem.createUploadTask
      .mockReturnValueOnce(firstTask)
      .mockReturnValueOnce({
        uploadAsync: jest.fn().mockResolvedValue({ status: 202, body: '{"queued":true}' }),
        cancelAsync: jest.fn().mockResolvedValue(undefined),
      });

    const upload = streamMultipartUpload(uploadArgs);
    await jest.advanceTimersByTimeAsync(65000);

    expect(firstTask.cancelAsync).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1500);
    await expect(upload).resolves.toEqual({ status: 202, body: '{"queued":true}' });
    expect(FileSystem.createUploadTask).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('uses the processing watchdog after all bytes are sent and cleans up its timer', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-29T12:00:00Z'));
    const firstTask = {
      uploadAsync: jest.fn(() => new Promise(() => {})),
      cancelAsync: jest.fn().mockResolvedValue(undefined),
    };
    FileSystem.createUploadTask
      .mockImplementationOnce((url, fileUri, options, progress) => {
        progress({ totalBytesSent: 10, totalBytesExpectedToSend: 10 });
        return firstTask;
      })
      .mockReturnValueOnce({
        uploadAsync: jest.fn().mockResolvedValue({ status: 202, body: '{"queued":true}' }),
        cancelAsync: jest.fn().mockResolvedValue(undefined),
      });

    const upload = streamMultipartUpload(uploadArgs);
    await jest.advanceTimersByTimeAsync(65000);
    expect(firstTask.cancelAsync).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(240000);
    expect(firstTask.cancelAsync).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1500);

    await expect(upload).resolves.toEqual({ status: 202, body: '{"queued":true}' });
    expect(FileSystem.createUploadTask).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('cancels the native task and does not retry after account ownership is aborted', async () => {
    const controller = new AbortController();
    const task = {
      uploadAsync: jest.fn(() => new Promise(() => {})),
      cancelAsync: jest.fn().mockResolvedValue(undefined),
    };
    FileSystem.createUploadTask.mockReturnValue(task);

    const upload = streamMultipartUpload({ ...uploadArgs, signal: controller.signal });
    controller.abort();

    await expect(upload).rejects.toThrow('Upload cancelled');
    expect(task.cancelAsync).toHaveBeenCalledTimes(1);
    expect(FileSystem.createUploadTask).toHaveBeenCalledTimes(1);
  });

  test('reuses the exact clientImportId parameter across transient retries', async () => {
    jest.useFakeTimers();
    const parameters = {
      outputKind: 'audio',
      clientImportId: 'stable-import-id',
    };
    FileSystem.createUploadTask
      .mockReturnValueOnce({
        uploadAsync: jest.fn().mockResolvedValue({ status: 500, body: 'lost response' }),
        cancelAsync: jest.fn().mockResolvedValue(undefined),
      })
      .mockReturnValueOnce({
        uploadAsync: jest.fn().mockResolvedValue({ status: 202, body: '{"queued":true}' }),
        cancelAsync: jest.fn().mockResolvedValue(undefined),
      });

    const upload = streamMultipartUpload({ ...uploadArgs, parameters });
    await jest.advanceTimersByTimeAsync(1500);
    await upload;

    const firstParameters = FileSystem.createUploadTask.mock.calls[0][2].parameters;
    const retryParameters = FileSystem.createUploadTask.mock.calls[1][2].parameters;
    expect(firstParameters.clientImportId).toBe('stable-import-id');
    expect(retryParameters.clientImportId).toBe('stable-import-id');
  });

  /**
   * The 503 reports. The pond refuses to START an upload while its ingress is
   * full — in 3 ms, before a byte is read — with a Retry-After. That is not a
   * failed transfer, so it must not spend one of the three transfer attempts,
   * and the wait is the server's number, not a constant.
   */
  test('waits out a busy pond for as long as Retry-After says, without spending a transfer attempt', async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0); // no jitter: exact waits
    FileSystem.createUploadTask
      .mockReturnValueOnce(busyRefusal('3'))
      .mockReturnValueOnce({
        uploadAsync: jest.fn().mockResolvedValue({ status: 500, body: 'temporary' }),
        cancelAsync: jest.fn().mockResolvedValue(undefined),
      })
      .mockReturnValueOnce({
        uploadAsync: jest.fn().mockResolvedValue({ status: 202, body: '{"queued":true}' }),
        cancelAsync: jest.fn().mockResolvedValue(undefined),
      });

    const upload = streamMultipartUpload(uploadArgs);
    await jest.advanceTimersByTimeAsync(0);
    expect(FileSystem.createUploadTask).toHaveBeenCalledTimes(1);

    // Not the old fixed 1.5 s: the server asked for 3.
    await jest.advanceTimersByTimeAsync(2999);
    expect(FileSystem.createUploadTask).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(FileSystem.createUploadTask).toHaveBeenCalledTimes(2);

    // The refusal cost no attempt: the 500 that follows is still attempt 1 of
    // 3, and its retry lands on the transport ladder's first rung (1.5 s).
    await jest.advanceTimersByTimeAsync(1500);
    await expect(upload).resolves.toEqual({ status: 202, body: '{"queued":true}' });
    expect(FileSystem.createUploadTask).toHaveBeenCalledTimes(3);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('gives up on a pond that stays busy past the budget, naming the wait rather than a bare 503', async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    FileSystem.createUploadTask.mockImplementation(() => busyRefusal('1'));

    const outcome = streamMultipartUpload(uploadArgs).then(() => null, (e) => e);
    await jest.advanceTimersByTimeAsync(300_000);

    const err = await outcome;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/Turtle is busy with other uploads/);
    expect(err.message).toMatch(/HTTP 503/);
    // Backing off 1, 2, 4, 8, 15, 15… s until the 90 s budget: a handful of
    // knocks, not a hammer.
    const knocks = FileSystem.createUploadTask.mock.calls.length;
    expect(knocks).toBeGreaterThan(3);
    expect(knocks).toBeLessThanOrEqual(12);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('aborting during a busy wait cancels without another knock', async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const controller = new AbortController();
    FileSystem.createUploadTask.mockImplementation(() => busyRefusal('5'));

    const outcome = streamMultipartUpload({ ...uploadArgs, signal: controller.signal }).then(() => null, (e) => e);
    await jest.advanceTimersByTimeAsync(1000);
    controller.abort();
    await jest.advanceTimersByTimeAsync(10_000);

    expect((await outcome).message).toBe('Upload cancelled');
    expect(FileSystem.createUploadTask).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  /**
   * The 184 MB thesis. A body over the single-body ceiling never goes out as
   * one request — it stalled at 4 MB on every attempt — it goes in parts, and
   * the caller sees the same result shape either way.
   */
  test('sends a file over the single-body ceiling in parts and resolves in the one-request shape', async () => {
    FileSystem.getInfoAsync.mockResolvedValueOnce({ exists: true, size: 184414492 });
    mockChunkedUpload.mockResolvedValueOnce({ success: true, media: { id: 'm1' } });
    const onProgress = jest.fn();

    const result = await streamMultipartUpload({
      ...uploadArgs,
      fileUri: 'file:///docs/thesis.pdf',
      mimeType: 'application/pdf',
      parameters: { originalName: '01BoulosMarkThesis2026 _final-revision-3.pdf', tags: '[]' },
      onProgress,
    });

    expect(FileSystem.createUploadTask).not.toHaveBeenCalled();
    expect(mockChunkedUpload).toHaveBeenCalledTimes(1);
    expect(mockChunkedUpload).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://pond.example/api',
      fileUri: 'file:///docs/thesis.pdf',
      fileSize: 184414492,
      originalName: '01BoulosMarkThesis2026 _final-revision-3.pdf',
      mimeType: 'application/pdf',
      parameters: { originalName: '01BoulosMarkThesis2026 _final-revision-3.pdf', tags: '[]' },
      token: 'token-7',
      onProgress,
    }));
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ success: true, media: { id: 'm1' } });
  });

  test('a caller-supplied size skips the stat; small files and other routes stay on one request', async () => {
    const ok = () => ({
      uploadAsync: jest.fn().mockResolvedValue({ status: 202, body: '{"queued":true}' }),
      cancelAsync: jest.fn().mockResolvedValue(undefined),
    });
    FileSystem.createUploadTask.mockImplementation(ok);

    // A 5 MB photo: statted, and sent as one body.
    FileSystem.getInfoAsync.mockResolvedValueOnce({ exists: true, size: 5 * MB });
    await streamMultipartUpload(uploadArgs);
    expect(FileSystem.getInfoAsync).toHaveBeenCalledWith('file:///owned/song.mp3', { size: true });
    expect(mockChunkedUpload).not.toHaveBeenCalled();
    expect(FileSystem.createUploadTask).toHaveBeenCalledTimes(1);

    // A transcription: never statted, never chunked, whatever its size.
    FileSystem.getInfoAsync.mockClear();
    await streamMultipartUpload({
      ...uploadArgs, url: 'https://pond.example/api/transcriptions', fieldName: 'file', fileSize: 500 * MB,
    });
    expect(FileSystem.getInfoAsync).not.toHaveBeenCalled();
    expect(mockChunkedUpload).not.toHaveBeenCalled();
    expect(FileSystem.createUploadTask).toHaveBeenCalledTimes(2);

    // A known size is trusted without a stat.
    mockChunkedUpload.mockResolvedValueOnce({ success: true });
    await streamMultipartUpload({ ...uploadArgs, fileSize: 200 * MB });
    expect(FileSystem.getInfoAsync).not.toHaveBeenCalled();
    expect(mockChunkedUpload).toHaveBeenCalledTimes(1);
    expect(FileSystem.createUploadTask).toHaveBeenCalledTimes(2);
  });
});
