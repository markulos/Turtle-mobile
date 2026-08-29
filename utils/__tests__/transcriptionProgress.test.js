/**
 * transcriptionProgress — the client half of the async transcription contract.
 *
 * The things worth pinning: a bar that never moves backwards when the server
 * takes over from the uploader, a failed job that does not render as finished,
 * and a backoff that is actually bounded (an unbounded one is invisible until
 * a job sits queued overnight and the phone has made ten thousand requests).
 */
const {
  STAGES,
  UPLOADING,
  isTerminal,
  stageLabel,
  stageFraction,
  nextPollDelay,
  isRetryableStatus,
  describeJob,
} = require('../transcriptionProgress');

describe('isTerminal', () => {
  it('knows the three statuses that end polling', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
  });

  it('leaves every working stage alive', () => {
    for (const stage of STAGES) expect(isTerminal(stage)).toBe(false);
    expect(isTerminal(undefined)).toBe(false);
  });
});

describe('stageLabel', () => {
  it('says what is happening in words, not in the server’s vocabulary', () => {
    expect(stageLabel('diarizing')).toBe('Separating speakers');
    expect(stageLabel('queued')).toBe('Waiting to start');
    expect(stageLabel(UPLOADING)).toBe('Uploading');
  });

  it('shows an unknown stage rather than going blank', () => {
    // A blank row reads as a hang; a stage this build predates is still a stage.
    expect(stageLabel('polishing')).toBe('Polishing');
    expect(stageLabel('')).toBe('Waiting');
  });
});

describe('stageFraction', () => {
  it('gives a queued job nothing, because nothing has happened', () => {
    expect(stageFraction('queued')).toBe(0);
  });

  it('advances one step per stage', () => {
    expect(stageFraction('transcribing')).toBeCloseTo(1 / 5, 5);
    expect(stageFraction('formatting')).toBeCloseTo(4 / 5, 5);
    expect(stageFraction('completed')).toBe(1);
  });

  it('never fills the bar for a job that did not finish', () => {
    expect(stageFraction('failed')).toBe(0);
    expect(stageFraction('failed', { failedAt: 'diarizing' })).toBeCloseTo(3 / 5, 5);
    expect(stageFraction('cancelled', { failedAt: 'formatting' })).toBeCloseTo(4 / 5, 5);
    expect(stageFraction('cancelled')).toBe(0);
  });

  it('is zero for a stage it does not recognise', () => {
    expect(stageFraction('polishing')).toBe(0);
  });
});

describe('nextPollDelay', () => {
  it('starts responsive and grows', () => {
    expect(nextPollDelay(0)).toBe(2000);
    expect(nextPollDelay(1)).toBe(3200);
    expect(nextPollDelay(2)).toBe(5120);
  });

  it('is bounded — the whole point of a backoff', () => {
    expect(nextPollDelay(50)).toBe(30_000);
    expect(nextPollDelay(1000)).toBe(30_000);
  });

  it('is far lazier in the background, where nothing is being looked at', () => {
    expect(nextPollDelay(50, { background: true })).toBe(120_000);
  });

  it('treats junk as the first poll rather than as Infinity', () => {
    expect(nextPollDelay(undefined)).toBe(2000);
    expect(nextPollDelay(-5)).toBe(2000);
  });
});

describe('isRetryableStatus', () => {
  it('retries only what the server says is transient', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });

  it('gives up on anything a repeat would not fix', () => {
    // 404 in particular: a job that is gone stays gone, and polling it forever
    // is how a deleted job becomes a permanent spinner.
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(500)).toBe(false);
  });
});

describe('describeJob', () => {
  it('scales upload bytes into the first stage so the bar cannot jump back', () => {
    // At 100% uploaded the bar sits exactly where 'queued'→'transcribing'
    // begins, so handing over to the server is seamless rather than a jolt.
    const full = describeJob({ status: UPLOADING, uploadPercent: 100 });
    expect(full.fraction).toBeCloseTo(1 / 5, 5);
    expect(describeJob({ status: UPLOADING, uploadPercent: 50 }).fraction)
      .toBeCloseTo(0.5 / 5, 5);
    // …and the server's first report is never lower than where upload finished.
    expect(stageFraction('transcribing')).toBeGreaterThanOrEqual(full.fraction);
  });

  it('clamps a nonsense upload percentage', () => {
    expect(describeJob({ status: UPLOADING, uploadPercent: 900 }).fraction).toBeCloseTo(1 / 5, 5);
    expect(describeJob({ status: UPLOADING }).fraction).toBe(0);
  });

  it('carries a tone so the card does not re-derive severity', () => {
    expect(describeJob({ status: 'failed' }).tone).toBe('bad');
    expect(describeJob({ status: 'completed' }).tone).toBe('done');
    expect(describeJob({ status: 'cancelled' }).tone).toBe('muted');
    expect(describeJob({ status: 'aligning' }).tone).toBe('busy');
  });

  it('offers cancel while running and delete once finished', () => {
    expect(describeJob({ status: 'aligning', id: 'tr_1' })).toMatchObject({
      canCancel: true, canDelete: false,
    });
    expect(describeJob({ status: 'completed', id: 'tr_1' })).toMatchObject({
      canCancel: false, canDelete: true,
    });
  });

  it('lets an upload be cancelled before it has any id at all', () => {
    // The acceptance test that matters: cancelling mid-upload must leave no
    // running state, and it has no job id to cancel by.
    expect(describeJob({ status: UPLOADING }).canCancel).toBe(true);
    // …but a stage with no id yet cannot be cancelled server-side.
    expect(describeJob({ status: 'queued' }).canCancel).toBe(false);
  });
});
