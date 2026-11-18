import TrackPlayer, { Event, PlayerCommand } from '@rntp/player';
import { Platform } from 'react-native';
import { createMusicPlayerController } from './musicPlayerController';
import { createAutoResume } from './musicAutoResume';

let nativePlayerReady = false;

/**
 * Whoever is drawing the transport bar, told that playback was interrupted.
 *
 * A module-level list rather than a context value because the thing that
 * hears the failure is a native event, which arrives whether or not anything
 * is mounted — the whole point being that this happens with the screen off.
 */
const interruptionListeners = new Set();
let lastInterruption = null;

const announceInterruption = (info) => {
  lastInterruption = info;
  for (const listener of interruptionListeners) {
    try {
      listener(info);
    } catch {
      // One bad subscriber must not stop the others hearing it.
    }
  }
};

/** Subscribe to interruptions. Returns an unsubscribe. */
export function onPlaybackInterrupted(listener) {
  if (typeof listener !== 'function') return () => {};
  interruptionListeners.add(listener);
  // Immediately, with whatever the state already is: a bar that mounts after
  // the failure must show it, not wait for a second one.
  try {
    listener(lastInterruption);
  } catch {
    /* ignore */
  }
  return () => interruptionListeners.delete(listener);
}

/**
 * The ladder that keeps background playback alive across a network blip —
 * see musicAutoResume.js for why a failed item used to be the end of it.
 */
export const musicAutoResume = createAutoResume(
  {
    retry: () => TrackPlayer.retry(),
    play: () => TrackPlayer.play(),
    seekTo: (seconds) => TrackPlayer.seekTo(seconds),
    getProgress: () => TrackPlayer.getProgress(),
    isPlaying: () => TrackPlayer.isPlaying(),
  },
  { onInterrupted: announceInterruption }
);

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
  // The three deliberate stops cancel the resume ladder. Pause is the one
  // that matters: a rung still pending would otherwise start the music again
  // seconds after somebody silenced it.
  setQueue: (items, startIndex) => {
    musicAutoResume.cancel();
    return Promise.resolve(TrackPlayer.setMediaItems(items, startIndex));
  },
  // Changes what the lock screen shows for an item already in the queue,
  // without touching playback — see the controller's renameInQueue.
  updateMetadata: (index, metadata) =>
    Promise.resolve(TrackPlayer.updateMetadata(index, metadata)),
  play: () => Promise.resolve(TrackPlayer.play()),
  pause: () => {
    musicAutoResume.cancel();
    return Promise.resolve(TrackPlayer.pause());
  },
  previous: () => Promise.resolve(TrackPlayer.skipToPrevious()),
  next: () => Promise.resolve(TrackPlayer.skipToNext()),
  seekTo: (seconds) => {
    // Where a resume belongs is now where the user just put the playhead.
    musicAutoResume.noteSeek(seconds);
    return Promise.resolve(TrackPlayer.seekTo(seconds));
  },
  clear: () => {
    musicAutoResume.cancel();
    return Promise.resolve(TrackPlayer.clear());
  },
  setNextEnabled: (enabled) => setNativeCommands(enabled),
};

export const musicPlayerService = createMusicPlayerController(nativeAdapter);

const handleNativePlaybackEvent = async (event) => {
  if (event?.type === Event.MediaItemTransition) {
    musicAutoResume.noteTrackChanged();
    await musicPlayerService.handleActiveIndexChanged(event.index);
  } else if (event?.type === Event.RemoteNext) {
    await musicPlayerService.next();
  } else if (event?.type === Event.PlaybackError) {
    // The event this app used to not be listening to at all.
    musicAutoResume.handleError(event);
  } else if (event?.type === Event.PlaybackStateChanged) {
    musicAutoResume.noteStateChange(event.state);
  }
};

const forward = (type) => {
  TrackPlayer.addEventListener(type, (event) => {
    handleNativePlaybackEvent({ ...event, type }).catch(() => {});
  });
};

forward(Event.MediaItemTransition);
// Both of these are the fix for background playback dying on a blip: the
// error is what says it died, and the state is what lets the ladder tell a
// recovery from a queue that simply ended.
forward(Event.PlaybackError);
forward(Event.PlaybackStateChanged);

if (Platform.OS === 'android') {
  TrackPlayer.registerBackgroundEventHandler(() => handleNativePlaybackEvent);
}
