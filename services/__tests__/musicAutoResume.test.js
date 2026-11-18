import {
  RESUME_DELAYS_MS, createAutoResume, isRetryable,
} from '../musicAutoResume';

/**
 * Keeping background playback alive across a network blip.
 *
 * Mark, 2026-11-18: "why music playing in the background when the app is
 * closed stops playing after a few minutes?" — because a failed item was the
 * end of it. Nothing listened for the player's error event and nothing called
 * its retry; the few minutes were the already-buffered audio draining.
 *
 * Every test here is one that could otherwise only be run by putting a phone
 * in a pocket and waiting, which is why the timers and the player are both
 * injected: a two-minute ladder is exercised in a few lines.
 */

/** A hand-cranked clock — no jest.useFakeTimers, so the ladder is explicit. */
function makeClock() {
  let now = 0;
  let seq = 0;
  const timeouts = new Map();
  const intervals = new Map();
  return {
    timers: {
      setTimeout: (fn, ms) => {
        seq += 1;
        timeouts.set(seq, { fn, at: now + (ms || 0) });
        return seq;
      },
      clearTimeout: (id) => timeouts.delete(id),
      setInterval: (fn, ms) => {
        seq += 1;
        intervals.set(seq, { fn, every: ms || 1, next: now + (ms || 1) });
        return seq;
      },
      clearInterval: (id) => intervals.delete(id),
    },
    /** Run everything due within `ms`, in time order, like a real loop. */
    advance(ms) {
      const until = now + ms;
      for (;;) {
        let due = null;
        for (const [id, t] of timeouts) {
          if (t.at <= until && (!due || t.at < due.at)) due = { id, at: t.at, kind: 'timeout', t };
        }
        for (const [id, t] of intervals) {
          if (t.next <= until && (!due || t.next < due.at)) due = { id, at: t.next, kind: 'interval', t };
        }
        if (!due) break;
        now = due.at;
        if (due.kind === 'timeout') {
          timeouts.delete(due.id);
          due.t.fn();
        } else {
          due.t.next = now + due.t.every;
          due.t.fn();
        }
      }
      now = until;
    },
    pending: () => timeouts.size,
    intervals: () => intervals.size,
  };
}

function makePlayer({ position = 0, playing = false } = {}) {
  const state = { position, playing };
  return {
    state,
    retry: jest.fn(),
    play: jest.fn(() => {}),
    seekTo: jest.fn((s) => { state.position = s; }),
    getProgress: jest.fn(() => ({ position: state.position, duration: 200, buffered: 0 })),
    isPlaying: jest.fn(() => state.playing),
  };
}

const setup = (opts = {}) => {
  const clock = makeClock();
  const player = makePlayer(opts.player);
  const seen = [];
  const resume = createAutoResume(player, {
    timers: clock.timers,
    delays: opts.delays,
    sampleMs: 1000,
    onInterrupted: (info) => seen.push(info),
  });
  return { clock, player, resume, seen };
};

const NETWORK = { code: 'network', message: 'The request timed out' };

describe('isRetryable', () => {
  test('a dropped connection is; a bad file is NOT', () => {
    // Retrying a 404 or a container AVPlayer cannot read fails identically
    // every time — and in a pocket, forever.
    expect(isRetryable('network')).toBe(true);
    expect(isRetryable('unknown')).toBe(true);
    expect(isRetryable('source')).toBe(false);
    expect(isRetryable('renderer')).toBe(false);
    expect(isRetryable('play-not-permitted')).toBe(false);
  });

  test('a code it has never seen is treated as unknown, which retries', () => {
    expect(isRetryable(undefined)).toBe(true);
    expect(isRetryable('')).toBe(true);
  });
});

describe('the resume ladder', () => {
  test('RE-PREPARES AND SEEKS BACK — the whole fix, in one attempt', () => {
    const { clock, player, resume } = setup();
    resume.noteStateChange('ready');
    player.state.position = 94.5;
    clock.advance(1000);            // one sample
    resume.handleError(NETWORK);

    // retry() first: play() alone does nothing to a failed item. Then back to
    // where the music was, or a blip 94 seconds in restarts the track.
    expect(player.retry).toHaveBeenCalledTimes(1);
    expect(player.seekTo).toHaveBeenCalledWith(94.5);
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  test('…and it says so BEFORE the first attempt, not after the last', () => {
    const { clock, resume, seen } = setup();
    resume.noteStateChange('ready');
    clock.advance(1000);
    resume.handleError(NETWORK);
    expect(seen[0]).toMatchObject({ code: 'network', exhausted: false });
  });

  test('it climbs, with a growing wait, and stops the moment sound returns', () => {
    const { clock, player, resume, seen } = setup({ delays: [1000, 2000, 4000] });
    resume.noteStateChange('ready');
    player.state.position = 30;
    clock.advance(1000);
    resume.handleError(NETWORK);
    expect(player.retry).toHaveBeenCalledTimes(1);

    clock.advance(1000);
    expect(player.retry).toHaveBeenCalledTimes(2);   // 1s later
    clock.advance(1000);
    expect(player.retry).toHaveBeenCalledTimes(2);   // not yet — this rung waits 2s
    clock.advance(1000);
    expect(player.retry).toHaveBeenCalledTimes(3);

    // The network comes back and the attempt takes.
    player.state.playing = true;
    clock.advance(4000);
    expect(player.retry).toHaveBeenCalledTimes(3);
    expect(resume.isRecovering()).toBe(false);
    // …and the sentence comes off the screen by itself.
    expect(seen[seen.length - 1]).toBeNull();
  });

  test('GIVES UP OUT LOUD, with nothing still pending', () => {
    const { clock, player, resume, seen } = setup({ delays: [1000, 2000] });
    resume.noteStateChange('ready');
    resume.handleError(NETWORK);
    clock.advance(60000);

    expect(player.retry).toHaveBeenCalledTimes(2);
    expect(seen[seen.length - 1]).toMatchObject({ code: 'network', exhausted: true });
    // A ladder that gave up must not leave a rung behind it, or the music
    // starts again on its own ten minutes later.
    expect(clock.pending()).toBe(0);
    expect(resume.isRecovering()).toBe(false);
  });

  test('a SECOND error does not start a second ladder racing the first', () => {
    const { clock, player, resume } = setup({ delays: [1000, 2000] });
    resume.noteStateChange('ready');
    expect(resume.handleError(NETWORK)).toBe(true);
    expect(resume.handleError(NETWORK)).toBe(false);
    expect(player.retry).toHaveBeenCalledTimes(1);
    clock.advance(1000);
    expect(player.retry).toHaveBeenCalledTimes(2);
  });

  test('a failure it cannot fix is reported once and never retried', () => {
    const { clock, player, resume, seen } = setup();
    resume.noteStateChange('ready');
    resume.handleError({ code: 'source', message: 'No such file' });
    clock.advance(120000);

    expect(player.retry).not.toHaveBeenCalled();
    expect(seen).toEqual([{
      code: 'source', message: 'No such file', exhausted: true, retryable: false,
    }]);
  });

  test('a track that never started is resumed WITHOUT a seek', () => {
    // Position 0: there is nowhere to go back to, and seeking to 0 on a
    // freshly prepared item is a wasted round trip.
    const { player, resume } = setup();
    resume.noteStateChange('ready');
    resume.handleError(NETWORK);
    expect(player.retry).toHaveBeenCalledTimes(1);
    expect(player.seekTo).not.toHaveBeenCalled();
  });
});

describe('what must NOT wake the music up', () => {
  test('A DELIBERATE PAUSE cancels the ladder', () => {
    // Otherwise a pending rung starts the music again a few seconds after
    // somebody silenced it — a worse bug than the one being fixed.
    const { clock, player, resume, seen } = setup({ delays: [5000, 5000] });
    resume.noteStateChange('ready');
    resume.handleError(NETWORK);
    player.retry.mockClear();
    player.play.mockClear();

    resume.cancel();
    clock.advance(120000);
    expect(player.retry).not.toHaveBeenCalled();
    expect(player.play).not.toHaveBeenCalled();
    expect(clock.pending()).toBe(0);
    expect(seen[seen.length - 1]).toBeNull();
  });

  test('a queue that simply ENDED is not an interruption', () => {
    const { clock, player, resume, seen } = setup();
    resume.noteStateChange('ready');
    resume.noteStateChange('ended');
    clock.advance(120000);
    expect(player.retry).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
    // …and the position clock is switched off with it.
    expect(resume.isSampling()).toBe(false);
  });

  test('…and so is an idle player', () => {
    const { resume } = setup();
    resume.noteStateChange('ready');
    expect(resume.isSampling()).toBe(true);
    resume.noteStateChange('idle');
    expect(resume.isSampling()).toBe(false);
  });
});

describe('where "back" is', () => {
  test('A NEW TRACK FORGETS THE LAST ONE’S POSITION', () => {
    // The bug this prevents: track two fails ten seconds in, and the ladder
    // seeks to track one's three-minute mark — resuming in the middle of the
    // wrong song.
    const { clock, player, resume } = setup();
    resume.noteStateChange('ready');
    player.state.position = 180;
    clock.advance(1000);
    expect(resume.position()).toBe(180);

    resume.noteTrackChanged();
    expect(resume.position()).toBe(0);
    player.state.position = 0;
    resume.handleError(NETWORK);
    expect(player.seekTo).not.toHaveBeenCalled();
  });

  test('a user seek moves it, without waiting for the next sample', () => {
    const { player, resume } = setup();
    resume.noteStateChange('ready');
    resume.noteSeek(42);
    resume.handleError(NETWORK);
    expect(player.seekTo).toHaveBeenCalledWith(42);
  });

  test('the position is SAMPLED, not read off a failed item', () => {
    // An AVPlayerItem that has failed is not a thing to ask the time of. The
    // last good reading is the honest answer, so the clock runs while the
    // music does.
    const { clock, player, resume } = setup();
    resume.noteStateChange('ready');
    player.state.position = 12;
    clock.advance(1000);
    player.state.position = 55;
    clock.advance(1000);
    player.getProgress.mockImplementation(() => { throw new Error('no item'); });
    resume.handleError(NETWORK);
    expect(player.seekTo).toHaveBeenCalledWith(55);
  });

  test('a progress reading of zero never overwrites a real one', () => {
    const { clock, player, resume } = setup();
    resume.noteStateChange('ready');
    player.state.position = 70;
    clock.advance(1000);
    player.state.position = 0;        // between items, or a fresh prepare
    clock.advance(1000);
    expect(resume.position()).toBe(70);
  });
});

describe('the ladder’s shape', () => {
  test('front-loaded, and about two minutes of patience in total', () => {
    // Most of these are momentary, so the first rungs are the ones that save a
    // session. The long ones are for walking out of range of the house — and
    // they only ever get to run while something else is keeping the app awake,
    // because iOS suspends an app once its audio stops.
    expect(RESUME_DELAYS_MS[0]).toBeLessThanOrEqual(1000);
    for (let i = 1; i < RESUME_DELAYS_MS.length; i += 1) {
      expect(RESUME_DELAYS_MS[i]).toBeGreaterThan(RESUME_DELAYS_MS[i - 1]);
    }
    const total = RESUME_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(60000);
    expect(total).toBeLessThanOrEqual(180000);
  });

  test('the visible Resume starts the whole ladder again', () => {
    // The only way back out of exhausted, and it has to be a full ladder: the
    // tap usually happens because the person has just walked back indoors.
    const { clock, player, resume, seen } = setup({ delays: [1000, 2000] });
    resume.noteStateChange('ready');
    resume.handleError(NETWORK);
    clock.advance(60000);
    expect(seen[seen.length - 1].exhausted).toBe(true);
    player.retry.mockClear();

    resume.resumeNow();
    expect(player.retry).toHaveBeenCalledTimes(1);
    expect(seen[seen.length - 1].exhausted).toBe(false);
    clock.advance(1000);
    expect(player.retry).toHaveBeenCalledTimes(2);
  });

  test('a bridge call that throws is just one rung failing', () => {
    const { clock, player, resume } = setup({ delays: [1000, 2000] });
    resume.noteStateChange('ready');
    player.retry.mockImplementation(() => { throw new Error('bridge gone'); });
    expect(() => resume.handleError(NETWORK)).not.toThrow();
    clock.advance(1000);
    expect(player.retry).toHaveBeenCalledTimes(2);
  });

  test('a bare error STATE is enough to start it', () => {
    // The classification normally arrives with the error event; a player that
    // reports only the state must not silently stop being recoverable.
    const { player, resume } = setup();
    resume.noteStateChange('ready');
    resume.noteStateChange('error');
    expect(player.retry).toHaveBeenCalledTimes(1);
    expect(resume.isRecovering()).toBe(true);
  });
});
