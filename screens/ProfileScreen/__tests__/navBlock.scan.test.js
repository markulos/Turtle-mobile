const fs = require('fs');
const path = require('path');

/**
 * THE IDENTITY BLOCK WEARS THE NAV BAR.
 *
 * Mark, 2026-11-16: "let it have a slightly darker backdrop, matching the
 * backdrop of the NAV bar, and the glow effect on each of the various sub
 * panels within it and horizontally aligned with each glow being independent
 * from the other, but same style as the NAV glow."
 *
 * `navSurface.test` proves the colour maths. ProfileScreen's index is far too
 * heavy to mount, so what is pinned here is the WIRING — and every line of it
 * is a thing that fails silently rather than loudly: ink that stops flipping
 * with its surface is invisible, not wrong-looking (§1), and a glow that
 * stops being clipped spills onto the list below where nobody is looking for
 * a bug.
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
    // The block's own text reaches for it rather than for the page's.
    for (const style of ['name', 'statNum']) {
      expect(SRC).toMatch(new RegExp(`${style}: \\{[^}]*color: ink`));
    }
  });

  test('…including THE ACCENT, measured against the band and not the page', () => {
    // `c.accentInk` is the accent conditioned for the light page (§10). On a
    // dark band it is a deep olive nobody can read.
    expect(SRC).toMatch(/const accentInk = nav \? readableOn\(c\.accent, nav\.fill, 4\.5\) : c\.accentInk;/);
    const block = SRC.slice(SRC.indexOf('const makeStyles'));
    expect(block).not.toMatch(/color: c\.accentInk/);
  });

  test('EACH STAT CELL HAS ITS OWN GLOW — four, not one shared', () => {
    // The dock has one because only one tab is active. These are four
    // things rather than a choice between them, so each gets its own and
    // the id is keyed per cell — one id would make four <Defs> collide.
    expect(SRC).toMatch(/id=\{`profile-stat-glow-\$\{s\.key\}`\}/);
    // The dock's own glow component and the dock's own numbers.
    expect(SRC).toMatch(/import DockGlow from '\.\.\/\.\.\/components\/DockGlow'/);
    expect(SRC).toMatch(/width=\{SPOT_W\}/);
    expect(SRC).toMatch(/height=\{SPOT_H\}/);
    expect(SRC).toMatch(/peak=\{SPOT_PEAK \* statGlow\.strength\}/);
    // cy/ry 1 — an ellipse centred ON the lower edge shows only its upper
    // half, which is light rising from a line. Same as the dock's spot.
    expect(SRC).toMatch(/cy=\{1\}/);
    expect(SRC).toMatch(/ry=\{1\}/);
  });

  test('…HORIZONTALLY ALIGNED: centred on each cell’s bottom edge', () => {
    // Laid out in flow it would sit under whatever text happened to be
    // above it and the four would stagger. Absolutely placed, they share a
    // horizon however wide the cells are.
    const glow = SRC.slice(SRC.indexOf('    statGlow: {'), SRC.indexOf('    statDivider:'));
    expect(glow).toMatch(/position: 'absolute'/);
    expect(glow).toMatch(/left: '50%'/);
    expect(glow).toMatch(/marginLeft: -SPOT_W \/ 2/);
    expect(glow).toMatch(/bottom: -SPOT_H \/ 2/);
  });

  test('…and CLIPPED, or half the pool lands on the list below', () => {
    const cell = SRC.slice(SRC.indexOf('    stat: {'), SRC.indexOf('    statNum:'));
    expect(cell).toMatch(/overflow: 'hidden'/);
  });

  test('OFF IS OFF — the dock’s own glow setting, not a second one', () => {
    // Turning the glow off in Settings has to turn off every glow in the
    // app, or the setting is a lie about what it controls.
    expect(SRC).toMatch(/\{statGlow\.strength > 0 && \(/);
    expect(SRC).toMatch(/navGlow\(\{ dockGlow, dockGlowColor, accent: theme\.colors\.accent \}\)/);
  });
});
