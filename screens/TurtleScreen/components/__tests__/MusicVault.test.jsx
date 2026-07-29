import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import MusicVault from '../MusicVault';

const mockPlayMedia = jest.fn();
const mockTogglePlayback = jest.fn();
const mockPrevious = jest.fn();
const mockNext = jest.fn();
const mockSeekTo = jest.fn();
const mockRefreshLibrary = jest.fn();
const mockRetrySetup = jest.fn();
const mockMusicPlayer = {
  tracks: [
    { id: 'one', filename: 'First.mp3', rawUrl: '/media/one.mp3' },
    { id: 'two', filename: 'Second.mp3', rawUrl: '/media/two.mp3' },
    { id: 'three', filename: 'Third.mp3', rawUrl: '/media/three.mp3' },
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

describe('MusicVault', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
