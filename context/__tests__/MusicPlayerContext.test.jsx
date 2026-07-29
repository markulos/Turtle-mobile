import React from 'react';
import { Button, Text, View } from 'react-native';
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
  useAuth: () => ({ isAuthenticated: mockAuthenticated }),
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
      <Text testID="loading">{String(music.loading)}</Text>
      <Text testID="ready">{String(music.ready)}</Text>
      <Text testID="position">{music.position}</Text>
      <Button title="play-two" onPress={() => music.playMedia('two')} />
      <Button title="refresh" onPress={() => music.refreshLibrary()} />
      <Button title="toggle" onPress={() => music.togglePlayback()} />
      <Button title="previous" onPress={() => music.previous()} />
      <Button title="next" onPress={() => music.next()} />
      <Button title="seek" onPress={() => music.seekTo(60)} />
    </View>
  );
}

describe('MusicPlayerProvider', () => {
  beforeEach(() => {
    mockAuthenticated = true;
    mockActiveTrack = null;
    mockPlaying = false;
    jest.clearAllMocks();
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

  test('does not invoke UI commands until the player is ready', async () => {
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

    expect(musicPlayerService.playQueue).toHaveBeenCalledTimes(1);
    expect(musicPlayerService.togglePlayback).toHaveBeenCalledWith(false);
    expect(musicPlayerService.previous).toHaveBeenCalledTimes(1);
    expect(musicPlayerService.next).toHaveBeenCalledTimes(1);
    expect(musicPlayerService.seekTo).toHaveBeenCalledWith(60);
  });
});
