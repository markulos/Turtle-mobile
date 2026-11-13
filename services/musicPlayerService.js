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
          // OFF, and deliberately. When true (the player's default) any
          // ICY/ID3 metadata the file carries OVERWRITES the queued item's
          // title, artist and artwork on the lock screen — see
          // handleMetadataReceived in the package's TrackPlayer.swift, which
          // calls updateMetadata with whatever the stream said.
          //
          // That is right for radio, where the stream is the only thing that
          // knows what is playing, and wrong for a library, where the POND
          // knows: the name a person typed lives in originalName and is what
          // every list in the app shows. Leaving it on means a file whose
          // embedded tag disagrees — an old upload, or a download that never
          // had one — quietly replaces the name you just chose, seconds after
          // playback starts, on the one screen you cannot correct it from.
          autoUpdateMetadataFromStream: false,
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
  // Changes what the lock screen shows for an item already in the queue,
  // without touching playback — see the controller's renameInQueue.
  updateMetadata: (index, metadata) =>
    Promise.resolve(TrackPlayer.updateMetadata(index, metadata)),
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
