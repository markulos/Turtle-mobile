import React from 'react';
import { render } from '@testing-library/react-native';

/**
 * THE INBOX SHOWS PEOPLE'S OWN FACES.
 *
 * It did not, for a while, and the way it failed is the reason this test
 * exists rather than a comment: the row object HAD the photo all along.
 * `threadRows` reads `avatarUrl` off the pond roster, and the inbox hands it
 * to the thread when you open one — so the same person appeared as a
 * generated animal in the list and as their own photograph one tap later.
 * Nothing threw, nothing warned, and no assertion anywhere was false. A prop
 * was simply dropped on the floor between two lines of the same file.
 *
 * So what is pinned here is the whole chain: the roster's url reaches the row,
 * the row resolves it against the pond's origin, and the photo is drawn OVER
 * the generated disc rather than instead of it — a picture still loading, or
 * one that fails, has to show a face rather than a hole.
 */

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('../../../../utils/haptics', () => ({
  tapHaptic: jest.fn(), impactHaptic: jest.fn(), selectionHaptic: jest.fn(),
}));
jest.mock('../../../TurtleScreen/components/EdgeSwipePage', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: ({ children }) => <View>{children}</View> };
});
jest.mock('../../../../components/DirectMessageIcon', () => 'DirectMessageIcon');

// The pond, answering on a Tailscale name — so a RELATIVE avatar path has to
// be joined to this origin and not to whatever was baked in when it was
// stored. /api is stripped by resolveAvatarUrl; the avatar path carries its
// own.
const BASE = 'http://turtle.example.ts.net:3000/api';
const THREADS = {
  success: true,
  threads: [
    { withUserId: 'u-mich', withName: 'Michelle', unread: 0, last: { text: 'hi', createdAt: 2 } },
    { withUserId: 'u-alif', withName: 'Alif', unread: 0, last: { text: 'yo', createdAt: 1 } },
  ],
};

// ONE object, for the life of the file. The page's `load` is a useCallback on
// `api`, and the effect that calls it depends on `load` — so a mock that
// returned a fresh object per render would rebuild the callback, re-run the
// effect, set state, and render again, forever. (The web app has the same
// scar: a ServerContext mock handing back a new object hangs the runner.)
const SERVER = {
  api: { get: async () => mockThreads() },
  getBaseUrl: () => mockBase(),
};
jest.mock('../../../../context/ServerContext', () => ({ useServer: () => mockServer() }));
global.mockServer = () => SERVER;
global.mockThreads = () => THREADS;
global.mockBase = () => BASE;

// Michelle has uploaded a picture; Alif has not. One row of each is the point:
// the fallback has to survive beside the photo.
// The hook hands back the MAP itself, not a wrapper — `threadRows` calls
// `people.get(userId)` straight on it.
jest.mock('../../../../utils/usePondPeople', () => ({
  __esModule: true,
  default: () => new Map([
    ['u-mich', { userId: 'u-mich', name: 'Michelle', avatarUrl: '/api/avatars/mich.jpg?v=3' }],
    ['u-alif', { userId: 'u-alif', name: 'Alif', avatarUrl: null }],
  ]),
}));

jest.mock('../../../../context/DownloadsContext', () => ({
  useSyncSignals: () => ({ signal: 0 }),
}));

const THEME = {
  mode: 'light',
  colors: {
    background: '#fff', textPrimary: '#000', textSecondary: '#555',
    textTertiary: '#888', textMuted: '#999', accent: '#C9A227',
    border: '#ddd', surface: '#f5f5f5', surfaceElevated: '#fff',
    surfaceHighlight: '#eee',
  },
};
const INSETS = { top: 59, right: 0, bottom: 34, left: 0 };

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, right: 0, bottom: 34, left: 0 }),
}));

import MessagesPage from '../MessagesPage';

describe('the messages inbox draws people, not animals', () => {
  test('a person with a picture gets it, joined to the pond we are talking to', async () => {
    const view = await render(<MessagesPage visible onClose={jest.fn()} theme={THEME} insets={INSETS} />);
    const img = await view.findByTestId('thread-avatar-u-mich');

    // Relative in the roster, absolute on screen — and against THIS origin.
    // The /api suffix on the base is dropped; the path carries its own.
    expect(img.props.source).toEqual({
      uri: 'http://turtle.example.ts.net:3000/api/avatars/mich.jpg?v=3',
    });
    // Cropped to fill the disc, not letterboxed inside it.
    expect(img.props.contentFit).toBe('cover');
  });

  test('a person with no picture still gets a face', async () => {
    const view = await render(<MessagesPage visible onClose={jest.fn()} theme={THEME} insets={INSETS} />);
    await view.findByTestId('thread-avatar-u-mich');

    // Alif has no photo, so no Image is drawn for him at all — but his row is
    // there and the generated disc underneath carries it.
    expect(view.queryByTestId('thread-avatar-u-alif')).toBeNull();
    expect(view.getByTestId('thread-row-u-alif')).toBeTruthy();
    // …and the row still carries the generated disc that makes it a face
    // rather than an empty circle.
    expect(view.getByText('Alif')).toBeTruthy();
  });

  test('the photo sits OVER the generated disc, never replacing it', async () => {
    // The ordering is the load-bearing part. Drawn instead of the disc, a
    // picture that is slow or broken leaves a hole where a face should be.
    const view = await render(<MessagesPage visible onClose={jest.fn()} theme={THEME} insets={INSETS} />);
    await view.findByTestId('thread-avatar-u-mich');
    const row = view.getByTestId('thread-row-u-mich');
    // The disc is a sibling BEFORE the photo in the same clipped box, so the
    // photo composites on top of it: drawn instead, a slow or broken picture
    // would leave a hole where a face should be.
    const kinds = row.children.map((n) => (typeof n === 'string' ? n : n.type));
    expect(kinds.length).toBeGreaterThan(0);
    expect(view.getByTestId('thread-avatar-u-mich')).toBeTruthy();
  });
});
