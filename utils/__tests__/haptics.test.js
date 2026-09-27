/**
 * The gesture gate: no touch feedback while a finger is moving.
 *
 * STYLE-RULES §3. A tap earns a buzz; a scroll, swipe or drag earns silence,
 * because the buzz that fires the instant a finger lands is the one most likely
 * to belong to a scroll that has not declared itself yet.
 *
 * expo-haptics is native and absent here, so every call falls through to
 * `Vibration.vibrate` — which makes Vibration the perfect witness: it is called
 * exactly when something would have buzzed on a device.
 */
import { Vibration } from 'react-native';

jest.mock('react-native', () => ({ Vibration: { vibrate: jest.fn() } }));

import {
  tapHaptic, impactHaptic, selectionHaptic, notifyHaptic,
  markGesture, gestureInFlight, __resetGestureGate,
} from '../haptics';

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 8, 26, 12, 0, 0).getTime());
  __resetGestureGate();
});
afterEach(() => { jest.useRealTimers(); });

/** Move the clock without running anything — the gate is a stamp, not a timer. */
const wait = (ms) => jest.setSystemTime(Date.now() + ms);

describe('a still finger', () => {
  test('a tap buzzes', () => {
    tapHaptic();
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
  });

  test('so does an impact', () => {
    impactHaptic('medium');
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
  });
});

describe('a moving finger', () => {
  test('a tap under a live gesture is silent', () => {
    markGesture();
    tapHaptic();
    expect(Vibration.vibrate).not.toHaveBeenCalled();
  });

  test('and so is an impact — a heavier thump mid-swipe is a worse mis-tap, not a better one', () => {
    markGesture();
    impactHaptic('heavy');
    expect(Vibration.vibrate).not.toHaveBeenCalled();
  });

  // The case the rule is really about: a finger lands on a row and drags. The
  // press-in fires before the scroll has taken the responder.
  test('every frame of the movement keeps it shut', () => {
    for (let f = 0; f < 20; f += 1) {
      markGesture();      // a scroll frame
      wait(16);
      tapHaptic();        // whatever the finger is over
    }
    expect(Vibration.vibrate).not.toHaveBeenCalled();
  });
});

describe('the window decays on its own', () => {
  // A begin/end pair would leak: miss one end — a scroll interrupted by a
  // navigation, a pan cancelled by the OS — and the app is silently haptic-dead.
  test('a deliberate tap after the movement stops buzzes again', () => {
    markGesture();
    expect(gestureInFlight()).toBe(true);
    wait(200);
    expect(gestureInFlight()).toBe(false);
    tapHaptic();
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
  });

  // Tapping to ARREST a moving list is itself a gesture — it is doing something
  // to the scroll — so it stays silent.
  test('a tap straight on top of the movement does not', () => {
    markGesture();
    wait(100);
    tapHaptic();
    expect(Vibration.vibrate).not.toHaveBeenCalled();
  });
});

describe('the two exemptions', () => {
  // Feedback for the MOVEMENT, not for a touch: the agenda's day ticks as the
  // timeline scrolls past the mark. The very condition that silences a tap is
  // the condition this exists to fire under.
  test('the scrub tick still ticks during a scroll', () => {
    markGesture();
    selectionHaptic();
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
  });

  // An outcome, not a touch — a focus block finishing while you happen to be
  // scrolling still has to announce itself.
  test('an outcome buzz still lands during a scroll', () => {
    markGesture();
    notifyHaptic('success');
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
  });
});
