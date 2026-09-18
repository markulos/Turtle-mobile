import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  VaultUploadProvider,
  useVaultUploadActions,
  useVaultUploadState,
} from '../VaultUploadContext';

const mockStreamMultipartUpload = jest.fn();
const mockRandomUUID = jest.fn();
let mockAuth;
let latestActions;
let latestState;

jest.mock('../AuthContext', () => ({
  useAuth: () => mockAuth,
}));
jest.mock('../ServerContext', () => ({
  useServer: () => ({ getBaseUrl: () => 'https://pond.example/api' }),
  getApiAuthToken: () => 'legacy-global-token',
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => mockRandomUUID(),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 1024 }),
  readAsStringAsync: jest.fn().mockResolvedValue('thumbnail'),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  getAssetInfoAsync: jest.fn().mockImplementation(async (id) => ({
    localUri: `file:///library/${id}.jpg`,
    creationTime: 100,
    width: 100,
    height: 100,
  })),
  deleteAssetsAsync: jest.fn().mockResolvedValue(true),
}));
jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));
jest.mock('../../services/streamMultipartUpload', () => ({
  streamMultipartUpload: (...args) => mockStreamMultipartUpload(...args),
}));
const mockReportUploadIssue = jest.fn();
jest.mock('../../services/uploadDiagnostics', () => ({
  reportUploadIssue: (...args) => mockReportUploadIssue(...args),
}));
const mockScheduleUploadDrain = jest.fn().mockResolvedValue(true);
const mockCancelUploadDrain = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/cameraRollAutoUpload', () => ({
  subscribeAutoUpload: jest.fn(() => () => {}),
  runAutoUpload: jest.fn(() => Promise.resolve(0)),
}));
jest.mock('../../services/backgroundUploadTask', () => ({
  registerUploadWorker: jest.fn(),
  registerAutoUploadScanner: jest.fn(),
  scheduleUploadDrain: (...args) => mockScheduleUploadDrain(...args),
  cancelUploadDrain: (...args) => mockCancelUploadDrain(...args),
}));
jest.mock('../../services/uploadNotify', () => ({
  notifyUploadComplete: jest.fn(),
  updateUploadProgress: jest.fn(),
  clearUploadProgress: jest.fn(),
}));
jest.mock('../../utils/haptics', () => ({
  notifyHaptic: jest.fn(),
}));

function Probe() {
  latestActions = useVaultUploadActions();
  latestState = useVaultUploadState();
  return <Text testID="state">{JSON.stringify(latestState.state)}</Text>;
}

describe('VaultUploadProvider background fan-out (phase 1)', () => {
  let appStateListener = null;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { AppState } = require('react-native');
    AppState.currentState = 'active';
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
      appStateListener = fn;
      return { remove: () => { appStateListener = null; } };
    });
    mockAuth = { isAuthenticated: true, token: 'token-a', authIdentity: 'sub:account-a', authGeneration: 'generation-a' };
    let n = 0;
    mockRandomUUID.mockImplementation(() => `import-${++n}`);
    // Uploads stay OPEN until cancelled (the reconcile aborts them).
    mockStreamMultipartUpload.mockImplementation(({ signal }) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('Upload cancelled')));
    }));
    global.fetch = jest.fn().mockImplementation(async (_url, init) => {
      const items = JSON.parse(init.body).items;
      return { json: async () => ({ success: true, results: items.map(() => ({ duplicate: false })) }) };
    });
  });
  afterEach(() => { jest.restoreAllMocks(); });

  test('on return, items the pond already has are settled as uploaded and the batch finishes', async () => {
    await render(
      <VaultUploadProvider>
        <Probe />
      </VaultUploadProvider>
    );
    await act(async () => {
      latestActions.enqueue({ assets: ['a', 'b', 'c'].map(asset), tags: [] });
    });
    await waitFor(() => expect(mockStreamMultipartUpload).toHaveBeenCalledTimes(2));
    await act(async () => { appStateListener('background'); });
    await waitFor(() => expect(mockStreamMultipartUpload).toHaveBeenCalledTimes(3));

    // Time passes while the app sleeps; the pond receives all three, but the
    // tasks' completions never reach JavaScript.
    const realNow = Date.now;
    const later = realNow() + 30 * 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => later);
    global.fetch = jest.fn().mockImplementation(async (_url, init) => {
      const items = JSON.parse(init.body).items;
      return { json: async () => ({ success: true, results: items.map((_it, i) => ({ duplicate: true, id: `m${i}` })) }) };
    });
    await act(async () => { appStateListener('active'); });

    await waitFor(() => expect(latestState.state.status).toBe('done'));
    expect(latestState.state.uploaded).toBe(3);
    expect(latestState.state.pct).toBe(100);
    expect(mockReportUploadIssue).toHaveBeenCalledWith('inflight-reconciled', expect.objectContaining({ landed: 3 }), expect.anything());
  });

  test('two at a time in the foreground; backgrounding hands the session the rest of the segment', async () => {
    await render(
      <VaultUploadProvider>
        <Probe />
      </VaultUploadProvider>
    );
    await act(async () => {
      latestActions.enqueue({ assets: ['a', 'b', 'c', 'd', 'e', 'f'].map(asset), tags: [] });
    });
    await waitFor(() => expect(mockStreamMultipartUpload).toHaveBeenCalledTimes(2));
    // Nothing more while the app is up: the pool holds at two.
    await new Promise((r) => setTimeout(r, 50));
    expect(mockStreamMultipartUpload).toHaveBeenCalledTimes(2);

    await act(async () => { appStateListener('background'); });
    await waitFor(() => expect(mockStreamMultipartUpload).toHaveBeenCalledTimes(6));

    // Every started item is checkpointed as in-flight, never as done.
    const lastSave = AsyncStorage.setItem.mock.calls.at(-1)[1];
    const saved = JSON.parse(lastSave);
    expect(saved.items.filter((it) => it.status === 'inflight')).toHaveLength(6);
    expect(saved.items.some((it) => it.status === 'uploaded')).toBe(false);
  });
});

const asset = (id) => ({
  assetId: id,
  uri: `file:///picker/${id}.jpg`,
  fileName: `${id}.jpg`,
  mimeType: 'image/jpeg',
  type: 'image',
});

describe('VaultUploadProvider ownership and idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockAuth = {
      isAuthenticated: true,
      token: 'token-a',
      authIdentity: 'sub:account-a',
      authGeneration: 'generation-a',
    };
    mockRandomUUID
      .mockReturnValueOnce('vault-import-1')
      .mockReturnValueOnce('vault-import-2')
      .mockReturnValue('vault-import-extra');
    mockStreamMultipartUpload.mockResolvedValue({ status: 201, body: '{"success":true}' });
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ success: true, results: [{ duplicate: false }, { duplicate: false }] }),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('persists under a per-user key and gives every file one distinct stable import id', async () => {
    await render(
      <VaultUploadProvider>
        <Probe />
      </VaultUploadProvider>
    );

    await act(async () => {
      latestActions.enqueue({ assets: [asset('one'), asset('two')], tags: ['Phone Uploads'] });
    });
    await waitFor(() => expect(mockStreamMultipartUpload).toHaveBeenCalledTimes(2));

    expect(mockStreamMultipartUpload.mock.calls[0][0].parameters.clientImportId).toBe(
      'vault-import-1'
    );
    expect(mockStreamMultipartUpload.mock.calls[1][0].parameters.clientImportId).toBe(
      'vault-import-2'
    );
    expect(mockStreamMultipartUpload.mock.calls[0][0].token).toBe('token-a');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      expect.stringContaining('sub%3Aaccount-a'),
      expect.not.stringContaining('token-a')
    );
  });

  test('aborts Account A upload and clears visible state on Account B transition', async () => {
    let resolveUpload;
    mockStreamMultipartUpload.mockImplementationOnce(
      () => new Promise((resolve) => { resolveUpload = resolve; })
    );
    const view = await render(
      <VaultUploadProvider>
        <Probe />
      </VaultUploadProvider>
    );
    await act(async () => {
      latestActions.enqueue({ assets: [asset('one')], tags: [] });
    });
    await waitFor(() => expect(mockStreamMultipartUpload).toHaveBeenCalledTimes(1));
    const accountAUpload = mockStreamMultipartUpload.mock.calls[0][0];

    mockAuth = {
      isAuthenticated: true,
      token: 'token-b',
      authIdentity: 'sub:account-b',
      authGeneration: 'generation-b',
    };
    await view.rerender(
      <VaultUploadProvider>
        <Probe />
      </VaultUploadProvider>
    );

    await waitFor(() => expect(latestState.state).toBeNull());
    expect(accountAUpload.signal.aborted).toBe(true);
    await act(async () => {
      resolveUpload({ status: 201, body: '{"success":true}' });
    });
    expect(latestState.state).toBeNull();
  });

  test('late Account A completion cannot unlock a duplicate Account B worker', async () => {
    let resolveAccountA;
    let resolveAccountB;
    mockStreamMultipartUpload
      .mockImplementationOnce(() => new Promise((resolve) => { resolveAccountA = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveAccountB = resolve; }));
    const view = await render(
      <VaultUploadProvider>
        <Probe />
      </VaultUploadProvider>
    );
    await act(async () => {
      latestActions.enqueue({ assets: [asset('a')], tags: [] });
    });
    await waitFor(() => expect(mockStreamMultipartUpload).toHaveBeenCalledTimes(1));

    mockAuth = {
      isAuthenticated: true,
      token: 'token-b',
      authIdentity: 'sub:account-b',
      authGeneration: 'generation-b',
    };
    await view.rerender(
      <VaultUploadProvider>
        <Probe />
      </VaultUploadProvider>
    );
    await waitFor(() => expect(latestState.state).toBeNull());
    await act(async () => {
      latestActions.enqueue({ assets: [asset('b')], tags: [] });
    });
    await waitFor(() => expect(mockStreamMultipartUpload).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveAccountA({ status: 201, body: '{"success":true}' });
    });
    await act(async () => {
      latestActions.resume();
    });

    expect(mockStreamMultipartUpload).toHaveBeenCalledTimes(2);
    expect(latestState.state?.status).toBe('uploading');
    await act(async () => {
      resolveAccountB({ status: 201, body: '{"success":true}' });
    });
  });

  test('rejects a mismatched owner found in a per-user resume record', async () => {
    AsyncStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        id: 'old-batch',
        ownerIdentity: 'sub:someone-else',
        authGeneration: 'generation-a',
        status: 'paused',
        items: [{ ...asset('one'), clientImportId: 'old-id', status: 'pending' }],
      })
    );

    await render(
      <VaultUploadProvider>
        <Probe />
      </VaultUploadProvider>
    );

    await waitFor(() => expect(AsyncStorage.removeItem).toHaveBeenCalled());
    expect(mockStreamMultipartUpload).not.toHaveBeenCalled();
    expect(latestState.state).toBeNull();
  });

  test('a batch enqueued with a folderId sends parameters.folderId on every file', async () => {
    await render(
      <VaultUploadProvider>
        <Probe />
      </VaultUploadProvider>
    );
    await act(async () => {
      latestActions.enqueue({ assets: [asset('one')], tags: [], folderId: 'fld_aaaaaaaaaaaa' });
    });
    await waitFor(() => expect(mockStreamMultipartUpload).toHaveBeenCalledTimes(1));

    expect(mockStreamMultipartUpload.mock.calls[0][0].parameters.folderId).toBe('fld_aaaaaaaaaaaa');
    expect(mockStreamMultipartUpload.mock.calls[0][0].parameters.tags).toBe(JSON.stringify(['Phone Uploads']));
  });
});
