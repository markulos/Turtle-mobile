/**
 * useUpdateHeadline — the profile card's answer to "is there a new version,
 * and what does it change?".
 *
 * Driven through a host component rather than renderHook, which this setup
 * can't use (see the RNTL act notes). What's worth pinning:
 *   • the line quotes the pond's PUBLISH MESSAGE, not an update id;
 *   • a waiting update's note wins over the running one's;
 *   • a development client is never asked — every Updates API throws there,
 *     and a card that invites a pointless tap is worse than one that explains;
 *   • a non-owner (403 on /status) still gets a true line, just without a note.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import useUpdateHeadline from '../useUpdateHeadline';

// The factory must BUILD the module, not hand back a const declared below it:
// jest.mock is hoisted above the imports, so `expo-updates` is required — and
// the factory run — while such a const is still in its temporal dead zone. The
// module then resolves to undefined and every read off it is silently
// undefined, which looks exactly like a failing update check.
jest.mock('expo-updates', () => ({
  isEnabled: true,
  isEmbeddedLaunch: false,
  updateId: 'DA6F6A56-C0CF-4836-BD93-5D6A4736C6FE',
  createdAt: new Date('2026-09-16T14:02:00Z'),
  checkForUpdateAsync: jest.fn(),
}));
const mockUpdates = jest.requireMock('expo-updates');

const mockApi = { get: jest.fn() };
jest.mock('../../context/ServerContext', () => ({
  useServer: () => ({ api: mockApi, isConnected: true }),
}));

const STATUS = {
  success: true,
  updates: [
    { id: '7d0ef475-8979-4836-8421-5d6a4736c6fe', provenance: { message: 'Sheet footers clear the home indicator' } },
    { id: 'da6f6a56-c0cf-4836-bd93-5d6a4736c6fe', provenance: { message: 'Task detail card on the app sheet shell' } },
  ],
};

function Host() {
  const { summary } = useUpdateHeadline();
  return <Text testID="line">{summary.line}</Text>;
}

describe('useUpdateHeadline', () => {
  const realDev = global.__DEV__;
  beforeEach(() => {
    jest.clearAllMocks();
    global.__DEV__ = false; // a real build; the dev-client case has its own test
    mockApi.get.mockResolvedValue(STATUS);
  });
  afterAll(() => { global.__DEV__ = realDev; });

  test('with nothing newer, it says what the RUNNING update changed', async () => {
    mockUpdates.checkForUpdateAsync.mockResolvedValue({ isAvailable: false });
    const view = await render(<Host />);
    await waitFor(() => {
      expect(view.getByTestId('line').props.children)
        .toBe('Up to date · Task detail card on the app sheet shell');
    });
  });

  test('with one waiting, it says what the WAITING update changes', async () => {
    mockUpdates.checkForUpdateAsync.mockResolvedValue({
      isAvailable: true,
      manifest: { id: '7d0ef475-8979-4836-8421-5d6a4736c6fe', createdAt: '2026-09-16T23:30:00Z' },
    });
    const view = await render(<Host />);
    await waitFor(() => {
      expect(view.getByTestId('line').props.children)
        .toBe('Update ready · Sheet footers clear the home indicator');
    });
  });

  test('a non-owner gets a true line without a note, and no crash', async () => {
    mockUpdates.checkForUpdateAsync.mockResolvedValue({ isAvailable: false });
    mockApi.get.mockRejectedValue(new Error('403 forbidden'));
    const view = await render(<Host />);
    await waitFor(() => {
      expect(view.getByTestId('line').props.children).toMatch(/^Up to date · update da6f6a56/);
    });
  });

  test('a development client is never asked to check', async () => {
    global.__DEV__ = true;
    const view = await render(<Host />);
    expect(view.getByTestId('line').props.children).toMatch(/Development build/);
    expect(mockUpdates.checkForUpdateAsync).not.toHaveBeenCalled();
    expect(mockApi.get).not.toHaveBeenCalled();
  });

  test('the check is metadata only — nothing is fetched or reloaded', async () => {
    mockUpdates.checkForUpdateAsync.mockResolvedValue({ isAvailable: true, manifest: { id: 'x' } });
    await render(<Host />);
    await waitFor(() => expect(mockUpdates.checkForUpdateAsync).toHaveBeenCalled());
    expect(mockUpdates.fetchUpdateAsync).toBeUndefined();
    expect(mockUpdates.reloadAsync).toBeUndefined();
  });
});
