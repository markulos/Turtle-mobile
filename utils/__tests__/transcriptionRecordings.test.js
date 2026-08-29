/**
 * The recordings list. Two things here are worth pinning because getting them
 * wrong is invisible until it matters: an upload that was interrupted by the
 * app dying must not come back as a spinner, and a finished job must not jump
 * position in a list someone is about to tap.
 */
const {
  MAX_RECORDINGS,
  addRecording,
  normaliseList,
  normaliseRecording,
  patchRecording,
  pollableRecordings,
  removeRecording,
  reviveList,
  summariseRecordings,
} = require('../transcriptionRecordings');

const row = (over = {}) => ({
  key: 'k1', id: 'tr_1', name: 'Standup', status: 'transcribing', createdAt: 1, ...over,
});

describe('normaliseRecording', () => {
  it('drops anything without an identity', () => {
    expect(normaliseRecording(null)).toBeNull();
    expect(normaliseRecording({ name: 'no key' })).toBeNull();
  });

  it('falls back to the job id as the local key', () => {
    expect(normaliseRecording({ id: 'tr_9' }).key).toBe('tr_9');
  });

  it('coerces junk read back off disk instead of trusting it', () => {
    const r = normaliseRecording({ key: 'k', uploadPercent: 'lots', createdAt: 'yesterday', id: 7 });
    expect(r.uploadPercent).toBe(0);
    expect(r.createdAt).toBe(0);
    expect(r.id).toBe('7');
  });

  it('carries no token, path or transcript, whatever it was handed', () => {
    const r = normaliseRecording({ key: 'k', token: 'secret', fileUri: 'file:///x', transcript: 'text' });
    expect(r.token).toBeUndefined();
    expect(r.fileUri).toBeUndefined();
    expect(r.transcript).toBeUndefined();
  });
});

describe('reviveList', () => {
  it('condemns an upload that the app died in the middle of', () => {
    // It cannot resume — the upload lived in a process that is gone — so a
    // spinner would be a promise nothing will keep.
    const [restored] = reviveList([row({ status: 'uploading', uploadPercent: 40 })]);
    expect(restored.status).toBe('failed');
    expect(restored.error).toMatch(/Interrupted/);
  });

  it('leaves a job the server is still working on alone', () => {
    expect(reviveList([row()])[0].status).toBe('transcribing');
  });

  it('survives a half-written file', () => {
    expect(reviveList('not a list')).toEqual([]);
    expect(normaliseList([null, row(), row()])).toHaveLength(1);
  });
});

describe('addRecording', () => {
  it('puts the newest first', () => {
    const list = addRecording(addRecording([], row()), row({ key: 'k2', name: 'Interview' }));
    expect(list.map((r) => r.name)).toEqual(['Interview', 'Standup']);
  });

  it('is bounded, oldest dropped first', () => {
    let list = [];
    for (let i = 0; i < MAX_RECORDINGS + 5; i += 1) list = addRecording(list, row({ key: `k${i}` }));
    expect(list).toHaveLength(MAX_RECORDINGS);
    expect(list[0].key).toBe(`k${MAX_RECORDINGS + 4}`);
  });
});

describe('patchRecording', () => {
  it('does not move a row that changed', () => {
    // A row that jumps to the top as it finishes is how you delete the wrong one.
    const list = [row({ key: 'a' }), row({ key: 'b' }), row({ key: 'c' })];
    const next = patchRecording(list, 'b', { status: 'completed' });
    expect(next.map((r) => r.key)).toEqual(['a', 'b', 'c']);
    expect(next[1].status).toBe('completed');
  });

  it('keeps what the patch did not mention', () => {
    const list = patchRecording([row({ durationSeconds: 90 })], 'k1', { status: 'completed' });
    expect(list[0].durationSeconds).toBe(90);
  });

  it('returns the same array when nothing matched, so React can skip', () => {
    const list = [row()];
    expect(patchRecording(list, 'missing', { status: 'failed' })).toBe(list);
  });
});

describe('removeRecording', () => {
  it('removes by local key, not by job id', () => {
    expect(removeRecording([row({ key: 'a' }), row({ key: 'b' })], 'a').map((r) => r.key)).toEqual(['b']);
  });
});

describe('pollableRecordings', () => {
  it('polls only jobs the server has accepted and not finished', () => {
    const list = [
      row({ key: 'a', status: 'uploading', id: null }),  // no id to poll yet
      row({ key: 'b', status: 'queued' }),
      row({ key: 'c', status: 'completed' }),
      row({ key: 'd', status: 'failed' }),
      row({ key: 'e', status: 'cancelled' }),
    ];
    expect(pollableRecordings(list).map((r) => r.key)).toEqual(['b']);
  });
});

describe('summariseRecordings', () => {
  it('leads with whatever is still running, because that is why you came back', () => {
    expect(summariseRecordings([row({ status: 'completed' }), row({ key: 'b', status: 'aligning', name: 'Call' })]))
      .toEqual({ tone: 'busy', text: 'Call · in progress' });
    expect(summariseRecordings([row({ key: 'a', status: 'queued' }), row({ key: 'b', status: 'aligning' })]))
      .toEqual({ tone: 'busy', text: '2 recordings in progress' });
  });

  it('reports the outcome once nothing is moving', () => {
    expect(summariseRecordings([row({ status: 'completed' }), row({ key: 'b', status: 'failed' })]))
      .toEqual({ tone: 'bad', text: '1 transcribed · 1 failed' });
    expect(summariseRecordings([row({ status: 'failed' })]))
      .toEqual({ tone: 'bad', text: '1 failed' });
  });

  it('has nothing to say about an empty list', () => {
    expect(summariseRecordings([])).toBeNull();
  });
});
