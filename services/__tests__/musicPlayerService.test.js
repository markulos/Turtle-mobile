jest.mock('@rntp/player', () => {
  const player = {
    setupPlayer: jest.fn().mockResolvedValue(undefined),
    setCommands: jest.fn().mockResolvedValue(undefined),
    setMediaItems: jest.fn().mockResolvedValue(undefined),
    play: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    skipToPrevious: jest.fn().mockResolvedValue(undefined),
    skipToNext: jest.fn().mockResolvedValue(undefined),
    seekTo: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
    retry: jest.fn(),
    getProgress: jest.fn(() => ({ position: 0, duration: 0, buffered: 0 })),
    isPlaying: jest.fn(() => false),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    registerBackgroundEventHandler: jest.fn(),
  };
  return {
    __esModule: true,
    default: player,
    Event: {
      MediaItemTransition: 'event.media-item-transition',
      RemoteNext: 'event.remote-next',
      PlaybackError: 'event.playback-error',
      PlaybackStateChanged: 'event.playback-state-changed',
    },
    PlayerCommand: {
      Previous: 'previous',
      PlayPause: 'playPause',
      Next: 'next',
      Seek: 'seek',
    },
  };
});
jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

/**
 * The most recently loaded resume ladder, so it can be switched off.
 *
 * It runs on REAL timers here (the ladder's own tests inject a clock), and a
 * ladder left climbing holds the node event loop open for its full two
 * minutes — which hangs the suite rather than failing it.
 */
let liveResume = null;
afterEach(() => {
  liveResume?.cancel();
  liveResume = null;
});

const loadService = () => {
  jest.resetModules();
  const playerModule = require('@rntp/player');
  const serviceModule = require('../musicPlayerService');
  liveResume = serviceModule.musicAutoResume;
  return {
    TrackPlayer: playerModule.default,
    Event: playerModule.Event,
    musicPlayerService: serviceModule.musicPlayerService,
    musicAutoResume: serviceModule.musicAutoResume,
    onPlaybackInterrupted: serviceModule.onPlaybackInterrupted,
  };
};

describe('musicPlayerService native controls', () => {
  test('retries command registration without initializing the native player twice', async () => {
    const { TrackPlayer, musicPlayerService } = loadService();
    TrackPlayer.setCommands
      .mockRejectedValueOnce(new Error('command registration unavailable'))
      .mockResolvedValueOnce(undefined);

    await expect(musicPlayerService.ensureReady()).rejects.toThrow(
      'command registration unavailable'
    );
    await expect(musicPlayerService.ensureReady()).resolves.toBeUndefined();

    expect(TrackPlayer.setupPlayer).toHaveBeenCalledTimes(1);
    expect(TrackPlayer.setCommands).toHaveBeenCalledTimes(2);
  });

  test('removes Next when a queue starts on its final item', async () => {
    const { TrackPlayer, musicPlayerService } = loadService();

    await musicPlayerService.playQueue([{ mediaId: 'only' }], 0);

    expect(TrackPlayer.setCommands).toHaveBeenLastCalledWith({
      capabilities: ['previous', 'playPause', 'seek'],
      handling: 'native',
    });
  });

  test('updates Next when native automatic playback advances to the final item', async () => {
    const { TrackPlayer, Event, musicPlayerService } = loadService();
    await musicPlayerService.playQueue([{ mediaId: 'one' }, { mediaId: 'two' }], 0);
    const transition = TrackPlayer.addEventListener.mock.calls.find(
      ([event]) => event === Event.MediaItemTransition
    )[1];

    await transition({ index: 1, item: { mediaId: 'two' } });

    expect(TrackPlayer.setCommands).toHaveBeenLastCalledWith({
      capabilities: ['previous', 'playPause', 'seek'],
      handling: 'native',
    });
  });

  test('handles final-item transitions in the Android background service', async () => {
    const { TrackPlayer, Event, musicPlayerService } = loadService();
    await musicPlayerService.playQueue([{ mediaId: 'one' }, { mediaId: 'two' }], 0);
    const backgroundHandler = TrackPlayer.registerBackgroundEventHandler.mock.calls[0][0]();

    await backgroundHandler({ type: Event.MediaItemTransition, index: 1, item: { mediaId: 'two' } });

    expect(TrackPlayer.setCommands).toHaveBeenLastCalledWith({
      capabilities: ['previous', 'playPause', 'seek'],
      handling: 'native',
    });
  });

  test('makes a stale background Remote Next harmless at the final item', async () => {
    const { TrackPlayer, Event, musicPlayerService } = loadService();
    await musicPlayerService.playQueue([{ mediaId: 'only' }], 0);
    const backgroundHandler = TrackPlayer.registerBackgroundEventHandler.mock.calls[0][0]();

    await backgroundHandler({ type: Event.RemoteNext });

    expect(TrackPlayer.skipToNext).not.toHaveBeenCalled();
  });
});

describe('background playback survives a blip', () => {
  /**
   * Mark, 2026-11-18: background music "stops playing after a few minutes".
   * The cause was here: this module subscribed to exactly two events, so the
   * player's own `PlaybackError` — the thing that says playback has stopped
   * and can be retried — was never heard by anyone.
   */
  test('IT LISTENS FOR THE FAILURE, which is what it never used to do', () => {
    const { TrackPlayer, Event } = loadService();
    const subscribed = TrackPlayer.addEventListener.mock.calls.map(([event]) => event);
    expect(subscribed).toContain(Event.PlaybackError);
    expect(subscribed).toContain(Event.PlaybackStateChanged);
    // …and nothing is registered against an undefined event, which is what a
    // renamed constant would silently become.
    expect(subscribed.every(Boolean)).toBe(true);
  });

  test('a network error re-prepares the item and plays it again', async () => {
    const { TrackPlayer, Event } = loadService();
    const onError = TrackPlayer.addEventListener.mock.calls.find(
      ([event]) => event === Event.PlaybackError
    )[1];

    onError({ code: 'network', message: 'The request timed out' });

    expect(TrackPlayer.retry).toHaveBeenCalledTimes(1);
    expect(TrackPlayer.play).toHaveBeenCalledTimes(1);
  });

  test('…ON ANDROID TOO, where the handler runs with no app in front of it', async () => {
    // The platform where the event arrives in a headless task — and the only
    // one where "the app is closed" can mean the process is not even up.
    const { TrackPlayer, Event } = loadService();
    const backgroundHandler = TrackPlayer.registerBackgroundEventHandler.mock.calls[0][0]();

    await backgroundHandler({ type: Event.PlaybackError, code: 'network', message: 'lost' });

    expect(TrackPlayer.retry).toHaveBeenCalledTimes(1);
  });

  test('the transport bar is TOLD, so the silence has a reason on it', () => {
    const { TrackPlayer, Event, onPlaybackInterrupted } = loadService();
    const seen = [];
    const unsubscribe = onPlaybackInterrupted((info) => seen.push(info));
    // Subscribing reports the state as it already is — a bar that mounts
    // after the failure has to show it.
    expect(seen).toEqual([null]);

    const onError = TrackPlayer.addEventListener.mock.calls.find(
      ([event]) => event === Event.PlaybackError
    )[1];
    onError({ code: 'network', message: 'lost' });
    expect(seen[1]).toMatchObject({ code: 'network', exhausted: false });

    unsubscribe();
    onError({ code: 'source', message: 'gone' });
    expect(seen).toHaveLength(2);
  });

  test('PAUSE CANCELS IT — nothing may start the music after a deliberate stop', async () => {
    const { TrackPlayer, Event, musicPlayerService, musicAutoResume } = loadService();
    await musicPlayerService.playQueue([{ mediaId: 'one' }], 0);
    const onError = TrackPlayer.addEventListener.mock.calls.find(
      ([event]) => event === Event.PlaybackError
    )[1];
    onError({ code: 'network', message: 'lost' });
    expect(musicAutoResume.isRecovering()).toBe(true);

    await musicPlayerService.togglePlayback(true);   // the user pressed pause

    expect(TrackPlayer.pause).toHaveBeenCalled();
    expect(musicAutoResume.isRecovering()).toBe(false);
  });

  test('a new queue starts with no memory of where the last track was', async () => {
    const { TrackPlayer, musicPlayerService, musicAutoResume } = loadService();
    musicAutoResume.noteSeek(120);
    await musicPlayerService.playQueue([{ mediaId: 'one' }], 0);
    expect(musicAutoResume.position()).toBe(0);
    expect(TrackPlayer.setMediaItems).toHaveBeenCalled();
  });

  test('a user seek is where a resume goes back to', async () => {
    const { musicPlayerService, musicAutoResume } = loadService();
    await musicPlayerService.playQueue([{ mediaId: 'one' }], 0);
    await musicPlayerService.seekTo(64);
    expect(musicAutoResume.position()).toBe(64);
  });
});

test('the pond owns the name — the stream may not overwrite it', async () => {
  // The lock screen is the one surface the user cannot correct from. A file's
  // embedded tag replacing the name they just typed is the bug this closes;
  // radio is the only case the default is built for, and the vault plays
  // files.
  const { TrackPlayer, musicPlayerService } = loadService();
  await musicPlayerService.ensureReady();
  const [config] = TrackPlayer.setupPlayer.mock.calls[0];
  expect(config.autoUpdateMetadataFromStream).toBe(false);
});
