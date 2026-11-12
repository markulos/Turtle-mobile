/**
 * The dock's geometry, and the one rule that keeps panels out from behind it.
 *
 * STYLE-RULES §3. The tab bar is a FLOATING capsule — it reserves no layout
 * space — so anything that ends at the bottom of the screen ends underneath it
 * unless it says otherwise. The last row of a panel is where its verbs live
 * (Apply, Show, Save), which is why this is a rule and not a preference.
 */
import {
  BAR_CONTENT_HEIGHT, CARD_GAP_BOTTOM, PANEL_BOTTOM_GAP, PANEL_TOP_GAP,
  dockOccupied, panelBottomInset, panelTopInset,
  PILL_SIZE, BAR_VERTICAL_PAD, TAB_ITEM_PADDING, TAB_ICON_SLOT, clusterStart,
  CARD_MARGIN_H, TAB_SLOT, slotAtX,
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

describe('panelTopInset — every panel clears the TOP HOOD', () => {
  // The Notes filter panel shipped with its back key, its "Filter" title and
  // its Clear key drawn through the status bar clock. This is that bug's
  // inverse, and the mirror of panelBottomInset at the other end.
  test('a hooded phone gets the whole hood, plus a breath', () => {
    expect(panelTopInset(59)).toBe(59 + PANEL_TOP_GAP);
  });

  test('…which is strictly more than the hood alone, so nothing sits on it', () => {
    expect(panelTopInset(59)).toBeGreaterThan(59);
  });

  // A phone with no notch still has a status bar; the breath is what keeps the
  // title off it, so it is not conditional on there being an inset to clear.
  test('a phone with no hood still gets the breath', () => {
    expect(panelTopInset(0)).toBe(PANEL_TOP_GAP);
    expect(panelTopInset()).toBe(PANEL_TOP_GAP);
  });

  test('junk in is still a usable number, never NaN padding', () => {
    expect(panelTopInset(undefined)).toBe(PANEL_TOP_GAP);
    expect(panelTopInset(null)).toBe(PANEL_TOP_GAP);
    expect(Number.isFinite(panelTopInset(NaN))).toBe(true);
  });

  // The whole point of exporting it: "my parent already cleared the status bar"
  // is a judgement two panels made differently, and both were wrong.
  test('it is a pure function of the inset — two panels cannot disagree', () => {
    expect(panelTopInset(59)).toBe(panelTopInset(59));
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

describe('slotAtX — which tab the dragging thumb is over', () => {
  const W = 390;
  const COUNT = 6;
  // The centre of slot `i`, in window coordinates: the card's margin, the
  // cluster's own inset inside it, i whole slots, and half of one more.
  const centre = (i, count = COUNT, width = W) =>
    CARD_MARGIN_H + clusterStart(width - CARD_MARGIN_H * 2, count) + TAB_SLOT * i + TAB_SLOT / 2;

  // The load-bearing one: a thumb resting on an icon must read as that icon's
  // whole number, or the chip sits off its glyph for the whole drag and the
  // commit flips a slot early.
  test('an icon’s centre is its own index, exactly', () => {
    for (let i = 0; i < COUNT; i += 1) {
      expect(slotAtX(centre(i), W, COUNT)).toBeCloseTo(i);
    }
  });

  test('between two icons it is a fraction, so the chip can track the finger', () => {
    const half = (centre(2) + centre(3)) / 2;
    expect(slotAtX(half, W, COUNT)).toBeCloseTo(2.5);
    expect(slotAtX(centre(2) + TAB_SLOT * 0.25, W, COUNT)).toBeCloseTo(2.25);
  });

  // Rounding is what the commit uses, and this is why it rounds rather than
  // truncates: the tab flips as the thumb crosses the GAP between two icons,
  // which is where the eye expects it — not as it touches the next icon's
  // left edge.
  test('the commit boundary falls in the gap between icons', () => {
    const justBefore = (centre(2) + centre(3)) / 2 - 1;
    const justAfter = (centre(2) + centre(3)) / 2 + 1;
    expect(Math.round(slotAtX(justBefore, W, COUNT))).toBe(2);
    expect(Math.round(slotAtX(justAfter, W, COUNT))).toBe(3);
  });

  // A thumb that runs off the end of the capsule holds the end tab. Without
  // the clamp it would scrub into slots that do not exist, and the chip would
  // leave the dock.
  test('a thumb past either end holds at the end tab', () => {
    expect(slotAtX(0, W, COUNT)).toBe(0);
    expect(slotAtX(-200, W, COUNT)).toBe(0);
    expect(slotAtX(W, W, COUNT)).toBe(COUNT - 1);
    expect(slotAtX(W + 200, W, COUNT)).toBe(COUNT - 1);
  });

  // The Vault tab can be switched off in Settings, which shrinks the cluster
  // and moves every slot. Nothing may be hard-coded to six.
  test('it follows the cluster when a tab is hidden', () => {
    expect(slotAtX(centre(4, 5), W, 5)).toBeCloseTo(4);
    expect(slotAtX(centre(4, 5), W, 6)).not.toBeCloseTo(4);
  });

  test('is monotonic — a thumb moving right never moves the chip left', () => {
    let last = -Infinity;
    for (let x = 0; x <= W; x += 3) {
      const p = slotAtX(x, W, COUNT);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
  });
});
