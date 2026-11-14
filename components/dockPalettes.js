/**
 * DOCK PALETTES — five whole looks, one tap each.
 *
 * The three rows above these (backdrop, indicator, ink) are the honest
 * controls, and they are also three decisions and a colour picker before
 * anything looks finished. A palette is the same answer arrived at by
 * someone who already did the pairing: a backdrop, the highlight that goes
 * ON it, and the ink for the glyph that sits on THAT.
 *
 * ── Why a palette sets the app's highlight too ─────────────────────────────
 *
 * Because that is the combination. The chip is the accent, so a "colour
 * combination" for the dock that left the accent alone would be a backdrop
 * and whatever you happened to have — which is the thing these exist to stop.
 * The accent is app-wide (links, active chips, affirmative actions), so
 * applying a palette is a change you see beyond the dock, and the row says so
 * rather than letting it be discovered.
 *
 * ── How they were chosen ───────────────────────────────────────────────────
 *
 * Each pair is a dark-or-light GROUND with one saturated colour against it,
 * spread across the hue circle so the five are telling each other apart at a
 * glance rather than being five blues. Three dark, two light, because the
 * dock is drawn over the page and a light bar is a different decision about
 * the whole screen, not just a lighter version of the same one.
 *
 * `ink` is stored explicitly rather than left on 'auto'. Auto would land on
 * the same answer for all five today — it is the same contrast check — but a
 * palette is a FINISHED look, and a finished look should not change because
 * the derivation behind it was retuned later.
 */

import { customDockSkin } from './dockSkins';
import { normalizeHex } from '../utils/accentColor';

export const DOCK_PALETTES = [
  {
    key: 'midnight',
    name: 'Midnight',
    // Near-black with a blue cast, and the blue to match. The quietest of the
    // five: it is the default dock's temperature with the accent doing the
    // talking.
    backdrop: '#0E1116',
    accent: '#4C8DFF',
    // WHITE, FIXED — the one look that is not on auto. Auto's contrast check
    // answers near-black for this blue, and the owner wants the glyph white
    // on the chip. It is safe to fix here, and only here, because the bar is
    // near-black as well: white is also what auto would give the underline.
    // A fixed ink is allowed when it suits the chip AND the bar (tested).
    ink: 'light',
  },
  {
    key: 'ember',
    name: 'Ember',
    // Warm black against orange — the one combination here with no blue in it
    // anywhere, which is what makes it read as warm rather than as "dark mode
    // with an orange".
    backdrop: '#1B1517',
    accent: '#F2793D',
    // Auto: the glyph sits on the chip in one mode and on the bar in the
    // other, and only auto reads whichever it is on. `legacyInk` is what
    // this look wrote before 2026-11-14 — kept only so a look applied
    // back then can be recognised and moved to auto (legacyInkFor).
    ink: 'auto',
    legacyInk: 'dark',
  },
  {
    key: 'lagoon',
    name: 'Lagoon',
    // Deep sea against mint. The backdrop is a desaturated version of the
    // accent's own hue, which is why this one reads as a single material with
    // a light on it rather than two colours sharing a bar.
    backdrop: '#07252B',
    accent: '#37C9B0',
    // Auto: the glyph sits on the chip in one mode and on the bar in the
    // other, and only auto reads whichever it is on. `legacyInk` is what
    // this look wrote before 2026-11-14 — kept only so a look applied
    // back then can be recognised and moved to auto (legacyInkFor).
    ink: 'auto',
    legacyInk: 'dark',
  },
  {
    key: 'linen',
    name: 'Linen',
    // Warm white and a deep wine: the editorial one. A light bar needs its
    // accent DARK, or the chip disappears into the backdrop instead of
    // standing on it.
    backdrop: '#F3EFE6',
    accent: '#7B2D5E',
    // Auto: the glyph sits on the chip in one mode and on the bar in the
    // other, and only auto reads whichever it is on. `legacyInk` is what
    // this look wrote before 2026-11-14 — kept only so a look applied
    // back then can be recognised and moved to auto (legacyInkFor).
    ink: 'auto',
    legacyInk: 'light',
  },
  {
    key: 'sand',
    name: 'Sand',
    // The other light one, warmer, with olive against it. Kept distinct from
    // Linen by HUE rather than by lightness — two pale bars whose accents
    // differ only in brightness are one option, not two. (This pair started
    // as rust, which is Ember's hue four degrees away; the five are supposed
    // to be telling each other apart at a glance.)
    backdrop: '#F0E6DA',
    accent: '#4F7A28',
    // Auto: the glyph sits on the chip in one mode and on the bar in the
    // other, and only auto reads whichever it is on. `legacyInk` is what
    // this look wrote before 2026-11-14 — kept only so a look applied
    // back then can be recognised and moved to auto (legacyInkFor).
    ink: 'auto',
    legacyInk: 'light',
  },
];

/** A palette by key, or null. */
export const dockPalette = (key) =>
  DOCK_PALETTES.find((p) => p.key === key) || null;

/** The miniature dock a palette would produce — for its own preview tile. */
export const paletteSkin = (palette) => customDockSkin(palette.backdrop);

/**
 * WHICH palette the dock is currently wearing, if any.
 *
 * A palette is not stored. It writes four settings and then stops existing —
 * which is what lets you nudge the ink or the backdrop afterwards without
 * being "in" a palette that no longer describes you. So "selected" is
 * recomputed from those settings, and tweaking any one of them deselects the
 * tile honestly instead of leaving a tick on a look you have since edited.
 */
export function matchingPalette({ dockStyle, dockColor, accentColor, dockInk }) {
  if (dockStyle !== 'custom') return null;
  const bg = normalizeHex(dockColor);
  const ac = normalizeHex(accentColor);
  const found = DOCK_PALETTES.find(
    (p) => p.backdrop === bg && p.accent === ac && p.ink === dockInk,
  );
  return found ? found.key : null;
}

export default DOCK_PALETTES;
