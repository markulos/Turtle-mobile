import { NAV_BLOCK_ALPHA, navBlockSurface, navGlow } from '../navSurface';
import { DEFAULT_DOCK_COLOR } from '../dockSkins';
import { contrastRatio, mixHex } from '../../utils/accentColor';

/**
 * The nav bar's material, borrowed by something that is not the nav bar.
 *
 * Mark asked the profile's identity block to match the dock (2026-11-16).
 * "Match" has to mean RESOLVED THE SAME WAY — the bar's colour is three
 * settings deep and any of them can change while the app is open, so a
 * second surface that remembers a hex is wrong the first time he picks a
 * new dock.
 */

const PAGE = '#F5F3F0';

/** An rgba() ink laid on an opaque surface, as an opaque hex. */
const over = (ink, surface) => {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)/.exec(ink);
  if (!m) return ink;
  const hex = [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('');
  return mixHex(surface, `#${hex}`, Number(m[4]));
};

describe('navBlockSurface', () => {
  test('it FOLLOWS the dock settings, through all three of them', () => {
    // A composed theme beats a style, a style beats a custom colour. The
    // block has to land on whichever one the dock landed on.
    const custom = navBlockSurface({ dockStyle: 'custom', dockColor: '#2B4A3A' }, PAGE);
    const other = navBlockSurface({ dockStyle: 'custom', dockColor: '#7A2B2B' }, PAGE);
    expect(custom.fill).not.toBe(other.fill);
    // …and a composed theme overrides the style under it, as it does on the bar.
    const themed = navBlockSurface({ dockTheme: 'godzilla', dockStyle: 'paper' }, PAGE);
    const styled = navBlockSurface({ dockStyle: 'paper' }, PAGE);
    expect(themed.fill).not.toBe(styled.fill);
  });

  test('with nothing set it is the dock’s own default, not a guess', () => {
    const s = navBlockSurface({}, PAGE);
    expect(s).toBeTruthy();
    expect(contrastRatio(s.fill, DEFAULT_DOCK_COLOR)).toBeLessThan(2);
  });

  test('THE INK COMES WITH THE SURFACE, and clears it', () => {
    // The block is drawn in the page's ink today because it is ON the page.
    // A dark bar under that ink is invisible — §1, and a mistake this app
    // has shipped twice.
    for (const colour of ['#2B4A3A', '#101614', '#EFEFEF', '#9A9A9A']) {
      const s = navBlockSurface({ dockStyle: 'custom', dockColor: colour }, PAGE);
      expect(contrastRatio(s.ink, s.fill)).toBeGreaterThanOrEqual(4.5);
      // The quieter one still has to be readable, if less loudly — and it is
      // TRANSLUCENT, so it has to be composited onto the fill before it can
      // be measured at all (contrastRatio cannot read an rgba string, and
      // returns null rather than throwing).
      expect(contrastRatio(over(s.sub, s.fill), s.fill)).toBeGreaterThanOrEqual(3);
    }
  });

  test('…and the hairlines go the other way from the surface', () => {
    const dark = navBlockSurface({ dockStyle: 'custom', dockColor: '#101614' }, PAGE);
    const pale = navBlockSurface({ dockStyle: 'custom', dockColor: '#EFEFEF' }, PAGE);
    expect(dark.edge).toMatch(/^rgba\(255,255,255/);
    expect(pale.edge).toMatch(/^rgba\(0,0,0/);
  });

  test('the fill is mixed over the PAGE, because nothing is behind a band', () => {
    // The dock is sheer so the page moves under it. This is a band IN the
    // page: an alpha here would composite against black and come out a
    // colour nobody chose.
    const s = navBlockSurface({ dockStyle: 'custom', dockColor: '#2B4A3A' }, PAGE);
    expect(s.fill).toMatch(/^#[0-9a-f]{6}$/i);
    // Nearly the dock's colour — "slightly darker than the page", not a film.
    expect(NAV_BLOCK_ALPHA).toBeGreaterThan(0.8);
    expect(contrastRatio(s.fill, '#2B4A3A')).toBeLessThan(1.3);
  });

  test('no page to mix over is the colour itself, not a crash', () => {
    // Normalized, so the case is the library's and not the caller's.
    expect(navBlockSurface({ dockStyle: 'custom', dockColor: '#2B4A3A' }).fill.toLowerCase())
      .toBe('#2b4a3a');
  });
});

describe('navGlow', () => {
  test('a picked colour wins; with none, the light is the highlight colour', () => {
    expect(navGlow({ dockGlowColor: '#FF0000', accent: '#00FF00' }).color).toBe('#FF0000');
    expect(navGlow({ accent: '#00FF00' }).color).toBe('#00FF00');
  });

  test('OFF IS OFF — the dock’s own setting, not a second one', () => {
    // Turning the glow off in Settings has to turn off every glow in the
    // app, or the setting is a lie about what it controls.
    expect(navGlow({ dockGlow: 0 }).strength).toBe(0);
    expect(navGlow({ dockGlow: 1 }).strength).toBe(1);
  });
});
