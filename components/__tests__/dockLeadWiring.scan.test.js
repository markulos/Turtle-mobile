import fs from 'fs';
import path from 'path';

/**
 * The dock's two shared values have to reach BOTH halves of the drag.
 *
 * `dragSlot` and `leadSlot` are owned by the navigator (App.js) because the
 * gesture and the chip are built in two different places — the drag is the
 * custom `tabBar`, the chip is painted through `tabBarBackground`. Each value
 * is written by one of them and read by the other, and each falls back to a
 * private value of its own so the components stay renderable on their own in a
 * test or a screenshot harness.
 *
 * That fallback is exactly why this scan exists: a value that is never passed
 * down does not crash, does not warn, and does not show up in any render test.
 * It just quietly never arrives, and the feature it carries is dead code that
 * looks wired. `leadSlot` shipped that way once already.
 */
const APP = fs.readFileSync(path.join(__dirname, '..', '..', 'App.js'), 'utf8');

describe('the dock’s shared values reach both halves', () => {
  test('App.js owns them', () => {
    expect(APP).toMatch(/const dragSlot = useSharedValue\(-1\)/);
    expect(APP).toMatch(/const leadSlot = useSharedValue\(-1\)/);
  });

  test('the drag gets both — it writes them', () => {
    const tag = APP.match(/<DockTabBar[^>]*\/>/);
    expect(tag).not.toBeNull();
    expect(tag[0]).toContain('dragSlot={dragSlot}');
    expect(tag[0]).toContain('leadSlot={leadSlot}');
  });

  test('the chip gets both — it reads them', () => {
    const tag = APP.match(/<TabBarPill[^>]*\/>/);
    expect(tag).not.toBeNull();
    expect(tag[0]).toContain('dragSlot={dragSlot}');
    expect(tag[0]).toContain('leadSlot={leadSlot}');
  });

  test('a TAP writes the lead too, from tabPress', () => {
    // The drag writes the lead from its own worklet; a tap has no gesture to
    // write it, so without this listener the chip waits for the navigate to
    // come back through React — which is the lateness this whole value exists
    // to remove, present on the commonest way to change tabs. Scanned for the
    // same reason as the props above: it fails silently and invisibly.
    expect(APP).toMatch(/screenListeners=/);
    expect(APP).toMatch(/tabPress:/);
    expect(APP).toMatch(/leadSlot\.value = i/);
  });

  test('the probe reaches both halves, or it measures nothing', () => {
    // The probe's two numbers come from two different components: the TOUCH is
    // stamped by the dock's gesture, the TRAVEL by the chip's reaction. Miss
    // either prop and there is no crash and no warning — the readout in
    // Settings just never fills in, or fills in with a start time measured
    // from a touch nobody recorded. Same silent failure as `leadSlot`'s, which
    // is why it is scanned rather than trusted.
    expect(APP).toMatch(/const dockProbe = useDockMotionProbe\(/);
    expect(APP.match(/<DockTabBar[^>]*\/>/)[0]).toContain('probe={dockProbe}');
    expect(APP.match(/<TabBarPill[^>]*\/>/)[0]).toContain('probe={dockProbe}');
    // The press swell has to be hoisted for the probe to see it, and
    // DockTabBar falls back to a private value if it is not handed one — so a
    // missing prop here costs the "was the glass still scaling?" answer
    // without costing anything visible.
    expect(APP).toMatch(/const dockPressLift = useSharedValue\(0\)/);
    expect(APP.match(/<DockTabBar[^>]*\/>/)[0]).toContain('pressLift={dockPressLift}');
  });

  test('the dock is told when react-navigation answered a touch', () => {
    // The dock completes a tab change itself when a touch produced none — the
    // strip below the capsule has no button under it, and the drag recogniser
    // can eat a press. `handled` is what stops it doing that when the button
    // DID answer. Miss this prop and the dock falls back to its own private
    // value, which nothing ever stamps: every tap then gets a second,
    // duplicate navigate 150ms after the real one, and every LONG-press
    // changes tabs underneath the console it was opening. No crash, no
    // warning — the same silent failure as `leadSlot`'s, which is why it is
    // scanned.
    expect(APP).toMatch(/const tabHandledAt = useSharedValue\(0\)/);
    expect(APP).toMatch(/tabLongPress: \(\) => \{ tabHandledAt\.value = Date\.now\(\); \}/);
    expect(APP).toMatch(/tabPress: \(\) => \{[\s\S]{0,400}?tabHandledAt\.value = Date\.now\(\)/);
    expect(APP.match(/<DockTabBar[^>]*\/>/)[0]).toContain('handled={tabHandledAt}');
  });

  test('the move carries its own duration, and both halves get it', () => {
    // How long the chip takes depends on how far it is going, so the number
    // travels with the move rather than living in the component. Same failure
    // mode as the two above if it is not passed down: the chip silently falls
    // back to its own value and every move takes the base duration.
    expect(APP).toMatch(/const slideMs = useSharedValue\(/);
    expect(APP).toMatch(/slideMs\.value = chipSlideMs\(/);
    expect(APP.match(/<DockTabBar[^>]*\/>/)[0]).toContain('slideMs={slideMs}');
    expect(APP.match(/<TabBarPill[^>]*\/>/)[0]).toContain('slideMs={slideMs}');
  });
});
