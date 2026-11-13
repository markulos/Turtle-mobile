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
