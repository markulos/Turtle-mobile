jest.mock('@rntp/player', () => ({
  __esModule: true,
  default: {
    setupPlayer: jest.fn(),
    setCommands: jest.fn(),
    setMediaItems: jest.fn(),
    play: jest.fn(),
    pause: jest.fn(),
    skipToPrevious: jest.fn(),
    skipToNext: jest.fn(),
    seekTo: jest.fn(),
    clear: jest.fn(),
  },
  PlayerCommand: {
    Previous: 'previous',
    PlayPause: 'playPause',
    Next: 'next',
    Seek: 'seek',
  },
}));

import TrackPlayer from '@rntp/player';
import { musicPlayerService } from '../musicPlayerService';

test('retries command registration without initializing the native player twice', async () => {
  TrackPlayer.setupPlayer
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('Player is already set up'));
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
