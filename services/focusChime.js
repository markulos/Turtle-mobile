/**
 * focusChime — the sound a finished focus block makes, in-app.
 *
 * ─── Why expo-video for a sound ─────────────────────────────────────────────
 *
 * There is no audio library in this app. expo-av is gone, expo-audio was never
 * installed, and adding either is a NATIVE dependency: it moves the runtime
 * fingerprint, so it cannot reach the installed build over the air (see
 * docs/STYLE-RULES.md on native deps, and the note at the top of StatsPanel
 * about react-native-svg for the same reason).
 *
 * What IS installed and CAN play audio: expo-video. Its player is AVPlayer on
 * iOS and Media3 on Android, both of which play an audio-only source perfectly
 * well, and a player with no `<VideoView>` attached to it is exactly a sound
 * player. The other candidate — @rntp/player — is the MUSIC player: it owns one
 * global queue, so borrowing it for a chime would stop whatever Mark is
 * listening to. That rules it out on its own.
 *
 * ─── The two things that keep it polite ────────────────────────────────────
 *
 *   · `audioMixingMode: 'mixWithOthers'` — the chime plays OVER music and
 *     podcasts instead of pausing them. A pomodoro bell that stops your album
 *     is worse than no bell. On iOS this also puts the player on the ambient
 *     audio session, which means the ringer switch silences it: a phone set to
 *     silent stays silent, which is the behaviour anyone would expect.
 *   · `showNowPlayingNotification: false` — a 1.8-second chime has no business
 *     on the lock screen, and it must never displace the music player's own
 *     Now Playing card.
 *
 * ─── One player, not one per ding ──────────────────────────────────────────
 *
 * Native players hold real resources and must be released. Creating one per
 * completion would leak one per pomodoro for the life of the process, so there
 * is a single lazily-built player that seeks back to zero and replays. It is
 * never released: it is a ~78 KB asset that any focus block may need next, and
 * the app is the thing that outlives it.
 */

// Guarded: expo-video is a native module, absent under jest and in Expo Go
// before a rebuild. Every export below no-ops rather than throwing — a missing
// chime must never take the Focus page down with it.
let VideoModule = null;
try {
  // eslint-disable-next-line global-require
  VideoModule = require('expo-video');
} catch {
  VideoModule = null;
}

// eslint-disable-next-line global-require, import/no-unresolved
const CHIME = require('../assets/focus-complete.wav');

let player = null;
// Set once creation or playback has failed, so a broken build tries once and
// then stays quiet instead of throwing on every completion.
let broken = false;
// When we last made the sound. The push notification handler reads this to
// avoid dinging on top of us — see `recentlyChimed`.
let lastChimeAt = 0;

/** The shared player, built on first use. Null when audio isn't available. */
function ensurePlayer() {
  if (player || broken) return player;
  if (!VideoModule?.createVideoPlayer) { broken = true; return null; }
  try {
    const p = VideoModule.createVideoPlayer(CHIME);
    // Over the music, not instead of it. Also puts iOS on the ambient session,
    // so the ringer switch silences the chime.
    p.audioMixingMode = 'mixWithOthers';
    p.showNowPlayingNotification = false;
    p.loop = false;
    p.muted = false;
    p.volume = 1;
    player = p;
    return p;
  } catch {
    broken = true;
    return null;
  }
}

/**
 * Ding. Safe to call from a render effect: it never throws, and a second call
 * while the first is still ringing restarts the chime rather than layering two
 * copies of it on top of each other.
 */
export function playFocusComplete() {
  const p = ensurePlayer();
  if (!p) return;
  try {
    p.pause();
    // Back to the strike. Without this a second block's completion would play
    // from wherever the last one stopped — i.e. silence.
    p.currentTime = 0;
    p.play();
    lastChimeAt = Date.now();
  } catch {
    broken = true;
  }
}

/**
 * Did we just make the sound ourselves?
 *
 * The server also pushes "Focus complete 🐢" to the device that started the
 * block, and the foreground notification handler dings for it. With the app
 * open, that lands within a second of this chime — two sounds for one event.
 * `services/pomodoroNotify.js` asks this and drops the notification's sound
 * when the answer is yes, so the banner still appears and only one thing
 * rings.
 *
 * The window is generous on purpose: the push travels through APNs/FCM, so its
 * arrival is not tightly coupled to the local clock.
 */
export function recentlyChimed(withinMs = 8000) {
  return lastChimeAt > 0 && Date.now() - lastChimeAt < withinMs;
}

/** Test seam: forget the player and the last-chime stamp. */
export function __resetFocusChime() {
  player = null;
  broken = false;
  lastChimeAt = 0;
}
