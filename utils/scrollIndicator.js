/**
 * THE SCROLL BAR GOES ON THE EDGE.
 *
 * Left alone, iOS does not put it there. `automaticallyAdjustsScrollIndicatorInsets`
 * is ON by default (iOS 13+), which lets UIKit derive the indicator's insets
 * from the scroll view's *adjusted content inset* — the safe area, the keyboard,
 * and whatever a presenting view has decided its layout margins are. In a plain
 * screen that lands about where you would have put it anyway, which is why this
 * is easy to miss. Inside the surfaces this app is mostly made of — an overlay
 * page, a transparent Modal, a sheet over a pager — the number it arrives at is
 * nothing to do with the panel you are looking at, and the bar is drawn inside
 * the content instead of against the right edge. On the profile card it came
 * down the middle of the page.
 *
 * Setting the insets EXPLICITLY is what stops the guessing, so every scrollable
 * that shows a vertical bar spreads this:
 *
 *     <ScrollView {...SCROLL_INDICATOR} />
 *     <FlatList   {...scrollIndicator({ bottom: dockHeight })} />
 *
 * ─── Why 1 and not 0 ───────────────────────────────────────────────────────
 *
 * One point off the edge, because that is where the bar sits on every other
 * iOS app — flush looks clipped against a rounded panel corner. It is also the
 * value the first fix used (3a9e746, "the scroll bar goes on the edge"), and
 * twenty surfaces already wear it; keeping the number means this change is a
 * rule rather than a redecoration.
 *
 * `automaticallyAdjustsScrollIndicatorInsets: false` rides along because the
 * explicit insets alone only win by SIDE EFFECT on current RN — saying it
 * outright is what makes the behaviour survive the next upgrade.
 *
 * ─── When it does NOT apply ────────────────────────────────────────────────
 *
 * A horizontal list (its bar is along the bottom, and `right` means nothing),
 * and anything with `showsVerticalScrollIndicator={false}` (there is no bar to
 * place). `scrollIndicator.scan.test.js` knows both exceptions and fails on
 * anything else that goes without.
 */

/** One point off the right edge, and no guessing. Spread onto a scrollable. */
export const SCROLL_INDICATOR = {
  scrollIndicatorInsets: { right: 1 },
  automaticallyAdjustsScrollIndicatorInsets: false,
};

/**
 * The same, with the other edges set — a list under a floating dock wants the
 * bar to stop above it, the way its content does.
 *
 * `right` stays 1 unless a caller genuinely means otherwise: the point of the
 * rule is that the bar is in the same place on every screen.
 */
export function scrollIndicator(insets) {
  return {
    ...SCROLL_INDICATOR,
    scrollIndicatorInsets: { ...SCROLL_INDICATOR.scrollIndicatorInsets, ...insets },
  };
}

export default SCROLL_INDICATOR;
