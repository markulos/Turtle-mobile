/**
 * The stop question. What matters is that it never asks about a session that
 * is not there, that it names the two different costs, and that an unknown
 * start time degrades to silence rather than "running NaNm".
 */
import { runningFor, stopPrompt } from '../claudeStopPrompt';

const NOW = 1700000000000;

describe('runningFor', () => {
  it('says nothing under a minute', () => {
    expect(runningFor(NOW - 59000, NOW)).toBeNull();
  });

  it('counts whole minutes, then hours', () => {
    expect(runningFor(NOW - 7 * 60000, NOW)).toBe('7m');
    expect(runningFor(NOW - 59 * 60000, NOW)).toBe('59m');
    expect(runningFor(NOW - 60 * 60000, NOW)).toBe('1h');
    expect(runningFor(NOW - 80 * 60000, NOW)).toBe('1h 20m');
  });

  it('survives a missing start time', () => {
    expect(runningFor(null, NOW)).toBeNull();
    expect(runningFor(undefined, NOW)).toBeNull();
    expect(runningFor(NaN, NOW)).toBeNull();
  });
});

describe('stopPrompt', () => {
  const live = { active: true, busy: false, startedAt: NOW - 20 * 60000, now: NOW };

  it('does not ask when no session is live', () => {
    expect(stopPrompt({ ...live, active: false })).toBeNull();
  });

  it('asks about an idle session, because it still holds its context', () => {
    const q = stopPrompt(live);
    expect(q.title).toBe('Stop this session?');
    expect(q.body).toContain('running 20m');
    expect(q.body).toContain('starts from nothing');
  });

  it('leads with the turn in flight when there is one', () => {
    const q = stopPrompt({ ...live, busy: true });
    expect(q.title).toContain('working');
    expect(q.body).toContain('part-way through');
    expect(q.body).toContain('20m into this session');
  });

  it('still asks when the session age is unknown', () => {
    // A session attached to, rather than started here, can arrive without a
    // start time. The question must not degrade into "running m".
    for (const busy of [false, true]) {
      const q = stopPrompt({ ...live, busy, startedAt: null });
      expect(q).toBeTruthy();
      expect(q.body).not.toContain('running ');
      expect(q.body).not.toContain('undefined');
      expect(q.body).not.toContain('NaN');
    }
  });
});
