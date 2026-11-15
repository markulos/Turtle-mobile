/**
 * ClaudeTurtleBuddy — the mark, alive: he jumps up from behind the ledge,
 * blinks, and thinks with one finger up.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { StyleSheet } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

// The native SVG module is not present on every machine that runs this suite.
jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  const make = (name) => {
    const C = ({ children, ...props }) => React.createElement(View, { testID: 'svg-' + name, ...props }, children);
    C.displayName = name;
    return C;
  };
  return { __esModule: true, default: make('Svg'), Path: make('Path'), G: make('G'), Circle: make('Circle') };
}, { virtual: true });

import ClaudeTurtleBuddy, { BLINK, CHIN_HAND, nextBlinkGap, THINK_TILT_DEG } from '../ClaudeTurtleBuddy';
import { eyeDots, ledgeOffset } from '../ClaudeTurtleMark';

const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'ClaudeTurtleBuddy.jsx'), 'utf8');
const CODE = SRC.slice(SRC.indexOf('import React'));
const flat = (id) => StyleSheet.flatten(screen.getByTestId(id).props.style);

describe('ClaudeTurtleBuddy', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('the blink waits a random while, inside its window', () => {
    expect(nextBlinkGap(() => 0)).toBe(BLINK.minGap);
    expect(nextBlinkGap(() => 1)).toBe(BLINK.maxGap);
    expect(nextBlinkGap(() => 0.5)).toBe((BLINK.minGap + BLINK.maxGap) / 2);
    // Shut faster than it opens, and both too quick to read as a wink.
    expect(BLINK.shut).toBeLessThan(BLINK.open);
    expect(BLINK.shut + BLINK.open).toBeLessThan(260);
  });

  test('the face is CLIPPED AT THE LEDGE — he comes up from behind it', async () => {
    const { unmount } = await render(<ClaudeTurtleBuddy size={80} />);
    const clip = flat('claude-turtle-buddy-clip');
    expect(clip.overflow).toBe('hidden');
    // The clip's bottom edge is the ledge (plus a hair for the chin's line):
    // its top is `top` above the mark, so bottom = top + height.
    expect(clip.top + clip.height).toBeGreaterThanOrEqual(ledgeOffset(80));
    expect(clip.top + clip.height).toBeLessThan(ledgeOffset(80) + 1.5);
    await unmount();
    // A FILLED face stops at the top of the rule, so the rule shows under him —
    // and its shape runs on below the ledge, so tipping the head back to think
    // never lifts a corner of it off the line.
    const filled = await render(<ClaudeTurtleBuddy size={80} color="#000000" faceFill="#FFFFFF" />);
    const c2 = flat('claude-turtle-buddy-clip');
    expect(c2.top + c2.height).toBeLessThan(ledgeOffset(80));
    const base = screen.getByTestId('claude-turtle-buddy-face-art-face').props.d.split(' L')[1].split(' ').map(Number);
    expect(base[1]).toBeGreaterThan(150 + 30);
    await filled.unmount();
  });

  test('three layers, back to front: face, the hand that stays, the hand that thinks', async () => {
    const { unmount } = await render(<ClaudeTurtleBuddy size={80} />);
    const kids = screen.getByTestId('claude-turtle-buddy').children.map((c) => c.props.testID);
    expect(kids).toEqual(['claude-turtle-buddy-clip', 'claude-turtle-buddy-hand-right', 'claude-turtle-buddy-hand-left']);
    // The LEFT hand is last — it goes to the chin, so it has to be in front
    // of the face when it gets there.
    await unmount();
  });

  test('THINKING IS A HAND ON THE CHIN, not a finger in the air', () => {
    // Mark, 2026-11-15: "thinking should have his hand on his chin not a
    // finger up … that finger looks like a tail".
    expect(CODE).not.toMatch(/FINGER|-finger/);
    // The hand travels right and UP, toward the chin (which is at about
    // x 138–156, y 147–154 in the drawing), and turns as it goes.
    expect(CHIN_HAND.dx).toBeGreaterThan(40);
    expect(CHIN_HAND.dy).toBeLessThan(0);
    const arrives = { x: CHIN_HAND.cx + CHIN_HAND.dx, y: CHIN_HAND.cy + CHIN_HAND.dy };
    expect(arrives.x).toBeGreaterThan(120);
    expect(arrives.x).toBeLessThan(160);
    expect(arrives.y).toBeGreaterThan(120);
    expect(arrives.y).toBeLessThan(150);
    expect(Math.abs(CHIN_HAND.turn)).toBeGreaterThan(10);
    // It turns about ITSELF: the pivot is put at the layer's middle, turned,
    // and put back, before the trip is made.
    const at = (needle) => { const i = CODE.indexOf(needle); expect([needle, i >= 0]).toEqual([needle, true]); return i; };
    const toMiddle = at('{ translateX: chin.pivotX }');
    const turn = at("CHIN_HAND.turn}deg`] }) },");
    const back = at('{ translateX: -chin.pivotX }');
    expect(turn).toBeGreaterThan(toMiddle);
    expect(back).toBeGreaterThan(turn);
    // …and the trip itself comes FIRST in the list (so it is applied last).
    expect(at('outputRange: [0, chin.moveX]')).toBeLessThan(toMiddle);
  });

  test('the eyes are two Views on the face, each closing about its own middle', async () => {
    const { unmount } = await render(<ClaudeTurtleBuddy size={80} tilt={2.3} />);
    // Not SVG circles: one group scaled to blink would slide both eyes down the face.
    expect(screen.queryAllByTestId('svg-Circle')).toHaveLength(0);
    const eyes = screen.getAllByTestId('claude-turtle-buddy-eye');
    expect(eyes).toHaveLength(2);
    const dots = eyeDots(80, 2.3);
    eyes.forEach((eye, i) => {
      const s = StyleSheet.flatten(eye.props.style);
      expect(s.left + s.width / 2).toBeCloseTo(dots[i].x);
      expect(s.top + s.height / 2).toBeCloseTo(dots[i].y);
      expect(s.borderRadius).toBeCloseTo(s.width / 2);
    });
    await unmount();
  });

  test('takes the colours it is given — the night figure included', async () => {
    const { unmount } = await render(<ClaudeTurtleBuddy size={80} color="#000000" handFill="#FFFFFF" faceFill="#FFFFFF" />);
    expect(screen.getByTestId('claude-turtle-buddy-face-art-face').props.fill).toBe('#FFFFFF');
    for (const eye of screen.getAllByTestId('claude-turtle-buddy-eye')) {
      expect(StyleSheet.flatten(eye.props.style).backgroundColor).toBe('#000000');
    }
    await unmount();
  });

  test('he jumps, blinks for a while, thinks — and stops for good when he leaves', async () => {
    const spy = jest.spyOn(global, 'setTimeout');
    // A blink is the only thing here that waits seconds.
    const blinkWaits = () => spy.mock.calls.filter((c) => c[1] >= BLINK.minGap && c[1] <= BLINK.maxGap).length;
    const { rerender, unmount } = await render(<ClaudeTurtleBuddy size={80} />);
    // The jump, then several blink windows.
    await act(async () => { jest.advanceTimersByTime(900); });
    expect(blinkWaits()).toBeGreaterThanOrEqual(1);
    await act(async () => { jest.advanceTimersByTime(BLINK.maxGap * 3); });
    expect(blinkWaits()).toBeGreaterThanOrEqual(3);
    // A question goes in, an answer starts.
    await rerender(<ClaudeTurtleBuddy size={80} thinking />);
    await act(async () => { jest.advanceTimersByTime(600); });
    await rerender(<ClaudeTurtleBuddy size={80} />);
    await act(async () => { jest.advanceTimersByTime(600); });
    await unmount();
    // Gone: however long we wait, he never schedules another blink.
    const atUnmount = blinkWaits();
    await act(async () => { jest.advanceTimersByTime(BLINK.maxGap * 4); });
    expect(blinkWaits()).toBe(atUnmount);
    spy.mockRestore();
  });

  test('NATIVE DRIVER throughout, and no Reanimated', () => {
    // A worklet that calls a plain function passes every test and crashes a
    // release build. Nothing here needs one, so nothing here has one.
    expect(CODE).not.toMatch(/react-native-reanimated/);
    const moves = CODE.match(/Animated\.(timing|spring)\(/g) || [];
    const native = CODE.match(/useNativeDriver: true/g) || [];
    expect(moves.length).toBeGreaterThan(4);
    expect(native).toHaveLength(moves.length);
    expect(CODE).not.toMatch(/useNativeDriver: false/);
    // …which also means only transforms and opacity are ever animated.
    expect(CODE).not.toMatch(/(height|width|top|left): (rise|grab|lid|think)\b/);
  });

  test('thinking tips the head BACK, a little', () => {
    expect(THINK_TILT_DEG).toBeLessThan(0);
    expect(THINK_TILT_DEG).toBeGreaterThanOrEqual(-12);
  });

  test('Reduce Motion is asked for', () => {
    expect(CODE).toMatch(/AccessibilityInfo\.isReduceMotionEnabled/);
  });

  test('the session header wears him, and he thinks while a turn is in flight', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'screens', 'TurtleScreen', 'index.jsx'), 'utf8');
    expect(src).toMatch(/<ClaudeTurtleBuddy\s+size=\{CLAUDE_PEEK_WIDTH\}\s+thinking=\{claudeBusy\}/);
  });
});
