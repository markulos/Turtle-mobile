import TrackPlayer, { Event, PlayerCommand } from '@rntp/player';
import { Platform } from 'react-native';
import { createMusicPlayerController } from './musicPlayerController';

let nativePlayerReady = false;

const setNativeCommands = (nextEnabled) =>
  Promise.resolve(
    TrackPlayer.setCommands({
      capabilities: [
        PlayerCommand.Previous,
        PlayerCommand.PlayPause,
        ...(nextEnabled ? [PlayerCommand.Next] : []),
        PlayerCommand.Seek,
      ],
      handling: 'native',
    })
  );

const nativeAdapter = {
  async setup() {
    if (!nativePlayerReady) {
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
      nativePlayerReady = true;
    }
    await setNativeCommands(false);
  },
  setQueue: (items, startIndex) =>
    Promise.resolve(TrackPlayer.setMediaItems(items, startIndex)),
  play: () => Promise.resolve(TrackPlayer.play()),
  pause: () => Promise.resolve(TrackPlayer.pause()),
  previous: () => Promise.resolve(TrackPlayer.skipToPrevious()),
  next: () => Promise.resolve(TrackPlayer.skipToNext()),
  seekTo: (seconds) => Promise.resolve(TrackPlayer.seekTo(seconds)),
  clear: () => Promise.resolve(TrackPlayer.clear()),
  setNextEnabled: (enabled) => setNativeCommands(enabled),
};

export const musicPlayerService = createMusicPlayerController(nativeAdapter);

const handleNativePlaybackEvent = async (event) => {
  if (event?.type === Event.MediaItemTransition) {
    await musicPlayerService.handleActiveIndexChanged(event.index);
  } else if (event?.type === Event.RemoteNext) {
    await musicPlayerService.next();
  }
};

TrackPlayer.addEventListener(Event.MediaItemTransition, (event) => {
  handleNativePlaybackEvent({ type: Event.MediaItemTransition, ...event }).catch(() => {});
});

if (Platform.OS === 'android') {
  TrackPlayer.registerBackgroundEventHandler(() => handleNativePlaybackEvent);
}
