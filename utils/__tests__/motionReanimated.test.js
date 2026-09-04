// Parity between the two engine bindings.
//
// This is the test that keeps the split honest. The curves have to be declared
// twice — RN's Easing.bezier and Reanimated's are different objects and are not
// interchangeable — so the ONLY thing stopping them drifting is that both are
// built from the same `BEZIER` data and both are checked here.
//
// Kept in its own file so that a Reanimated/jest problem takes down this
// parity check alone and not the pure token tests next door.
import { BEZIER, DURATION, EASE, SHEET } from '../motion';
import { R_EASE, R_TIMING } from '../motionReanimated';

describe('R_EASE', () => {
  it('offers exactly the same curve names as the RN Animated side', () => {
    // A curve that exists on one engine and not the other is an undefined
    // easing at some call site nobody has opened yet.
    expect(Object.keys(R_EASE).sort()).toEqual(Object.keys(EASE).sort());
  });

  it('binds every named bezier', () => {
    Object.keys(BEZIER).forEach((name) => {
      expect(R_EASE[name]).toBeDefined();
    });
  });
});

describe('R_TIMING', () => {
  it('reads its durations from the shared scale', () => {
    expect(R_TIMING.settle.duration).toBe(DURATION.settle);
    expect(R_TIMING.base.duration).toBe(DURATION.base);
    expect(R_TIMING.fast.duration).toBe(DURATION.fast);
    expect(R_TIMING.sheetIn.duration).toBe(SHEET.in);
    expect(R_TIMING.sheetOut.duration).toBe(SHEET.out);
  });

  it('uses the Reanimated easings, never the RN Animated ones', () => {
    // Handing an RN Animated easing to withTiming inside a gesture worklet is
    // the failure this file exists to prevent.
    Object.values(R_TIMING).forEach((cfg) => {
      expect(Object.values(R_EASE)).toContain(cfg.easing);
      expect(Object.values(EASE)).not.toContain(cfg.easing);
    });
  });

  it('freezes the configs, since worklets capture them by reference', () => {
    Object.values(R_TIMING).forEach((cfg) => {
      expect(Object.isFrozen(cfg)).toBe(true);
    });
  });
});
