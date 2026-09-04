import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import TranscriptionPanel from '../TranscriptionPanel';
import { __resetForTests, getRecordings } from '../../services/transcriptionStore';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(() => Promise.resolve({ canceled: true })),
  UIImagePickerPreferredAssetRepresentationMode: { Current: 'current' },
}));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  downloadAsync: jest.fn(() => Promise.resolve({ uri: 'file:///cache/copy.mp3' })),
  deleteAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../utils/haptics', () => ({ tapHaptic: jest.fn(), notifyHaptic: jest.fn() }));

const mockSubmit = jest.fn();
jest.mock('../../services/transcriptions', () => {
  const actual = jest.requireActual('../../services/transcriptions');
  return { ...actual, submitTranscription: (...args) => mockSubmit(...args) };
});

const mockTheme = {
  colors: {
    surface: '#0a0a0a',
    surfaceElevated: '#111',
    surfaceHighlight: '#1a1a1a',
    border: '#222',
    accent: '#3DDC97',
    accentInfo: '#3DDC97',
    accentError: '#F87171',
    accentSuccess: '#34D399',
    textPrimary: '#fff',
    textSecondary: '#aaa',
    textTertiary: '#888',
    textMuted: '#666',
  },
};
jest.mock('../../context/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));

let mockApi;
jest.mock('../../context/ServerContext', () => ({
  useServer: () => ({
    api: mockApi,
    isConnected: true,
    getBaseUrl: () => 'http://pond.local/api',
    getMediaBaseUrl: () => 'http://pond.local',
  }),
  getApiAuthToken: () => 'jwt-token',
}));

const CAPABILITIES = {
  models: ['tiny', 'small', 'large-v3'],
  defaults: {
    diarize: true, model: 'small', language: null,
    minSpeakers: 2, maxSpeakers: 5, primaryName: 'Primary',
  },
  ranges: { minSpeakers: [1, 10], maxSpeakers: [1, 10] },
  maxUploadBytes: 1024 * 1024 * 1024,
  runtime: { pythonAvailable: true, workerAvailable: true, diarizationAvailable: true },
};

const AUDIO_ROW = {
  id: 12, filename: 'standup.m4a', originalName: 'standup.m4a',
  rawUrl: '/media/12/raw', duration: 95, size: 4096, mimeType: 'audio/mp4',
};

// One pond, answering by route. Individual tests override a route by reassigning.
const makeApi = (over = {}) => ({
  get: jest.fn((path) => {
    if (path.startsWith('/transcriptions/capabilities')) return Promise.resolve(CAPABILITIES);
    if (path.startsWith('/media/gallery')) return Promise.resolve({ items: [AUDIO_ROW] });
    if (/^\/transcriptions\/[^/]+$/.test(path)) return Promise.resolve({ job: { id: 'tr_1', status: 'transcribing' } });
    return Promise.reject(new Error('API Error 404: unexpected ' + path));
  }),
  delete: jest.fn(() => Promise.resolve({ success: true })),
  ...over,
});

const httpError = (status) => Object.assign(new Error(`API Error ${status}: nope`), { status });

beforeEach(() => {
  jest.clearAllMocks();
  __resetForTests();
  mockApi = makeApi();
  mockSubmit.mockResolvedValue({ id: 'tr_1', status: 'queued' });
});

describe('TranscriptionPanel', () => {
  test('offers the pond’s own models, not the ones this build was written against', async () => {
    const view = await render(<TranscriptionPanel />);
    await waitFor(() => view.getByText('Send an audio'));

    await fireEvent.press(view.getByLabelText('Transcription options'));
    // Exactly what the pond published, largest last — and no 'medium', which
    // this pond does not offer even though the fallback list has one.
    expect(view.getByLabelText('tiny, fastest, roughest')).toBeTruthy();
    expect(view.getByLabelText('large-v3, slowest, best')).toBeTruthy();
    expect(view.queryByLabelText(/^medium/)).toBeNull();
  });

  test('sending a pond audio adds it to the recordings and keeps its job id', async () => {
    const view = await render(<TranscriptionPanel />);
    await waitFor(() => view.getByText('Send an audio'));

    await fireEvent.press(view.getByLabelText('Choose an audio to transcribe'));
    await waitFor(() => view.getByLabelText('Transcribe standup'));
    await fireEvent.press(view.getByLabelText('Transcribe standup'));

    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    const sent = mockSubmit.mock.calls[0][0];
    // The file is streamed from the cached copy, with the token attached for
    // that one request and nothing else carried along.
    expect(sent.fileUri).toBe('file:///cache/copy.mp3');
    expect(sent.token).toBe('jwt-token');
    // Nothing was moved off the pond's defaults, so nothing is sent.
    expect(sent.options).toEqual({});

    await waitFor(() => expect(getRecordings()[0]).toMatchObject({ id: 'tr_1', name: 'standup' }));
    expect(view.getByText('Recordings')).toBeTruthy();
  });

  test('a rejected upload leaves a row that says why, in words', async () => {
    mockSubmit.mockRejectedValue(new Error('HTTP 415: {"error":"Unsupported media type"}'));
    const view = await render(<TranscriptionPanel />);
    await waitFor(() => view.getByText('Send an audio'));

    await fireEvent.press(view.getByLabelText('Choose an audio to transcribe'));
    await waitFor(() => view.getByLabelText('Transcribe standup'));
    await fireEvent.press(view.getByLabelText('Transcribe standup'));

    await waitFor(() => expect(getRecordings()[0].status).toBe('failed'));
    // The uploader's "HTTP 415: {json}" is a diagnostic; the row gets a sentence.
    expect(getRecordings()[0].error).toMatch(/cannot read that file/i);
  });

  test('removes itself from a pond that has never heard of transcription', async () => {
    mockApi = makeApi({ get: jest.fn(() => Promise.reject(httpError(404))) });
    const view = await render(<TranscriptionPanel />);
    // Not an error, not an empty card — a pond without the route is not a pond
    // with a broken feature.
    await waitFor(() => expect(view.queryByText('Transcribe audio')).toBeNull());
  });

  test('says which half is missing when the worker is only partly there', async () => {
    mockApi = makeApi({
      get: jest.fn((path) => (path.startsWith('/transcriptions/capabilities')
        ? Promise.resolve({
          ...CAPABILITIES,
          runtime: { pythonAvailable: true, workerAvailable: true, diarizationAvailable: false },
        })
        : Promise.resolve({ items: [] }))),
    });
    const view = await render(<TranscriptionPanel />);
    await waitFor(() => view.getByText(/cannot separate speakers/));
    // …and the switch that fixes it is still reachable, which is the point.
    await fireEvent.press(view.getByLabelText('Transcription options'));
    expect(view.getByText('Separate speakers')).toBeTruthy();
  });

  test('a job the pond has forgotten stops polling instead of spinning forever', async () => {
    mockApi = makeApi({
      get: jest.fn((path) => {
        if (path.startsWith('/transcriptions/capabilities')) return Promise.resolve(CAPABILITIES);
        if (path.startsWith('/media/gallery')) return Promise.resolve({ items: [AUDIO_ROW] });
        return Promise.reject(httpError(404));
      }),
    });
    const view = await render(<TranscriptionPanel />);
    await waitFor(() => view.getByText('Send an audio'));

    await fireEvent.press(view.getByLabelText('Choose an audio to transcribe'));
    await waitFor(() => view.getByLabelText('Transcribe standup'));
    await fireEvent.press(view.getByLabelText('Transcribe standup'));

    // The first poll is deliberately ~2 s after acceptance (polling a job the
    // instant it was queued only ever answers 'queued'), so this waits past it
    // in real time rather than faking the clock the scheduler runs on.
    await waitFor(() => expect(getRecordings()[0].status).toBe('failed'), { timeout: 6000, interval: 150 });
    expect(getRecordings()[0].error).toMatch(/no longer has this job/);
  });
});
