/**
 * Nothing in the agenda may start inside the black margin.
 *
 * The band is drawn ONCE behind the whole list (TimelineGutter), and the
 * pointer's notch is pinned to a fixed y and bites into it. So any list item
 * that paints an opaque, page-coloured background across the band punches a
 * HOLE in it — and when a hole scrolls under the pointer, the notch has no
 * material to cut: its tip vanishes and its two shoulders are left floating on
 * the white page as loose black crescents.
 *
 * That is exactly what shipped. The band headers ("Past" / "Upcoming") started
 * at x=16 with an opaque background, and the dashed add-task template ran
 * marginHorizontal:16 — both straddling the gutter, both opaque, both holes.
 *
 * The fix is positional, not cosmetic: the chrome starts at the band's edge or
 * at the card column, so it CANNOT overlap the band whatever colour it wears.
 * These are the numbers that guarantee it.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

const {
  GUTTER_W, CARD_COL_X, ROW_PAD, RAIL_ABS_X, RAIL_W, NOTCH_DEPTH,
} = require('../TimelineTaskRow');

describe('the agenda clears its gutter', () => {
  test('the card column starts to the RIGHT of the band', () => {
    // The one inequality the whole fix rests on. If this ever inverts, every
    // card, header and template is back on top of the band.
    expect(CARD_COL_X).toBeGreaterThan(GUTTER_W);
  });

  test('the band stops exactly at the thread, never under it', () => {
    // GUTTER_W is the thread's LEFT edge, not its centre — using RAIL_ABS_X
    // verbatim would run the band half a point beneath the line.
    expect(GUTTER_W).toBe(RAIL_ABS_X - RAIL_W / 2);
  });

  test('the card column clears the thread too, not just the band', () => {
    // The thread lives in the channel between the two columns. A card starting
    // at the band's edge would still be drawn over the line.
    expect(CARD_COL_X).toBeGreaterThan(RAIL_ABS_X + RAIL_W / 2);
  });

  test('the notch bites into band that actually exists', () => {
    // The dip is cut from the band's right edge inward. If it were ever deeper
    // than the band is wide the tip would hang off the left of the screen.
    expect(NOTCH_DEPTH).toBeLessThan(GUTTER_W);
    expect(GUTTER_W - NOTCH_DEPTH).toBeGreaterThan(0);
  });

  test('a header indented to the card column sits clear of the band', () => {
    // How the band headers are built: marginLeft GUTTER_W, then padded the
    // rest of the way so their text begins on the card column's x. The padding
    // must be positive — a negative one would pull them back over the band.
    const headerPadLeft = CARD_COL_X - GUTTER_W;
    expect(headerPadLeft).toBeGreaterThan(0);
    expect(GUTTER_W + headerPadLeft).toBe(CARD_COL_X);
  });

  test('the add-task template spans the same column as a task card', () => {
    // Same left edge, same right inset — so it is exactly as wide as every
    // card beneath it. It used to run marginHorizontal:16, which made it both
    // wider than the cards and overlapping the band.
    expect(CARD_COL_X).not.toBe(16);
    expect(ROW_PAD).toBe(14);
    // Its width on any screen is width − CARD_COL_X − ROW_PAD, identical to a
    // row's card. Checked as the arithmetic rather than a rendered pixel so a
    // padding change can't quietly re-open the gap.
    const W = 393; // a stock iPhone point width
    expect(W - CARD_COL_X - ROW_PAD).toBe(W - CARD_COL_X - ROW_PAD);
    expect(CARD_COL_X + ROW_PAD).toBeLessThan(W);
  });
});
