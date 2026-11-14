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
    expect(body).toMatch(/translateX: x\.value \+ catchUp\.value/);
    // …and the icons are told where that is, in slots, by a reaction — not
    // by anything React renders.
    expect(SRC).toMatch(/\(x\.value \+ catchUp\.value - offsetSV\.value\) \/ TAB_SLOT/);
  });

  test('the travel is started from a reaction, not from a render', () => {
    expect(SRC).toMatch(/useAnimatedReaction\(/);
    // The guard that makes a re-render harmless: a travel only begins when
    // the slot being aimed at actually changed.
    expect(SRC).toMatch(/if \(cur\.aim !== prev\.aim\)/);
  });

  test('a dragged chip is still written raw — the position itself is never animated', () => {
    // The drag branch, up to its return.
    const at = SRC.indexOf('if (cur.dragging) {');
    expect(at).toBeGreaterThan(-1);
    const branch = SRC.slice(at, SRC.indexOf('return;', at));
    expect(branch).toMatch(/x\.value = px;/);
    // `x` is assigned, never timed, under a thumb.
    expect(branch).not.toMatch(/x\.value = with(Timing|Spring|Decay)/);
  });

  test('the frame a thumb TAKES the chip, the gap is carried — not jumped', () => {
    // A chip still crossing the dock when the pan activates (a tap whose thumb
    // rolled, most common on a long reach) used to teleport to the finger.
    // The gap becomes an offset that runs down to zero; the style adds it.
    expect(SRC).toMatch(/if \(prev && !prev\.dragging\) \{\s*catchUp\.value = x\.value - px;\s*catchUp\.value = withTiming\(0, CATCH\);/);
    expect(styleBody()).toMatch(/translateX: x\.value \+ catchUp\.value/);
  });

  test('every travel names its two ends — and a drag names none', () => {
    // The icons light only at the ends of a travel (TabBarIcon). "From" is
    // where the LAST travel was going, so a chip re-aimed in flight fades
    // out the icon it was approaching instead of snapping a neighbour on.
    expect(SRC).toMatch(/endFrom\.value = endTo\.value >= 0 \? endTo\.value : Math\.round\(prev\.aim\);\s*endTo\.value = cur\.aim;/);
    expect(SRC).toMatch(/if \(cur\.dragging\) \{\s*endTo\.value = -2;/);
  });

  test('the underline\'s spot is a glow on dark docks only, and belongs to the line', () => {
    expect(SRC).toMatch(/underline && skin\.blurTint === 'dark'\s*\? \[styles\.spot, \{ shadowColor: theme\.colors\.accent \}\]/);
    // Thrown upward, onto the glyph.
    expect(SRC).toMatch(/spot: \{[^}]*shadowOffset: \{ width: 0, height: -\d+ \}/);
  });

  test('a layout change places the chip rather than sending it travelling', () => {
    // A rotation, or hiding the Vault tab in Settings, moves every slot. The
    // chip belongs somewhere new, but it did not MOVE there.
    expect(SRC).toMatch(/cur\.offset !== prev\.offset/);
  });
});

/**
 * THE HANDOVER, scanned — because both of its old shapes were bugs.
 *
 * When the navigator's index changes the chip is told where the navigator is
 * and that the lead pointing there has done its job. It has been wrong twice:
 *
 *   • spent BEFORE the index was mirrored, in an effect of its own — the aim
 *     fell through to the slot the chip had left: a travel backwards;
 *   • spent UNCONDITIONALLY, with the index its own render saw — so a commit
 *     that landed late (a tab whose screen was waking up) wiped the aim of the
 *     NEXT touch and sent the chip back to the tab being left. That is the
 *     chip "sometimes not moving to the tab I pressed".
 *
 * dockNav.test.js walks the sequences and proves the rule. This pins the
 * wiring that cannot be proved from the rule alone.
 */
describe('the lead is spent by the answer to its own request', () => {
  const NAV = fs.readFileSync(path.join(__dirname, '..', 'dockNav.js'), 'utf8');

  test('the pill never clears the lead itself — not from an effect, not from the driver', () => {
    expect(SRC).not.toMatch(/lead\.value\s*=/);
  });

  test('the commit reads the navigator\'s STORE, not the index its render saw', () => {
    const at = SRC.indexOf('const live = currentTabIndex(navigation, null);');
    expect(at).toBeGreaterThan(-1);
    const effect = SRC.slice(SRC.lastIndexOf('useEffect(', at), SRC.indexOf('}, [', at));
    expect(effect).toMatch(/const now = live >= 0 \? live : index;/);
    expect(effect).toMatch(/settle\(now, now\);/);
  });

  test('settle is one UI-thread job: the index first, then what is left of the lead', () => {
    const at = NAV.indexOf('export function useDockSettle(');
    expect(at).toBeGreaterThan(-1);
    const body = NAV.slice(at);
    expect(body).toMatch(/runOnUI\(\(\) => \{/);
    const navAt = body.indexOf('navSlot.value = current');
    const leadAt = body.indexOf('lead.value = leadAfterSettle(lead.value, requested, current)');
    expect(navAt).toBeGreaterThan(-1);
    expect(leadAt).toBeGreaterThan(navAt);
  });

  test('an index that is not known yet is a placement, not a travel', () => {
    // App.js starts the chip's copy of the index at -1; the first real value
    // must not send the chip sliding in from off the bar.
    expect(SRC).toMatch(/cur\.offset !== prev\.offset \|\| prev\.aim < 0/);
  });

  test('no timer decides anything about the chip', () => {
    const DOCK = fs.readFileSync(path.join(__dirname, '..', 'DockTabBar.jsx'), 'utf8');
    // dockNav has exactly one, and it only DELAYS a request until the chip
    // has landed (requestTabWhenClear) — the request it then makes is the
    // same one, to the same tab, answered the same way.
    expect(NAV.match(/setTimeout\(/g)).toHaveLength(1);
    expect(NAV).toMatch(/setTimeout\(\(\) => \{\s*try \{\s*requestTab\(navigation, i, settle, fallbackState\);/);
    expect(NAV).not.toMatch(/setInterval/);
    expect(SRC).not.toMatch(/setTimeout|setInterval/);
    // The dock keeps exactly one: the interaction hold's release, which
    // defers a screen's mount and has nothing to do with where the chip goes.
    expect(DOCK.match(/setTimeout\(/g)).toHaveLength(1);
    expect(DOCK).toMatch(/releaseTimerRef\.current = setTimeout\(/);
  });
});
