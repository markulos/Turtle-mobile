/**
 * The socket payload → screen reading rules. Both are now read by TWO callers
 * (the app-level socket in DownloadsContext and the Turtle tab's hook), so a
 * drift in either one shows up as two surfaces disagreeing about when the same
 * focus block ends — which is exactly the class of bug the app-level listener
 * was added to kill.
 */
import { endedIdentity, translateServerState } from '../pomodoroState';

describe('endedIdentity', () => {
  test('names an ended card by its SERVER stamps', () => {
    // Server-clock, not our skew-corrected copies: the server replays this
    // exact payload on every connect, so the identity has to match across runs.
    expect(endedIdentity({ status: 'completed', mode: 'focus', startedAt: 100, endedAt: 200 }))
      .toBe('focus:100:200');
    expect(endedIdentity({ status: 'stopped', mode: 'break', startedAt: 5, endedAt: 9 }))
      .toBe('break:5:9');
  });

  test('a RUNNING or idle timer has no ended identity to dismiss', () => {
    expect(endedIdentity({ status: 'active', mode: 'focus', startedAt: 1, endsAt: 2 })).toBeNull();
    expect(endedIdentity({ status: 'idle' })).toBeNull();
    expect(endedIdentity(null)).toBeNull();
    expect(endedIdentity(undefined)).toBeNull();
  });

  test('a NEW completion never matches the dismissed one', () => {
    const dismissed = endedIdentity({ status: 'completed', mode: 'focus', startedAt: 100, endedAt: 200 });
    const fresh = endedIdentity({ status: 'completed', mode: 'focus', startedAt: 300, endedAt: 400 });
    expect(fresh).not.toBe(dismissed);
  });
});

describe('translateServerState', () => {
  const NOW = 1_700_000_000_000;
  let spy;
  beforeEach(() => { spy = jest.spyOn(Date, 'now').mockReturnValue(NOW); });
  afterEach(() => { spy.mockRestore(); });

  test('idle and empty payloads read as "no timer"', () => {
    expect(translateServerState(null)).toBeNull();
    expect(translateServerState(undefined)).toBeNull();
    expect(translateServerState({ status: 'idle' })).toBeNull();
  });

  test('shifts a RUNNING block onto the client clock by the measured skew', () => {
    // The phone's clock is 10 s ahead of the pond's, so both stamps move +10 s
    // and the countdown lands on the same wall-clock second on both devices.
    const out = translateServerState({
      status: 'active', mode: 'focus', totalDuration: 1500,
      serverNow: NOW - 10_000, startedAt: NOW - 70_000, endsAt: NOW + 20_000,
    });
    expect(out).toEqual({
      status: 'active', mode: 'focus', totalDuration: 1500,
      startedAt: NOW - 60_000, endsAt: NOW + 30_000,
    });
  });

  test('shifts an ENDED block the same way, keeping endedAt', () => {
    const out = translateServerState({
      status: 'completed', mode: 'break', totalDuration: 300,
      serverNow: NOW + 5_000, startedAt: NOW, endedAt: NOW + 1_000,
    });
    // Phone 5 s BEHIND the pond → stamps move back 5 s.
    expect(out).toEqual({
      status: 'completed', mode: 'break', totalDuration: 300,
      startedAt: NOW - 5_000, endedAt: NOW - 4_000,
    });
    expect(out.endsAt).toBeUndefined();
  });

  test('a payload with no serverNow is trusted as-is rather than shifted by NaN', () => {
    // An older pond (or a hand-rolled emit) omits serverNow; skew 0 keeps the
    // stamps usable instead of turning every timestamp into NaN.
    const out = translateServerState({
      status: 'active', mode: 'focus', totalDuration: 1500,
      startedAt: 1000, endsAt: 2000,
    });
    expect(out.startedAt).toBe(1000);
    expect(out.endsAt).toBe(2000);
  });

  test('a stopped block keeps its own status, not a generic one', () => {
    const out = translateServerState({
      status: 'stopped', mode: 'focus', totalDuration: 1500,
      serverNow: NOW, startedAt: NOW, endedAt: NOW,
    });
    expect(out.status).toBe('stopped');
  });
});
