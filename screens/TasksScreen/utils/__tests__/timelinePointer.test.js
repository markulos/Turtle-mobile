import {
  indexAtContentY, dayKeyAt, pointerLabel, pointerParts, splitDay, splitTime, activeRowIdAt,
  markContentY, isCardItem, nearestCardCenter, magnetPull, dayOffsetLabel,
} from '../timelinePointer';

// A stand-in for FlashList's geometry: items stacked from y=0, each its own
// height, with the gaps the agenda actually leaves between rows.
const stack = (heights, gap = 0) => {
  const layouts = [];
  let y = 0;
  for (const h of heights) { layouts.push({ x: 0, y, width: 300, height: h }); y += h + gap; }
  return (i) => layouts[i];
};

describe('indexAtContentY', () => {
  const getLayout = stack([100, 60, 40]);

  test('finds the item the mark is sitting inside', () => {
    expect(indexAtContentY(0, 0, 2, getLayout)).toBe(0);
    expect(indexAtContentY(99, 0, 2, getLayout)).toBe(0);
    expect(indexAtContentY(100, 0, 2, getLayout)).toBe(1);
    expect(indexAtContentY(159, 0, 2, getLayout)).toBe(1);
    expect(indexAtContentY(160, 0, 2, getLayout)).toBe(2);
  });

  // The mark is always ON something. Reporting "nothing" in the margin between
  // two rows would blank the readout every time the pointer crossed one.
  test('a y in the gap between rows belongs to the row below it', () => {
    const gapped = stack([100, 60], 12); // 0–100, gap 100–112, 112–172
    expect(indexAtContentY(105, 0, 1, gapped)).toBe(1);
  });

  test('searches only the window it was given', () => {
    // y=0 is inside item 0, but item 0 isn't on screen — don't report it.
    expect(indexAtContentY(0, 1, 2, getLayout)).toBe(1);
  });

  test('-1 when nothing on screen covers the mark', () => {
    expect(indexAtContentY(9999, 0, 2, getLayout)).toBe(-1);
  });

  // getLayout throws for indices FlashList hasn't laid out yet; a pointer that
  // crashed the scroll handler would take the whole list with it.
  test('an index the list cannot lay out is skipped, not thrown', () => {
    const flaky = (i) => { if (i === 0) throw new Error('not laid out'); return stack([100, 60])(i); };
    expect(() => indexAtContentY(120, 0, 1, flaky)).not.toThrow();
    expect(indexAtContentY(120, 0, 1, flaky)).toBe(1);
    expect(indexAtContentY(120, 0, 1, () => undefined)).toBe(-1);
  });
});

describe('dayKeyAt', () => {
  // The agenda as it really is: chrome, dividers, rows, gaps, all one array.
  const items = [
    { __agendaHeader: 'upcoming' },          // 0 — no date of its own
    { __addCard: true },                     // 1 — nor this
    { __divider: true, dateKey: '2026-09-28' }, // 2
    { id: 'a', dueDate: '2026-09-28', time: '21:00' }, // 3
    { __divider: true, dateKey: '2026-10-01' }, // 4
    { id: 'b', dueDate: '2026-10-01' },      // 5
    { __gap: true },                         // 6 — nor this
  ];

  test('a row states its own day', () => {
    expect(dayKeyAt(items, 3)).toBe('2026-09-28');
    expect(dayKeyAt(items, 5)).toBe('2026-10-01');
  });

  test('a divider states it outright', () => {
    expect(dayKeyAt(items, 4)).toBe('2026-10-01');
  });

  // Headers, gaps and the add card carry no date — the pointer sitting on one
  // should report the day it is still inside, not go blank.
  test('chrome inherits the day above it', () => {
    expect(dayKeyAt(items, 6)).toBe('2026-10-01'); // the gap after the last row
  });

  test('null above the first dated thing, rather than a wrong day', () => {
    expect(dayKeyAt(items, 0)).toBeNull();
    expect(dayKeyAt(items, 1)).toBeNull();
  });
});

describe('pointerLabel', () => {
  const dateLabel = (k) => ({ '2026-09-28': 'Today', '2026-10-06': 'Oct 6' }[k] || k);
  const clock = (mins) => `${(Math.floor(mins / 60) % 12) || 12}${mins % 60 ? `:${String(mins % 60).padStart(2, '0')}` : ''} ${mins >= 720 ? 'PM' : 'AM'}`;

  test('the day leads, and a timed row adds its hour', () => {
    const row = { dueDate: '2026-09-28', time: '21:00' };
    expect(pointerLabel(row, '2026-09-28', dateLabel, clock)).toBe('Today · 9 PM');
  });

  // A header or a gap has no hour to report, and borrowing the previous row's
  // would state a time the pointer isn't actually on.
  test('chrome and untimed rows print the day alone', () => {
    expect(pointerLabel({ __gap: true }, '2026-10-06', dateLabel, clock)).toBe('Oct 6');
    expect(pointerLabel({ dueDate: '2026-10-06' }, '2026-10-06', dateLabel, clock)).toBe('Oct 6');
  });

  test('a malformed time degrades to the day, not to "NaN"', () => {
    const bad = { dueDate: '2026-10-06', time: 'lunchtime' };
    expect(pointerLabel(bad, '2026-10-06', dateLabel, clock)).toBe('Oct 6');
  });

  test('no day → nothing to print', () => {
    expect(pointerLabel({ dueDate: '2026-10-06' }, null, dateLabel, clock)).toBeNull();
  });
});

// ── Which row the mark lights ───────────────────────────────────────────────
describe('activeRowIdAt', () => {
  const rows = [
    { id: 'head', __agendaHeader: 'upcoming' },
    { id: 'add', __addCard: true },
    { id: 'a', title: 'One' },
    { id: 'div-1', __divider: true },
    { id: 'b', title: 'Two' },
  ];

  test('a real row lights itself', () => {
    expect(activeRowIdAt(rows, 2, null)).toBe('a');
    expect(activeRowIdAt(rows, 4, 'a')).toBe('b');
  });

  // The agenda's chrome is interleaved with its rows, so the mark sits on a
  // divider or a header for part of every scroll. Clearing there would drop
  // EVERY card to the dimmed state for those frames — the whole list
  // flickering instead of one card being singled out.
  test('chrome keeps the last real row lit rather than clearing', () => {
    for (const i of [0, 1, 3]) expect(activeRowIdAt(rows, i, 'a')).toBe('a');
  });

  test('past-zone placeholders count as chrome too', () => {
    const withGhost = [{ id: 'ghost', __placeholder: true }];
    expect(activeRowIdAt(withGhost, 0, 'a')).toBe('a');
  });

  test('off the end of the list changes nothing', () => {
    expect(activeRowIdAt(rows, 99, 'b')).toBe('b');
    expect(activeRowIdAt([], 0, 'b')).toBe('b');
    expect(activeRowIdAt(undefined, 0, 'b')).toBe('b');
  });

  test('with nothing lit yet, chrome still lights nothing', () => {
    expect(activeRowIdAt(rows, 0, null)).toBeNull();
  });
});

describe('splitDay / splitTime', () => {
  test('the month leads and the day-number qualifies it', () => {
    expect(splitDay('Sep 28')).toEqual({ lead: 'Sep', tail: '28' });
    expect(splitDay('Sep 28, 2027')).toEqual({ lead: 'Sep', tail: '28, 2027' });
  });

  test('the hour leads and the meridiem qualifies it', () => {
    expect(splitTime('9 PM')).toEqual({ lead: '9', tail: 'PM' });
    expect(splitTime('12:30 AM')).toEqual({ lead: '12:30', tail: 'AM' });
  });

  // The common cases worth getting right: a relative day has no qualifier and
  // a 24-hour clock has no meridiem. Both must degrade to lead-only rather
  // than inventing an empty second span.
  test('a reading with nothing to qualify comes back lead-only', () => {
    expect(splitDay('Today')).toEqual({ lead: 'Today', tail: '' });
    expect(splitTime('21:00')).toEqual({ lead: '21:00', tail: '' });
  });

  test('nothing at all is not "undefined"', () => {
    expect(splitDay(null)).toEqual({ lead: '', tail: '' });
    expect(splitTime(undefined)).toEqual({ lead: '', tail: '' });
  });
});

// The readout prints the two parts on their own lines, so the parts are what
// the pointer actually consumes; the joined string survives only as the value
// the scroll handler compares frame to frame.
describe('pointerParts', () => {
  const dateLabel = (k) => ({ '2026-09-28': 'Today', '2026-10-06': 'Oct 6' }[k] || k);
  const clock = (mins) => `${(Math.floor(mins / 60) % 12) || 12}${mins % 60 ? `:${String(mins % 60).padStart(2, '0')}` : ''} ${mins >= 720 ? 'PM' : 'AM'}`;

  test('the day and the hour come back separately', () => {
    const row = { dueDate: '2026-09-28', time: '21:00' };
    expect(pointerParts(row, '2026-09-28', dateLabel, clock))
      .toEqual({ day: 'Today', time: '9 PM', kind: 'clock' });
  });

  test('an untimed row reports no hour rather than an empty one', () => {
    expect(pointerParts({ dueDate: '2026-10-06' }, '2026-10-06', dateLabel, clock))
      .toEqual({ day: 'Oct 6', time: null, kind: 'clock' });
    expect(pointerParts({ __gap: true }, '2026-10-06', dateLabel, clock))
      .toEqual({ day: 'Oct 6', time: null, kind: 'clock' });
  });

  // ── An event says WHAT it is where a task says WHEN ───────────────────────
  // It has a date but no hour worth reporting, so the second line would sit
  // empty. It names the kind instead — and `kind: 'event'` is what tells the
  // readout to set that line entirely light, since there is no hour to lead
  // with and bolding half of "Event" would read as a bug.
  test('an event names its kind on the second line', () => {
    const isEvent = (it) => it?.type === 'event';
    expect(pointerParts({ type: 'event', dueDate: '2026-10-06' }, '2026-10-06', dateLabel, clock, isEvent))
      .toEqual({ day: 'Oct 6', time: 'Event', kind: 'event' });
  });

  test('an event beats the clock even when it happens to carry a time', () => {
    const isEvent = () => true;
    const p = pointerParts({ dueDate: '2026-09-28', time: '21:00' }, '2026-09-28', dateLabel, clock, isEvent);
    expect(p).toEqual({ day: 'Today', time: 'Event', kind: 'event' });
  });

  // The predicate is optional — every caller that had no notion of events
  // before must keep working exactly as it did.
  test('with no event predicate, everything reads as a clock', () => {
    expect(pointerParts({ type: 'event', dueDate: '2026-10-06' }, '2026-10-06', dateLabel, clock).kind)
      .toBe('clock');
  });

  test('no day → nothing to print', () => {
    expect(pointerParts({ dueDate: '2026-10-06' }, null, dateLabel, clock)).toBeNull();
  });

  // The two must never disagree about what the reading IS — the string is
  // derived from the parts precisely so a rule can't be fixed in one and
  // missed in the other.
  test('the joined string is exactly the parts, joined', () => {
    for (const [row, key] of [
      [{ dueDate: '2026-09-28', time: '21:00' }, '2026-09-28'],
      [{ dueDate: '2026-10-06' }, '2026-10-06'],
      [{ dueDate: '2026-10-06', time: 'lunchtime' }, '2026-10-06'],
    ]) {
      const p = pointerParts(row, key, dateLabel, clock);
      const expected = p.time ? `${p.day} · ${p.time}` : p.day;
      expect(pointerLabel(row, key, dateLabel, clock)).toBe(expected);
    }
  });
});

// ── The space the mark is measured in ───────────────────────────────────────
// This term is why the agenda shipped broken twice. FlashList hands its layout
// manager `scrollOffset - firstItemOffset`, so every getLayout().y is relative
// to the FIRST CHILD, not to the scroll origin. With no top padding the two
// spaces coincide — which is exactly why the omission went unnoticed for the
// whole life of the pointer, and surfaced the moment the agenda grew a lead-in
// above its first card.
describe('markContentY', () => {
  test('with no padding, it is just the scroll offset plus the mark', () => {
    expect(markContentY(0, 220)).toBe(220);
    expect(markContentY(1000, 220, 0)).toBe(1220);
  });

  // The sign is the whole test. Adding instead of subtracting — or dropping
  // the term — puts every reading a padding's worth DOWN the timeline: the
  // wrong card lit, and any distance-to-a-card measured to the wrong card.
  test('the content padding comes OFF, not on', () => {
    expect(markContentY(0, 220, 140)).toBe(80);
    expect(markContentY(1000, 220, 140)).toBe(1080);
    expect(markContentY(0, 220, 140)).toBeLessThan(markContentY(0, 220, 0));
  });

  // Scrolled to the very top with a lead-in, the mark is genuinely above the
  // first item — the caller must cope with a negative y rather than be handed
  // a clamped lie about which row it is on.
  test('above the first item it reports a negative y, not zero', () => {
    expect(markContentY(0, 100, 140)).toBe(-40);
  });

  // The round trip the settle depends on: a layout y turned into the scroll
  // offset that puts it on the mark, and back again.
  test('it inverts to the offset that puts a given y on the mark', () => {
    const [pointerTop, lead, layoutY] = [220, 140, 900];
    const offset = layoutY + lead - pointerTop; // what scrollToOffset is given
    expect(markContentY(offset, pointerTop, lead)).toBe(layoutY);
  });
});

// ── The magnet ──────────────────────────────────────────────────────────────
// Card centres attract the mark — or rather, the cards slide to it. The
// arithmetic runs on every scroll frame, so like the readout's it lives here
// as pure functions rather than inside the scroll handler.
describe('isCardItem', () => {
  test('a row is a card; every piece of chrome is not', () => {
    expect(isCardItem({ id: 't1', dueDate: '2026-10-06' })).toBe(true);
    for (const flag of ['__agendaHeader', '__gap', '__addCard', '__divider', '__placeholder']) {
      expect(isCardItem({ id: 'x', [flag]: true })).toBe(false);
    }
    expect(isCardItem(null)).toBe(false);
  });
});

describe('nearestCardCenter', () => {
  // Header, divider, then three rows — the agenda's real shape.
  const items = [
    { __agendaHeader: 'past' },
    { __divider: true, dateKey: '2026-10-06' },
    { id: 'a' }, { id: 'b' }, { id: 'c' },
  ];
  // Cells 100 tall after 86 of chrome, each carrying a 12pt gap below its
  // card: centres at 130, 230, 330.
  const getLayout = stack([40, 46, 100, 100, 100]);

  test('the centre it finds is the CARD\'s, not the cell\'s', () => {
    const near = nearestCardCenter(items, 0, 4, getLayout, 132, 12);
    expect(near.index).toBe(2);
    // 86 (chrome) + (100 − 12)/2 — half a gap higher than the cell's midpoint,
    // which is exactly the error that would otherwise run through every row.
    expect(near.center).toBe(130);
  });

  test('chrome never attracts, however close the mark is to it', () => {
    // Sitting squarely on the date divider: the nearest CARD still wins.
    expect(nearestCardCenter(items, 0, 4, getLayout, 60, 12).index).toBe(2);
  });

  test('it picks the nearest centre either side of the mark', () => {
    expect(nearestCardCenter(items, 0, 4, getLayout, 170, 12).index).toBe(2);
    expect(nearestCardCenter(items, 0, 4, getLayout, 200, 12).index).toBe(3);
    expect(nearestCardCenter(items, 0, 4, getLayout, 400, 12).index).toBe(4);
  });

  test('no cards in view → nothing to be attracted to', () => {
    expect(nearestCardCenter(items, 0, 1, getLayout, 40, 12)).toBeNull();
  });

  test('a layout the list cannot answer for is skipped, not thrown', () => {
    const angry = (i) => { if (i === 2) throw new Error('recycled'); return getLayout(i); };
    expect(nearestCardCenter(items, 0, 4, angry, 132, 12).index).toBe(3);
  });
});

describe('magnetPull', () => {
  const RANGE = 50;
  const STRENGTH = 0.32;
  const MAX = 5;
  const pull = (d) => magnetPull(d, RANGE, STRENGTH, MAX);

  // The two ends are what make it feel like weight rather than a snap — and
  // the far one is load-bearing beyond feel: the lean must be nil exactly
  // where which-card-is-nearest changes hands, because that is also where
  // which-card-the-mark-is-on is ambiguous. The readout ignores the lean on
  // the strength of this.
  test('nothing at the centre, and nothing a whole range away', () => {
    expect(pull(0)).toBe(0);
    expect(pull(RANGE)).toBe(0);
    expect(pull(-RANGE)).toBe(0);
    expect(pull(RANGE + 20)).toBe(0);
  });

  test('it fades to nothing smoothly, not at a corner', () => {
    const near = pull(RANGE - 1);
    expect(Math.abs(near)).toBeLessThan(0.05);
    expect(Math.abs(near)).toBeGreaterThan(0);
  });

  test('it leans TOWARD the centre, whichever side that is', () => {
    expect(pull(20)).toBeGreaterThan(0);  // centre below the mark → cards come up
    expect(pull(-20)).toBeLessThan(0);
    expect(pull(-20)).toBe(-pull(20));    // symmetric, so passing feels the same
  });

  // "Very weak" is the whole brief. At the tuned strength the lean peaks
  // around 4pt of the 5 it is allowed — the clamp is a guard, not the thing
  // you feel.
  test('it stays weak: the clamp is never what limits it', () => {
    let peak = 0;
    for (let d = -RANGE; d <= RANGE; d += 0.5) peak = Math.max(peak, Math.abs(pull(d)));
    expect(peak).toBeGreaterThan(3);
    expect(peak).toBeLessThan(MAX);
  });

  test('the clamp still holds if it is ever tuned harder', () => {
    expect(magnetPull(40, 100, 5, MAX)).toBe(MAX);
    expect(magnetPull(-40, 100, 5, MAX)).toBe(-MAX);
  });

  test('a degenerate range pulls nothing rather than dividing by zero', () => {
    expect(magnetPull(10, 0, STRENGTH, MAX)).toBe(0);
    expect(magnetPull(NaN, RANGE, STRENGTH, MAX)).toBe(0);
  });
});

// ── How far from today ──────────────────────────────────────────────────────
// The word that annotates the reading. Every value has to survive the ~64pt of
// text the margin allows, on ONE line — this column is where "Yesterday" set at
// the reading's own size wrapped and left its "y" behind.
describe('dayOffsetLabel', () => {
  test('the three days that have names, have them', () => {
    expect(dayOffsetLabel(0)).toBe('today');
    expect(dayOffsetLabel(1)).toBe('tomorrow');
    expect(dayOffsetLabel(-1)).toBe('yesterday');
  });

  test('ahead of today reads forward, behind it reads back', () => {
    expect(dayOffsetLabel(10)).toBe('in 10d');
    expect(dayOffsetLabel(2)).toBe('in 2d');
    expect(dayOffsetLabel(-10)).toBe('10d ago');
    expect(dayOffsetLabel(-2)).toBe('2d ago');
  });

  // A past day states a POSITIVE number of days ago — "-10d ago" would be a
  // double negative, and the minus is already carried by the word "ago" (and
  // by the word sitting below the reading rather than above it).
  test('a past offset never prints its own minus sign', () => {
    for (const d of [-1, -2, -30, -400]) expect(dayOffsetLabel(d)).not.toMatch(/-/);
  });

  // The fit budget. Anything longer than "yesterday" has to be justified
  // against ~64pt of column, so this pins the ceiling rather than trusting it.
  test('nothing it can say is longer than "yesterday"', () => {
    const longest = 'yesterday'.length;
    for (const d of [0, 1, -1, 2, -2, 9, -9, 10, -10, 99, -99, 365, -365]) {
      expect(dayOffsetLabel(d).length).toBeLessThanOrEqual(longest);
    }
  });

  test('a non-day is no word at all, rather than "NaNd ago"', () => {
    expect(dayOffsetLabel(null)).toBeNull();
    expect(dayOffsetLabel(undefined)).toBeNull();
    expect(dayOffsetLabel(NaN)).toBeNull();
  });

  test('a fractional day rounds to one, rather than printing a decimal', () => {
    expect(dayOffsetLabel(2.4)).toBe('in 2d');
    expect(dayOffsetLabel(-2.6)).toBe('3d ago');
  });
});
