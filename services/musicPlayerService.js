import TrackPlayer, { PlayerCommand } from '@rntp/player';
import { createMusicPlayerController } from './musicPlayerController';

const nativeAdapter = {
  async setup() {
    await Promise.resolve(
      TrackPlayer.setupPlayer({
        contentType: 'music',
        handleAudioBecomingNoisy: true,
        autoUpdateMetadataFromStream: true,
        android: {
          wakeMode: 'network',
          taskRemovedBehavior: 'stop',
        },
      })
    );
    await Promise.resolve(
      TrackPlayer.setCommands({
        capabilities: [
          PlayerCommand.Previous,
          PlayerCommand.PlayPause,
          PlayerCommand.Next,
          PlayerCommand.Seek,
        ],
        handling: 'native',
      })
    );
  },
  setQueue: (items, startIndex) =>
    Promise.resolve(TrackPlayer.setMediaItems(items, startIndex)),
  play: () => Promise.resolve(TrackPlayer.play()),
  pause: () => Promise.resolve(TrackPlayer.pause()),
  previous: () => Promise.resolve(TrackPlayer.skipToPrevious()),
  next: () => Promise.resolve(TrackPlayer.skipToNext()),
  seekTo: (seconds) => Promise.resolve(TrackPlayer.seekTo(seconds)),
  clear: () => Promise.resolve(TrackPlayer.clear()),
};

export const musicPlayerService = createMusicPlayerController(nativeAdapter);
