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

  // One margin, one size. The rows' times and the pointer's readout are drawn
  // by different components into the SAME column, so a size that lives in two
  // places drifts: they were 11.5 and 11, which is close enough to look like a
  // mistake rather than a distinction.
  test('a row time and the pointer readout print at one shared size', async () => {
    const { TimelinePointer, MARGIN_FONT_SIZE } = require('../TimelineTaskRow');
    const row = await render(<TimelineTaskRow item={timed} hideCountdown />);
    const pointer = await render(
      <TimelinePointer theme={{ mode: 'light', colors: { background: '#FFF' } }} label="Today" top={140} />,
    );
    const rowSize = flat(row.getByText('8:30 PM').props.style).fontSize;
    expect(rowSize).toBe(MARGIN_FONT_SIZE);
    expect(flat(pointer.getByText('Today').props.style).fontSize).toBe(rowSize);
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
    expect(gutterColors({ mode: 'light' })[0]).toBe('#000000');
    for (const mode of ['light', 'dark']) {
      const cols = gutterColors({ mode });
      expect(cols).toHaveLength(GUTTER_STOPS.length);
    }
    expect(GUTTER_STOPS[GUTTER_STOPS.length - 1]).toBe(1);
    expect(gutterInk(false)).toBe('#FFFFFF');
    expect(gutterInk(true)).not.toBe(gutterInk(false)); // finished rows dim
  });

  // A SHEEN, not a fade. The band used to end fully transparent, which washed
  // out the last third of the column and left it visibly short of the thread.
  test('the gutter stays black across its whole width', () => {
    const { gutterColors } = require('../TimelineTaskRow');
    // Light page: every stop opaque, and every stop still black — the lift
    // between the darkest and lightest is a sheen, not a change of colour.
    const light = gutterColors({ mode: 'light' });
    const lum = (hex) => [1, 3, 5].reduce((a, i) => a + parseInt(hex.slice(i, i + 2), 16), 0) / 3;
    for (const col of light) {
      expect(col).toMatch(/^#[0-9A-Fa-f]{6}$/); // opaque: no alpha to fade through
      expect(lum(col)).toBeLessThan(40); // …and unmistakably black (0–255)
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

  test('the thread is centred on the shared x both files use', async () => {
    // (This suite's RNTL has no UNSAFE_root; toJSON is what it can see.)
    const view = await render(<TimelineTaskRow item={timed} hideCountdown railColor="#000" />);
    const found = threads(view);
    expect(found.length).toBeGreaterThan(0);
    // Centre of the line === the constant TasksScreen's dividers import.
    expect(found[0].left + found[0].width / 2).toBe(RAIL_ABS_X);
  });

  // One line, one colour. The rows used to draw the caller's strong ink at 45%
  // opacity while the dividers drew it at full strength, so the timeline
  // darkened at every date heading.
  test('the thread is black at 60%, whatever the caller asked for', async () => {
    const view = await render(<TimelineTaskRow item={timed} hideCountdown railColor="#000" />);
    const found = threads(view);
    expect(threadColor({ mode: 'light' })).toBe('rgba(0,0,0,0.60)');
    for (const st of found) {
      expect(st.backgroundColor).toBe('rgba(0,0,0,0.60)');
      // The colour carries the fade; a second opacity would compound it.
      expect(st.opacity).toBeUndefined();
    }
  });

  test('and it is 1pt wide, not a 2pt rule', async () => {
    expect(RAIL_W).toBe(1);
    expect(RAIL_W).toBeGreaterThan(StyleSheet.hairlineWidth);
    const view = await render(<TimelineTaskRow item={timed} hideCountdown railColor="#000" />);
    expect(threads(view).length).toBeGreaterThan(0);
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

  test('a finished row dims its time but keeps the thread', async () => {
    const view = await render(<TimelineTaskRow item={timed} done hideCountdown railColor="#000" />);
    const label = view.getByText('8:30 PM');
    // Still in the margin, just no longer a thing that is waiting — a dimmer
    // white on the band, not the page's ink (which the band would swallow).
    expect(flat(label.props.style).color).toBe('rgba(255,255,255,0.45)');
    expect(threads(view).length).toBeGreaterThan(0);
  });
});

// ── The pointer on the band's edge ──────────────────────────────────────────
describe('TimelinePointer', () => {
  const {
    TimelinePointer, GUTTER_W, NOTCH_SPAN, NOTCH_DEPTH, NOTCH_TIP_R, NOTCH_FILLET_R,
    NOTCH_SHOULDER_Y, gutterEdgeColor, gutterColors, pageColor,
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
  const { NOTCH_SVG_W, NOTCH_RIM, notchCutD, notchProfileD } = require('../TimelineTaskRow');
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

  // IN, not out — the mirror of the swell this replaced. The cut is the PAGE
  // showing through the band, and the <Svg>'s right edge IS the band's edge,
  // so nothing the notch draws can spill into the cards' channel.
  test('the dip cuts INTO the band and never spills past its edge', async () => {
    const view = await render(<TimelinePointer theme={theme} label="Today · 9 PM" top={140} />);
    const layer = boxes(view).find((s) => s.width === NOTCH_SVG_W && s.left !== undefined);
    expect(layer).toBeTruthy();
    expect(layer.left + layer.width).toBe(GUTTER_W);
    // The cut is the page showing through — material removed, not added.
    const t = tip(view);
    expect(t).toBeTruthy();
    expect(isPaint(t.fill, pageColor(theme))).toBe(true);
    // The cut reaches exactly NOTCH_DEPTH in from the edge and no further.
    // The deepest point is the tip arc's leftmost: its centre, minus its
    // radius — the one x on the profile that the shape is solved around.
    const tipLeft = (NOTCH_SVG_W - NOTCH_DEPTH + NOTCH_TIP_R) - NOTCH_TIP_R;
    expect(tipLeft).toBeCloseTo(NOTCH_SVG_W - NOTCH_DEPTH, 6);
    expect(tipLeft).toBeGreaterThan(0); // never off the left of the band
    // And the layer is wider than the cut is deep, so the day-kick's extra
    // bite still has band to travel into.
    expect(NOTCH_SVG_W).toBeGreaterThan(NOTCH_DEPTH);
  });

  // Pointed tip, smooth shoulders — the two things one circle can't do at
  // once, which is why the profile is three arcs.
  test('the tip is pointed and the shoulders are not', async () => {
    // A tip barely wider than the cut is deep: that's a point, not a dome.
    expect(NOTCH_TIP_R).toBeLessThan(NOTCH_DEPTH * 2);
    // Shoulders an order of magnitude softer than the tip.
    expect(NOTCH_FILLET_R).toBeGreaterThan(NOTCH_TIP_R * 3);
    // Three arcs, in the order fillet → tip → fillet, and the tip turns the
    // OTHER way (sweep 1 between two 0s). That alternation is what makes a
    // point between two smooth shoulders rather than one continuous bump.
    const d = notchProfileD();
    const arcs = d.match(/A \d+(\.\d+)? \d+(\.\d+)? 0 \d \d/g) || [];
    expect(arcs).toHaveLength(3);
    expect(arcs[0]).toContain(`A ${NOTCH_FILLET_R} ${NOTCH_FILLET_R} 0 0 0`);
    expect(arcs[1]).toContain(`A ${NOTCH_TIP_R} ${NOTCH_TIP_R} 0 0 1`);
    expect(arcs[2]).toContain(`A ${NOTCH_FILLET_R} ${NOTCH_FILLET_R} 0 0 0`);
  });

  // The join between each fillet and the tip has to be TANGENT, or the dip
  // shows two creases where the arcs meet. Solved, not eyeballed — so the
  // check is that the join point really is on both circles at once.
  test('the three arcs meet tangentially, to floating-point', async () => {
    const d = notchProfileD();
    // "A rx ry rot laf sf x y" — the endpoint of arc 1 is the lower join.
    const seg = d.split(/A /).map((s) => s.trim());
    const join = nums(seg[1]).slice(-2); // [x, y] where fillet meets tip
    const tipCx = NOTCH_SVG_W - NOTCH_DEPTH + NOTCH_TIP_R;
    const filletCx = NOTCH_SVG_W - NOTCH_FILLET_R;
    const cy = 96 / 2;
    const dTip = Math.hypot(join[0] - tipCx, join[1] - cy);
    const dFil = Math.hypot(join[0] - filletCx, join[1] - (cy + NOTCH_SHOULDER_Y));
    expect(Math.abs(dTip - NOTCH_TIP_R)).toBeLessThan(0.01);
    expect(Math.abs(dFil - NOTCH_FILLET_R)).toBeLessThan(0.01);
  });

  // Only the removed material is drawn. The old build painted two
  // band-coloured patches back over the cut to round its corners — flat fills
  // on top of a GRADIENT, which only stayed invisible while the clip stayed
  // narrow. Nothing in the tree may wear the band's colour any more.
  test('nothing paints the band back over itself', async () => {
    const view = await render(<TimelinePointer theme={theme} label="Today" top={140} />);
    const fills = paths(view).map((p) => p.fill);
    expect(fills.some((f) => isPaint(f, gutterEdgeColor(theme)))).toBe(false);
    expect(fills.filter((f) => isPaint(f, pageColor(theme)))).toHaveLength(1);
  });

  // The rim light is a STROKE on the same profile — not a second shape that
  // could drift out of register with the cut.
  test('the rim light traces the cut exactly', async () => {
    const view = await render(<TimelinePointer theme={theme} label="Today" top={140} />);
    const rim = paths(view).find((p) => isPaint(p.stroke, NOTCH_RIM));
    expect(rim).toBeTruthy();
    expect(rim.fill).toBeNull(); // fill="none" — a stroke, never a shape
    expect(rim.d).toBe(notchProfileD());
    // …and the cut is that same profile, closed off to the right.
    expect(notchCutD().startsWith(notchProfileD())).toBe(true);
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

  test('the readout is transparent and right-justified into the notch', async () => {
    const view = await render(<TimelinePointer theme={theme} label="Today · 9 PM" top={140} />);
    const text = view.getByText('Today · 9 PM');
    const st = flat(text.props.style);
    expect(st.textAlign).toBe('right');
    expect(st.color).toBe('#FFFFFF');
    expect(st.backgroundColor).toBeUndefined(); // no chip behind it
    // Its column ends at the band's edge, so the text hangs off the notch.
    const col = boxes(view).find((s) => s.alignItems === 'flex-end' && s.width === GUTTER_W - NOTCH_DEPTH);
    expect(col).toBeTruthy();
    expect(col.backgroundColor).toBeUndefined();
  });

  // ── One size, wrapped, flush to the mark ─────────────────────────────────
  // The margin used to print three sizes at once: the rows at 11.5, the
  // readout at 11, and the readout again at whatever `adjustsFontSizeToFit`
  // shrank it to. Long labels were the smallest — the hardest thing to read
  // rendered tiniest, mid-scroll.
  test('the readout wraps instead of shrinking, so the size never moves', async () => {
    const { MARGIN_FONT_SIZE } = require('../TimelineTaskRow');
    const long = 'Wed 8 Oct · 12:30 PM';
    const view = await render(<TimelinePointer theme={theme} label={long} top={140} />);
    const st = flat(view.getByText(long).props.style);
    expect(st.fontSize).toBe(MARGIN_FONT_SIZE);
    // The two mechanisms that made it shrink. Both have to be absent — either
    // one alone still caps it to a single squeezed line.
    expect(view.getByText(long).props.adjustsFontSizeToFit).toBeFalsy();
    expect(view.getByText(long).props.numberOfLines).toBeUndefined();
  });

  test('a long readout renders at exactly the same size as a short one', async () => {
    const shortView = await render(<TimelinePointer theme={theme} label="Today" top={140} />);
    const longView = await render(
      <TimelinePointer theme={theme} label="Wed 8 Oct · 12:30 PM" top={140} />,
    );
    expect(flat(longView.getByText('Wed 8 Oct · 12:30 PM').props.style).fontSize)
      .toBe(flat(shortView.getByText('Today').props.style).fontSize);
  });

  // Flush INTO the notch: the column already stops at the dip's deepest point,
  // so any padding here is a channel of empty band between the label and the
  // mark it belongs to.
  test('the readout hangs off the notch with no gap', async () => {
    const view = await render(<TimelinePointer theme={theme} label="Today · 9 PM" top={140} />);
    const col = boxes(view).find((s) => s.alignItems === 'flex-end' && s.width === GUTTER_W - NOTCH_DEPTH);
    expect(col.paddingRight).toBe(0);
  });

  test('it is centred on its y, not hung below it', async () => {
    const view = await render(<TimelinePointer theme={theme} label="Today" top={140} />);
    const wrap = boxes(view).find((s) => s.position === 'absolute' && s.height === NOTCH_SPAN && s.top !== undefined);
    expect(wrap.top + NOTCH_SPAN / 2).toBe(140);
  });

  test('it never catches a scroll', async () => {
    const view = await render(<TimelinePointer theme={theme} label="Today" top={140} />);
    expect(view.toJSON().props.pointerEvents).toBe('none');
  });

  test('an unresolved readout renders empty rather than "null"', async () => {
    const view = await render(<TimelinePointer theme={theme} label={null} top={140} />);
    expect(view.queryByText('null')).toBeNull();
    expect(tip(view)).toBeTruthy(); // the mark is still there
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
