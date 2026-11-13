/**
 * THE NAVIGATOR SITS ON SOMETHING OPAQUE — scanned, because the thing it
 * prevents is invisible in every other kind of test.
 *
 * A tab turn cross-fades the two pages, and for the middle of it neither is
 * opaque (dockMotion's own suite pins the arithmetic: ~0.82 covered at the
 * worst frame). Each scene's background is INSIDE the view being faded, so it
 * goes translucent with it — which means what you actually see mid-turn is
 * whatever sits under the navigator. Left to the native root, that is white,
 * and every tab change in dark mode flashed pale.
 *
 * Giving react-navigation a dark theme does NOT fix it — that colour is on the
 * layer that is fading. The fix is one opaque view behind the navigator, and
 * the failure mode if someone removes it is a flicker nobody will connect to
 * the refactor that caused it. So it is pinned here, in the source.
 */
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..', '..', 'App.js');
const SRC = fs.readFileSync(APP, 'utf8');

describe('the app backdrop', () => {
  test('exists, and fills', () => {
    expect(SRC).toMatch(/appBackdrop:\s*\{[^}]*flex:\s*1/);
  });

  test('is OPAQUE, and takes its colour from the app theme', () => {
    // Not from the navigation library's theme: that one is on the fading
    // layer, which is the whole mistake this guards against.
    expect(SRC).toMatch(/styles\.appBackdrop[^\]]*backgroundColor:\s*theme\.colors\.background/);
  });

  test('wraps the navigator, rather than sitting beside it', () => {
    const open = SRC.indexOf('styles.appBackdrop');
    const nav = SRC.indexOf('<NavigationContainer');
    const close = SRC.indexOf('</NavigationContainer>');
    expect(open).toBeGreaterThan(-1);
    expect(nav).toBeGreaterThan(open);
    // …and closes after it, so the navigator is a child rather than a sibling.
    expect(SRC.indexOf('</View>', close)).toBeGreaterThan(close);
  });
});
