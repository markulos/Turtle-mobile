import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
jest.mock('../../../../utils/haptics', () => ({
  tapHaptic: jest.fn(), notifyHaptic: jest.fn(), impactHaptic: jest.fn(), markGesture: jest.fn(),
}));
jest.mock('../../../../components/AnimalAvatar', () => 'AnimalAvatar');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('../../../TurtleScreen/components/EdgeSwipePage', () => {
  const React = require('react');
  return function MockEdgeSwipePage({ visible, children }) {
    return visible ? React.createElement(React.Fragment, null, children) : null;
  };
});

const mockApi = { get: jest.fn(), post: jest.fn() };
jest.mock('../../../../context/ServerContext', () => ({
  useServer: () => ({ api: mockApi }),
  serverOrigin: () => 'http://pond',
  getApiAuthToken: async () => 't',
}));

let mockSignals = { messagesVersion: 0, messagesPing: null };
jest.mock('../../../../context/DownloadsContext', () => ({
  useSyncSignals: () => mockSignals,
}));

import FriendChatPage from '../FriendChatPage';

const theme = {
  colors: {
    background: '#fff', surface: '#eee', surfaceElevated: '#f4f4f4',
    textPrimary: '#111', textSecondary: '#444', textTertiary: '#888', textMuted: '#aaa',
    border: '#ddd', accent: '#f90', accentInfo: '#58e', accentError: '#e44', accentSuccess: '#4a4',
  },
};

const friend = { id: 'u2', name: 'Michelle', avatarUrl: null };

const msg = (over = {}) => ({
  id: 'm1', content: 'hello', createdAt: 1_700_000_000_000, mine: false, readAt: null, ...over,
});

const props = (over = {}) => ({
  visible: true, onClose: jest.fn(), friend, theme, isDark: false, serverBase: 'http://pond', ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSignals = { messagesVersion: 0, messagesPing: null };
  mockApi.get.mockResolvedValue({ success: true, messages: [msg()] });
  mockApi.post.mockResolvedValue({ success: true, message: msg({ id: 'real', mine: true }) });
});

describe('opening a conversation', () => {
  test('reads the thread for the friend whose row was pressed', async () => {
    await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    expect(mockApi.get.mock.calls[0][0]).toContain('/messages/u2');
    expect(await screen.findByText('hello')).toBeTruthy();
  });

  test('the friend is named in the header, not just in the bubbles', async () => {
    await render(<FriendChatPage {...props()} />);
    expect(await screen.findByText('Michelle')).toBeTruthy();
  });

  // Reading a thread marks their messages read server-side, so it must not fire
  // for a page that is not open.
  test('a closed page reads nothing', async () => {
    await render(<FriendChatPage {...props({ visible: false })} />);
    await act(async () => {});
    expect(mockApi.get).not.toHaveBeenCalled();
  });

  test('an empty thread invites the first message instead of showing nothing', async () => {
    mockApi.get.mockResolvedValue({ success: true, messages: [] });
    await render(<FriendChatPage {...props()} />);
    expect(await screen.findByText(/No messages yet/)).toBeTruthy();
  });

  test('a thread that will not load offers a way to try again', async () => {
    mockApi.get.mockRejectedValue(new Error('offline'));
    await render(<FriendChatPage {...props()} />);
    expect(await screen.findByText('Try again')).toBeTruthy();
  });
});

describe('sending', () => {
  const type = async (text) => {
    const input = screen.getByTestId('friend-chat-input');
    await act(async () => { fireEvent.changeText(input, text); });
    return input;
  };

  test('the message posts to the friend and the bubble appears', async () => {
    await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    const input = await type('on my way');
    await act(async () => { fireEvent.press(screen.getByLabelText('Send')); });

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled());
    expect(mockApi.post.mock.calls[0][0]).toContain('/messages/u2');
    expect(mockApi.post.mock.calls[0][1]).toEqual({ content: 'on my way' });
  });

  test('a send that fails leaves the words on screen, tappable to retry', async () => {
    mockApi.post.mockRejectedValue(new Error('no route to pond'));
    await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    const input = await type('did this land?');
    await act(async () => { fireEvent.press(screen.getByLabelText('Send')); });

    // The bubble survives the failure and says so — losing the text would be
    // losing something the user wrote.
    expect(await screen.findByText('did this land?')).toBeTruthy();
    expect(await screen.findByText(/tap to try again/i)).toBeTruthy();
  });

  test('an empty draft does not post', async () => {
    await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    const input = await type('   ');
    await act(async () => { fireEvent.press(screen.getByLabelText('Send')); });
    expect(mockApi.post).not.toHaveBeenCalled();
  });
});

describe('the socket is a bell, not the delivery', () => {
  test('a ping about THIS friend refetches the thread', async () => {
    const { rerender } = await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(1));

    mockSignals = { messagesVersion: 1, messagesPing: { withUserId: 'u2', at: 1 } };
    rerender(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2));
  });

  test('a ping about SOMEONE ELSE costs this thread nothing', async () => {
    const { rerender } = await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(1));

    mockSignals = { messagesVersion: 1, messagesPing: { withUserId: 'someone-else', at: 1 } };
    rerender(<FriendChatPage {...props()} />);
    await act(async () => {});
    expect(mockApi.get).toHaveBeenCalledTimes(1);
  });
});
