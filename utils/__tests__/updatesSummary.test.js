import { shortId, formatWhen, describeBuild, describeUpdateError } from '../updatesSummary';

describe('shortId', () => {
  it('takes the first eight characters, dashes removed', () => {
    expect(shortId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe('a1b2c3d4');
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
