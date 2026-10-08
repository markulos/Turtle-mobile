/**
 * Voice recordings: audio in the vault that is NOT in the music library.
 *
 * The rule has one job and one failure mode. The job: a row tagged
 * `Voice recordings` goes in the recordings half and nowhere else. The failure
 * mode is the tag not being recognised — a recording that reads as music
 * reappears in the middle of the library and plays between two songs, which is
 * the exact thing this was built to stop. So the tag is read tolerantly: the
 * gallery hands `tags` over as a JSON string, an older row can carry anything,
 * and a human (or the web vault's tag editor) can have typed the name with a
 * different case.
 */
import {
  VOICE_RECORDINGS_TAG,
  audioTags,
  isVoiceRecording,
  partitionVoiceRecordings,
  recordingCountLabel,
  tagsWithVoiceRecording,
  tagsWithoutVoiceRecording,
} from '../voiceRecordings';

/** A gallery row: `tags` is a JSON STRING, which is the shape that matters. */
const row = (id, tags) => ({ id, tags: tags === undefined ? undefined : JSON.stringify(tags) });

describe('reading a row\'s tags', () => {
  it('takes the JSON string the gallery sends', () => {
    expect(audioTags(row('a', ['Jazz', 'Live']))).toEqual(['Jazz', 'Live']);
  });

  it('takes a real array too, for a caller that already parsed it', () => {
    expect(audioTags({ id: 'a', tags: ['Jazz'] })).toEqual(['Jazz']);
  });

  it('never throws on junk, and never invents a tag', () => {
    expect(audioTags({ id: 'a', tags: 'not json' })).toEqual([]);
    expect(audioTags({ id: 'a', tags: '{"not":"a list"}' })).toEqual([]);
    expect(audioTags({ id: 'a', tags: '[1, null, "ok"]' })).toEqual(['ok']);
    expect(audioTags({ id: 'a' })).toEqual([]);
    expect(audioTags(null)).toEqual([]);
  });
});

describe('what counts as a recording', () => {
  it('is the reserved tag, however it was typed', () => {
    expect(isVoiceRecording(row('a', [VOICE_RECORDINGS_TAG]))).toBe(true);
    expect(isVoiceRecording(row('b', ['voice recordings']))).toBe(true);
    expect(isVoiceRecording(row('c', ['  Voice Recordings  ']))).toBe(true);
  });

  it('is not some other tag that merely mentions it', () => {
    expect(isVoiceRecording(row('a', ['Voice'])).valueOf()).toBe(false);
    expect(isVoiceRecording(row('b', ['Old voice recordings 2019']))).toBe(false);
    expect(isVoiceRecording(row('c', []))).toBe(false);
  });
});

describe('splitting the library', () => {
  const library = [
    row('song-1', ['Jazz']),
    row('memo-1', [VOICE_RECORDINGS_TAG]),
    row('song-2', []),
    row('memo-2', ['Jazz', 'voice recordings']),
  ];

  it('files the recordings out, keeping each side in the library\'s order', () => {
    const { music, recordings } = partitionVoiceRecordings(library);
    expect(music.map((t) => t.id)).toEqual(['song-1', 'song-2']);
    expect(recordings.map((t) => t.id)).toEqual(['memo-1', 'memo-2']);
  });

  it('hands back the SAME array when nothing is filed', () => {
    const plain = [row('song-1', ['Jazz'])];
    // Identity, so a library with no recordings re-renders nothing.
    expect(partitionVoiceRecordings(plain).music).toBe(plain);
    expect(partitionVoiceRecordings(plain).recordings).toEqual([]);
  });

  it('survives being handed nothing at all', () => {
    expect(partitionVoiceRecordings(null)).toEqual({ music: [], recordings: [] });
  });
});

describe('moving a track in and out', () => {
  it('adds the tag without disturbing the others', () => {
    expect(tagsWithVoiceRecording(row('a', ['Jazz']))).toEqual(['Jazz', VOICE_RECORDINGS_TAG]);
  });

  it('does not add it twice', () => {
    expect(tagsWithVoiceRecording(row('a', [VOICE_RECORDINGS_TAG]))).toEqual([VOICE_RECORDINGS_TAG]);
  });

  it('takes off every spelling of it, and keeps the playlists', () => {
    const filed = row('a', ['Jazz', VOICE_RECORDINGS_TAG, 'voice recordings']);
    expect(tagsWithoutVoiceRecording(filed)).toEqual(['Jazz']);
  });
});

describe('what the section row says', () => {
  it('counts, and says so in words', () => {
    expect(recordingCountLabel(0)).toMatch(/Nothing filed/);
    expect(recordingCountLabel(1)).toBe('1 recording');
    expect(recordingCountLabel(4)).toBe('4 recordings');
  });
});
