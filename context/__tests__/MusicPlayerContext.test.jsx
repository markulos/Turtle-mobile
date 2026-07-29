import React from 'react';
import { AppState, Button, Text, View } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { MusicPlayerProvider, useMusicPlayer } from '../MusicPlayerContext';
import { musicPlayerService } from '../../services/musicPlayerService';

const mockApiGet = jest.fn();
const mockServer = {
  api: { get: mockApiGet },
  getBaseUrl: () => 'https://pond.example/api',
  getMediaBaseUrl: () => 'https://pond.example',
};
let mockAuthenticated = true;
let mockActiveTrack = null;
let mockPlaying = false;
let mockMediaVersion = 0;
let mockAuth = {
  isAuthenticated: true,
  authIdentity: 'sub:account-a',
  authGeneration: 'generation-a',
};
let mockAppStateHandler;

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

jest.mock('../ServerContext', () => ({
  useServer: () => mockServer,
}));
jest.mock('../AuthContext', () => ({
  useAuth: () => ({
    ...mockAuth,
    isAuthenticated: mockAuthenticated,
  }),
}));
jest.mock('../DownloadsContext', () => ({
  useMediaVersion: () => ({ mediaVersion: mockMediaVersion }),
}));
jest.mock('@rntp/player', () => ({
  useActiveMediaItem: () => mockActiveTrack,
  useIsPlaying: () => mockPlaying,
  useProgress: () => ({ position: 12, duration: 180 }),
}));
jest.mock('../../services/musicPlayerService', () => ({
  musicPlayerService: {
    ensureReady: jest.fn().mockResolvedValue(undefined),
    playQueue: jest.fn().mockResolvedValue(undefined),
    togglePlayback: jest.fn().mockResolvedValue(undefined),
    previous: jest.fn().mockResolvedValue(undefined),
    next: jest.fn().mockResolvedValue(undefined),
    seekTo: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  },
}));

function Probe({ visible = true }) {
  const music = useMusicPlayer();
  if (!visible) return null;
  return (
    <View>
      <Text testID="count">{music.tracks.length}</Text>
      <Text testID="first-track">{music.tracks[0]?.id || ''}</Text>
      <Text testID="error">{music.error || ''}</Text>
      <Text testID="setup-error">{music.setupError || ''}</Text>
      <Text testID="library-error">{music.libraryError || ''}</Text>
      <Text testID="loading">{String(music.loading)}</Text>
      <Text testID="ready">{String(music.ready)}</Text>
      <Text testID="position">{music.position}</Text>
      <Button title="play-two" onPress={() => music.playMedia('two')} />
      <Button title="refresh" onPress={() => music.refreshLibrary()} />
      <Button title="toggle" onPress={() => music.togglePlayback()} />
      <Button title="previous" onPress={() => music.previous()} />
      <Button title="next" onPress={() => music.next()} />
      <Button title="seek" onPress={() => music.seekTo(60)} />
      <Button title="retry-setup" onPress={() => music.retrySetup()} />
    </View>
  );
}

describe('MusicPlayerProvider', () => {
  beforeEach(() => {
    mockAuthenticated = true;
    mockActiveTrack = null;
    mockPlaying = false;
    mockMediaVersion = 0;
    mockAuth = {
      isAuthenticated: true,
      authIdentity: 'sub:account-a',
      authGeneration: 'generation-a',
    };
    mockAppStateHandler = null;
    jest.clearAllMocks();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((event, handler) => {
      if (event === 'change') mockAppStateHandler = handler;
      return { remove: jest.fn() };
    });
    musicPlayerService.ensureReady.mockResolvedValue(undefined);
    musicPlayerService.clear.mockResolvedValue(undefined);
    mockApiGet.mockResolvedValue({
      items: [
        { id: 'one', filename: 'one.mp3', rawUrl: '/media/one.mp3' },
        { id: 'two', filename: 'two.mp3', rawUrl: '/media/two.mp3' },
      ],
    });
  });

  test('keeps library state when the Music Vault consumer unmounts and remounts', async () => {
    const view = await render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    await waitFor(() => expect(view.getByTestId('count').props.children).toBe(2));

    await view.rerender(
      <MusicPlayerProvider>
        <Probe visible={false} />
      </MusicPlayerProvider>
    );
    await view.rerender(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );

    expect(view.getByTestId('count').props.children).toBe(2);
    expect(mockApiGet).toHaveBeenCalledTimes(1);
  });

  test('builds and starts the shared queue at the selected media item', async () => {
    const view = await render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    await waitFor(() => expect(view.getByTestId('count').props.children).toBe(2));

    await act(async () => {
      fireEvent.press(view.getByText('play-two'));
    });

    await waitFor(() =>
      expect(musicPlayerService.playQueue).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ mediaId: 'one' }),
          expect.objectContaining({ mediaId: 'two' }),
        ]),
        1
      )
    );
  });

  test('clears native playback when authentication is lost', async () => {
    const view = await render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    await waitFor(() => expect(musicPlayerService.ensureReady).toHaveBeenCalled());

    mockAuthenticated = false;
    await view.rerender(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );

    expect(musicPlayerService.clear).toHaveBeenCalledTimes(1);
  });

  test('keeps the last library when refresh fails', async () => {
    const view = await render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    await waitFor(() => expect(view.getByTestId('count').props.children).toBe(2));
    mockApiGet.mockRejectedValueOnce(new Error('offline'));

    await act(async () => {
      fireEvent.press(view.getByText('refresh'));
    });
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(2));
    expect(view.getByTestId('count').props.children).toBe(2);
  });

  test('does not restore Account A library when its request resolves after logout', async () => {
    const accountARequest = createDeferred();
    mockApiGet.mockImplementationOnce(() => accountARequest.promise);
    const view = await render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(1));

    mockAuthenticated = false;
    await view.rerender(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );

    await act(async () => {
      accountARequest.resolve({
        items: [{ id: 'account-a', filename: 'a.mp3', rawUrl: '/media/a.mp3' }],
      });
    });

    expect(view.getByTestId('count').props.children).toBe(0);
    expect(view.getByTestId('error').props.children).toBe('');
    expect(view.getByTestId('loading').props.children).toBe('false');
  });

  test('does not let Account A overwrite Account B after a new session begins', async () => {
    const accountARequest = createDeferred();
    const accountBRequest = createDeferred();
    mockApiGet
      .mockImplementationOnce(() => accountARequest.promise)
      .mockImplementationOnce(() => accountBRequest.promise);
    const view = await render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(1));

    mockAuthenticated = false;
    await view.rerender(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    mockAuthenticated = true;
    await view.rerender(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(2));

    await act(async () => {
      accountBRequest.resolve({
        items: [{ id: 'account-b', filename: 'b.mp3', rawUrl: '/media/b.mp3' }],
      });
    });
    await waitFor(() =>
      expect(view.getByTestId('first-track').props.children).toBe('account-b')
    );

    await act(async () => {
      accountARequest.resolve({
        items: [{ id: 'account-a', filename: 'a.mp3', rawUrl: '/media/a.mp3' }],
      });
    });

    expect(view.getByTestId('first-track').props.children).toBe('account-b');
    expect(view.getByTestId('error').props.children).toBe('');
    expect(view.getByTestId('loading').props.children).toBe('false');
  });

  test('ignores stale refresh failures after logout', async () => {
    const accountARequest = createDeferred();
    mockApiGet.mockImplementationOnce(() => accountARequest.promise);
    const view = await render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(1));

    mockAuthenticated = false;
    await view.rerender(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );

    await act(async () => {
      accountARequest.reject(new Error('account-a-offline'));
    });

    expect(view.getByTestId('count').props.children).toBe(0);
    expect(view.getByTestId('error').props.children).toBe('');
    expect(view.getByTestId('loading').props.children).toBe('false');
  });

  test('holds UI commands behind the single in-flight setup attempt', async () => {
    const readiness = createDeferred();
    musicPlayerService.ensureReady.mockImplementationOnce(() => readiness.promise);
    const view = await render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    await waitFor(() => expect(view.getByTestId('count').props.children).toBe(2));
    expect(view.getByTestId('ready').props.children).toBe('false');

    for (const title of ['play-two', 'toggle', 'previous', 'next', 'seek']) {
      await act(async () => {
        fireEvent.press(view.getByText(title));
      });
    }

    expect(musicPlayerService.playQueue).not.toHaveBeenCalled();
    expect(musicPlayerService.togglePlayback).not.toHaveBeenCalled();
    expect(musicPlayerService.previous).not.toHaveBeenCalled();
    expect(musicPlayerService.next).not.toHaveBeenCalled();
    expect(musicPlayerService.seekTo).not.toHaveBeenCalled();

    await act(async () => {
      readiness.resolve();
    });
    await waitFor(() => expect(view.getByTestId('ready').props.children).toBe('true'));

    for (const title of ['play-two', 'toggle', 'previous', 'next', 'seek']) {
      await act(async () => {
        fireEvent.press(view.getByText(title));
      });
    }

    expect(musicPlayerService.playQueue).toHaveBeenCalledTimes(2);
    expect(musicPlayerService.togglePlayback).toHaveBeenCalledWith(false);
    expect(musicPlayerService.togglePlayback).toHaveBeenCalledTimes(2);
    expect(musicPlayerService.previous).toHaveBeenCalledTimes(2);
    expect(musicPlayerService.next).toHaveBeenCalledTimes(2);
    expect(musicPlayerService.seekTo).toHaveBeenCalledTimes(2);
  });

  test('debounces a burst of authenticated media-version changes into one refresh', async () => {
    const view = await render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(1));

    mockMediaVersion = 1;
    await view.rerender(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    mockMediaVersion = 2;
    await view.rerender(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(mockApiGet).toHaveBeenCalledTimes(2);
  });

  test('keeps setup failure separate when a later library refresh fails', async () => {
    musicPlayerService.ensureReady.mockRejectedValueOnce(new Error('native unavailable'));
    const view = await render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    await waitFor(() =>
      expect(view.getByTestId('setup-error').props.children).toBe('native unavailable')
    );

    mockApiGet.mockRejectedValueOnce(new Error('library offline'));
    await act(async () => {
      fireEvent.press(view.getByText('refresh'));
    });
    await waitFor(() =>
      expect(view.getByTestId('library-error').props.children).toBe('library offline')
    );

    expect(view.getByTestId('setup-error').props.children).toBe('native unavailable');
    expect(view.getByTestId('error').props.children).toBe('native unavailable');
  });

  test('recovers from initial setup failure through explicit retry', async () => {
    musicPlayerService.ensureReady
      .mockRejectedValueOnce(new Error('native unavailable'))
      .mockResolvedValueOnce(undefined);
    const view = await render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    await waitFor(() =>
      expect(view.getByTestId('setup-error').props.children).toBe('native unavailable')
    );

    await act(async () => {
      fireEvent.press(view.getByText('retry-setup'));
    });

    await waitFor(() => expect(view.getByTestId('ready').props.children).toBe('true'));
    expect(view.getByTestId('setup-error').props.children).toBe('');
    expect(musicPlayerService.ensureReady).toHaveBeenCalledTimes(2);
  });

  test('retries setup on the next playback command after initial failure', async () => {
    musicPlayerService.ensureReady
      .mockRejectedValueOnce(new Error('native unavailable'))
      .mockResolvedValueOnce(undefined);
    const view = await render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    await waitFor(() =>
      expect(view.getByTestId('setup-error').props.children).toBe('native unavailable')
    );

    await act(async () => {
      fireEvent.press(view.getByText('play-two'));
    });

    await waitFor(() => expect(musicPlayerService.playQueue).toHaveBeenCalledTimes(1));
    expect(musicPlayerService.ensureReady).toHaveBeenCalledTimes(2);
  });

  test('retries failed setup once when the app returns to the foreground', async () => {
    musicPlayerService.ensureReady
      .mockRejectedValueOnce(new Error('native unavailable'))
      .mockResolvedValueOnce(undefined);
    const view = await render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    await waitFor(() =>
      expect(view.getByTestId('setup-error').props.children).toBe('native unavailable')
    );

    await act(async () => {
      mockAppStateHandler('active');
    });

    await waitFor(() => expect(view.getByTestId('ready').props.children).toBe('true'));
    expect(musicPlayerService.ensureReady).toHaveBeenCalledTimes(2);
  });

  test('waits for Account A teardown before Account B setup and playback', async () => {
    const teardown = createDeferred();
    musicPlayerService.clear.mockReturnValueOnce(teardown.promise);
    const view = await render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    await waitFor(() => expect(musicPlayerService.ensureReady).toHaveBeenCalledTimes(1));

    mockAuthenticated = false;
    mockAuth = { isAuthenticated: false, authIdentity: null, authGeneration: null };
    await view.rerender(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    await waitFor(() => expect(musicPlayerService.clear).toHaveBeenCalledTimes(1));

    mockAuthenticated = true;
    mockAuth = {
      isAuthenticated: true,
      authIdentity: 'sub:account-b',
      authGeneration: 'generation-b',
    };
    await view.rerender(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    await act(async () => {
      fireEvent.press(view.getByText('play-two'));
    });

    expect(musicPlayerService.ensureReady).toHaveBeenCalledTimes(1);
    expect(musicPlayerService.playQueue).not.toHaveBeenCalled();

    await act(async () => {
      teardown.resolve();
    });
    await waitFor(() => expect(musicPlayerService.ensureReady).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(musicPlayerService.playQueue).toHaveBeenCalledTimes(1));
    expect(musicPlayerService.clear.mock.invocationCallOrder[0]).toBeLessThan(
      musicPlayerService.playQueue.mock.invocationCallOrder[0]
    );
  });
});
