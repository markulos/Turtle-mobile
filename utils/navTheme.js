/**
 * THE COLOUR BEHIND THE PAGES — and the reason a tab change used to flash.
 *
 * react-navigation paints its own background under the scenes. With no theme
 * passed it uses the library's DefaultTheme, whose background is
 * rgb(242,242,242) — invisible while one opaque screen covers it, and NOT
 * invisible during a tab turn, because forTabTurn cross-fades the two pages.
 * For a few frames neither is solid, and what shows between them is that
 * light grey: in dark mode the whole app blinked pale mid-transition, every
 * single time you changed tabs.
 *
 * So the navigator is handed the app's own background, and the rest of the
 * palette with it.
 *
 * SPREAD over the library's theme rather than written from scratch: v7's
 * theme carries `fonts` as well as `colors`, and a theme object missing them
 * crashes at render rather than falling back — which is the kind of thing
 * that looks like a navigation bug three screens away from the cause.
 */

/**
 * @param isDark   the app's own light/dark answer
 * @param appTheme the app palette (ThemeContext's `theme`)
 * @param bases    { light, dark } — react-navigation's own themes, injected so
 *                 this stays a pure function and can be tested without the
 *                 navigation library's render-time requirements.
 */
export function buildNavTheme(isDark, appTheme, bases) {
  const base = (isDark ? bases?.dark : bases?.light) || {};
  const colors = appTheme?.colors || {};
  return {
    ...base,
    dark: !!isDark,
    colors: {
      ...(base.colors || {}),
      // THE one that matters: what shows between two cross-fading pages.
      background: colors.background,
      card: colors.surface,
      text: colors.textPrimary,
      border: colors.border,
      primary: colors.accent,
    },
  };
}

export default buildNavTheme;
