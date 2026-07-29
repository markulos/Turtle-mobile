import * as FileSystem from 'expo-file-system/legacy';
import { streamMultipartUpload } from '../streamMultipartUpload';

jest.mock('expo-file-system/legacy', () => ({
  FileSystemUploadType: { MULTIPART: 'multipart' },
  createUploadTask: jest.fn(),
}));

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
});
