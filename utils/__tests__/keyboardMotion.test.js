/**
 * keyboardMotion — the one way anything in the app moves with the keyboard.
 *
 * The numbers are the contract: a bar that rides the keyboard is where these
 * say it is on every frame, and "smooth" is the property that it gets there
 * without a jump at either end.
 */
import React from 'react';
import { render, act } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as Controller from 'react-native-keyboard-controller';

import {
  KEYBOARD_GAP,
  keyboardLift,
  useKeyboardFrame,
  useKeyboardLiftAnimated,
} from '../keyboardMotion';

const OPEN = Controller.__OPEN_HEIGHT;

beforeEach(() => { Controller.__resetKeyboard(); });

describe('keyboardLift — how far a bar has risen', () => {
  test('with the keyboard down, nothing has moved', () => {
    expect(keyboardLift(0, 0)).toBe(0);
    expect(keyboardLift(0, 0, 90, 8)).toBe(0);
    // A gap larger than the rest must not lift a bar that has no keyboard under it.
    expect(keyboardLift(0, 0, 0, 12)).toBe(0);
  });

  test('a bar on the bottom edge rides the keyboard exactly', () => {
    expect(keyboardLift(120, 120 / OPEN)).toBeCloseTo(120);
    expect(keyboardLift(OPEN, 1)).toBe(OPEN);
  });

  test('fully up, the bar sits `gap` above the keyboard', () => {
    // It already rested 90 up, so it only has to cover the difference.
    expect(keyboardLift(OPEN, 1, 90, 8)).toBe(OPEN + 8 - 90);
    expect(keyboardLift(OPEN, 1, 34, 12)).toBe(OPEN + 12 - 34);
  });

  test('it stays put until the keyboard reaches it', () => {
    // Resting 90 up with 8 of air: the keyboard has 82pt to travel first.
    expect(keyboardLift(20, 20 / OPEN, 90, 8)).toBe(0);
    expect(keyboardLift(82, 82 / OPEN, 90, 8)).toBe(0);
    expect(keyboardLift(83, 83 / OPEN, 90, 8)).toBe(1);
  });

  test('once reached, it holds exactly `gap` above the keyboard on every frame', () => {
    // The main chat's motion: one object carried by another, not two things
    // arriving at the same time.
    const rest = 90;
    const gap = 8;
    for (let h = rest; h <= OPEN; h += 6) {
      const barBottom = rest + keyboardLift(h, h / OPEN, rest, gap);
      expect(barBottom - h).toBe(gap);
    }
  });

  test('it is the main chat formula: max(keyboard − clearance, 0)', () => {
    // TurtleScreen lifts its column by max(kb − dockH, 0) and keeps a static
    // 8pt margin; a bar resting dockH + 8 up with gap 8 is the same thing.
    const dockH = 111;
    for (const h of [0, 60, 111, 112, 200, OPEN]) {
      expect(keyboardLift(h, h / OPEN, dockH + 8, 8)).toBe(Math.max(h - dockH, 0));
    }
  });

  test('a gap larger than the rest is eased in with the keyboard', () => {
    // Flush with the bottom (no home indicator) but wanting 12 of air.
    expect(keyboardLift(0, 0, 0, 12)).toBe(0);
    expect(keyboardLift(OPEN / 2, 0.5, 0, 12)).toBe(OPEN / 2 + 6);
    expect(keyboardLift(OPEN, 1, 0, 12)).toBe(OPEN + 12);
  });

  test('the keyboard never overlaps the bar on the way', () => {
    const rest = 90;
    const gap = 8;
    for (let h = 0; h <= OPEN; h += 8) {
      const p = h / OPEN;
      const barBottom = rest + keyboardLift(h, p, rest, gap); // above screen bottom
      expect(barBottom).toBeGreaterThanOrEqual(h - 1e-6);
    }
  });

  test('every frame moves it the same way the keyboard moved — no reversal, no jump', () => {
    let last = 0;
    for (let h = 0; h <= OPEN; h += 4) {
      const lift = keyboardLift(h, h / OPEN, 90, 8);
      expect(lift).toBeGreaterThanOrEqual(last);
      // The keyboard moved 4pt; the bar moves a share of that, never more.
      expect(lift - last).toBeLessThanOrEqual(4 + 1e-6);
      last = lift;
    }
  });

  test('a keyboard shorter than the rest does not push the bar down', () => {
    // A hardware keyboard's shortcut strip: ~55pt, under a bar resting 90 up.
    expect(keyboardLift(55, 1, 90, 0)).toBe(0);
  });

  test('a taller keyboard (emoji) carries the bar up with it', () => {
    const text = keyboardLift(OPEN, 1, 90, 8);
    const emoji = keyboardLift(OPEN + 44, 1, 90, 8);
    expect(emoji - text).toBe(44);
  });

  test('the default gap is the app-wide one', () => {
    expect(KEYBOARD_GAP).toBe(8);
  });
});

describe('useKeyboardFrame — the live keyboard', () => {
  function Probe({ onFrame }) {
    const frame = useKeyboardFrame();
    onFrame(frame);
    return <Text>probe</Text>;
  }

  test('starts down, and follows every frame the native side reports', async () => {
    let frame;
    await render(<Probe onFrame={(f) => { frame = f; }} />);
    expect(frame.height.value).toBe(0);
    expect(frame.progress.value).toBe(0);

    await act(async () => { Controller.__moveKeyboard(100); });
    expect(frame.height.value).toBe(100);
    expect(frame.progress.value).toBeCloseTo(100 / OPEN);

    await act(async () => { Controller.__moveKeyboard(OPEN); });
    expect(frame.height.value).toBe(OPEN);
    expect(frame.progress.value).toBe(1);

    await act(async () => { Controller.__moveKeyboard(0); });
    expect(frame.height.value).toBe(0);
  });

  test('mounted with the keyboard already up, it starts up', async () => {
    Controller.__moveKeyboard(OPEN);
    let frame;
    await render(<Probe onFrame={(f) => { frame = f; }} />);
    // The provider speaks negative-up; this hook speaks positive-up.
    expect(frame.height.value).toBe(OPEN);
    expect(frame.progress.value).toBe(1);
  });
});

describe('useKeyboardLiftAnimated — the same lift for RN Animated views', () => {
  function Probe({ onNode, ...options }) {
    onNode(useKeyboardLiftAnimated(options));
    return <Text>probe</Text>;
  }
  const valueOf = (node) => node.__getValue();

  test('matches keyboardLift across the whole trip', async () => {
    let node;
    await render(<Probe rest={34} gap={12} onNode={(n) => { node = n; }} />);
    for (const h of [0, 10, 22, 40, 168, OPEN]) {
      Controller.__moveKeyboard(h);
      expect(valueOf(node)).toBeCloseTo(-keyboardLift(h, h / OPEN, 34, 12));
    }
  });

  test('matches keyboardLift when the gap is larger than the rest', async () => {
    let node;
    await render(<Probe rest={0} gap={12} onNode={(n) => { node = n; }} />);
    for (const h of [0, 40, 168, OPEN]) {
      Controller.__moveKeyboard(h);
      expect(valueOf(node)).toBeCloseTo(-keyboardLift(h, h / OPEN, 0, 12));
    }
  });

  test('with no rest it is the keyboard height itself', async () => {
    let node;
    await render(<Probe onNode={(n) => { node = n; }} />);
    Controller.__moveKeyboard(OPEN);
    expect(valueOf(node)).toBe(-OPEN);
  });

  test('never pushes the bar below where it rests', async () => {
    let node;
    await render(<Probe rest={90} onNode={(n) => { node = n; }} />);
    Controller.__moveKeyboard(55, 1);
    expect(valueOf(node)).toBe(0);
  });

  test('switched off, it stays put whatever the keyboard does', async () => {
    let node;
    await render(<Probe enabled={false} onNode={(n) => { node = n; }} />);
    Controller.__moveKeyboard(OPEN);
    expect(valueOf(node)).toBe(0);
  });
});
