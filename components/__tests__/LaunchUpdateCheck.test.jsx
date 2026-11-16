import React from 'react';
import { AppState } from 'react-native';
import { act, render } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../utils/haptics', () => ({ impactHaptic: jest.fn(), tapHaptic: jest.fn() }));
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: { mode: 'light', colors: new Proxy({}, { get: () => '#888888' }) } }),
}));
jest.mock('expo-updates', () => ({ fetchUpdateAsync: jest.fn(), reloadAsync: jest.fn() }), { virtual: true });

// `mock`-prefixed, which is the one name jest lets a factory close over.
const mockCheck = jest.fn();
jest.mock('../../services/launchUpdate', () => ({
  LAUNCH_DELAY_MS: 1500,
  checkAndDownload: (...a) => mockCheck(...a),
  lastLaunchCheckAt: () => 0,
  shouldRecheck: () => true,
  launchCheckSettled: () => Promise.resolve(),
}));

import LaunchUpdateCheck from '../LaunchUpdateCheck';

const checkAndDownload = mockCheck;

/**
 * The autocheck, and the one thing that makes it a prompt rather than a nag.
 *
 * Mark: "anytime the app opens, have an autocheck … and if there is, prompt
 * user to update now." The check itself was already there; what is pinned
 * here is that it OFFERS once and then stops, because the foreground
 * re-check resolves `ready` every half hour for as long as the update sits
 * on the phone.
 */

const foreground = async () => {
  const calls = AppState.addEventListener.mock
    ? AppState.addEventListener.mock.calls
    : [];
  for (const [, fn] of calls) await act(async () => { fn('active'); });
};

describe('LaunchUpdateCheck', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    checkAndDownload.mockReset().mockResolvedValue('ready');
  });
  afterEach(() => { jest.useRealTimers(); });

  test('checks shortly after launch, not on the first frame', async () => {
    const view = await render(<LaunchUpdateCheck />);
    expect(checkAndDownload).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(1500); });
    expect(checkAndDownload).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('update-ready-prompt')).toBeTruthy();
  });

  test('says NOTHING when there is nothing to say', async () => {
    for (const result of ['current', 'error', 'skipped']) {
      checkAndDownload.mockResolvedValue(result);
      const view = await render(<LaunchUpdateCheck />);
      await act(async () => { jest.advanceTimersByTime(1500); });
      expect(view.queryByTestId('update-ready-prompt')).toBeNull();
    }
  });

  test('a check that throws is swallowed — no prompt, no crash', async () => {
    checkAndDownload.mockRejectedValue(new Error('offline'));
    const view = await render(<LaunchUpdateCheck />);
    await act(async () => { jest.advanceTimersByTime(1500); });
    expect(view.queryByTestId('update-ready-prompt')).toBeNull();
  });

  test('ONCE PER LAUNCH — dismissed stays dismissed', async () => {
    // The re-check on foregrounding resolves `ready` again, because the
    // update is still sitting there. Without the latch this reappears every
    // half hour all day. The latch is a ref for a reason: the AppState
    // listener closes over the render that registered it, and a stale state
    // value would read `false` for ever.
    const view = await render(<LaunchUpdateCheck />);
    await act(async () => { jest.advanceTimersByTime(1500); });
    expect(view.getByTestId('update-ready-prompt')).toBeTruthy();

    await act(async () => {
      const { fireEvent } = require('@testing-library/react-native');
      fireEvent.press(view.getByTestId('update-ready-dismiss'));
    });
    expect(view.queryByTestId('update-ready-prompt')).toBeNull();

    // …and coming back to the foreground does not bring it back.
    await foreground();
    expect(view.queryByTestId('update-ready-prompt')).toBeNull();
  });

  test('it registers for the foreground, and tears BOTH down with the component', async () => {
    // Moved here from AttentionSync.test when this grew a sheet: importing it
    // there pulled ThemeContext, and with it AsyncStorage, into a suite that
    // only wanted to count unread messages.
    const remove = jest.fn();
    const spy = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove });
    try {
      const view = await render(<LaunchUpdateCheck />);
      expect(spy).toHaveBeenCalledWith('change', expect.any(Function));
      await view.unmount();
      expect(remove).toHaveBeenCalledTimes(1);
      // Unmounted before its delay: the timer must not fire into nothing.
      await act(async () => { jest.advanceTimersByTime(5000); });
      expect(checkAndDownload).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
