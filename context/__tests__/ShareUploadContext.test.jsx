import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ShareUploadToast from '../../components/ShareUploadToast';
import ShareTargetScreen from '../../screens/ShareTargetScreen';
import { ShareUploadProvider, useShareUpload } from '../ShareUploadContext';

const mockApiGet = jest.fn();
const mockApiPost = jest.fn();
const mockGetInfoAsync = jest.fn();
const mockMakeDirectoryAsync = jest.fn();
const mockCopyAsync = jest.fn();
const mockDeleteAsync = jest.fn();
const mockReadAsStringAsync = jest.fn();
const mockWriteAsStringAsync = jest.fn();
const mockReadDirectoryAsync = jest.fn();
const mockGetFreeDiskStorageAsync = jest.fn();
const mockStreamMultipartUpload = jest.fn();
const mockNotifyHaptic = jest.fn();
const mockImpactHaptic = jest.fn();
const mockRandomUUID = jest.fn();

let latestShareUpload;
let mockAuth;

const mockServer = {
  api: {
    get: mockApiGet,
    post: mockApiPost,
  },
  serverIP: 'https://pond.example',
  isConnected: true,
  getBaseUrl: () => 'https://pond.example/api',
};

jest.mock('../ServerContext', () => ({
  useServer: () => mockServer,
  getApiAuthToken: () => 'token-7',
}));
jest.mock('../AuthContext', () => ({
  useAuth: () => mockAuth,
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => mockRandomUUID(),
}));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///app-cache/',
  EncodingType: { Base64: 'base64' },
  FileSystemUploadType: { MULTIPART: 'multipart' },
  getInfoAsync: (...args) => mockGetInfoAsync(...args),
  makeDirectoryAsync: (...args) => mockMakeDirectoryAsync(...args),
  copyAsync: (...args) => mockCopyAsync(...args),
  deleteAsync: (...args) => mockDeleteAsync(...args),
  readAsStringAsync: (...args) => mockReadAsStringAsync(...args),
  writeAsStringAsync: (...args) => mockWriteAsStringAsync(...args),
  readDirectoryAsync: (...args) => mockReadDirectoryAsync(...args),
  getFreeDiskStorageAsync: (...args) => mockGetFreeDiskStorageAsync(...args),
}));
jest.mock('../../services/streamMultipartUpload', () => ({
  streamMultipartUpload: (...args) => mockStreamMultipartUpload(...args),
}), { virtual: true });
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../ThemeContext', () => ({
  useTheme: () => ({
    isDark: false,
    theme: {
      colors: {
        background: '#000',
        surface: '#111',
        surfaceElevated: '#181818',
        border: '#333',
        textPrimary: '#fff',
        textSecondary: '#ccc',
        textMuted: '#888',
        primary: '#4f9',
        accentInfo: '#39f',
        accentSuccess: '#4f9',
        accentError: '#f55',
      },
    },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../utils/haptics', () => ({
  notifyHaptic: (...args) => mockNotifyHaptic(...args),
  impactHaptic: (...args) => mockImpactHaptic(...args),
  tapHaptic: jest.fn(),
}));

function Probe({ withToast = false }) {
  latestShareUpload = useShareUpload();
  return (
    <>
      <Text testID="jobs">{JSON.stringify(latestShareUpload.jobs)}</Text>
      {withToast ? <ShareUploadToast /> : null}
    </>
  );
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const queuedUpload = (jobId) => ({
  status: 202,
  body: JSON.stringify({ success: true, queued: true, jobId }),
});

function audioDestinationOnPress(view) {
  let fiber = view.getByLabelText('Audio - just the sound').unstable_fiber;
  while (fiber) {
    if (typeof fiber.memoizedProps?.onPress === 'function') {
      return fiber.memoizedProps.onPress;
    }
    fiber = fiber.return;
  }
  throw new Error('Expected the Audio destination to expose an onPress handler');
}

async function renderTarget(shareIntent, { boards } = {}) {
  mockApiGet.mockResolvedValueOnce({
    boards: boards || [
      { kind: 'album', name: 'Audio', isPinned: true },
      { kind: 'tag', name: 'Recipes', isPinned: true },
    ],
  });
  const onDismiss = jest.fn();
  const view = await render(
    <ShareUploadProvider>
      <ShareTargetScreen shareIntent={shareIntent} onDismiss={onDismiss} />
      <Probe />
    </ShareUploadProvider>
  );
  await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
  view.onDismiss = onDismiss;
  return view;
}

describe('ShareTargetScreen Audio destination', () => {
  beforeEach(() => {
    latestShareUpload = null;
    mockAuth = {
      isAuthenticated: true,
      token: 'token-7',
      authIdentity: 'sub:account-a',
      authGeneration: 'generation-a',
    };
    jest.clearAllMocks();
    mockRandomUUID
      .mockReturnValueOnce('client-import-1')
      .mockReturnValueOnce('client-import-2')
      .mockReturnValue('client-import-extra');
    mockStreamMultipartUpload.mockReset();
    mockGetInfoAsync.mockResolvedValue({ exists: true });
    mockMakeDirectoryAsync.mockResolvedValue(undefined);
    mockCopyAsync.mockResolvedValue(undefined);
    mockDeleteAsync.mockResolvedValue(undefined);
    mockReadAsStringAsync.mockResolvedValue('base64-image');
    mockWriteAsStringAsync.mockResolvedValue(undefined);
    mockReadDirectoryAsync.mockResolvedValue([]);
    mockGetFreeDiskStorageAsync.mockResolvedValue(10 * 1024 * 1024 * 1024);
  });

  test.each([
    [{ files: [{ path: 'file:///os/song.mp3', fileName: 'song.mp3', mimeType: 'audio/mpeg' }] }],
    [{ files: [{ path: 'file:///os/movie.mov', fileName: 'movie.mov', mimeType: 'video/quicktime' }] }],
    [{ webUrl: 'https://example.com/watch?v=7' }],
  ])('shows one first-class Audio row for a supported media import source', async (shareIntent) => {
    const view = await renderTarget(shareIntent);

    expect(view.getByText('Just the sound')).toBeTruthy();
    expect(view.getAllByText('Audio')).toHaveLength(1);
  });

  test('does not offer any destination that can turn an unsupported file-only share into an empty payload', async () => {
    const view = await renderTarget({
      files: [{ path: 'file:///os/notes.pdf', fileName: 'notes.pdf', mimeType: 'application/pdf' }],
    });

    expect(view.queryByText('Just the sound')).toBeNull();
    expect(view.queryByText('Audio')).toBeNull();
    expect(view.queryByText('Recipes')).toBeNull();
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  test('copies an OS media reference into app storage before dismissing the share target', async () => {
    const copy = deferred();
    mockCopyAsync.mockReturnValueOnce(copy.promise);
    mockStreamMultipartUpload.mockResolvedValueOnce(queuedUpload('upload-job-1'));
    const view = await renderTarget({
      files: [{ path: 'file:///os/recording.m4a', fileName: 'recording.m4a', mimeType: 'audio/mp4' }],
    });

    fireEvent.press(view.getByText('Audio'));
    await waitFor(() => expect(mockCopyAsync).toHaveBeenCalledTimes(1));
    expect(view.onDismiss).not.toHaveBeenCalled();

    await act(async () => {
      copy.resolve();
    });
    await waitFor(() => expect(view.onDismiss).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(latestShareUpload.jobs[0]?.status).toBe('queued'));
    await act(async () => {
      latestShareUpload.dismissJob(latestShareUpload.jobs[0].id);
    });
  });

  test('keeps Audio staging single-flight across rapid and post-success presses', async () => {
    const copy = deferred();
    mockCopyAsync.mockReturnValueOnce(copy.promise);
    mockStreamMultipartUpload.mockResolvedValueOnce(queuedUpload('upload-job-single-flight'));
    const view = await renderTarget({
      files: [{ path: 'file:///os/recording.m4a', fileName: 'recording.m4a', mimeType: 'audio/mp4' }],
    });

    await act(() => {
      const onPress = audioDestinationOnPress(view);
      void onPress();
      void onPress();
    });

    await waitFor(() => expect(mockCopyAsync).toHaveBeenCalledTimes(1));
    expect(latestShareUpload.jobs).toHaveLength(1);
    expect(view.onDismiss).not.toHaveBeenCalled();
    expect(view.getByLabelText('Audio - just the sound').props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });

    await act(async () => {
      copy.resolve();
    });
    await waitFor(() => expect(latestShareUpload.jobs[0]?.status).toBe('queued'));
    expect(mockStreamMultipartUpload).toHaveBeenCalledTimes(1);
    expect(view.onDismiss).toHaveBeenCalledTimes(1);

    await act(() => {
      void audioDestinationOnPress(view)();
    });

    expect(mockCopyAsync).toHaveBeenCalledTimes(1);
    expect(mockStreamMultipartUpload).toHaveBeenCalledTimes(1);
    expect(latestShareUpload.jobs).toHaveLength(1);
    expect(view.onDismiss).toHaveBeenCalledTimes(1);
    await act(async () => {
      latestShareUpload.jobs.forEach((job) => latestShareUpload.dismissJob(job.id));
    });
  });

  test('re-enables Audio staging after a copy failure so the user can retry', async () => {
    const firstCopy = deferred();
    const retryUpload = deferred();
    mockCopyAsync
      .mockReturnValueOnce(firstCopy.promise)
      .mockResolvedValueOnce(undefined);
    mockStreamMultipartUpload.mockReturnValueOnce(retryUpload.promise);
    const view = await renderTarget({
      files: [{ path: 'file:///os/retry.m4a', fileName: 'retry.m4a', mimeType: 'audio/mp4' }],
    });

    fireEvent.press(view.getByText('Just the sound'));
    await waitFor(() => expect(mockCopyAsync).toHaveBeenCalledTimes(1));

    await act(async () => {
      firstCopy.reject(new Error('copy failed'));
    });
    await waitFor(() =>
      expect(view.getByLabelText('Audio - just the sound').props.accessibilityState).toEqual({
        busy: false,
        disabled: false,
      })
    );
    expect(view.onDismiss).not.toHaveBeenCalled();

    fireEvent.press(view.getByText('Just the sound'));
    await waitFor(() => expect(view.onDismiss).toHaveBeenCalledTimes(1));
    expect(mockCopyAsync).toHaveBeenCalledTimes(2);
    expect(mockStreamMultipartUpload).toHaveBeenCalledTimes(1);
    await act(async () => {
      retryUpload.resolve(queuedUpload('upload-job-after-retry'));
    });
    await waitFor(() =>
      expect(latestShareUpload.jobs.some((job) => job.status === 'queued')).toBe(true)
    );
    await act(async () => {
      latestShareUpload.jobs.forEach((job) => latestShareUpload.dismissJob(job.id));
    });
  });

  test('ignores late Audio staging completion after the share target unmounts', async () => {
    const copy = deferred();
    mockCopyAsync.mockReturnValueOnce(copy.promise);
    mockStreamMultipartUpload.mockReturnValueOnce(new Promise(() => {}));
    const view = await renderTarget({
      files: [{ path: 'file:///os/late.m4a', fileName: 'late.m4a', mimeType: 'audio/mp4' }],
    });

    fireEvent.press(view.getByText('Just the sound'));
    await waitFor(() => expect(mockCopyAsync).toHaveBeenCalledTimes(1));
    await view.rerender(
      <ShareUploadProvider>
        <Probe />
      </ShareUploadProvider>
    );

    await act(async () => {
      copy.resolve();
    });

    expect(view.onDismiss).not.toHaveBeenCalled();
    expect(mockNotifyHaptic).not.toHaveBeenCalledWith('success');
  });

  test('routes URL-only Audio selection through the existing share body and accepts downloadJobId as queued', async () => {
    const pending = deferred();
    mockApiPost.mockReturnValueOnce(pending.promise);
    const view = await renderTarget({ webUrl: 'https://example.com/not-media-by-extension' });

    fireEvent.press(view.getByText('Audio'));

    await waitFor(() =>
      expect(mockApiPost).toHaveBeenCalledWith('/share', {
        board: { kind: 'album', name: 'Audio' },
        payload: { text: undefined, url: 'https://example.com/not-media-by-extension' },
        channel: expect.stringMatching(/^(ios|android)-share$/),
      })
    );
    expect(view.onDismiss).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ success: true, downloadJobId: 'download-job-1' });
    });
    await waitFor(() => expect(latestShareUpload.jobs[0]?.status).toBe('queued'));
    await act(async () => {
      latestShareUpload.dismissJob(latestShareUpload.jobs[0].id);
    });
  });
});

describe('ShareUploadProvider audio imports', () => {
  beforeEach(() => {
    latestShareUpload = null;
    mockAuth = {
      isAuthenticated: true,
      token: 'token-7',
      authIdentity: 'sub:account-a',
      authGeneration: 'generation-a',
    };
    jest.clearAllMocks();
    mockRandomUUID
      .mockReturnValueOnce('client-import-1')
      .mockReturnValueOnce('client-import-2')
      .mockReturnValue('client-import-extra');
    mockStreamMultipartUpload.mockReset();
    mockGetInfoAsync.mockResolvedValue({ exists: true });
    mockMakeDirectoryAsync.mockResolvedValue(undefined);
    mockCopyAsync.mockResolvedValue(undefined);
    mockDeleteAsync.mockResolvedValue(undefined);
    mockWriteAsStringAsync.mockResolvedValue(undefined);
    mockReadDirectoryAsync.mockResolvedValue([]);
    mockGetFreeDiskStorageAsync.mockResolvedValue(10 * 1024 * 1024 * 1024);
  });

  test('streams supported audio and video files sequentially with exact Audio multipart parameters', async () => {
    const firstUpload = deferred();
    mockStreamMultipartUpload
      .mockReturnValueOnce(firstUpload.promise)
      .mockResolvedValueOnce(queuedUpload('upload-job-2'));
    const view = await render(
      <ShareUploadProvider>
        <Probe withToast />
      </ShareUploadProvider>
    );
    const files = [
      { path: 'file:///os/song.m4a', fileName: 'song.m4a', mimeType: 'audio/mp4' },
      { path: 'file:///os/clip.mp4', fileName: 'clip.mp4', mimeType: 'video/mp4' },
      { path: 'file:///os/notes.pdf', fileName: 'notes.pdf', mimeType: 'application/pdf' },
    ];

    let id;
    await act(async () => {
      id = await latestShareUpload.enqueueAudioShare({ mediaFiles: files });
    });

    expect(mockCopyAsync).toHaveBeenCalledTimes(2);
    expect(mockStreamMultipartUpload).toHaveBeenCalledTimes(1);
    expect(view.getByText('Sending to Music Vault…')).toBeTruthy();
    expect(view.getByText('0/2 files')).toBeTruthy();
    expect(mockStreamMultipartUpload).toHaveBeenNthCalledWith(1, {
      url: 'https://pond.example/api/media/upload',
      fileUri: expect.stringMatching(/^file:\/\/\/app-cache\/TurtleShareUploads\//),
      mimeType: 'audio/mp4',
      parameters: {
        outputKind: 'audio',
        album: 'Audio',
        tags: '["Audio"]',
        originalName: 'song.m4a',
        clientImportId: 'client-import-1',
      },
      token: 'token-7',
      label: 'song.m4a',
      onProgress: expect.any(Function),
      signal: expect.any(Object),
    });

    await act(async () => {
      firstUpload.resolve(queuedUpload('upload-job-1'));
    });
    await waitFor(() => expect(mockStreamMultipartUpload).toHaveBeenCalledTimes(2));
    expect(mockStreamMultipartUpload).toHaveBeenNthCalledWith(2, {
      url: 'https://pond.example/api/media/upload',
      fileUri: expect.stringMatching(/^file:\/\/\/app-cache\/TurtleShareUploads\//),
      mimeType: 'video/mp4',
      parameters: {
        outputKind: 'audio',
        album: 'Audio',
        tags: '["Audio"]',
        originalName: 'clip.mp4',
        clientImportId: 'client-import-2',
      },
      token: 'token-7',
      label: 'clip.mp4',
      onProgress: expect.any(Function),
      signal: expect.any(Object),
    });
    await waitFor(() =>
      expect(latestShareUpload.jobs.find((job) => job.id === id)).toEqual(
        expect.objectContaining({ status: 'queued', done: 2, total: 2 })
      )
    );
    await act(async () => {
      latestShareUpload.dismissJob(id);
    });
  });

  test('retains app-owned copies after failure and reuses them on retry', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockStreamMultipartUpload
      .mockResolvedValueOnce({
        status: 202,
        body: JSON.stringify({ success: true, queued: true }),
      })
      .mockResolvedValueOnce(queuedUpload('upload-job-retry'));
    await render(
      <ShareUploadProvider>
        <Probe />
      </ShareUploadProvider>
    );
    const mediaFile = {
      path: 'file:///os/interview.wav',
      fileName: 'interview.wav',
      mimeType: 'audio/wav',
    };

    let id;
    await act(async () => {
      id = await latestShareUpload.enqueueAudioShare({ mediaFiles: [mediaFile] });
    });
    await waitFor(() =>
      expect(latestShareUpload.jobs.find((job) => job.id === id)?.status).toBe('error')
    );
    const retainedUri = mockStreamMultipartUpload.mock.calls[0][0].fileUri;
    expect(mockDeleteAsync).not.toHaveBeenCalledWith(retainedUri, expect.anything());

    await act(async () => {
      latestShareUpload.retryJob(id);
    });
    await waitFor(() => expect(mockStreamMultipartUpload).toHaveBeenCalledTimes(2));
    expect(mockStreamMultipartUpload.mock.calls[1][0].fileUri).toBe(retainedUri);
    expect(mockStreamMultipartUpload.mock.calls[1][0].parameters.clientImportId).toBe(
      mockStreamMultipartUpload.mock.calls[0][0].parameters.clientImportId
    );
    expect(mockCopyAsync).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(latestShareUpload.jobs.find((job) => job.id === id)?.status).toBe('queued')
    );
    await act(async () => {
      latestShareUpload.dismissJob(id);
    });
    warn.mockRestore();
  });

  test('aborts Account A transport and clears it instead of using Account B token', async () => {
    const upload = deferred();
    mockStreamMultipartUpload.mockReturnValueOnce(upload.promise);
    const view = await render(
      <ShareUploadProvider>
        <Probe />
      </ShareUploadProvider>
    );

    await act(async () => {
      await latestShareUpload.enqueueAudioShare({
        mediaFiles: [
          { path: 'file:///os/song.mp3', fileName: 'song.mp3', mimeType: 'audio/mpeg' },
        ],
      });
    });
    await waitFor(() => expect(mockStreamMultipartUpload).toHaveBeenCalledTimes(1));
    const accountAUpload = mockStreamMultipartUpload.mock.calls[0][0];
    expect(accountAUpload.token).toBe('token-7');

    mockAuth = {
      isAuthenticated: true,
      token: 'token-b',
      authIdentity: 'sub:account-b',
      authGeneration: 'generation-b',
    };
    await view.rerender(
      <ShareUploadProvider>
        <Probe />
      </ShareUploadProvider>
    );

    await waitFor(() => expect(latestShareUpload.jobs).toEqual([]));
    expect(accountAUpload.signal.aborted).toBe(true);

    await act(async () => {
      upload.resolve(queuedUpload('late-account-a-job'));
    });
    expect(latestShareUpload.jobs).toEqual([]);
    expect(mockStreamMultipartUpload).toHaveBeenCalledTimes(1);
  });

  test('restores a process-death manifest as an owner-bound retry with the same import id', async () => {
    mockReadDirectoryAsync.mockResolvedValueOnce(['restored-job']);
    mockGetInfoAsync.mockResolvedValue({
      exists: true,
      isDirectory: true,
      modificationTime: Date.now() / 1000,
    });
    mockReadAsStringAsync.mockImplementation(async (uri) => {
      if (String(uri).endsWith('/manifest.json')) {
        return JSON.stringify({
          version: 1,
          id: 'restored-job',
          ownerIdentity: 'sub:account-a',
          authGeneration: 'old-generation',
          status: 'error',
          total: 1,
          done: 0,
          backendJobIds: [],
          media: [{
            localPath: 'file:///app-cache/TurtleShareUploads/restored-job/0/song.mp3',
            filename: 'song.mp3',
            mimeType: 'audio/mpeg',
            sent: false,
            clientImportId: 'stable-process-death-id',
          }],
        });
      }
      return 'base64-image';
    });
    mockStreamMultipartUpload.mockResolvedValueOnce(queuedUpload('restored-backend-job'));
    await render(
      <ShareUploadProvider>
        <Probe />
      </ShareUploadProvider>
    );

    await waitFor(() =>
      expect(latestShareUpload.jobs).toEqual([
        expect.objectContaining({ id: 'restored-job', status: 'error' }),
      ])
    );
    await act(async () => {
      latestShareUpload.retryJob('restored-job');
    });
    await waitFor(() => expect(mockStreamMultipartUpload).toHaveBeenCalledTimes(1));

    expect(mockStreamMultipartUpload.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        token: 'token-7',
        parameters: expect.objectContaining({
          clientImportId: 'stable-process-death-id',
        }),
      })
    );
    await waitFor(() =>
      expect(latestShareUpload.jobs[0]?.status).toBe('queued')
    );
    await act(async () => {
      latestShareUpload.dismissJob('restored-job');
    });
  });

  test('does not surface a URL import as queued without downloadJobId', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockApiPost.mockResolvedValueOnce({ success: true });
    await render(
      <ShareUploadProvider>
        <Probe />
      </ShareUploadProvider>
    );

    let id;
    await act(async () => {
      id = await latestShareUpload.enqueueAudioShare({
        url: 'https://example.com/watch?v=9',
      });
    });

    await waitFor(() =>
      expect(latestShareUpload.jobs.find((job) => job.id === id)).toEqual(
        expect.objectContaining({
          status: 'error',
          message: null,
          error: 'Server did not queue the Music Vault import.',
        })
      )
    );
    await act(async () => {
      latestShareUpload.dismissJob(id);
    });
    error.mockRestore();
  });

  test('surfaces accepted Audio jobs as Queued for Music Vault', async () => {
    mockStreamMultipartUpload.mockResolvedValueOnce(queuedUpload('upload-job-1'));
    const view = await render(
      <ShareUploadProvider>
        <Probe withToast />
      </ShareUploadProvider>
    );

    let id;
    await act(async () => {
      id = await latestShareUpload.enqueueAudioShare({
        mediaFiles: [
          { path: 'file:///os/song.mp3', fileName: 'song.mp3', mimeType: 'audio/mpeg' },
        ],
      });
    });

    await waitFor(() => expect(latestShareUpload.jobs[0]?.status).toBe('queued'));
    expect(latestShareUpload.jobs[0]?.message).toBe('Queued for Music Vault');
    expect(view.getByText('Queued for Music Vault')).toBeTruthy();
    await act(async () => {
      latestShareUpload.dismissJob(id);
    });
  });
});

describe('existing share behavior', () => {
  beforeEach(() => {
    latestShareUpload = null;
    mockAuth = {
      isAuthenticated: true,
      token: 'token-7',
      authIdentity: 'sub:account-a',
      authGeneration: 'generation-a',
    };
    jest.clearAllMocks();
    mockGetInfoAsync.mockResolvedValue({ exists: true });
    mockMakeDirectoryAsync.mockResolvedValue(undefined);
    mockCopyAsync.mockResolvedValue(undefined);
    mockDeleteAsync.mockResolvedValue(undefined);
    mockReadAsStringAsync.mockResolvedValue('base64-image');
    mockWriteAsStringAsync.mockResolvedValue(undefined);
    mockReadDirectoryAsync.mockResolvedValue([]);
    mockGetFreeDiskStorageAsync.mockResolvedValue(10 * 1024 * 1024 * 1024);
  });

  test.each([
    [{ text: 'Remember the pond' }, { text: 'Remember the pond', url: undefined }],
    [{ webUrl: 'https://example.com/article' }, { text: undefined, url: 'https://example.com/article' }],
  ])('keeps text and ordinary link shares on /api/share', async (shareIntent, payload) => {
    const pending = deferred();
    mockApiPost.mockReturnValueOnce(pending.promise);
    const view = await renderTarget(shareIntent);

    fireEvent.press(view.getByText('Recipes'));

    await waitFor(() =>
      expect(mockApiPost).toHaveBeenCalledWith('/share', {
        board: { kind: 'tag', name: 'Recipes' },
        payload,
        channel: expect.stringMatching(/^(ios|android)-share$/),
      })
    );
    expect(view.onDismiss).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ success: true });
    });
    await waitFor(() => expect(latestShareUpload.jobs[0]?.status).toBe('success'));
    await act(async () => {
      latestShareUpload.dismissJob(latestShareUpload.jobs[0].id);
    });
  });

  test('keeps image shares on the sequential base64 /api/share path', async () => {
    const pending = deferred();
    mockApiPost.mockReturnValueOnce(pending.promise);
    const image = {
      path: 'file:///os/turtle.jpg',
      fileName: 'turtle.jpg',
      mimeType: 'image/jpeg',
    };
    const view = await renderTarget({ files: [image], text: 'Turtle' });

    fireEvent.press(view.getByText('Recipes'));

    await waitFor(() => expect(mockReadAsStringAsync).toHaveBeenCalled());
    expect(mockApiPost).toHaveBeenCalledWith(
      '/share',
      expect.objectContaining({
        board: { kind: 'tag', name: 'Recipes' },
        payload: {
          text: 'Turtle',
          url: undefined,
          images: [{
            filename: 'turtle.jpg',
            mimeType: 'image/jpeg',
            dataBase64: 'base64-image',
          }],
        },
      })
    );
    expect(view.onDismiss).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ success: true, mediaIds: ['media-1'] });
    });
    await waitFor(() => expect(latestShareUpload.jobs[0]?.status).toBe('success'));
    await act(async () => {
      latestShareUpload.dismissJob(latestShareUpload.jobs[0].id);
    });
  });
});
