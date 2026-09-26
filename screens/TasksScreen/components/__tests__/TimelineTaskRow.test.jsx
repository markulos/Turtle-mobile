import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { TimelineTaskRow } from '../TimelineTaskRow';
import { insetCardPalette } from '../../utils/cardPalette';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../../../context/ThemeContext', () => ({
  useTheme: () => ({
    timeFormat: '12h',
    theme: {
      mode: 'light',
      colors: {
        // The page colour — the pre-band inks these rows used to be given.
        background: '#FFFFFF',
        textPrimary: '#111827',
        textSecondary: '#64748B',
        textTertiary: '#94A3B8',
        surfaceElevated: '#FFFFFF',
        border: '#CBD5E1',
      },
    },
  }),
}));
jest.mock('../../../../utils/haptics', () => ({ tapHaptic: jest.fn() }));

describe('TimelineTaskRow', () => {
  test('renders shared owner identity and opens that owner profile', async () => {
    const item = {
      id: 'shared-1',
      title: 'Shared task',
      userId: 'user-alex',
      ownerName: 'Alex',
      dueDate: '2026-07-29',
    };
    const onOwnerPress = jest.fn();
    const view = await render(
      <TimelineTaskRow
        item={item}
        hideCountdown
        owner={{ name: 'Alex', color: '#7C3AED' }}
        onOwnerPress={onOwnerPress}
      />,
    );

    const ownerButton = view.getByLabelText('Owner: Alex. Open profile');
    expect(view.getByText('A')).toBeTruthy();

    await fireEvent.press(ownerButton);

    expect(onOwnerPress).toHaveBeenCalledWith(item);
  });
});

// ── The timeline: one thread, one black margin beside it ───────────────────
// The agenda's left edge is drawn by TWO files — this row, and the date
// dividers in TasksScreen/index.jsx — and they have to agree on one x or the
// screen shows two parallel lines. That is not hypothetical: it shipped,
// because an absolutely-positioned child's `left` is measured from the
// parent's BORDER box (padding NOT added) and the two sides used different
// numbers meaning to reach the same place.
describe('TimelineTaskRow timeline', () => {
  const { RAIL_ABS_X, RAIL_W, threadColor } = require('../TimelineTaskRow');
  const flat = (s) => (Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean)) : (s || {}));
  const timed = { id: 'a', title: 'Youth group', dueDate: '2026-09-25', time: '20:30' };

  test('the margin HOLDS the whole time, not a truncation of it', async () => {
    // "08:30 PM" beside a bead used to render as "08:30…" — the column was
    // sized for a label sitting next to a marker, not for one printed in it.
    const view = await render(<TimelineTaskRow item={timed} hideCountdown />);
    const label = view.getByText('8:30 PM');
    expect(label.props.numberOfLines).toBe(1);
  });

  test('an untimed row still says something in the margin', async () => {
    // "even the open ones" — a blank in the column would read as a hole in it.
    const view = await render(<TimelineTaskRow item={{ id: 'b', title: 'Someday' }} hideCountdown />);
    expect(view.getByText('—')).toBeTruthy();
  });

  // A clock face writes "9 PM". The leading zero was padding to keep hugging
  // pills the same width; the times are flush-left on the band now, so it
  // bought nothing and just read as a timestamp rather than a time.
  test('a single-digit hour drops its leading zero', async () => {
    const view = await render(
      <TimelineTaskRow item={{ id: 'c', title: 'Liturgy', dueDate: '2026-09-28', time: '21:00' }} hideCountdown />,
    );
    expect(view.getByText('9 PM')).toBeTruthy();
    expect(view.queryByText('09 PM')).toBeNull();
  });

  // The reading is set LARGER than the ticks it stands in for. They are not in
  // competition: the ticks fade almost out while a scrub is in flight (see
  // `scrubFade`), so the reading has the margin to itself and does not have to
  // live inside their column. What must NOT happen is two sizes that are
  // merely close — that reads as a mistake rather than a distinction.
  test('the reading is set larger than the ticks it stands in for', async () => {
    const { TimelinePointer, MARGIN_FONT_SIZE, READOUT_FONT_SIZE } = require('../TimelineTaskRow');
    const row = await render(<TimelineTaskRow item={timed} hideCountdown />);
    const pointer = await render(
      <TimelinePointer theme={{ mode: 'light', colors: { background: '#FFF' } }} label="Today" top={140} />,
    );
    expect(flat(row.getByText('8:30 PM').props.style).fontSize).toBe(MARGIN_FONT_SIZE);
    // The readout's LINE carries the size; its spans carry only the weight.
    expect(flat(pointer.getByTestId('pointer-day').props.style).fontSize).toBe(READOUT_FONT_SIZE);
    expect(READOUT_FONT_SIZE - MARGIN_FONT_SIZE).toBeGreaterThanOrEqual(2);
  });

  // Bigger than it was — and the column has to still hold the widest label it
  // can be asked to print. TIME_COL was already widened once for exactly this
  // reason (62 truncated "08:30 PM"); growing the face reopens that question.
  test('the widest time still fits the column at the larger size', async () => {
    const { MARGIN_FONT_SIZE } = require('../TimelineTaskRow');
    const view = await render(
      <TimelineTaskRow item={{ id: 'w', title: 'Vigil', dueDate: '2026-09-25', time: '12:30' }} hideCountdown />,
    );
    const label = view.getByText('12:30 PM');
    expect(label.props.numberOfLines).toBe(1); // still one line, not wrapped
    // A generous upper bound on a bold tabular-nums advance; "12:30 PM" is the
    // longest the formatter emits.
    expect('12:30 PM'.length * MARGIN_FONT_SIZE * 0.62).toBeLessThan(74);
  });

  // ── The margin, not a string of beads ─────────────────────────────────────
  // The times used to ride in filled pills. They print straight on the black
  // gutter now: no shape of their own, every label starting on the same x.
  test('the time is printed, not bubbled', async () => {
    const view = await render(<TimelineTaskRow item={timed} hideCountdown railColor="#000" />);
    const label = view.getByText('8:30 PM');
    const st = flat(label.props.style);
    expect(st.textAlign).toBe('left');
    // No pill anywhere: nothing in the row is a 22-high rounded fill that is
    // WIDER than it is tall. (The completion ring is 22×22 — a circle, not a
    // pill — so the width test is what tells the two apart.)
    const pills = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      const s = flat(node.props?.style);
      if (s.height === 22 && s.borderRadius === 11 && s.width > 22) pills.push(s);
      (node.children || []).forEach(walk);
    };
    walk(view.toJSON());
    expect(pills).toHaveLength(0);
  });

  // Flush left, every row, whatever the label — that's what makes the column
  // read as a margin. The box is the full time column so short labels ("—")
  // don't re-centre themselves.
  const timeBox = (view) => {
    let box = null;
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      const st = flat(node.props?.style);
      if (!box && st.height === 22 && st.width === 74) box = st;
      (node.children || []).forEach(walk);
    };
    walk(view.toJSON());
    return box;
  };

  test('every time starts on the same x, whatever its label', async () => {
    const items = [
      timed,                                                        // "8:30 PM"
      { id: 'c', title: 'Liturgy', dueDate: '2026-09-28', time: '21:00' },  // "9 PM"
      { id: 'b', title: 'Someday' },                                 // "—"
      { id: 'e', title: 'Birthday', itemType: 'event', dueDate: '2026-10-06' }, // "Event"
    ];
    for (const item of items) {
      const view = await render(<TimelineTaskRow item={item} hideCountdown railColor="#000" />);
      const box = timeBox(view);
      expect(box).toBeTruthy();
      expect(box.alignItems).toBe('flex-start');
      expect(box.width).toBe(74); // the whole time column, so nothing re-centres
    }
  });

  // The band is dark in BOTH modes (black on the light page, a near-black lift
  // on the dark one), so the time is white in both — not the theme's ink.
  test('the gutter is dark on either page, and the time white on it', () => {
    const { gutterColors, gutterInk, GUTTER_STOPS } = require('../TimelineTaskRow');
    // Dark GREY, not black. Pure black on a white page is the harshest edge
    // the screen can draw and read as a slab cut out of the page; the grey
    // carries the same weight without the violence.
    expect(gutterColors({ mode: 'light' })[0]).not.toBe('#000000');
    for (const mode of ['light', 'dark']) {
      const cols = gutterColors({ mode });
      expect(cols).toHaveLength(GUTTER_STOPS.length);
    }
    expect(GUTTER_STOPS[GUTTER_STOPS.length - 1]).toBe(1);
    expect(gutterInk(false)).toBe('#FFFFFF');
    expect(gutterInk(true)).not.toBe(gutterInk(false)); // finished rows dim
  });

  // ── The ticks are lit, not printed ────────────────────────────────────────
  // A breath of light around each time on the band. Subtle by construction: no
  // offset (a glow, never a drop shadow) and an alpha low enough that it reads
  // as brightness rather than as a halo you can point at.
  test('a time on the band carries a subtle glow', async () => {
    const view = await render(<TimelineTaskRow item={timed} hideCountdown />);
    const st = flat(view.getByText('8:30 PM').props.style);
    expect(st.textShadowRadius).toBeGreaterThan(0);
    expect(st.textShadowOffset).toEqual({ width: 0, height: 0 }); // glow, not shadow
    // Low enough to stay a suggestion. Past ~0.5 it becomes a visible halo.
    const a = Number(st.textShadowColor.match(/[\d.]+\)$/)[0].slice(0, -1));
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(0.5);
  });

  test('a finished row stops giving off light', async () => {
    const { gutterGlow } = require('../TimelineTaskRow');
    // In step with its dimmer ink — a done thing goes quiet in both.
    expect(gutterGlow(true).textShadowRadius).toBeLessThan(gutterGlow(false).textShadowRadius);
  });

  // A SHEEN, not a fade. The band used to end fully transparent, which washed
  // out the last third of the column and left it visibly short of the thread.
  test('the gutter stays an opaque dark grey across its whole width', () => {
    const { gutterColors } = require('../TimelineTaskRow');
    // Light page: every stop opaque, and every stop still black — the lift
    // between the darkest and lightest is a sheen, not a change of colour.
    const light = gutterColors({ mode: 'light' });
    const lum = (hex) => [1, 3, 5].reduce((a, i) => a + parseInt(hex.slice(i, i + 2), 16), 0) / 3;
    // EVERY stop opaque — including the last. A feathered, semi-transparent
    // edge cannot match the notch, whose cut is opaque by nature (it is a
    // hole), so the two read as different materials meeting along one edge.
    for (const col of light) {
      expect(col).toMatch(/^#[0-9A-Fa-f]{6}$/);
      // Dark grey: unmistakably dark, but off the floor. Pure black (0) is the
      // harshness this replaced; anything past ~70 stops reading as a margin.
      expect(lum(col)).toBeGreaterThan(20);
      expect(lum(col)).toBeLessThan(70);
    }
    expect(lum(light[light.length - 1])).toBeGreaterThan(lum(light[0])); // lifts toward the line
    // Dark page: a lift rather than black-on-black, but never reaching zero —
    // a transparent stop there is the same washed-out end, just inverted.
    for (const col of gutterColors({ mode: 'dark' })) {
      expect(Number(col.match(/([\d.]+)\)$/)[1])).toBeGreaterThan(0);
    }
  });

  // Flush: the band stops at the line's LEFT edge, so the two touch with
  // nothing between them. RAIL_ABS_X is the line's CENTRE — using it verbatim
  // would run the band half a point UNDER the line.
  test('the gutter runs flush to the line, not under it and not short of it', () => {
    const { GUTTER_W } = require('../TimelineTaskRow');
    expect(GUTTER_W).toBe(RAIL_ABS_X - RAIL_W / 2);
    expect(GUTTER_W + RAIL_W / 2).toBe(RAIL_ABS_X); // its edge IS the line's edge
  });

  // Every absolutely-positioned hairline-wide child — the thread itself.
  const threads = (view) => {
    const found = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      const st = flat(node.props?.style);
      if (st.position === 'absolute' && st.width === RAIL_W && typeof st.left === 'number') found.push(st);
      (node.children || []).forEach(walk);
    };
    walk(view.toJSON());
    return found;
  };

  // ── The thread belongs to the GUTTER, not to the rows ────────────────────
  // It used to be drawn per row, top to just past bottom, so consecutive rows
  // joined invisibly. But only rows drew it: it broke at every band header and
  // at the add-task template, and stopped at the last row instead of running
  // to the bottom of the screen. One piece behind the list cannot break.
  const { TimelineGutter } = require('../TimelineTaskRow');
  const gutterThreads = () => {
    const el = TimelineGutter({ theme: { mode: 'light', colors: { background: '#FFF' } } });
    const found = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      const st = flat(node.props?.style);
      if (st.width === RAIL_W && typeof st.left === 'number') found.push(st);
      React.Children.toArray(node.props?.children || []).forEach(walk);
    };
    walk(el);
    return found;
  };

  // INSIDE the band, occupying its last RAIL_W. Sitting just outside it — on
  // the page — only ever worked on the dark page, where the page is black and
  // a white line shows against it. On the light page the line went
  // white-on-white the instant it left the band.
  test('the thread rides the band\'s inner edge, not the page beyond it', () => {
    const { THREAD_LEFT, THREAD_CX, GUTTER_W } = require('../TimelineTaskRow');
    const found = gutterThreads();
    expect(found.length).toBe(1); // exactly one line, drawn once
    expect(found[0].left).toBe(THREAD_LEFT);
    expect(found[0].left + found[0].width / 2).toBe(THREAD_CX);
    // Its right edge lands exactly on the band's, so the band ends with it.
    expect(THREAD_LEFT + RAIL_W).toBe(GUTTER_W);
    expect(THREAD_LEFT).toBeGreaterThan(0); // …and it is on the band, not off it
  });

  // ── The gap the swerve fills ─────────────────────────────────────────────
  // Given a notch position the gutter draws the line in TWO pieces, leaving a
  // window exactly NOTCH_SPAN tall. The pointer's path covers that window —
  // including its own straight run at each end — so the three butt together on
  // one x rather than having to meet a curve exactly.
  //
  // Exactly the swerve, with nothing to spare: the mark does not move, so this
  // window never has to accommodate anything but the curve itself.
  test('the gutter opens a window for the swerve, the size of the swerve', () => {
    const { TimelineGutter: G, NOTCH_SPAN: WIN } = require('../TimelineTaskRow');
    const el = G({ theme: { mode: 'light', colors: { background: '#FFF' } }, notchTop: 200 });
    const segs = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      const st = flat(node.props?.style);
      if (st.width === RAIL_W && typeof st.left === 'number') segs.push(st);
      React.Children.toArray(node.props?.children || []).forEach(walk);
    };
    walk(el);
    expect(segs).toHaveLength(2); // above the window, and below it
    const above = segs.find((s) => s.top === 0);
    const below = segs.find((s) => s.top !== 0);
    expect(above.height).toBe(200 - WIN / 2); // stops at the window's head
    expect(below.top).toBe(200 + WIN / 2); // resumes at its foot
    expect(below.bottom).toBe(0); // …and runs on to the end
    expect(below.top - (above.top + above.height)).toBe(WIN); // the window itself
  });

  // Before the list is measured there is no pointer to bridge a gap, so the
  // line must stay whole rather than being left open with nothing in it.
  test('with no notch to place, the line stays in one piece', () => {
    expect(gutterThreads()).toHaveLength(1);
  });

  // It runs the FULL height of the list, not a row's worth of it.
  test('the thread runs unbroken from top to bottom', () => {
    const [line] = gutterThreads();
    expect(line.top).toBe(0);
    expect(line.bottom).toBe(0);
    expect(line.height).toBeUndefined(); // stretched, never a fixed run
  });

  // Stacking is the reason the rows had to stop drawing it: the thread is a
  // 60%-alpha line, so two of them composite to ~84% and every row would wear
  // a darker line than the gaps between them.
  test('a row draws no thread of its own to stack on it', async () => {
    const view = await render(<TimelineTaskRow item={timed} hideCountdown railColor="#000" />);
    expect(threads(view)).toHaveLength(0);
  });

  // One line, one colour. The rows used to draw the caller's strong ink at 45%
  // opacity while the dividers drew it at full strength, so the timeline
  // darkened at every date heading.
  // WHITE on both pages — NOT the usual inversion, and deliberate. The line
  // lives on the BAND, and the band is dark in both modes, so the ink that
  // reads against it is the same ink in both. Exactly like `gutterInk`.
  //
  // It used to invert to black on the light page. That held for the straight
  // run only because the line sat outside the band on white — and it broke the
  // moment the notch swerved INTO the band, where a dark line on a dark band
  // is no line at all: light mode showed a straight line with a hole where the
  // mark should be, while dark mode looked right.
  test('the thread is white on BOTH pages, because the band is dark on both', () => {
    for (const mode of ['light', 'dark']) {
      expect(threadColor({ mode })).toMatch(/^rgba\(255,255,255,/);
    }
    const [line] = gutterThreads();
    expect(line.backgroundColor).toBe(threadColor({ mode: 'light' }));
    // The colour carries the fade; a second opacity would compound it.
    expect(line.opacity).toBeUndefined();
    // A little stronger on the light page, whose band is the lighter of the
    // two — the same alpha would read fainter there.
    const alpha = (m) => Number(threadColor({ mode: m }).match(/[\d.]+\)$/)[0].slice(0, -1));
    expect(alpha('light')).toBeGreaterThan(alpha('dark'));
  });

  test('and it is 1pt wide, not a 2pt rule', () => {
    expect(RAIL_W).toBe(1);
    expect(RAIL_W).toBeGreaterThan(StyleSheet.hairlineWidth);
    expect(gutterThreads()).toHaveLength(1);
  });

  test('the time keeps the band\'s ink — only the line is faint', async () => {
    const view = await render(<TimelineTaskRow item={timed} hideCountdown railColor="#000" />);
    // White on the black band, and NOT the caller's railColor: the band is
    // dark on either page, so the time is white on either page.
    const label = view.getByText('8:30 PM');
    expect(flat(label.props.style).color).toBe('#FFFFFF');
  });

  // The line is a BOUNDARY: times on its left, cards on its right. It used to
  // run through the middle of the time column, which put it inside the times.
  test('the thread runs between the times and the cards, touching neither', async () => {
    const ROW_PAD = 14;
    const TIME_COL = 74;
    const CARD_GAP = 12;
    // Clear of the time column's right edge…
    expect(RAIL_ABS_X).toBeGreaterThan(ROW_PAD + TIME_COL);
    // …and clear of the card's left edge.
    expect(RAIL_ABS_X).toBeLessThan(ROW_PAD + TIME_COL + CARD_GAP);
  });

  test('tapping the time asks to reschedule THAT row', async () => {
    const onPressTime = jest.fn();
    const view = await render(
      <TimelineTaskRow item={timed} hideCountdown onPressTime={onPressTime} />,
    );
    await fireEvent.press(view.getByLabelText('Change time'));
    expect(onPressTime).toHaveBeenCalledWith(timed);
  });

  // An undated row is the one that needs BOTH halves, and its margin should
  // say so rather than offering a time for a day that doesn't exist yet.
  test('an undated row offers date-and-time, not just a time', async () => {
    const onPressTime = jest.fn();
    const view = await render(
      <TimelineTaskRow item={{ id: 'b', title: 'Someday' }} hideCountdown onPressTime={onPressTime} />,
    );
    await fireEvent.press(view.getByLabelText('Set date and time'));
    expect(onPressTime).toHaveBeenCalled();
  });

  test('without a handler the time is inert, not a dead button', async () => {
    const view = await render(<TimelineTaskRow item={timed} hideCountdown />);
    expect(view.queryByLabelText('Change time')).toBeNull();
  });

  // An event is a thing that's ON a day, not one you do AT a time — and the
  // hour it has (if any) is already on the card's when-line.
  test('an event names itself in the margin instead of showing a clock', async () => {
    const view = await render(
      <TimelineTaskRow
        item={{ id: 'e', title: 'Michiee birthday', itemType: 'event', dueDate: '2026-10-06', time: '20:30' }}
        hideCountdown
      />,
    );
    // Exactly once: the kind used to ALSO be the card's subtitle, which put
    // "Event" on the row twice the moment the margin started saying it.
    expect(view.getAllByText('Event')).toHaveLength(1);
    expect(view.queryByText('8:30 PM')).toBeNull();
    expect(view.getByText('No Board')).toBeTruthy();
  });

  test('a plain task with a time still shows the time', async () => {
    const view = await render(<TimelineTaskRow item={timed} hideCountdown />);
    expect(view.queryByText('Event')).toBeNull();
    expect(view.getByText('8:30 PM')).toBeTruthy();
  });

  test('a finished row dims its time, and the thread is untouched by it', async () => {
    const view = await render(<TimelineTaskRow item={timed} done hideCountdown railColor="#000" />);
    const label = view.getByText('8:30 PM');
    // Still in the margin, just no longer a thing that is waiting — a dimmer
    // white on the band, not the page's ink (which the band would swallow).
    expect(flat(label.props.style).color).toBe('rgba(255,255,255,0.45)');
    // The line is the gutter's, so completing a task cannot dim or break it.
    expect(threads(view)).toHaveLength(0);
    expect(gutterThreads()[0].backgroundColor).toBe(threadColor({ mode: 'light' }));
  });
});

// ── The row the mark is on ──────────────────────────────────────────────────
// While a scrub passes, the row under the mark states itself a little harder
// and the others settle back. The emphasis is a PROP (changes once per row you
// pass); the dimming is a SHARED animated value (costs no render per frame).
describe('the active row', () => {
  const flat = (s) => (Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean)) : (s || {}));
  const item = { id: 'a', title: 'Youth group', dueDate: '2026-09-25', time: '20:30' };

  test('its title states itself harder, without changing size', async () => {
    const off = await render(<TimelineTaskRow item={item} hideCountdown />);
    const on = await render(<TimelineTaskRow item={item} hideCountdown active />);
    const t = (v) => flat(v.getByText('Youth group').props.style);
    expect(Number(t(on).fontWeight)).toBeGreaterThan(Number(t(off).fontWeight));
    // Size must NOT move: a title that grew would reflow the card and shove
    // the rest of the list as you scrub past it.
    expect(t(on).fontSize).toBe(t(off).fontSize);
  });

  test('an inactive row rides the shared dim; the active one does not', async () => {
    const { scrubDim } = require('../TimelineTaskRow');
    const rootOpacity = (v) => flat(v.toJSON().props.style).opacity;
    // The rendered tree resolves animated values to plain numbers, so identity
    // comparison proves nothing. Drive the shared value to something distinct
    // instead: an inactive row must FOLLOW it, an active row must not.
    scrubDim.setValue(0.5);
    try {
      const off = await render(<TimelineTaskRow item={item} hideCountdown />);
      const on = await render(<TimelineTaskRow item={item} hideCountdown active />);
      expect(rootOpacity(off)).toBe(0.5); // tracks the shared dim
      expect(rootOpacity(on)).toBe(1); // pinned full, whatever the others do
    } finally {
      scrubDim.setValue(1); // a leaked 0.5 would dim every later render
    }
  });

  // ── The bug this replaced ────────────────────────────────────────────────
  // The row used to pick between the shared value and a literal
  // (`opacity: active ? 1 : scrubDim`). Every assertion above passed on that
  // code and it was still broken on the device: `scrubDim` runs on the NATIVE
  // driver, so mid-scrub the animation graph holds the row's opacity directly,
  // and a React commit of a literal 1 does not reliably take it back. The
  // marked row wore the same 0.8 as the rest.
  //
  // These two pin the shape that cannot fail that way: ONE node, with `active`
  // as an input rather than a branch.
  test('the exemption is arithmetic inside the graph, not a choice of node', () => {
    const { Animated } = require('react-native');
    const { rowDimNode, scrubDim } = require('../TimelineTaskRow');
    const lift = new Animated.Value(0);
    const opacity = rowDimNode(lift);
    scrubDim.setValue(0.5);
    try {
      expect(opacity.__getValue()).toBeCloseTo(0.5); // riding the dim
      lift.setValue(1);
      // EXACTLY full, computed where the driver already is — not committed
      // over the top of it.
      expect(opacity.__getValue()).toBeCloseTo(1);
      // And it crossfades, rather than there being two states and a jump.
      lift.setValue(0.5);
      expect(opacity.__getValue()).toBeCloseTo(0.75);
      // Full stays full however hard the rest settle back.
      lift.setValue(1);
      scrubDim.setValue(0.2);
      expect(opacity.__getValue()).toBeCloseTo(1);
    } finally {
      scrubDim.setValue(1);
    }
  });

  test('losing the mark eases off, so the flag never hard-swaps the opacity', async () => {
    const { scrubDim } = require('../TimelineTaskRow');
    const rootOpacity = (v) => flat(v.toJSON().props.style).opacity;
    scrubDim.setValue(0.5);
    try {
      const view = await render(<TimelineTaskRow item={item} hideCountdown active />);
      expect(rootOpacity(view)).toBe(1);
      // The mark moves on. The old code would read exactly 0.5 on this very
      // frame — the literal swapped out for the shared value in one commit.
      // It has to RAMP instead, which is both the nicer motion and the proof
      // that `active` is an input to the opacity rather than a branch over it.
      view.rerender(<TimelineTaskRow item={item} hideCountdown />);
      expect(rootOpacity(view)).toBeGreaterThan(0.5);
    } finally {
      scrubDim.setValue(1);
    }
  });

  // A still list shows NO emphasis: the shared value rests at 1, so nothing is
  // dimmed until a scrub actually starts.
  test('the dim rests wide open, so a still list looks untouched', () => {
    const { scrubDim, SCRUB_DIM_TO, setScrubbing } = require('../TimelineTaskRow');
    expect(scrubDim._value).toBe(1);
    // Enough separation to see which card the mark is on at a glance, while
    // the others stay perfectly readable — you are still scanning the list as
    // it moves. Below about 0.6 a moving list reads as a disabled one.
    expect(SCRUB_DIM_TO).toBeLessThan(1);
    expect(SCRUB_DIM_TO).toBeGreaterThanOrEqual(0.7);
    expect(() => { setScrubbing(true); setScrubbing(false); }).not.toThrow();
  });
});

// ── The pointer on the band's edge ──────────────────────────────────────────
describe('TimelinePointer', () => {
  const {
    TimelinePointer, GUTTER_W, RAIL_W, MARGIN_EDGE_X, NOTCH_EDGE_X, NOTCH_SPAN, NOTCH_DEPTH,
    NOTCH_TIP_R, NOTCH_FILLET_R, NOTCH_SHOULDER_Y, gutterEdgeColor, gutterColors, pageColor,
    OFFSET_GAP, OFFSET_LINE_H, READOUT_DAY_TOP, READOUT_FOOT, READOUT_LINE_H,
  } = require('../TimelineTaskRow');
  const flat = (s) => (Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean)) : (s || {}));
  const theme = { mode: 'light', colors: { background: '#FFFFFF' } };

  const boxes = (view) => {
    const found = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      found.push(flat(node.props?.style));
      (node.children || []).forEach(walk);
    };
    walk(view.toJSON());
    return found;
  };
  const { NOTCH_SVG_W, notchLineD, notchProfileD, threadColor } = require('../TimelineTaskRow');
  // Every <Path> in the tree, by its `d` and paint. The notch is SVG now, so
  // the geometry is asserted on the path data itself rather than on the
  // bounding boxes of three circular Views.
  const paths = (view) => {
    const found = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.props?.d) found.push(node.props);
      (node.children || []).forEach(walk);
    };
    walk(view.toJSON());
    return found;
  };
  // react-native-svg normalises colour props: a CSS string arrives at the host
  // component as {type, payload:<int>}, and fill="none" arrives as null. So
  // paints are compared THROUGH processColor rather than as strings.
  const { processColor } = require('react-native');
  const paint = (v) => (v && typeof v === 'object' && 'payload' in v ? v.payload : v);
  const isPaint = (v, css) => paint(v) === processColor(css);
  const tip = (view) => paths(view).find((p) => isPaint(p.fill, pageColor(theme)));
  // Pull the numbers back out of a path string, in order.
  const nums = (d) => (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);

  // ── The notch IS the line ────────────────────────────────────────────────
  // Not a bite out of the band. The thread runs straight, swerves in to a
  // point and carries on, in its own colour and width. Drawn as a
  // page-coloured FILL it could only work on one page — in dark mode the page
  // is near-black and the cut simply vanished — and a flat fill never matched
  // the page's gradient wash anyway, so every point it overran printed as a
  // pale block standing proud of the edge.
  test('the line is a stroke in the thread, never a filled shape', async () => {
    const view = await render(<TimelinePointer theme={theme} label="Today · 9 PM" top={140} />);
    const all = paths(view);
    expect(all.length).toBeGreaterThan(0);
    // The line itself wears the thread's exact colour and width, so it is
    // indistinguishable from the segments the gutter draws above and below.
    const line = all.find((p) => p.d === notchLineD());
    expect(line).toBeTruthy();
    expect(line.fill).toBeNull(); // the LINE is stroked, never filled
    expect(isPaint(line.stroke, threadColor(theme))).toBe(true);
    expect(line.strokeWidth).toBe(RAIL_W);
  });

  // ── What sits inside the swerve ──────────────────────────────────────────
  // Opaque white on the light page, where the bay is cut into a dark grey band
  // and a solid fill turns the mark from a hairline into a shape you can read
  // at a glance. Nothing on the dark page: there the band is barely lighter
  // than the page behind it, so a white wedge would read as a lamp rather than
  // a notch — which is why dark mode already looked right.
  test('the bay is filled opaque white on the light page only', async () => {
    const { notchFill, notchBayD } = require('../TimelineTaskRow');
    expect(notchFill({ mode: 'light' })).toBe('#FFFFFF');
    expect(notchFill({ mode: 'dark' })).toBeNull();

    const light = await render(<TimelinePointer theme={theme} label="Today" top={140} />);
    const bay = paths(light).find((p) => p.d === notchBayD());
    expect(bay).toBeTruthy();
    expect(isPaint(bay.fill, '#FFFFFF')).toBe(true);
    expect(bay.stroke).toBeFalsy(); // a fill, not a second outline

    const dark = await render(
      <TimelinePointer theme={{ mode: 'dark', colors: { background: '#000' } }} label="Today" top={140} />,
    );
    expect(paths(dark).some((p) => p.d === notchBayD())).toBe(false);
  });

  // The bay OVERSETS the band's edge by a point, so its white laps over the
  // panel's white and the two merge — the notch opens into the panel instead
  // of stopping at a boundary and starting again.
  test('the bay laps a point over the band\'s edge, and no more', () => {
    const { notchBayD, NOTCH_BAY_OVERSET, NOTCH_SVG_W: W } = require('../TimelineTaskRow');
    const d = notchBayD();
    expect(d.startsWith(notchProfileD())).toBe(true);
    expect(d.endsWith(' Z')).toBe(true);
    const lineX = nums(notchProfileD())[0];
    const bandEdge = lineX + RAIL_W / 2;
    // Every x in the closing edge is the same, and it is exactly the overset
    // past the band — not past the LINE, which would be half a point short.
    const closing = d.slice(notchProfileD().length).match(/L ([\d.]+) /g) || [];
    expect(closing).toHaveLength(2);
    for (const l of closing) {
      expect(Number(l.match(/[\d.]+/)[0])).toBeCloseTo(bandEdge + NOTCH_BAY_OVERSET, 6);
    }
    // A point blends; five printed a pale block, because the fill is flat
    // white while the page carries a faint wash.
    expect(NOTCH_BAY_OVERSET).toBeLessThanOrEqual(1.5);
    // …and it still fits the surface, so nothing is clipped mid-blend.
    expect(bandEdge + NOTCH_BAY_OVERSET).toBeLessThanOrEqual(W);
  });

  // The CURVE still never crosses the line — only the closing edge does. That
  // is what keeps the swerve safe to animate: however deep it is pushed, the
  // shape that moves stays on the band's side.
  test('the swerve itself stays on the band\'s side of the line', () => {
    const lineX = nums(notchProfileD())[0];
    const ends = nums(notchProfileD()).slice(-2);
    expect(ends[0]).toBe(lineX); // the profile returns to the line it left
    // No ENDPOINT on the curve is to the right of the line. Parsed as
    // endpoints rather than by scanning every number in the string: an arc
    // reads "A rx ry rot laf sf x y", so its radii (30, 30) would otherwise be
    // mistaken for a coordinate pair.
    const d = notchProfileD();
    const endpoints = [nums(d.match(/^M [\d.]+ [\d.]+/)[0])];
    for (const arc of d.match(/A [^A]+/g) || []) endpoints.push(nums(arc).slice(-2));
    for (const [x] of endpoints) expect(x).toBeLessThanOrEqual(lineX);
    // …and the deepest point of all is the tip, a full NOTCH_DEPTH in.
    expect(Math.min(...endpoints.map(([x]) => x))).toBeGreaterThanOrEqual(lineX - NOTCH_DEPTH);
  });

  // Centred ON the line, not beside it: the surface is positioned so its
  // internal LINE_X lands on RAIL_ABS_X. That is what makes the swerve read as
  // the line's own rather than as a mark parked next to it.
  test('the swerve is aligned on the line it belongs to', async () => {
    const view = await render(<TimelinePointer theme={theme} label="Today" top={140} />);
    const layer = boxes(view).find((s) => s.width === NOTCH_SVG_W && s.left !== undefined);
    expect(layer).toBeTruthy();
    // Straight runs sit at LINE_X inside the surface; that maps to the
    // thread's centre, so the swerve and the gutter's segments are one line.
    const { THREAD_CX } = require('../TimelineTaskRow');
    const lineX = nums(notchLineD())[0];
    expect(layer.left + lineX).toBe(THREAD_CX);
  });

  // It carries its own straight run at each end, so the three pieces of the
  // line butt together on the same x instead of having to meet a curve.
  test('the notch path begins and ends on the line, spanning its whole window', () => {
    const d = notchLineD();
    const n = nums(d);
    const lineX = n[0];
    expect(n[1]).toBe(0); // starts at the top of the window
    expect(d.trim().endsWith(`L ${lineX} ${NOTCH_SPAN}`)).toBe(true); // …and ends at its foot
  });

  // Pointed tip, smooth shoulders — the two things one circle can't do at
  // once, which is why the profile is three arcs.
  test('the tip is pointed and the shoulders are not', async () => {
    // A tip barely wider than the swerve is deep: that's a point, not a dome.
    expect(NOTCH_TIP_R).toBeLessThan(NOTCH_DEPTH * 2);
    // Shoulders an order of magnitude softer than the tip.
    expect(NOTCH_FILLET_R).toBeGreaterThan(NOTCH_TIP_R * 3);
    // Three arcs, fillet → tip → fillet, and the tip turns the OTHER way
    // (sweep 0 between two 1s). That alternation is what makes a point between
    // two smooth shoulders rather than one continuous bump. The flags read
    // 1/0/1 traced top-to-bottom; reversing a path flips every sweep.
    const d = notchProfileD();
    const arcs = d.match(/A \d+(\.\d+)? \d+(\.\d+)? 0 \d \d/g) || [];
    expect(arcs).toHaveLength(3);
    expect(arcs[0]).toContain(`A ${NOTCH_FILLET_R} ${NOTCH_FILLET_R} 0 0 1`);
    expect(arcs[1]).toContain(`A ${NOTCH_TIP_R} ${NOTCH_TIP_R} 0 0 0`);
    expect(arcs[2]).toContain(`A ${NOTCH_FILLET_R} ${NOTCH_FILLET_R} 0 0 1`);
  });

  // The join between each fillet and the tip has to be TANGENT, or the swerve
  // shows two creases where the arcs meet. Solved, not eyeballed — so the
  // check is that the join point really is on both circles at once.
  test('the three arcs meet tangentially, to floating-point', () => {
    const d = notchProfileD();
    const lineX = nums(d)[0]; // the profile opens on the line
    const seg = d.split(/A /).map((s) => s.trim());
    const join = nums(seg[1]).slice(-2); // [x, y] where the first fillet meets the tip
    const tipCx = lineX - NOTCH_DEPTH + NOTCH_TIP_R;
    const filletCx = lineX - NOTCH_FILLET_R;
    const cy = NOTCH_SPAN / 2;
    const dTip = Math.hypot(join[0] - tipCx, join[1] - cy);
    const dFil = Math.hypot(join[0] - filletCx, join[1] - (cy - NOTCH_SHOULDER_Y));
    expect(Math.abs(dTip - NOTCH_TIP_R)).toBeLessThan(0.01);
    expect(Math.abs(dFil - NOTCH_FILLET_R)).toBeLessThan(0.01);
  });

  // The highlight is the thread at full strength, NOT white. The line is dark
  // ink on the light page and light ink on the dark one, so a white "shine"
  // would wash it out in one mode and vanish in the other.
  test('the highlight is the thread with its fade taken off', async () => {
    const { notchRim } = require('../TimelineTaskRow');
    // White on both pages, for the same reason the thread is: what is behind
    // it is the band, and the band is dark in both.
    expect(notchRim({ mode: 'light' })).toBe('rgba(255,255,255,1)');
    expect(notchRim({ mode: 'dark' })).toBe('rgba(255,255,255,1)');
    const view = await render(<TimelinePointer theme={theme} label="Today" top={140} />);
    const rim = paths(view).find((p) => isPaint(p.stroke, notchRim(theme)));
    expect(rim).toBeTruthy();
    expect(rim.fill).toBeNull();
    // Only the CURVE is brightened — a brighter straight run would show as a
    // seam where it meets the gutter's own segments.
    expect(rim.d).toBe(notchProfileD());
    expect(rim.d).not.toBe(notchLineD());
  });

  // Tangency is the whole game: solved, not eyeballed. Each fillet must sit
  // exactly R_f from the straight edge (touching it) AND exactly R_tip + R_f
  // from the tip's centre (touching that too).
  test('the shoulders are tangent to both the edge and the tip', () => {
    const Rt = NOTCH_TIP_R;
    const Rf = NOTCH_FILLET_R;
    // Edge at x = 0, band to the left. Tip's apex at -depth, so its centre:
    const tipCx = -NOTCH_DEPTH + Rt;
    // A fillet tangent to the edge from the band side has its centre here:
    const filletCx = -Rf;
    const d = Math.hypot(filletCx - tipCx, NOTCH_SHOULDER_Y);
    expect(d).toBeCloseTo(Rt + Rf, 6); // …and tangent to the tip
    // The dip is therefore this tall, and it has to fit the clip window.
    expect(NOTCH_SHOULDER_Y * 2).toBeGreaterThan(30);
    expect(NOTCH_SHOULDER_Y * 2).toBeLessThan(NOTCH_SPAN);
  });

  // The fillets wear the band's EDGE colour, not its start colour — the band
  // is a gradient, and matching the wrong end would paint a visible slab.
  test('the shoulders match the edge they patch, not the band\'s far side', () => {
    const cols = gutterColors(theme);
    expect(gutterEdgeColor(theme)).toBe(cols[cols.length - 1]);
    expect(gutterEdgeColor(theme)).not.toBe(cols[0]);
    expect(gutterEdgeColor({ mode: 'dark' })).toBe(gutterColors({ mode: 'dark' }).slice(-1)[0]);
    // And the cut shows the PAGE, which on the dark page is black, not an ink.
    expect(pageColor({ mode: 'dark' })).toBe('#000000');
    expect(pageColor({ mode: 'light' })).toBe('#FFFFFF');
  });

  const {
    READOUT_GAP, ROW_PAD, READOUT_FONT_SIZE, NOTCH_MAX_REACH, RAIL_ABS_X,
  } = require('../TimelineTaskRow');
  // Measured from the LINE now, and against the deepest the swerve ever
  // reaches — not its resting depth — so the curve can't grow into the text on
  // exactly the frames you are reading it.
  const READOUT_W = RAIL_ABS_X - NOTCH_MAX_REACH - READOUT_GAP;
  // The reading's own column. Height is part of the match: the offset word's
  // wrapper shares the column's width and alignment (deliberately — they line
  // up on one left edge) and would otherwise be found first.
  const readoutCol = (view) => boxes(view).find(
    (s) => s.alignItems === 'flex-start' && s.width === READOUT_W && s.height === NOTCH_SPAN,
  );

  test('the readout is transparent and left-aligned on the band', async () => {
    const view = await render(<TimelinePointer theme={theme} label="Today · 9 PM" top={140} />);
    const text = view.getByText('Today · 9 PM');
    const st = flat(text.props.style);
    expect(st.textAlign).toBe('left');
    expect(st.color).toBe('#FFFFFF');
    expect(st.backgroundColor).toBeUndefined(); // no chip behind it
    const col = readoutCol(view);
    expect(col).toBeTruthy();
    expect(col.backgroundColor).toBeUndefined();
    // Same left edge as the rows' own times, so the margin has ONE left edge
    // whichever of the two is speaking.
    expect(col.paddingLeft).toBe(ROW_PAD);
  });

  // Right-justified, the readout's START moved with its length: "Today" began
  // mid-margin and "Wed 8 Oct · 12:30 PM" began at the edge, so the one thing
  // you are reading mid-scrub never sat still. Anchored left, it cannot.
  test('a short and a long readout begin on the same x', async () => {
    const shortV = await render(<TimelinePointer theme={theme} label="Today" top={140} />);
    const longV = await render(<TimelinePointer theme={theme} label="Wed 8 Oct · 12:30 PM" top={140} />);
    expect(readoutCol(shortV).paddingLeft).toBe(readoutCol(longV).paddingLeft);
    expect(flat(shortV.getByTestId('pointer-day').props.style).textAlign)
      .toBe(flat(longV.getByTestId('pointer-day').props.style).textAlign);
  });

  // ── One size, wrapped, flush to the mark ─────────────────────────────────
  // The margin used to print three sizes at once: the rows at 11.5, the
  // readout at 11, and the readout again at whatever `adjustsFontSizeToFit`
  // shrank it to. Long labels were the smallest — the hardest thing to read
  // rendered tiniest, mid-scroll.
  test('the readout wraps instead of shrinking, so the size never moves', async () => {
    const long = 'Wed 8 Oct · 12:30 PM';
    const view = await render(<TimelinePointer theme={theme} label={long} top={140} />);
    const line = view.getByTestId('pointer-day');
    expect(flat(line.props.style).fontSize).toBe(READOUT_FONT_SIZE);
    // The two mechanisms that made it shrink. Both have to be absent — either
    // one alone still caps it to a single squeezed line.
    expect(line.props.adjustsFontSizeToFit).toBeFalsy();
    expect(line.props.numberOfLines).toBeUndefined();
  });

  test('a long readout renders at exactly the same size as a short one', async () => {
    const shortView = await render(<TimelinePointer theme={theme} label="Today" top={140} />);
    const longView = await render(
      <TimelinePointer theme={theme} label="Wed 8 Oct · 12:30 PM" top={140} />,
    );
    expect(flat(longView.getByTestId('pointer-day').props.style).fontSize)
      .toBe(flat(shortView.getByTestId('pointer-day').props.style).fontSize);
  });

  // Flush INTO the notch: the column already stops at the dip's deepest point,
  // so any padding here is a channel of empty band between the label and the
  // mark it belongs to.
  // ── Date on top, hour beneath ────────────────────────────────────────────
  // Two Texts, not one string left to wrap. As one string the break landed
  // wherever the column ran out, so it depended on how long the date happened
  // to be — "Today · 9 PM" on one line, "Sep 28 · 12:30 PM" across two.
  test('the reading prints the date and the hour on their own lines', async () => {
    const { READOUT_TIME_OPACITY } = require('../TimelineTaskRow');
    const view = await render(
      <TimelinePointer theme={theme} label={{ day: 'Sep 28', time: '9 PM' }} top={140} />,
    );
    const date = view.getByText('Sep 28');
    const time = view.getByText('9 PM');
    // Separate nodes — that is what fixes the break point.
    expect(date).not.toBe(time);
    // The hour is a shade quieter than the date it hangs under.
    expect(flat(time.props.style).opacity).toBe(READOUT_TIME_OPACITY);
    expect(READOUT_TIME_OPACITY).toBeLessThan(1);
    expect(flat(date.props.style).opacity).toBeUndefined(); // the date is full strength
    // Same size and alignment, so they read as one reading in two parts.
    expect(flat(time.props.style).fontSize).toBe(flat(date.props.style).fontSize);
    expect(flat(time.props.style).textAlign).toBe('left');
  });

  // Each line is set in two weights: the part that identifies it heavy, the
  // part that qualifies it light. Month bold / date light, hour bold /
  // meridiem light.
  test('each line is set in two weights, heavy then light', async () => {
    const { READOUT_HEAVY, READOUT_LIGHT } = require('../TimelineTaskRow');
    const view = await render(
      <TimelinePointer theme={theme} label={{ day: 'Sep 28', time: '12:30 PM' }} top={140} />,
    );
    const weights = (id) => view.getByTestId(id).props.children
      .filter(Boolean)
      .map((c) => flat(c.props.style).fontWeight);
    expect(weights('pointer-day')).toEqual([READOUT_HEAVY, READOUT_LIGHT]);
    expect(weights('pointer-time')).toEqual([READOUT_HEAVY, READOUT_LIGHT]);
    // Far enough apart to read as deliberate rather than as a rendering slip.
    expect(Number(READOUT_HEAVY) - Number(READOUT_LIGHT)).toBeGreaterThanOrEqual(300);
  });

  // An event's second line is light THROUGHOUT. The two weights separate an
  // hour from its meridiem; a kind has no such split, and bolding "Ev" would
  // read as a bug rather than a hierarchy.
  test('an event reading sets its whole second line light', async () => {
    const { READOUT_LIGHT, READOUT_HEAVY } = require('../TimelineTaskRow');
    const view = await render(
      <TimelinePointer theme={theme} label={{ day: 'Oct 6', time: 'Event', kind: 'event' }} top={140} />,
    );
    const spans = view.getByTestId('pointer-time').props.children.filter(Boolean);
    expect(spans).toHaveLength(1);
    expect(flat(spans[0].props.style).fontWeight).toBe(READOUT_LIGHT);
    // …and the DATE above it still leads in the heavy weight.
    const dateSpans = view.getByTestId('pointer-day').props.children.filter(Boolean);
    expect(flat(dateSpans[0].props.style).fontWeight).toBe(READOUT_HEAVY);
  });

  // A clock reading is unaffected — its hour still leads heavy.
  test('a clock reading still leads its hour heavy', async () => {
    const { READOUT_HEAVY } = require('../TimelineTaskRow');
    const view = await render(
      <TimelinePointer theme={theme} label={{ day: 'Oct 6', time: '9 PM', kind: 'clock' }} top={140} />,
    );
    const spans = view.getByTestId('pointer-time').props.children.filter(Boolean);
    expect(flat(spans[0].props.style).fontWeight).toBe(READOUT_HEAVY);
  });

  // "Today" has no qualifier and a 24-hour clock has no meridiem — the light
  // span must simply not appear, rather than appear empty.
  test('a reading with nothing to qualify prints one weight', async () => {
    const view = await render(
      <TimelinePointer theme={theme} label={{ day: 'Today', time: '21:00' }} top={140} />,
    );
    for (const id of ['pointer-day', 'pointer-time']) {
      const spans = view.getByTestId(id).props.children.filter(Boolean);
      expect(spans).toHaveLength(1);
    }
  });

  // An all-day row has no hour to report, and inventing one would be a lie.
  test('a dateless reading prints no second line', async () => {
    const view = await render(
      <TimelinePointer theme={theme} label={{ day: 'Today', time: null }} top={140} />,
    );
    expect(view.getByText('Today')).toBeTruthy();
    expect(view.queryByText('null')).toBeNull();
  });

  // The readout stops SHORT of the dip now. It belongs next to the mark, not
  // welded to it, and that sliver of untouched band is what reads as the two
  // being separate things rather than one run-on label.
  test('the readout stops short of the notch, leaving a sliver of band', async () => {
    const view = await render(<TimelinePointer theme={theme} label="Today · 9 PM" top={140} />);
    const col = readoutCol(view);
    expect(col).toBeTruthy();
    expect(READOUT_GAP).toBeGreaterThan(0);
    // Its right edge sits READOUT_GAP clear of the swerve at its FULLEST —
    // scrub and day-beat at once, not the resting depth.
    expect(col.width + READOUT_GAP).toBe(RAIL_ABS_X - NOTCH_MAX_REACH);
    expect(NOTCH_MAX_REACH).toBeGreaterThan(NOTCH_DEPTH);
  });

  test('it is centred on its y, not hung below it', async () => {
    const view = await render(<TimelinePointer theme={theme} label="Today" top={140} />);
    const wrap = boxes(view).find((s) => s.position === 'absolute' && s.height === NOTCH_SPAN && s.top !== undefined);
    expect(wrap.top + NOTCH_SPAN / 2).toBe(140);
  });

  // ── The DATE is what sits on the notch ───────────────────────────────────
  // Not the reading as a block. Centring the block meant a date ALONE sat on
  // the mark while a date with an hour under it sat half a line high — so the
  // date shifted by 8pt every time a timed row passed under the mark, and the
  // one thing the notch points at was the one thing that would not hold still.
  describe('the date holds the mark', () => {
    const dayCentre = (view) => readoutCol(view).paddingTop + READOUT_LINE_H / 2;

    test('the day line is centred on the notch', async () => {
      const view = await render(<TimelinePointer theme={theme} label="Oct 6" top={140} />);
      expect(dayCentre(view)).toBe(NOTCH_SPAN / 2);
    });

    test('an hour appearing under it does not move it', async () => {
      const untimed = await render(<TimelinePointer theme={theme} label={{ day: 'Oct 6' }} top={140} />);
      const timed = await render(<TimelinePointer theme={theme} label={{ day: 'Oct 6', time: '9 PM' }} top={140} />);
      expect(dayCentre(timed)).toBe(dayCentre(untimed));
      expect(dayCentre(timed)).toBe(NOTCH_SPAN / 2);
    });

    // The mechanism, pinned: the column stacks from its top with the day's
    // box pre-positioned. Re-centring it would silently reintroduce the jump.
    test('the column stacks from the top rather than re-centring', async () => {
      const view = await render(<TimelinePointer theme={theme} label={{ day: 'Oct 6', time: '9 PM' }} top={140} />);
      expect(readoutCol(view).justifyContent).not.toBe('center');
      expect(readoutCol(view).paddingTop).toBe(READOUT_DAY_TOP);
    });

    // The hour hangs BELOW the day, and inside the window — it is the second
    // line of the reading, not something that has to find its own room.
    test('the hour still fits under it', () => {
      expect(READOUT_FOOT).toBeLessThanOrEqual(NOTCH_SPAN);
    });
  });

  // ── The mark does not move ───────────────────────────────────────────────
  // Its y is `top` and nothing else: no transform on the outer box, ever. The
  // whole timeline is read against this mark, so anything that shifts it
  // shifts what the agenda claims to be pointing at — which is exactly how the
  // short-lived magnet broke the readout (see the note in TasksScreen).
  test('nothing can translate it off its line', async () => {
    const view = await render(<TimelinePointer theme={theme} label="Today" top={140} />);
    const wrap = boxes(view).find((s) => s.position === 'absolute' && s.height === NOTCH_SPAN && s.top !== undefined);
    expect(wrap.transform).toBeUndefined();
  });

  // ── How far from today ───────────────────────────────────────────────────
  // The offset word annotates the reading from the side that says which way it
  // points: above for anything still to come, below for anything past. The
  // side is the signal — you know which direction before you have read it.
  describe('the offset word', () => {
    const at = (offsetDays) => (
      <TimelinePointer theme={theme} label={{ day: 'Oct 6', time: '9 PM', offsetDays }} top={140} />
    );
    const offsetBox = (view) => {
      let found = null;
      const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.props?.testID === 'pointer-offset') found = node;
        (node.children || []).forEach(walk);
      };
      walk(view.toJSON());
      return found;
    };

    const above = READOUT_DAY_TOP - OFFSET_GAP - OFFSET_LINE_H;
    const below = READOUT_FOOT + OFFSET_GAP;
    const wordBox = (view) => boxes(view).find((s) => s.top === above || s.top === below);

    test('anything ahead of today sits ABOVE the reading', async () => {
      const view = await render(at(10));
      expect(view.getByTestId('pointer-offset').props.children).toBe('in 10d');
      expect(wordBox(view).top).toBe(above);
    });

    test('anything past sits BELOW it', async () => {
      const view = await render(at(-10));
      expect(view.getByTestId('pointer-offset').props.children).toBe('10d ago');
      expect(wordBox(view).top).toBe(below);
    });

    // Today is not past, so it annotates from the same side as the future.
    test('today reads from the top, with the days still to come', async () => {
      const view = await render(at(0));
      expect(view.getByTestId('pointer-offset').props.children).toBe('today');
      expect(wordBox(view).top).toBe(above);
    });

    // Air on BOTH sides, and the same amount of it. The word is a different
    // kind of thing from the date; at a hair's breadth the two read as one
    // wrapped block.
    test('it keeps a clear gap from the reading, above and below', async () => {
      expect(OFFSET_GAP).toBeGreaterThanOrEqual(16);
      // Above: the word's foot to the day's head. Below: the reading's foot at
      // its TALLEST to the word's head.
      expect(READOUT_DAY_TOP - (above + OFFSET_LINE_H)).toBe(OFFSET_GAP);
      expect(below - READOUT_FOOT).toBe(OFFSET_GAP);
    });

    // Measured off the reading at its tallest, so a row with an hour and a row
    // without put the word in the same place — the same reason the date itself
    // is pinned.
    test('it holds still whether or not the reading has an hour', async () => {
      const timed = await render(at(-10));
      const untimed = await render(
        <TimelinePointer theme={theme} label={{ day: 'Oct 6', time: null, offsetDays: -10 }} top={140} />,
      );
      expect(wordBox(timed).top).toBe(wordBox(untimed).top);
    });

    // The reading is what the notch points AT. A word appearing above or below
    // it must not push it off the mark, which is why the word is absolute
    // rather than a third line in the reading's column.
    test('it does not shift the reading off the notch', async () => {
      const withWord = await render(at(10));
      const without = await render(<TimelinePointer theme={theme} label="Oct 6" top={140} />);
      expect(readoutCol(withWord).paddingTop).toBe(readoutCol(without).paddingTop);
      expect(readoutCol(withWord).paddingLeft).toBe(readoutCol(without).paddingLeft);
    });

    // THIN, at full strength — the separation is carried by weight and air,
    // not by dimming the ink.
    test('it is hairline-thin and fully lit, never faded', async () => {
      const view = await render(at(10));
      const st = flat(view.getByTestId('pointer-offset').props.style);
      expect(Number(st.fontWeight)).toBeLessThanOrEqual(200);
      expect(st.color).toBe('#FFFFFF');
      expect(st.opacity).toBeUndefined();
    });

    // This column is the narrowest text on the screen — it is where "Yesterday"
    // wrapped and stranded its "y". One line, or an ellipsis; never a wrap.
    test('it can never wrap, whatever it is asked to say', async () => {
      const view = await render(at(-1));
      const node = offsetBox(view);
      expect(node.props.numberOfLines).toBe(1);
      expect(view.getByTestId('pointer-offset').props.children).toBe('yesterday');
    });

    // It stops clear of the swerve on exactly the line the reading does — two
    // different numbers here would read as two different left margins.
    test('it shares the reading\'s column, to the point', async () => {
      const view = await render(at(10));
      const wrap = wordBox(view);
      expect(wrap.width).toBe(RAIL_ABS_X - NOTCH_MAX_REACH - READOUT_GAP);
      expect(wrap.paddingLeft).toBe(ROW_PAD);
    });

    // A reading with no date behind it (a bare string from an older caller)
    // must print no word at all rather than "NaNd ago".
    test('with no offset to state, there is no word', async () => {
      const view = await render(<TimelinePointer theme={theme} label="Oct 6" top={140} />);
      expect(view.queryByTestId('pointer-offset')).toBeNull();
    });
  });

  test('it never catches a scroll', async () => {
    const view = await render(<TimelinePointer theme={theme} label="Today" top={140} />);
    expect(view.toJSON().props.pointerEvents).toBe('none');
  });

  test('an unresolved readout renders empty rather than "null"', async () => {
    const view = await render(<TimelinePointer theme={theme} label={null} top={140} />);
    expect(view.queryByText('null')).toBeNull();
    expect(view.queryByText('undefined')).toBeNull();
    // The mark is still there — the line still swerves even with nothing to
    // report, because the line is not conditional on the reading.
    expect(paths(view).some((p) => p.d === notchLineD())).toBe(true);
  });
});

// The margin can only hold one voice at a time: the pointer's readout and the
// row it is sitting on are both bold white on the same black, so the rows hand
// the margin over for the duration of a scrub.
describe('scrubFade', () => {
  const { scrubFade, setScrubbing } = require('../TimelineTaskRow');
  const flat = (s) => (Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean)) : (s || {}));

  afterEach(() => setScrubbing(false));

  test('the row times ride the shared value, so a scrub costs no re-renders', async () => {
    const view = await render(
      <TimelineTaskRow item={{ id: 'a', title: 'Youth group', dueDate: '2026-09-25', time: '20:30' }} hideCountdown />,
    );
    // At rest the margin is the rows'.
    expect(flat(view.getByText('8:30 PM').props.style).opacity).toBeCloseTo(1);

    // Drive the shared value and the row's time follows it — no prop, no
    // context, so a scrub re-renders nothing. (Animated resolves the node to
    // its current number in the rendered tree, which is what we read here.)
    await act(async () => { scrubFade.setValue(0.1); });
    const scrubbed = await render(
      <TimelineTaskRow item={{ id: 'a', title: 'Youth group', dueDate: '2026-09-25', time: '20:30' }} hideCountdown />,
    );
    expect(flat(scrubbed.getByText('8:30 PM').props.style).opacity).toBeCloseTo(0.1);
    await act(async () => { scrubFade.setValue(1); });
  });

  test('it rests wide open, and setScrubbing is safe to spam', () => {
    expect(scrubFade.__getValue()).toBeCloseTo(1);
    // The scroll handler calls this on the first frame of every scroll; a
    // second call must replace the in-flight animation, not stack onto it.
    expect(() => { setScrubbing(true); setScrubbing(true); setScrubbing(false); }).not.toThrow();
  });
});

// ── The card wears its board ────────────────────────────────────────────────
describe('TimelineTaskRow board colour', () => {
  const flat = (s) => (Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean)) : (s || {}));
  const timed = { id: 'a', title: 'Youth group', dueDate: '2026-09-25', time: '20:30' };
  // The card is the only 16-radius surface in the row (the bubble and the
  // completion ring are both 11).
  const cardFill = (view) => {
    let fill = null;
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      const st = flat(node.props?.style);
      if (!fill && st.borderRadius === 16 && st.backgroundColor) fill = st.backgroundColor;
      (node.children || []).forEach(walk);
    };
    walk(view.toJSON());
    return fill;
  };

  test('no board → the plain dark card', async () => {
    const view = await render(<TimelineTaskRow item={timed} hideCountdown />);
    expect(cardFill(view)).toBe(insetCardPalette({ mode: 'light' }).card);
  });

  test('a board → its colour mixed into that card', async () => {
    const view = await render(<TimelineTaskRow item={timed} hideCountdown boardColor="#2979FF" />);
    const fill = cardFill(view);
    expect(fill).not.toBe(insetCardPalette({ mode: 'light' }).card);
    const [r, , b] = [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r); // still reads as the blue board
  });

  test('the title keeps the panel ink whatever the board', async () => {
    const view = await render(<TimelineTaskRow item={timed} hideCountdown boardColor="#FFEA00" />);
    expect(flat(view.getByText('Youth group').props.style).color).toBe('#FFFFFF');
  });
});

// ── The gutter's ruler ──────────────────────────────────────────────────────
// A hairline graduation on the band's left edge at the head of every card, so
// the margin reads as ruled rather than as a dark gap with numbers floating
// in it.
describe('the ruler in the gutter', () => {
  const { RULER_TICK_W, rulerTickColor, ROW_PAD, GUTTER_W } = require('../TimelineTaskRow');
  const flat = (s) => (Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean)) : (s || {}));
  const row = { id: 'a', title: 'Youth group', dueDate: '2026-09-25', time: '20:30' };
  const ticks = (view) => {
    const found = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      const st = flat(node.props?.style);
      if (st.width === RULER_TICK_W && st.position === 'absolute') found.push(st);
      (node.children || []).forEach(walk);
    };
    walk(view.toJSON());
    return found;
  };

  test('a row between two cards is ruled off', async () => {
    const view = await render(<TimelineTaskRow item={row} hideCountdown />);
    const [tick] = ticks(view);
    expect(tick).toBeTruthy();
    expect(tick.height).toBe(StyleSheet.hairlineWidth);
    expect(tick.backgroundColor).toBe(rulerTickColor());
  });

  // A graduation above the FIRST card of a band would rule off the band
  // header, not a pair of cards.
  test('the first card of a band gets none', async () => {
    const view = await render(<TimelineTaskRow item={row} hideCountdown isFirst />);
    expect(ticks(view)).toHaveLength(0);
  });

  // `left: 0` is the SCREEN's edge: an absolutely-positioned child measures
  // from its parent's BORDER box in Yoga, and the row's 14pt of horizontal
  // padding must not move the tick off the band's edge.
  test('it starts at the band\'s edge, not at the row\'s padding', async () => {
    const view = await render(<TimelineTaskRow item={row} hideCountdown />);
    expect(ticks(view)[0].left).toBe(0);
  });

  // It marks the band, and only the band. Past the thread it would be drawing
  // on the page; as far as the times' own margin it would underline them.
  test('it stays clear of both the times and the thread', () => {
    expect(RULER_TICK_W).toBeLessThanOrEqual(ROW_PAD + 4);
    expect(RULER_TICK_W).toBeLessThan(GUTTER_W);
  });

  // It sits at the row's TOP, inside the box. Centred in the gap above would
  // put it outside the row's bounds and at the mercy of a parent's clipping.
  test('it rides at the head of the card, inside the row', async () => {
    const view = await render(<TimelineTaskRow item={row} hideCountdown />);
    const tick = ticks(view)[0];
    expect(tick.top).toBe(0);
    expect(tick.bottom).toBeUndefined();
  });
});
