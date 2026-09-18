import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import ScheduleCard, { clockLabel } from '../ScheduleCard';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../../../utils/haptics', () => ({ tapHaptic: jest.fn(), impactHaptic: jest.fn() }));

const theme = {
  mode: 'light',
  colors: {
    textPrimary: '#111827',
    textSecondary: '#64748B',
    textTertiary: '#94A3B8',
    background: '#FFFFFF',
    surface: '#F1F5F9',
    surfaceElevated: '#FFFFFF',
  },
};

const task = { id: 't1', title: 'Apply to OAA Admissions Course', project: 'Architecture License' };

describe('ScheduleCard time column', () => {
  test('the time is a button when the row can be re-timed', async () => {
    const onTimePress = jest.fn();
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="any time" range="" onTimePress={onTimePress} />,
    );

    await fireEvent.press(
      view.getByLabelText('Edit the time for Apply to OAA Admissions Course, currently any time'),
    );

    expect(onTimePress).toHaveBeenCalledWith(task);
  });

  // The Pending strip shows a due DATE in that column, so it passes no
  // handler — tapping a date must not open a time picker.
  test('the time is inert when no handler is given', async () => {
    const view = await render(<ScheduleCard task={task} theme={theme} timeLabel="09/18" range="" />);

    expect(view.getByText('09/18')).toBeTruthy();
    expect(
      view.queryByLabelText('Edit the time for Apply to OAA Admissions Course, currently 09/18'),
    ).toBeNull();
  });
});

describe('clockLabel padding', () => {
  // The timeline gutter is sized for the expanded grid's whole hours ("3 PM"),
  // so a padded "03:30 PM" overflowed it and rendered as "03:30…".
  test('pads by default, so every existing caller is unchanged', () => {
    expect(clockLabel(8 * 60)).toBe('08 AM');
    expect(clockLabel(15 * 60 + 30)).toBe('03:30 PM');
  });

  test('drops the leading zero on request', () => {
    expect(clockLabel(8 * 60, false, { pad: false })).toBe('8 AM');
    expect(clockLabel(15 * 60 + 30, false, { pad: false })).toBe('3:30 PM');
    // Matches the expanded grid's own unpadded hour labels.
    expect(clockLabel(23 * 60, false, { pad: false })).toBe('11 PM');
    expect(clockLabel(0, false, { pad: false })).toBe('12 AM');
    expect(clockLabel(12 * 60, false, { pad: false })).toBe('12 PM');
  });

  test('24-hour is always zero-padded, pad flag or not', () => {
    expect(clockLabel(8 * 60, true, { pad: false })).toBe('08:00');
    expect(clockLabel(8 * 60, true)).toBe('08:00');
  });
});

// The done toggle moved OUT of the card into a square key beside it. Inside,
// it was a 22 pt ring in the card's top corner — under §3's 44 pt minimum, and
// close enough to the title that a thumb aimed at one hit the other.
describe('ScheduleCard done key', () => {
  const { DONE_KEY } = require('../ScheduleCard');
  const flat = (node) => require('react-native').StyleSheet.flatten(node.props.style);

  test('is a SQUARE with rounded corners — one number for width and height', async () => {
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" onToggle={jest.fn()} testID="row" />,
    );
    const key = flat(view.getByTestId('row-done'));
    expect(key.width).toBe(DONE_KEY);
    expect(key.height).toBe(DONE_KEY);
    expect(key.width).toBe(key.height);
    // Comfortably over the 44 pt minimum it was under as an in-card ring.
    expect(DONE_KEY).toBeGreaterThanOrEqual(44);
  });

  test('toggles the task it belongs to', async () => {
    const onToggle = jest.fn();
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" onToggle={onToggle} testID="row" />,
    );
    await fireEvent.press(view.getByTestId('row-done'));
    expect(onToggle).toHaveBeenCalledWith(task);
  });

  test('reads its state to a screen reader, and names the task', async () => {
    const open = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" onToggle={jest.fn()} testID="row" />,
    );
    expect(open.getByTestId('row-done').props.accessibilityState).toEqual({ checked: false });
    expect(open.getByLabelText('Mark Apply to OAA Admissions Course done')).toBeTruthy();

    const done = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" done onToggle={jest.fn()} testID="row" />,
    );
    expect(done.getByTestId('row-done').props.accessibilityState).toEqual({ checked: true });
    expect(done.getByLabelText('Mark Apply to OAA Admissions Course not done')).toBeTruthy();
  });

  // A quiet control: light grey under a THIN OUTLINE, with white bleeding in
  // off the edges. It has been a charcoal slab (the loudest thing on the row)
  // and the card's own wash (too quiet to read as a button at all).
  test('is light grey under a thin outline, not the card wash', async () => {
    const view = await render(
      <ScheduleCard task={task} theme={theme} color="#8B5CF6" timeLabel="09 AM" range=""
        onToggle={jest.fn()} onStartPomodoro={jest.fn()} testID="row" />,
    );
    const cardBg = flat(view.getByTestId('row-card')).backgroundColor;
    for (const id of ['row-done', 'row-pomodoro']) {
      const s = flat(view.getByTestId(id));
      expect(s.backgroundColor).toBe('#E7E9ED');
      expect(s.backgroundColor).not.toBe(cardBg);
      // Thin, but not a hairline: at 0.33 pt the edge vanishes on a white page.
      expect(s.borderWidth).toBe(1);
      expect(s.borderColor).toBe('rgba(15,23,42,0.13)');
    }
  });

  // Two crossed linears — white at both ends, transparent through the middle —
  // so the light comes in from all four sides. expo-linear-gradient has no
  // radial mode; this is what reads as one.
  test('carries white off the edges, down the key and across it', async () => {
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range=""
        onToggle={jest.fn()} onStartPomodoro={jest.fn()} testID="row" />,
    );
    // The native prop is processed ARGB, not the string that went in.
    const { processColor } = require('react-native');
    const WHITE = (a) => processColor(`rgba(255,255,255,${a})`);
    // One pair per key: one down, one across.
    for (const id of ['row-done-sheen', 'row-pomodoro-sheen']) {
      for (const g of [view.getByTestId(id), view.getByTestId(`${id}-across`)]) {
        expect(g.props.colors[0]).toBe(WHITE(0.92));
        // Transparent through the middle, or it is a flat white wash.
        expect(g.props.colors[1]).toBe(WHITE(0));
        expect(g.props.colors[2]).toBe(WHITE(0.72));
        expect(g.props.locations).toEqual([0, 0.5, 1]);
      }
      // The second of each pair runs ACROSS, so the light is not only vertical.
      // `start`/`end` reach the native view as point ARRAYS.
      const across = view.getByTestId(`${id}-across`);
      expect(across.props.startPoint).toEqual([0, 0.5]);
      expect(across.props.endPoint).toEqual([1, 0.5]);
      // The first passes no points at all — the default is straight down.
      expect(view.getByTestId(id).props.startPoint).toBeUndefined();
    }
  });

  // The gloss belongs to a key that is waiting to be pressed; on the green it
  // would only wash out the one colour on the row that is meant to carry.
  test('a done key is flat mint — no outline, no gloss', async () => {
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" done
        onToggle={jest.fn()} testID="row" />,
    );
    const s = flat(view.getByTestId('row-done'));
    expect(s.backgroundColor).toBe('#34D399');
    expect(s.borderColor).toBe('transparent');
    expect(view.queryByTestId('row-done-sheen')).toBeNull();
    expect(view.queryByTestId('row-done-sheen-across')).toBeNull();
  });

  test('is clipped, so the outline and the sheen take the corner with them', async () => {
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range=""
        onToggle={jest.fn()} onStartPomodoro={jest.fn()} testID="row" />,
    );
    expect(flat(view.getByTestId('row-done')).overflow).toBe('hidden');
    expect(flat(view.getByTestId('row-pomodoro')).overflow).toBe('hidden');
  });

  test('INVERTS when done — the one moment it stops matching the card', async () => {
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" done onToggle={jest.fn()} testID="row" />,
    );
    const cardBg = flat(view.getByTestId('row-card')).backgroundColor;
    expect(flat(view.getByTestId('row-done')).backgroundColor).not.toBe(cardBg);
  });

  // The Pending strip and the read-only rows hand no toggle: no key, and the
  // card keeps the full width.
  test('no toggle, no key — the card is not narrowed for nothing', async () => {
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" testID="row" />,
    );
    expect(view.queryByTestId('row-done')).toBeNull();
  });
});

// The second key: start a focus timer. A CIRCLE under the square, because it
// is a different kind of action — something you begin, not a state you toggle
// — and the shape is what stops a thumb reaching for one and finding the other.
describe('ScheduleCard pomodoro key', () => {
  const { DONE_KEY, POMODORO_KEY } = require('../ScheduleCard');
  const flat = (node) => require('react-native').StyleSheet.flatten(node.props.style);

  test('is a CIRCLE: the same box as the square, rounded all the way', async () => {
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" onStartPomodoro={jest.fn()} testID="row" />,
    );
    const key = flat(view.getByTestId('row-pomodoro'));
    expect(key.width).toBe(POMODORO_KEY);
    expect(key.height).toBe(POMODORO_KEY);
    expect(key.borderRadius).toBe(POMODORO_KEY / 2);
    // Same footprint as the done key, so the column has one straight edge.
    expect(POMODORO_KEY).toBe(DONE_KEY);
    expect(POMODORO_KEY).toBeGreaterThanOrEqual(44);
  });

  test('is a square and a circle of the SAME size, in that order', async () => {
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range=""
        onToggle={jest.fn()} onStartPomodoro={jest.fn()} testID="row" />,
    );
    const done = view.getByTestId('row-done');
    const pomo = view.getByTestId('row-pomodoro');
    // Done on top, pomodoro under it.
    const column = done.parent;
    expect(column.children.indexOf(done)).toBeLessThan(column.children.indexOf(pomo));
    // ONE size for both — they used to be measured per card, so a shorter card
    // made smaller keys and a column had keys of three different sizes.
    expect(flat(done).width).toBe(flat(pomo).width);
    expect(flat(done).height).toBe(flat(pomo).height);
    // Only the corner says they are different kinds of thing.
    expect(flat(pomo).borderRadius).toBe(POMODORO_KEY / 2);
    expect(flat(done).borderRadius).toBeLessThan(flat(pomo).borderRadius);
  });

  test('starts the timer for its own task', async () => {
    const onStartPomodoro = jest.fn();
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" onStartPomodoro={onStartPomodoro} testID="row" />,
    );
    await fireEvent.press(view.getByTestId('row-pomodoro'));
    expect(onStartPomodoro).toHaveBeenCalledWith(task);
  });

  test('names the task it would time, for a screen reader', async () => {
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" onStartPomodoro={jest.fn()} testID="row" />,
    );
    expect(view.getByLabelText('Start a pomodoro for Apply to OAA Admissions Course')).toBeTruthy();
  });

  test('a row given no timer draws no circle', async () => {
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" onToggle={jest.fn()} testID="row" />,
    );
    expect(view.queryByTestId('row-pomodoro')).toBeNull();
  });
});

// The compact cards and the expanded grid's hour rules INTERLEAVE in the
// timeline view, so their times are one column: same width, same inset, same
// type, right-aligned. The card's time used to be 14 pt and left-aligned,
// which put it outside the hour labels in a bigger face.
describe('ScheduleCard time column', () => {
  const { TIME_COL_W } = require('../ScheduleCard');
  const flat = (node) => require('react-native').StyleSheet.flatten(node.props.style);

  test('is right-aligned into the rule, at the gutter type', async () => {
    const view = await render(<ScheduleCard task={task} theme={theme} timeLabel="2:38 PM" range="" />);
    const s = flat(view.getByText('2:38 PM'));
    expect(s.textAlign).toBe('right');
    expect(s.fontSize).toBe(11);
    expect(s.fontWeight).toBe('500');
    expect(s.letterSpacing).toBe(0.2);
    expect(s.paddingRight).toBe(10);
    expect(s.width).toBe(TIME_COL_W);
    // Tabular figures, or "11 AM" and "12 PM" sit at different widths.
    expect(s.fontVariant).toEqual(['tabular-nums']);
  });

  test('is wide enough for the longest time there is, in full', async () => {
    const view = await render(<ScheduleCard task={task} theme={theme} timeLabel="12:38 PM" range="" />);
    const s = flat(view.getByText('12:38 PM'));
    // 11 pt tabular: ~48 pt of text. The column less its inset has to hold it.
    expect(TIME_COL_W - s.paddingRight).toBeGreaterThanOrEqual(50);
    // And it is never truncated to make it fit.
    expect(view.getByText('12:38 PM').props.numberOfLines).toBe(1);
  });
});

// The people on a task, STACKED — the owner first, then whoever else is
// involved, each disc overlapping the one before by two thirds. A picture where
// they have set one; the coloured initial is the FALLBACK, not the default, and
// it stays underneath so a photo still loading (or failing) shows the disc
// rather than a hole.
describe('ScheduleCard people', () => {
  const { PERSON, PERSON_OVERLAP, MAX_FACES } = require('../ScheduleCard');
  const flat = (node) => require('react-native').StyleSheet.flatten(node.props.style);
  const person = (id, name, avatarUrl = null) => ({ id, name, color: '#34D399', avatarUrl });
  const M = person('u1', 'Michelle');
  const N = person('u2', 'Naser');

  const draw = (people, extra = {}) => render(
    <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" people={people} testID="row" {...extra} />,
  );

  test('draws the photo over the initial when there is one', async () => {
    const view = await draw([person('u1', 'Michelle', 'https://app.t3d.ca/api/avatars/m.jpg')]);
    const src = view.getByTestId('row-person-u1-photo').props.source;
    // expo-image normalises `source` to an array of sources.
    expect([].concat(src)[0]).toMatchObject({ uri: 'https://app.t3d.ca/api/avatars/m.jpg' });
    expect(view.getByText('M')).toBeTruthy();
  });

  test('falls back to the coloured initial when they have no picture', async () => {
    const view = await draw([M]);
    expect(view.queryByTestId('row-person-u1-photo')).toBeNull();
    expect(view.getByText('M')).toBeTruthy();
  });

  test('overlaps each disc by a THIRD, so the faces stay readable', async () => {
    const view = await draw([M, N]);
    expect(flat(view.getByTestId('row-person-u1')).marginLeft).toBeUndefined();
    expect(flat(view.getByTestId('row-person-u2')).marginLeft).toBe(-PERSON_OVERLAP);
    expect(PERSON_OVERLAP).toBe(Math.round(PERSON * (1 / 3)));
  });

  test('puts the FIRST on top — the owner, not whoever was added last', async () => {
    const view = await draw([M, N]);
    expect(flat(view.getByTestId('row-person-u1')).zIndex)
      .toBeGreaterThan(flat(view.getByTestId('row-person-u2')).zIndex);
  });

  test('clips each photo to its disc', async () => {
    const view = await draw([person('u1', 'Michelle', 'https://x/a.jpg')]);
    const badge = flat(view.getByTestId('row-person-u1'));
    expect(badge.overflow).toBe('hidden');
    expect(badge.borderRadius).toBe(badge.width / 2);
  });

  test('a photo is not a second thing for a screen reader to read', async () => {
    const view = await draw([person('u1', 'Michelle', 'https://x/a.jpg')], { onPeoplePress: jest.fn() });
    expect(view.getByTestId('row-person-u1-photo').props.accessible).toBe(false);
    expect(view.getByLabelText('Michelle. Open profile')).toBeTruthy();
  });

  // The STACK is one target, not a row of them: at a third of a disc apiece
  // the faces overlap too much to aim at individually. One person opens their
  // profile; several open the list.
  test('reads as one control, naming everyone on it', async () => {
    const view = await draw([M, N], { onPeoplePress: jest.fn() });
    expect(view.getByLabelText('2 people on this task: Michelle, Naser. Open the list')).toBeTruthy();
  });

  test('hands the whole roster and the anchor to the caller', async () => {
    const onPeoplePress = jest.fn();
    const view = await draw([M, N], { onPeoplePress });
    await fireEvent.press(view.getByTestId('row-people'), { nativeEvent: { pageX: 300, pageY: 480 } });
    expect(onPeoplePress).toHaveBeenCalled();
    const [roster, forTask, anchor] = onPeoplePress.mock.calls[0];
    expect(roster).toEqual([M, N]);
    expect(forTask).toBe(task);
    // Anchored on the touch, so the list drops from where the finger landed.
    expect(anchor).toMatchObject({ x: 300 - PERSON / 2, y: 480 - PERSON / 2 });
  });

  // The anchor comes off the TOUCH rather than from measureInWindow, which is
  // async and — when it cannot resolve a node — never calls back at all. That
  // would be a tap that silently does nothing, the worst failure a button has.
  // A press ALWAYS opens the list; where it drops from is secondary, and the
  // no-anchor path is covered directly in PeoplePopover's own tests.
  test('a press always opens the list, whatever the event carries', async () => {
    const onPeoplePress = jest.fn();
    const view = await draw([M, N], { onPeoplePress });
    await fireEvent.press(view.getByTestId('row-people'), { nativeEvent: {} });
    expect(onPeoplePress).toHaveBeenCalled();
    expect(onPeoplePress.mock.calls[0][0]).toEqual([M, N]);
  });

  test('past a handful the tail becomes a count', async () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => person(id, id.toUpperCase()));
    const view = await draw(many);
    expect(view.getByTestId('row-people-more')).toBeTruthy();
    expect(view.getByText(`+${many.length - MAX_FACES}`)).toBeTruthy();
    // The ones past the cap are not drawn at all.
    expect(view.queryByTestId('row-person-f')).toBeNull();
  });

  test('exactly the cap draws no count', async () => {
    const view = await draw(['a', 'b', 'c', 'd'].map((id) => person(id, id.toUpperCase())));
    expect(view.queryByTestId('row-people-more')).toBeNull();
  });

  test('a solo task draws no badges at all', async () => {
    const view = await draw([]);
    expect(view.queryByTestId('row-people')).toBeNull();
  });
});

// Every card is the same height whatever a task carries. One with no board used
// to drop that line and come out shorter, so a column had a ragged edge — and
// the keys beside it, sized from the measured card, came out different sizes
// too.
describe('ScheduleCard uniform size', () => {
  const sub = (view) => view.getByText(/No board|Job search/);

  test('a task with no board still draws the line, as a placeholder', async () => {
    const view = await render(
      <ScheduleCard task={{ id: 'x', title: 'No board here' }} theme={theme} timeLabel="09 AM" range="" />,
    );
    expect(view.getByText('No board')).toBeTruthy();
  });

  test('the placeholder is a stand-in, not a fact', async () => {
    const view = await render(
      <ScheduleCard task={{ id: 'x', title: 'No board here' }} theme={theme} timeLabel="09 AM" range="" />,
    );
    const s = require('react-native').StyleSheet.flatten(view.getByText('No board').props.style);
    expect(s.fontStyle).toBe('italic');
    expect(s.color).toBe(theme.colors.textMuted);
    expect(s.color).not.toBe(theme.colors.textSecondary);
  });

  test('both cards put their subtitle in the same place, at the same size', async () => {
    const withBoard = await render(
      <ScheduleCard task={{ id: 'a', title: 'A', project: 'Job search' }} theme={theme} timeLabel="09 AM" range="" />,
    );
    const without = await render(
      <ScheduleCard task={{ id: 'b', title: 'B' }} theme={theme} timeLabel="09 AM" range="" />,
    );
    const flatten = require('react-native').StyleSheet.flatten;
    expect(flatten(sub(withBoard).props.style).fontSize).toBe(flatten(sub(without).props.style).fontSize);
    expect(flatten(sub(withBoard).props.style).marginTop).toBe(flatten(sub(without).props.style).marginTop);
  });

  test('an explicit blank subtitle is a missing fact too', async () => {
    // The Pending strip passes its own subtitle; an empty one is still a gap.
    const view = await render(
      <ScheduleCard task={{ id: 'x', title: 'X', project: 'Job search' }} subtitle="" theme={theme} timeLabel="09 AM" range="" />,
    );
    expect(view.getByText('No board')).toBeTruthy();
  });
});

// A running focus block turns the circle into its own countdown, and a task
// that has had focus before says how much.
describe('ScheduleCard pomodoro state', () => {
  const { minutesLeft, CARD_H, KEY, KEY_GAP } = require('../ScheduleCard');
  const flat = (node) => require('react-native').StyleSheet.flatten(node.props.style);
  const NOW = 1_700_000_000_000;

  describe('minutesLeft', () => {
    test('rounds UP, so a part-minute still reads as a minute', () => {
      expect(minutesLeft(NOW + 90_000, NOW)).toBe(2);
      expect(minutesLeft(NOW + 60_000, NOW)).toBe(1);
    });

    test('never reads 0 while the block is still live', () => {
      // A timer showing "0" for the last 59 seconds looks finished when it is
      // not — the key would invite a second start.
      expect(minutesLeft(NOW + 1_000, NOW)).toBe(1);
      expect(minutesLeft(NOW + 59_999, NOW)).toBe(1);
    });

    test('is null once the end has passed, so the key goes back to a button', () => {
      expect(minutesLeft(NOW, NOW)).toBeNull();
      expect(minutesLeft(NOW - 1, NOW)).toBeNull();
    });

    test('is null for nothing running, rather than NaN in a circle', () => {
      expect(minutesLeft(null, NOW)).toBeNull();
      expect(minutesLeft(undefined, NOW)).toBeNull();
      expect(minutesLeft('soon', NOW)).toBeNull();
    });
  });

  test('the circle counts DOWN while a block runs on this task', async () => {
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" testID="row"
        onStartPomodoro={jest.fn()} pomodoro={{ endsAt: Date.now() + 14 * 60_000, count: 0 }} />,
    );
    expect(view.getByText('14')).toBeTruthy();
  });

  test('and is the plain timer key again when nothing is running', async () => {
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" testID="row"
        onStartPomodoro={jest.fn()} pomodoro={{ endsAt: Date.now() - 60_000, count: 2 }} />,
    );
    expect(view.queryByText('14')).toBeNull();
    expect(view.getByTestId('row-pomodoro')).toBeTruthy();
  });

  // The tally is a NAMED line with one dot per session, not a "⏱ 3" in the
  // corner: the question it answers is "has this had any, and roughly how
  // much", which is a thing you count at a glance rather than parse.
  test('the card says how much focus the task has already had', async () => {
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" testID="row"
        pomodoro={{ count: 3 }} />,
    );
    expect(view.getByTestId('row-pomo-count')).toBeTruthy();
    expect(view.getByText('Focus sessions')).toBeTruthy();
    for (const i of [0, 1, 2]) expect(view.getByTestId(`row-focus-dot-${i}`)).toBeTruthy();
    expect(view.queryByTestId('row-focus-dot-3')).toBeNull();
  });

  test('one session is one session, not one sessions', async () => {
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" testID="row" pomodoro={{ count: 1 }} />,
    );
    expect(view.getByText('Focus session')).toBeTruthy();
    expect(view.getByTestId('row-focus-dot-0')).toBeTruthy();
    expect(view.queryByTestId('row-focus-dot-1')).toBeNull();
  });

  // Past a row's worth the dots stop being countable, so the tail is a number —
  // the same concession the face stack makes at MAX_FACES.
  test('a long run of sessions caps the dots and counts the rest', async () => {
    const { MAX_FOCUS_DOTS } = require('../ScheduleCard');
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" testID="row"
        pomodoro={{ count: MAX_FOCUS_DOTS + 3 }} />,
    );
    expect(view.getByTestId(`row-focus-dot-${MAX_FOCUS_DOTS - 1}`)).toBeTruthy();
    expect(view.queryByTestId(`row-focus-dot-${MAX_FOCUS_DOTS}`)).toBeNull();
    expect(view.getByTestId('row-focus-more')).toBeTruthy();
    expect(view.getByText('+3')).toBeTruthy();
  });

  test('exactly a full row of dots needs no "+0" after it', async () => {
    const { MAX_FOCUS_DOTS } = require('../ScheduleCard');
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" testID="row"
        pomodoro={{ count: MAX_FOCUS_DOTS }} />,
    );
    expect(view.queryByTestId('row-focus-more')).toBeNull();
  });

  test('an untouched task says nothing — "0 focus sessions" everywhere is noise', async () => {
    const none = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" testID="row" pomodoro={{ count: 0 }} />,
    );
    expect(none.queryByTestId('row-pomo-count')).toBeNull();
    expect(none.queryByText('Focus sessions')).toBeNull();
    const absent = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" testID="row" />,
    );
    expect(absent.queryByTestId('row-pomo-count')).toBeNull();
  });

  // ...and it costs nothing when it is absent. The line used to be RESERVED on
  // every card to keep the column level, which spent 20 pt of blank space on
  // every untouched task. The card's height being a floor is what buys that
  // back: an ordinary card is still the same 120 either way.
  test('a card with no sessions is no taller for the line it does not draw', async () => {
    for (const [id, count] of [['a', 0], ['b', 4]]) {
      const view = await render(
        <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" testID={id} pomodoro={{ count }} />,
      );
      expect(flat(view.getByTestId(`${id}-card`)).minHeight).toBe(CARD_H);
    }
  });

  // The whole point of fixing the card height: two keys and their gap ARE the
  // card, so the column starts and ends exactly where it does.
  test('two keys and their gap come to exactly one card', () => {
    expect(KEY * 2 + KEY_GAP).toBe(CARD_H);
  });

  // A FLOOR, not a lock. The card is the familiar 120 whatever it carries; only
  // the one combination that genuinely will not fit — a two-line title with
  // focus sessions under it — makes it taller. A hard height either spent 19 pt
  // of dead space at the foot of every ordinary card or cut titles to one line.
  test('the card takes its height as a floor, so it can never be shorter than the keys', async () => {
    const view = await render(
      <ScheduleCard task={{ id: 'a', title: 'Short', project: 'P' }} theme={theme} timeLabel="09 AM" range="" testID="a" />,
    );
    const s = flat(view.getByTestId('a-card'));
    expect(s.minHeight).toBe(CARD_H);
    // Not also pinned — that is what put the hole under the focus line.
    expect(s.height).toBeUndefined();
  });

  // Whatever the card does, the keys do not follow it: they are cut from the
  // constant, so a column of cards has one size of key down it even where one
  // card has grown. (Sizing them per card is what gave the old build keys of
  // three different sizes in one column.)
  test('the keys are one size whatever the card carries', async () => {
    const plain = await render(
      <ScheduleCard task={{ id: 'a', title: 'Short', project: 'P' }} theme={theme} timeLabel="09 AM" range=""
        testID="a" onToggle={jest.fn()} onStartPomodoro={jest.fn()} />,
    );
    const grown = await render(
      <ScheduleCard
        task={{ id: 'b', title: 'Export Mayfield Package - no revision clouds', project: 'P' }}
        theme={theme} timeLabel="09 AM" range="" testID="b" pomodoro={{ count: 3 }}
        onToggle={jest.fn()} onStartPomodoro={jest.fn()} />,
    );
    for (const [view, id] of [[plain, 'a'], [grown, 'b']]) {
      expect(flat(view.getByTestId(`${id}-done`)).height).toBe(KEY);
      expect(flat(view.getByTestId(`${id}-pomodoro`)).height).toBe(KEY);
    }
  });
});

// While a block is RUNNING on a task, the circle is not a start button any
// more — it is the block itself: red, counting down in minutes, draining a
// level, and pressing it opens the timer rather than starting a second one.
describe('ScheduleCard live pomodoro key', () => {
  const { remainingPct } = require('../ScheduleCard');
  const flat = (node) => require('react-native').StyleSheet.flatten(node.props.style);
  const NOW = 1_700_000_000_000;
  // 25 minutes long, 10 minutes in — 15 to go.
  const running = (extra = {}) => ({
    count: 1,
    startedAt: Date.now() - 10 * 60_000,
    durationMinutes: 25,
    endsAt: Date.now() + 15 * 60_000,
    ...extra,
  });
  const draw = (pomodoro, extra = {}) => render(
    <ScheduleCard task={task} theme={theme} color="#8B5CF6" timeLabel="09 AM" range="" testID="row"
      pomodoro={pomodoro} onStartPomodoro={jest.fn()} {...extra} />,
  );

  describe('remainingPct', () => {
    test('is the share of the block still to run', () => {
      const p = { startedAt: NOW - 5 * 60_000, durationMinutes: 20, endsAt: NOW + 15 * 60_000 };
      expect(remainingPct(p, NOW)).toBe(75);
    });

    test('takes the length from startedAt when no duration came through', () => {
      expect(remainingPct({ startedAt: NOW - 30 * 60_000, endsAt: NOW + 10 * 60_000 }, NOW)).toBe(25);
    });

    // A block in its last seconds is still a block running; an empty circle
    // reads as a finished one, for the same reason minutesLeft never says 0.
    test('keeps a sliver of level to the very end', () => {
      expect(remainingPct({ startedAt: NOW - 1_499_000, durationMinutes: 25, endsAt: NOW + 1_000 }, NOW)).toBe(4);
    });

    test('is null with nothing running, and null with no length to measure', () => {
      expect(remainingPct({ startedAt: NOW - 60_000, durationMinutes: 25, endsAt: NOW - 1 }, NOW)).toBeNull();
      expect(remainingPct(null, NOW)).toBeNull();
      // The countdown still works without it; only the gauge needs the length.
      expect(remainingPct({ endsAt: NOW + 60_000 }, NOW)).toBeNull();
    });
  });

  test('the key says the MINUTES left, with the unit', async () => {
    const view = await draw(running());
    expect(view.getByText('15')).toBeTruthy();
    // Without the unit a bare "15" in a circle could be the block COUNT, which
    // is the other number this card shows.
    expect(view.getByText('m')).toBeTruthy();
  });

  test('wears the timer red instead of the board grey', async () => {
    const live = await draw(running());
    const idle = await draw({ count: 1 });
    const s = flat(live.getByTestId('row-pomodoro'));
    expect(s.backgroundColor).toBe('#FCE9E9');
    expect(s.backgroundColor).not.toBe(flat(idle.getByTestId('row-pomodoro')).backgroundColor);
    // The static outline stands down: the ring inside IS the outline while a
    // block runs, and an edge around it would be a second one that never moves.
    expect(s.borderColor).toBe('transparent');
    expect(flat(idle.getByTestId('row-pomodoro')).borderColor).not.toBe('transparent');
  });

  // The radial countdown. Two rotating half-rings rather than SVG — there is no
  // react-native-svg here, and a native module cannot ship over the air.
  //
  // Geometry, clockwise from 12 o'clock: an unrotated top+right half spans
  // −45°→135°, the RIGHT window shows 0°→180°, so a turn of `D − 135` leaves
  // exactly D degrees of arc on screen (D = 180 → 45°, the whole side; D = 0 →
  // −135°, swung out of view). The LEFT window shows 180°→360°, giving S + 45.
  //
  // These are asserted at the degree rather than through a render because the
  // anchor is the part that can silently be wrong: an arc 90° out still grows
  // and shrinks correctly, it just starts at 3 o'clock.
  const rotationOf = (node) => flat(node).transform[0].rotate;

  test('the OUTLINE is an arc as long as the block has left', async () => {
    // 15 of 25 minutes left — 60 %, so 216° of arc from 12 o'clock.
    const view = await draw(running());
    expect(rotationOf(view.getByTestId('row-pomodoro-ring-right'))).toBe('45deg');   // right side full
    expect(rotationOf(view.getByTestId('row-pomodoro-ring-left'))).toBe('81deg');    // 36° into the left
  });

  test('and the arc SHRINKS as the block burns down', async () => {
    const early = await draw(running({ startedAt: Date.now() - 60_000, endsAt: Date.now() + 24 * 60_000 }));
    const late = await draw(running({ startedAt: Date.now() - 24 * 60_000, endsAt: Date.now() + 60_000 }));
    // 96 % — nearly the whole ring: the right side full, 165.6° round the left.
    expect(rotationOf(early.getByTestId('row-pomodoro-ring-right'))).toBe('45deg');
    expect(rotationOf(early.getByTestId('row-pomodoro-ring-left'))).toBe('210.6deg');
    // 4 % — a sliver from 12 o'clock, and the left half swung entirely away.
    expect(rotationOf(late.getByTestId('row-pomodoro-ring-right'))).toBe('-120.6deg');
    expect(rotationOf(late.getByTestId('row-pomodoro-ring-left'))).toBe('45deg');
  });

  // The anchor: at a FULL ring both halves are fully in view, and at an empty
  // one both are fully out. Either being 90° off shows up here as one of the
  // four numbers landing on a half-shown side.
  test('a full ring shows both halves, an empty one shows neither', async () => {
    const full = await draw(running({ startedAt: Date.now(), endsAt: Date.now() + 25 * 60_000 }));
    expect(rotationOf(full.getByTestId('row-pomodoro-ring-right'))).toBe('45deg');
    expect(rotationOf(full.getByTestId('row-pomodoro-ring-left'))).toBe('225deg');
    // remainingPct floors at 4 %, so "empty" is asserted through the component
    // that draws it rather than through a block that cannot exist.
    const { KeyRingRotations } = require('../ScheduleCard');
    expect(KeyRingRotations(0)).toEqual({ right: -135, left: 45 });
    expect(KeyRingRotations(100)).toEqual({ right: 45, left: 225 });
    expect(KeyRingRotations(50)).toEqual({ right: 45, left: 45 });
  });

  test('the arc eats into a track, which is what the outline used to be', async () => {
    const view = await draw(running());
    expect(flat(view.getByTestId('row-pomodoro-ring-track')).borderColor).toBe('rgba(224,36,36,0.18)');
    // Half-rings: two sides painted, two transparent.
    const arc = flat(view.getByTestId('row-pomodoro-ring-right'));
    expect(arc.borderTopColor).toBe('#E02424');
    expect(arc.borderRightColor).toBe('#E02424');
    expect(arc.borderBottomColor).toBe('transparent');
    expect(arc.borderLeftColor).toBe('transparent');
  });

  test('no ring where the block never said how long it was', async () => {
    const view = await draw({ count: 0, endsAt: Date.now() + 9 * 60_000 });
    // The countdown is still the point; the arc is what needs the length.
    expect(view.getByText('9')).toBeTruthy();
    expect(view.queryByTestId('row-pomodoro-ring')).toBeNull();
  });

  test('a press OPENS the running timer — it does not start a second block', async () => {
    const onStartPomodoro = jest.fn();
    const onOpenPomodoro = jest.fn();
    const view = await draw(running(), { onStartPomodoro, onOpenPomodoro });
    await fireEvent.press(view.getByTestId('row-pomodoro'));
    expect(onOpenPomodoro).toHaveBeenCalledWith(task);
    expect(onStartPomodoro).not.toHaveBeenCalled();
  });

  // Better than a live key that does nothing at all.
  test('with no destination given, a press falls back to the start handler', async () => {
    const onStartPomodoro = jest.fn();
    const view = await draw(running(), { onStartPomodoro });
    await fireEvent.press(view.getByTestId('row-pomodoro'));
    expect(onStartPomodoro).toHaveBeenCalledWith(task);
  });

  test('once the block is over the key starts one again', async () => {
    const onStartPomodoro = jest.fn();
    const onOpenPomodoro = jest.fn();
    const view = await draw({ count: 2, endsAt: Date.now() - 1 }, { onStartPomodoro, onOpenPomodoro });
    await fireEvent.press(view.getByTestId('row-pomodoro'));
    expect(onStartPomodoro).toHaveBeenCalledWith(task);
    expect(onOpenPomodoro).not.toHaveBeenCalled();
  });

  test('says what it is, and what pressing it does, to a screen reader', async () => {
    const view = await draw(running(), { onOpenPomodoro: jest.fn() });
    expect(view.getByLabelText(
      `Focus block running on ${task.title}, 15 minutes left. Open the timer`,
    )).toBeTruthy();
  });

  test('the last minute is singular', async () => {
    const view = await draw(running({ startedAt: Date.now() - 24 * 60_000, endsAt: Date.now() + 30_000 }));
    expect(view.getByLabelText(`Focus block running on ${task.title}, 1 minute left. Open the timer`)).toBeTruthy();
  });

  // A read-only row hands no start handler. It still wants to say that a timer
  // is running on this task.
  test('a live block draws the key even where nothing can start one', async () => {
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" testID="row"
        pomodoro={running()} onOpenPomodoro={jest.fn()} />,
    );
    expect(view.getByTestId('row-pomodoro')).toBeTruthy();
    expect(view.getByText('15')).toBeTruthy();
  });

  test('and no key at all when there is neither a block nor a way to start one', async () => {
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" testID="row" pomodoro={{ count: 3 }} />,
    );
    expect(view.queryByTestId('row-pomodoro')).toBeNull();
  });
});

// The keys borrow the card's board colour, faintly, so a row reads as one
// object — a card with two keys — rather than a coloured card with neutral
// furniture parked beside it.
describe('ScheduleCard key tint', () => {
  const flat = (node) => require('react-native').StyleSheet.flatten(node.props.style);
  const draw = (extra = {}) => render(
    <ScheduleCard task={task} theme={theme} color="#8B5CF6" timeLabel="09 AM" range="" testID="row"
      onToggle={jest.fn()} onStartPomodoro={jest.fn()} {...extra} />,
  );

  test('both keys carry a faint wash of the board colour', async () => {
    const view = await draw();
    for (const id of ['row-done-tint', 'row-pomodoro-tint']) {
      // The card's own wash is 18 %; the keys take less, or they stop being
      // controls and become more of the card.
      expect(flat(view.getByTestId(id)).backgroundColor).toBe('#8B5CF629');
    }
  });

  test('a row with no board has no colour to borrow', async () => {
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" testID="row"
        onToggle={jest.fn()} onStartPomodoro={jest.fn()} />,
    );
    expect(view.queryByTestId('row-done-tint')).toBeNull();
    expect(view.queryByTestId('row-pomodoro-tint')).toBeNull();
  });

  // The two states that are already saying something in colour.
  test('not over a done key, and not over a running one', async () => {
    const done = await draw({ done: true });
    expect(done.queryByTestId('row-done-tint')).toBeNull();
    const live = await draw({ pomodoro: { endsAt: Date.now() + 60_000, durationMinutes: 25, count: 0 } });
    expect(live.queryByTestId('row-pomodoro-tint')).toBeNull();
    // The done key beside it is untouched by the block, and keeps its tint.
    expect(live.getByTestId('row-done-tint')).toBeTruthy();
  });

  // The check is the deep green at rest and white on the mint — the key's two
  // states, told twice: by the fill and by the glyph on it.
  test('the check follows the key it is on', async () => {
    const open = await draw({ done: false });
    expect(open.getByTestId('row-done-check').props.color).toBe('#0E9F6E');
    const done = await draw({ done: true });
    expect(done.getByTestId('row-done-check').props.color).toBe('#FFFFFF');
  });
});

// ── NOW, passing through a card ───────────────────────────────────────────
//
// The schedule draws one red line for the current minute. Over an open stretch
// of empty hours it runs the full width; over a CARD it does not — a bar across
// the title would cut the title in half to repeat what the card's own time
// range already says exactly. So it is cut to a stub on the card's left edge,
// short of where the title starts.
describe('the now-line where it crosses a card', () => {
  const { nowMarkTop, CARD_H, NOW_STUB_W } = require('../ScheduleCard');
  const flat = (node) => require('react-native').StyleSheet.flatten(node.props.style);
  const draw = (props) => render(
    <ScheduleCard task={task} theme={theme} timeLabel="09 AM" range="" testID="row" {...props} />,
  );

  test('there is no mark on a card the clock is not inside', async () => {
    const view = await draw({ nowAt: null });
    expect(view.queryByTestId('row-now')).toBeNull();
  });

  test('a card the clock IS inside carries the mark', async () => {
    const view = await draw({ nowAt: 0.5 });
    expect(view.getByTestId('row-now')).toBeTruthy();
  });

  // The whole point of the treatment: it must not reach the words. The card
  // insets its text by 16 (`card.paddingHorizontal`), so anything at or past
  // that is a line struck through a title.
  test('the stub stops short of where the title starts', () => {
    expect(NOW_STUB_W).toBeLessThan(16);
  });

  // A card is one height whatever the task's duration, so the mark's position
  // can only mean "this far THROUGH the task".
  test('places the mark by how far through the task the minute is', () => {
    expect(nowMarkTop(0.5)).toBe(Math.round(CARD_H / 2) - 1);
    expect(nowMarkTop(0.25)).toBe(Math.round(CARD_H / 4) - 1);
  });

  test('keeps the dot on the card at either end of the task', () => {
    // Half a dot in, not 0 — an 8 pt disc centred on the card's top edge is a
    // stray dot beside the card, not a line entering it.
    expect(nowMarkTop(0)).toBe(3);
    expect(nowMarkTop(1)).toBe(CARD_H - 5);
    // Out-of-range fractions clamp rather than drawing off the card.
    expect(nowMarkTop(-2)).toBe(nowMarkTop(0));
    expect(nowMarkTop(9)).toBe(nowMarkTop(1));
  });

  test('is nothing at all for a card with no minute to mark', () => {
    expect(nowMarkTop(null)).toBeNull();
    expect(nowMarkTop(undefined)).toBeNull();
    expect(nowMarkTop('half')).toBeNull();
  });

  // Drawn OVER the card's own content, because that is what it is passing
  // through — under it, the board wash and the title would swallow it.
  test('sits over the card, not under it', async () => {
    const view = await draw({ nowAt: 0.5 });
    expect(flat(view.getByTestId('row-now')).zIndex).toBeGreaterThan(0);
  });
});
