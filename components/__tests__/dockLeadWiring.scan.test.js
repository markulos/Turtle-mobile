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

  test('the navigator\'s index has ONE mirror, and both halves get it', () => {
    // The dock writes it the moment it asks for a tab; the pill reads it (and
    // writes it again on commit). Two private copies would be the dock
    // answering a chip that is not listening.
    expect(APP).toMatch(/const navSlot = useSharedValue\(-1\)/);
    expect(APP.match(/<DockTabBar[^>]*\/>/)[0]).toContain('navSlot={navSlot}');
    expect(APP.match(/<TabBarPill[^>]*\/>/)[0]).toContain('navSlot={navSlot}');
  });

  test('the icons are told where the chip is — the pill writes it, every icon reads it', () => {
    // Without it each icon silently falls back to `focused`, which is the
    // step change after the commit that this exists to replace.
    expect(APP).toMatch(/const chipPos = useSharedValue\(-1\)/);
    expect(APP.match(/<TabBarPill[^>]*\/>/)[0]).toContain('chipPos={chipPos}');
    const icon = APP.match(/<TabBarIcon\s[\s\S]*?\/>/);
    expect(icon).not.toBeNull();
    expect(icon[0]).toContain('chipPos={chipPos}');
    expect(icon[0]).toContain('slot={slot}');
    // …and which two icons are the ends of the travel, or every icon the
    // chip passes over lights in turn.
    for (const end of ['chipFrom={chipFrom}', 'chipTo={chipTo}']) {
      expect(icon[0]).toContain(end);
      expect(APP.match(/<TabBarPill[^>]*\/>/)[0]).toContain(end);
    }
    // Both inks, or there is nothing to cross-fade between.
    expect(icon[0]).toMatch(/active=\{draw\(\{ focused: true/);
    expect(icon[0]).toMatch(/inactive=\{draw\(\{ focused: false/);
  });

  test('the button\'s press goes through the same door as the dock\'s', () => {
    expect(APP).toMatch(/const settleDock = useDockSettle\(leadSlot, navSlot\)/);
    expect(APP.match(/<DockTabBar[^>]*\/>/)[0]).toContain('settle={settleDock}');
    const press = APP.match(/tabPress: \(e\) => \{[\s\S]*?\n {8}\},/);
    expect(press).not.toBeNull();
    // Its default would re-dispatch from a render's stale `focused`.
    expect(press[0]).toMatch(/e\.preventDefault\(\)/);
    expect(press[0]).toMatch(/requestTabWhenClear\(navigation, i, settleDock, st\)/);
    // …and it no longer aims the chip or times it: the dock's touch-down does
    // the first, and the chip works out the second from the move itself.
    expect(press[0]).not.toMatch(/leadSlot\.value|slideMs\.value/);
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
    // …and the CHIP needs it too, because the chip's component is the one
    // that paints the press now: the wash it fades is TabBarPill's layer.
    // Miss this prop and the pill falls back to a private value nothing ever
    // writes — the dock simply never responds to a touch, with no error.
    expect(APP.match(/<TabBarPill[\s\S]*?\/>/)[0]).toContain('pressLift={dockPressLift}');
  });

  test('a long press stands the dock down ONLY where it means something', () => {
    // A long press on Turtle opens the console; the finger coming off the
    // glass afterwards is not a tap. Everywhere else a long rest IS a tap —
    // RN drops the press after 500ms and the dock completes it — so the flag
    // must not be raised for every tab.
    expect(APP).toMatch(/const suppressDockTap = useRef\(false\)/);
    expect(APP.match(/<DockTabBar[^>]*\/>/)[0]).toContain('suppressTap={suppressDockTap}');

    const screenListeners = APP.match(/screenListeners=\{[\s\S]*?\n {6}\}\)\}/);
    expect(screenListeners).not.toBeNull();
    expect(screenListeners[0]).not.toMatch(/tabLongPress\s*:/);

    const turtle = APP.match(/<Tab\.Screen\s+name="Turtle"[\s\S]*?\/>/);
    expect(turtle).not.toBeNull();
    expect(turtle[0]).toMatch(/tabLongPress[\s\S]{0,400}suppressDockTap\.current = true/);
    expect(turtle[0]).toMatch(/setConsoleOpen\(true\)/);
  });

  test('every tab stays attached — a long move must not re-attach the screens in between', () => {
    // With detaching on, v7 leaves every tab LEFT of the focused one attached
    // and detaches the ones to its right, so Tasks → Profile re-attaches five
    // screens' native views in one frame, under the chip's travel. See the
    // note on the navigator in App.js.
    const nav = APP.match(/<Tab\.Navigator[\s\S]*?screenOptions=/);
    expect(nav).not.toBeNull();
    expect(nav[0]).toMatch(/detachInactiveScreens=\{false\}/);
  });

  test('the move carries its own duration, and both halves get it', () => {
    // How long the chip takes depends on how far it is going, so the number
    // travels with the move rather than living in the component. Same failure
    // mode as the two above if it is not passed down: the chip silently falls
    // back to its own value and every move takes the base duration.
    expect(APP).toMatch(/const slideMs = useSharedValue\(/);
    expect(APP.match(/<DockTabBar[^>]*\/>/)[0]).toContain('slideMs={slideMs}');
    expect(APP.match(/<TabBarPill[^>]*\/>/)[0]).toContain('slideMs={slideMs}');
  });
});
