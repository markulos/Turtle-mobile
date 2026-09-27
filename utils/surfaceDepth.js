import { StyleSheet } from 'react-native';

/**
 * surfaceDepth — the app's light-mode depth, in one place.
 *
 * ─── Why ────────────────────────────────────────────────────────────────────
 *
 * The light theme is a white page (#FFFFFF) carrying near-white surfaces
 * (#F5F5F5 / #EEEEEE) separated by a 10 %-black hairline. That reads FLAT: a
 * card and the page behind it are the same plane with a line drawn between
 * them, so nothing is on top of anything. Dark mode never had the problem —
 * its surfaces step up the elevation ladder in tone, and the inset cards carry
 * a lit top edge.
 *
 * The fix is a shadow, but a shadow used as a GRADIENT: low opacity spread
 * over a wide radius, so what you see is a soft falloff under the element
 * rather than a drawn edge. Subtle is the whole point — at these values you
 * should not be able to point at a shadow, only notice that the card is
 * floating.
 *
 * ─── Why light only ─────────────────────────────────────────────────────────
 *
 * A black shadow behind a near-black card on a black page is invisible; all it
 * does is cost a layer per element, and on Android `elevation` actively draws
 * a muddy halo. Dark mode gets its depth from tone, which is what tone is for.
 * So `depth()` returns an EMPTY object in dark mode — spread it unconditionally
 * and the dark theme is untouched.
 *
 * ─── Levels ─────────────────────────────────────────────────────────────────
 *
 *   control — chips, pills, keys, small buttons. One point of lift, barely
 *             there; a control should look pressable, not raised.
 *   card    — the resting surfaces: cards, panels, rows, tiles, sections.
 *             The default, and what most of the app takes.
 *   raised  — things that float ABOVE the page while it is still there:
 *             menus, popovers, autocompletes, floating keys, banners.
 *   overlay — sheets and modals, which need to separate from a whole screen.
 *
 * The shadow colour is a blue-black (#0B1220) rather than pure black: a
 * neutral-black shadow on a white page greys the pixels under it and reads as
 * dirt, while a touch of blue reads as light. Same trick as the platform's own
 * shadows.
 *
 * Dependency-free on purpose (the same reasoning as the other shared style
 * constants): it briefly makes sense to hang this off ThemeContext, and then
 * every test that touches a card has to boot AsyncStorage.
 */

const SHADOW = '#0B1220';

/**
 * The light-mode values. Exported for the test that keeps them subtle — if
 * someone doubles an opacity, that should fail rather than ship.
 */
export const DEPTH = {
  control: {
    shadowColor: SHADOW,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  card: {
    shadowColor: SHADOW,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  raised: {
    shadowColor: SHADOW,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 6,
  },
  overlay: {
    shadowColor: SHADOW,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 12,
  },
};

export const LEVELS = Object.keys(DEPTH);

/**
 * Depth for a surface. Spread it into the style AFTER the fill:
 *
 *   card: { backgroundColor: theme.colors.surface, borderRadius: 14,
 *           ...depth(theme, 'card') },
 *
 * A shadow needs something to cast from, so the element must have an opaque
 * background — a transparent view with a shadow draws the shadow through
 * itself on Android and nothing at all on iOS.
 */
export function depth(theme, level = 'card') {
  if (!theme || theme.mode !== 'light') return {};
  return DEPTH[level] || DEPTH.card;
}

/**
 * How thick each of the two lines is.
 *
 * A POINT, not a hairline. At 0.33pt the pair was two sub-pixel lines a
 * third of a point apart, which on most screens the renderer resolves into one
 * grey smudge — the very thing having two of them is supposed to avoid. At a
 * point each they are genuinely distinct, and the shadow and the highlight read
 * as the two sides of an edge rather than as one soft line.
 *
 * Still small: the pair is 2pt total, which is a line you notice the QUALITY
 * of rather than the weight of.
 */
export const RULE_W = 1;

/**
 * The highlight both rules use, and the one thing anything else wanting to look
 * like them must borrow rather than retype.
 *
 * It is the light on an edge. Anywhere it appears — the groove under a header,
 * the ridge under a written line, the liner hugging a board's outline — it has
 * to be the SAME white, or two edges that are meant to be the same material
 * read as two different ones. A scan enforces that nobody writes it out twice.
 */
export const RULE_HIGHLIGHT = 'rgba(255, 255, 255, 0.92)';

/** And the shade it casts on the far side of the same edge. */
export const RULE_SHADOW = 'rgba(0, 0, 0, 0.13)';

/**
 * insetRule — a separator that reads as a GROOVE rather than a drawn line.
 *
 * Two hairlines, not one: a shadow line with a highlight directly beneath it.
 * That pair is the whole trick — it is what a physical score in a surface does
 * to light, and the eye reads it as depth without anyone deciding to. One
 * hairline can only ever be a line someone drew ON the page; two are a line cut
 * INTO it.
 *
 * It only works on an off-white page, which is why it arrived with one: a white
 * highlight needs somewhere lighter to go, and on #FFFFFF there is nowhere. On
 * the warm off-white the highlight is genuinely brighter than the surface and
 * the groove appears.
 *
 * DARK MODE GETS ONE HAIRLINE, for the same reason `depth()` gives it nothing:
 * a white highlight on a black page is not a groove, it is a white line. Spread
 * this unconditionally — the dark theme takes the plain separator it always had.
 *
 * SPREAD ONTO A VIEW OF ITS OWN, never onto a container. The two borders are
 * the whole element — a View with no children is already exactly their height —
 * and on a container they would draw a line across its TOP as well, because
 * that is where a top border goes. The groove only exists between two edges a
 * point apart, which means an element whose only job is to be those edges.
 *
 * It no longer sets `height: 0` for that reason. It did, and spread onto a
 * header container that silently collapsed the header to nothing — a footgun
 * with no upside, since the borders give the right height on their own.
 */
export function insetRule(theme) {
  const hairline = RULE_W;
  if (theme?.mode === 'dark') {
    return { borderBottomWidth: hairline, borderBottomColor: theme.colors.border };
  }
  return {
    // The score itself, a touch stronger than the theme's plain border — it has
    // a highlight under it to hold its own against.
    borderTopWidth: hairline,
    borderTopColor: RULE_SHADOW,
    // The light catching the lower lip of the cut.
    borderBottomWidth: hairline,
    borderBottomColor: RULE_HIGHLIGHT,
  };
}

/**
 * ridgeRule — the same trick the other way up: a line that stands PROUD.
 *
 * `insetRule` is a shadow with a highlight under it and reads as a cut.
 * Reverse the pair — highlight on top, shadow beneath — and the same two
 * hairlines read as an edge standing up off the page. Nothing else changes;
 * the order alone carries the whole meaning, which is why the two live
 * together and why neither may be "simplified" into one line.
 *
 * WHERE EACH BELONGS. A groove SEPARATES — it is the score between a header and
 * the page under it, two things on either side of a cut. A ridge is the top
 * edge of something: the lip of a list, the line a row sits on. Used the wrong
 * way round they both still draw, and the page quietly stops making sense —
 * every surface reading as if it were the one behind it.
 *
 * Off-white page only, same as the groove: a white highlight needs somewhere
 * lighter to go and on #FFFFFF there is nowhere. Dark mode takes the plain
 * hairline it always had.
 */
export function ridgeRule(theme) {
  const hairline = RULE_W;
  if (theme?.mode === 'dark') {
    return { borderBottomWidth: hairline, borderBottomColor: theme.colors.border };
  }
  return {
    // The light on the crest.
    borderTopWidth: hairline,
    borderTopColor: RULE_HIGHLIGHT,
    // And what it casts on the far side.
    borderBottomWidth: hairline,
    borderBottomColor: RULE_SHADOW,
  };
}

export default depth;
