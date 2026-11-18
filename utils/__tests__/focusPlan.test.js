/**
 * The focus plan on the phone. These assert the SAME answers the web app's
 * focusPlan.test.ts asserts — the two write to one `users.settings` blob, so
 * a rule that differs is a timer that changes length depending on which
 * device you started it from.
 */
import {
  DEFAULT_PLAN, FOCUS_CYCLE_SETTING, FOCUS_PLAN_SETTING, MAX_MINUTES, MIN_MINUTES,
  cyclePatch, isLongBreak, localDay, normalisePlan, planPatch, plannedMinutes,
  readCycle, readPlan, untilLongBreak,
} from '../focusPlan';

const me = (settings) => ({ user: { settings } });
const plan = (over = {}) => ({ ...DEFAULT_PLAN, ...over });

describe('normalisePlan', () => {
  it('keeps a sane plan', () => {
    const p = { focus: 50, break: 10, longBreak: 20, longBreakEvery: 3 };
    expect(normalisePlan(p)).toEqual(p);
  });

  it('falls back to the classic pomodoro', () => {
    expect(normalisePlan({})).toEqual(DEFAULT_PLAN);
    expect(normalisePlan(null)).toEqual(DEFAULT_PLAN);
  });

  it('clamps to what the server will run', () => {
    expect(normalisePlan({ focus: 0 }).focus).toBe(MIN_MINUTES);
    expect(normalisePlan({ focus: 9999 }).focus).toBe(MAX_MINUTES);
  });

  /** Number(null) is 0 and finite — absent has to be checked first. */
  it('treats a cleared key as absent, not as zero', () => {
    expect(normalisePlan({ focus: null }).focus).toBe(DEFAULT_PLAN.focus);
    expect(normalisePlan({ focus: '' }).focus).toBe(DEFAULT_PLAN.focus);
  });

  it('takes 0 as "no long breaks" and lifts 1 to 2', () => {
    expect(normalisePlan({ longBreakEvery: 0 }).longBreakEvery).toBe(0);
    expect(normalisePlan({ longBreakEvery: 1 }).longBreakEvery).toBe(2);
    expect(normalisePlan({ longBreakEvery: 99 }).longBreakEvery).toBe(12);
  });
});

describe('reading and writing', () => {
  it('reads what the other device stored', () => {
    const stored = { focus: 45, break: 8, longBreak: 25, longBreakEvery: 3 };
    expect(readPlan(me({ [FOCUS_PLAN_SETTING]: stored }))).toEqual(stored);
  });

  it('defaults for an account that has never set one', () => {
    expect(readPlan(me({}))).toEqual(DEFAULT_PLAN);
    expect(readPlan(null)).toEqual(DEFAULT_PLAN);
  });

  it('sanitises on the way out', () => {
    expect(planPatch({ ...DEFAULT_PLAN, focus: -1 })[FOCUS_PLAN_SETTING].focus).toBe(MIN_MINUTES);
  });
});

describe('the long break', () => {
  it('lands on every fourth finished session', () => {
    expect([0, 1, 2, 3, 4, 5, 8].map((n) => isLongBreak(n, DEFAULT_PLAN)))
      .toEqual([false, false, false, false, true, false, true]);
  });

  it('never comes before any work is done', () => {
    expect(isLongBreak(0, DEFAULT_PLAN)).toBe(false);
  });

  it('is off when the cycle is 0', () => {
    expect(isLongBreak(4, plan({ longBreakEvery: 0 }))).toBe(false);
  });

  it('decides the minutes', () => {
    const p = plan({ break: 5, longBreak: 15 });
    expect([1, 2, 3, 4].map((n) => plannedMinutes('break', p, n))).toEqual([5, 5, 5, 15]);
    expect(plannedMinutes('focus', p, 4)).toBe(p.focus);
  });

  it('counts down', () => {
    expect([0, 1, 2, 3, 4].map((n) => untilLongBreak(n, DEFAULT_PLAN))).toEqual([0, 3, 2, 1, 0]);
    expect(untilLongBreak(2, plan({ longBreakEvery: 0 }))).toBe(-1);
  });
});

describe('the cycle count', () => {
  it('is the stored count for today', () => {
    expect(readCycle(me({ [FOCUS_CYCLE_SETTING]: { done: 3, day: '2026-11-18' } }), '2026-11-18')).toBe(3);
  });

  it('starts again on a new day', () => {
    expect(readCycle(me({ [FOCUS_CYCLE_SETTING]: { done: 7, day: '2026-11-17' } }), '2026-11-18')).toBe(0);
  });

  it('is zero for junk', () => {
    expect(readCycle(me({ [FOCUS_CYCLE_SETTING]: 'nope' }), '2026-11-18')).toBe(0);
    expect(readCycle(me({}), '2026-11-18')).toBe(0);
  });

  it('writes a whole count', () => {
    expect(cyclePatch(3.7, '2026-11-18')[FOCUS_CYCLE_SETTING]).toEqual({ done: 3, day: '2026-11-18' });
  });

  it('names the local day', () => {
    expect(localDay(new Date(2026, 10, 18, 23, 30))).toBe('2026-11-18');
  });
});
