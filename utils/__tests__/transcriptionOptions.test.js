/**
 * The rule this file exists for is `submitParameters`: a field is sent only
 * when the user moved it away from what the POND said its default was. Get that
 * wrong and the app quietly pins whichever model it was written against, which
 * looks like the server ignoring its own configuration.
 */
const {
  clampChoices,
  defaultChoices,
  fileProblem,
  formatBytes,
  formatDuration,
  optionsProblem,
  readCapabilities,
  runtimeState,
  submitParameters,
  summariseChoices,
} = require('../transcriptionOptions');

// A pond that does NOT agree with this build's fallbacks — the whole point.
const CAPS = readCapabilities({
  models: ['large-v3', 'tiny', 'medium'],
  defaults: {
    diarize: true, model: 'medium', language: null,
    minSpeakers: 2, maxSpeakers: 5, primaryName: 'Primary',
  },
  ranges: { minSpeakers: [1, 10], maxSpeakers: [1, 10] },
  maxUploadBytes: 1024,
  runtime: { pythonAvailable: true, workerAvailable: true, diarizationAvailable: true },
});

describe('readCapabilities', () => {
  it('orders the pond’s models by size rather than alphabetically', () => {
    expect(CAPS.models).toEqual(['tiny', 'medium', 'large-v3']);
  });

  it('keeps a model this build has never heard of, at the end', () => {
    const caps = readCapabilities({ models: ['small', 'enormous-v9'] });
    expect(caps.models).toEqual(['small', 'enormous-v9']);
  });

  it('fills in a pond that answered with nothing at all', () => {
    const caps = readCapabilities(undefined);
    expect(caps.defaults.model).toBe('small');
    expect(caps.ranges.minSpeakers).toEqual([1, 10]);
  });
});

describe('runtimeState', () => {
  it('separates "no worker" from "no diarization", because the fixes differ', () => {
    expect(runtimeState({ runtime: {} })).toBe('no-worker');
    expect(runtimeState({
      runtime: { pythonAvailable: true, workerAvailable: true, diarizationAvailable: false },
    })).toBe('no-diarization');
    expect(runtimeState(CAPS)).toBe('ready');
  });
});

describe('defaultChoices', () => {
  it('starts from the pond’s defaults, not this build’s', () => {
    expect(defaultChoices(CAPS).model).toBe('medium');
  });

  it('seeds the speaker label from the profile name when there is one', () => {
    expect(defaultChoices(CAPS, { primaryName: 'Mark' }).primaryName).toBe('Mark');
    expect(defaultChoices(CAPS).primaryName).toBe('Primary');
  });
});

describe('clampChoices', () => {
  it('pushes the other end rather than refusing to move', () => {
    // Dragging the minimum past the maximum takes the maximum with it, which is
    // what a range control is expected to do — and `minSpeakers > maxSpeakers`
    // is a hard 400 from the route.
    expect(clampChoices({ minSpeakers: 7, maxSpeakers: 5 }, CAPS, 'minSpeakers'))
      .toMatchObject({ minSpeakers: 7, maxSpeakers: 7 });
    expect(clampChoices({ minSpeakers: 4, maxSpeakers: 2 }, CAPS, 'maxSpeakers'))
      .toMatchObject({ minSpeakers: 2, maxSpeakers: 2 });
  });

  it('holds the range the pond published', () => {
    expect(clampChoices({ minSpeakers: 0, maxSpeakers: 99 }, CAPS))
      .toMatchObject({ minSpeakers: 1, maxSpeakers: 10 });
  });

  it('tidies the free-text fields the route is strict about', () => {
    expect(clampChoices({ language: '  EN ', primaryName: '  Mark   Boulos ' }, CAPS))
      .toMatchObject({ language: 'en', primaryName: 'Mark Boulos' });
  });
});

describe('optionsProblem', () => {
  it('passes a legal set', () => {
    expect(optionsProblem(defaultChoices(CAPS), CAPS)).toBeNull();
  });

  it('catches what the route would 400 on, before the upload', () => {
    expect(optionsProblem({ ...defaultChoices(CAPS), language: 'english' }, CAPS)).toMatch(/two or three letters/);
    expect(optionsProblem({ ...defaultChoices(CAPS), primaryName: '  ' }, CAPS)).toMatch(/name/i);
    expect(optionsProblem({ ...defaultChoices(CAPS), model: 'small' }, CAPS)).toMatch(/no longer offers/);
  });
});

describe('submitParameters', () => {
  it('sends nothing when nothing was changed', () => {
    // The pond's defaults are already the pond's defaults. Echoing them back is
    // how a stale client overrides a server that has since been reconfigured.
    expect(submitParameters(defaultChoices(CAPS), CAPS)).toEqual({});
  });

  it('sends exactly what was moved', () => {
    const choices = { ...defaultChoices(CAPS), model: 'large-v3', primaryName: 'Mark' };
    expect(submitParameters(choices, CAPS)).toEqual({ model: 'large-v3', primaryName: 'Mark' });
  });

  it('drops the speaker bounds when speakers are not being separated', () => {
    const choices = { ...defaultChoices(CAPS), diarize: false, minSpeakers: 1, maxSpeakers: 9 };
    expect(submitParameters(choices, CAPS)).toEqual({ diarize: false });
  });

  it('sends a language only once one has been chosen', () => {
    expect(submitParameters({ ...defaultChoices(CAPS), language: '' }, CAPS)).toEqual({});
    expect(submitParameters({ ...defaultChoices(CAPS), language: 'FR' }, CAPS)).toEqual({ language: 'fr' });
  });
});

describe('summariseChoices', () => {
  it('reads as a sentence, not as a config dump', () => {
    expect(summariseChoices(defaultChoices(CAPS), CAPS)).toBe('medium · 2–5 speakers · auto language');
    expect(summariseChoices({ ...defaultChoices(CAPS), diarize: false }, CAPS))
      .toBe('medium · one transcript, no speakers · auto language');
    expect(summariseChoices({ ...defaultChoices(CAPS), minSpeakers: 1, maxSpeakers: 1 }, CAPS))
      .toBe('medium · 1 speaker · auto language');
  });
});

describe('fileProblem', () => {
  it('refuses an oversized file against the pond’s own limit', () => {
    expect(fileProblem({ sizeBytes: 2048 }, CAPS)).toMatch(/larger than this pond accepts/);
    expect(fileProblem({ sizeBytes: 512 }, CAPS)).toBeNull();
    // An unknown size is not an objection — the route still gets to decide.
    expect(fileProblem({}, CAPS)).toBeNull();
  });
});

describe('formatting', () => {
  it('sizes without leaning on Intl', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB');
    expect(formatBytes(0)).toBe('');
  });

  it('clocks a duration the way the music vault does', () => {
    expect(formatDuration(64)).toBe('1:04');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(0)).toBe('');
  });
});
