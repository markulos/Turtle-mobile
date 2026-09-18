/**
 * The update LOG: every update the pond has built, newest first, each with the
 * publish message under it saying what was updated — collapsed to the last few
 * behind a More info key.
 *
 * The message only exists on the pond (the Expo manifest carries the protocol
 * fields and the app config, never the note), so the log is fed by
 * GET /mobile-updates/status, not by the native module.
 */
import React from 'react';
import { render, fireEvent, within } from '@testing-library/react-native';
import UpdatesPanel from '../UpdatesPanel';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-constants', () => ({ expoConfig: { version: '1.0.0' } }));
jest.mock('../../utils/haptics', () => ({ tapHaptic: jest.fn() }));
jest.mock('expo-updates', () => ({
  isEnabled: true,
  isEmbeddedLaunch: false,
  updateId: 'DA6F6A56-C0CF-4836-BD93-5D6A4736C6FE',
  createdAt: new Date('2026-09-16T14:02:00Z'),
  channel: 'preview',
  runtimeVersion: '057c3e34830ffbe48f29d13228b1201a6bf32f0d',
  checkForUpdateAsync: jest.fn(() => Promise.resolve({ isAvailable: false })),
  getExtraParamsAsync: jest.fn(() => Promise.resolve({ 'turtle-channel': 'preview' })),
}));
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      mode: 'light',
      colors: {
        background: '#fff', surface: '#F5F5F5', surfaceElevated: '#EEE',
        textPrimary: '#000', textSecondary: '#555', textTertiary: '#888',
        border: '#DDD', accentSuccess: '#22C55E', accentInfo: '#3B82F6', accentWarning: '#F59E0B',
      },
    },
  }),
}));

const UPDATES = [
  { id: '4ca5956c-1918-4512-a3fa-53c2cd5fdf30', createdAt: '2026-09-17T09:00:00Z', provenance: { message: 'Light mode gets depth' } },
  { id: 'bce74a27-97e8-49ee-8027-dbe0848ec33d', createdAt: '2026-09-17T08:00:00Z', provenance: { message: 'Every placeholder is Figtree now' } },
  { id: '04129341-08f3-4f3c-baf4-f5dfb1abbf4e', createdAt: '2026-09-16T23:00:00Z', provenance: { message: 'Task finder matches the board search' } },
  { id: 'da6f6a56-c0cf-4836-bd93-5d6a4736c6fe', createdAt: '2026-09-16T14:02:00Z', provenance: { message: 'Task detail on the sheet shell' } },
  { id: '1a464e4d-1111-2222-3333-444444444444', createdAt: '2026-09-15T10:00:00Z', provenance: {} },
];
const STATUS = {
  success: true,
  signing: true,
  channels: {
    preview: { current: '4ca5956c-1918-4512-a3fa-53c2cd5fdf30', history: ['a', 'b'] },
    production: { current: '04129341-08f3-4f3c-baf4-f5dfb1abbf4e', history: ['a', 'b'] },
  },
  updates: UPDATES,
};
const mockApi = { get: jest.fn(() => Promise.resolve(STATUS)), post: jest.fn() };
jest.mock('../../context/ServerContext', () => ({
  useServer: () => ({ api: mockApi, isConnected: true }),
}));

// Under jest `__DEV__` is true, which the panel reads as a development client
// — the one build where updates do not apply and it offers nothing at all.
// This suite is about a real build.
const realDev = global.__DEV__;
beforeAll(() => { global.__DEV__ = false; });
afterAll(() => { global.__DEV__ = realDev; });

const open = async () => {
  const view = await render(<UpdatesPanel />);
  // Let the status fetch land.
  await view.findByTestId('updates-log');
  return view;
};

describe('the update log', () => {
  test('shows the last three, each with what it changed', async () => {
    const view = await open();
    expect(view.getByText('Light mode gets depth')).toBeTruthy();
    expect(view.getByText('Every placeholder is Figtree now')).toBeTruthy();
    expect(view.getByText('Task finder matches the board search')).toBeTruthy();
    // The fourth is behind More info.
    expect(view.queryByText('Task detail on the sheet shell')).toBeNull();
  });

  test('More info opens the rest, and says how many that is', async () => {
    const view = await open();
    const more = view.getByTestId('updates-log-more');
    expect(more).toBeTruthy();
    expect(view.getByText('More info · 2 more')).toBeTruthy();
    await fireEvent.press(more);
    expect(view.getByText('Task detail on the sheet shell')).toBeTruthy();
    expect(view.getByText('Show less')).toBeTruthy();
  });

  test('an update with no publish message still says something', async () => {
    const view = await open();
    await fireEvent.press(view.getByTestId('updates-log-more'));
    expect(view.getByText('No description given.')).toBeTruthy();
  });

  test('marks the one this phone is RUNNING, and each channel head', async () => {
    const view = await open();
    await fireEvent.press(view.getByTestId('updates-log-more'));
    // Asserted INSIDE each row: "preview" also names a channel in the releases
    // block above and in the facts line, so a bare text query is ambiguous.
    // iOS reports updateId upper-cased while the pond stores it lower — the
    // tag still has to land on the right row.
    expect(within(view.getByTestId('updates-log-da6f6a56')).getByText('running')).toBeTruthy();
    expect(within(view.getByTestId('updates-log-4ca5956c')).getByText('preview')).toBeTruthy();
    expect(within(view.getByTestId('updates-log-04129341')).getByText('production')).toBeTruthy();
    // And not on the wrong one.
    expect(within(view.getByTestId('updates-log-bce74a27')).queryByText('running')).toBeNull();
  });
});
