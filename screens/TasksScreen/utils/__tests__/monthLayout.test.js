import { monthLayout } from '../monthLayout';

// A 390 x 844pt phone (1170 x 2532 @3x), which is what these numbers are
// tuned against. Derived exactly as CalendarView derives them:
//   DAY_WIDTH  = (390 - 2*16) / 7
//   CELL_HEIGHT = DAY_WIDTH + 10, MAX_CELL_HEIGHT = DAY_WIDTH + 16
//   chrome      = title 72 + weekday labels 30 + pad 4
//   areaH       = 844 - safe-area top 47 - screen header 50
//   reserve     = sheet header 81 + dockOccupied(34) 111
const DAY_WIDTH = (390 - 32) / 7;
const PHONE = {
  areaH: 747,
  bottomReserve: 192,
  chromeH: 106,
  minCell: DAY_WIDTH + 10,
  maxCell: DAY_WIDTH + 16,
};

describe('monthLayout', () => {
  test('the month never extends past the docked sheet', () => {
    const { monthH, topInset } = monthLayout(PHONE);
    expect(topInset + monthH).toBeLessThanOrEqual(PHONE.areaH - PHONE.bottomReserve);
  });

  test('on a phone it sits as low as it can rather than centred in the gap', () => {
    const { monthH, topInset } = monthLayout(PHONE);
    // Screen-centring overshoots into the sheet here, so the clamp wins and the
    // page ends flush against the peek. Centring in the GAP would put it ~23pt
    // higher — that is the position this test exists to rule out.
    expect(topInset).toBeCloseTo(PHONE.areaH - PHONE.bottomReserve - monthH, 5);
    const centredInGap = (PHONE.areaH - PHONE.bottomReserve - monthH) / 2;
    expect(topInset).toBeGreaterThan(centredInGap);
  });

  test('cells grow to use the screen but stop at the cap', () => {
    const { cellH } = monthLayout(PHONE);
    expect(cellH).toBe(PHONE.maxCell);
  });

  test('a screen tall enough to fit the month outright centres it on the screen', () => {
    const tall = { ...PHONE, areaH: 1400 };
    const { monthH, topInset } = monthLayout(tall);
    expect(topInset).toBeCloseTo((tall.areaH - monthH) / 2, 5);
    // Still clear of the sheet, so both rules hold at once.
    expect(topInset + monthH).toBeLessThanOrEqual(tall.areaH - tall.bottomReserve);
  });

  test('a short screen keeps cells readable and top-anchors instead of centring', () => {
    // 667pt phone: even at the minimum cell the six rows do not fit above the
    // sheet. Readability wins; the page anchors at the top so the month TITLE
    // survives and only the tail is clipped.
    const short = { ...PHONE, areaH: 570, bottomReserve: 192 };
    const { cellH, topInset } = monthLayout(short);
    expect(cellH).toBe(short.minCell);
    expect(topInset).toBe(0);
  });

  test('returns null before the area has been measured', () => {
    expect(monthLayout({ ...PHONE, areaH: 0 })).toBeNull();
    expect(monthLayout({ ...PHONE, areaH: 100, bottomReserve: 192 })).toBeNull();
  });
});
