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

  test('a focus:changed push is exposed raw, with the moment it arrived, and cleared when the account changes', async () => {
    const socket = makeSocket();
    mockIo.mockReturnValue(socket);
    let latest;
    function PushProbe() {
      latest = useSyncSignals().focusPush;
      return null;
    }
    const view = await render(
      <DownloadsProvider>
        <PushProbe />
      </DownloadsProvider>
    );
    expect(latest).toBeNull();
    const payload = { kind: 'started', session: { id: 'p1', taskId: 't1', startedAt: 1000, durationMinutes: 25, status: 'in_progress' }, serverNow: 2000 };
    const before = Date.now();
    await act(async () => { socket.handler('focus:changed')(payload); });
    expect(latest.payload).toEqual(payload);
    expect(latest.receivedAt).toBeGreaterThanOrEqual(before);

    mockAuth = { isAuthenticated: false, token: null, authIdentity: null, authGeneration: 'generation-out' };
    await view.rerender(
      <DownloadsProvider>
        <PushProbe />
      </DownloadsProvider>
    );
    await waitFor(() => expect(latest).toBeNull());
  });
});

/**
 * RECONNECTING IS A CATCH-UP.
 *
 * Every sync ping on this socket is fire-and-forget: `message:new`,
 * `tasks:changed`, `notes:changed`, the media bump. socket.io replays none of
 * them, and the app deliberately disconnects whenever it backgrounds — so
 * everything that happened in that window is gone.
 *
 * The bug that made this worth pinning: a direct message arrived while the
 * phone was asleep. The PUSH landed (that goes through APNs, nothing to do
 * with this socket), the user opened the app with the thread already mounted,
 * and the thread sat there showing the conversation as it was — because
 * nothing had told it otherwise. Leaving the chat and coming back re-ran its
 * mount fetch, which is exactly the "I have to reload it" workaround.
 */
function SignalsProbe() {
  const { messagesVersion, messagesPing, tasksVersion, notesVersion } = useSyncSignals();
  return (
    <Text testID="signals">
      {JSON.stringify({ messagesVersion, messagesPing, tasksVersion, notesVersion })}
    </Text>
  );
}

describe('a reconnect catches up on everything the socket missed', () => {
  const signals = (view) => JSON.parse(view.getByTestId('signals').props.children);

  const boot = async () => {
    const socket = makeSocket();
    mockIo.mockReturnValue(socket);
    const view = await render(
      <DownloadsProvider>
        <SignalsProbe />
      </DownloadsProvider>
    );
    return { socket, view };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockIo.mockReset();
    mockApiGet.mockResolvedValue({ jobs: [] });
    mockAuth = {
      isAuthenticated: true,
      token: 'token-a',
      authIdentity: 'sub:account-a',
      authGeneration: 'generation-a',
    };
  });

  test('the FIRST connect bumps nothing — every screen already loads on mount', async () => {
    const { socket, view } = await boot();
    await act(async () => { socket.handler('connect')(); });
    expect(signals(view)).toMatchObject({ messagesVersion: 0, tasksVersion: 0, notesVersion: 0 });
  });

  test('a RECONNECT bumps the counters, so a mounted screen refetches', async () => {
    const { socket, view } = await boot();
    await act(async () => { socket.handler('connect')(); });
    await act(async () => { socket.handler('connect')(); });
    const after = signals(view);
    expect(after.messagesVersion).toBe(1);
    expect(after.tasksVersion).toBe(1);
    expect(after.notesVersion).toBe(1);
  });

  test('it CLEARS the last message ping, or the catch-up skips the open thread', async () => {
    // The thread only refetches when the ping names the person it is showing.
    // A stale ping naming somebody else would make a reconnect bump arrive
    // with the wrong name on it and be filtered straight out — the catch-up
    // would fire and the one conversation being looked at would not reload.
    const { socket, view } = await boot();
    await act(async () => { socket.handler('connect')(); });
    await act(async () => { socket.handler('message:new')({ withUserId: 'someone-else', at: 5 }); });
    expect(signals(view).messagesPing).toMatchObject({ withUserId: 'someone-else' });

    await act(async () => { socket.handler('connect')(); });
    expect(signals(view).messagesPing).toBeNull();
    expect(signals(view).messagesVersion).toBe(2);
  });

  test('a live message still names who it is from', async () => {
    // The catch-up clears the name; an ordinary ping must not, or every
    // message in the pond would cost every open thread a round trip.
    const { socket, view } = await boot();
    await act(async () => { socket.handler('message:new')({ withUserId: 'friend-1', at: 7 }); });
    expect(signals(view)).toMatchObject({
      messagesVersion: 1,
      messagesPing: { withUserId: 'friend-1', at: 7 },
    });
  });
});
