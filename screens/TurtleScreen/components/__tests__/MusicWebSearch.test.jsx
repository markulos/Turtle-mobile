/**
 * The Music tab's search field, pointed at the WEB.
 *
 * `query` is a PROP of MusicVault (the vault owns it so it survives a swipe
 * away and back), and a non-empty one is what puts the page into search mode —
 * so these drive the feature the way the vault does, without reaching for the
 * text input's focus.
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import MusicVault from '../MusicVault';
import { __resetForTests } from '../../../../services/offlineQueue';

const mockStore = new Map();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((k) => Promise.resolve(mockStore.has(k) ? mockStore.get(k) : null)),
  setItem: jest.fn((k, v) => { mockStore.set(k, v); return Promise.resolve(); }),
  removeItem: jest.fn((k) => { mockStore.delete(k); return Promise.resolve(); }),
}));

const RESULT = {
  videoId: 'MV_3Dpw-BRY',
  title: 'Kavinsky - Nightcall',
  channel: 'Record Makers',
  duration: 257,
  durationLabel: '4:17',
  thumbnail: 'https://i.ytimg.com/vi/MV_3Dpw-BRY/mqdefault.jpg',
  url: 'https://www.youtube.com/watch?v=MV_3Dpw-BRY',
  previewUrl: '/api/music/web/preview/MV_3Dpw-BRY?token=abc.def',
};

const mockPlayMedia = jest.fn();
const mockPlayRows = jest.fn();
const mockApi = {
  get: jest.fn(() => Promise.resolve({ success: true, results: [RESULT] })),
  post: jest.fn(() => Promise.resolve({ success: true, id: 'job_1' })),
  put: jest.fn(() => Promise.resolve({ success: true })),
  patch: jest.fn(() => Promise.resolve({})),
  delete: jest.fn(() => Promise.resolve({ success: true })),
};
const mockMusicPlayer = {
  tracks: [
    { id: 'one', filename: 'Nightcall in my library.mp3', rawUrl: '/media/one.mp3' },
    { id: 'two', filename: 'Second.mp3', rawUrl: '/media/two.mp3' },
  ],
  recordings: [],
  loading: false,
  ready: true,
  error: null,
  setupError: null,
  activeTrack: null,
  isPlaying: false,
  position: 0,
  duration: 0,
  playMedia: mockPlayMedia,
  playRows: mockPlayRows,
  togglePlayback: jest.fn(),
  previous: jest.fn(),
  next: jest.fn(),
  seekTo: jest.fn(),
  refreshLibrary: jest.fn(),
  retrySetup: jest.fn(),
};

jest.mock('../../../../context/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        background: '#000', surface: '#0a0a0a', surfaceElevated: '#111',
        border: '#222', borderStrong: '#333',
        textPrimary: '#fff', textSecondary: '#ccc', textTertiary: '#999', textMuted: '#666',
        accent: '#4ADE80', accentSuccess: '#4ADE80', danger: '#F87171',
      },
    },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (callback) => callback() }));
jest.mock('../../../../context/MusicPlayerContext', () => ({ useMusicPlayer: () => mockMusicPlayer }));
jest.mock('../../../../context/ServerContext', () => ({
  useServer: () => ({
    api: mockApi,
    getBaseUrl: () => 'http://pond.local',
    getMediaBaseUrl: () => 'http://pond.local/api',
    isConnected: true,
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
  tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn(),
}));

/** The 700ms debounce is real time, so every wait has to clear it. */
const AFTER_DEBOUNCE = { timeout: 5000 };

/** The vault fetches shares and track access of its own on mount, so "did it
 *  search the web" has to be asked of the web search's own endpoint. */
const webSearches = () => mockApi.get.mock.calls.filter(([path]) => String(path).includes('/api/music/web/search'));

/** Open the vault already searching, and switch the scope to the web. */
async function searchingTheWeb(query = 'nightcall') {
  const view = await render(<MusicVault query={query} onQueryChange={jest.fn()} />);
  await fireEvent.press(view.getByTestId('music-search-scope-web'));
  return view;
}

describe('the search scope toggle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.clear();
    __resetForTests();
    mockMusicPlayer.activeTrack = null;
    mockApi.get.mockImplementation(() => Promise.resolve({ success: true, results: [RESULT] }));
    mockApi.post.mockImplementation(() => Promise.resolve({ success: true, id: 'job_1' }));
  });

  test('is not on the page until you are searching', async () => {
    const view = await render(<MusicVault onQueryChange={jest.fn()} />);
    expect(view.queryByTestId('music-search-scope')).toBeNull();
  });

  test('appears with both scopes once you are, library lit', async () => {
    const view = await render(<MusicVault query="nightcall" onQueryChange={jest.fn()} />);
    expect(view.getByTestId('music-search-scope')).toBeTruthy();
    // The library is the default: it is still the common errand.
    expect(view.getByTestId('music-search-scope-library').props.accessibilityState)
      .toMatchObject({ selected: true });
    expect(view.getByTestId('music-search-scope-web').props.accessibilityState)
      .toMatchObject({ selected: false });
  });

  test('the library scope does not touch the network', async () => {
    await render(<MusicVault query="nightcall" onQueryChange={jest.fn()} />);
    // Matching my own tracks is a loop over an array; a search of the web is a
    // process on the pond. Browsing must never pay for the second.
    await waitFor(() => expect(webSearches()).toHaveLength(0));
  });
});

describe('searching the web', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.clear();
    __resetForTests();
    mockMusicPlayer.activeTrack = null;
    mockApi.get.mockImplementation(() => Promise.resolve({ success: true, results: [RESULT] }));
    mockApi.post.mockImplementation(() => Promise.resolve({ success: true, id: 'job_1' }));
  });

  test('asks the pond after the debounce and lists what came back', async () => {
    const view = await searchingTheWeb();
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/music/web/search?q=nightcall'),
        expect.anything(),
      );
    }, AFTER_DEBOUNCE);
    await waitFor(() => expect(view.getByText('Kavinsky - Nightcall')).toBeTruthy(), AFTER_DEBOUNCE);
    expect(view.getByText('Record Makers · 4:17')).toBeTruthy();
    expect(view.getByText('1 result on YouTube')).toBeTruthy();
  });

  test('says it is searching before it says it found nothing', async () => {
    const view = await searchingTheWeb();
    // The status line is the ONE place this is reported, so it must never read
    // "nothing found" over a search that has not returned.
    expect(view.getByText(/Searching YouTube/)).toBeTruthy();
  });

  test('a query too short to mean anything is not sent', async () => {
    const view = await searchingTheWeb('n');
    expect(view.getByText('Keep typing…')).toBeTruthy();
    await waitFor(() => expect(webSearches()).toHaveLength(0), AFTER_DEBOUNCE);
  });

  test('a pond that predates the feature says so, rather than finding nothing', async () => {
    mockApi.get.mockImplementation(() => Promise.reject(new Error('API 404 on GET /api/music/web/search')));
    const view = await searchingTheWeb();
    await waitFor(
      () => expect(view.getByText(/pond needs an update/)).toBeTruthy(),
      AFTER_DEBOUNCE,
    );
  });

  test('a pond with no yt-dlp passes its own sentence through', async () => {
    mockApi.get.mockImplementation(() => Promise.reject(new Error(
      'API 503 on GET /api/music/web/search — {"success":false,"error":"This pond cannot search the web — yt-dlp is not installed."}',
    )));
    const view = await searchingTheWeb();
    await waitFor(() => expect(view.getByText(/yt-dlp is not installed/)).toBeTruthy(), AFTER_DEBOUNCE);
  });

  test('switching back to my library shows my tracks again', async () => {
    const view = await searchingTheWeb();
    await waitFor(() => expect(view.getByText('Kavinsky - Nightcall')).toBeTruthy(), AFTER_DEBOUNCE);
    await fireEvent.press(view.getByTestId('music-search-scope-library'));
    expect(view.getByText('Nightcall in my library')).toBeTruthy();
    expect(view.queryByText('Kavinsky - Nightcall')).toBeNull();
  });
});

describe('previewing and downloading a result', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.clear();
    __resetForTests();
    mockMusicPlayer.activeTrack = null;
    mockApi.get.mockImplementation(() => Promise.resolve({ success: true, results: [RESULT] }));
    mockApi.post.mockImplementation(() => Promise.resolve({ success: true, id: 'job_1' }));
  });

  test('tapping a result plays it THROUGH THE POND, as a queue of one', async () => {
    const view = await searchingTheWeb();
    await waitFor(() => expect(view.getByText('Kavinsky - Nightcall')).toBeTruthy(), AFTER_DEBOUNCE);
    await fireEvent.press(view.getByLabelText('Preview Kavinsky - Nightcall'));

    expect(mockPlayRows).toHaveBeenCalledTimes(1);
    const [rows, startId] = mockPlayRows.mock.calls[0];
    expect(startId).toBe('yt:MV_3Dpw-BRY');
    // A queue of one: skip must not walk out of a preview into my library.
    expect(rows).toHaveLength(1);
    // Never a googlevideo URL — that one is bound to the pond's IP.
    expect(rows[0].rawUrl).toBe('http://pond.local/api/music/web/preview/MV_3Dpw-BRY?token=abc.def');
    // And nothing was downloaded by listening.
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  test('the transport bar names the preview, with skip off both ends', async () => {
    // The player is already reporting the preview as the active track — the
    // bar's condition is "the playing id is the previewed row", and the tap
    // below is what supplies the other half of it.
    mockMusicPlayer.activeTrack = { mediaId: 'yt:MV_3Dpw-BRY', title: 'Kavinsky - Nightcall' };
    mockMusicPlayer.isPlaying = true;
    try {
      const view = await searchingTheWeb();
      await waitFor(() => expect(view.getByText('Kavinsky - Nightcall')).toBeTruthy(), AFTER_DEBOUNCE);
      // Before the tap there is no bar: a track id the page knows nothing
      // about must not put an empty transport on screen.
      expect(view.queryByLabelText('Pause')).toBeNull();

      await fireEvent.press(view.getByLabelText('Preview Kavinsky - Nightcall'));

      // …so now the page has a pause button for it, not just the lock screen.
      await waitFor(() => expect(view.getByLabelText('Pause')).toBeTruthy());
      // Skip walks the QUEUE, and a preview's queue is one track long.
      expect(view.getByLabelText('Previous track').props.accessibilityState)
        .toMatchObject({ disabled: true });
      expect(view.getByLabelText('Next track').props.accessibilityState)
        .toMatchObject({ disabled: true });
    } finally {
      mockMusicPlayer.isPlaying = false;
    }
  });

  test('the download key sends the watch link to the queue, then becomes a receipt', async () => {
    const view = await searchingTheWeb();
    await waitFor(() => expect(view.getByText('Kavinsky - Nightcall')).toBeTruthy(), AFTER_DEBOUNCE);
    await fireEvent.press(view.getByLabelText('Download Kavinsky - Nightcall'));

    expect(mockApi.post).toHaveBeenCalledWith('/api/downloads', {
      url: 'https://www.youtube.com/watch?v=MV_3Dpw-BRY',
      outputKind: 'audio',
    });
    // Enqueuing twice is two copies in the library, and the second tap is the
    // one you make while wondering whether the first worked.
    await waitFor(() => expect(view.queryByLabelText('Download Kavinsky - Nightcall')).toBeNull());
    expect(view.getByLabelText('Kavinsky - Nightcall is downloading')).toBeTruthy();
    // Downloading is not listening.
    expect(mockPlayRows).not.toHaveBeenCalled();
  });

  test('a refused download says so and offers the key back', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockApi.post.mockImplementation(() => Promise.reject(new Error(
      'API 400 on POST /api/downloads — {"success":false,"error":"Only http(s) URLs"}',
    )));
    const view = await searchingTheWeb();
    await waitFor(() => expect(view.getByText('Kavinsky - Nightcall')).toBeTruthy(), AFTER_DEBOUNCE);
    await fireEvent.press(view.getByLabelText('Download Kavinsky - Nightcall'));

    await waitFor(() => expect(alert).toHaveBeenCalledWith(
      'Could not start that download',
      'Only http(s) URLs',
    ));
    await waitFor(() => expect(view.getByLabelText('Retry downloading Kavinsky - Nightcall')).toBeTruthy());
    alert.mockRestore();
  });
});

/**
 * The loading state, which exists to stop the list moving.
 *
 * The rule: between "I have typed enough to search" and "the results are
 * here", the list must never be a blank space that later fills. It is either
 * placeholder rows (the first search) or the previous results (every search
 * after that) — both the same shape as what arrives.
 */
describe('waiting for results', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.clear();
    __resetForTests();
    mockMusicPlayer.activeTrack = null;
    mockApi.post.mockImplementation(() => Promise.resolve({ success: true, id: 'job_1' }));
  });

  test('the first search shows placeholder rows, not an empty page', async () => {
    // A search that never settles, so the loading frame can be inspected.
    mockApi.get.mockImplementation((path) => (
      String(path).includes('/api/music/web/search')
        ? new Promise(() => {})
        : Promise.resolve({ success: true, results: [] })
    ));
    const view = await searchingTheWeb();
    await waitFor(() => expect(view.getByTestId('music-web-skeleton')).toBeTruthy(), AFTER_DEBOUNCE);
  });

  test('the placeholders give way to the results and leave nothing behind', async () => {
    mockApi.get.mockImplementation(() => Promise.resolve({ success: true, results: [RESULT] }));
    const view = await searchingTheWeb();
    await waitFor(() => expect(view.getByText('Kavinsky - Nightcall')).toBeTruthy(), AFTER_DEBOUNCE);
    expect(view.queryByTestId('music-web-skeleton')).toBeNull();
  });

  test('a FINISHED search with no hits shows no placeholders — the status line says it', async () => {
    mockApi.get.mockImplementation(() => Promise.resolve({ success: true, results: [] }));
    const view = await searchingTheWeb();
    await waitFor(() => expect(view.getByText(/Nothing on YouTube/)).toBeTruthy(), AFTER_DEBOUNCE);
    expect(view.queryByTestId('music-web-skeleton')).toBeNull();
  });

  test('the status line is ONE line, so the list cannot shift when it changes', async () => {
    mockApi.get.mockImplementation(() => Promise.resolve({ success: true, results: [RESULT] }));
    const view = await searchingTheWeb();
    const status = await waitFor(() => view.getByText('1 result on YouTube'), AFTER_DEBOUNCE);
    expect(status.props.numberOfLines).toBe(1);
  });
});
