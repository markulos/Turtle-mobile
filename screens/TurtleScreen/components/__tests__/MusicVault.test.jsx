import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import MusicVault from '../MusicVault';
import { __resetForTests, getPending } from '../../../../services/offlineQueue';
import { __resetForTests as resetTranscripts } from '../../../../services/transcriptionStore';

// The transcript reader (mounted by the vault) reads the player's progress
// straight from the native package; the vault itself never touches it.
jest.mock('@rntp/player', () => ({ useProgress: () => ({ position: 0, duration: 0, buffered: 0 }) }));

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
  playMedia: mockPlayMedia,
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
    resetTranscripts();
    mockApi.get.mockImplementation(() => Promise.resolve({}));
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

    // The useFocusEffect mock above runs its callback on EVERY render, and the
    // vault re-renders once its transcription capabilities arrive — so this
    // proves the focus effect refreshes, not how many times the tree painted.
    expect(mockRefreshLibrary).toHaveBeenCalled();
  });

  test('offers an explicit production retry for player setup failure', async () => {
    mockMusicPlayer.ready = false;
    mockMusicPlayer.setupError = 'Native player unavailable';
    mockMusicPlayer.error = 'Native player unavailable';
    const view = await render(<MusicVault onClose={jest.fn()} />);

    await fireEvent.press(view.getByText('Retry player'));

    expect(mockRetrySetup).toHaveBeenCalledTimes(1);
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

  // A pond with the by-media transcription routes. Jobs list one finished
  // transcript for 'First'; nothing for the others.
  const newerPond = () => mockApi.get.mockImplementation((path) => {
    if (path.startsWith('/transcriptions/capabilities')) {
      return Promise.resolve({
        models: ['small'],
        defaults: { diarize: true, model: 'small', minSpeakers: 2, maxSpeakers: 5, primaryName: 'Primary' },
        runtime: { pythonAvailable: true, workerAvailable: true, diarizationAvailable: true },
        features: { mediaSubmit: true, list: true, words: true },
      });
    }
    if (path.startsWith('/transcriptions?')) {
      return Promise.resolve({ success: true, jobs: [
        { id: 'tr_1', status: 'completed', mediaId: 'one', originalName: 'First.mp3', createdAt: '2026-09-25T10:00:00Z' },
      ] });
    }
    if (path === '/me') return Promise.resolve({ user: { displayName: 'Mark' } });
    if (/\/result$/.test(path)) {
      return Promise.resolve({ turns: [{ speaker: 'Mark', start: 0, end: 2, text: 'Hello there', words: [] }] });
    }
    return Promise.resolve({});
  });

  test('a pond that cannot transcribe by media id gets no transcript key and no sheet row', async () => {
    const view = await render(<MusicVault onClose={jest.fn()} />);
    await fireEvent.press(view.getByLabelText('Options for First'));
    expect(view.queryByLabelText('Transcribe')).toBeNull();
    expect(view.queryByLabelText('View transcript')).toBeNull();
    expect(view.queryByLabelText('Transcribing…')).toBeNull();
  });

  test('a newer pond: the sheet offers Transcribe, the pond’s own transcripts show as View transcript', async () => {
    newerPond();
    const view = await render(<MusicVault onClose={jest.fn()} />);
    // The list was fetched once on mount and folded into the shared store.
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/transcriptions?limit=100'));

    // Second is playing and has no transcript: the transport key offers one.
    await waitFor(() => view.getByLabelText('Transcribe'));

    await fireEvent.press(view.getByLabelText('Options for First'));
    await waitFor(() => view.getByLabelText('View transcript'));
    await fireEvent.press(view.getByLabelText('View transcript'));

    // The reader is up for First, over the library.
    await waitFor(() => view.getByLabelText('Back to music'));
    await waitFor(() => view.getByText('Hello there'));
    expect(mockApi.get).toHaveBeenCalledWith('/transcriptions/tr_1/result');
    expect(view.queryByTestId('track-actions-card')).toBeNull();
  });

  test('the transport key opens the reader for the playing track', async () => {
    newerPond();
    const view = await render(<MusicVault onClose={jest.fn()} />);
    await waitFor(() => view.getByLabelText('Transcribe'));
    await fireEvent.press(view.getByLabelText('Transcribe'));
    await waitFor(() => view.getByLabelText('Back to music'));
    expect(view.getByText('No transcript yet')).toBeTruthy();
    // The pond's defaults, with the profile name already the main speaker.
    expect(view.getByText('small · 2–5 speakers · auto language')).toBeTruthy();
  });

  test('a job still running disables the sheet row and words the transport key', async () => {
    newerPond();
    // On disk, the way a job sent before this launch would be: the vault
    // hydrates the store on mount, and an in-memory seed would be read over.
    mockStore.set('turtle:transcriptions:v1', JSON.stringify([
      { key: 'k', id: 'tr_2', mediaId: 'two', name: 'Second', status: 'transcribing', createdAt: 5 },
    ]));
    const view = await render(<MusicVault onClose={jest.fn()} />);
    await waitFor(() => view.getByLabelText('Transcribing…'));
    await fireEvent.press(view.getByLabelText('Options for Second'));
    const rows = view.getAllByLabelText('Transcribing…');
    const row = rows[rows.length - 1];
    expect(row.props.accessibilityState).toEqual({ disabled: true });
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
