const fs = require('fs');
const path = require('path');

/**
 * THE IDENTITY BLOCK WEARS THE NAV BAR.
 *
 * Mark, 2026-11-16, over four passes: the nav bar's backdrop; the glows
 * under each figure; then "remove the glow but make it grainy metal
 * anodized look like the silver but it takes the colour gain of the colour
 * chosen"; then "remove the dark gradient and add grain to the backdrop".
 * What is left is a coloured band with a metal tooth on it, and nothing else.
 *
 * `navSurface.test` proves the colour maths and `Grain.test` proves the
 * texture's. ProfileScreen's index is far too heavy to mount, so what is
 * pinned here is the WIRING — and every line of it is a thing that fails
 * silently rather than loudly: ink that stops flipping with its surface is
 * invisible rather than wrong-looking (§1), and a grain that stops being
 * drawn leaves a flat band that looks deliberate.
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

  test('IT IS ANODIZED METAL — grain on the band, and nothing else on it', () => {
    // The same tooth the Focus and Inbox panels wear, driven by the same
    // slider: grey noise modulating around the band's own colour, which is
    // what anodized aluminium is. The colour comes from the surface, where
    // it already was.
    expect(SRC).toContain('{navSkin && <Grain level={grain * METAL_GRAIN} />}');
    // NOT tinted. The art's noise lives in its RGB, so a tintColor replaces
    // the texture with one flat colour — that shipped for a release and
    // left the band slightly paler with no grain on it (Grain's own note
    // and test hold the other half of this).
    // Scoped to the Grain tag: `tint` is a perfectly good prop elsewhere on
    // this screen (the stats charts take one), and a blanket ban would fail
    // for a reason that has nothing to do with this.
    expect(SRC).not.toMatch(/<Grain[^/]*tint=/);
    // One slider for every textured surface in the app, not a second one.
    expect(SRC).toMatch(/\n {4}grain,\n {2}\} = useTheme\(\);/);
    // …and the glow before it is gone with all of its machinery.
    expect(SRC).not.toMatch(/DockGlow|statGlow|navGlow|SPOT_/);
  });

  test('…and HEAVIER than a page’s dusting, or a dark band shows none', () => {
    // The grain modulates AROUND the surface, and a dark band has far less
    // room above it than a cream page: the layer that reads as texture on
    // the Focus panels is invisible on this one.
    const metal = /const METAL_GRAIN = ([\d.]+);/.exec(SRC);
    expect(metal).toBeTruthy();
    expect(Number(metal[1])).toBeGreaterThan(1);
    // A multiplier on the person's own setting, so Off is still off here.
    expect(SRC).toContain('grain * METAL_GRAIN');
  });

  test('THE DARK GRADIENT IS GONE, with the constant that drove it', () => {
    // Mark, 2026-11-16: "remove the dark gradient". The band is one colour
    // with a tooth on it now.
    expect(SRC).not.toMatch(/EDGE_SHADE|profile-identity-shade/);
    expect(SRC).not.toMatch(/LinearGradient/);
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
