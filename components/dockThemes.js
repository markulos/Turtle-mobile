/**
 * DOCK THEMES — the named ones.
 *
 * A PALETTE is three colours someone paired well (dockPalettes). A THEME is a
 * character, and the difference is not decoration: a palette can only say
 * backdrop / highlight / ink, because those are the three things the settings
 * store. A theme may override ANY field of the skin — the rim, the grooves
 * between the icons, the colour of the tabs you are not on — so it can do
 * things the generic controls have no slot for.
 *
 * That is the whole reason this is a separate module rather than a sixth
 * palette. Godzilla's unselected glyphs are scale-green and its rim is cold
 * atomic light; there is no "inactive glyph colour" setting and there should
 * not be one, because the only sane value for it is derived from the backdrop
 * (see customDockSkin). A theme is allowed to break that rule ON PURPOSE, as a
 * whole composed look, and takes responsibility for staying legible — which is
 * what its tests check.
 *
 * ── Why a theme has to be REMEMBERED when palettes do not ──────────────────
 *
 * A palette writes four ordinary settings and stops existing; "which palette
 * am I wearing" is recomputed by comparing them. A theme's overrides are not
 * any setting, so they cannot be recovered that way — the chosen theme's KEY
 * is stored, and the dock asks for it first (resolveDockSkin). Touching any
 * other control in the picker clears it, because a theme you have since edited
 * is not that theme any more.
 */

import { customDockSkin } from './dockSkins';
import { normalizeHex } from '../utils/accentColor';

export const DOCK_THEMES = [
  {
    key: 'godzilla',
    name: 'Godzilla',
    tagline: 'Ash over the city, scales in the dark, and the dorsal glow.',

    // THE GROUND is not black — it is ash: a charcoal with the green pushed
    // very slightly up, so the bar reads as something with a colour in it
    // rather than as the absence of one. Everything else is tuned against
    // this.
    backdrop: '#101614',

    // THE CHIP is the atomic breath — the cold blue-white the dorsal plates
    // throw before it fires. It is the one bright thing on the bar, which is
    // exactly the job the chip already has.
    accent: '#4FD8F5',

    // Near-black on that cyan, like the dark core inside a lit plate. Stored
    // rather than left on auto for the same reason a palette's is: a composed
    // look must not move when the contrast derivation is retuned.
    ink: 'dark',

    // …and the part a palette could not say. SCALES: the tabs you are not on
    // are a muted hide-green, and the grooves between them the same colour,
    // dimmer. The rim is cold rather than white — the same light as the chip,
    // at the strength of a reflection rather than a source.
    skin: {
      edge: 'rgba(79,216,245,0.22)',
      ridge: 'rgba(124,179,134,0.20)',
      inactiveTint: 'rgba(168,208,176,0.62)',
    },
  },
];

/** A theme by key, or null. Anything unrecognised is "no theme". */
export const dockTheme = (key) =>
  DOCK_THEMES.find((t) => t.key === key) || null;

/**
 * The skin a theme paints: the derived custom skin for its backdrop, with its
 * own overrides on top.
 *
 * Built FROM customDockSkin rather than written out field by field, so a theme
 * only has to state what it changes — and so a new field added to a skin
 * arrives in every theme with a sane derived value instead of as undefined.
 */
export function themeSkin(theme) {
  const base = customDockSkin(theme.backdrop);
  return { ...base, ...(theme.skin || {}), key: 'custom', themeKey: theme.key };
}

/**
 * WHAT THE DOCK IS WEARING — the one answer, for the dock and for App.js.
 *
 * A theme wins when one is set: its overrides are not recoverable from the
 * ordinary settings, so the stored key is the only thing that knows. Anything
 * else falls through to the normal skin resolution.
 */
export function resolveDockSkin({ dockTheme: key, dockStyle, dockColor }, dockSkinFn) {
  const theme = dockTheme(key);
  if (theme) return themeSkin(theme);
  return dockSkinFn(dockStyle, dockColor);
}

/** Whether a stored theme key is one we still ship. */
export const isDockTheme = (key) => !!dockTheme(key);

/**
 * True when every ordinary setting still agrees with the theme — i.e. the
 * colours have not been edited out from under it. The key alone is what the
 * dock reads; this is what the PICKER uses to decide whether to tick the tile.
 */
export function themeIsIntact(theme, { dockStyle, dockColor, accentColor, dockInk }) {
  if (!theme) return false;
  return dockStyle === 'custom'
    && normalizeHex(dockColor) === theme.backdrop
    && normalizeHex(accentColor) === theme.accent
    && dockInk === theme.ink;
}

export default DOCK_THEMES;
