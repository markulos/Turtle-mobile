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
 * The EDGE of a card that has to be picked out from the page behind it.
 *
 * `depth()` above handles the floating; this handles the outline, and the two
 * are separate because they fail separately. A near-white card on a white page
 * is carried almost entirely by its shadow, and a shadow alone leaves the card's
 * boundary soft — fine for a panel you are looking at, not fine for a LIST of
 * cards, where the eye is counting where one ends and the next begins.
 *
 * So: a full point at `borderStrong` rather than a hairline at `border`. Both
 * are tokens the theme already defines (and already tints with the user's accent
 * colour), so this is the existing palette drawn more firmly, not a new look. A
 * hairline is 0.33pt on a 3× screen — at 10 % black over a near-white fill that
 * is a line the renderer can barely commit to.
 *
 * Spread it AFTER the fill and alongside depth():
 *
 *   row: { backgroundColor: theme.colors.surface, borderRadius: 12,
 *          ...cardEdge(theme), ...depth(theme, 'card') },
 *
 * Unlike depth(), this applies in BOTH themes: a dark card gets its separation
 * from tone, but in a long list the tonal step between `surface` and the page is
 * small enough that the edge is doing real work there too.
 */
export function cardEdge(theme) {
  return {
    borderWidth: RULE_W,
    borderColor: theme?.colors?.borderStrong || 'rgba(0, 0, 0, 0.2)',
  };
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
 * The single hairline a dark page separates with.
 *
 * `borderNeutral` is the theme's own subtle white, handed over untinted by
 * ThemeContext; `border` is that same token after the accent wash. Falling back
 * to `border` keeps a hand-built theme (and the frosted sheet's own palette,
 * which builds from DARK_THEME directly) working rather than drawing nothing.
 */
function darkHairline(theme) {
  return theme.colors.borderNeutral || theme.colors.border;
}

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
 * And `borderNeutral` is how it still gets a PLAIN one. `colors.border` is no
 * longer the dark theme's own subtle white: ThemeContext washes it with the
 * chosen accent so every outline in the app carries it. On an off-white page
 * that wash is a tint; on pure black an accent at 0.22 is a warm brown line,
 * which is a coloured border rather than "the accent is in the room" — the one
 * thing the wash is documented not to be. So the groove asks for the untinted
 * token and the rest of the app keeps the accent.
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
    return { borderBottomWidth: hairline, borderBottomColor: darkHairline(theme) };
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
 * listGlyphInk — the colour of the little icon at the head of a list row.
 *
 * Part of STYLE-RULES §8, and here rather than in a screen because the rule
 * only holds if the next list reaches for the same thing.
 *
 * VERY DARK GREY, not the highlight colour. A column of nine accent glyphs is
 * the loudest thing on a page that is otherwise text, and it says "look at
 * me" nine times for rows that are only doors. The accent is for STATE — the
 * tab you are on, the track that is playing, a count that is waiting — and
 * spending it on navigation leaves nothing to say those with.
 *
 * It is also the safe choice: the highlight colour is the user's, and a pale
 * one drawn on a pale tile disappears (see readableOn in accentColor, and the
 * Media Vault rows that shipped invisible). A fixed ink cannot.
 *
 * Near-black rather than black, so it reads as ink rather than as a hole —
 * and flipped in dark mode, where "very dark grey" would be the same
 * invisibility the other way up.
 */
export const LIST_GLYPH_LIGHT = '#2A2A2A';

export const listGlyphInk = (theme) => (
  theme?.mode === 'dark' ? (theme?.colors?.textPrimary || '#E0E0E0') : LIST_GLYPH_LIGHT
);

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
    return { borderBottomWidth: hairline, borderBottomColor: darkHairline(theme) };
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
