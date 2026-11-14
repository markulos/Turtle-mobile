/**
 * THE DOCK'S SKINS — what the bottom nav is MADE OF, as a choice.
 *
 * The capsule had exactly one treatment: ghosted black in both themes, tuned
 * as a single look. That is still the default and still the opinionated one,
 * but it is an opinion, and the dock is the most-looked-at furniture in the
 * app. So the material is now a setting (Settings → Navigation), and this
 * module is the whole of it: every colour the dock draws, per skin, in one
 * place. A new skin is an entry in SKINS and nothing else — the dock, the
 * glyph tints and the Settings preview all read from here, so none of them can
 * disagree about what "paper" looks like.
 *
 * The third one, CUSTOM, is not an entry: it is BUILT from a single colour the
 * user picked, with everything else derived from it (see customDockSkin). That
 * is the only honest way to do it — a colour picker asks one question, and a
 * skin needs six answers.
 *
 * It is deliberately NOT keyed by theme. A skin is a choice about the dock, not
 * about the app's light/dark mode: `paper` is white in dark mode too, the same
 * way `smoked` has always been black in light mode. One palette per skin means
 * the glyph contrast is one problem to solve rather than four.
 *
 * ── What every skin has to supply ──────────────────────────────────────────
 *
 *   wash          the fill over the blur, as expo-linear-gradient `{ colors,
 *                 locations }`. A flat skin gives the same colour twice — one
 *                 code path in TabBarPill, no `if` per skin;
 *   blurTint      which way expo-blur frosts what's behind. A light tint under
 *                 a near-black wash just milks it out, and a dark tint under a
 *                 white one greys it;
 *   edge          the hairline around the capsule;
 *   lip           the lit hairline INSIDE its bottom edge, or null for a skin
 *                 with no depth to describe;
 *   ridge         the hairlines between the icons;
 *   inactiveTint  the glyph colour for every tab you are not on. This is the
 *                 one that makes a skin usable or not: it belongs to the DOCK,
 *                 not the theme, because the glyphs sit on the capsule.
 *
 * The ACTIVE glyph is not here — it is inked against the accent chip (`inkOn`,
 * see tabBarActiveTintColor in App.js), which is a property of the accent and
 * is already right on any skin.
 */

import { dockSurfaceStops } from './dockSurface';
import { INK_DARK, INK_LIGHT, hexToRgb, inkOn, normalizeHex } from '../utils/accentColor';

/** Every skin, in the order Settings offers them. */
export const DOCK_STYLES = ['smoked', 'paper', 'custom'];
export const DEFAULT_DOCK_STYLE = 'smoked';

/**
 * What 'custom' is before anyone has chosen — a neutral slate, so the tile has
 * something to preview and selecting it can never produce a dock made of
 * nothing. Deliberately not the accent: the backdrop and the chip that travels
 * on it would then be the same colour, and the chip is the one thing on the
 * dock that has to stand out.
 */
export const DEFAULT_DOCK_COLOR = '#2E2E36';

/**
 * How opaque a custom backdrop is — sheer, so the page moves under it rather
 * than stopping at it. 0.76 rather than the 0.88 it shipped at: a user colour
 * can be any value, so it keeps a little more body than smoked does.
 */
const CUSTOM_ALPHA = 0.76;

/**
 * THE ACTIVE GLYPH'S INK — the icon ON the chip, and the one colour in the
 * dock the app had always decided for you.
 *
 * 'auto' is `inkOn`: a contrast check against the accent, which answers white
 * for every saturated colour and near-black once the accent is pale enough
 * that white would disappear. It is right almost always, and "almost" is why
 * this is a setting. The check optimises for CONTRAST, and a chip whose glyph
 * is technically more legible is not always the one that looks right next to
 * the rest of the bar — on a mid-toned accent the two answers are close
 * enough that it is a matter of taste, and taste is the user's.
 *
 * So: override it, or leave it reading the colour. Black is the app's own ink
 * (#1F2024), not #000 — the same near-black every dark glyph in the app uses,
 * because true black on a saturated colour reads as a hole.
 */
export const DOCK_INKS = ['auto', 'light', 'dark', 'custom'];
export const DEFAULT_DOCK_INK = 'auto';

export const DOCK_INK_LABELS = {
  auto: 'Auto', light: 'White', dark: 'Black', custom: 'Custom',
};

/** What 'custom' draws until a colour has been picked. */
export const DEFAULT_DOCK_INK_COLOR = '#FFFFFF';

/**
 * The colour the active glyph is drawn in.
 *
 * `on` says what the glyph is sitting ON, which is what 'auto' has to read:
 *
 *   • with the CHIP it sits on the accent, so auto is `inkOn(accent)` —
 *     whichever of black or white reads on your highlight colour;
 *   • with the UNDERLINE there is no chip. The glyph sits on the dock itself,
 *     and a contrast check against a colour that is not under it gave the
 *     wrong answer exactly when it mattered: a pale highlight colour put a
 *     BLACK glyph on a dark dock. So there auto reads the dock — white on a
 *     dark one, near-black on a light one.
 *
 * 'custom' is `on.custom`, any colour, falling back to white while none has
 * been picked. 'light' and 'dark' are the fixed pair.
 */
export function activeInk(mode, accent, on) {
  if (mode === 'light') return INK_LIGHT;
  if (mode === 'dark') return INK_DARK;
  if (mode === 'custom') return normalizeHex(on && on.custom) || INK_LIGHT;
  if (on && on.underline) return on.darkDock ? INK_LIGHT : INK_DARK;
  return inkOn(accent);
}

const SKINS = {
  /**
   * SMOKED — the original. A near-black frosted capsule, lit as a channel cut
   * into the page: darkest along the top edge, lifting toward a hairline of
   * light along the bottom. See dockSurface for the wash itself.
   */
  smoked: {
    key: 'smoked',
    name: 'Smoked',
    blurb: 'A near-black capsule, frosted, with the page blurred behind it.',
    wash: dockSurfaceStops(),
    blurTint: 'dark',
    edge: 'rgba(255,255,255,0.16)',
    lip: 'rgba(255,255,255,0.30)',
    ridge: 'rgba(255,255,255,0.30)',
    inactiveTint: 'rgba(255,255,255,0.55)',
  },

  /**
   * PAPER — white, flat, and a hairline. No wash and no lip: the whole point
   * of this one is that it describes no depth at all, so the only things on
   * screen are the glyphs and the chip. Kept slightly translucent rather than
   * solid #FFF so the blur still has something to do and the dock still reads
   * as a layer over the page rather than a hole punched in it.
   */
  paper: {
    key: 'paper',
    name: 'Paper',
    blurb: 'A white bar with a hairline edge. No shading, no gloss.',
    // Sheerer than it was (0.86), but NOT by as much as smoked: a white bar
    // over a white page is carried by its hairline edge alone, so there is
    // less here to give away before the capsule stops being a shape.
    wash: { colors: ['rgba(255,255,255,0.78)', 'rgba(255,255,255,0.78)'], locations: [0, 1] },
    blurTint: 'light',
    edge: 'rgba(0,0,0,0.14)',
    lip: null,
    ridge: 'rgba(0,0,0,0.10)',
    // Dark ink, and not pure black: 0.45 against the white sits at roughly the
    // same distance from its background as smoked's 0.55 white does from its,
    // so neither skin's inactive glyphs shout louder than the other's.
    inactiveTint: 'rgba(0,0,0,0.45)',
  },
};

/**
 * A skin built from ONE COLOUR the user picked.
 *
 * Everything else is derived, because a colour picker cannot ask six
 * questions. The one that matters is the INK: `inkOn` is the same contrast
 * check the accent chip's glyph uses, so a dark backdrop gets white glyphs and
 * a pale one gets near-black, and there is no colour you can choose that
 * leaves the dock's icons invisible. The edge follows the ink for the same
 * reason — a white hairline on a white bar is not an edge.
 *
 * Flat, like paper: a wash would need a second colour nobody chose, and
 * shading someone's chosen colour darker is a good way to not give them the
 * colour they chose.
 */
export function customDockSkin(hex) {
  const colour = normalizeHex(hex) || DEFAULT_DOCK_COLOR;
  const { r, g, b } = hexToRgb(colour) || { r: 46, g: 46, b: 54 };
  const fill = `rgba(${r},${g},${b},${CUSTOM_ALPHA})`;
  // Which way the contrast check went. `lightInk` means the surface is DARK.
  const lightInk = inkOn(colour) === '#FFFFFF';
  return {
    key: 'custom',
    name: 'Custom',
    colour,
    blurb: `Your own colour: ${colour}. Tap again to change it.`,
    wash: { colors: [fill, fill], locations: [0, 1] },
    // The frost follows the SURFACE, not the theme: a dark tint under a pale
    // custom colour greys it, and a light one under a dark colour milks it.
    blurTint: lightInk ? 'dark' : 'light',
    edge: lightInk ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.16)',
    lip: null,
    ridge: lightInk ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.12)',
    // Heavier than the fixed skins' 0.55/0.45: those sit on colours tuned
    // against their ink, and a custom colour can land anywhere — including the
    // mid greys, where neither white nor black has much room. The extra weight
    // is what keeps the worst case legible.
    inactiveTint: lightInk ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.58)',
  };
}

/**
 * The palette for a skin name — and the DEFAULT for anything else.
 *
 * Unknown input has to return a working dock rather than undefined: the name
 * comes from AsyncStorage, so a build that drops a skin would otherwise leave
 * everyone who chose it with a nav bar made of nothing.
 */
export function dockSkin(name, customColour) {
  if (name === 'custom') return customDockSkin(customColour);
  return SKINS[name] || SKINS[DEFAULT_DOCK_STYLE];
}

/** Every skin, in offer order — for the Settings picker. */
export const dockSkins = (customColour) =>
  DOCK_STYLES.map((key) => dockSkin(key, customColour));

export default dockSkin;
