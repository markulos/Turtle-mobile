import React from 'react';
import { act, render, screen, userEvent } from '@testing-library/react-native';

jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock');
  const pass = (f) => f || ((t) => t);
  return {
    ...mock,
    Easing: {
      out: pass, in: pass, inOut: pass,
      cubic: (t) => t, quad: (t) => t, linear: (t) => t, ease: (t) => t,
      bezier: () => (t) => t,
    },
    useAnimatedReaction: mock.useAnimatedReaction || (() => {}),
    cancelAnimation: mock.cancelAnimation || (() => {}),
    withDecay: mock.withDecay || (() => 0),
    runOnJS: mock.runOnJS || ((fn) => fn),
  };
});

jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');
  const chain = () => new Proxy(function chainFn() {}, {
    get: (_target, key) => (key === 'then' ? undefined : () => chain()),
    apply: () => chain(),
  });
  return {
    Gesture: {
      Pan: () => chain(), Pinch: () => chain(), Tap: () => chain(),
      Race: () => chain(), Simultaneous: () => chain(), Exclusive: () => chain(),
    },
    GestureDetector: ({ children }) => children,
    GestureHandlerRootView: View,
  };
});

jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Image: (props) => React.createElement(View, {
      testID: `img:${props.source?.uri}`,
      accessibilityLabel: props.accessibilityLabel,
    }),
  };
});
const mockFullscreen = { calls: 0, options: null };
jest.mock('expo-video', () => {
  const React = require('react');
  return {
    useVideoPlayer: () => ({ play: jest.fn(), pause: jest.fn(), playing: false, muted: true }),
    // Records what the page asked for, and exposes the imperative handle the
    // chrome's fullscreen key reaches through.
    VideoView: React.forwardRef((props, ref) => {
      mockFullscreen.options = props.fullscreenOptions;
      React.useImperativeHandle(ref, () => ({
        enterFullscreen: () => { mockFullscreen.calls += 1; return Promise.resolve(); },
      }));
      return null;
    }),
  };
});
jest.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
jest.mock('expo-blur', () => {
  const { View } = require('react-native');
  return { BlurView: View };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

// The offline store, over a toy filesystem — see services/__tests__ for the
// store's own tests. Here it exists so the Save button has something real to
// talk to: a download that lands, and one that 404s.
const mockStore = new Map();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((k) => Promise.resolve(mockStore.has(k) ? mockStore.get(k) : null)),
  setItem: jest.fn((k, v) => { mockStore.set(k, v); return Promise.resolve(); }),
  removeItem: jest.fn((k) => { mockStore.delete(k); return Promise.resolve(); }),
}));
const mockFs = new Map();
const mockServer = { status: 200, urls: [] };
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn((uri) => Promise.resolve(
    mockFs.has(uri) ? { exists: true, size: 999, isDirectory: false } : { exists: false },
  )),
  makeDirectoryAsync: jest.fn(() => Promise.resolve()),
  deleteAsync: jest.fn((uri) => { mockFs.delete(uri); return Promise.resolve(); }),
  downloadAsync: jest.fn((url, dest) => {
    mockServer.urls.push(url);
    if (mockServer.status < 400) mockFs.set(dest, 999);
    return Promise.resolve({ uri: dest, status: mockServer.status });
  }),
}));
jest.mock('../../../../../context/MusicPlayerContext', () => ({
  useMusicPlayer: () => ({ pause: jest.fn() }),
}));

import PhotoViewer from '../PhotoViewer';
import { formatClock } from '../ViewerChrome';
import TagsSheet, { matchTags, mergeTags } from '../TagsSheet';
import { OfflineMediaProvider } from '../../../../../context/OfflineMediaContext';

describe('viewer helpers', () => {
  test('formatClock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(7.9)).toBe('0:07');
    expect(formatClock(63)).toBe('1:03');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(NaN)).toBe('0:00');
  });
  test('matchTags ranks earlier matches first and ignores case', () => {
    expect(matchTags(['Beach', 'Trip', 'Road trip', 'Zebra'], 'tri')).toEqual(['Trip', 'Road trip']);
    expect(matchTags(['Beach', 'Trip'], '')).toEqual(['Beach', 'Trip']);
    expect(matchTags(['Beach'], 'xyz')).toEqual([]);
  });
  test('mergeTags trims, dedupes, keeps order', () => {
    expect(mergeTags(['A'], [' B ', '', 'A', 'C'])).toEqual(['A', 'B', 'C']);
  });
});

const makeStore = () => {
  let value = null;
  const listeners = new Set();
  return {
    get: () => value,
    set: (next) => { value = next; listeners.forEach((l) => l(next)); },
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
  };
};
const makeHdStore = () => {
  const ready = new Set();
  const listeners = new Set();
  return {
    get: (id) => ready.has(id),
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
    mark: (id) => { ready.add(id); listeners.forEach((l) => l(id)); },
  };
};

const items = [
  { id: 'm0', type: 'image', compressedUrl: '/c/m0.jpg', width: 400, height: 300, tags: '[]', originalDate: '2026-09-08T09:00:00' },
  {
    id: 'm1', type: 'image', compressedUrl: '/c/m1.jpg', width: 4032, height: 3024, tags: '["Favourites"]',
    originalDate: '2026-09-09T14:03:00', filename: 'IMG_0001.HEIC', size: 2150000,
  },
  { id: 'm2', type: 'video', rawUrl: '/r/m2.mp4', width: 1920, height: 1080, tags: '[]' },
];

const theme = {
  colors: {
    primary: '#3b82f6', background: '#000', surface: '#111', surfaceElevated: '#222',
    textPrimary: '#fff', textSecondary: '#ccc', textMuted: '#888', border: '#333',
  },
};

async function renderViewer(overrides = {}) {
  const props = {
    visible: true,
    items,
    initialIndex: 1,
    origin: null,
    activeStore: makeStore(),
    hdStore: makeHdStore(),
    dragStore: makeStore(),
    getFullUrl: (p) => `https://pond${p}`,
    tagSuggestions: ['Trip', 'Favourites', 'All'],
    onIndexSettled: jest.fn(),
    onCommitTags: jest.fn(),
    onToggleFavourite: jest.fn(),
    onShare: jest.fn(),
    onEditImage: jest.fn(),
    onClosed: jest.fn(),
    theme,
    insets: { top: 47, bottom: 34 },
    bottomInset: 90,
    ...overrides,
  };
  const view = await render(<PhotoViewer {...props} />);
  return { view, props, user: userEvent.setup() };
}

/** The same viewer, wrapped in the real offline store. */
async function renderViewerOffline(overrides = {}) {
  const props = {
    visible: true,
    items,
    initialIndex: 1,
    origin: null,
    activeStore: makeStore(),
    hdStore: makeHdStore(),
    dragStore: makeStore(),
    getFullUrl: (p) => `https://pond${p}`,
    tagSuggestions: [],
    onIndexSettled: jest.fn(),
    onCommitTags: jest.fn(),
    onToggleFavourite: jest.fn(),
    onShare: jest.fn(),
    onEditImage: jest.fn(),
    onClosed: jest.fn(),
    theme,
    insets: { top: 47, bottom: 34 },
    bottomInset: 90,
    ...overrides,
  };
  const view = await render(
    <OfflineMediaProvider><PhotoViewer {...props} /></OfflineMediaProvider>,
  );
  return { view, props, user: userEvent.setup() };
}

describe('PhotoViewer', () => {
  test('renders the active photo on its fast uri, both neighbours, and the chrome', async () => {
    const { props } = await renderViewer();
    expect(screen.getByTestId('img:https://pond/c/m1.jpg')).toBeTruthy();
    expect(screen.getByTestId('img:https://pond/c/m0.jpg')).toBeTruthy();
    expect(screen.getByTestId('viewer-page-m2')).toBeTruthy();
    expect(screen.getByText(/Sep 9, 2026/)).toBeTruthy();
    expect(screen.getByText('4032 × 3024')).toBeTruthy();
    expect(screen.getByTestId('viewer-favourite').props.accessibilityLabel).toBe('Remove from favourites');
    expect(props.activeStore.get()).toBe('m1');
  });

  test('the HD store flips the page to the display variant', async () => {
    const { props } = await renderViewer();
    expect(screen.queryByTestId('img:https://pond/api/media/display/m1')).toBeNull();
    await act(async () => { props.hdStore.mark('m1'); });
    expect(screen.getByTestId('img:https://pond/api/media/display/m1')).toBeTruthy();
  });

  test('the tags button opens the sheet, and every add commits immediately', async () => {
    const { props, user } = await renderViewer();
    expect(screen.queryByTestId('tags-sheet')).toBeNull();
    await user.press(screen.getByTestId('viewer-tags'));
    expect(screen.getByTestId('tags-sheet')).toBeTruthy();
    // Favourites is on the photo, so only Trip is offered (All is a system album).
    expect(screen.queryByTestId('tag-suggest-Favourites')).toBeNull();
    expect(screen.queryByTestId('tag-suggest-All')).toBeNull();
    await user.press(screen.getByTestId('tag-suggest-Trip'));
    expect(props.onCommitTags).toHaveBeenCalledWith('m1', ['Favourites', 'Trip']);
    await user.type(screen.getByTestId('tags-input'), 'Beach', { submitEditing: true });
    expect(props.onCommitTags).toHaveBeenLastCalledWith('m1', ['Favourites', 'Beach']);
    // Favourites can't be removed from here.
    await user.press(screen.getByTestId('tag-chip-Favourites'));
    expect(props.onCommitTags).toHaveBeenCalledTimes(2);
  });

  test('favourite, share and edit hand the active item to the gallery', async () => {
    const { props, user } = await renderViewer();
    await user.press(screen.getByTestId('viewer-favourite'));
    expect(props.onToggleFavourite).toHaveBeenCalledWith(items[1]);
    await user.press(screen.getByTestId('viewer-share'));
    expect(props.onShare).toHaveBeenCalledWith(items[1]);
    await user.press(screen.getByTestId('viewer-edit'));
    expect(props.onEditImage).toHaveBeenCalledWith(items[1]);
  });

  test('a video page shows play and mute instead of edit', async () => {
    await renderViewer({ initialIndex: 2 });
    expect(screen.getByTestId('viewer-play')).toBeTruthy();
    expect(screen.getByTestId('viewer-mute')).toBeTruthy();
    expect(screen.queryByTestId('viewer-edit')).toBeNull();
  });

  test('the fullscreen key hands the video to the native landscape player', async () => {
    mockFullscreen.calls = 0;
    const { user } = await renderViewer({ initialIndex: 2 });

    // Landscape, and back out when the phone is turned upright again.
    expect(mockFullscreen.options).toEqual({
      enable: true, orientation: 'landscape', autoExitOnRotate: true,
    });

    await user.press(screen.getByTestId('viewer-fullscreen'));
    expect(mockFullscreen.calls).toBe(1);
  });

  test('a photo has no fullscreen key — it is the video player going landscape', async () => {
    await renderViewer();
    expect(screen.queryByTestId('viewer-fullscreen')).toBeNull();
  });

  test('renders nothing while hidden', async () => {
    await renderViewer({ visible: false });
    expect(screen.queryByTestId('photo-viewer')).toBeNull();
  });

  test('the open item vanishing from the list closes the viewer', async () => {
    const { view, props } = await renderViewer();
    await view.rerender(<PhotoViewer {...props} items={[items[0], items[2]]} />);
    expect(props.onClosed).toHaveBeenCalled();
  });
});

describe('Save for offline', () => {
  beforeEach(() => {
    mockStore.clear();
    mockFs.clear();
    mockServer.status = 200;
    mockServer.urls = [];
  });

  test('with no provider the button is simply absent — never a crash', async () => {
    await renderViewer();
    expect(screen.queryByTestId('viewer-offline')).toBeNull();
  });

  test('the button saves the DISPLAY tier and then reads the picture off disk', async () => {
    const { user } = await renderViewerOffline();
    const button = screen.getByTestId('viewer-offline');
    expect(button.props.accessibilityLabel).toBe('Save for offline');

    await user.press(button);

    // The bytes asked for are the ~1600px display variant, not the original.
    expect(mockServer.urls).toEqual(['https://pond/api/media/display/m1']);
    // The button now offers the way back out...
    expect(screen.getByTestId('viewer-offline').props.accessibilityLabel).toBe('Remove offline copy');
    // ...and the page paints from the local file, which is what makes it work
    // with the pond unreachable.
    expect(screen.getByTestId('img:file:///docs/offline-media/m1__IMG_0001.jpg')).toBeTruthy();
  });

  test('pressing it again removes the copy and hands the page back to the server', async () => {
    const { user } = await renderViewerOffline();
    await user.press(screen.getByTestId('viewer-offline'));
    await user.press(screen.getByTestId('viewer-offline'));
    expect(screen.getByTestId('viewer-offline').props.accessibilityLabel).toBe('Save for offline');
    expect(screen.queryByTestId('img:file:///docs/offline-media/m1__IMG_0001.jpg')).toBeNull();
    expect(screen.getByTestId('img:https://pond/c/m1.jpg')).toBeTruthy();
  });

  test('a failed download leaves nothing saved', async () => {
    mockServer.status = 500;
    const { user } = await renderViewerOffline();
    await user.press(screen.getByTestId('viewer-offline'));
    expect(screen.getByTestId('viewer-offline').props.accessibilityLabel).toBe('Save for offline');
    expect(screen.getByTestId('img:https://pond/c/m1.jpg')).toBeTruthy();
  });

  test('a video has no offline button — its original is a different decision', async () => {
    await renderViewerOffline({ initialIndex: 2 });
    expect(screen.queryByTestId('viewer-offline')).toBeNull();
    expect(screen.getByTestId('viewer-play')).toBeTruthy();
  });
});

describe('TagsSheet over a selection (list mode)', () => {
  test('chips edit a plain tag list through onChange; the header tap flips the detent', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    await render(
      <TagsSheet
        tags={['Trip']}
        suggestions={['Trip', 'Beach', 'All']}
        onChange={onChange}
        onClose={jest.fn()}
        theme={theme}
        subtitle="3 photos selected"
      />,
    );
    expect(screen.getByText('3 photos selected')).toBeTruthy();
    await user.press(screen.getByTestId('tag-suggest-Beach'));
    expect(onChange).toHaveBeenCalledWith(['Trip', 'Beach']);
    await user.press(screen.getByTestId('tag-chip-Trip'));
    expect(onChange).toHaveBeenLastCalledWith([]);

    expect(screen.getByTestId('tags-sheet-grab').props.accessibilityLabel).toBe('Expand sheet');
    await user.press(screen.getByTestId('tags-sheet-grab'));
    expect(screen.getByTestId('tags-sheet-grab').props.accessibilityLabel).toBe('Collapse sheet');
    await user.press(screen.getByTestId('tags-sheet-grab'));
    expect(screen.getByTestId('tags-sheet-grab').props.accessibilityLabel).toBe('Expand sheet');
  });
});

describe('TagsSheet with its own Done action (the upload sheet)', () => {
  test('Done runs onDone and never onClose; the scrim still closes', async () => {
    const onDone = jest.fn();
    const onClose = jest.fn();
    const user = userEvent.setup();
    await render(
      <TagsSheet tags={['Trip']} suggestions={[]} onChange={jest.fn()} onClose={onClose} onDone={onDone} doneLabel="Upload" theme={theme} />,
    );
    await user.press(screen.getByTestId('tags-sheet-done'));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('tags-sheet-done').props.accessibilityLabel).toBe('Upload');
  });
});
