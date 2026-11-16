import {
  POKE_LIMIT, POKE_WINDOW_MS, SULK_MS, nextPoke,
} from '../turtlePoke';

/**
 * How much poking the mark will take.
 *
 * Mark, 2026-11-16: "let the turtle have a cute nudge animation and if done
 * too many times make him go off the ledge but come back after a bit."
 *
 * The joke only works if leaving is plainly a REACTION to being pestered. A
 * plain counter would send him off the ledge on the fifth poke of the week,
 * which reads as a bug — so the rules are about a run, and they are here
 * where they can be checked without a clock.
 */

describe('nextPoke', () => {
  test('a run of pokes counts up, and the one past the limit sends him off', () => {
    let state = { count: 0, lastAt: 0 };
    for (let i = 1; i <= POKE_LIMIT; i += 1) {
      state = nextPoke(state, 1000 + i * 100);
      expect(state.flee).toBe(false);
      expect(state.count).toBe(i);
    }
    const last = nextPoke(state, 1000 + (POKE_LIMIT + 1) * 100);
    expect(last.flee).toBe(true);
  });

  test('…and the count RESETS with him, so he does not flee on the way back', () => {
    // Coming back to a counter still sitting at the limit would mean the
    // first touch after a sulk sends him straight off again.
    let state = { count: 0, lastAt: 0 };
    for (let i = 0; i <= POKE_LIMIT; i += 1) state = nextPoke(state, 1000 + i * 100);
    expect(state.flee).toBe(true);
    expect(state.count).toBe(0);
  });

  test('POKES EXPIRE — two hellos far apart are not a pestering', () => {
    // The whole point. Without the window the fifth poke of the week is the
    // one that breaks him.
    let state = { count: 0, lastAt: 0 };
    for (let i = 1; i < POKE_LIMIT; i += 1) state = nextPoke(state, i * 100);
    expect(state.count).toBe(POKE_LIMIT - 1);
    // Left alone for longer than the window: the run starts again at one.
    const later = nextPoke(state, state.lastAt + POKE_WINDOW_MS + 1);
    expect(later.count).toBe(1);
    expect(later.flee).toBe(false);
  });

  test('…and exactly on the window still counts as part of the run', () => {
    const state = nextPoke({ count: 2, lastAt: 500 }, 500 + POKE_WINDOW_MS);
    expect(state.count).toBe(3);
  });

  test('the first poke of all is a run of one, from nothing', () => {
    for (const empty of [undefined, null, {}]) {
      expect(nextPoke(empty, 10)).toEqual({ count: 1, lastAt: 10, flee: false });
    }
  });

  test('the window and the sulk are both on a human scale', () => {
    // Longer than a fast tap-tap-tap and well short of "I came back later".
    expect(POKE_WINDOW_MS).toBeGreaterThan(900);
    expect(POKE_WINDOW_MS).toBeLessThan(4000);
    // Long enough to be missed, short enough that nobody thinks he is broken.
    expect(SULK_MS).toBeGreaterThan(2000);
    expect(SULK_MS).toBeLessThan(10000);
    // And he puts up with a few — one or two would be sulky rather than cute.
    expect(POKE_LIMIT).toBeGreaterThanOrEqual(3);
  });
});
