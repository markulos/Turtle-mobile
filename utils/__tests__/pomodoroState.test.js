/**
 * The socket payload → screen reading rules. Both are now read by TWO callers
 * (the app-level socket in DownloadsContext and the Turtle tab's hook), so a
 * drift in either one shows up as two surfaces disagreeing about when the same
 * focus block ends — which is exactly the class of bug the app-level listener
 * was added to kill.
 */
import {
  ENDED_FRESH_MS,
  endedIdentity,
  liveActivityAction,
  shouldCelebrate,
  translateServerState,
  visibleTimer,
} from '../pomodoroState';

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

// The rules below used to be private to the Turtle tab's hook, which meant the
// lock-screen activity and the confetti only worked once that lazy tab had been
// opened. They now drive an app-level component, so they are pinned here.
const NOW = 1_800_000_000_000;
const ended = (over = { status: 'completed', mode: 'focus', endedAt: NOW - 1000 }) => ({ totalDuration: 1500, startedAt: NOW - 1500, ...over });

describe('visibleTimer — the card the user should see', () => {
  test('is the translated payload for a running block', () => {
    const view = visibleTimer({ status: 'active', mode: 'focus', totalDuration: 1500, serverNow: NOW, startedAt: NOW - 100, endsAt: NOW + 1400 }, null);
    expect(view.status).toBe('active');
  });

  test('is NOTHING for the ended card the user already dismissed, however often the server replays it', () => {
    const payload = { status: 'completed', mode: 'focus', totalDuration: 1500, serverNow: NOW, startedAt: NOW - 1500, endedAt: NOW };
    const dismissed = endedIdentity(payload);
    expect(visibleTimer(payload, dismissed)).toBeNull();
    expect(visibleTimer(payload, null)?.status).toBe('completed');
  });

  test('a NEW completion shows even though an older one was dismissed', () => {
    const old = { status: 'completed', mode: 'focus', totalDuration: 1500, serverNow: NOW, startedAt: NOW - 9000, endedAt: NOW - 7500 };
    const fresh = { ...old, startedAt: NOW - 1500, endedAt: NOW };
    expect(visibleTimer(fresh, endedIdentity(old))?.status).toBe('completed');
  });
});

describe('liveActivityAction — what the island should be doing', () => {
  test('a running block is a live countdown, whatever came before', () => {
    const view = { status: 'active', mode: 'focus', endsAt: NOW + 1000 };
    expect(liveActivityAction(null, view, NOW)).toBe('running');
    expect(liveActivityAction('completed', view, NOW)).toBe('running');
  });

  test('a completion the driver watched run becomes the done card', () => {
    expect(liveActivityAction('active', ended(), NOW)).toBe('completed');
  });

  test('a fresh completion the app just reconnected to also becomes the done card', () => {
    expect(liveActivityAction(null, ended({ status: 'completed', mode: 'break', endedAt: NOW - 30_000 }), NOW)).toBe('completed');
  });

  test('a stale completion replayed on connect is cleared, not shown', () => {
    expect(liveActivityAction(null, ended({ status: 'completed', mode: 'focus', endedAt: NOW - ENDED_FRESH_MS - 1 }), NOW)).toBe('clear');
  });

  test('a manual stop, idle, and no timer all clear', () => {
    expect(liveActivityAction('active', ended({ status: 'stopped', mode: 'focus', endedAt: NOW }), NOW)).toBe('clear');
    expect(liveActivityAction('active', null, NOW)).toBe('clear');
    expect(liveActivityAction(null, undefined, NOW)).toBe('clear');
  });
});

describe('shouldCelebrate — confetti only for a real, witnessed focus completion', () => {
  test('fires for a focus block the driver saw run to zero', () => {
    expect(shouldCelebrate('active', ended(), NOW)).toBe(true);
  });

  test('never for a break, even a witnessed one', () => {
    expect(shouldCelebrate('active', ended({ status: 'completed', mode: 'break', endedAt: NOW }), NOW)).toBe(false);
  });

  test('never for a completion the driver did not see running — a cold replay on app open', () => {
    expect(shouldCelebrate(null, ended(), NOW)).toBe(false);
    expect(shouldCelebrate('idle', ended(), NOW)).toBe(false);
  });

  test('never for a stale completion, even if the last thing it saw was active (a warm reconnect)', () => {
    expect(shouldCelebrate('active', ended({ status: 'completed', mode: 'focus', endedAt: NOW - ENDED_FRESH_MS - 1 }), NOW)).toBe(false);
  });

  test('never for a stop', () => {
    expect(shouldCelebrate('active', ended({ status: 'stopped', mode: 'focus', endedAt: NOW }), NOW)).toBe(false);
  });
});
