import {
  BUFFER_TARGET_SEC,
  MAX_PERCENT,
  RESOLVE_CEILING,
  RESOLVE_HALF_MS,
  STALLED_AFTER_MS,
  preparingLabel,
  preparingPercent,
  preparingStalled,
} from '../preparingProgress';

describe('while the pond is still resolving', () => {
  test('it starts at nothing and climbs', () => {
    expect(preparingPercent({ elapsedMs: 0 })).toBe(0);
    const early = preparingPercent({ elapsedMs: 300 });
    const later = preparingPercent({ elapsedMs: 1200 });
    expect(early).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(early);
  });

  test('half the distance to the ceiling in the time a resolve usually takes', () => {
    expect(preparingPercent({ elapsedMs: RESOLVE_HALF_MS })).toBe(Math.round(RESOLVE_CEILING / 2));
  });

  test('a resolve that drags crawls instead of claiming to be nearly done', () => {
    // The point of an asymptote: there is no measurement behind this half, so
    // it must never say "almost there" on the strength of a clock.
    expect(preparingPercent({ elapsedMs: 10_000 })).toBeLessThan(RESOLVE_CEILING);
    // Still under it after two minutes — which the curve alone does not
    // guarantee, because 70 * (1 - 2**-80) is exactly 70 in float64.
    expect(preparingPercent({ elapsedMs: 120_000 })).toBe(RESOLVE_CEILING - 1);
    expect(preparingPercent({ elapsedMs: 86_400_000 })).toBe(RESOLVE_CEILING - 1);
  });
});

describe('once bytes are actually arriving', () => {
  test('the first byte is the jump — it is the one real event in the wait', () => {
    const estimating = preparingPercent({ elapsedMs: 400 });
    const measuring = preparingPercent({ elapsedMs: 400, bufferedAheadSec: 0.1 });
    expect(estimating).toBeLessThan(RESOLVE_CEILING);
    expect(measuring).toBeGreaterThanOrEqual(RESOLVE_CEILING);
  });

  test('and from there it tracks what the player actually has in hand', () => {
    const half = preparingPercent({ bufferedAheadSec: BUFFER_TARGET_SEC / 2 });
    const full = preparingPercent({ bufferedAheadSec: BUFFER_TARGET_SEC });
    expect(half).toBe(Math.round(RESOLVE_CEILING + (MAX_PERCENT - RESOLVE_CEILING) / 2));
    expect(full).toBe(MAX_PERCENT);
  });

  test('more buffer than the player needs is still not 100 — only sound is', () => {
    expect(preparingPercent({ bufferedAheadSec: 600 })).toBe(MAX_PERCENT);
    expect(preparingPercent({ elapsedMs: 1e9, bufferedAheadSec: 1e9 })).toBe(MAX_PERCENT);
  });
});

describe('it never goes backwards', () => {
  test('a buffer that re-bases on a seek does not rewind the number', () => {
    // `buffered` is an absolute position: seeking re-bases it, and a stall can
    // drop it. A progress number that falls reads as something going wrong.
    const shown = preparingPercent({ bufferedAheadSec: BUFFER_TARGET_SEC });
    expect(preparingPercent({ bufferedAheadSec: 0, elapsedMs: 50, floor: shown })).toBe(shown);
  });

  test('the clock cannot undo a reading either', () => {
    const shown = preparingPercent({ elapsedMs: 5000 });
    expect(preparingPercent({ elapsedMs: 0, floor: shown })).toBe(shown);
  });
});

describe('rubbish in', () => {
  test('is zero, not NaN on someone\'s screen', () => {
    expect(preparingPercent()).toBe(0);
    expect(preparingPercent({ elapsedMs: NaN, bufferedAheadSec: NaN, floor: NaN })).toBe(0);
    expect(preparingPercent({ elapsedMs: -5, bufferedAheadSec: -5 })).toBe(0);
    expect(preparingPercent({ elapsedMs: Infinity })).toBe(0);
  });
});

describe('when the wait stops being one', () => {
  test('a number pinned at the ceiling is a stall', () => {
    // The bug this exists for: the estimate tops out at 69 and then has
    // nowhere to go, so a preview that never produced a byte sat there for
    // ever and the screen read as "working on it".
    expect(preparingPercent({ elapsedMs: STALLED_AFTER_MS })).toBe(RESOLVE_CEILING - 1);
    expect(preparingStalled({ elapsedMs: STALLED_AFTER_MS })).toBe(true);
  });

  // THE INVARIANT, and the reason this file has a test that scans: a frozen
  // percentage is never shown. The first version of the stall state missed it
  // by picking 20s out of the air while the number actually stops moving at
  // ~9.2s, which left eleven seconds of frozen "69%" on screen — reported as
  // "still gets stuck at 69%", because it still was.
  //
  // Asserted by walking the clock rather than by restating the formula: a test
  // that recomputes `HALF * log2(CEILING)` would agree with a wrong constant
  // as happily as a right one. This asks the real question instead — is there
  // any millisecond at which the number has stopped and the words have not
  // taken over?
  test('the words take over on the very millisecond the number stops moving', () => {
    let firstFrozen = null;
    for (let t = 0; t <= 60_000; t += 1) {
      if (preparingPercent({ elapsedMs: t }) === RESOLVE_CEILING - 1) { firstFrozen = t; break; }
    }
    expect(firstFrozen).not.toBeNull();
    expect(preparingStalled({ elapsedMs: firstFrozen })).toBe(true);
    // And one tick earlier the number was still climbing, so it must NOT have.
    expect(preparingPercent({ elapsedMs: firstFrozen - 1 })).toBeLessThan(RESOLVE_CEILING - 1);
    expect(preparingStalled({ elapsedMs: firstFrozen - 1 })).toBe(false);
  });

  test('but not before — a slow resolve is still a resolve', () => {
    expect(preparingStalled({ elapsedMs: 0 })).toBe(false);
    // The slowest HEALTHY path is the pond falling back to spawning
    // yt-dlp.exe, ~3.6s. Nothing about that deserves an alarm, and the number
    // is still visibly moving there (~56%).
    expect(preparingStalled({ elapsedMs: 3600 })).toBe(false);
    expect(preparingStalled({ elapsedMs: STALLED_AFTER_MS - 1 })).toBe(false);
  });

  test('bytes in hand mean it is slow, not stuck, however long it takes', () => {
    // A long track that buffers for a minute is a different situation, and it
    // has a real percentage climbing to say so.
    expect(preparingStalled({ elapsedMs: 60_000, bufferedAheadSec: 0.5 })).toBe(false);
    // …and it goes back to false on its own when the bytes finally arrive,
    // because nothing here latches.
    expect(preparingStalled({ elapsedMs: 1e9, bufferedAheadSec: 2 })).toBe(false);
  });

  test('rubbish in is not a stall', () => {
    expect(preparingStalled()).toBe(false);
    expect(preparingStalled({ elapsedMs: NaN })).toBe(false);
    expect(preparingStalled({ elapsedMs: Infinity })).toBe(false);
    expect(preparingStalled({ elapsedMs: 1e9, bufferedAheadSec: NaN })).toBe(true);
  });
});

describe('the sentence both surfaces show', () => {
  test('carries the number, rounded', () => {
    expect(preparingLabel(0)).toBe('Finding the audio... 0%');
    expect(preparingLabel(41.6)).toBe('Finding the audio... 42%');
  });

  test('says something sane with nothing to say', () => {
    expect(preparingLabel(undefined)).toBe('Finding the audio... 0%');
    expect(preparingLabel(NaN)).toBe('Finding the audio... 0%');
  });

  test('drops the number once it has stopped meaning anything', () => {
    // Deliberately NOT "Finding the audio... 69%" with an extra clause: the
    // percentage is the part that was lying, so it goes.
    expect(preparingLabel(69, { stalled: true })).toBe('Still finding the audio - tap to try again');
    expect(preparingLabel(69, { stalled: true })).not.toMatch(/%/);
    // And the option is opt-in, so every existing caller reads the same.
    expect(preparingLabel(69, { stalled: false })).toBe('Finding the audio... 69%');
  });
});
