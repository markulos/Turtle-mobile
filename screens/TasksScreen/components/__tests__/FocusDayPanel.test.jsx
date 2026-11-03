/**
 * The arithmetic is covered by utils/focusDay's own tests. What this pins is
 * the part a pure function cannot: that the panel SAYS the right thing in the
 * cases where a wrong sentence is worse than no sentence — a first-ever
 * Tuesday, a day with nothing on it, and a day that beat every other one.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../../../utils/haptics', () => ({ tapHaptic: jest.fn() }));
jest.mock('../StatsPanel', () => ({
  RAMP: ['#1', '#2', '#3', '#4', '#5'],
  rampStep: (v) => (v > 0 ? 2 : -1),
}));

import FocusDayPanel from '../FocusDayPanel';

const theme = {
  mode: 'dark',
  colors: { background: '#000', textPrimary: '#fff', border: '#333' },
};
const pal = {
  card: '#17171A', text: '#F2F2F4', muted: '#888', track: '#222',
  edge: '#333', edgeTop: '#444', tile: '#242429',
};

// 2026-11-03 is a Tuesday.
const at = (y, m, d, hh = 9, mm = 0) => new Date(y, m - 1, d, hh, mm, 0).getTime();
const TUE = at(2026, 11, 3, 12);
const block = (ms, mins, over = {}) => ({
  id: `p-${ms}-${mins}`,
  status: 'completed',
  startedAt: ms,
  completedAt: ms + mins * 60000,
  durationMinutes: mins,
  ...over,
});

const open = (sessions, props = {}) => render(
  <FocusDayPanel
    sessions={sessions}
    pal={pal}
    theme={theme}
    dayMs={TUE}
    onClose={jest.fn()}
    {...props}
  />,
);

describe('the day, and what it was worth', () => {
  test('the hero is the day’s own total', async () => {
    const view = await open([block(at(2026, 11, 3, 9), 75)]);
    expect(view.getByTestId('focus-day-total')).toHaveTextContent('1h 15m');
  });

  test('the title names the day, not just "today"', async () => {
    const view = await open([]);
    expect(view.getByText(/Tuesday, November 3/)).toBeTruthy();
  });

  // The verdict line is the first thing read, so the three awkward cases each
  // get their own sentence rather than a misleading percentage.
  test('a first-ever Tuesday says so instead of comparing with nothing', async () => {
    const view = await open([block(at(2026, 11, 3, 9), 75)]);
    expect(view.getByText(/first Tuesday with focus/)).toBeTruthy();
  });

  test('a day with nothing on it says that, and claims no percentage', async () => {
    const view = await open([block(at(2026, 10, 27, 9), 60)]);
    expect(view.getByText(/Nothing on this Tuesday yet/)).toBeTruthy();
    expect(view.getByTestId('focus-day-total')).toHaveTextContent('—');
  });

  test('with history, it compares against the other Tuesdays', async () => {
    const view = await open([
      block(at(2026, 11, 3, 9), 75),
      block(at(2026, 10, 27, 9), 30),
      block(at(2026, 10, 20, 9), 90),
    ]);
    // Other Tuesdays average 60; 75 is 25% above — and crucially NOT the 15%
    // it would read if today were averaged in with itself.
    expect(view.getByText(/25% above your usual 1h on a Tuesday/)).toBeTruthy();
  });

  test('dead level is said in words, not as "0% above"', async () => {
    const view = await open([
      block(at(2026, 11, 3, 9), 60),
      block(at(2026, 10, 27, 9), 60),
    ]);
    expect(view.getByText(/Level with your usual 1h on a Tuesday/)).toBeTruthy();
  });
});

describe('the comparisons', () => {
  const sessions = [
    block(at(2026, 11, 3, 9), 75, { taskId: 't1' }),
    block(at(2026, 10, 27, 9), 30, { taskId: 't1' }),
    block(at(2026, 10, 28, 9), 600, { taskId: 't2' }), // a Wednesday
  ];

  test('your weekday rank, and your rank among all days, are different facts', async () => {
    const view = await open(sessions);
    // Best of two Tuesdays…
    expect(view.getByText('1st')).toBeTruthy();
    // …but only the second best day, because of that Wednesday.
    expect(view.getByText('2nd')).toBeTruthy();
  });

  test('a best-ever weekday is said outright rather than as a date', async () => {
    const view = await open(sessions);
    expect(view.getByText('Your best Tuesday yet.')).toBeTruthy();
  });

  test('all-time context counts only days that had focus', async () => {
    const view = await open(sessions);
    expect(view.getByText(/3 days with focus/)).toBeTruthy();
  });
});

describe('the detail', () => {
  const sessions = [
    block(at(2026, 11, 3, 9, 0), 25, { taskId: 't1' }),
    block(at(2026, 11, 3, 14, 30), 50, { taskId: 't2' }),
    { id: 'x', status: 'cancelled', startedAt: at(2026, 11, 3, 16), taskId: 't1' },
  ];
  const boardOf = (id) => (id === 't1' ? 'Job search' : 'Larkin Architect');

  test('where the time went, heaviest first', async () => {
    const view = await open(sessions, { boardOfTask: boardOf });
    expect(view.getByTestId('focus-day-boards')).toBeTruthy();
    // Twice each: once as a bar in "Where it went", once as the block's own
    // line below — with no task title to show, a block falls back to its
    // board, which is the most useful thing left to call it.
    expect(view.getAllByText('Larkin Architect').length).toBeGreaterThan(0);
    expect(view.getAllByText('Job search').length).toBeGreaterThan(0);
    // Heaviest first: the 50m board leads the 25m one.
    expect(view.getAllByText('50m').length).toBeGreaterThan(0);
  });

  test('the blocks are listed with their titles where there are any', async () => {
    const view = await open(sessions, {
      boardOfTask: boardOf,
      taskOfId: (id) => ({ title: id === 't1' ? 'Rewrite the cover letter' : 'Stair details' }),
    });
    expect(view.getByText('Rewrite the cover letter')).toBeTruthy();
    expect(view.getByText('Stair details')).toBeTruthy();
  });

  // Shown as context for the completed figure, not as a telling-off — but it
  // must be shown, or the total above it is only half the day.
  test('attempts that were not finished are counted out loud', async () => {
    const view = await open(sessions, { boardOfTask: boardOf });
    expect(view.getByTestId('focus-day-abandoned')).toHaveTextContent('1 block started and not finished');
  });

  test('a day with no abandoned blocks says nothing about them', async () => {
    const view = await open([block(at(2026, 11, 3, 9), 25)]);
    expect(view.queryByTestId('focus-day-abandoned')).toBeNull();
  });

  test('the first-to-last span is the day’s shape in one line', async () => {
    const view = await open(sessions, { boardOfTask: boardOf });
    expect(view.getByTestId('focus-day-span')).toHaveTextContent(/First to last/);
  });
});
