/**
 * The app-level driver for the iOS Live Activity and the completion confetti.
 * The RULES are pinned in utils/__tests__/pomodoroState.test.js; this proves
 * the wiring — that each decision reaches the right service call, once, from a
 * component that has no tab to wait for.
 */
import React from 'react';
import { Platform } from 'react-native';
import { render } from '@testing-library/react-native';

let mockView = null;
const mockCelebrate = jest.fn();
jest.mock('../../context/DownloadsContext', () => ({
  useSyncSignals: () => ({ pomodoroView: mockView }),
}));
jest.mock('../../context/CelebrationContext', () => ({
  useCelebration: () => ({ celebrate: mockCelebrate }),
}));
jest.mock('../../services/liveActivity', () => ({
  showRunning: jest.fn(),
  showCompleted: jest.fn(),
  clear: jest.fn(),
}));

import * as liveActivity from '../../services/liveActivity';
import PomodoroLiveEffects from '../PomodoroLiveEffects';

// Real clock: the freshness window is two minutes, far longer than a test.
const NOW = Date.now();
const running = { status: 'active', mode: 'focus', totalDuration: 1500, startedAt: NOW - 100, endsAt: NOW + 1400 };
const finished = (mode = 'focus', endedAt = NOW - 1000) => ({
  status: 'completed', mode, totalDuration: 1500, startedAt: endedAt - 1500, endedAt,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockView = null;
});

const show = async (view, screen) => {
  mockView = view;
  await screen.rerender(<PomodoroLiveEffects />);
};

test('a focus block watched from start to finish: countdown on the island, then the done card and confetti — once', async () => {
  const screen = await render(<PomodoroLiveEffects />);
  // Nothing running at boot: the island is cleared, nothing celebrates.
  expect(liveActivity.clear).toHaveBeenCalledTimes(1);
  expect(mockCelebrate).not.toHaveBeenCalled();

  await show(running, screen);
  expect(liveActivity.showRunning).toHaveBeenCalledWith('focus', NOW + 1400);

  await show(finished(), screen);
  expect(liveActivity.showCompleted).toHaveBeenCalledWith('focus');
  expect(mockCelebrate).toHaveBeenCalledTimes(1);
  expect(mockCelebrate).toHaveBeenCalledWith({ points: 25, kind: 'pomodoro' });

  // The same completion arriving again (the pond replays on every reconnect)
  // is not a second party.
  await show(finished(), screen);
  expect(mockCelebrate).toHaveBeenCalledTimes(1);

  // Dismissed — the shared view goes null — and the island clears with it.
  await show(null, screen);
  expect(liveActivity.clear).toHaveBeenCalledTimes(2);
});

test('a stale completion replayed on app open clears the island and earns nothing', async () => {
  mockView = finished('focus', NOW - 10 * 60 * 1000);
  await render(<PomodoroLiveEffects />);
  expect(liveActivity.clear).toHaveBeenCalledTimes(1);
  expect(liveActivity.showCompleted).not.toHaveBeenCalled();
  expect(mockCelebrate).not.toHaveBeenCalled();
});

test('a fresh completion the app reconnected to shows the done card but, unwatched, no confetti', async () => {
  mockView = finished('focus', NOW - 30_000);
  await render(<PomodoroLiveEffects />);
  expect(liveActivity.showCompleted).toHaveBeenCalledWith('focus');
  expect(mockCelebrate).not.toHaveBeenCalled();
});

test('a break that runs out gets the done card and no confetti', async () => {
  const screen = await render(<PomodoroLiveEffects />);
  await show({ ...running, mode: 'break' }, screen);
  await show(finished('break'), screen);
  expect(liveActivity.showCompleted).toHaveBeenCalledWith('break');
  expect(mockCelebrate).not.toHaveBeenCalled();
});

test('off iOS the island is never touched, but confetti still fires', async () => {
  const os = Platform.OS;
  Platform.OS = 'android';
  try {
    const screen = await render(<PomodoroLiveEffects />);
    await show(running, screen);
    await show(finished(), screen);
    expect(liveActivity.showRunning).not.toHaveBeenCalled();
    expect(liveActivity.showCompleted).not.toHaveBeenCalled();
    expect(liveActivity.clear).not.toHaveBeenCalled();
    expect(mockCelebrate).toHaveBeenCalledTimes(1);
  } finally {
    Platform.OS = os;
  }
});
