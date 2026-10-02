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

// copyText reaches for the native clipboard and falls back to the OS share
// sheet; neither is a thing in jest, and what matters here is WHAT was handed
// to it. Its own behaviour is covered by utils/__tests__/copyText.test.js.
const mockCopyText = jest.fn(async () => 'copied');
jest.mock('../../../../utils/copyText', () => ({
  copyText: (...args) => mockCopyText(...args),
  default: (...args) => mockCopyText(...args),
}));

import { Linking } from 'react-native';
import FriendChatPage from '../FriendChatPage';
import { __resetLinkPreviewCache } from '../../../../utils/useLinkPreview';

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
  // The preview cache is module-level and outlives a test, which is the whole
  // point of it in the app and a cross-test leak here.
  __resetLinkPreviewCache();
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

describe('a link in a message', () => {
  const WITH_LINK = 'read https://example.com/story now';
  const PREVIEW = {
    host: 'example.com',
    title: 'A story about turtles',
    description: 'Slow and steady',
    thumbUrl: '/api/media/thumbnails/linkthumb-abc.jpg',
    mediaType: 'link',
  };

  /** Route the thread read and the preview read to different answers. */
  const withLink = ({ preview = null, row = null } = {}) => {
    mockApi.get.mockImplementation((path) => (
      path.startsWith('/share/link-preview')
        ? Promise.resolve({ success: true, preview: row })
        : Promise.resolve({ success: true, messages: [msg({ content: WITH_LINK })] })
    ));
    mockApi.post.mockImplementation((path) => (
      path === '/share/preview'
        ? Promise.resolve({ success: true, preview })
        : Promise.resolve({ success: true })
    ));
  };

  test('the URL is pressable where it was written, and the prose is untouched', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    withLink();
    await render(<FriendChatPage {...props()} />);

    const link = await screen.findByText('https://example.com/story');
    await act(async () => { fireEvent.press(link); });
    expect(open).toHaveBeenCalledWith('https://example.com/story');

    // The words either side are still on screen as written.
    expect(screen.getByText('read ')).toBeTruthy();
    expect(screen.getByText(' now')).toBeTruthy();
    open.mockRestore();
  });

  test('asks the CHEAP cached endpoint first, and only then unfurls', async () => {
    withLink({ preview: PREVIEW });
    await render(<FriendChatPage {...props()} />);

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/share/preview', { url: 'https://example.com/story' }));
    const previewReads = mockApi.get.mock.calls.filter((c) => String(c[0]).startsWith('/share/link-preview'));
    expect(previewReads).toHaveLength(1);
    expect(previewReads[0][0]).toBe('/share/link-preview?url=https%3A%2F%2Fexample.com%2Fstory');
  });

  test('a cached preview is used WITHOUT unfurling the page again', async () => {
    // The row shape the cache-only GET really returns — snake_case, with a
    // status. This is the second reader of a thread, and it costs nothing.
    withLink({
      row: {
        status: 'ok',
        title: 'A story about turtles',
        description: 'Slow and steady',
        thumb_url: '/api/media/thumbnails/linkthumb-abc.jpg',
        media_type: 'link',
      },
    });
    await render(<FriendChatPage {...props()} />);

    expect(await screen.findByText('A story about turtles')).toBeTruthy();
    expect(mockApi.post).not.toHaveBeenCalledWith('/share/preview', expect.anything());
  });

  test('the card shows the title, summary, host and thumbnail', async () => {
    withLink({ preview: PREVIEW });
    await render(<FriendChatPage {...props()} />);

    expect(await screen.findByText('A story about turtles')).toBeTruthy();
    expect(screen.getByText('Slow and steady')).toBeTruthy();
    expect(screen.getByText('example.com')).toBeTruthy();
    // A server-RELATIVE thumbnail path has to be joined to the pond's origin.
    const thumb = screen.getByTestId('friend-chat-link-m1-thumb');
    expect(thumb.props.source.uri).toBe('http://pond/api/media/thumbnails/linkthumb-abc.jpg');
  });

  test('a link the pond cannot unfurl leaves the message alone', async () => {
    // Login wall, dead link, non-HTML: a NORMAL outcome, not an error. The
    // link stays pressable and no empty card is drawn.
    withLink({ preview: null });
    await render(<FriendChatPage {...props()} />);

    expect(await screen.findByText('https://example.com/story')).toBeTruthy();
    await act(async () => {});
    expect(screen.queryByTestId('friend-chat-link-m1-thumb')).toBeNull();
  });

  test('a message with no link asks the pond nothing about previews', async () => {
    await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    await act(async () => {});
    expect(mockApi.get.mock.calls.some((c) => String(c[0]).includes('/share/'))).toBe(false);
    expect(mockApi.post).not.toHaveBeenCalled();
  });
});

describe('holding a message', () => {
  const hold = async (id = 'm1') => {
    const bubble = await screen.findByTestId(`friend-chat-bubble-${id}`);
    await act(async () => { fireEvent(bubble, 'longPress'); });
  };

  test('offers to copy it, and says so when it has', async () => {
    await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    await hold();

    const copy = screen.getByTestId('friend-chat-actions-copy-message');
    await act(async () => { fireEvent.press(copy); });

    expect(mockCopyText).toHaveBeenCalledWith('hello');
    expect(await screen.findByTestId('friend-chat-toast')).toBeTruthy();
    expect(screen.getByText('Message copied')).toBeTruthy();
  });

  test('says plainly when a copy did NOT happen', async () => {
    mockCopyText.mockResolvedValueOnce('none');
    await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    await hold();
    await act(async () => { fireEvent.press(screen.getByTestId('friend-chat-actions-copy-message')); });

    expect(await screen.findByText(/Could not copy/)).toBeTruthy();
  });

  test('a message with no link is not offered link options that do nothing', async () => {
    await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    await hold();

    expect(screen.getByTestId('friend-chat-actions-copy-message')).toBeTruthy();
    expect(screen.queryByTestId('friend-chat-actions-copy-link')).toBeNull();
    expect(screen.queryByTestId('friend-chat-actions-open-link')).toBeNull();
  });

  test('a message WITH a link can have the link copied or opened', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    mockApi.get.mockImplementation((path) => (
      path.startsWith('/share/link-preview')
        ? Promise.resolve({ success: true, preview: null })
        : Promise.resolve({ success: true, messages: [msg({ content: 'see https://example.com/story' })] })
    ));
    mockApi.post.mockResolvedValue({ success: true, preview: null });

    await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    await hold();

    await act(async () => { fireEvent.press(screen.getByTestId('friend-chat-actions-copy-link')); });
    expect(mockCopyText).toHaveBeenCalledWith('https://example.com/story');

    await hold();
    await act(async () => { fireEvent.press(screen.getByTestId('friend-chat-actions-open-link')); });
    expect(open).toHaveBeenCalledWith('https://example.com/story');
    open.mockRestore();
  });

  test('the sheet closes when the scrim is pressed', async () => {
    await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    await hold();
    expect(screen.getByTestId('friend-chat-actions')).toBeTruthy();

    await act(async () => { fireEvent.press(screen.getByTestId('friend-chat-actions-scrim')); });
    expect(screen.queryByTestId('friend-chat-actions')).toBeNull();
  });

  // A failed bubble's TAP is its retry. Making the whole Pressable `disabled`
  // to express that would have taken the HOLD away with it.
  test('a failed message can still be held, and still retries on a tap', async () => {
    mockApi.post.mockRejectedValue(new Error('no route to pond'));
    await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    await act(async () => { fireEvent.changeText(screen.getByTestId('friend-chat-input'), 'did this land?'); });
    await act(async () => { fireEvent.press(screen.getByLabelText('Send')); });
    expect(await screen.findByText(/tap to try again/i)).toBeTruthy();

    const failed = screen.getByText('did this land?');
    await act(async () => { fireEvent.press(failed) });
    // The retry went back out to the pond (the first POST plus this one).
    expect(mockApi.post.mock.calls.filter((c) => String(c[0]).includes('/messages/'))).toHaveLength(2);
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
