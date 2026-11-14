import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../../../utils/haptics', () => ({ tapHaptic: jest.fn() }));
jest.mock('../../../../components/AnimalAvatar', () => 'AnimalAvatar');
jest.mock('../../../TurtleScreen/components/EdgeSwipePage', () => {
  const { View } = require('react-native');
  return ({ visible, children }) => (visible ? <View>{children}</View> : null);
});

const mockApi = { get: jest.fn(), post: jest.fn() };
jest.mock('../../../../context/ServerContext', () => ({
  useServer: () => ({ api: mockApi }),
}));

import NotificationsPage from '../NotificationsPage';
import {
  __resetAttention, getAttention, registerAttentionRefresh, setAttention,
} from '../../../../utils/attention';

/**
 * The page behind the Profile tab's "new notification" count.
 *
 * The contract worth pinning is the one between opening the page and the dot:
 * looking at the list IS reading it, so the count clears the moment the list
 * arrives — and comes back if the pond never heard about it.
 */

const theme = {
  colors: {
    background: '#000', textPrimary: '#fff', textSecondary: '#ccc', textTertiary: '#999',
    textMuted: '#777', accent: '#1F8A9B', border: '#222',
  },
};
const insets = { top: 59, bottom: 34, left: 0, right: 0 };

const note = (over = {}) => ({
  id: 'ntf-1', taskId: 't9', type: 'comment', actorId: 'u2', actorName: 'Ana',
  taskTitle: 'Order the tiles', taskItemType: 'task', taskExists: true,
  preview: 'Which grey?', createdAt: Date.now() - 60_000, readAt: null, ...over,
});

const mount = (props = {}) => render(
  <NotificationsPage visible onClose={jest.fn()} onOpenTask={jest.fn()} theme={theme} insets={insets} {...props} />,
);

beforeEach(() => {
  __resetAttention();
  mockApi.get.mockReset();
  mockApi.post.mockReset();
  mockApi.post.mockResolvedValue({ success: true });
});

test('closed, it asks the pond for nothing', async () => {
  await mount({ visible: false });
  expect(mockApi.get).not.toHaveBeenCalled();
});

test('opening it shows what happened, and marks it read', async () => {
  mockApi.get.mockResolvedValue({ success: true, unread: 1, notifications: [note()] });
  setAttention({ notifications: 1 });
  await mount();

  await waitFor(() => expect(screen.getByText('Ana commented on your task')).toBeTruthy());
  expect(screen.getByText('Order the tiles')).toBeTruthy();
  expect(screen.getByText('Which grey?')).toBeTruthy();

  // Everything of mine, in one call — no ids.
  await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/notifications/read', {}));
  // The tab's dot went out at once…
  expect(getAttention().notifications).toBe(0);
  // …but the row that WAS new still shows as new for this visit.
  expect(screen.getByTestId('notification-unread-ntf-1')).toBeTruthy();
});

test('nothing unread: nothing is written to the pond', async () => {
  mockApi.get.mockResolvedValue({ success: true, unread: 0, notifications: [note({ readAt: 123 })] });
  await mount();
  await waitFor(() => expect(screen.getByText('Order the tiles')).toBeTruthy());
  expect(mockApi.post).not.toHaveBeenCalled();
});

test('a mark-read that fails asks for the truth, so the dot is not left lying', async () => {
  mockApi.get.mockResolvedValue({ success: true, unread: 1, notifications: [note()] });
  mockApi.post.mockRejectedValue(new Error('offline'));
  const refresh = jest.fn();
  registerAttentionRefresh(refresh);
  await mount();
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
});

test('a row opens the task it is about', async () => {
  mockApi.get.mockResolvedValue({ success: true, unread: 0, notifications: [note({ readAt: 1 })] });
  const onOpenTask = jest.fn();
  await mount({ onOpenTask });
  const row = await waitFor(() => screen.getByTestId('notification-row-ntf-1'));
  await act(async () => { fireEvent.press(row); });
  expect(onOpenTask).toHaveBeenCalledWith({ id: 't9', title: 'Order the tiles' });
});

test('a row about a DELETED task goes nowhere', async () => {
  mockApi.get.mockResolvedValue({
    success: true, unread: 0,
    notifications: [note({ taskExists: false, taskTitle: '(deleted)', readAt: 1 })],
  });
  const onOpenTask = jest.fn();
  await mount({ onOpenTask });
  const row = await waitFor(() => screen.getByTestId('notification-row-ntf-1'));
  await act(async () => { fireEvent.press(row); });
  expect(onOpenTask).not.toHaveBeenCalled();
});

test('an empty list says what the page is for; a failed load says to try again', async () => {
  mockApi.get.mockResolvedValue({ success: true, unread: 0, notifications: [] });
  const first = await mount();
  await waitFor(() => expect(screen.getByText('Nothing new')).toBeTruthy());
  await first.unmount();

  mockApi.get.mockRejectedValue(new Error('offline'));
  await mount();
  await waitFor(() => expect(screen.getByText('Could not load your notifications')).toBeTruthy());
  expect(screen.getByText('Pull down to try again.')).toBeTruthy();
});

test('it loads again EVERY time it is opened', async () => {
  // A page that loaded once would show yesterday's list for the whole session.
  mockApi.get.mockResolvedValue({ success: true, unread: 0, notifications: [] });
  const view = await mount();
  await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(1));
  const props = { onClose: jest.fn(), onOpenTask: jest.fn(), theme, insets };
  await view.rerender(<NotificationsPage visible={false} {...props} />);
  await view.rerender(<NotificationsPage visible {...props} />);
  await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2));
});
