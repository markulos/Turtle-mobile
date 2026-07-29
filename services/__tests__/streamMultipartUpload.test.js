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
    jest.restoreAllMocks();
  });

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
});
