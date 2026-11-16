import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../utils/haptics', () => ({ impactHaptic: jest.fn(), tapHaptic: jest.fn() }));
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({
    theme: { mode: 'light', colors: new Proxy({}, { get: (_, k) => (k === 'accent' ? '#6C7321' : '#888888') }) },
  }),
}));
jest.mock('expo-updates', () => ({ fetchUpdateAsync: jest.fn(), reloadAsync: jest.fn() }), { virtual: true });
jest.mock('../../services/launchUpdate', () => ({ launchCheckSettled: jest.fn(() => Promise.resolve()) }));

import UpdateReadyPrompt from '../UpdateReadyPrompt';
import { launchCheckSettled } from '../../services/launchUpdate';

/**
 * The one button, and what it actually does.
 *
 * Mark asked for "just a button to update and restart". The thing worth
 * pinning is the ORDER it does things in, because every step of it is a
 * failure that only shows up on a real phone: a fetch that collides with the
 * launch check, a reload that never comes, a spinner with no way out.
 */

const updates = () => ({
  fetchUpdateAsync: jest.fn(() => Promise.resolve({ isNew: false })),
  reloadAsync: jest.fn(() => new Promise(() => {})),   // the app relaunches; this never resolves
});

describe('UpdateReadyPrompt', () => {
  beforeEach(() => { launchCheckSettled.mockClear(); });

  test('renders nothing until there is something to offer', async () => {
    const view = await render(<UpdateReadyPrompt visible={false} />);
    expect(view.queryByTestId('update-ready-prompt')).toBeNull();
  });

  test('one prominent button, and one quiet way past it', async () => {
    const view = await render(<UpdateReadyPrompt visible />);
    const apply = view.getByTestId('update-ready-apply');
    const dismiss = view.getByTestId('update-ready-dismiss');
    expect(apply.props.accessibilityLabel).toMatch(/restart/i);
    expect(dismiss.props.accessibilityLabel).toMatch(/not now/i);
  });

  test('it WAITS for the launch check before fetching — two fetches is an error', async () => {
    // expo-updates will not take two fetchUpdateAsync at once, and the
    // foreground re-check may be mid-flight when this is tapped. After it,
    // the fetch is a no-op that returns what is already on disk.
    const u = updates();
    const view = await render(<UpdateReadyPrompt visible updates={u} />);
    await act(async () => { fireEvent.press(view.getByTestId('update-ready-apply')); });
    expect(launchCheckSettled).toHaveBeenCalled();
    expect(u.fetchUpdateAsync).toHaveBeenCalled();
    expect(u.reloadAsync).toHaveBeenCalled();
    // …and in that order.
    expect(launchCheckSettled.mock.invocationCallOrder[0])
      .toBeLessThan(u.fetchUpdateAsync.mock.invocationCallOrder[0]);
    expect(u.fetchUpdateAsync.mock.invocationCallOrder[0])
      .toBeLessThan(u.reloadAsync.mock.invocationCallOrder[0]);
  });

  test('a second tap while it is working does nothing', async () => {
    // The button becomes a spinner, but a fast double-tap lands before the
    // re-render — and two reloads is a race for which bundle launches.
    const u = updates();
    const view = await render(<UpdateReadyPrompt visible updates={u} />);
    const apply = view.getByTestId('update-ready-apply');
    await act(async () => { fireEvent.press(apply); fireEvent.press(apply); });
    expect(u.fetchUpdateAsync).toHaveBeenCalledTimes(1);
  });

  test('A FAILURE LEAVES A WAY OUT — not a sheet with a spinning button', async () => {
    // Offline, or a pond that has gone away mid-tap. The update is still on
    // the phone and still applies on the next cold start, so the worst thing
    // this could do is trap somebody behind a dead button.
    const u = {
      fetchUpdateAsync: jest.fn(() => Promise.reject(new Error('network'))),
      reloadAsync: jest.fn(),
    };
    const onDismiss = jest.fn();
    const view = await render(<UpdateReadyPrompt visible updates={u} onDismiss={onDismiss} />);
    await act(async () => { fireEvent.press(view.getByTestId('update-ready-apply')); });
    expect(view.getByTestId('update-ready-error')).toBeTruthy();
    expect(u.reloadAsync).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(view.getByTestId('update-ready-dismiss')); });
    expect(onDismiss).toHaveBeenCalled();
  });

  test('dismissing hands back to the caller, which owns the latch', async () => {
    const onDismiss = jest.fn();
    const view = await render(<UpdateReadyPrompt visible onDismiss={onDismiss} />);
    await act(async () => { fireEvent.press(view.getByTestId('update-ready-dismiss')); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
