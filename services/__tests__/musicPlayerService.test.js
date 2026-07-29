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
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    registerBackgroundEventHandler: jest.fn(),
  };
  return {
    __esModule: true,
    default: player,
    Event: {
      MediaItemTransition: 'event.media-item-transition',
      RemoteNext: 'event.remote-next',
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

const loadService = () => {
  jest.resetModules();
  const playerModule = require('@rntp/player');
  const serviceModule = require('../musicPlayerService');
  return {
    TrackPlayer: playerModule.default,
    Event: playerModule.Event,
    musicPlayerService: serviceModule.musicPlayerService,
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
