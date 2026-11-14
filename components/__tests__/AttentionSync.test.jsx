import React from 'react';
import { AppState } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';

const mockApi = { get: jest.fn() };
const mockWorld = { isConnected: true, isAuthenticated: true, messagesVersion: 0, tasksVersion: 0 };
jest.mock('../../context/ServerContext', () => ({
  useServer: () => ({ api: mockApi, isConnected: mockWorld.isConnected }),
}));
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: mockWorld.isAuthenticated }),
}));
jest.mock('../../context/DownloadsContext', () => ({
  useSyncSignals: () => ({ messagesVersion: mockWorld.messagesVersion, tasksVersion: mockWorld.tasksVersion }),
}));

import AttentionSync, { TASK_PING_DEBOUNCE_MS } from '../AttentionSync';
import LaunchUpdateCheck from '../LaunchUpdateCheck';
import { __resetAttention, getAttention, requestAttentionRefresh, setAttention } from '../../utils/attention';

/**
 * The Profile tab's dot is fed from the app root, because the Profile tab is
 * lazy and cannot count what is waiting on it until it has been opened. The
 * rule under test is the app's own: nothing is fetched only once.
 */

const answers = ({ unreadDms = 0, notifications = 0 } = {}) => {
  mockApi.get.mockImplementation(async (path) => (path === '/messages'
    ? { success: true, threads: unreadDms ? [{ withUserId: 'u2', withName: 'Ana', unread: unreadDms, last: { content: 'hi', createdAt: 1 } }] : [] }
    : { success: true, unread: notifications, notifications: [] }));
};
const calls = (path) => mockApi.get.mock.calls.filter(([p]) => p === path).length;

beforeEach(() => {
  __resetAttention();
  mockApi.get.mockReset();
  Object.assign(mockWorld, { isConnected: true, isAuthenticated: true, messagesVersion: 0, tasksVersion: 0 });
});

test('signed in and connected, it counts both', async () => {
  answers({ unreadDms: 2, notifications: 1 });
  await render(<AttentionSync />);
  await waitFor(() => expect(getAttention()).toMatchObject({ messages: 2, notifications: 1 }));
});

test('signed out or offline, it asks for nothing', async () => {
  answers({ unreadDms: 2 });
  mockWorld.isAuthenticated = false;
  const view = await render(<AttentionSync />);
  expect(mockApi.get).not.toHaveBeenCalled();

  mockWorld.isAuthenticated = true;
  mockWorld.isConnected = false;
  await view.rerender(<AttentionSync />);
  expect(mockApi.get).not.toHaveBeenCalled();

  // …and the moment the pond is reachable it asks, without being told to.
  mockWorld.isConnected = true;
  await view.rerender(<AttentionSync />);
  await waitFor(() => expect(getAttention().messages).toBe(2));
});

test('signing out clears what was waiting', async () => {
  answers({ unreadDms: 3, notifications: 2 });
  const view = await render(<AttentionSync />);
  await waitFor(() => expect(getAttention().messages).toBe(3));
  mockWorld.isAuthenticated = false;
  await view.rerender(<AttentionSync />);
  expect(getAttention()).toMatchObject({ messages: 0, notifications: 0 });
});

test('a message ping re-reads at once', async () => {
  answers({ unreadDms: 0 });
  const view = await render(<AttentionSync />);
  await waitFor(() => expect(calls('/messages')).toBe(1));
  answers({ unreadDms: 1 });
  mockWorld.messagesVersion = 1;
  await view.rerender(<AttentionSync />);
  await waitFor(() => expect(getAttention().messages).toBe(1));
});

test('a burst of task changes is ONE re-read of the notifications', async () => {
  jest.useFakeTimers();
  try {
    answers({ notifications: 0 });
    const view = await render(<AttentionSync />);
    await act(async () => { await Promise.resolve(); });
    const before = calls('/notifications');
    answers({ notifications: 4 });
    for (const v of [1, 2, 3]) {
      mockWorld.tasksVersion = v;
      await view.rerender(<AttentionSync />);
    }
    expect(calls('/notifications')).toBe(before);
    await act(async () => { jest.advanceTimersByTime(TASK_PING_DEBOUNCE_MS + 1); });
    expect(calls('/notifications')).toBe(before + 1);
    // Your own edits ping this too: the messages are not re-read for it.
    expect(calls('/messages')).toBe(1);
  } finally {
    jest.useRealTimers();
  }
});

test('coming back to the foreground re-reads', async () => {
  const listeners = [];
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    listeners.push(fn);
    return { remove: jest.fn() };
  });
  try {
    answers({ unreadDms: 0 });
    await render(<AttentionSync />);
    await waitFor(() => expect(calls('/messages')).toBe(1));
    answers({ unreadDms: 5 });
    await act(async () => { listeners.forEach((fn) => fn('active')); });
    await waitFor(() => expect(getAttention().messages).toBe(5));
  } finally {
    spy.mockRestore();
  }
});

test('a failed read keeps the last good count', async () => {
  answers({ unreadDms: 2, notifications: 1 });
  await render(<AttentionSync />);
  await waitFor(() => expect(getAttention().messages).toBe(2));
  mockApi.get.mockRejectedValue(new Error('offline'));
  await act(async () => { requestAttentionRefresh(); });
  expect(getAttention()).toMatchObject({ messages: 2, notifications: 1 });
});

test('whoever changes a count can ask it for the truth', async () => {
  answers({ notifications: 3 });
  await render(<AttentionSync />);
  await waitFor(() => expect(getAttention().notifications).toBe(3));
  setAttention({ notifications: 0 }); // the page's optimistic clear
  await act(async () => { requestAttentionRefresh(); });
  await waitFor(() => expect(getAttention().notifications).toBe(3));
});

test('the launch update check mounts, schedules, and cleans up after itself', async () => {
  jest.useFakeTimers();
  const remove = jest.fn();
  const spy = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove });
  try {
    const view = await render(<LaunchUpdateCheck />);
    expect(spy).toHaveBeenCalledWith('change', expect.any(Function));
    await view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
    // Unmounted before its delay: the timer must not fire into nothing.
    expect(() => jest.runOnlyPendingTimers()).not.toThrow();
  } finally {
    spy.mockRestore();
    jest.useRealTimers();
  }
});
