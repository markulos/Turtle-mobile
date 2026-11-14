import { chipAim } from '../dockMotion';

/**
 * THE HANDOVER. Not the aim rule — the SEQUENCE.
 *
 * A tab change writes three shared values, and every one of them is a separate
 * job on the UI thread (a JS-side `sv.value = v` compiles to `runOnUI`), so the
 * chip's driver runs between them and acts on each intermediate state it finds.
 * A travel starts whenever the aim CHANGES, which means an intermediate state
 * where two sources disagree does not just look wrong for a frame: it commits a
 * whole animation in the wrong direction, and the next write starts another one
 * from wherever that got to.
 *
 * That is what shipped: the lead was spent in an effect declared above the one
 * that mirrored `index`, so the aim fell through to a value that was still the
 * slot the chip had left, and every tab change ran three travels with the
 * middle one reversed. Worse the further the chip went, which is how it was
 * reported — "it tries to snap to each tab as it travels the whole bar".
 *
 * So these walk the real write orders and assert on the aim at every step. The
 * assertion that matters is not any single value; it is that the aim takes
 * exactly ONE new value across a whole tab change.
 */

// Every state the aim passes through, given the writes a tab change makes in
// order. Returns the sequence, so a test can assert on its shape rather than
// on a handful of separate calls.
const walk = (writes, start) => {
  const state = { ...start };
  const seen = [chipAim(state.dragging, state.slot, state.lead, state.index)];
  writes.forEach((w) => {
    Object.assign(state, w);
    seen.push(chipAim(state.dragging, state.slot, state.lead, state.index));
  });
  return seen;
};

// How many times the aim actually changed across a sequence — one travel per
// change, so this is a count of animations started.
const travels = (seq) => seq.filter((v, i) => i > 0 && v !== seq[i - 1]).length;

const RESTING = { dragging: false, slot: -1, lead: -1, index: 0 };

describe('the aim rule', () => {
  test('a thumb outranks everything, and keeps its fraction', () => {
    expect(chipAim(true, 2.4, 5, 0)).toBe(2.4);
  });

  test('a lead outranks the navigator while it is unspent', () => {
    expect(chipAim(false, -1, 5, 0)).toBe(5);
  });

  test('the navigator has the last word once the lead is spent', () => {
    expect(chipAim(false, -1, -1, 5)).toBe(5);
  });

  test('slot 0 is a real lead, not an absent one', () => {
    // -1 is the only "nothing", so the first tab must not read as unset —
    // tapping Tasks from Turtle is the move this would break.
    expect(chipAim(false, -1, 0, 4)).toBe(0);
  });
});

describe('a TAP, across the writes it makes', () => {
  // tabPress writes the lead; the commit then mirrors `index` and spends it.
  const CORRECT = [
    { lead: 5 }, // tabPress, on the JS thread, before React does anything
    { index: 5 }, // the navigator agrees
    { lead: -1 }, // …and only now is the lead spent
  ];

  test('starts exactly one travel, straight to the chosen tab', () => {
    const seq = walk(CORRECT, RESTING);
    expect(seq).toEqual([0, 5, 5, 5]);
    expect(travels(seq)).toBe(1);
  });

  test('never aims backwards at the tab it is leaving', () => {
    // Once the move has begun, the slot the chip came from must never reappear
    // as an aim — that reappearance IS the backward travel.
    expect(walk(CORRECT, RESTING).slice(1)).not.toContain(RESTING.index);
  });

  // THE REGRESSION, written as the order that was wrong. If someone splits
  // the handover back into two effects, or reorders the writes inside it,
  // this is what they will have done.
  test('spending the lead BEFORE the navigator agrees is three travels, one reversed', () => {
    const seq = walk([
      { lead: 5 },
      { lead: -1 }, // spent too early: the aim falls through to the OLD index
      { index: 5 },
    ], RESTING);
    expect(seq).toEqual([0, 5, 0, 5]);
    expect(travels(seq)).toBe(3);
    // And the middle one is the backward kick: the aim returns to the slot
    // the chip had already left.
    expect(seq[2]).toBe(RESTING.index);
  });
});

describe('a DRAG release, across the writes it makes', () => {
  // The lift chooses a slot on the UI thread, hands the chip back, and the
  // navigate follows through React.
  const held = { dragging: true, slot: 4.3, lead: -1, index: 0 };

  test('starts one travel from where the finger let go', () => {
    const seq = walk([
      { lead: 4 }, // onEnd: the chosen slot, written before the chip is released
      { dragging: false, slot: -1 }, // onFinalize: the chip is the navigator's again
      { index: 4 }, // the navigator agrees
      { lead: -1 }, // spent last
    ], held);
    // Under the thumb the aim is the finger; after the lift it is slot 4 and
    // stays there for every remaining write.
    expect(seq).toEqual([4.3, 4.3, 4, 4, 4]);
    expect(travels(seq)).toBe(1);
  });

  test('a scrub that comes back to the tab it started on asks for no travel', () => {
    const seq = walk([
      { lead: 0 },
      { dragging: false, slot: -1 },
      { lead: -1 },
    ], { dragging: true, slot: 0.2, lead: -1, index: 0 });
    // It still settles (0.2 → 0 is the lifted-thumb settle, a different path
    // in the driver), but the aim never leaves slot 0 — so no tab change and
    // no full-length travel.
    expect(seq[seq.length - 1]).toBe(0);
    expect(seq).not.toContain(1);
  });
});

describe('a tab change with no touch behind it', () => {
  test('a deep link is one travel, with no lead involved', () => {
    const seq = walk([{ index: 3 }, { lead: -1 }], RESTING);
    expect(seq).toEqual([0, 3, 3]);
    expect(travels(seq)).toBe(1);
  });
});
