import React from 'react';
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
  onStop: jest.fn(),
  theme,
  ...over,
});

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
 * `fireEvent.press` runs the handler inside a SYNCHRONOUS act, which is enough
 * when the assertion is "the callback fired" but not when it is "the page now
 * shows something else" — in this async-act environment the commit lands one
 * microtask later. Asserting between the two is how you get a passing press and
 * an empty screen.
 */
async function press(testID) {
  fireEvent.press(screen.getByTestId(testID));
  await act(async () => {});
}

describe('the countdown lives on this page', () => {
  // The complaint this page was rebuilt around: starting a block used to throw
  // you onto the chat tab, so the page with the ring on it was the one page
  // that never showed a running block.
  test('a running block counts down on the ring, and the key becomes Stop', async () => {
    await render(<FocusPage {...props({ active: running(9 * 60000 + 5000) })} />);
    expect(screen.getByTestId('focus-clock')).toHaveTextContent('9:05');
    expect(screen.getByText('Stop')).toBeTruthy();
    expect(screen.getByText('focusing')).toBeTruthy();
  });

  test('the ring ticks down as the block burns', async () => {
    await render(<FocusPage {...props({ active: running(90000) })} />);
    expect(screen.getByTestId('focus-clock')).toHaveTextContent('1:30');
    await tickTo(NOW + 31000);
    expect(screen.getByTestId('focus-clock')).toHaveTextContent('0:59');
  });

  test('idle, the ring shows the length the next block will run', async () => {
    await render(<FocusPage {...props({ focusMinutes: 50 })} />);
    expect(screen.getByTestId('focus-clock')).toHaveTextContent('50:00');
    expect(screen.getByText('Start focus')).toBeTruthy();
  });

  // A loose block — one with no task pinned to it, which is what the tab's own
  // key starts — must drive the ring exactly as a task-linked one does.
  test('a block with no task still runs the ring', async () => {
    await render(<FocusPage {...props({ active: { ...running(60000), taskId: null } })} />);
    expect(screen.getByTestId('focus-clock')).toHaveTextContent('1:00');
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
