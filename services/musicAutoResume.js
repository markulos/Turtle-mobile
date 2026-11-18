/**
 * musicAutoResume — surviving a network blip while the phone is in a pocket.
 *
 * Mark, 2026-11-18: "why music playing in the background when the app is
 * closed stops playing after a few minutes?"
 *
 * ── What was actually happening ──────────────────────────────────────────
 *
 * Nothing in this app is cached to disk: `setupPlayer` is called without a
 * `cache` config, so AVPlayer streams every second of every track live from
 * the pond. That is fine on a desk and fragile in a pocket — one lost
 * connection (Wi-Fi roaming to another access point, Wi-Fi handing over to
 * cellular, the tailnet re-keying, the pond answering a range read in 40
 * seconds as the logs show it sometimes does) and the item fails.
 *
 * And a failed item was TERMINAL. The native player sets `playWhenReady =
 * false` and `state = .failed` and stops there — correctly, because deciding
 * what to do next is not its job. It hands the decision up as
 * `Event.PlaybackError` and offers `retry()` to act on it.
 *
 * This app listened to two events — a media-item transition and a remote
 * Next — so it never heard the error and never called retry. Playback simply
 * ended, silently, with no screen on to say so. The delay before the silence
 * is the already-buffered audio draining: a few minutes, exactly as reported,
 * and the reason this never looked like a network fault.
 *
 * ── What this does ───────────────────────────────────────────────────────
 *
 * It is a LADDER, not a single retry: re-prepare the item, seek back to where
 * the music was, play, and if that did not take, wait a little longer and try
 * again. A blip that lasted one second costs one second of music; a blip that
 * lasts a minute still recovers.
 *
 * Two things keep it honest:
 *
 *   · it only ever retries what is worth retrying. The player classifies its
 *     own failures, and a `source` error (a 404, a container AVPlayer cannot
 *     read) will fail identically forever — retrying it would burn battery in
 *     a pocket and never make a sound.
 *
 *   · it gives up OUT LOUD. When the ladder is exhausted the caller is told,
 *     so the transport bar can say the connection went and offer the tap that
 *     starts again. Audio that stops needs a reason on screen; that was half
 *     of this bug.
 *
 * Deliberately dependency-free: timers and the player are injected, so the
 * whole ladder is exercised in milliseconds by its tests rather than being
 * the kind of thing you can only find out about on a phone, in a pocket,
 * twenty minutes in.
 */

/**
 * The ladder, in milliseconds between attempts.
 *
 * Front-loaded because most of these are momentary: a second after the
 * failure the connection is usually back. The long rungs are for walking out
 * of range of the house and back in — about two minutes of patience in total,
 * which is as long as this is likely to get to run at all. On iOS an app with
 * the audio background mode is kept awake BY the audio; once the sound stops
 * the system is free to suspend it, and a suspended app's timers do not fire.
 * So the early rungs are the ones that save a session and the late ones are a
 * bonus when something else is holding the app up.
 */
export const RESUME_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000, 60000];

/** How often playback position is remembered while a track plays. */
export const SAMPLE_MS = 1000;

/**
 * Failures worth trying again.
 *
 * The player's own classification (see PlaybackErrorCode): `network` is a
 * transient connectivity fault and is the whole reason this file exists.
 * `unknown` is included because it is what an unclassifiable mid-stream drop
 * arrives as, and one wasted ladder is a far smaller cost than a listening
 * session ending in silence.
 *
 * `source` (a bad or missing file), `renderer` (the decoder) and
 * `play-not-permitted` (the web autoplay gate) are left out on purpose: each
 * will fail exactly the same way on every attempt.
 */
const RETRYABLE_CODES = ['network', 'unknown'];

export function isRetryable(code) {
  return RETRYABLE_CODES.includes(String(code || 'unknown'));
}

/** States in which there is a loaded track whose position is worth sampling. */
const LOADED_STATES = ['ready', 'buffering', 'playing'];

export function createAutoResume(player, options = {}) {
  const delays = Array.isArray(options.delays) && options.delays.length
    ? options.delays
    : RESUME_DELAYS_MS;
  const sampleMs = Number(options.sampleMs) > 0 ? Number(options.sampleMs) : SAMPLE_MS;
  const timers = options.timers || {};
  const startTimer = timers.setTimeout || setTimeout;
  const stopTimer = timers.clearTimeout || clearTimeout;
  const startSampler = timers.setInterval || setInterval;
  const stopSampler = timers.clearInterval || clearInterval;
  const onInterrupted = options.onInterrupted || (() => {});

  let attempt = 0;
  let timer = null;
  let sampler = null;
  /**
   * Where the music was when it stopped.
   *
   * `retry()` re-prepares the item from the beginning, so without this a blip
   * ninety seconds into a track restarts the track. Sampled on a clock rather
   * than read at the moment of failure because a failed AVPlayerItem's own
   * reported time is not something to build a resume on.
   */
  let lastPosition = 0;
  let recovering = false;
  let failure = null;

  const clearLadder = () => {
    if (timer) {
      stopTimer(timer);
      timer = null;
    }
    attempt = 0;
    recovering = false;
    failure = null;
  };

  const audible = () => {
    try {
      return !!player.isPlaying();
    } catch {
      return false;
    }
  };

  const recovered = () => {
    clearLadder();
    // Takes the sentence back off the screen by itself: the music is the
    // answer, and being told about a problem that has already fixed itself is
    // worse than not being told.
    onInterrupted(null);
  };

  const sample = () => {
    try {
      const position = Number(player.getProgress()?.position);
      if (Number.isFinite(position) && position > 0) lastPosition = position;
    } catch {
      // A player between items has no progress to report. Keep the last
      // reading; it is still the best answer to "where were we".
    }
    // The ladder's own rungs check this too, but a recovery can also arrive
    // between them — the connection returning while AVPlayer was still
    // buffering the attempt before.
    if (recovering && audible()) recovered();
  };

  const ensureSampling = () => {
    if (!sampler) sampler = startSampler(sample, sampleMs);
  };

  const endSampling = () => {
    if (sampler) {
      stopSampler(sampler);
      sampler = null;
    }
  };

  /** One rung: is it back? no — try, and come back later. */
  const climb = () => {
    timer = null;
    if (audible()) {
      recovered();
      return;
    }
    if (attempt >= delays.length) {
      const exhausted = { ...failure, exhausted: true };
      recovering = false;
      onInterrupted(exhausted);
      return;
    }
    const wait = delays[attempt];
    attempt += 1;
    try {
      // retry() is a no-op unless the player is in its failed state, which is
      // the right shape here: if something else has already recovered the
      // item, the seek and play below simply carry on from where we were.
      player.retry();
      if (lastPosition > 0) player.seekTo(lastPosition);
      player.play();
    } catch {
      // A throwing bridge call is just this rung failing. The next one is
      // already scheduled.
    }
    timer = startTimer(climb, wait);
  };

  return {
    /** `Event.PlaybackError` — the player telling us it has stopped. */
    handleError(event) {
      const code = String(event?.code || 'unknown');
      const message = String(event?.message || '') || 'Playback stopped';
      // The ladder already owns this failure; a second report of it must not
      // start a second ladder racing the first.
      if (recovering) return false;
      if (!isRetryable(code)) {
        failure = null;
        onInterrupted({ code, message, exhausted: true, retryable: false });
        return false;
      }
      failure = { code, message, retryable: true };
      recovering = true;
      attempt = 0;
      // Said before the first attempt, not after the last: the music has
      // already stopped, and "reconnecting" is the true description of the
      // next thirty seconds.
      onInterrupted({ ...failure, exhausted: false });
      climb();
      return true;
    },

    /** `Event.PlaybackStateChanged` — the sampler's on/off switch. */
    noteStateChange(state) {
      const next = String(state || '');
      if (next === 'error') {
        // Belt and braces. The error event carries the classification and
        // normally arrives first; this is the path for a player that reports
        // only the state, and `unknown` is retryable for exactly that reason.
        this.handleError({ code: 'unknown', message: 'Playback stopped' });
        return;
      }
      if (next === 'idle' || next === 'ended') {
        // A queue that finished is not an interruption. Nothing to resume,
        // nothing to say, and no clock left to run.
        endSampling();
        clearLadder();
        lastPosition = 0;
        return;
      }
      if (LOADED_STATES.includes(next)) {
        ensureSampling();
        if (recovering && audible()) recovered();
      }
    },

    /**
     * A new track started — forget where the last one was.
     *
     * Without this, a failure early in track two would seek to track one's
     * position and resume in the middle of the wrong song.
     */
    noteTrackChanged() {
      clearLadder();
      lastPosition = 0;
      ensureSampling();
    },

    /** The user moved the playhead; that is where a resume belongs now. */
    noteSeek(seconds) {
      const position = Number(seconds);
      if (Number.isFinite(position) && position >= 0) lastPosition = position;
    },

    /**
     * A deliberate stop — pause, a new queue, signing out.
     *
     * Pause is the important one: a pending rung would otherwise start the
     * music again a few seconds after someone had just silenced it.
     */
    cancel() {
      clearLadder();
      lastPosition = 0;
      onInterrupted(null);
    },

    /** The visible control's action, and the only way back out of exhausted. */
    resumeNow() {
      if (!failure) failure = { code: 'network', message: 'Playback stopped', retryable: true };
      recovering = true;
      attempt = 0;
      onInterrupted({ ...failure, exhausted: false });
      climb();
    },

    /** Test seams. Nothing in the app reads these. */
    position: () => lastPosition,
    isRecovering: () => recovering,
    isSampling: () => sampler !== null,
  };
}

export default { createAutoResume, isRetryable, RESUME_DELAYS_MS, SAMPLE_MS };
