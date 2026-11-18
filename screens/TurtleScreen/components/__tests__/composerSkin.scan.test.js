const fs = require('fs');
const path = require('path');

/**
 * THE COMPOSER WEARS THE NAV BAR, IN LIGHT MODE.
 *
 * Mark, 2026-11-18: "let the chat box orchestrator have the same backdrop
 * theme as the Nafar and let it be fine grain."
 *
 * It was a frosted near-white card floating a few points above a dark dock —
 * two materials stacked in the one place on the screen your eye is already
 * going. Now it is the dock's material with the dock's tooth on it.
 *
 * A scan, because TurtleScreen is far too heavy to mount, and because every
 * line below fails SILENTLY: a surface that stops tracking the dock setting
 * looks fine until somebody changes their dock, and ink left behind on a
 * dark band is invisible rather than wrong-looking (§1, and the mistake this
 * app has shipped twice — see components/navSurface's own note).
 */

const SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'index.jsx'), 'utf8');

describe('the composer’s backdrop', () => {
  test('is the NAV BAR’s, resolved the way the bar resolves it', () => {
    // Not a hex copied out of the dock: the bar's colour is three settings
    // deep and any of them can change while the app is open.
    expect(SRC).toMatch(/navBlockSurface\(\s*\{ dockTheme: dockThemeKey, dockStyle, dockColor \}/);
    expect(SRC).toMatch(/\[theme\.mode, dockThemeKey, dockStyle, dockColor, theme\.colors\.background\]/);
    expect(SRC).toMatch(/composerSkin && \{ backgroundColor: composerSkin\.fill, borderColor: composerSkin\.edge \}/);
  });

  test('LIGHT MODE ONLY — dark keeps its frost', () => {
    // What was asked for, and where the mismatch was. In dark mode the frost
    // is already the same family as the bar, and an opaque band would cost
    // the see-through that makes the chat read under the composer.
    expect(SRC).toMatch(/theme\.mode === 'dark' \? null : navBlockSurface\(/);
    // …and the blur is not paid for underneath an opaque fill.
    expect(SRC).toMatch(/\{!composerSkin && \(\s*<>\s*<BlurView/);
  });

  test('IT IS FINE GRAIN, driven by the one slider', () => {
    // "let it be fine grain" — the lighter dusting, not the metal weight the
    // profile's band wears: this card is small and close to the thumb, and
    // the coarse tooth reads as noise at that distance.
    expect(SRC).toContain('{composerSkin && <Grain fine level={grain} radius={28} />}');
    // Clipped to the card's own corner, or the tile squares them off.
    expect(SRC).toMatch(/radius=\{28\}/);
    expect(SRC).toMatch(/borderRadius: 28/);
    // One slider for every textured surface in the app, not a second one.
    expect(SRC).toMatch(/dockTheme: dockThemeKey, dockStyle, dockColor, grain,/);
  });
});

describe('…and the ink comes with it', () => {
  test('ONE derived theme, handed to the shared composer', () => {
    // Rather than a colour fixed at each call site — there is no call site
    // left to forget this way.
    expect(SRC).toMatch(/const composerTheme = useMemo\(\(\) => \(composerSkin \? \{/);
    expect(SRC).toMatch(/textPrimary: composerSkin\.ink/);
    expect(SRC).toMatch(/textMuted: composerSkin\.muted/);
    expect(SRC).toMatch(/<ChatComposer\s+bare\s+theme=\{composerTheme\}/);
  });

  test('…and to the session’s keys, which sit in its corner', () => {
    expect(SRC).toMatch(/ink=\{composerInk\}/);
  });

  test('NO PAGE COLOUR IS LEFT ON THE BAND', () => {
    // `actionCircle` is surfaceElevated — a near-white disc. On this backdrop
    // it is a row of bright coins with white glyphs inside them, which is the
    // exact shape of the bug navSurface records from the profile band.
    const composer = SRC.slice(SRC.indexOf('<ChatComposer'), SRC.indexOf('{/* /below-console'));
    expect(composer).not.toMatch(/color=\{theme\.colors\./);
    expect(composer.match(/styles\.actionCircle, composerChip/g) || []).toHaveLength(4);
    expect(SRC).toMatch(/backgroundColor: composerSkin\.chip, shadowOpacity: 0/);
    // The bot slot is a chip too.
    expect(SRC).toMatch(/styles\.botSlot, composerChip,/);
  });

  test('the accent is readable on it, which is NOT what accentInk means here', () => {
    // §10's accentInk is the accent conditioned for the cream page. On a dark
    // band that is a deep olive nobody can read — the raw accent is the right
    // answer there, which is the same answer the dock's own glyphs get.
    expect(SRC).toMatch(/accentInk: theme\.colors\.accent,/);
  });
});
