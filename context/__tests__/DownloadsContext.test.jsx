import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { DownloadsProvider, useDownloads, useSyncSignals } from '../DownloadsContext';

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
// The dismissed-ended-card memory lives with the timer now, so the provider
// reads and writes one AsyncStorage key. A Map, so persistence is real.
const mockStore = new Map();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((k) => Promise.resolve(mockStore.has(k) ? mockStore.get(k) : null)),
  setItem: jest.fn((k, v) => { mockStore.set(k, v); return Promise.resolve(); }),
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

describe('DownloadsProvider pomodoro view', () => {
  // The timer as the user should see it, plus the one dismissal, live here
  // now (they used to be the Turtle tab's), so that the app-level Live
  // Activity driver and the card can never disagree.
  let signals;
  function SyncProbe() {
    signals = useSyncSignals();
    return <Text testID="view">{JSON.stringify(signals.pomodoroView)}</Text>;
  }
  const completed = (startedAt, endedAt) => ({
    status: 'completed', mode: 'focus', totalDuration: 1500,
    serverNow: endedAt, startedAt, endedAt,
  });
  const shown = (view) => JSON.parse(view.getByTestId('view').props.children);

  beforeEach(() => {
    jest.clearAllMocks();
    mockIo.mockReset();
    mockStore.clear();
    mockAuth = {
      isAuthenticated: true,
      token: 'token-a',
      authIdentity: 'sub:account-a',
      authGeneration: 'generation-a',
    };
  });

  test('dismissing the ended card hides it, remembers it, and keeps the pond replay of it hidden — but not a NEW completion', async () => {
    const socket = makeSocket();
    mockIo.mockReturnValue(socket);
    const view = await render(
      <DownloadsProvider>
        <SyncProbe />
      </DownloadsProvider>
    );
    const first = completed(1000, 2500);
    await act(async () => { socket.handler('pomodoro-state')(first); });
    expect(shown(view).status).toBe('completed');

    await act(async () => { signals.dismissEndedTimer(); });
    expect(shown(view)).toBeNull();
    expect(mockStore.get('pomodoroDismissedEndedId')).toBe('focus:1000:2500');

    // The pond replays its last ended state on every connect.
    await act(async () => { socket.handler('pomodoro-state')(first); });
    expect(shown(view)).toBeNull();

    await act(async () => { socket.handler('pomodoro-state')(completed(5000, 6500)); });
    expect(shown(view).status).toBe('completed');
  });

  test('the dismissal survives a reload: the identity restored from disk hides the replayed card, never a running block', async () => {
    mockStore.set('pomodoroDismissedEndedId', 'focus:1000:2500');
    const socket = makeSocket();
    mockIo.mockReturnValue(socket);
    const view = await render(
      <DownloadsProvider>
        <SyncProbe />
      </DownloadsProvider>
    );
    await act(async () => { socket.handler('pomodoro-state')(completed(1000, 2500)); });
    await waitFor(() => expect(shown(view)).toBeNull());

    await act(async () => {
      socket.handler('pomodoro-state')({
        status: 'active', mode: 'focus', totalDuration: 1500,
        serverNow: 9000, startedAt: 9000, endsAt: 10500,
      });
    });
    expect(shown(view).status).toBe('active');
  });
});
