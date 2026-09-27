/**
 * The dock's geometry, and the one rule that keeps panels out from behind it.
 *
 * STYLE-RULES §3. The tab bar is a FLOATING capsule — it reserves no layout
 * space — so anything that ends at the bottom of the screen ends underneath it
 * unless it says otherwise. The last row of a panel is where its verbs live
 * (Apply, Show, Save), which is why this is a rule and not a preference.
 */
import {
  BAR_CONTENT_HEIGHT, CARD_GAP_BOTTOM, PANEL_BOTTOM_GAP,
  dockOccupied, panelBottomInset,
  PILL_SIZE, BAR_VERTICAL_PAD, TAB_ITEM_PADDING, TAB_ICON_SLOT, clusterStart,
} from '../tabBarLayout';

describe('how much room the dock really takes', () => {
  test('the card, the gap it floats above the edge, and the inset under that', () => {
    expect(dockOccupied(34)).toBe(BAR_CONTENT_HEIGHT + CARD_GAP_BOTTOM + 34);
  });

  test('a device with no inset still has a dock to clear', () => {
    expect(dockOccupied(0)).toBe(BAR_CONTENT_HEIGHT + CARD_GAP_BOTTOM);
    expect(dockOccupied()).toBe(BAR_CONTENT_HEIGHT + CARD_GAP_BOTTOM);
  });
});

describe('panelBottomInset — every panel ends ABOVE the dock', () => {
  // The Planner's filter panel shipped with its "Show" key behind the capsule,
  // visible as two slivers either side of it. This is that bug's inverse.
  test('an overlaid panel clears the whole dock, plus a breath', () => {
    expect(panelBottomInset(34)).toBe(dockOccupied(34) + PANEL_BOTTOM_GAP);
  });

  test('…which is strictly more than the safe area alone', () => {
    expect(panelBottomInset(34)).toBeGreaterThan(34);
    expect(panelBottomInset(0)).toBeGreaterThan(0);
  });

  // A full-screen Modal presents above the whole navigator, so the dock is not
  // drawn over it — clearing it there would be a band of empty page.
  test('a full-screen panel clears only the home indicator', () => {
    expect(panelBottomInset(34, false)).toBe(34 + PANEL_BOTTOM_GAP);
    expect(panelBottomInset(34, false)).toBeLessThan(panelBottomInset(34, true));
  });

  test('junk in is still a usable number, never NaN padding', () => {
    expect(panelBottomInset(undefined, false)).toBe(PANEL_BOTTOM_GAP);
    expect(Number.isFinite(panelBottomInset())).toBe(true);
  });

  // The whole point of exporting it: a panel that hand-tunes a number, or
  // reaches for useBottomTabBarHeight(), drifts from every other panel.
  test('it is a pure function of the inset — two panels cannot disagree', () => {
    expect(panelBottomInset(34)).toBe(panelBottomInset(34));
  });
});

describe('the chip sits dead centre, by construction', () => {
  test('the bar’s inner box is exactly the chip plus symmetric padding', () => {
    expect(BAR_CONTENT_HEIGHT).toBe(PILL_SIZE + BAR_VERTICAL_PAD * 2);
  });

  // react-navigation hard-codes `padding: 5` on the inner pressable, so the
  // slot is sized for it rather than fought.
  test('the icon slot is the chip less that padding on both sides', () => {
    expect(TAB_ICON_SLOT).toBe(PILL_SIZE - TAB_ITEM_PADDING * 2);
  });
});

describe('the tab cluster', () => {
  test('is centred on the screen', () => {
    expect(clusterStart(390, 5)).toBeCloseTo((390 - 5 * 67) / 2);
  });

  // A narrow screen degrades to edge-to-edge rather than pushing the first tab
  // off the left of it.
  test('never starts left of the edge', () => {
    expect(clusterStart(200, 5)).toBe(0);
  });
});
