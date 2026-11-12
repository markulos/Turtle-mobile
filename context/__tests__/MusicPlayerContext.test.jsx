import React from 'react';
import { AppState, Button, Text, View } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { MusicPlayerProvider, useMusicPlayer } from '../MusicPlayerContext';
import { musicPlayerService } from '../../services/musicPlayerService';
import { RESOLVE_CEILING, preparingPercent } from '../../services/preparingProgress';

const mockApiGet = jest.fn();
const mockServer = {
  api: { get: mockApiGet },
  getBaseUrl: () => 'https://pond.example/api',
  getMediaBaseUrl: () => 'https://pond.example',
};
let mockAuthenticated = true;
let mockActiveTrack = null;
let mockPlaying = false;
/** Drives `preparing` — see the hook of the same name in the provider. */
let mockPlaybackState = 'ready';
let mockProgress = { position: 12, duration: 180, buffered: 12 };
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
  // The real enum, by value, so a mock state is the same string the provider
  // compares against.
  PlaybackState: { Idle: 'idle', Ready: 'ready', Buffering: 'buffering', Ended: 'ended', Error: 'error' },
  useActiveMediaItem: () => mockActiveTrack,
  useIsPlaying: () => mockPlaying,
  usePlaybackState: () => mockPlaybackState,
  useProgress: () => mockProgress,
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
      <Text testID="recordings">{music.recordings.map((t) => t.id).join(',')}</Text>
      <Text testID="error">{music.error || ''}</Text>
      <Text testID="setup-error">{music.setupError || ''}</Text>
      <Text testID="library-error">{music.libraryError || ''}</Text>
      <Text testID="loading">{String(music.loading)}</Text>
      <Text testID="ready">{String(music.ready)}</Text>
      <Text testID="position">{music.position}</Text>
      <Text testID="preparing">{String(music.preparing)}</Text>
      <Text testID="preparing-pct">{String(music.preparingPct)}</Text>
      <Text testID="preparing-stalled">{String(music.preparingStalled)}</Text>
      <Button title="play-two" onPress={() => music.playMedia('two')} />
      <Button title="play-one" onPress={() => music.playMedia('one')} />
      <Button title="play-memo" onPress={() => music.playMedia('memo')} />
      <Button
        title="play-recordings"
        onPress={() => music.playRows(music.recordings, 'memo')}
      />
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
    mockPlaybackState = 'ready';
    mockProgress = { position: 12, duration: 180, buffered: 12 };
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

  /**
   * `preparing` is what the YouTube-preview rows and the transport bar read to
   * say "Finding the audio...". It has to mean "asked for, nothing audible
   * yet" and NOT "paused", or every pause at 0:00 would claim to be loading.
   */
  describe('preparing', () => {
    const mount = async () => render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );

    test('is true while a loaded track is buffering and silent', async () => {
      mockActiveTrack = { mediaId: 'yt:abc' };
      mockPlaying = false;
      mockPlaybackState = 'buffering';
      const view = await mount();
      await waitFor(() => expect(view.getByTestId('preparing').props.children).toBe('true'));
    });

    test('is false for a track the user merely paused', async () => {
      // A paused track is Ready, not Buffering. This is the distinction the
      // whole flag rests on.
      mockActiveTrack = { mediaId: 'yt:abc' };
      mockPlaying = false;
      mockPlaybackState = 'ready';
      const view = await mount();
      await waitFor(() => expect(view.getByTestId('preparing').props.children).toBe('false'));
    });

    test('is false once audio is actually coming out', async () => {
      mockActiveTrack = { mediaId: 'yt:abc' };
      mockPlaying = true;
      mockPlaybackState = 'buffering';
      const view = await mount();
      await waitFor(() => expect(view.getByTestId('preparing').props.children).toBe('false'));
    });

    test('is false when nothing is loaded at all', async () => {
      mockActiveTrack = null;
      mockPlaying = false;
      mockPlaybackState = 'buffering';
      const view = await mount();
      await waitFor(() => expect(view.getByTestId('preparing').props.children).toBe('false'));
    });

    /**
     * …and how far along it is. The arithmetic is tested in
     * services/__tests__/preparingProgress.test.js; what matters here is that
     * the provider feeds it the right things and resets it per attempt.
     */
    describe('preparingPct', () => {
      const pct = (view) => Number(view.getByTestId('preparing-pct').props.children);

      test('climbs while the wait is still an estimate', async () => {
        mockActiveTrack = { mediaId: 'yt:abc' };
        mockPlaying = false;
        mockPlaybackState = 'buffering';
        // Nothing buffered ahead of where we are: the resolving half.
        mockProgress = { position: 0, duration: 0, buffered: 0 };
        const view = await mount();
        await waitFor(() => expect(pct(view)).toBeGreaterThan(0), { timeout: 3000 });
        const early = pct(view);
        await waitFor(() => expect(pct(view)).toBeGreaterThan(early), { timeout: 3000 });
      });

      test('reads the buffer the player has IN HAND, not its position', async () => {
        // `buffered` is absolute, so a track 12s in with 15s buffered has
        // three seconds in hand — which is what the number is about. Reading
        // it as fifteen would show a full ring the instant anything arrived.
        mockActiveTrack = { mediaId: 'yt:abc' };
        mockPlaying = false;
        mockPlaybackState = 'buffering';
        mockProgress = { position: 12, duration: 180, buffered: 13.5 };
        const view = await mount();
        await waitFor(() => expect(pct(view)).toBe(
          preparingPercent({ bufferedAheadSec: 1.5 }),
        ), { timeout: 3000 });
      });

      test('is nothing at all when nothing is being prepared', async () => {
        mockActiveTrack = { mediaId: 'yt:abc' };
        mockPlaying = true;
        mockPlaybackState = 'ready';
        const view = await mount();
        await waitFor(() => expect(pct(view)).toBe(0));
      });
    });

    /**
     * …and when it stops being a wait at all.
     *
     * Fake timers here and nowhere else in this file: the threshold is twenty
     * seconds, and the alternative is a test suite that really waits for it.
     * The provider reads Date.now() on the same tick as the interval, so both
     * have to come from the same fake clock to move together.
     */
    describe('preparingStalled', () => {
      const stalled = (view) => view.getByTestId('preparing-stalled').props.children;
      const pct = (view) => Number(view.getByTestId('preparing-pct').props.children);
      /** Run the provider's clock forward, letting its state settle. */
      const waitSeconds = async (seconds) => {
        await act(async () => { jest.advanceTimersByTime(seconds * 1000); });
      };

      beforeEach(() => { jest.useFakeTimers(); });
      afterEach(() => { jest.useRealTimers(); });

      test('turns true once the estimate has been pinned at the ceiling', async () => {
        // The reported bug: "it loads fast and then slows down and gets stuck
        // at 69%". 69 is the cap, and with no bytes it stays there for ever.
        mockActiveTrack = { mediaId: 'yt:abc' };
        mockPlaying = false;
        mockPlaybackState = 'buffering';
        mockProgress = { position: 0, duration: 0, buffered: 0 };
        const view = await mount();

        await waitSeconds(10);
        expect(pct(view)).toBe(RESOLVE_CEILING - 1);
        expect(stalled(view)).toBe('false');   // pinned, but not yet worth saying

        await waitSeconds(11);
        expect(stalled(view)).toBe('true');
      });

      test('stays false for a slow buffer, because that one is really moving', async () => {
        mockActiveTrack = { mediaId: 'yt:abc' };
        mockPlaying = false;
        mockPlaybackState = 'buffering';
        // Bytes in hand: the measured half, which has a number of its own.
        mockProgress = { position: 0, duration: 600, buffered: 0.4 };
        const view = await mount();

        await waitSeconds(40);
        expect(stalled(view)).toBe('false');
        expect(pct(view)).toBeGreaterThanOrEqual(RESOLVE_CEILING);
      });

      test('clears when the next attempt starts, not when the last one ends', async () => {
        // Otherwise the sentence that asked for a tap is still on screen after
        // the tap, which reads as the retry having been ignored.
        mockActiveTrack = { mediaId: 'yt:abc' };
        mockPlaying = false;
        mockPlaybackState = 'buffering';
        mockProgress = { position: 0, duration: 0, buffered: 0 };
        const view = await mount();
        await waitSeconds(21);
        expect(stalled(view)).toBe('true');

        // A different track is now the one being prepared — a fresh attempt.
        mockActiveTrack = { mediaId: 'yt:def' };
        await view.rerender(
          <MusicPlayerProvider>
            <Probe />
          </MusicPlayerProvider>
        );
        await waitSeconds(1);
        expect(stalled(view)).toBe('false');
        expect(pct(view)).toBeLessThan(RESOLVE_CEILING - 1);
      });
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

  /**
   * ── Voice recordings are not in the music library ────────────────────────
   *
   * The owner's requirement in one sentence: audio filed as a voice recording
   * "does not remain within the main music directory (does not play when
   * playing all) — only accessed within the recordings section".
   *
   * The list is the easy half. The half worth a test is the QUEUE: this
   * context is where it is built, so a recording left in `tracks` would still
   * be played by press-play-and-walk — invisible in the list and audible
   * between two songs.
   */
  describe('voice recordings', () => {
    const LIBRARY_WITH_MEMO = {
      items: [
        { id: 'one', filename: 'one.mp3', rawUrl: '/media/one.mp3', tags: '["Jazz"]' },
        { id: 'memo', filename: 'memo.m4a', rawUrl: '/media/memo.m4a', tags: '["Voice recordings"]' },
        { id: 'two', filename: 'two.mp3', rawUrl: '/media/two.mp3' },
      ],
    };

    test('a filed recording leaves the library and lands in its own list', async () => {
      mockApiGet.mockResolvedValue(LIBRARY_WITH_MEMO);
      const view = await render(
        <MusicPlayerProvider>
          <Probe />
        </MusicPlayerProvider>
      );
      await waitFor(() => expect(view.getByTestId('count').props.children).toBe(2));
      expect(view.getByTestId('recordings').props.children).toBe('memo');
      // One request for both lists — the gallery knows nothing about this.
      expect(mockApiGet).toHaveBeenCalledTimes(1);
    });

    test('it is NOT in the queue the library plays', async () => {
      mockApiGet.mockResolvedValue(LIBRARY_WITH_MEMO);
      const view = await render(
        <MusicPlayerProvider>
          <Probe />
        </MusicPlayerProvider>
      );
      await waitFor(() => expect(view.getByTestId('count').props.children).toBe(2));

      await act(async () => { fireEvent.press(view.getByText('play-one')); });

      await waitFor(() => expect(musicPlayerService.playQueue).toHaveBeenCalledTimes(1));
      const [queue] = musicPlayerService.playQueue.mock.calls[0];
      // THE assertion: press play on the music and your own voice is not in
      // what Next will walk to.
      expect(queue.map((item) => item.mediaId)).toEqual(['one', 'two']);
    });

    test('asking the library to play one by id does nothing', async () => {
      mockApiGet.mockResolvedValue(LIBRARY_WITH_MEMO);
      const view = await render(
        <MusicPlayerProvider>
          <Probe />
        </MusicPlayerProvider>
      );
      await waitFor(() => expect(view.getByTestId('count').props.children).toBe(2));

      await act(async () => { fireEvent.press(view.getByText('play-memo')); });

      // Not playable from the library — which is what "only accessed within
      // the recordings section" means at this layer. The section plays it by
      // handing over its own rows (below).
      expect(musicPlayerService.playQueue).not.toHaveBeenCalled();
    });

    test('the section plays it, in a queue of its own', async () => {
      mockApiGet.mockResolvedValue(LIBRARY_WITH_MEMO);
      const view = await render(
        <MusicPlayerProvider>
          <Probe />
        </MusicPlayerProvider>
      );
      await waitFor(() => expect(view.getByTestId('count').props.children).toBe(2));

      await act(async () => { fireEvent.press(view.getByText('play-recordings')); });

      await waitFor(() => expect(musicPlayerService.playQueue).toHaveBeenCalledTimes(1));
      const [queue, startIndex] = musicPlayerService.playQueue.mock.calls[0];
      expect(queue.map((item) => item.mediaId)).toEqual(['memo']);
      expect(startIndex).toBe(0);
    });

    test('signing out empties both lists', async () => {
      mockApiGet.mockResolvedValue(LIBRARY_WITH_MEMO);
      const view = await render(
        <MusicPlayerProvider>
          <Probe />
        </MusicPlayerProvider>
      );
      await waitFor(() => expect(view.getByTestId('recordings').props.children).toBe('memo'));

      mockAuthenticated = false;
      await view.rerender(
        <MusicPlayerProvider>
          <Probe />
        </MusicPlayerProvider>
      );
      await waitFor(() => expect(view.getByTestId('recordings').props.children).toBe(''));
    });
  });
});
