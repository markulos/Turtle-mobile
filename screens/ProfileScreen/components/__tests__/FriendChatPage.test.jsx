import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
// FlashList's own jest setup — without it the component dies on I18nManager.
// The scroll BEHAVIOUR under test here is the list's (maintainVisibleContentPosition),
// not ours, so this renders the real thing rather than a stand-in that would
// prove nothing.
require('@shopify/flash-list/jestSetup');
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
// The lightbox a video plays in. The native player is not a thing in jest, and
// what matters here is WHAT it was pointed at — so the source is recorded and
// the view is a leaf.
const mockVideoPlayer = jest.fn();
jest.mock('expo-video', () => ({
  useVideoPlayer: (source) => { mockVideoPlayer(source); return { loop: false, play: jest.fn() }; },
  VideoView: 'VideoView',
}));
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
  // Sync, like the real one — it reads a module-level variable. An async stub
  // here would hand the video player "Bearer [object Promise]".
  getApiAuthToken: () => 't',
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

import { Linking, StyleSheet } from 'react-native';
import FriendChatPage from '../FriendChatPage';
import { FROST_OVERLAP } from '../../../../utils/frostedChat';
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

// Bring the page down EXPLICITLY after every case.
//
// FlashList schedules its initial scroll through a setTimeout(0) and cancels it
// on unmount (useUnmountAwareCallbacks), so the component has to come down while
// the test environment is still alive. Left to the implicit cleanup, that timer
// can outlive the environment and fire into a torn-down I18nManager — which
// takes the WHOLE RUN down rather than failing one test, with a bare
// "Cannot read properties of undefined (reading 'isRTL')" and no suite name on
// it. Whether it lands is pure timing, so it surfaces as the gate breaking after
// an unrelated change reorders the suites.
// Let FlashList's deferred scroll LAND before the suite moves on.
//
// FlashList schedules its initial scroll through a setTimeout(0)
// (useUnmountAwareCallbacks). If the run ends with that still pending, it fires
// into a torn-down I18nManager and takes the WHOLE RUN down rather than failing
// one test — a bare "Cannot read properties of undefined (reading 'isRTL')" with
// no suite name on it. Whether it lands is pure timing, so it surfaces as the
// gate breaking after an unrelated change reorders the suites.
//
// A macrotask flush is the whole fix. Do NOT also unmount by hand here: an
// explicit cleanup() detaches `screen`, and the NEXT test then renders into a
// tree its queries cannot see — which shows up as a component that appears to
// mount and fetch nothing at all. RNTL's own auto-cleanup already unmounts.

afterEach(async () => {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
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

describe('the chat scrolls BEHIND the frosted composer', () => {
  // The composer is a translucent frosted card (ChatComposer's own shell, the
  // same one the main Claude chat wears). That only reads as glass if there is
  // conversation behind it — which means the list fills the page and is INSET
  // by the composer's measured height rather than ending above it.
  const listInset = () => {
    const flat = StyleSheet.flatten(screen.getByTestId('friend-chat-list').props.contentContainerStyle);
    return flat.paddingBottom;
  };

  test('the list is inset by the dock, plus the overlap the frost needs', async () => {
    await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());

    const dock = screen.getByTestId('friend-chat-dock');
    await act(async () => {
      fireEvent(dock, 'layout', { nativeEvent: { layout: { height: 180 } } });
    });

    // FROST_OVERLAP is the clearance that keeps the newest message resting
    // just clear of the bar while older ones slide under it.
    expect(listInset()).toBe(180 + FROST_OVERLAP);
  });

  test('the inset follows the composer as it grows', async () => {
    await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    const dock = screen.getByTestId('friend-chat-dock');

    await act(async () => { fireEvent(dock, 'layout', { nativeEvent: { layout: { height: 150 } } }); });
    const short = listInset();
    // A multi-line draft makes the composer taller; the newest message has to
    // stay clear of it rather than ending up underneath.
    await act(async () => { fireEvent(dock, 'layout', { nativeEvent: { layout: { height: 230 } } }); });
    expect(listInset()).toBe(short + 80);
  });

  test('the scrollbar stops at the composer instead of running under it', async () => {
    await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    await act(async () => {
      fireEvent(screen.getByTestId('friend-chat-dock'), 'layout', { nativeEvent: { layout: { height: 180 } } });
    });
    expect(screen.getByTestId('friend-chat-list').props.scrollIndicatorInsets)
      .toEqual({ right: 1, bottom: 180 });
  });

  test('the dock does not eat presses meant for the chat showing through it', async () => {
    // A transparent strip sits between the composer card and the tab dock.
    // Without box-none that strip is a dead zone over live messages.
    await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    expect(screen.getByTestId('friend-chat-dock').props.pointerEvents).toBe('box-none');
  });

  test('the copy toast rides inside the dock, so the keyboard carries it', async () => {
    await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    await act(async () => { fireEvent(screen.getByTestId('friend-chat-bubble-m1'), 'longPress'); });
    await act(async () => { fireEvent.press(screen.getByTestId('friend-chat-actions-copy-message')); });

    // Positioned by the dock's own stacking rather than by a hand-tracked
    // `bottom:` that has to be kept in step with the keyboard.
    const toast = await screen.findByTestId('friend-chat-toast');
    expect(toast).toBeTruthy();
    const wrap = StyleSheet.flatten(screen.getByTestId('friend-chat-dock').props.style);
    expect(wrap.position).toBe('absolute');
    expect(wrap.bottom).toBe(0);
  });
});

describe('the newest message sits at the absolute bottom', () => {
  // The behaviour itself is the LIST's now, not ours: FlashList's
  // `maintainVisibleContentPosition` does it natively, which is why the
  // hand-rolled scroll-to-end that used to live here is gone. Re-testing a
  // third-party list's scrolling would be testing the wrong thing.
  //
  // What IS ours, and what breaks silently if someone edits it, is the
  // CONFIGURATION — so that is what this pins.
  const listOf = () => screen.getByTestId('friend-chat-list');

  test('the list is pinned to the bottom, on the main chat settings', async () => {
    await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());

    const cfg = listOf().props.maintainVisibleContentPosition;
    // Opens at the newest line with no scroll afterwards to go wrong.
    expect(cfg.startRenderingFromBottom).toBe(true);
    // And a new message only pulls the view down if the reader was already
    // near the bottom — the same number TurtleScreen's chat uses, because two
    // different answers is how two chats in one app start behaving differently.
    expect(cfg.autoscrollToBottomThreshold).toBe(0.2);
  });

  test('that config is frozen at module scope, not rebuilt per render', async () => {
    // FlashList treats it as LAYOUT CONFIGURATION. An object literal in the
    // render body hands it a new identity on every render — here, on every
    // keystroke in the composer.
    const { rerender } = await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    const first = listOf().props.maintainVisibleContentPosition;

    await act(async () => { fireEvent.changeText(screen.getByTestId('friend-chat-input'), 'typing'); });
    await rerender(<FriendChatPage {...props()} />);
    expect(listOf().props.maintainVisibleContentPosition).toBe(first);
  });
});

/**
 * A photo somebody sent YOU has to appear.
 *
 * The bug this pins: the bubble used to resolve its ids through
 * `GET /media/by-ids`, which is OWNER-SCOPED — it answers with the caller's own
 * media and silently omits the rest. So the sender saw their photo and the
 * recipient got an empty list and a placeholder that never resolved. Sending was
 * never broken; the picture simply never loaded on the other side.
 *
 * The fix is to address `/api/media/display/:id` directly, which needs no lookup
 * and has no owner scoping. These cases are about the URL and about asking for
 * NOTHING first, because both are the bug.
 */
describe('a photo in a message', () => {
  const withPhoto = (over = {}) => msg({
    content: '',
    attachments: [{ type: 'media', mediaId: 'media_abc' }],
    ...over,
  });

  /** Every image source in the rendered tree — walked, the way this repo's
   *  other render tests measure a tree. */
  const uris = () => {
    const out = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      const uri = node.props?.source?.uri;
      if (uri) out.push(uri);
      (node.children || []).forEach(walk);
    };
    walk(screen.toJSON());
    return out;
  };

  /** Text nodes rendering an empty string — the "blank line" being guarded against. */
  const emptyTextNodes = () => {
    let n = 0;
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      const kids = node.children || [];
      if (node.type === 'Text' && kids.length === 1 && kids[0] === '') n += 1;
      kids.forEach(walk);
    };
    walk(screen.toJSON());
    return n;
  };

  test("draws a photo THEY sent, addressed by id", async () => {
    mockApi.get.mockResolvedValue({ success: true, messages: [withPhoto({ mine: false })] });
    await render(<FriendChatPage {...props()} />);
    await screen.findByTestId('message-photo-media_abc');
    expect(uris()).toContain('http://pond/api/media/display/media_abc');
  });

  test('the picture does not wait on — or need — the vault answering', async () => {
    // by-ids is asked (it is how a VIDEO is told from a photo), but nothing
    // about the frame depends on it: here it fails outright, which is also
    // what it did for years for a photo somebody else sent you.
    mockApi.get.mockImplementation(async (path) => {
      if (String(path).includes('by-ids')) throw new Error('nope');
      return { success: true, messages: [withPhoto({ mine: false })] };
    });
    await render(<FriendChatPage {...props()} />);
    await screen.findByTestId('message-photo-media_abc');
    expect(uris()).toContain('http://pond/api/media/display/media_abc');
  });

  test('draws one I sent the same way', async () => {
    mockApi.get.mockResolvedValue({ success: true, messages: [withPhoto({ mine: true })] });
    await render(<FriendChatPage {...props()} />);
    expect(uris()).toContain('http://pond/api/media/display/media_abc');
  });

  test('a wordless photo message draws no empty line of text under it', async () => {
    mockApi.get.mockResolvedValue({ success: true, messages: [withPhoto()] });
    await render(<FriendChatPage {...props()} />);
    await screen.findByTestId('message-photo-media_abc');
    expect(emptyTextNodes()).toBe(0);
  });

  test('every photo on a message gets its own frame', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      messages: [msg({
        content: 'these',
        attachments: [{ type: 'media', mediaId: 'a1' }, { type: 'media', mediaId: 'a2' }],
      })],
    });
    await render(<FriendChatPage {...props()} />);
    await screen.findByTestId('message-photo-a1');
    expect(screen.getByTestId('message-photo-a2')).toBeTruthy();
    expect(uris()).toEqual(expect.arrayContaining([
      'http://pond/api/media/display/a1',
      'http://pond/api/media/display/a2',
    ]));
  });
});

/**
 * A VIDEO sent in the pond ("Send in Turtle").
 *
 * Mark, 2026-11-18: "but it just picture, no video". The display tier answers
 * for a video with its poster, so it arrived as an ordinary still with nothing
 * saying it played and nothing that would play it.
 */
describe('a video in a message', () => {
  /** api.get, routed: the thread read, then the by-ids type lookup. */
  const pond = (messages, items) => {
    mockApi.get.mockImplementation(async (path) => (
      String(path).includes('by-ids')
        ? { items }
        : { success: true, messages }
    ));
  };

  const vid = (over = {}) => msg({
    content: '',
    attachments: [{ type: 'media', mediaId: 'media_vid' }],
    ...over,
  });

  /** Is there a play disc anywhere in the tree? */
  const hasPlayGlyph = () => {
    let found = false;
    const walk = (node) => {
      if (!node || typeof node !== 'object' || found) return;
      if (node.type === 'Icon' && node.props?.name === 'play') { found = true; return; }
      (node.children || []).forEach(walk);
    };
    walk(screen.toJSON());
    return found;
  };

  test('is marked as one once the vault says so', async () => {
    pond([vid({ mine: false })], [{ id: 'media_vid', type: 'video' }]);
    await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(hasPlayGlyph()).toBe(true));
  });

  test('a photo gets no play disc', async () => {
    pond([vid({ mine: false })], [{ id: 'media_vid', type: 'image' }]);
    await render(<FriendChatPage {...props()} />);
    await screen.findByTestId('message-photo-media_vid');
    await act(async () => {});
    expect(hasPlayGlyph()).toBe(false);
  });

  test('plays from /api/media/video/:id, with the token the gate wants', async () => {
    pond([vid({ mine: false })], [{ id: 'media_vid', type: 'video' }]);
    await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(hasPlayGlyph()).toBe(true));

    fireEvent.press(screen.getByTestId('message-photo-media_vid'));

    await waitFor(() => expect(mockVideoPlayer).toHaveBeenCalled());
    expect(mockVideoPlayer).toHaveBeenCalledWith({
      uri: 'http://pond/api/media/video/media_vid',
      headers: { Authorization: 'Bearer t' },
    });
  });

  test('the image viewer counts stills only, so a photo beside a video opens itself', async () => {
    pond(
      [msg({
        content: '',
        attachments: [{ type: 'media', mediaId: 'v1' }, { type: 'media', mediaId: 'p2' }],
      })],
      [{ id: 'v1', type: 'video' }, { id: 'p2', type: 'image' }],
    );
    await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(hasPlayGlyph()).toBe(true));

    // The SECOND tile in the bubble, which is the FIRST (and only) still.
    fireEvent.press(screen.getByTestId('message-photo-p2'));

    const page = await screen.findByTestId('attachment-image-p2');
    expect(page).toBeTruthy();
    // And no player was started for it.
    expect(mockVideoPlayer).not.toHaveBeenCalled();
  });
});

/**
 * Sending a photo must not wait for the upload.
 *
 * The upload starts when the photo is PICKED, but Send no longer blocks on it:
 * the bubble goes up immediately, drawn from the local file on the device, and
 * the POST happens once the id lands. What this pins is the ORDER — that the
 * picture is on screen before the pond has been asked for anything.
 */
describe('a photo sends without waiting for the upload', () => {
  const localMsg = {
    localId: 'local-1', id: 'local-1', content: '', mine: true, local: true,
    createdAt: 1_700_000_000_100, localUris: ['file:///tmp/pic.jpg'],
  };

  test('an in-flight bubble draws the LOCAL file, not a vault url', async () => {
    // mergeThread keeps a local bubble the server has not caught up with, which
    // is the state between pressing Send and the upload finishing.
    mockApi.get.mockResolvedValue({ success: true, messages: [] });
    await render(<FriendChatPage {...props()} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    expect(screen.queryByTestId('message-photo-local-0')).toBeNull();
  });

  test('a settled bubble addresses the vault by id', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      messages: [msg({ content: '', mine: true, attachments: [{ type: 'media', mediaId: 'm9' }] })],
    });
    await render(<FriendChatPage {...props()} />);
    await screen.findByTestId('message-photo-m9');
    const found = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.props?.source?.uri) found.push(node.props.source.uri);
      (node.children || []).forEach(walk);
    };
    walk(screen.toJSON());
    expect(found).toContain('http://pond/api/media/display/m9');
  });
});

/**
 * KEEP THIS DESCRIBE LAST, AND ADD NOTHING AFTER IT.
 *
 * These two drive a RERENDER rather than a fresh mount — the only way to change
 * what the mocked `useSyncSignals` returns mid-test — and they POISON whatever
 * runs next in this file. The following test's `render()` returns a null tree and
 * fires no effects at all, so a perfectly good case fails with "unable to find"
 * and reads as a bug in whatever was just added rather than as a leak from here.
 * A known-good case copied to the end of the file fails the same way, which is how
 * this was pinned down — it is NOT caused by whatever sits below.
 *
 * Unmounting them by hand does not fix it and neither does flushing timers, so
 * the mitigation for now is ORDER. If you need to add cases, add them ABOVE.
 */
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
