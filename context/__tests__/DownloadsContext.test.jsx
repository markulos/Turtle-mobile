import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { DownloadsProvider, useDownloads } from '../DownloadsContext';

const mockIo = jest.fn();
const mockApiGet = jest.fn();
let mockAuth;

jest.mock('socket.io-client', () => ({
  io: (...args) => mockIo(...args),
}));
jest.mock('../ServerContext', () => ({
  useServer: () => ({
    serverIP: 'pond.example',
    isConnected: false,
    api: {
      get: (...args) => mockApiGet(...args),
      post: jest.fn(),
      delete: jest.fn(),
    },
  }),
  serverOrigin: () => 'https://pond.example',
  getApiAuthToken: () => mockAuth?.token,
}));
jest.mock('../AuthContext', () => ({
  useAuth: () => mockAuth,
}));

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const makeSocket = () => {
  const handlers = new Map();
  return {
    connected: true,
    on: jest.fn((event, handler) => handlers.set(event, handler)),
    emit: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    removeAllListeners: jest.fn(() => handlers.clear()),
    handler: (event) => handlers.get(event),
  };
};

function Probe() {
  const { jobs } = useDownloads();
  return <Text testID="jobs">{JSON.stringify(jobs)}</Text>;
}

describe('DownloadsProvider authentication transitions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIo.mockReset();
    mockAuth = {
      isAuthenticated: true,
      token: 'token-a',
      authIdentity: 'sub:account-a',
      authGeneration: 'generation-a',
    };
  });

  test('disconnects A, clears A jobs, and reconnects with B current token', async () => {
    const socketA = makeSocket();
    const socketB = makeSocket();
    mockIo.mockReturnValueOnce(socketA).mockReturnValueOnce(socketB);
    const view = await render(
      <DownloadsProvider>
        <Probe />
      </DownloadsProvider>
    );
    const staleAJobHandler = socketA.handler('download:job');

    await act(async () => {
      staleAJobHandler({ id: 'a-job', status: 'downloading' });
    });
    expect(view.getByTestId('jobs').props.children).toContain('a-job');

    mockAuth = {
      isAuthenticated: true,
      token: 'token-b',
      authIdentity: 'sub:account-b',
      authGeneration: 'generation-b',
    };
    await view.rerender(
      <DownloadsProvider>
        <Probe />
      </DownloadsProvider>
    );

    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(2));
    expect(socketA.disconnect).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('jobs').props.children).toBe('[]');
    expect(mockIo).toHaveBeenLastCalledWith(
      'https://pond.example',
      expect.objectContaining({ auth: { token: 'token-b' } })
    );

    await act(async () => {
      staleAJobHandler({ id: 'late-a-job', status: 'downloading' });
    });
    expect(view.getByTestId('jobs').props.children).toBe('[]');
    expect(socketA.emit).not.toHaveBeenCalled();
    expect(socketB.emit).not.toHaveBeenCalled();
  });

  test('ignores Account A refresh response after Account B takes ownership', async () => {
    const socketA = makeSocket();
    const socketB = makeSocket();
    mockIo.mockReturnValueOnce(socketA).mockReturnValueOnce(socketB);
    const accountARefresh = deferred();
    mockApiGet.mockReturnValueOnce(accountARefresh.promise).mockResolvedValueOnce({ jobs: [] });
    const view = await render(
      <DownloadsProvider>
        <Probe />
      </DownloadsProvider>
    );

    await act(async () => {
      socketA.handler('connect')();
    });
    mockAuth = {
      isAuthenticated: true,
      token: 'token-b',
      authIdentity: 'sub:account-b',
      authGeneration: 'generation-b',
    };
    await view.rerender(
      <DownloadsProvider>
        <Probe />
      </DownloadsProvider>
    );

    await act(async () => {
      accountARefresh.resolve({ jobs: [{ id: 'late-a-job', status: 'queued' }] });
    });

    expect(view.getByTestId('jobs').props.children).toBe('[]');
  });
});
