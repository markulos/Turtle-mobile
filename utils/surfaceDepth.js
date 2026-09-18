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

export default depth;
