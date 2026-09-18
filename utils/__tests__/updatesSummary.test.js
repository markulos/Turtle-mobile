import { shortId, formatWhen, describeBuild, describeUpdateError, messageFor, summarizeLatest, updateTags, updateLog } from '../updatesSummary';

describe('shortId', () => {
  it('takes the first eight characters, dashes removed', () => {
    expect(shortId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe('a1b2c3d4');
    // iOS hands back an upper-cased updateId; the pond serves it lower. One
    // update, one spelling.
    expect(shortId('A1B2C3D4-E5F6-7890-ABCD-EF1234567890')).toBe('a1b2c3d4');
    expect(shortId('')).toBe('');
    expect(shortId(null)).toBe('');
  });
});

describe('formatWhen', () => {
  it('formats a date and survives garbage', () => {
    expect(formatWhen(new Date('2026-09-05T14:02:00Z'))).toMatch(/Sep/);
    expect(formatWhen('not a date')).toBe('');
    expect(formatWhen(null)).toBe('');
  });
});

describe('describeBuild', () => {
  it('names a development client and says updates do not apply', () => {
    const d = describeBuild({ isEnabled: false, isDev: true });
    expect(d.mode).toBe('dev-client');
    expect(d.detail).toMatch(/Metro/);
    expect(d.detail).toMatch(/do not apply/);
  });

  it('treats isEnabled=false as a dev client even when __DEV__ is off', () => {
    // A dev client built without __DEV__ still cannot apply updates.
    expect(describeBuild({ isEnabled: false, isDev: false }).mode).toBe('dev-client');
  });

  it('calls a factory launch "as installed"', () => {
    const d = describeBuild({ isEnabled: true, isEmbeddedLaunch: true, updateId: 'x', createdAt: new Date('2026-09-05T00:00:00Z') });
    expect(d.mode).toBe('embedded');
    expect(d.title).toMatch(/as installed/);
    expect(d.detail).toMatch(/Factory/);
  });

  it('names the applied update when running over-the-air code', () => {
    const d = describeBuild({ isEnabled: true, isEmbeddedLaunch: false, updateId: 'a1b2c3d4-ffff', createdAt: new Date('2026-09-05T00:00:00Z') });
    expect(d.mode).toBe('ota');
    expect(d.title).toBe('Running update a1b2c3d4');
    expect(d.detail).toMatch(/over the air/);
  });

  it('falls back to embedded when there is no update id at all', () => {
    expect(describeBuild({ isEnabled: true, isEmbeddedLaunch: false, updateId: null }).mode).toBe('embedded');
  });
});

describe('describeUpdateError', () => {
  it('leads with the network cause but keeps the real message', () => {
    const s = describeUpdateError(new Error('Network request failed'));
    expect(s).toMatch(/reach the update server/);
    expect(s).toMatch(/Network request failed/);
  });

  it('explains a disabled-updates error plainly', () => {
    expect(describeUpdateError(new Error('Updates.checkForUpdateAsync() is not supported when expo-updates is not enabled'))).toBe('Updates are disabled in this build.');
  });

  it('passes anything else through verbatim', () => {
    expect(describeUpdateError(new Error('Manifest signature invalid'))).toBe('Manifest signature invalid');
    expect(describeUpdateError('plain string')).toBe('plain string');
    expect(describeUpdateError(undefined)).toBe('Unknown error');
  });
});

// ── The profile card's line ──────────────────────────────────────────────────
// The pond's record of what it has published. Only `id` and
// `provenance.message` matter here — the shape GET /mobile-updates/status
// returns.
const UPDATES = [
  { id: '7d0ef475-8979-4836-8421-5d6a4736c6fe', provenance: { message: 'Sheet footers clear the home indicator' } },
  { id: 'da6f6a56-c0cf-44d1-bd93-4d96fd15b4e1', provenance: { message: 'Task detail card on the app sheet shell' } },
  { id: '1a464e4d-0000-0000-0000-000000000000', provenance: {} },
];

describe('messageFor', () => {
  it('finds the publish message whatever the case of the id', () => {
    // iOS reports Updates.updateId upper-cased; the store writes it lower.
    expect(messageFor(UPDATES, '7D0EF475-8979-4836-8421-5D6A4736C6FE'))
      .toBe('Sheet footers clear the home indicator');
  });

  it('is empty for an unknown id, a note-less update, or no list at all', () => {
    expect(messageFor(UPDATES, 'ffffffff-0000-0000-0000-000000000000')).toBe('');
    expect(messageFor(UPDATES, '1a464e4d-0000-0000-0000-000000000000')).toBe('');
    expect(messageFor(null, '7d0ef475-8979-4836-8421-5d6a4736c6fe')).toBe('');
    expect(messageFor(UPDATES, null)).toBe('');
  });
});

describe('summarizeLatest', () => {
  it('leads with what a WAITING update changes — that is the reason to tap', () => {
    const s = summarizeLatest({
      mode: 'ota', phase: 'available',
      availableId: '7d0ef475-8979-4836-8421-5d6a4736c6fe',
      runningId: 'da6f6a56-c0cf-44d1-bd93-4d96fd15b4e1',
      updates: UPDATES,
    });
    expect(s.state).toBe('available');
    expect(s.line).toBe('Update ready · Sheet footers clear the home indicator');
  });

  it('says what the RUNNING update changed when there is nothing newer', () => {
    const s = summarizeLatest({
      mode: 'ota', phase: 'current',
      runningId: 'da6f6a56-c0cf-44d1-bd93-4d96fd15b4e1',
      updates: UPDATES,
    });
    expect(s.state).toBe('current');
    expect(s.line).toBe('Up to date · Task detail card on the app sheet shell');
  });

  it('keeps a multi-line publish message to its first line', () => {
    const s = summarizeLatest({
      mode: 'ota', phase: 'current', runningId: 'x',
      updates: [{ id: 'x', provenance: { message: 'Footer clearance\n\nAlso: a stray log' } }],
    });
    expect(s.line).toBe('Up to date · Footer clearance');
  });

  it('still says something true with no note to show', () => {
    const s = summarizeLatest({
      mode: 'ota', phase: 'current',
      runningId: '1a464e4d-0000-0000-0000-000000000000',
      runningCreatedAt: '2026-09-16T14:02:00Z',
      updates: UPDATES,
    });
    expect(s.line).toMatch(/^Up to date · update 1a464e4d/);
    expect(s.line).toMatch(/Sep/);
  });

  it('names the factory build rather than quoting an id nobody published', () => {
    expect(summarizeLatest({ mode: 'embedded', phase: 'current', updates: [] }).line)
      .toBe('Up to date · running the build as installed');
  });

  it('says why there is nothing to check on a development client', () => {
    const s = summarizeLatest({ mode: 'dev-client', phase: 'idle' });
    expect(s.state).toBe('dev');
    expect(s.line).toMatch(/Development build/);
  });

  it('reports checking and failure without swallowing either', () => {
    expect(summarizeLatest({ mode: 'ota', phase: 'checking' }).state).toBe('checking');
    const err = summarizeLatest({ mode: 'ota', phase: 'error' });
    expect(err.state).toBe('error');
    expect(err.line).toMatch(/tap to retry/);
  });

  it('falls back to the id and date when a waiting update carries no note', () => {
    const s = summarizeLatest({
      mode: 'ota', phase: 'available',
      availableId: 'abcdef12-0000-0000-0000-000000000000',
      availableCreatedAt: '2026-09-16T14:02:00Z',
      updates: UPDATES,
    });
    expect(s.line).toMatch(/^Update ready · abcdef12 · published /);
  });
});

describe('updateTags', () => {
  const heads = { runningId: 'aaaa1111-0000-0000-0000-000000000000', previewId: 'bbbb2222-0000-0000-0000-000000000000', productionId: 'cccc3333-0000-0000-0000-000000000000' };

  it('names every place an update sits, not just the first', () => {
    // You are usually RUNNING the preview head — both labels are true.
    expect(updateTags('bbbb2222-0000-0000-0000-000000000000', { ...heads, runningId: 'bbbb2222-0000-0000-0000-000000000000' }))
      .toEqual(['running', 'preview']);
  });

  it('matches whatever the case, because iOS upper-cases updateId', () => {
    expect(updateTags('AAAA1111-0000-0000-0000-000000000000', heads)).toEqual(['running']);
  });

  it('says nothing about an update that is merely in the store', () => {
    expect(updateTags('dddd4444-0000-0000-0000-000000000000', heads)).toEqual([]);
    expect(updateTags(null, heads)).toEqual([]);
    expect(updateTags('aaaa1111-0000-0000-0000-000000000000')).toEqual([]);
  });
});

describe('updateLog', () => {
  it('turns the pond\'s list into rows that say what each update changed', () => {
    const rows = updateLog(
      [{ id: 'aaaa1111-2222-3333-4444-555555555555', createdAt: '2026-09-17T09:00:00Z', provenance: { message: 'Light mode gets depth', gitCommit: '05c606e' } }],
      { runningId: 'AAAA1111-2222-3333-4444-555555555555' },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].short).toBe('aaaa1111');
    expect(rows[0].note).toBe('Light mode gets depth');
    expect(rows[0].commit).toBe('05c606e');
    expect(rows[0].tags).toEqual(['running']);
    expect(rows[0].when).toMatch(/Sep/);
  });

  it('never leaves a row blank when nobody wrote a message', () => {
    expect(updateLog([{ id: 'x', provenance: {} }])[0].note).toBe('No description given.');
    expect(updateLog([{ id: 'x', provenance: { message: '   ' } }])[0].note).toBe('No description given.');
  });

  it('survives a pond that answered with nothing', () => {
    expect(updateLog(null)).toEqual([]);
    expect(updateLog(undefined)).toEqual([]);
    expect(updateLog([])).toEqual([]);
  });
});
