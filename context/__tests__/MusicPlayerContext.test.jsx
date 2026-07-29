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
      <Text testID="position">{music.position}</Text>
      <Button title="play-two" onPress={() => music.playMedia('two')} />
      <Button title="refresh" onPress={() => music.refreshLibrary()} />
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
});
