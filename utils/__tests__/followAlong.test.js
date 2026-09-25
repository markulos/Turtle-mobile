/**
 * Which line is lit while the audio plays.
 *
 * The rule that matters is the one about GAPS: a transcript is not a partition
 * of the timeline, and a strict "line containing t" test unlights the page
 * every time someone stops for breath.
 */
import { activeTurnIndex, captionAt, followState, seekTargetFor } from '../followAlong';

// A short conversation with a real gap in it: nobody talks between 6s and 10s.
const TURNS = [
  { start: 0, end: 2.5, text: 'Morning.', speaker: 'Mark' },
  { start: 2.5, end: 6, text: 'Did the deploy go out?', speaker: 'Mark' },
  { start: 10, end: 14, text: 'It did, about an hour ago.', speaker: 'Person 2' },
  { start: 14, end: 20, text: 'Anything break?', speaker: 'Mark' },
];

describe('activeTurnIndex', () => {
  test('finds the line being spoken', () => {
    expect(activeTurnIndex(TURNS, 0)).toBe(0);
    expect(activeTurnIndex(TURNS, 1)).toBe(0);
    expect(activeTurnIndex(TURNS, 3)).toBe(1);
    expect(activeTurnIndex(TURNS, 13.9)).toBe(2);
    expect(activeTurnIndex(TURNS, 19)).toBe(3);
  });

  test('holds the last line through a silence instead of going dark', () => {
    // 6s → 10s is a pause. The page should still show where we are.
    expect(activeTurnIndex(TURNS, 7)).toBe(1);
    expect(activeTurnIndex(TURNS, 9.9)).toBe(1);
  });

  test('and holds the last line after the transcript ends', () => {
    expect(activeTurnIndex(TURNS, 600)).toBe(3);
  });

  test('nothing is lit before the first line starts', () => {
    const late = [{ start: 12, end: 15, text: 'Hello?' }];
    expect(activeTurnIndex(late, 0)).toBe(-1);
    expect(activeTurnIndex(late, 11.9)).toBe(-1);
    expect(activeTurnIndex(late, 12)).toBe(0);
  });

  test('a boundary belongs to the line that is starting', () => {
    expect(activeTurnIndex(TURNS, 2.5)).toBe(1);
    expect(activeTurnIndex(TURNS, 10)).toBe(2);
  });

  test('clock jitter of a few ms does not fall off the start of a line', () => {
    // Players report 9.999 for 10.000 constantly.
    expect(activeTurnIndex(TURNS, 9.995)).toBe(2);
  });

  test('empty, absent and nonsense inputs answer -1 rather than throwing', () => {
    expect(activeTurnIndex([], 5)).toBe(-1);
    expect(activeTurnIndex(null, 5)).toBe(-1);
    expect(activeTurnIndex(TURNS, undefined)).toBe(-1);
    expect(activeTurnIndex(TURNS, NaN)).toBe(-1);
  });

  test('agrees with a linear scan over a long transcript', () => {
    // The binary search is the part most likely to be subtly wrong, so it is
    // checked against the obvious implementation.
    const many = Array.from({ length: 500 }, (_, i) => ({ start: i * 3, end: i * 3 + 2, text: `line ${i}` }));
    const scan = (t) => {
      let found = -1;
      many.forEach((turn, i) => { if (turn.start <= t) found = i; });
      return found;
    };
    for (const t of [0, 1, 2.9, 3, 44, 250.5, 1000, 1497, 5000]) {
      expect(activeTurnIndex(many, t)).toBe(scan(t));
    }
  });
});

describe('followState', () => {
  test('reports a line as spoken while the clock is inside it', () => {
    expect(followState(TURNS, 1)).toEqual({ index: 0, spoken: true });
    expect(followState(TURNS, 12)).toEqual({ index: 2, spoken: true });
  });

  test('and as NOT spoken through the pause after it', () => {
    // Still line 1 — the caller draws it quieter rather than moving on.
    expect(followState(TURNS, 8)).toEqual({ index: 1, spoken: false });
  });

  test('a turn with no usable end counts as spoken, not as a permanent pause', () => {
    const odd = [{ start: 0, end: 0, text: 'Hmm' }];
    expect(followState(odd, 30)).toEqual({ index: 0, spoken: true });
  });
});

describe('seekTargetFor', () => {
  test('lands a hair before the line, so its first word is not clipped', () => {
    expect(seekTargetFor({ start: 10 })).toBeCloseTo(9.85, 5);
  });

  test('never seeks before the beginning of the file', () => {
    expect(seekTargetFor({ start: 0 })).toBe(0);
    expect(seekTargetFor({ start: 0.05 })).toBe(0);
  });
});

describe('captionAt', () => {
  test('is the line being spoken', () => {
    expect(captionAt(TURNS, 3)).toBe('Did the deploy go out?');
  });

  test('is empty before the transcript starts, so nothing is drawn', () => {
    expect(captionAt([{ start: 5, end: 6, text: 'Hi' }], 0)).toBe('');
  });
});
