import fs from 'fs';
import path from 'path';

/**
 * HOW the chip is animated, scanned — because the wrong way looks identical.
 *
 * The chip's travel jittered and ran late for two rounds of tuning, and the
 * cause was not a number. `withTiming` was being called INSIDE
 * useAnimatedStyle. A style worklet re-runs on every re-render and on every
 * change to any value it reads, and the animation it declares is re-created
 * each time — so one tab change (the duration lands, the lead lands, the
 * navigator commits, the lead is spent) restarted the travel four times, each
 * restart snapping the easing back to its first frame, where this curve is at
 * its fastest. Four kicks in 160ms, and a clock that kept starting over.
 *
 * Nothing about that is visible in a render test: the component mounts, the
 * style is a valid style, every assertion about colour and geometry passes.
 * It is only wrong in motion, on a device. So the shape of the solution is
 * pinned here instead:
 *
 *   the position is a shared value, written imperatively, ONCE per move;
 *   the style only READS it;
 *   the move is started by a reaction — the one place that can tell a real
 *   change of aim from a re-render.
 *
 * If you are here because this test failed, the question to answer is not
 * "how do I make the scan pass" but "what starts the animation now, and can a
 * re-render make it start again".
 */
const SRC = fs.readFileSync(path.join(__dirname, '..', 'TabBarPill.jsx'), 'utf8');

/** The body of the useAnimatedStyle call that drives the chip. */
const styleBody = () => {
  const at = SRC.indexOf('const pillStyle = useAnimatedStyle(');
  expect(at).toBeGreaterThan(-1);
  return SRC.slice(at, SRC.indexOf('\n\n', at));
};

describe('the chip travels on ONE animation per move', () => {
  test('the style declares no animation — it reads a position', () => {
    const body = styleBody();
    expect(body).not.toMatch(/withTiming|withSpring|withDecay/);
    expect(body).toMatch(/translateX: x\.value/);
  });

  test('the travel is started from a reaction, not from a render', () => {
    expect(SRC).toMatch(/useAnimatedReaction\(/);
    // The guard that makes a re-render harmless: a travel only begins when
    // the slot being aimed at actually changed.
    expect(SRC).toMatch(/if \(cur\.aim !== prev\.aim\)/);
  });

  test('a dragged chip is still written raw, with no animation at all', () => {
    // A filter is a lag, and under a fingertip there is something to measure
    // the lag against. This is the one path that must never go through
    // withTiming — see TabBarPill's header.
    expect(SRC).toMatch(/if \(cur\.dragging\) \{ x\.value = px; return; \}/);
  });

  test('a layout change places the chip rather than sending it travelling', () => {
    // A rotation, or hiding the Vault tab in Settings, moves every slot. The
    // chip belongs somewhere new, but it did not MOVE there.
    expect(SRC).toMatch(/cur\.offset !== prev\.offset/);
  });
});

/**
 * THE HANDOVER'S ORDER, scanned — because splitting it back up is the bug.
 *
 * Mirroring `index` and spending the `lead` are two writes, and a shared value
 * assigned from JS is a separate UI-thread job per assignment, each one running
 * the reaction before the next lands. Spend first and the aim falls through to
 * an `indexSV` that is still the slot the chip LEFT: a full travel backwards,
 * then a third travel forwards from wherever that reached. That is what shipped
 * as "the chip snaps about as it crosses the bar", and it got worse with
 * distance.
 *
 * chipAim.test.js walks the sequences and proves the rule; this pins the thing
 * that cannot be proved from the rule alone — that the two writes are in one
 * effect, in the order that never lets them disagree.
 */
describe('the lead is spent AFTER the navigator is mirrored', () => {
  test('both writes live in one effect, index first', () => {
    const iAt = SRC.indexOf('indexSV.value = index;');
    const spendAt = SRC.indexOf('lead.value = -1;');
    expect(iAt).toBeGreaterThan(-1);
    expect(spendAt).toBeGreaterThan(-1);
    expect(spendAt).toBeGreaterThan(iAt);
    // …and with no `useEffect(` between them, which is what would make them
    // two effects again and put the spend back in the earlier one.
    expect(SRC.slice(iAt, spendAt)).not.toMatch(/useEffect\(/);
  });

  test('the lead is spent in exactly one place', () => {
    // Two spends would reintroduce the early one without failing the order
    // check above.
    expect(SRC.match(/lead\.value = -1;/g)).toHaveLength(1);
  });

  test('the clock for the move is written before the aim that will use it', () => {
    // A travel timed against a stale duration is the other way these writes
    // can be got wrong: the aim changes, the reaction reads ms.value, and the
    // new one has not arrived yet.
    expect(SRC.indexOf('ms.value = chipSlideMs(')).toBeLessThan(SRC.indexOf('indexSV.value = index;'));
  });
});
