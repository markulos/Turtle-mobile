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
});
