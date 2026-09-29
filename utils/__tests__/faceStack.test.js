/**
 * The avatar stack's overflow is decided by WIDTH, not by a count.
 *
 * A board card's caption is a title, a count and whatever is pinned to its
 * right. Everything else in that row can shrink or ellipsize; a stack of discs
 * cannot, so it is the one thing that can push the title off the end of the
 * card (STYLE-RULES §2). These are the numbers that stop it.
 */
import { facesThatFit, overlapFor, rosterOf, stackWidth } from '../faceStack';

const SIZE = 18;
const OVER = overlapFor(SIZE); // 6
const STEP = SIZE - OVER;      // 12 — what each extra disc costs

describe('geometry', () => {
  test('the first disc costs its width, the rest cost the overlap step', () => {
    expect(overlapFor(18)).toBe(6);
    expect(stackWidth(0, SIZE)).toBe(0);
    expect(stackWidth(1, SIZE)).toBe(SIZE);
    expect(stackWidth(2, SIZE)).toBe(SIZE + STEP);
    expect(stackWidth(4, SIZE)).toBe(SIZE + 3 * STEP);
  });
});

describe('facesThatFit', () => {
  test('nobody is nothing — the row gives the space back to the title', () => {
    expect(facesThatFit({ total: 0, available: 200, size: SIZE })).toEqual({ shown: 0, overflow: 0 });
  });

  test('when they all fit, they are all drawn and nothing is counted', () => {
    expect(facesThatFit({ total: 3, available: 200, size: SIZE })).toEqual({ shown: 3, overflow: 0 });
    // Exactly the width of three discs, to the point.
    expect(facesThatFit({ total: 3, available: stackWidth(3, SIZE), size: SIZE }))
      .toEqual({ shown: 3, overflow: 0 });
  });

  test('one point short of fitting them all, the last becomes a "+1"', () => {
    const tight = stackWidth(3, SIZE) - 1;
    const r = facesThatFit({ total: 3, available: tight, size: SIZE });
    expect(r.shown + r.overflow).toBe(3);
    expect(r.overflow).toBeGreaterThan(0);
    // The faces drawn plus the counter disc still fit in the room given.
    expect(stackWidth(r.shown, SIZE) + (SIZE - OVER)).toBeLessThanOrEqual(tight);
  });

  test('the counter disc is counted — a stack never ends past its own width', () => {
    for (const available of [18, 24, 30, 42, 56, 80, 120]) {
      const r = facesThatFit({ total: 9, available, size: SIZE });
      const drawn = stackWidth(r.shown, SIZE) + (r.overflow ? SIZE - OVER : 0);
      // One disc of slack is allowed for the floor case below; otherwise the
      // stack must be inside the room it was given.
      if (r.shown > 1) expect(drawn).toBeLessThanOrEqual(available);
    }
  });

  test('the cap holds even when there is room for more', () => {
    const r = facesThatFit({ total: 12, available: 1000, size: SIZE });
    expect(r.shown).toBe(4);
    expect(r.overflow).toBe(8);
    expect(facesThatFit({ total: 12, available: 1000, size: SIZE, max: 2 }).shown).toBe(2);
  });

  test('always at least one face while a disc fits at all', () => {
    // A bare "+6" is a number; one face and a "+5" is a stack of people.
    const r = facesThatFit({ total: 6, available: SIZE, size: SIZE });
    expect(r.shown).toBe(1);
    expect(r.overflow).toBe(5);
  });

  test('no room for even one disc: everyone overflows, nothing is drawn', () => {
    const r = facesThatFit({ total: 6, available: SIZE - 1, size: SIZE });
    expect(r).toEqual({ shown: 0, overflow: 6 });
  });

  test('nonsense in, a usable answer out', () => {
    expect(facesThatFit({ total: 3, available: 100, size: 0 })).toEqual({ shown: 0, overflow: 3 });
    expect(facesThatFit({})).toEqual({ shown: 0, overflow: 0 });
  });

  test('shown + overflow is always everyone', () => {
    for (let total = 1; total <= 10; total += 1) {
      for (const available of [0, 10, 18, 31, 47, 63, 90, 140]) {
        const r = facesThatFit({ total, available, size: SIZE });
        expect(r.shown + r.overflow).toBe(total);
      }
    }
  });
});

describe('rosterOf', () => {
  test('the same person twice is one face', () => {
    // An owner is routinely also in the list of people it is shared with.
    const people = [{ userId: 'u1', name: 'Mark' }, { userId: 'u1', name: 'Mark' }, { userId: 'u2', name: 'Sam' }];
    expect(rosterOf(people).map((p) => p.userId)).toEqual(['u1', 'u2']);
  });

  test('it falls back to the name when a record has no id', () => {
    expect(rosterOf([{ name: 'Sam' }, { name: 'sam' }]).length).toBe(1);
  });

  test('order is kept — whoever is listed first is drawn on top', () => {
    const r = rosterOf([{ userId: 'owner' }, { userId: 'a' }, { userId: 'b' }]);
    expect(r[0].userId).toBe('owner');
  });

  test('empty, null and junk entries are dropped rather than drawn', () => {
    expect(rosterOf(null)).toEqual([]);
    expect(rosterOf([null, undefined, {}, { userId: '  ' }])).toEqual([]);
  });
});
