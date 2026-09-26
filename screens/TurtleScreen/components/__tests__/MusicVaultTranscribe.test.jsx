/**
 * Transcription, from the Media tab.
 *
 * Three doors and one destination: the library's Transcribe row, a track's ⋯
 * menu, and the Transcribed playlist that finished jobs land in. Plus the
 * point of the whole thing — a transcribed track reads along as it plays.
 *
 * The transcription STORE is the seam these are driven from: it is what the
 * phone knows about its own jobs, and every one of these surfaces is a view
 * over it.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import MusicVault from '../MusicVault';
import { __resetForTests as resetQueue } from '../../../../services/offlineQueue';
import { __resetForTests as resetRecordings } from '../../../../services/transcriptionStore';

const mockStore = new Map();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((k) => Promise.resolve(mockStore.has(k) ? mockStore.get(k) : null)),
  setItem: jest.fn((k, v) => { mockStore.set(k, v); return Promise.resolve(); }),
  removeItem: jest.fn((k) => { mockStore.delete(k); return Promise.resolve(); }),
}));

const mockApi = {
  get: jest.fn((path) => {
    if (path.startsWith('/transcriptions/') && path.endsWith('/result')) {
      return Promise.resolve({
        turns: [
          { start: 0, end: 30, text: 'Right, where were we.', speaker: 'Mark' },
          { start: 40, end: 70, text: 'The deploy went out an hour ago.', speaker: 'Person 2' },
        ],
      });
    }
    if (path.startsWith('/transcriptions/capabilities')) {
      return Promise.resolve({
        models: ['small'],
        defaults: { diarize: true, model: 'small', minSpeakers: 2, maxSpeakers: 5, primaryName: 'Primary' },
        ranges: { minSpeakers: [1, 10], maxSpeakers: [1, 10] },
        runtime: { pythonAvailable: true, workerAvailable: true, diarizationAvailable: true },
      });
    }
    return Promise.resolve({ items: [] });
  }),
  post: jest.fn(() => Promise.resolve({})),
  put: jest.fn(() => Promise.resolve({ success: true })),
  patch: jest.fn(() => Promise.resolve({})),
  delete: jest.fn(() => Promise.resolve({ success: true })),
};

const mockMusicPlayer = {
  tracks: [
    { id: 'one', filename: 'Sermon.mp3', rawUrl: '/media/one.mp3' },
    { id: 'two', filename: 'Standup.mp3', rawUrl: '/media/two.mp3' },
  ],
  loading: false, ready: true, error: null, setupError: null, libraryError: null,
  activeTrack: { mediaId: 'two', title: 'Standup' },
  isPlaying: true,
  position: 45,
  duration: 180,
  playMedia: jest.fn(),
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
      mode: 'dark',
      colors: {
        background: '#000', surface: '#0a0a0a', surfaceElevated: '#111', surfaceHighlight: '#1a1a1a',
        border: '#222', textPrimary: '#fff', textSecondary: '#ccc', textTertiary: '#999',
        textMuted: '#666', accent: '#3DDC97', accentInfo: '#3DDC97',
        accentSuccess: '#4ADE80', accentError: '#F87171',
      },
    },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (cb) => cb() }));
jest.mock('../../../../context/MusicPlayerContext', () => ({ useMusicPlayer: () => mockMusicPlayer }));
jest.mock('../../../../context/ServerContext', () => ({
  useServer: () => ({
    api: mockApi,
    isConnected: true,
    getBaseUrl: () => 'http://pond.local/api',
    getMediaBaseUrl: () => 'http://pond.local/api',
  }),
  getApiAuthToken: () => 'jwt',
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
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(() => Promise.resolve({ canceled: true })),
  UIImagePickerPreferredAssetRepresentationMode: { Current: 'current' },
}));
jest.mock('../../../../utils/haptics', () => ({
  tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn(),
}));

/** A finished transcript of track 'two'. */
const DONE_ROW = {
  key: 'local_1', id: 'job-1', name: 'Standup', status: 'completed',
  mediaId: 'two', mediaTags: [], createdAt: 1000,
};

/**
 * Put rows where the vault will actually find them.
 *
 * Both halves are needed: the in-memory value is what the first render reads,
 * and the DISK copy is what survives the store's hydration a tick later —
 * seeding only memory gets overwritten by an empty read, which is exactly the
 * sequence a cold launch performs.
 */
const seedRecordings = (rows) => {
  resetRecordings(rows);
  mockStore.set('turtle:transcriptions:v1', JSON.stringify(rows));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  resetQueue();
  seedRecordings([]);
});

describe('the Media tab is a door to transcription', () => {
  test('the music library offers Transcribe alongside Playlists', async () => {
    const view = await render(<MusicVault />);
    expect(view.getByTestId('music-transcribe-row')).toBeTruthy();
    expect(view.getByText('Transcribe')).toBeTruthy();
  });

  test('its subtitle reports the jobs, not a generic blurb', async () => {
    seedRecordings([{ ...DONE_ROW, status: 'transcribing' }]);
    const view = await render(<MusicVault />);
    expect(view.getByText('Standup · in progress')).toBeTruthy();
  });

  test('opening it shows the picker AND the WhisperX options', async () => {
    const view = await render(<MusicVault />);
    await fireEvent.press(view.getByTestId('music-transcribe-row'));

    await waitFor(() => expect(view.getByText('Transcribe audio')).toBeTruthy());
    // The source picker…
    expect(view.getByLabelText('Choose an audio to transcribe')).toBeTruthy();
    // …and the options the pond said it supports.
    expect(view.getByLabelText('Transcription options')).toBeTruthy();
  });

  test('a track\'s ⋯ menu can send that track', async () => {
    const view = await render(<MusicVault />);
    await fireEvent.press(view.getByLabelText('Options for Sermon'));
    expect(view.getByLabelText('Transcribe…')).toBeTruthy();
  });

  test('and says so rather than offering a second job while one runs', async () => {
    seedRecordings([{ ...DONE_ROW, mediaId: 'one', status: 'transcribing' }]);
    const view = await render(<MusicVault />);
    await fireEvent.press(view.getByLabelText('Options for Sermon'));
    expect(view.getByLabelText('Transcribing…')).toBeTruthy();
  });

  test('a track that already has one offers to do it again', async () => {
    seedRecordings([{ ...DONE_ROW, mediaId: 'one' }]);
    const view = await render(<MusicVault />);
    await fireEvent.press(view.getByLabelText('Options for Sermon'));
    expect(view.getByLabelText('Transcribe again…')).toBeTruthy();
  });
});

describe('transcribed tracks gather in their own playlist', () => {
  test('the playlist appears as soon as this phone has transcribed something', async () => {
    seedRecordings([DONE_ROW]);
    const view = await render(<MusicVault />);
    await fireEvent.press(view.getByLabelText('Playlists, 1'));
    await waitFor(() => expect(view.getByLabelText('Transcribed, 1 track')).toBeTruthy());
  });

  test('and it holds the tracks that were transcribed', async () => {
    seedRecordings([DONE_ROW]);
    const view = await render(<MusicVault />);
    await fireEvent.press(view.getByLabelText('Playlists, 1'));
    await fireEvent.press(view.getByLabelText('Transcribed, 1 track'));
    await waitFor(() => expect(view.getAllByText('Standup').length).toBeGreaterThan(0));
  });

  test('no transcripts, no playlist — it is not an empty fixture', async () => {
    const view = await render(<MusicVault />);
    expect(view.getByText('None yet — add a track from its ⋯ menu')).toBeTruthy();
  });
});

describe('playing a transcribed track follows along', () => {
  test('the transport shows the line being spoken', async () => {
    seedRecordings([DONE_ROW]);
    const view = await render(<MusicVault />);
    // position is 45s: the second turn (40–70).
    await waitFor(() => expect(view.getByText('The deploy went out an hour ago.')).toBeTruthy());
  });

  test('and tapping it opens the transcript', async () => {
    seedRecordings([DONE_ROW]);
    const view = await render(<MusicVault />);
    await waitFor(() => expect(view.getByTestId('follow-along-caption')).toBeTruthy());
    await fireEvent.press(view.getByTestId('follow-along-caption'));
    await waitFor(() => expect(view.getByTestId('follow-along')).toBeTruthy());
  });

  test('a track with NO transcript gets no caption at all', async () => {
    const view = await render(<MusicVault />);
    expect(view.queryByTestId('follow-along-caption')).toBeNull();
  });

  test('the transcript is fetched once per job, not once per tick', async () => {
    seedRecordings([DONE_ROW]);
    const view = await render(<MusicVault />);
    await waitFor(() => expect(view.getByTestId('follow-along-caption')).toBeTruthy());
    const results = mockApi.get.mock.calls.filter(([p]) => p.endsWith('/result'));
    expect(results).toHaveLength(1);
  });
});
