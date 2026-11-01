/**
 * pageWash — the whisper-faint wash over the page, and THE COLOUR IT MAKES.
 *
 * The wash is a barely-there blue-tinted white, strongest at the top-left and
 * dissolved to nothing by the bottom-right. It reads as atmospheric depth
 * rather than as a gradient anybody chose, and the alphas are tiny on purpose
 * so the theme's own background stays dominant.
 *
 * ── Why the colour is exported next to it ──────────────────────────────────
 *
 * `colors.background` is NOT what the page looks like. In dark mode the token
 * is pure `#000000`, but nothing on screen is: this wash lifts the top of the
 * page to roughly `#0E0F12`. So a surface that fills itself with the raw token
 * — a header, or a fade that has to ramp to "full page colour" — comes out
 * TRUE black on a page that is not, and the mismatch reads as a seam rather
 * than as a wrong colour. That is the shape of the bug twice over: once in the
 * Planner's header fill, once in the calendar's top fade.
 *
 * Two ways out, and which one depends on the surface:
 *   - A band in normal flow wants NO fill. Transparent, it takes the wash with
 *     everything else and matches the page by construction.
 *   - A surface that cannot be transparent — a fade whose whole job is to go
 *     opaque over a hard clip edge — asks `pageColor(theme)` for the colour the
 *     page actually presents, and ramps to that instead.
 *
 * ── One source for the stops ───────────────────────────────────────────────
 *
 * The stops live here as hex + alpha and the `rgba()` strings are DERIVED, for
 * the same reason `RULE_HIGHLIGHT` is a constant: a colour written out twice is
 * two colours the moment one of them is nudged, and `pageColor` has to composite
 * the very value the gradient draws or it is matching a page that no longer
 * exists.
 */
import { mixHex } from './accentColor';

/**
 * The wash, top-left to bottom-right. The FIRST stop is the one `pageColor`
 * composites: it is the wash at full strength, which is where the surfaces that
 * have to match it sit — the top of the page, under the header.
 */
const STOPS = [
  { hex: '#CDDCFF', alpha: 0.07 },   // faint blue-tinted white
  { hex: '#EBF0FF', alpha: 0.025 },  // even fainter
  { hex: '#FFFFFF', alpha: 0 },      // dissolved out
];

const rgba = ({ hex, alpha }) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const PAGE_WASH_COLORS = STOPS.map(rgba);
export const PAGE_WASH_LOCATIONS = [0, 0.55, 1];
export const PAGE_WASH_START = { x: 0.1, y: 0 };
export const PAGE_WASH_END = { x: 0.9, y: 1 };

/**
 * The opaque colour the page actually presents where the wash is at full
 * strength — the theme's background with the wash's first stop laid over it.
 *
 * Ask for this instead of `theme.colors.background` wherever a surface has to
 * disappear INTO the page. It is right in both modes: on the warm off-white it
 * is a shade cooler than the token, on black it is a lifted off-black.
 */
export function pageColor(theme) {
  const base = theme?.colors?.background || '#000000';
  return mixHex(base, STOPS[0].hex, STOPS[0].alpha);
}

export default pageColor;
