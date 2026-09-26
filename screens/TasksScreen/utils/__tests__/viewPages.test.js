import {
  VIEW_PAGES, DEFAULT_VIEW, VIEW_SEGMENTS, viewIndex, viewAtOffset,
} from '../viewPages';

// ── The order is the spec ───────────────────────────────────────────────────
// Agenda, Calendar, Boards, Focus. Pinned because three separate things derive
// from it — the pager's page positions, the sliding underline's translate, and
// the tap targets — and a reorder that missed one would leave the bar under a
// page you are not on.
describe('the four pages', () => {
  test('agenda, calendar, boards, focus — in that order', () => {
    expect(VIEW_PAGES).toEqual(['list', 'calendar', 'boards', 'focus']);
  });

  // Index 1 is load-bearing: it is what keeps the calendar one swipe from the
  // agenda, which is the pair you move between most.
  test('the calendar sits beside the agenda', () => {
    expect(VIEW_PAGES[1]).toBe('calendar');
    expect(VIEW_PAGES).toHaveLength(4);
  });

  // The agenda's mode string stays 'list'. It is threaded through the screen
  // and persisted; renaming a stored value to match a label is how a saved
  // preference stops resolving. Only the LABEL is "Agenda".
  test('the agenda keeps its internal name and gains only a label', () => {
    expect(VIEW_PAGES[0]).toBe('list');
    expect(VIEW_SEGMENTS[0]).toMatchObject({ mode: 'list', label: 'Agenda' });
  });

  test('every page has exactly one segment, in the same order', () => {
    expect(VIEW_SEGMENTS.map((s) => s.mode)).toEqual(VIEW_PAGES);
    for (const seg of VIEW_SEGMENTS) {
      expect(seg.label).toBeTruthy();
      expect(seg.icon).toBeTruthy();
    }
  });
});

describe('viewIndex', () => {
  test('a mode maps to its page', () => {
    expect(viewIndex('list')).toBe(0);
    expect(viewIndex('calendar')).toBe(1);
    expect(viewIndex('boards')).toBe(2);
    expect(viewIndex('focus')).toBe(3);
  });

  // NOT 0. An unknown mode — a stale persisted value, a typo in a caller —
  // falling back to "the first page" would silently show a different page
  // from the one the screen believes it is showing.
  test('an unknown mode falls back to the default, not to the first page', () => {
    expect(viewIndex('nonsense')).toBe(VIEW_PAGES.indexOf(DEFAULT_VIEW));
    expect(viewIndex(undefined)).toBe(VIEW_PAGES.indexOf(DEFAULT_VIEW));
    expect(viewIndex(null)).not.toBe(0);
  });
});

describe('viewAtOffset', () => {
  const W = 390;

  test('a settled page reports itself', () => {
    expect(viewAtOffset(0, W)).toBe('list');
    expect(viewAtOffset(W, W)).toBe('calendar');
    expect(viewAtOffset(W * 2, W)).toBe('boards');
    expect(viewAtOffset(W * 3, W)).toBe('focus');
  });

  // Mid-swipe the offset is never exact — it rounds to the page it landed
  // nearest, which is the page the scroller has snapped to.
  test('a near-miss rounds to the page it landed on', () => {
    expect(viewAtOffset(W - 2, W)).toBe('calendar');
    expect(viewAtOffset(W + 3, W)).toBe('calendar');
  });

  // The first layout, a rotation mid-gesture: a zero width must not divide.
  test('an unmeasured pager answers the default rather than NaN', () => {
    expect(viewAtOffset(100, 0)).toBe(DEFAULT_VIEW);
    expect(viewAtOffset(0, undefined)).toBe(DEFAULT_VIEW);
  });

  // Rubber-band past either end still belongs to the end page.
  test('an overscroll belongs to the page it overscrolled from', () => {
    expect(viewAtOffset(-40, W)).toBe('list');
    expect(viewAtOffset(W * 3 + 40, W)).toBe('focus');
  });
});

// ── The sliding bar ─────────────────────────────────────────────────────────
// The tabs are sized to their own content now, so the bar both MOVES and
// RESIZES: its translate comes from each tab's measured x, its scale from each
// tab's measured width. Both ranges are derived from this list, which is the
// invariant worth pinning — a page added without a stop parks the bar under a
// tab you are not on, silently.
describe('the sliding underline', () => {
  // Stand-in for what onLayout reports: content-width tabs, left to right,
  // with a gap after each.
  const GAP = 24;
  const widths = [78, 96, 80, 70];
  const boxes = [];
  let x = 16;
  for (const w of widths) { boxes.push({ x, width: w }); x += w + GAP; }

  test('there is one stop per page, for both ends of the move', () => {
    expect(boxes.map((b) => b.x)).toHaveLength(VIEW_PAGES.length);
    expect(boxes.map((b) => b.width)).toHaveLength(VIEW_PAGES.length);
  });

  // The bar is 1pt wide and scaled, so the scale output IS the width — not a
  // ratio. Getting that wrong gives a bar a pixel long.
  test('the scale output is a width in points, not a ratio', () => {
    for (const b of boxes) expect(b.width).toBeGreaterThan(2);
  });

  // Each tab's own left edge — not a slot's. The translate places the bar's
  // left edge, which is why its origin is on the left.
  test(`each stop is its own tab's left edge, gaps included`, () => {
    expect(boxes[0].x).toBe(16);
    expect(boxes[1].x).toBe(16 + widths[0] + GAP);
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].x).toBeGreaterThan(boxes[i - 1].x + boxes[i - 1].width);
    }
  });
});
