import {
  BUFFER_TARGET_SEC,
  MAX_PERCENT,
  RESOLVE_CEILING,
  RESOLVE_HALF_MS,
  preparingLabel,
  preparingPercent,
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

describe('the sentence both surfaces show', () => {
  test('carries the number, rounded', () => {
    expect(preparingLabel(0)).toBe('Finding the audio... 0%');
    expect(preparingLabel(41.6)).toBe('Finding the audio... 42%');
  });

  test('says something sane with nothing to say', () => {
    expect(preparingLabel(undefined)).toBe('Finding the audio... 0%');
    expect(preparingLabel(NaN)).toBe('Finding the audio... 0%');
  });
});
