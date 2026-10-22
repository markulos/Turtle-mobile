/**
 * The rules behind transcribing a video from Files.
 *
 * The ones worth pinning are about what a pond can be TOLD to do versus what
 * it can actually do: an older pond has neither the audio door nor the
 * media-submit door, and the difference matters — without the first the
 * transcript still works, without the second nothing does from here, because
 * the alternative is pulling a whole video down to the phone and pushing it
 * straight back up.
 */
import {
  defaultMode, features, isVideoItem, itemTitle, modeOffers, videoProblem,
} from '../videoTranscribe';

const pond = (f) => ({ features: f });

describe('what a pond admits to', () => {
  it('reads both flags as false when a pond sends no features at all', () => {
    expect(features(null)).toEqual({ mediaSubmit: false, audioExtract: false });
    expect(features({})).toEqual({ mediaSubmit: false, audioExtract: false });
    expect(features(pond({ mediaSubmit: true })))
      .toEqual({ mediaSubmit: true, audioExtract: false });
  });
});

describe('the two ways in', () => {
  it('always offers the plain transcript', () => {
    for (const caps of [null, pond({}), pond({ audioExtract: true })]) {
      expect(modeOffers(caps)[0]).toMatchObject({ mode: 'transcript', available: true, why: null });
    }
  });

  it('offers keeping the audio only where the pond has the door', () => {
    expect(modeOffers(pond({ audioExtract: true }))[1]).toMatchObject({ mode: 'audio', available: true });
    const without = modeOffers(pond({ audioExtract: false }))[1];
    expect(without.available).toBe(false);
    expect(without.why).toMatch(/can still transcribe the video/);
  });

  it('starts on the richer mode when it is there, and on the transcript when it is not', () => {
    expect(defaultMode(pond({ audioExtract: true }))).toBe('audio');
    expect(defaultMode(pond({}))).toBe('transcript');
    expect(defaultMode(null)).toBe('transcript');
  });
});

describe('what the action applies to', () => {
  it('recognises a video by the vault type or the MIME', () => {
    expect(isVideoItem({ type: 'video' })).toBe(true);
    expect(isVideoItem({ mimeType: 'video/quicktime' })).toBe(true);
    expect(isVideoItem({ type: 'audio', mimeType: 'audio/mp4' })).toBe(false);
    expect(isVideoItem({ type: 'image' })).toBe(false);
    expect(isVideoItem(null)).toBe(false);
  });

  it('names an item without its extension', () => {
    expect(itemTitle({ originalName: 'Standup 2026-10-22.mp4' })).toBe('Standup 2026-10-22');
    expect(itemTitle({ filename: 'media_9.mov' })).toBe('media_9');
    expect(itemTitle(null)).toBe('Video');
  });
});

describe('refusing before anything is sent', () => {
  const ready = pond({ mediaSubmit: true, audioExtract: true });

  it('lets a video through on a pond that can read its own vault', () => {
    expect(videoProblem({ type: 'video' }, ready)).toBeNull();
  });

  it('refuses a pond with no media-submit route rather than uploading the whole video', () => {
    expect(videoProblem({ type: 'video' }, pond({ audioExtract: true })))
      .toMatch(/too old/);
  });

  it('refuses anything that is not a video', () => {
    expect(videoProblem({ type: 'image' }, ready)).toMatch(/not a video/);
  });
});
