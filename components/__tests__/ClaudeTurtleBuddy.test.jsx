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

import ClaudeTurtleBuddy, {
  BLINK, GLANCES, IDLE_GAP, THINK_DRIFT, THINK_GAP, THINK_GAZE, THINK_TILT_DEG,
  TYPE_DIP, TYPE_GAZE, TYPE_TILT_DEG, TYPING_LINGER_MS, nextActGap, nextBlinkGap,
} from '../ClaudeTurtleBuddy';
import { CLAUDE_POINT_AT, eyeDots, ledgeOffset } from '../ClaudeTurtleMark';

const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'ClaudeTurtleBuddy.jsx'), 'utf8');
const CODE = SRC.slice(SRC.indexOf('import React'));
const flat = (id) => StyleSheet.flatten(screen.getByTestId(id).props.style);

// Under the whole suite's load an animated render can outlast jest's 5s default.
jest.setTimeout(30000);

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

  test('layers, back to front: face, left hand, right hand at rest, right hand pointing', async () => {
    const { unmount } = await render(<ClaudeTurtleBuddy size={80} />);
    const kids = screen.getByTestId('claude-turtle-buddy').children.map((c) => c.props.testID);
    expect(kids).toEqual([
      'claude-turtle-buddy-clip',
      'claude-turtle-buddy-hand-left',
      'claude-turtle-buddy-hand-right',
      'claude-turtle-buddy-hand-point',
    ]);
    // The pointing hand is its own drawing, last — in front of the face.
    expect(screen.getByTestId('claude-turtle-buddy-hand-point-art-point')).toBeTruthy();
    await unmount();
  });

  test('THINKING: one finger at the corner of his mouth, eyes up and away', () => {
    // Mark's reference (2026-11-15): hand up, one finger touching below the
    // mouth, eyes rolled up and off to the side. The gesture, on our turtle.
    //
    // The hand is on his RIGHT (the fist sits right of the middle of the
    // drawing, x 188)…
    expect(CLAUDE_POINT_AT.x).toBeGreaterThan(188);
    // …so the eyes go UP and to the LEFT — away from it — and wander nearby.
    expect(THINK_GAZE[0]).toBeLessThan(0);
    expect(THINK_GAZE[1]).toBeLessThan(0);
    for (const [x, y] of THINK_DRIFT) { expect(x).toBeLessThan(0); expect(y).toBeLessThan(0); }
    // …and the head leans toward the hand, a little.
    expect(THINK_TILT_DEG).toBeGreaterThan(0);
    expect(THINK_TILT_DEG).toBeLessThanOrEqual(8);
    // A hand cannot change shape under a transform: the resting hand fades
    // out as the pointing one fades in, both on the move.
    expect(CODE).toMatch(/opacity: Animated\.multiply\(\s*grabOpacity,\s*think\.interpolate\(\{ inputRange: \[0, 0\.55\], outputRange: \[1, 0\]/);
    expect(CODE).toMatch(/opacity: think\.interpolate\(\{ inputRange: \[0\.3, 0\.8\], outputRange: \[0, 1\]/);
    // No lone finger, no flat hand to the chin.
    expect(CODE).not.toMatch(/CHIN_HAND|FINGER\b|-finger/);
  });

  test('READING: eyes down to the line, and the head dips after them', () => {
    // Mark, 2026-11-16: "look down slightly and tilt his head down when I
    // start typing". He is in the top-right corner and the composer is below
    // him, so down is where the line is.
    expect(TYPE_GAZE[1]).toBeGreaterThan(0);
    // The head goes down WITH them. The eyes alone read as a glance; the dip
    // is what makes it attention — and it is a dip, not a nod off the page.
    expect(TYPE_DIP).toBeGreaterThan(0.5);
    expect(TYPE_DIP).toBeLessThanOrEqual(2);
    // "Slightly": a few degrees on a mark this size, no more.
    expect(Math.abs(TYPE_TILT_DEG)).toBeLessThanOrEqual(4);
    // And it leans the OTHER WAY from thinking, so the two poses can never be
    // read as the same one.
    expect(Math.sign(TYPE_TILT_DEG)).toBe(-Math.sign(THINK_TILT_DEG));

    // THINKING WINS. He cannot lean two ways at once, and a turn in flight is
    // the bigger thing to be saying.
    expect(CODE).toMatch(/const reading = typing && !thinking;/);
    // While reading he HOLDS it — glancing round the room while you write is
    // the opposite of what the pose says.
    expect(CODE).toMatch(/if \(reading\) return;/);
    // The dip and the lean both ride the same value, on the face layer.
    expect(CODE).toMatch(/read\.interpolate\(\{ inputRange: \[0, 1\], outputRange: \[0, TYPE_DIP\] \}\)/);
    expect(CODE).toMatch(/read\.interpolate\(\{ inputRange: \[0, 1\], outputRange: \['0deg', `\$\{TYPE_TILT_DEG\}deg`\] \}\)/);
  });

  test('…and he comes back up when you STOP, not when the box empties', () => {
    // A draft left on screen would hold him head-down for ever; clearing on
    // every keystroke would bob him between words. So: a quiet period longer
    // than any gap inside a sentence and shorter than a pause for thought.
    expect(TYPING_LINGER_MS).toBeGreaterThan(1200);
    expect(TYPING_LINGER_MS).toBeLessThan(4000);
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'screens', 'TurtleScreen', 'index.jsx'), 'utf8');
    // The screen owns the timer, and it is a REF — a re-render mid-sentence
    // must not restart it.
    expect(src).toMatch(/const typingTimer = useRef\(null\);/);
    expect(src).toMatch(/setTimeout\(\(\) => setClaudeTyping\(false\), TYPING_LINGER_MS\)/);
    // Hung off the keystroke itself, not off the text being non-empty.
    const handler = src.slice(src.indexOf('const handleInputChange'), src.indexOf('const handleInputChange') + 200);
    expect(handler).toMatch(/markTyping\(\)/);
    // …and cleared on the way out, or a timer fires into an unmounted screen.
    expect(src).toMatch(/clearTimeout\(typingTimer\.current\)/);
  });

  test('HE LOOKS AROUND — a glance, not a stare', () => {
    // The eyes are about 6 units across; a glance moves them about that far.
    expect(GLANCES.length).toBeGreaterThanOrEqual(5);
    for (const [x, y] of [...GLANCES, ...THINK_DRIFT, THINK_GAZE, TYPE_GAZE]) {
      expect(Math.abs(x)).toBeLessThanOrEqual(7);
      expect(Math.abs(y)).toBeLessThanOrEqual(7);
    }
    // Both ways, and up — not only one corner.
    expect(GLANCES.some(([x]) => x < 0)).toBe(true);
    expect(GLANCES.some(([x]) => x > 0)).toBe(true);
    expect(GLANCES.some(([, y]) => y < 0)).toBe(true);
    // The eyes SLIDE to look and then close about their own middle to blink:
    // the order matters, a scale first would scale the slide.
    expect(CODE).toMatch(/transform: \[\{ translateX: gazeX \}, \{ translateY: gazeY \}, \{ scaleY: lid \}\]/);
  });

  test('the small things he does are seconds apart — lively, not twitchy', () => {
    expect(nextActGap(IDLE_GAP, () => 0)).toBe(IDLE_GAP.min);
    expect(nextActGap(IDLE_GAP, () => 1)).toBe(IDLE_GAP.max);
    expect(IDLE_GAP.min).toBeGreaterThanOrEqual(1500);
    expect(THINK_GAP.min).toBeGreaterThanOrEqual(1000);
    // …and there is more than one of them: a glance, a tilt of the head,
    // drumming on the ledge; while thinking, a tapping finger and wandering eyes.
    for (const what of [/look\(pick\(GLANCES\)/, /to\(nod, way/, /beat\(drum/, /beat\(tap/, /look\(pick\(THINK_DRIFT\)/]) {
      expect(CODE).toMatch(what);
    }
    // Breathing never stops.
    expect(CODE).toMatch(/Animated\.loop\(Animated\.sequence\(\[\s*Animated\.timing\(breath/);
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

  test('UP IS A PROP — he waits behind the ledge until he is wanted', async () => {
    // Mark, 2026-11-16: on the Notes to self header he is not there at all
    // until you type, and then he jumps up over the ledge. Same jump the
    // session start has always used, on a switch instead of on mount.
    //
    // Down, nothing of him shows and nothing is unmounted: the face is
    // pushed past the clip and the hands are at zero opacity, which is a
    // transform and an opacity — the two things the native driver can do.
    const { unmount } = await render(<ClaudeTurtleBuddy size={80} up={false} />);
    await act(async () => { jest.advanceTimersByTime(600); });
    expect(screen.getByTestId('claude-turtle-buddy-face')).toBeTruthy();
    await unmount();

    // The travel he is pushed through is the whole ledge and then some, so
    // there is no sliver of chin left on the line.
    expect(CODE).toMatch(/const travel = ledge \+ 3;/);
    expect(CODE).toMatch(/rise\.setValue\(up \? 0 : 1\); grab\.setValue\(up \? 1 : 0\);/);
    // Going DOWN is its own move, and it does not bounce: an overshoot on
    // the way out would read as him being thrown rather than ducking.
    expect(CODE).toMatch(/if \(!up\) \{/);
    const sink = CODE.slice(CODE.indexOf('if (!up) {'), CODE.indexOf('const jump ='));
    expect(sink).not.toMatch(/JUMP_OVERSHOOT/);
    // …and the hands leave before the head does.
    expect(sink).toMatch(/grab.*duration: 140[\s\S]*rise.*duration: 260/);
  });

  test('the NOTES header wears him too, and he is up only when there is cause', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'screens', 'TurtleScreen', 'index.jsx'), 'utf8');
    // One header in both states: the mark and its ridge are there unless we
    // are on the sign-in step, where there is nobody yet.
    expect(src).toMatch(/const markShown = claudeUiMode !== 'login';/);
    expect(src).toMatch(/\{markShown && \(\s*<View pointerEvents="none" style=\{styles\.claudeRidge\}/);
    expect(src).toMatch(/\{markShown && \(\s*<>\s*<View pointerEvents="none" style=\{styles\.claudePeek\}/);
    // A session has him up throughout; the notes header only while typing.
    expect(src).toMatch(/const markUp = claudeMarkShown \|\| claudeTyping;/);
    // DECLARED BEFORE IT IS READ. `markUp` is a const in the same body, so a
    // typing state declared further down is a temporal-dead-zone throw on
    // the first render — and nothing in this suite mounts the screen.
    expect(src.indexOf('const [claudeTyping')).toBeLessThan(src.indexOf('const markUp ='));
  });

  test('NATIVE DRIVER throughout, and no Reanimated', () => {
    // A worklet that calls a plain function passes every test and crashes a
    // release build. Nothing here needs one, so nothing here has one.
    expect(CODE).not.toMatch(/react-native-reanimated/);
    const moves = CODE.match(/Animated\.(timing|spring)\(/g) || [];
    const native = CODE.match(/useNativeDriver: true/g) || [];
    expect(moves.length).toBeGreaterThan(6);
    expect(native).toHaveLength(moves.length);
    expect(CODE).not.toMatch(/useNativeDriver: false/);
    // …which also means only transforms and opacity are ever animated.
    expect(CODE).not.toMatch(/(height|width|top|left): (rise|grab|lid|think|gazeX|gazeY|breath|nod|tap|drum)\b/);
  });

  test('Reduce Motion is asked for', () => {
    expect(CODE).toMatch(/AccessibilityInfo\.isReduceMotionEnabled/);
  });

  test('the session header wears him, and he thinks while a turn is in flight', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'screens', 'TurtleScreen', 'index.jsx'), 'utf8');
    expect(src).toMatch(/<ClaudeTurtleBuddy\s+size=\{CLAUDE_PEEK_WIDTH\}\s+up=\{markUp\}\s+thinking=\{claudeBusy\}/);
    expect(src).toMatch(/typing=\{claudeTyping\}/);
  });
});
