/**
 * navSurface — the nav bar's own material, for anything else that wants it.
 *
 * Mark, 2026-11-16, of the profile's identity block: "let it have a slightly
 * darker backdrop, matching the backdrop of the NAV bar, and the glow effect
 * on each of the various sub panels within it … same style as the NAV glow."
 *
 * "Matching" has to mean RESOLVED THE SAME WAY, not a hex copied out of the
 * dock today. The bar's colour is three settings deep — a composed theme
 * beats a style, a style beats a custom colour (resolveDockSkin) — and any
 * of them can change from Settings while the app is open. A second surface
 * that reaches for the same function tracks all of it; one that remembers a
 * colour is wrong the first time somebody picks a new dock.
 *
 * ── Why the ink comes with it ─────────────────────────────────────────────
 *
 * The identity block is drawn in the page's ink today, because it is ON the
 * page. Put a dark bar under it and that ink is invisible — STYLE-RULES §1,
 * and the mistake this app has shipped twice. So the surface hands back the
 * ink that belongs on it, derived the way the dock derives its glyphs'.
 */
import { inkOn, mixHex, normalizeHex } from '../utils/accentColor';
import { DEFAULT_DOCK_COLOR, dockSkin } from './dockSkins';
import { resolveDockSkin } from './dockThemes';
import { glowStrength, pickedGlowColor } from './dockLight';

/**
 * How much of the nav colour a BLOCK takes, against the dock's own.
 *
 * The dock floats over a scrolling page and is sheer so the page moves under
 * it. This is a band in the page with nothing behind it to show through, so
 * it takes the colour nearly neat — "slightly darker" than the page, which
 * is what was asked for, rather than a grey film.
 */
export const NAV_BLOCK_ALPHA = 0.92;

/**
 * The opaque colour behind a skin's wash.
 *
 * `skin.colour` only exists on the CUSTOM skin; every fixed style and every
 * composed theme describes itself as a gradient instead. The wash's first
 * stop is what the bar actually paints, so reading that is what makes this
 * match all three rather than only the one.
 */
export function washHex(skin) {
  const first = skin && skin.wash && skin.wash.colors && skin.wash.colors[0];
  if (typeof first !== 'string') return null;
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(first);
  if (!m) return normalizeHex(first);
  const hex = [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('');
  return `#${hex}`;
}

/**
 * The nav bar's material, for a surface that is not the nav bar.
 *
 * `settings` is the same three keys the dock reads from useTheme().
 * Returns the fill, the hairlines and the ink that belongs on it — or null
 * when there is no readable colour, which a caller should treat as "leave
 * the block as it was" rather than as a reason to paint something.
 */
export function navBlockSurface(settings = {}, page) {
  const colour = washHex(resolveDockSkin(settings, dockSkin))
    || normalizeHex(DEFAULT_DOCK_COLOR);
  if (!colour) return null;
  // Mixed over the PAGE, not left as an alpha: there is nothing behind a
  // band in a scroll view, so a translucent fill would composite against
  // whatever happened to be under it rather than against the page.
  const base = normalizeHex(page);
  const fill = base ? mixHex(base, colour, NAV_BLOCK_ALPHA) : colour;
  const light = inkOn(fill) === '#FFFFFF';
  return {
    fill,
    // The same logic the dock's own skin uses: a hairline has to go the
    // other way from its surface or it is not an edge.
    edge: light ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)',
    ridge: light ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)',
    ink: light ? '#FFFFFF' : '#1F2024',
    sub: light ? 'rgba(255,255,255,0.74)' : 'rgba(31,32,36,0.72)',
    muted: light ? 'rgba(255,255,255,0.56)' : 'rgba(31,32,36,0.56)',
  };
}

/**
 * The colour and strength of the nav's glow, for a glow somewhere else.
 *
 * Same two settings the dock reads, same meaning: a picked colour wins, and
 * with none the highlight colour is the light. Off is off everywhere, or the
 * setting is a lie about what it controls.
 */
export function navGlow({ dockGlow, dockGlowColor, accent } = {}) {
  return {
    strength: glowStrength(dockGlow),
    color: pickedGlowColor(dockGlowColor) || accent,
  };
}

export default { NAV_BLOCK_ALPHA, navBlockSurface, navGlow, washHex };
