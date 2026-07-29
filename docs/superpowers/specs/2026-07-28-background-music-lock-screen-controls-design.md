# Background Music and Lock-Screen Controls

## Goal

Turtle's active Music Vault track continues playing when the phone locks, the
app moves to the background, or the user navigates elsewhere inside Turtle.
Android's media notification and both platforms' lock-screen media surface
provide previous, play/pause, next, and timeline-seek controls.

An intentional force-close may stop playback. Restoring playback after device
restart or force-close is outside this feature.

## Current State

`MusicVault` owns an `expo-video` player and renders a hidden `VideoView`.
Although the player enables `staysActiveInBackground` and
`showNowPlayingNotification`, React disposes it when `MusicVault` unmounts.
That happens when the user returns to the Media Vault chooser. The player also
has no native multi-track queue, so previous/next and automatic queue
progression cannot remain reliable while JavaScript is suspended.

The Expo config already enables iOS audio background mode through the
`expo-video` plugin, but a new native dependency and generated native settings
still require a development or production rebuild.

## Chosen Approach

Use the native Track Player v5 package (`@rntp/player`) and move playback
ownership out of `MusicVault`.

Track Player is selected because it provides:

- a native multi-track queue;
- background playback on Android and iOS;
- lock-screen, notification, Bluetooth, and headset commands;
- native previous/next handling while React Native JavaScript is suspended;
- native metadata and progress integration.

Track Player v5 is free for personal and educational use. A commercial Turtle
release would require confirming and obtaining the appropriate license before
distribution.

## Architecture

### Native player service

Create a small music service module responsible for:

- setting up Track Player exactly once;
- configuring music audio focus and pause-on-headphone-disconnect behavior;
- exposing previous, play/pause, next, and seek commands;
- using native command handling wherever supported;
- configuring Android to stop playback and remove its notification after an
  intentional app force-close, matching the requested lifecycle;
- translating playback errors into a stable application error shape.

The service has no React UI dependencies.

### Music player provider

Add `MusicPlayerProvider` above the tab navigator and below the existing server
and authentication providers. It remains mounted while the signed-in app is
running.

The provider:

- initializes the native player while the app is foregrounded;
- fetches Music Vault audio items through the existing media API;
- maps server media rows into native track metadata;
- owns loading and recoverable error state;
- exposes queue, active track, playing state, progress, and player commands;
- refreshes the library without replacing an active queue unless the user
  selects a new track;
- stops playback and clears the queue when the authenticated user logs out, so
  one account's media never continues into another account's session;
- releases UI listeners on unmount without destroying active native playback
  during ordinary navigation.

Only one music player may be active at a time.

### Music Vault UI

Refactor `MusicVault` into a consumer of `MusicPlayerProvider`.

It keeps the current list and now-playing presentation, but:

- removes `useVideoPlayer` and the hidden `VideoView`;
- selects a track by asking the provider to create a queue and start at the
  selected index;
- reads active track, play state, position, and duration from Track Player;
- delegates previous, play/pause, next, and seeking to the provider;
- continues showing the current track after navigating away and returning.

No global mini-player is added in this phase. Playback remains controllable
from Music Vault and from native system controls.

## Queue and Metadata

When the user selects a track, Turtle maps the current Music Vault ordering into
one native queue and starts at that track.

Each native item includes:

- a stable media ID;
- the resolved audio URL;
- the filename-derived title;
- source host or `Turtle Music` as artist text;
- duration when available;
- thumbnail or artwork URL when available.

Invalid rows without a stable ID or playable URL are excluded. The selected row
must still resolve to a queue item; otherwise Turtle shows a playback error and
does not disturb the current queue.

Track completion advances natively to the next queue item. At the last item,
playback stops without wrapping.

## Native Controls

The native media session exposes:

- previous track;
- play/pause;
- next track;
- seek to timeline position.

These controls appear where the OS supports them:

- Android notification shade and lock screen;
- iOS lock screen and Control Center;
- compatible Bluetooth and wired-headset controls.

The widget uses the active track's title, artist/source, artwork, duration, and
progress. Tapping the notification opens Turtle.

## Lifecycle and Audio Focus

Playback continues when:

- the phone screen turns off;
- the phone is locked;
- Turtle moves to the background;
- the user changes Turtle tabs;
- the user leaves and later reopens Music Vault.

Playback pauses for audio-focus interruptions according to platform behavior,
including calls and headphone/Bluetooth disconnection. Turtle does not
automatically resume after a call unless the operating system reports that
resumption is appropriate.

Force-closing Turtle may stop playback and remove the Android notification.
The player does not auto-start after relaunch.

Logging out always stops playback, clears the native queue, and removes the
system media notification.

## Error Handling

- Player initialization is idempotent and reports setup failure to Music Vault.
- Network or unsupported-format errors keep the queue visible and show a
  concise retryable message.
- A failed newly selected track does not destroy a previously valid queue until
  the replacement queue is validated.
- Commands issued before setup completes are disabled.
- Missing artwork falls back to the existing Turtle music icon.
- Library refresh failure leaves the last successfully loaded library and
  active playback intact.

## Native Configuration and Rebuild

Installation changes the JavaScript dependency lockfile and native projects.
The iOS project requires pods to be updated. Android requires the media
playback foreground service and related permissions supplied by the package.
iOS retains `UIBackgroundModes: audio`.

After implementation:

1. regenerate or update native configuration as required;
2. install iOS pods;
3. build and install a fresh development client;
4. verify Android and iOS on physical devices.

Metro reload alone is insufficient because the media service is native.

## Testing

Implementation follows test-driven development.

Automated tests cover:

- media-row to native-track mapping;
- exclusion of unplayable rows;
- selected media ID to native queue index mapping;
- metadata fallbacks;
- idempotent player setup;
- queue replacement and start-index behavior;
- command guards before setup;
- preservation of active state across Music Vault unmount/remount;
- error behavior that preserves the prior valid queue.

Because lock-screen surfaces and background services are operating-system
features, physical-device acceptance checks cover:

- screen lock while playing;
- backgrounding and navigating between Turtle tabs;
- play/pause, previous, next, and seeking from native controls;
- metadata and artwork updates after track changes;
- automatic transition at track end;
- headphone disconnect;
- phone-call interruption;
- deliberate force-close behavior.

## Out of Scope

- playback after device restart;
- guaranteed playback after force-close;
- offline downloads or a new audio cache;
- shuffle, repeat, playlists, favorites, or queue editing;
- a global in-app mini-player;
- Android Auto or CarPlay browsing interfaces.

## Companion Share-to-Audio Scope

The approved follow-on scope for sharing audio/video files and links into the
Music Vault, including reusable backend FFmpeg conversion, is specified in
`2026-07-28-share-to-audio-conversion-design.md`.
