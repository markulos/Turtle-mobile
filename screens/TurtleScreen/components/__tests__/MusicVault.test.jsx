import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import MusicVault from '../MusicVault';
import { __resetForTests, getPending } from '../../../../services/offlineQueue';

// The outbox persists to AsyncStorage; keep it in memory for the test run.
const mockStore = new Map();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((k) => Promise.resolve(mockStore.has(k) ? mockStore.get(k) : null)),
  setItem: jest.fn((k, v) => { mockStore.set(k, v); return Promise.resolve(); }),
  removeItem: jest.fn((k) => { mockStore.delete(k); return Promise.resolve(); }),
}));

const mockPlayMedia = jest.fn();
const mockTogglePlayback = jest.fn();
const mockPrevious = jest.fn();
const mockNext = jest.fn();
const mockSeekTo = jest.fn();
const mockPlayRows = jest.fn();
const mockRefreshLibrary = jest.fn();
const mockRetrySetup = jest.fn();
const mockApi = {
  get: jest.fn(() => Promise.resolve({})),
  post: jest.fn(() => Promise.resolve({})),
  put: jest.fn(() => Promise.resolve({ success: true })),
  patch: jest.fn(() => Promise.resolve({})),
  delete: jest.fn(() => Promise.resolve({ success: true })),
};
const mockMusicPlayer = {
  tracks: [
    { id: 'one', filename: 'First.mp3', rawUrl: '/media/one.mp3', tags: '["Chill"]' },
    { id: 'two', filename: 'Second.mp3', rawUrl: '/media/two.mp3' },
    { id: 'three', filename: 'Third.mp3', rawUrl: '/media/three.mp3', tags: '["Focus"]' },
  ],
  loading: false,
  ready: true,
  error: null,
  setupError: null,
  libraryError: null,
  activeTrack: {
    mediaId: 'two',
    title: 'Second',
    artist: 'Turtle Music',
  },
  isPlaying: true,
  position: 45,
  duration: 180,
  // Audio filed OUT of the library (see utils/voiceRecordings): the provider
  // hands these over separately, and the page is the only way to them.
  recordings: [
    { id: 'memo', filename: 'Voice memo.m4a', rawUrl: '/media/memo.m4a', tags: '["Voice recordings"]' },
  ],
  playMedia: mockPlayMedia,
  playRows: mockPlayRows,
  togglePlayback: mockTogglePlayback,
  previous: mockPrevious,
  next: mockNext,
  seekTo: mockSeekTo,
  refreshLibrary: mockRefreshLibrary,
  retrySetup: mockRetrySetup,
};

jest.mock('../../../../context/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        background: '#000',
        surfaceElevated: '#111',
        border: '#222',
        textPrimary: '#fff',
        textSecondary: '#ccc',
        textTertiary: '#999',
        textMuted: '#666',
        accentSuccess: '#4ADE80',
      },
    },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback) => callback(),
}));
jest.mock('../../../../context/MusicPlayerContext', () => ({
  useMusicPlayer: () => mockMusicPlayer,
}));
jest.mock('../../../../context/ServerContext', () => ({
  useServer: () => ({
    api: mockApi,
    getBaseUrl: () => 'http://pond.local/api',
    getMediaBaseUrl: () => 'http://pond.local/api',
  }),
}));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  downloadAsync: jest.fn(() => Promise.resolve({ uri: 'file:///cache/track.mp3' })),
  deleteAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../../../utils/haptics', () => ({
  tapHaptic: jest.fn(),
  impactHaptic: jest.fn(),
  notifyHaptic: jest.fn(),
}));

describe('MusicVault', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.clear();
    __resetForTests();
    mockApi.patch.mockImplementation(() => Promise.resolve({}));
    mockMusicPlayer.activeTrack = {
      mediaId: 'two',
      title: 'Second',
      artist: 'Turtle Music',
    };
    mockMusicPlayer.ready = true;
    mockMusicPlayer.loading = false;
    mockMusicPlayer.error = null;
    mockMusicPlayer.setupError = null;
    mockMusicPlayer.libraryError = null;
  });

  test('starts the selected media row through the shared provider', async () => {
    const view = await render(<MusicVault onClose={jest.fn()} />);
    await fireEvent.press(view.getByText('First'));
    expect(mockPlayMedia).toHaveBeenCalledWith('one');
  });

  test('renders the active native item and routes transport controls', async () => {
    const view = await render(<MusicVault onClose={jest.fn()} />);
    expect(view.getAllByText('Second').length).toBeGreaterThan(0);

    await fireEvent.press(view.getByLabelText('Previous track'));
    await fireEvent.press(view.getByLabelText('Pause'));
    await fireEvent.press(view.getByLabelText('Next track'));

    expect(mockPrevious).toHaveBeenCalledTimes(1);
    expect(mockTogglePlayback).toHaveBeenCalledTimes(1);
    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  test('disables Next on the final queue item', async () => {
    mockMusicPlayer.activeTrack = {
      mediaId: 'three',
      title: 'Third',
      artist: 'Turtle Music',
    };
    const view = await render(<MusicVault onClose={jest.fn()} />);
    const nextButton = view.getByLabelText('Next track');

    expect(nextButton.props.accessibilityState).toEqual({ disabled: true });
    await fireEvent.press(nextButton);
    expect(mockNext).not.toHaveBeenCalled();
  });

  test('prevents playback commands while the provider is not ready', async () => {
    mockMusicPlayer.ready = false;
    const view = await render(<MusicVault onClose={jest.fn()} />);

    expect(view.getByLabelText('Pause').props.accessibilityState).toEqual({ disabled: true });
    await fireEvent.press(view.getByText('First'));
    await fireEvent.press(view.getByLabelText('Pause'));

    expect(mockPlayMedia).not.toHaveBeenCalled();
    expect(mockTogglePlayback).not.toHaveBeenCalled();
  });

  test('keeps retained tracks visible while the library refreshes with an error', async () => {
    mockMusicPlayer.loading = true;
    mockMusicPlayer.error = 'Unable to refresh music';
    const view = await render(<MusicVault onClose={jest.fn()} />);

    expect(view.getByText('First')).toBeTruthy();
    expect(view.getByText('Unable to refresh music')).toBeTruthy();
  });

  test('refreshes the library whenever Music Vault opens or regains focus', async () => {
    await render(<MusicVault onClose={jest.fn()} />);

    expect(mockRefreshLibrary).toHaveBeenCalledTimes(1);
  });

  test('offers an explicit production retry for player setup failure', async () => {
    mockMusicPlayer.ready = false;
    mockMusicPlayer.setupError = 'Native player unavailable';
    mockMusicPlayer.error = 'Native player unavailable';
    const view = await render(<MusicVault onClose={jest.fn()} />);

    await fireEvent.press(view.getByText('Retry player'));

    expect(mockRetrySetup).toHaveBeenCalledTimes(1);
  });

  /**
   * ── You can scroll to the END of the library ─────────────────────────────
   *
   * The page's lifting layer is permanently `lift` taller than the screen (a
   * static negative bottom margin, so the rise into search is a pure
   * transform). The library list lives in it, which means it hangs that far
   * BELOW the screen and its last `lift` points can never be scrolled into
   * view — the end of the list stuck behind the player and the dock however
   * hard you pulled. The Files page, from the same template, has always added
   * it back; this page never did.
   */
  describe('the foot of the library list', () => {
    /** The scroller's own contentContainerStyle, flattened. */
    const padOf = (view) => {
      let pad = null;
      const walk = (node) => {
        if (!node || typeof node !== 'object' || pad !== null) return;
        const style = node.props?.contentContainerStyle;
        if (style) {
          const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
          if (typeof flat.paddingBottom === 'number') { pad = flat.paddingBottom; return; }
        }
        (node.children || []).forEach(walk);
      };
      walk(view.toJSON());
      return pad;
    };

    test('clears the lift, so the last track can be reached at all', async () => {
      // The vault header is 160 tall and the page keeps 40 once it has slid
      // away: 120 points of list hanging below the screen.
      const lifted = await render(
        <MusicVault onClose={jest.fn()} topInset={160} searchTopInset={40} />,
      );
      const flat = await render(<MusicVault onClose={jest.fn()} topInset={40} searchTopInset={40} />);
      expect(padOf(lifted)).toBe(padOf(flat) + 120);
    });

    test('reserves the transport bar when a track is loaded', async () => {
      // activeTrack is 'two', which IS in the library, so the bar is up.
      const view = await render(<MusicVault onClose={jest.fn()} bottomInset={96} />);
      // The bar has not been measured in this environment (no layout), so the
      // reserve is the documented fallback — what matters is that it is the
      // BAR being reserved, which already includes the dock, and not the bare
      // dock inset.
      expect(padOf(view)).toBe(150 + 16);
    });

    test('reserves the dock when nothing is playing', async () => {
      const previous = mockMusicPlayer.activeTrack;
      mockMusicPlayer.activeTrack = null;
      try {
        const view = await render(<MusicVault onClose={jest.fn()} bottomInset={96} />);
        // No bar to clear, so the floating dock is what is left — and it is
        // the host's measured dock height, never a hand-tuned number.
        expect(padOf(view)).toBe(96 + 24);
      } finally {
        mockMusicPlayer.activeTrack = previous;
      }
    });
  });

  /**
   * ── The Voice recordings folder ──────────────────────────────────────────
   *
   * What goes in it is not in the library and not in the queue the library
   * plays (the provider enforces that — see MusicPlayerContext's own tests).
   * What this page owes is the other half of the promise: a way IN to those
   * tracks, a way to play them without touching the music, and a way back out
   * of the folder again.
   */
  describe('voice recordings', () => {
    test('the library offers the folder, with what is in it', async () => {
      const view = await render(<MusicVault onClose={jest.fn()} />);
      const row = view.getByTestId('music-voice-recordings-row');
      expect(row).toBeTruthy();
      // The row says the consequence, not just the count.
      expect(view.getByText(/1 recording · kept out of your music/)).toBeTruthy();
      // And the recording itself is NOT in the library list behind it.
      expect(view.queryByText('Voice memo')).toBeNull();
    });

    test('opening it lists the recordings', async () => {
      const view = await render(<MusicVault onClose={jest.fn()} />);
      await fireEvent.press(view.getByTestId('music-voice-recordings-row'));
      expect(view.getByTestId('voice-recordings-list')).toBeTruthy();
      expect(view.getByText('Voice memo')).toBeTruthy();
    });

    test('playing one inside the folder uses its OWN queue', async () => {
      const view = await render(<MusicVault onClose={jest.fn()} />);
      await fireEvent.press(view.getByTestId('music-voice-recordings-row'));
      await fireEvent.press(view.getByText('Voice memo'));
      // playRows, not playMedia: the library's queue does not contain it, and
      // Next must walk the recordings rather than wander into the music.
      expect(mockPlayRows).toHaveBeenCalledTimes(1);
      const [rows, startId] = mockPlayRows.mock.calls[0];
      expect(rows.map((r) => r.id)).toEqual(['memo']);
      expect(startId).toBe('memo');
      expect(mockPlayMedia).not.toHaveBeenCalled();
    });

    test('a track in the music can be moved into the folder', async () => {
      const view = await render(<MusicVault onClose={jest.fn()} />);
      await fireEvent.press(view.getByLabelText('Options for First'));
      await fireEvent.press(view.getByTestId('track-toggle-recording'));
      // The same single tag write a playlist add is — the tags endpoint
      // REPLACES the list, so the row's own tags ride along with it.
      expect(mockApi.put).toHaveBeenCalledWith('/media/one/tags', {
        tags: ['Chill', 'Voice recordings'],
      });
    });

    test('and a recording can be moved back out of it', async () => {
      const view = await render(<MusicVault onClose={jest.fn()} />);
      await fireEvent.press(view.getByTestId('music-voice-recordings-row'));
      await fireEvent.press(view.getByLabelText('Options for Voice memo'));
      await fireEvent.press(view.getByTestId('track-toggle-recording'));
      // Back to the music: the tag comes off and nothing else changes.
      expect(mockApi.put).toHaveBeenCalledWith('/media/memo/tags', { tags: [] });
    });
  });

  test('opens the per-track options card from the row button', async () => {
    const view = await render(<MusicVault onClose={jest.fn()} />);

    expect(view.queryByTestId('track-actions-card')).toBeNull();
    await fireEvent.press(view.getByLabelText('Options for First'));

    expect(view.getByTestId('track-actions-card')).toBeTruthy();
    expect(view.getByLabelText('Share')).toBeTruthy();
    expect(view.getByLabelText('Rename track…')).toBeTruthy();
    expect(view.getByLabelText('Add to playlist')).toBeTruthy();
    expect(view.getByLabelText('Delete from vault')).toBeTruthy();
  });

  test('rename patches originalName, keeps the extension, and updates the row now', async () => {
    const view = await render(<MusicVault onClose={jest.fn()} />);
    await fireEvent.press(view.getByLabelText('Options for First'));
    await fireEvent.press(view.getByLabelText('Rename track…'));

    // Seeded with the current title (extension stripped, as displayed).
    const input = view.getByTestId('rename-track-input');
    expect(input.props.value).toBe('First');

    await fireEvent.changeText(input, 'Night Drive');
    await fireEvent.press(view.getByLabelText('Save track name'));

    // The stored label keeps the file extension — titleOf() strips it for
    // display, so dropping it here would corrupt names like "Take.Five".
    expect(mockApi.patch).toHaveBeenCalledWith('/media/one', { originalName: 'Night Drive.mp3' });
    // Optimistic: the new name is on screen before the PATCH resolves.
    expect(view.getByText('Night Drive')).toBeTruthy();
    expect(view.queryByText('First')).toBeNull();
  });

  test('renaming offline parks the request instead of failing the edit', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockApi.patch.mockImplementation(() => Promise.reject(new Error('Network request failed')));

    const view = await render(<MusicVault onClose={jest.fn()} />);
    await fireEvent.press(view.getByLabelText('Options for First'));
    await fireEvent.press(view.getByLabelText('Rename track…'));
    await fireEvent.changeText(view.getByTestId('rename-track-input'), 'Night Drive');
    await fireEvent.press(view.getByLabelText('Save track name'));

    await waitFor(() => expect(getPending()).toHaveLength(1));
    expect(getPending()[0]).toMatchObject({
      method: 'patch',
      path: '/media/one',
      body: { originalName: 'Night Drive.mp3' },
      key: 'media:one:originalName',
    });
    // The edit stands — no revert, no error alert. It sends on reconnect.
    expect(view.getByText('Night Drive')).toBeTruthy();
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  test('rename to the same name is a no-op write', async () => {
    const view = await render(<MusicVault onClose={jest.fn()} />);
    await fireEvent.press(view.getByLabelText('Options for First'));
    await fireEvent.press(view.getByLabelText('Rename track…'));

    // No Save button offered while the draft still matches the current title.
    expect(view.queryByLabelText('Save track name')).toBeNull();
    await fireEvent(view.getByTestId('rename-track-input'), 'submitEditing');

    expect(mockApi.patch).not.toHaveBeenCalled();
    expect(view.queryByTestId('track-actions-card')).toBeNull();
  });

  test('the options button does not start playback', async () => {
    const view = await render(<MusicVault onClose={jest.fn()} />);
    await fireEvent.press(view.getByLabelText('Options for First'));
    expect(mockPlayMedia).not.toHaveBeenCalled();
  });

  test('playlist page offers the audio library tags and adds via the tags endpoint', async () => {
    const view = await render(<MusicVault onClose={jest.fn()} />);
    await fireEvent.press(view.getByLabelText('Options for Second'));
    await fireEvent.press(view.getByLabelText('Add to playlist'));

    // Playlists come from the tracks' own tags, not the global album list.
    expect(view.getByLabelText('Chill')).toBeTruthy();
    expect(view.getByLabelText('Focus')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('Chill'));

    expect(mockApi.put).toHaveBeenCalledWith('/media/two/tags', { tags: ['Chill'] });
  });

  test('the pinned Playlists row pushes a page listing every playlist', async () => {
    const view = await render(<MusicVault onClose={jest.fn()} />);

    // Names come from the audio library's own tags, with their track counts.
    await fireEvent.press(view.getByLabelText('Playlists, 2'));

    expect(view.getByLabelText('Chill, 1 track')).toBeTruthy();
    expect(view.getByLabelText('Focus, 1 track')).toBeTruthy();
  });

  test('opening a playlist lists only its tracks, and they are playable', async () => {
    const view = await render(<MusicVault onClose={jest.fn()} />);
    await fireEvent.press(view.getByLabelText('Playlists, 2'));
    await fireEvent.press(view.getByLabelText('Focus, 1 track'));

    // The page OVERLAYS the library rather than unmounting it, so every title
    // still in the list behind it is also still in the tree. 'Third' (tagged
    // Focus) is therefore rendered twice and 'First' (tagged Chill) once —
    // which is what proves the page filtered to just this playlist.
    expect(view.getAllByText('Third')).toHaveLength(2);
    expect(view.getAllByText('First')).toHaveLength(1);

    const rows = view.getAllByText('Third');
    await fireEvent.press(rows[rows.length - 1]);
    expect(mockPlayMedia).toHaveBeenCalledWith('three');
  });

  test('adding to a playlist keeps the tags the track already had', async () => {
    const view = await render(<MusicVault onClose={jest.fn()} />);
    await fireEvent.press(view.getByLabelText('Options for First'));
    await fireEvent.press(view.getByLabelText('Add to playlist'));
    await fireEvent.press(view.getByLabelText('Focus'));

    // 'Chill' is First's existing tag — the endpoint REPLACES the list, so the
    // union has to be sent or the old playlist would be dropped.
    expect(mockApi.put).toHaveBeenCalledWith('/media/one/tags', { tags: ['Chill', 'Focus'] });
  });
});
