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
    // FLUSH, not hung below. The ellipse is centred on the bottom of its own
    // box (cy/ry 1), so that edge is the BRIGHT end — hanging the box below
    // the cell by half its height put the bright end outside the clip and
    // left only the faint tail, which is why the glows did not show at all.
    expect(glow).toMatch(/\n {6}bottom: 0,/);
    expect(glow).not.toMatch(/bottom: -/);
  });

  test('the band’s two ENDS are darker, and only the ends', () => {
    // Mark, 2026-11-16: "a subtle darker gradient on the top and bottom of
    // the profile backdrop colour." Four stops, the middle two transparent,
    // so the band keeps its own colour everywhere the ink actually is.
    expect(SRC).toMatch(/colors=\{\[EDGE_SHADE, 'transparent', 'transparent', EDGE_SHADE\]\}/);
    expect(SRC).toMatch(/locations=\{\[0, 0\.22, 0\.78, 1\]\}/);
    const shade = /const EDGE_SHADE = 'rgba\(0,0,0,([\d.]+)\)'/.exec(SRC);
    expect(shade).toBeTruthy();
    // Subtle: a shade you can see is a second colour, and one heavy enough
    // to matter would drag the ink's contrast down with it.
    expect(Number(shade[1])).toBeLessThanOrEqual(0.25);
    expect(Number(shade[1])).toBeGreaterThan(0.05);
  });

  test('EVERYTHING ON THE BAND IS LEGIBLE — no page colours left on it', () => {
    // The handle chip shipped as a PALE chip (surfaceElevated, a page
    // colour) carrying the band's white text: white on near-white, which is
    // the thing Mark could not read. A chip on the band is a wash of the
    // band's own ink.
    expect(SRC).toMatch(/backgroundColor: nav \? nav\.chip : c\.surfaceElevated/);
    expect(SRC).toMatch(/handleText: \{[^}]*color: inkSub/);
    // …and no glyph inside the block is still reaching for the page's.
    const card = SRC.slice(SRC.indexOf('testID="profile-identity"'), SRC.indexOf('{/* The rule that says where the header stops'));
    // …with ONE exception, stated rather than quietly skipped: the big
    // animal glyph sits inside the avatar circle, which keeps its own pale
    // fill, so the page's ink is the right ink there.
    const strays = card.match(/color=\{c\.text(Muted|Secondary|Tertiary|Primary)\}/g) || [];
    expect(strays).toHaveLength(1);
    expect(card).toMatch(/size=\{46\} color=\{c\.textTertiary\}/);
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
