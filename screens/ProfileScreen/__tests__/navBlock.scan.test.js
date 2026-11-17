const fs = require('fs');
const path = require('path');

/**
 * THE IDENTITY BLOCK WEARS THE NAV BAR.
 *
 * Mark, 2026-11-16, over three passes: the nav bar's backdrop, a subtle
 * darker gradient at its two ends, everything on it legible, and — in place
 * of the glows that were there first — "grainy metal anodized look like the
 * silver but it takes the colour gain of the colour chosen".
 *
 * `navSurface.test` proves the colour maths. ProfileScreen's index is far too
 * heavy to mount, so what is pinned here is the WIRING — and every line of it
 * is a thing that fails silently rather than loudly: ink that stops flipping
 * with its surface is invisible rather than wrong-looking (§1), and a texture
 * that stops being tinted is silver on a green band, which reads as a dusty
 * screen rather than as a bug.
 */

const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'index.jsx'), 'utf8');

describe('the profile identity block', () => {
  test('takes the NAV BAR’s colour, resolved the same way the bar resolves it', () => {
    // Not a hex copied out of the dock: the bar's colour is three settings
    // deep and any of them can change while the app is open.
    expect(SRC).toMatch(/navBlockSurface\(\s*\{ dockTheme: dockThemeKey, dockStyle, dockColor \}/);
    expect(SRC).toMatch(/navSkin && \{ backgroundColor: navSkin\.fill \}/);
    // …and it is recomputed when any of those change, not once on mount.
    expect(SRC).toMatch(/\[dockThemeKey, dockStyle, dockColor, theme\.colors\.background\]/);
  });

  test('THE INK FLIPS WITH IT, in one place rather than at every call site', () => {
    // The block was drawn in the page's ink because it was ON the page. A
    // dark band under that ink is invisible — the mistake this app has
    // shipped twice. One derivation in the styles factory, so the next
    // colour change cannot leave one label behind.
    expect(SRC).toMatch(/const makeStyles = \(theme, nav\) =>/);
    expect(SRC).toMatch(/const ink = nav \? nav\.ink : c\.textPrimary;/);
    expect(SRC).toMatch(/const hair = nav \? nav\.edge : c\.border;/);
    expect(SRC).toMatch(/makeStyles\(theme, navSkin\)/);
    for (const style of ['name', 'statNum']) {
      expect(SRC).toMatch(new RegExp(`${style}: \\{[^}]*color: ink`));
    }
  });

  test('…including THE ACCENT, measured against the band and not the page', () => {
    // `c.accentInk` is the accent conditioned for the light page (§10). On a
    // dark band it is a deep olive nobody can read.
    expect(SRC).toMatch(/const accentInk = nav \? readableOn\(c\.accent, nav\.fill, 4\.5\) : c\.accentInk;/);
    expect(SRC.slice(SRC.indexOf('const makeStyles'))).not.toMatch(/color: c\.accentInk/);
  });

  test('IT IS ANODIZED METAL, not a glow', () => {
    // The glows went first (they were a pool of light under each figure).
    // This is the same tooth the Focus and Inbox panels wear, driven by the
    // same slider — but TINTED with a lighter step of the band's own colour
    // rather than left grey, which is the whole difference between brushed
    // aluminium and aluminium anodized in a colour.
    expect(SRC).toContain('{navSkin && <Grain level={grain} tint={navSkin.grain} />}');
    // One slider for every textured surface in the app, not a second one.
    expect(SRC).toMatch(/\n {4}grain,\n {2}\} = useTheme\(\);/);
    // …and the glow is gone with all of its machinery, not left dangling.
    expect(SRC).not.toMatch(/DockGlow|statGlow|navGlow|SPOT_/);
  });

  test('the tooth sits UNDER the shade, which is the light ON the metal', () => {
    // The darkened ends are light falling on the surface, so they fall on
    // its grain too. Grain first, gradient second.
    expect(SRC.indexOf('<Grain level={grain}'))
      .toBeLessThan(SRC.indexOf('profile-identity-shade'));
  });

  test('the band’s two ENDS are darker, and only the ends', () => {
    // "A subtle darker gradient on the top and bottom." Four stops, the
    // middle two transparent, so the band keeps its own colour everywhere
    // the ink actually is.
    expect(SRC).toMatch(/colors=\{\[EDGE_SHADE, 'transparent', 'transparent', EDGE_SHADE\]\}/);
    expect(SRC).toMatch(/locations=\{\[0, 0\.22, 0\.78, 1\]\}/);
    const shade = /const EDGE_SHADE = 'rgba\(0,0,0,([\d.]+)\)'/.exec(SRC);
    expect(shade).toBeTruthy();
    // Subtle: a shade you can SEE is a second colour, and one heavy enough
    // to matter would drag the ink's contrast down with it.
    expect(Number(shade[1])).toBeLessThanOrEqual(0.25);
    expect(Number(shade[1])).toBeGreaterThan(0.05);
  });

  test('EVERYTHING ON THE BAND IS LEGIBLE — no page colours left on it', () => {
    // The handle chip shipped as a PALE chip (surfaceElevated, a page
    // colour) carrying the band's white text: white on near-white, which is
    // what could not be read. A chip on the band is a wash of the band's
    // own ink.
    expect(SRC).toMatch(/backgroundColor: nav \? nav\.chip : c\.surfaceElevated/);
    expect(SRC).toMatch(/handleText: \{[^}]*color: inkSub/);
    const card = SRC.slice(
      SRC.indexOf('testID="profile-identity"'),
      SRC.indexOf('{/* The rule that says where the header stops'),
    );
    // ONE exception, stated rather than quietly skipped: the big animal
    // glyph sits inside the avatar circle, which keeps its own pale fill,
    // so the page's ink is the right ink there.
    const strays = card.match(/color=\{c\.text(Muted|Secondary|Tertiary|Primary)\}/g) || [];
    expect(strays).toHaveLength(1);
    expect(card).toMatch(/size=\{46\} color=\{c\.textTertiary\}/);
  });
});
