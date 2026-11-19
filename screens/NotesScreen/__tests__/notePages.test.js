import {
  DEFAULT_NOTE_PAGE, NOTE_PAGES, NOTE_SEGMENTS,
  pageAtOffset, pageIndex, pillProgress,
} from '../notePages';

/**
 * The three pages, and the arithmetic the pager and its pill share.
 *
 * Mark, 2026-11-18: "three tabs that can be translate moved from one tab to
 * the next that is split between to-do, notes, feedback."
 *
 * Pure and tested here because a disagreement between any two of the three
 * consumers — the pager's offsets, the pill's translate, the tap targets —
 * shows up as a pill pointing at a page you are not on, which is the kind of
 * thing you only notice on a phone, mid-swipe.
 */

describe('the pages', () => {
  test('are the three Mark asked for, in his order', () => {
    expect(NOTE_PAGES).toEqual(['todo', 'note', 'feedback']);
  });

  test('…with NOTES IN THE MIDDLE, one swipe from either neighbour', () => {
    // The same reasoning that keeps the planner's calendar at index 1.
    expect(NOTE_PAGES[1]).toBe('note');
  });

  test('ALL IS NOT A PAGE — a page is a place, not a filter', () => {
    expect(NOTE_PAGES).not.toContain('all');
    expect(pageIndex('all')).toBe(pageIndex(DEFAULT_NOTE_PAGE));
  });

  test('the segments and the pages are the same list, in the same order', () => {
    // Two arrays that could drift is exactly what this module exists to stop.
    expect(NOTE_SEGMENTS.map((s) => s.kind)).toEqual(NOTE_PAGES);
    for (const s of NOTE_SEGMENTS) {
      expect(s.label).toBeTruthy();
      expect(s.icon).toBeTruthy();
    }
  });

  test('the kinds are the ones the screen’s predicates already speak', () => {
    // 'todo' / 'note' / 'feedback' are matchesFilter's vocabulary. A page
    // naming itself anything else would filter to nothing, silently.
    for (const kind of NOTE_PAGES) expect(kind).toMatch(/^(todo|note|feedback)$/);
  });
});

describe('pageIndex', () => {
  test('each kind is its own position', () => {
    expect(pageIndex('todo')).toBe(0);
    expect(pageIndex('note')).toBe(1);
    expect(pageIndex('feedback')).toBe(2);
  });

  test('ANYTHING ELSE IS THE DEFAULT, never index 0 by accident', () => {
    // 0 happens to BE the default here, so this is asserted through the
    // constant: reorder the pages and this test still means what it says.
    for (const junk of [undefined, null, '', 'all', 'nope', 3]) {
      expect(pageIndex(junk)).toBe(NOTE_PAGES.indexOf(DEFAULT_NOTE_PAGE));
    }
  });
});

describe('pageAtOffset', () => {
  test('rounds to the nearest page, which is where a swipe settles', () => {
    expect(pageAtOffset(0, 390)).toBe('todo');
    expect(pageAtOffset(390, 390)).toBe('note');
    expect(pageAtOffset(780, 390)).toBe('feedback');
    // Mid-drag readings land on whichever page is closer.
    expect(pageAtOffset(100, 390)).toBe('todo');
    expect(pageAtOffset(300, 390)).toBe('note');
  });

  test('before layout, and past the end, it answers the default', () => {
    // A scroll issued against a page box the native view has not sized yet is
    // dropped; reporting page 0 for it would adopt a page nobody swiped to.
    expect(pageAtOffset(100, 0)).toBe(DEFAULT_NOTE_PAGE);
    expect(pageAtOffset(5000, 390)).toBe(DEFAULT_NOTE_PAGE);
  });
});

describe('pillProgress', () => {
  test('tracks the swipe 1:1, in page widths', () => {
    expect(pillProgress(0, 390)).toBe(0);
    expect(pillProgress(195, 390)).toBe(0.5);
    expect(pillProgress(390, 390)).toBe(1);
    expect(pillProgress(780, 390)).toBe(2);
  });

  test('A RUBBER-BAND DOES NOT CARRY THE PILL OFF ITS TRACK', () => {
    // iOS bounces past both ends. The bounce is the list's to show.
    expect(pillProgress(-120, 390)).toBe(0);
    expect(pillProgress(900, 390)).toBe(NOTE_PAGES.length - 1);
  });

  test('…and it is zero before there is a page to be a fraction of', () => {
    expect(pillProgress(100, 0)).toBe(0);
  });
});
