import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';

import TranscriptReader, { __clearResultCacheForTests } from '../TranscriptReader';
import { __resetForTests, getRecordings } from '../../../../services/transcriptionStore';
import { readCapabilities } from '../../../../utils/transcriptionOptions';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../../../utils/haptics', () => ({
  tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn(),
}));
jest.mock('../../../../context/ThemeContext', () => ({
  useTheme: () => ({
    mode: 'dark',
    theme: { mode: 'dark', colors: { accent: '#3DDC97', accentInfo: '#3DDC97', primary: '#3DDC97' } },
  }),
}));

// The player's own progress hook — what the reader syncs to.
const mockProgress = { position: 0, duration: 95, buffered: 0 };
jest.mock('@rntp/player', () => ({ useProgress: () => mockProgress }));

const mockPlayer = {
  activeTrack: { mediaId: '12' },
  isPlaying: true,
  ready: true,
  seekTo: jest.fn(() => Promise.resolve()),
  playMedia: jest.fn(() => Promise.resolve()),
  togglePlayback: jest.fn(),
};
jest.mock('../../../../context/MusicPlayerContext', () => ({ useMusicPlayer: () => mockPlayer }));

let mockApi;
jest.mock('../../../../context/ServerContext', () => ({ useServer: () => ({ api: mockApi }) }));

const CAPS = readCapabilities({
  models: ['tiny', 'small', 'large-v3'],
  defaults: { diarize: true, model: 'small', language: null, minSpeakers: 2, maxSpeakers: 5, primaryName: 'Primary' },
  ranges: { minSpeakers: [1, 10], maxSpeakers: [1, 10] },
  runtime: { pythonAvailable: true, workerAvailable: true, diarizationAvailable: true },
  features: { mediaSubmit: true, list: true, words: true },
});

const TRACK = { id: 12, originalName: 'standup.m4a', filename: 'standup.m4a', duration: 95 };

const RESULT = {
  jobId: 'tr_1', status: 'completed', language: 'en', detectedSpeakers: 2, mediaId: '12',
  turns: [
    { speaker: 'Anna', start: 0.5, end: 4, text: 'First line', words: [{ word: 'First', start: 0.5, end: 0.9 }, { word: 'line', start: 1.0, end: 1.4 }] },
    { speaker: 'Mark', start: 5, end: 9, text: 'Second line', words: [{ word: 'Second', start: 5, end: 5.4 }, { word: 'line', start: 5.5, end: 5.9 }] },
  ],
};

const makeApi = () => ({
  get: jest.fn((path) => {
    if (/\/result$/.test(path)) return Promise.resolve(RESULT);
    if (/^\/transcriptions\/[^/]+$/.test(path)) return Promise.resolve({ job: { id: 'tr_1', status: 'transcribing' } });
    return Promise.reject(new Error('API Error 404: unexpected ' + path));
  }),
  post: jest.fn(() => Promise.resolve({ success: true, id: 'tr_1', status: 'queued', mediaId: '12' })),
  delete: jest.fn(() => Promise.resolve({ success: true })),
});

const flat = (element) => StyleSheet.flatten(element.props.style) || {};
const open = (props = {}) => render(<TranscriptReader track={TRACK} capabilities={CAPS} onClose={jest.fn()} {...props} />);

beforeEach(() => {
  jest.clearAllMocks();
  __resetForTests();
  __clearResultCacheForTests();
  mockApi = makeApi();
  mockProgress.position = 0;
  mockPlayer.activeTrack = { mediaId: '12' };
  mockPlayer.ready = true;
  mockPlayer.isPlaying = true;
});

describe('TranscriptReader — none', () => {
  test('offers Transcribe with the options it will send, and a tap posts the media id', async () => {
    const onSubmitted = jest.fn();
    const view = await open({ onSubmitted });
    expect(view.getByText('No transcript yet')).toBeTruthy();
    // The pond's own defaults, as one line — nothing this build made up.
    expect(view.getByText('small · 2–5 speakers · auto language')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('Transcribe standup'));

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledTimes(1));
    // A JSON POST by media id; nothing moved off the defaults, so only the id goes.
    expect(mockApi.post).toHaveBeenCalledWith('/transcriptions', { mediaId: '12' });
    await waitFor(() => expect(getRecordings()[0]).toMatchObject({ id: 'tr_1', mediaId: '12', name: 'standup', status: 'queued' }));
    // …and the reader has moved to the running state on its own.
    expect(view.getByText('Waiting to start')).toBeTruthy();
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  test('sends a one-voice request to a pond that cannot separate speakers', async () => {
    const caps = readCapabilities({
      models: ['small'],
      defaults: { diarize: true, model: 'small', minSpeakers: 2, maxSpeakers: 5, primaryName: 'Primary' },
      runtime: { pythonAvailable: true, workerAvailable: true, diarizationAvailable: false },
      features: { mediaSubmit: true },
    });
    const view = await open({ capabilities: caps });
    expect(view.getByText('small · one transcript, no speakers · auto language')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Transcribe standup'));
    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/transcriptions', { mediaId: '12', diarize: 'false' }));
  });

  test('a refusal becomes a failed row that says why, with Retry', async () => {
    mockApi.post.mockRejectedValue(new Error('API Error 409: {"error":"no server copy"}'));
    const view = await open();
    await fireEvent.press(view.getByLabelText('Transcribe standup'));
    await waitFor(() => view.getByText('Transcription failed'));
    expect(view.getByText(/no copy on the pond/)).toBeTruthy();
    expect(view.getByLabelText('Retry transcription')).toBeTruthy();
  });

  test('the key is off on a pond without a worker', async () => {
    const caps = readCapabilities({ runtime: { pythonAvailable: false }, features: { mediaSubmit: true } });
    const view = await open({ capabilities: caps });
    expect(view.getByText(/no transcription worker/)).toBeTruthy();
    expect(view.getByLabelText('Transcribe standup').props.accessibilityState).toEqual({ disabled: true });
  });
});

describe('TranscriptReader — running', () => {
  test('shows the stage, and Cancel marks the row cancelled and tells the pond', async () => {
    __resetForTests([{ key: 'k', id: 'tr_1', mediaId: '12', name: 'standup', status: 'diarizing', createdAt: 1 }]);
    const view = await open();
    expect(view.getByText('Separating speakers')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('Stop transcribing'));
    expect(getRecordings()[0].status).toBe('cancelled');
    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/transcriptions/tr_1'));
    expect(view.getByText('Cancelled')).toBeTruthy();
  });
});

describe('TranscriptReader — completed', () => {
  const seedCompleted = () => __resetForTests([
    { key: 'k', id: 'tr_1', mediaId: '12', name: 'standup', status: 'completed', createdAt: 1 },
  ]);

  test('reads the transcript back with speakers, times and the header line', async () => {
    seedCompleted();
    const view = await open();
    await waitFor(() => view.getByText('Second'));
    expect(mockApi.get).toHaveBeenCalledWith('/transcriptions/tr_1/result');
    expect(view.getByText('Anna')).toBeTruthy();
    expect(view.getByText('Mark')).toBeTruthy();
    expect(view.getByText('2 voices · EN · 1:35')).toBeTruthy();
  });

  test('lights the turn and the word under the needle, with the lead', async () => {
    seedCompleted();
    mockProgress.position = 5.4; // + 0.12 lead → the second word of the second turn
    const view = await open();
    await waitFor(() => view.getByText('Second'));

    const secondTurn = within(view.getByLabelText('Mark, 0:05: Second line'));
    const firstTurn = within(view.getByLabelText('Anna, 0:00: First line'));
    // The live turn is full white; the other sits at 70 %.
    expect(flat(secondTurn.getByText('Second line')).color).toBe('#FFFFFF');
    expect(flat(firstTurn.getByText('First line')).color).toBe('rgba(255,255,255,0.7)');
    // The live word is underlined; its neighbour in the same turn is not, and
    // nothing in the idle turn is.
    expect(flat(secondTurn.getByText('line')).textDecorationLine).toBe('underline');
    expect(flat(secondTurn.getByText('Second')).textDecorationLine).toBeUndefined();
    expect(flat(firstTurn.getByText('line')).textDecorationLine).toBeUndefined();
  });

  test('a tap on a word or a line seeks there', async () => {
    seedCompleted();
    const view = await open();
    await waitFor(() => view.getByText('Second'));

    await fireEvent.press(view.getByText('Second'));
    await waitFor(() => expect(mockPlayer.seekTo).toHaveBeenCalledWith(5));
    await fireEvent.press(view.getByLabelText('Anna, 0:00: First line'));
    await waitFor(() => expect(mockPlayer.seekTo).toHaveBeenCalledWith(0.5));
    expect(mockPlayer.playMedia).not.toHaveBeenCalled();
  });

  test('for a track that is not the one playing, nothing is lit and a tap plays it first', async () => {
    seedCompleted();
    mockPlayer.activeTrack = { mediaId: 'other' };
    mockProgress.position = 6;
    const view = await open();
    await waitFor(() => view.getByText('Second'));
    expect(view.getByText(/tap a line to play/)).toBeTruthy();
    const secondTurn = within(view.getByLabelText('Mark, 0:05: Second line'));
    expect(flat(secondTurn.getByText('Second line')).color).toBe('rgba(255,255,255,0.7)');
    expect(flat(secondTurn.getByText('line')).textDecorationLine).toBeUndefined();

    await fireEvent.press(view.getByLabelText('Mark, 0:05: Second line'));
    await waitFor(() => expect(mockPlayer.seekTo).toHaveBeenCalledWith(5));
    expect(mockPlayer.playMedia).toHaveBeenCalledWith('12');
    expect(mockPlayer.playMedia.mock.invocationCallOrder[0]).toBeLessThan(mockPlayer.seekTo.mock.invocationCallOrder[0]);
  });

  test('a drag pauses following and shows Now; Now resumes it', async () => {
    seedCompleted();
    mockProgress.position = 6;
    const view = await open();
    await waitFor(() => view.getByText('Second'));
    expect(view.queryByLabelText('Jump to what is playing')).toBeNull();

    await fireEvent(view.getByTestId('transcript-list'), 'scrollBeginDrag');
    expect(view.getByLabelText('Jump to what is playing')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('Jump to what is playing'));
    expect(view.queryByLabelText('Jump to what is playing')).toBeNull();
  });

  test('a transcript the pond has aged out says so and offers to transcribe again', async () => {
    seedCompleted();
    mockApi.get.mockImplementation((path) => Promise.reject(Object.assign(new Error(`API Error 404: ${path}`), { status: 404 })));
    const view = await open();
    await waitFor(() => view.getByText('The pond no longer keeps this transcript.'));
    expect(view.getByLabelText('Transcribe again')).toBeTruthy();
  });

  test('the transcript is fetched once and served from the cache after that', async () => {
    seedCompleted();
    const view = await open();
    await waitFor(() => view.getByText('Second'));
    // Re-pointed at another track, the old lines go with the old title…
    await view.rerender(<TranscriptReader track={{ id: 99, originalName: 'other.m4a' }} capabilities={CAPS} onClose={jest.fn()} />);
    expect(view.getByText('No transcript yet')).toBeTruthy();
    expect(view.queryByText('Second')).toBeNull();
    // …and back again is a cache hit, as is closing and reopening the reader.
    await view.rerender(<TranscriptReader track={TRACK} capabilities={CAPS} onClose={jest.fn()} />);
    await waitFor(() => view.getByText('Second'));
    await view.unmount();
    const again = await open();
    expect(again.getByText('Second')).toBeTruthy();
    expect(mockApi.get.mock.calls.filter(([p]) => /\/result$/.test(p))).toHaveLength(1);
  });

  test('the header play key toggles the playing track', async () => {
    seedCompleted();
    const view = await open();
    await fireEvent.press(view.getByLabelText('Pause'));
    expect(mockPlayer.togglePlayback).toHaveBeenCalledTimes(1);
  });
});
