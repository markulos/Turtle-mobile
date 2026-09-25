import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { TimelineTaskRow } from '../TimelineTaskRow';
import { insetCardPalette } from '../../utils/cardPalette';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../../../context/ThemeContext', () => ({
  useTheme: () => ({
    timeFormat: '12h',
    theme: {
      mode: 'light',
      colors: {
        // The page colour — what the filled time bubble writes its label in.
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

// ── The timeline: one thread, bubbles strung on it ──────────────────────────
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

  test('the bubble HOLDS the whole time, not a truncation of it', async () => {
    // "08:30 PM" beside a bead used to render as "08:30…" — the column was
    // sized for a label sitting next to a marker, not for one inside it.
    const view = await render(<TimelineTaskRow item={timed} hideCountdown />);
    const label = view.getByText('08:30 PM');
    expect(label.props.numberOfLines).toBe(1);
  });

  test('an untimed row still gets a bubble on the thread', async () => {
    // "even the open ones" — a gap in the beads would read as a broken string.
    const view = await render(<TimelineTaskRow item={{ id: 'b', title: 'Someday' }} hideCountdown />);
    expect(view.getByText('—')).toBeTruthy();
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

  test('the BUBBLE keeps the caller\'s strong ink — only the line is faint', async () => {
    const view = await render(<TimelineTaskRow item={timed} hideCountdown railColor="#000" />);
    // The filled pill is the one thing on the rail that must stay solid.
    const label = view.getByText('08:30 PM');
    expect(flat(label.props.style).color).toBe('#FFFFFF'); // the page colour, on solid black
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

  test('tapping the bubble asks to reschedule THAT row', async () => {
    const onPressTime = jest.fn();
    const view = await render(
      <TimelineTaskRow item={timed} hideCountdown onPressTime={onPressTime} />,
    );
    await fireEvent.press(view.getByLabelText('Change time'));
    expect(onPressTime).toHaveBeenCalledWith(timed);
  });

  // An undated row is the one that needs BOTH halves, and its bubble should
  // say so rather than offering a time for a day that doesn't exist yet.
  test('an undated row offers date-and-time, not just a time', async () => {
    const onPressTime = jest.fn();
    const view = await render(
      <TimelineTaskRow item={{ id: 'b', title: 'Someday' }} hideCountdown onPressTime={onPressTime} />,
    );
    await fireEvent.press(view.getByLabelText('Set date and time'));
    expect(onPressTime).toHaveBeenCalled();
  });

  test('without a handler the bubble is inert, not a dead button', async () => {
    const view = await render(<TimelineTaskRow item={timed} hideCountdown />);
    expect(view.queryByLabelText('Change time')).toBeNull();
  });

  // An event is a thing that's ON a day, not one you do AT a time — and the
  // hour it has (if any) is already on the card's when-line.
  test('an event names itself on the bubble instead of showing a clock', async () => {
    const view = await render(
      <TimelineTaskRow
        item={{ id: 'e', title: 'Michiee birthday', itemType: 'event', dueDate: '2026-10-06', time: '20:30' }}
        hideCountdown
      />,
    );
    // Exactly once: the kind used to ALSO be the card's subtitle, which put
    // "Event" on the row twice the moment the bubble started saying it.
    expect(view.getAllByText('Event')).toHaveLength(1);
    expect(view.queryByText('08:30 PM')).toBeNull();
    expect(view.getByText('No Board')).toBeTruthy();
  });

  test('a plain task with a time still shows the time', async () => {
    const view = await render(<TimelineTaskRow item={timed} hideCountdown />);
    expect(view.queryByText('Event')).toBeNull();
    expect(view.getByText('08:30 PM')).toBeTruthy();
  });

  test('a finished row hollows its bubble but keeps the thread', async () => {
    const view = await render(<TimelineTaskRow item={timed} done hideCountdown railColor="#000" />);
    const label = view.getByText('08:30 PM');
    // Hollow: the page's own ink on it, rather than the page colour it wears
    // when the pill is filled.
    expect(flat(label.props.style).color).toBe('#64748B');
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
