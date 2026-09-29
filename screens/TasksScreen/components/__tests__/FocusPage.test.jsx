import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
// The stats panel's period keys glide on reanimated. Left real, its worklets
// settle outside act() and leak into the NEXT test as an overlapping act() call
// — which shows up as a later render finding nothing at all.
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('../../../../utils/haptics', () => ({
  tapHaptic: jest.fn(),
  impactHaptic: jest.fn(),
  notifyHaptic: jest.fn(),
}));
jest.mock('../../../../services/focusChime', () => ({ playFocusComplete: jest.fn() }));
jest.mock('../../../TurtleScreen/components/EdgeSwipePage', () => {
  const React = require('react');
  return function MockEdgeSwipePage({ visible, children }) {
    return visible ? React.createElement(React.Fragment, null, children) : null;
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

import FocusPage from '../FocusPage';
import { playFocusComplete } from '../../../../services/focusChime';
import { notifyHaptic } from '../../../../utils/haptics';

const theme = {
  mode: 'dark',
  colors: {
    background: '#000', textPrimary: '#fff', textTertiary: '#888',
    border: '#333', borderStrong: '#444', accentInfo: '#5598e7',
  },
};

// A fixed local instant. The page is a clock, so the clock is nailed down:
// fake timers with the system time set here mean the component's own Date.now
// agrees with the fixture and a running block's countdown is deterministic.
const NOW = new Date(2026, 8, 26, 14, 30, 0).getTime();
const at = (d, h = 10) => new Date(2026, 8, 26 + d, h, 0, 0).getTime();

const done = (over = {}) => {
  const startedAt = over.startedAt ?? at(0);
  const minutes = over.minutes ?? 25;
  return {
    id: over.id || `p-${startedAt}`,
    taskId: over.taskId === undefined ? 't1' : over.taskId,
    startedAt,
    completedAt: startedAt + minutes * 60000,
    durationMinutes: 25,
    status: 'completed',
  };
};

const props = (over = {}) => ({
  sessions: [done()],
  active: null,
  focusMinutes: 25,
  boardOfTask: (id) => (id === 't1' ? 'Deep work' : null),
  onStart: jest.fn(),
  onStartBreak: jest.fn(),
  onStop: jest.fn(),
  onPickTask: jest.fn(),
  onClearTask: jest.fn(),
  onJot: jest.fn(),
  focusTask: null,
  theme,
  ...over,
});

/** A running BREAK, which is the same deck in the other mode. */
const onBreak = (left) => ({ ...running(left, 5), mode: 'break' });

/** A block running right now, with `left` ms to go. */
const running = (left, durationMinutes = 25) => ({
  taskId: null,
  startedAt: NOW - (durationMinutes * 60000 - left),
  endsAt: NOW + left,
  durationMinutes,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});
afterEach(() => {
  jest.useRealTimers();
});

/**
 * Move the clock to `ms` and let the page's one-second tick notice.
 *
 * Jumped rather than run: `advanceTimersByTime(45 minutes)` would fire the
 * interval 2,700 times and re-render the page on every one of them, which takes
 * longer than the test's whole budget. Setting the clock a second short of the
 * target and advancing exactly once gives the page one tick at the new time,
 * which is all it ever gets in real life anyway — a suspended app's interval
 * does not catch up, it fires once on resume.
 */
async function tickTo(ms) {
  await act(async () => {
    jest.setSystemTime(ms - 1000);
    jest.advanceTimersByTime(1000);
  });
}

/**
 * Press, then let the state the press set actually reach the tree.
 *
 * ONE awaited async act around the press, not a bare `fireEvent.press` followed
 * by a flush. `fireEvent.press` opens a SYNCHRONOUS act of its own, and when the
 * handler mounts something as large as the stats panel React hands that act a
 * thenable — which nothing awaits, so the scope stays open past the end of the
 * test and the NEXT render dies on "overlapping act() calls" with an empty tree.
 * A passing test poisoning the three after it is what that looks like.
 */
async function press(testID) {
  const el = screen.getByTestId(testID);
  await act(async () => { fireEvent.press(el); });
}

describe('the countdown lives on this page', () => {
  // The complaint this page was rebuilt around: starting a block used to throw
  // you onto the chat tab, so the page with the countdown on it was the one
  // page that never showed a running block.
  test('a running block counts down on the deck, and the key becomes Stop', async () => {
    await render(<FocusPage {...props({ active: running(9 * 60000 + 5000) })} />);
    expect(screen.getByTestId('focus-clock')).toHaveTextContent('09:05');
    expect(screen.getByText('Stop')).toBeTruthy();
    expect(screen.getByText('FOCUS')).toBeTruthy();
  });

  test('the deck ticks down as the block burns', async () => {
    await render(<FocusPage {...props({ active: running(90000) })} />);
    expect(screen.getByTestId('focus-clock')).toHaveTextContent('01:30');
    await tickTo(NOW + 31000);
    expect(screen.getByTestId('focus-clock')).toHaveTextContent('00:59');
  });

  test('idle, the deck shows the length the next block will run', async () => {
    await render(<FocusPage {...props({ focusMinutes: 50 })} />);
    expect(screen.getByTestId('focus-clock')).toHaveTextContent('50:00');
    expect(screen.getByText('Start session')).toBeTruthy();
  });

  // A loose block — one with no task pinned to it, which is what the tab's own
  // key starts — must drive the deck exactly as a task-linked one does.
  test('a block with no task still runs the countdown', async () => {
    await render(<FocusPage {...props({ active: { ...running(60000), taskId: null } })} />);
    expect(screen.getByTestId('focus-clock')).toHaveTextContent('01:00');
  });

  test('the one key starts when idle', async () => {
    const p = props();
    await render(<FocusPage {...p} />);
    fireEvent.press(screen.getByTestId('focus-toggle'));
    expect(p.onStart).toHaveBeenCalledTimes(1);
    expect(p.onStop).not.toHaveBeenCalled();
  });

  test('and stops when running', async () => {
    const p = props({ active: running(60000) });
    await render(<FocusPage {...p} />);
    fireEvent.press(screen.getByTestId('focus-toggle'));
    expect(p.onStop).toHaveBeenCalledTimes(1);
    expect(p.onStart).not.toHaveBeenCalled();
  });
});

describe('a running block says what it is FOR', () => {
  const TASK = { id: 't9', title: 'City Comments - Revised Set' };

  // Once it is running the task stops being a choice and becomes a fact, so it
  // moves out of the field that picked it and sits with the clock.
  test('the task moves up beside the timer', async () => {
    await render(<FocusPage {...props({ active: running(60000), focusTask: TASK })} />);
    expect(screen.getByTestId('focus-run-task')).toHaveTextContent('City Comments - Revised Set');
  });

  // A truncated task name is the one thing on this deck you cannot infer from
  // anything else on it.
  test('and is allowed to wrap rather than being cut off', async () => {
    await render(<FocusPage {...props({ active: running(60000), focusTask: TASK })} />);
    expect(screen.getByTestId('focus-run-task').props.numberOfLines).toBeGreaterThan(1);
  });

  test('a block with no task says nothing rather than an empty line', async () => {
    await render(<FocusPage {...props({ active: running(60000), focusTask: null })} />);
    expect(screen.queryByTestId('focus-run-task')).toBeNull();
  });

  test('and idle it is back in the picker, not beside the clock', async () => {
    await render(<FocusPage {...props({ focusTask: TASK })} />);
    expect(screen.queryByTestId('focus-run-task')).toBeNull();
    expect(screen.getByTestId('focus-assign-label')).toHaveTextContent('City Comments - Revised Set');
  });
});

/**
 * The box changes job when the block starts. The task it picked is up beside
 * the clock, so what is left is what a running block actually needs: somewhere
 * to put the thought that just arrived. Park it and carry on — and it lands
 * where the Inbox tab's own capture lands, so there is one destination and not
 * two.
 */
describe('parking a thought mid-block', () => {
  const type = async (text) => {
    await act(async () => { fireEvent.changeText(screen.getByTestId('focus-jot-input'), text); });
  };

  test('running, the box is a jotter — not the task picker', async () => {
    await render(<FocusPage {...props({ active: running(60000) })} />);
    expect(screen.getByTestId('focus-jot-input')).toBeTruthy();
    expect(screen.queryByTestId('focus-assign')).toBeNull();
  });

  test('idle, it is the picker — not a jotter', async () => {
    await render(<FocusPage {...props()} />);
    expect(screen.getByTestId('focus-assign')).toBeTruthy();
    expect(screen.queryByTestId('focus-jot-input')).toBeNull();
  });

  test('it says what it is for', async () => {
    await render(<FocusPage {...props({ active: running(60000) })} />);
    expect(screen.getByTestId('focus-jot-input').props.placeholder).toBe('Park a thought for later…');
  });

  test('a line is parked, and the field clears for the next one', async () => {
    const p = props({ active: running(60000) });
    await render(<FocusPage {...p} />);
    await type('Check the render settings');
    await press('focus-jot-send');
    expect(p.onJot).toHaveBeenCalledWith('Check the render settings');
    expect(screen.getByTestId('focus-jot-input').props.value).toBe('');
  });

  test('Return parks it too, without reaching for the key', async () => {
    const p = props({ active: running(60000) });
    await render(<FocusPage {...p} />);
    await type('Ring the planner');
    await act(async () => { fireEvent(screen.getByTestId('focus-jot-input'), 'submitEditing'); });
    expect(p.onJot).toHaveBeenCalledWith('Ring the planner');
  });

  test('a blank line parks nothing', async () => {
    const p = props({ active: running(60000) });
    await render(<FocusPage {...p} />);
    await press('focus-jot-send');
    await type('   ');
    await press('focus-jot-send');
    expect(p.onJot).not.toHaveBeenCalled();
  });

  // Disabled rather than hidden: a key that appears as you type is a key you
  // cannot aim for.
  test('the key is always there, and dead until there is something to park', async () => {
    await render(<FocusPage {...props({ active: running(60000) })} />);
    expect(screen.getByTestId('focus-jot-send').props.accessibilityState.disabled).toBe(true);
    await type('a');
    expect(screen.getByTestId('focus-jot-send').props.accessibilityState.disabled).toBe(false);
  });
});

describe('the two ways in', () => {
  // A break and a session are two halves of one cycle, not an action and its
  // lesser sibling — so both are offered, together, at the same size.
  test('idle offers both, side by side', async () => {
    await render(<FocusPage {...props()} />);
    expect(screen.getByTestId('focus-start-break')).toBeTruthy();
    expect(screen.getByTestId('focus-toggle')).toBeTruthy();
    expect(screen.getByText('Start break')).toBeTruthy();
    expect(screen.getByText('Start session')).toBeTruthy();
  });

  test('each key starts its own kind of block', async () => {
    const p = props();
    await render(<FocusPage {...p} />);
    await press('focus-start-break');
    expect(p.onStartBreak).toHaveBeenCalledTimes(1);
    expect(p.onStart).not.toHaveBeenCalled();
    await press('focus-toggle');
    expect(p.onStart).toHaveBeenCalledTimes(1);
    expect(p.onStartBreak).toHaveBeenCalledTimes(1);
  });

  // The pond runs exactly one timer, so a second "start" under a live block
  // would silently cancel the first. Offering it would be offering to lose one.
  test('running, they collapse to a single Stop', async () => {
    await render(<FocusPage {...props({ active: running(60000) })} />);
    expect(screen.queryByTestId('focus-start-break')).toBeNull();
    expect(screen.getByText('Stop')).toBeTruthy();
  });
});

describe('a break is the same deck, unmistakably', () => {
  test('it counts down here too — a break you cannot see is one you start twice', async () => {
    await render(<FocusPage {...props({ active: onBreak(3 * 60000) })} />);
    expect(screen.getByTestId('focus-clock')).toHaveTextContent('03:00');
  });

  test('and says which it is, in its own colour', async () => {
    const { unmount } = await render(<FocusPage {...props({ active: onBreak(60000) })} />);
    expect(screen.getByTestId('focus-mode-badge')).toHaveTextContent('BREAK');
    const breakFill = StyleSheet.flatten(screen.getByTestId('focus-bar-fill').props.style).backgroundColor;
    await act(async () => { unmount(); });

    await render(<FocusPage {...props({ active: running(60000) })} />);
    expect(screen.getByTestId('focus-mode-badge')).toHaveTextContent('FOCUS');
    const focusFill = StyleSheet.flatten(screen.getByTestId('focus-bar-fill').props.style).backgroundColor;
    expect(breakFill).not.toBe(focusFill);
  });

  test('stopping one reads as stopping a break, not a focus block', async () => {
    const p = props({ active: onBreak(60000) });
    await render(<FocusPage {...p} />);
    expect(screen.getByTestId('focus-toggle').props.accessibilityLabel).toBe('Stop the break');
    await press('focus-toggle');
    expect(p.onStop).toHaveBeenCalledTimes(1);
  });
});

describe('the task the session is for', () => {
  const TASK = { id: 't9', title: 'Rewire the porch light' };

  // PICK OR CREATE, because the panel it opens does both: anything typed that
  // is not already a task heads the list as a create row.
  test('with none picked, the row invites you to pick or create one', async () => {
    await render(<FocusPage {...props()} />);
    expect(screen.getByTestId('focus-assign-label')).toHaveTextContent('Pick or create a task…');
  });

  test('picked, it names it — and the Start key says what it will do', async () => {
    await render(<FocusPage {...props({ focusTask: TASK })} />);
    expect(screen.getByTestId('focus-assign-label')).toHaveTextContent('Rewire the porch light');
    expect(screen.getByTestId('focus-toggle').props.accessibilityLabel)
      .toBe('Start a focus session on Rewire the porch light');
  });

  test('the row opens the picker rather than taking the keyboard here', async () => {
    const p = props();
    await render(<FocusPage {...p} />);
    await press('focus-assign');
    expect(p.onPickTask).toHaveBeenCalledTimes(1);
  });

  // Clearing is its own target, not a second meaning for the row: the row
  // changes the task, the key takes it away.
  test('clearing is a separate key, and only there when there is one to clear', async () => {
    const { unmount } = await render(<FocusPage {...props()} />);
    expect(screen.queryByTestId('focus-assign-clear')).toBeNull();
    await act(async () => { unmount(); });

    const p = props({ focusTask: TASK });
    await render(<FocusPage {...p} />);
    await press('focus-assign-clear');
    expect(p.onClearTask).toHaveBeenCalledTimes(1);
    expect(p.onPickTask).not.toHaveBeenCalled();
  });
});

/**
 * The complaint this deck was built from: on the light page the ring drained
 * over an empty white circle — no clock, no state, no Start key. Everything in
 * the ring block drew its ink from the INSET-CARD palette, whose text is white
 * in both modes, onto the page itself, which is white. So every assertion here
 * is really one assertion: the readout is on a card, and the card is dark.
 */
describe('the deck is legible on the light page', () => {
  const styleOf = (testID) => StyleSheet.flatten(screen.getByTestId(testID).props.style);
  const light = { ...theme, mode: 'light', colors: { ...theme.colors, background: '#fff', textPrimary: '#111' } };

  test('the clock and the key sit on a dark card, not on the white page', async () => {
    await render(<FocusPage {...props({ theme: light, active: running(60000) })} />);
    const deck = styleOf('focus-deck');
    // The inset card's charcoal, which is what makes the white ink legal.
    expect(deck.backgroundColor).toBe('#1F2024');
    expect(deck.backgroundColor).not.toBe(light.colors.background);
    expect(styleOf('focus-clock').color).toBe('#FFFFFF');
  });

  test('the running key is readable too — it was transparent ink on the page', async () => {
    await render(<FocusPage {...props({ theme: light, active: running(60000) })} />);
    // Stop is an outline key ON the dark deck, so white ink reads. The bug was
    // the same key drawn transparent on a white page: invisible.
    expect(styleOf('focus-toggle').backgroundColor).toBe('transparent');
    expect(screen.getByText('Stop')).toBeTruthy();
    expect(styleOf('focus-deck').backgroundColor).toBe('#1F2024');
  });

  test('the idle key uses the palette’s own on-ink, not the card colour', async () => {
    await render(<FocusPage {...props({ theme: light })} />);
    const key = styleOf('focus-toggle');
    expect(key.backgroundColor).toBe('#FFFFFF');        // pal.text
    expect(StyleSheet.flatten(screen.getByText('Start session').props.style).color).toBe('#1F2024'); // pal.onText
  });

  // The same bug, one section further down: the recent rows were laid straight
  // onto the page while taking their ink from the card palette, so the whole
  // list was white type on cream. Nothing on this page may draw onto the page.
  test('the recent blocks sit on a card too', async () => {
    await render(<FocusPage {...props({ theme: light })} />);
    const panel = styleOf('focus-recent-panel');
    expect(panel.backgroundColor).toBe('#1F2024');
    expect(panel.backgroundColor).not.toBe(light.colors.background);
  });
});

/** The bar replaces the ring, and reads the way the chat card's bar reads. */
describe('the bar', () => {
  const styleOf = (testID) => StyleSheet.flatten(screen.getByTestId(testID).props.style);

  test('fills from the left, on the native driver', async () => {
    await render(<FocusPage {...props({ active: running(60000) })} />);
    const fill = styleOf('focus-bar-fill');
    // scaleX from a left origin, not an animated `width` — width would put the
    // fill on the JS thread and stutter whenever the page is scrolled.
    expect(fill.transformOrigin).toBe('left');
    expect(fill.transform[0]).toHaveProperty('scaleX');
    // Laid out across the whole track and scaled down from there, so scaleX has
    // the full width to work against.
    expect(fill.left).toBe(0);
    expect(fill.right).toBe(0);
  });

  test('has a track behind it whether or not a block is running', async () => {
    await render(<FocusPage {...props()} />);
    expect(styleOf('focus-bar-track').height).toBeGreaterThan(0);
    expect(screen.getByTestId('focus-bar-fill')).toBeTruthy();
  });
});

/**
 * One timer in two places that count differently is two timers as far as anyone
 * using them is concerned. TimerMessage ceils and pads; so does this.
 */
describe('it counts the way the chat card counts', () => {
  test('MM:SS, zero-padded, so the reading never shuffles sideways', async () => {
    await render(<FocusPage {...props({ active: running(9 * 60000 + 5000) })} />);
    expect(screen.getByTestId('focus-clock')).toHaveTextContent('09:05');
  });

  // Flooring shows 24:59 on the first frame of a 25-minute block — a timer that
  // lost a second before it began.
  test('a block reads its full length the instant it starts', async () => {
    await render(<FocusPage {...props({ active: running(25 * 60000 - 1) })} />);
    expect(screen.getByTestId('focus-clock')).toHaveTextContent('25:00');
  });

  // …and the same rounding at the other end: part of a second left is still a
  // second on the clock. Flooring would sit on 00:00 while the block was still
  // running, which is a timer announcing an end it has not reached.
  test('the last part-second still reads 00:01', async () => {
    await render(<FocusPage {...props({ active: running(999) })} />);
    expect(screen.getByTestId('focus-clock')).toHaveTextContent('00:01');
  });

  // Once it is actually over there is no block to count, so the deck offers the
  // next one — the same move the chat card makes when it flips to "completed".
  test('and once the block is over the deck is idle again', async () => {
    const block = running(1000);
    const view = await render(<FocusPage {...props({ active: block })} />);
    await tickTo(block.endsAt);
    await view.rerender(<FocusPage {...props({ active: null })} />);
    expect(screen.getByTestId('focus-clock')).toHaveTextContent('25:00');
    expect(screen.getByText('Start session')).toBeTruthy();
  });

  test('the note says when the block ends, as the chat card does', async () => {
    const block = running(30 * 60000);
    await render(<FocusPage {...props({ active: block })} />);
    const ends = new Date(block.endsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    expect(screen.getByTestId('focus-deck-note')).toHaveTextContent(`ends ~${ends}`);
  });

  test('idle it offers the length of the next block instead', async () => {
    await render(<FocusPage {...props({ focusMinutes: 50, sessions: [] })} />);
    expect(screen.getByTestId('focus-clock')).toHaveTextContent('50:00');
    expect(screen.getByTestId('focus-deck-note')).toHaveTextContent('ready when you are');
  });
});

describe('the sound on completion', () => {
  /**
   * Run a block to its end the way the page really experiences it: mounted and
   * running, then the clock moves past the block's end and the page's own
   * interval notices.
   */
  async function runOut(pastEndMs) {
    const block = running(1000);
    await render(<FocusPage {...props({ active: block })} />);
    await tickTo(block.endsAt + pastEndMs);
  }

  test('a block that reaches zero chimes and buzzes', async () => {
    await runOut(500);
    expect(playFocusComplete).toHaveBeenCalledTimes(1);
    expect(notifyHaptic).toHaveBeenCalledWith('success');
  });

  // Timers are frozen while the app is suspended, so the tick that notices the
  // end can land an hour late. Without the freshness gate, opening the app would
  // chime for a pomodoro that finished while the phone was in a pocket.
  test('a block that ran out while the app was asleep does not chime on resume', async () => {
    await runOut(45 * 60000);
    expect(playFocusComplete).not.toHaveBeenCalled();
    expect(notifyHaptic).not.toHaveBeenCalled();
  });

  // You stopped it. You know. A "well done" chime for a block you walked out of
  // is reading the room exactly wrong.
  test('a block you stop early makes no sound', async () => {
    const block = running(10 * 60000);
    const view = await render(<FocusPage {...props({ active: block })} />);
    // The stop takes the block away well before its end. Awaited, never wrapped
    // in an act() of its own — a rerender drives one, and nesting a second
    // inside it is what "overlapping act() calls" means.
    await view.rerender(<FocusPage {...props({ active: null })} />);
    expect(playFocusComplete).not.toHaveBeenCalled();
    expect(notifyHaptic).not.toHaveBeenCalled();
    expect(screen.getByTestId('focus-clock')).toHaveTextContent('25:00');
  });

  // Arriving on the tab with nothing running is not the end of anything.
  test('simply opening the page is silent', async () => {
    await render(<FocusPage {...props()} />);
    expect(playFocusComplete).not.toHaveBeenCalled();
  });
});

describe('the way into the longer view', () => {
  test('a key for each period, each carrying that period\'s own total', async () => {
    await render(<FocusPage {...props({
      sessions: [
        done({ startedAt: at(0), minutes: 25 }),                     // today, so this week
        done({ startedAt: at(-22, 9), minutes: 30, id: 'month' }),   // earlier this month
        done({ startedAt: new Date(2026, 1, 3, 9).getTime(), minutes: 45, id: 'year' }),
      ],
    })} />);
    for (const range of ['week', 'month', 'year', 'all']) {
      expect(screen.getByTestId(`focus-stats-key-${range}`)).toBeTruthy();
    }
    // The week's key carries the week's figure, not the year's.
    expect(within(screen.getByTestId('focus-stats-key-week')).getByText('25m')).toBeTruthy();
    expect(within(screen.getByTestId('focus-stats-key-all')).getByText('1h 40m')).toBeTruthy();
  });

  test('a key opens the stats panel on its own period', async () => {
    await render(<FocusPage {...props()} />);
    expect(screen.queryByTestId('focus-stats-scroll')).toBeNull();

    await press('focus-stats-key-month');
    expect(screen.getByTestId('focus-stats-scroll')).toBeTruthy();
    // Opened ON September, because September is the key that was pressed.
    expect(within(screen.getByTestId('focus-stats-total')).getByText('September')).toBeTruthy();
    // Closed before the test ends: the panel is a Modal's worth of tree, and
    // unmounting it from RNTL's own cleanup (after the fake clock has already
    // been put back) settles outside act and breaks the NEXT test's render.
    await press('focus-stats-back');
  });

  test('the panel closes back to the page', async () => {
    await render(<FocusPage {...props()} />);
    await press('focus-stats-key-week');
    await press('focus-stats-back');
    expect(screen.queryByTestId('focus-stats-scroll')).toBeNull();
    expect(screen.getByTestId('focus-page')).toBeTruthy();
  });

  test('with no history at all a key is a dash, not a zero or a blank', async () => {
    await render(<FocusPage {...props({ sessions: [] })} />);
    const key = within(screen.getByTestId('focus-stats-key-week'));
    expect(key.getByText('—')).toBeTruthy();
    expect(key.getByText('This week')).toBeTruthy();
    expect(key.getByText('nothing yet')).toBeTruthy();
  });

  // "This week · This week" is a key that says nothing twice. The month and the
  // year DO name themselves, because which one is real information.
  test('a key adds which period it means only where that says something new', async () => {
    await render(<FocusPage {...props({ sessions: [done({ startedAt: at(0) })] })} />);
    expect(within(screen.getByTestId('focus-stats-key-week')).getByText('1 block')).toBeTruthy();
    expect(within(screen.getByTestId('focus-stats-key-month')).getByText('1 block · September')).toBeTruthy();
  });
});

/**
 * RECENT BLOCKS — a record of work you can pick up again.
 *
 * Two things are pinned here. That a block NAMES its task rather than only the
 * board it counted towards, because the name is what the tap resumes; and that
 * the tap is offered exactly when there is something to resume — a loose block,
 * or one whose task has been deleted since, has nothing to start.
 *
 * The contrast half of this change (the rows are inside a card now — they were
 * bare on the page taking white ink from the inset-card palette, so in light
 * mode the whole list was invisible) is not testable from here: it is a colour
 * against a background, and both come from the palette. What IS testable is
 * that the rows draw at all and say the right words.
 */
describe('recent blocks resume', () => {
  const recentProps = (over = {}) => props({
    sessions: [done({ id: 'p1', taskId: 't1' }), done({ id: 'p2', taskId: null, startedAt: at(-1) })],
    taskOfId: (id) => (id === 't1' ? { id: 't1', title: 'Draft the brief' } : null),
    onResumeBlock: jest.fn(),
    ...over,
  });

  test('a block names the task it was for', async () => {
    await render(<FocusPage {...recentProps()} />);
    expect(within(screen.getByTestId('focus-recent-p1')).getByText('Draft the brief')).toBeTruthy();
  });

  test('a block with no task falls back to its board', async () => {
    await render(<FocusPage {...recentProps()} />);
    // taskId null → no board either, so the row says so rather than going blank.
    expect(within(screen.getByTestId('focus-recent-p2')).getByText('No Board')).toBeTruthy();
  });

  test('tapping one starts a fresh session on its task', async () => {
    const p = recentProps();
    await render(<FocusPage {...p} />);
    await press('focus-recent-p1');
    expect(p.onResumeBlock).toHaveBeenCalledTimes(1);
    expect(p.onResumeBlock).toHaveBeenCalledWith({ id: 't1', title: 'Draft the brief' });
  });

  test('a loose block is not a key — there is nothing to resume', async () => {
    const p = recentProps();
    await render(<FocusPage {...p} />);
    expect(screen.queryByTestId('focus-resume-p2')).toBeNull();
    await press('focus-recent-p2');
    expect(p.onResumeBlock).not.toHaveBeenCalled();
  });

  // A task deleted since the block ran cannot be resumed, and a key that does
  // nothing is worse than no key.
  test('a block whose task is gone stops offering to resume it', async () => {
    const p = recentProps({ taskOfId: () => null });
    await render(<FocusPage {...p} />);
    expect(screen.queryByTestId('focus-resume-p1')).toBeNull();
    await press('focus-recent-p1');
    expect(p.onResumeBlock).not.toHaveBeenCalled();
    // It still says where the time went, from the board.
    expect(within(screen.getByTestId('focus-recent-p1')).getByText('Deep work')).toBeTruthy();
  });

  // The key is the whole signal that the row is one.
  test('a resumable block wears the key', async () => {
    await render(<FocusPage {...recentProps()} />);
    expect(screen.getByTestId('focus-resume-p1')).toBeTruthy();
  });
});
