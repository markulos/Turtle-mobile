/**
 * The Claude console and the keyboard.
 *
 * The keyboard lagged on its way DOWN — only in a session, only with a log
 * loaded. The transcript's ScrollView filled a panel whose height changes every
 * frame, so it grew every frame of the close; a log scrolled to its end is then
 * past the new end each time, iOS re-clamps the offset, and React Native
 * answers every clamp with a whole-tree state update. On the way up the box
 * shrinks, nothing is clamped, and it was smooth.
 *
 * The box now keeps ONE size while the keyboard moves. These pin the arithmetic
 * that makes that true.
 */
import fs from 'fs';
import path from 'path';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(() => Promise.resolve(null)), setItem: jest.fn(() => Promise.resolve()) },
}));

import {
  COMPACT_MAX_HEIGHT, MIN_PANEL_HEIGHT, consoleHeights, transcriptShift,
} from '../ClaudeConsole';

const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'ClaudeConsole.jsx'), 'utf8');

/** What the panel's height was before any of this — the formula it must still match. */
function oldHeight(lift, maxHeight, progress) {
  const cap = Math.max(MIN_PANEL_HEIGHT, maxHeight - lift);
  const compactH = Math.min(COMPACT_MAX_HEIGHT, cap);
  return Math.round(compactH + (cap - compactH) * progress);
}

const ROOMS = [180, 280, 431.5, 520, 612.33];
const LIFTS = [0, 0.4, 1, 37, 120.5, 245, 291, 336, 500];
const PROGRESS = [0, 0.25, 0.5, 1];

describe('consoleHeights', () => {
  test('the panel is exactly as tall as it always was', () => {
    for (const room of ROOMS) for (const lift of LIFTS) for (const p of PROGRESS) {
      expect(consoleHeights(lift, room, p).lifted).toBe(oldHeight(lift, room, p));
    }
  });

  test('with the keyboard down nothing is taken', () => {
    for (const room of ROOMS) for (const p of PROGRESS) {
      const h = consoleHeights(0, room, p);
      expect(h.take).toBe(0);
      expect(h.lifted).toBe(h.rest);
    }
  });

  test('THE BOX NEVER CHANGES HEIGHT: what the panel loses, the box hangs out by', () => {
    // box = (panel − whatever is pinned above the log) + take. For that to be
    // one number through the whole ride, lifted + take must be `rest`, in whole
    // points, on every frame.
    for (const room of ROOMS) for (const p of PROGRESS) {
      const rest = consoleHeights(0, room, p).rest;
      for (const lift of LIFTS) {
        const h = consoleHeights(lift, room, p);
        expect(h.lifted + h.take).toBe(rest);
        expect(Number.isInteger(h.take)).toBe(true);
        expect(h.take).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('transcriptShift', () => {
  test('a log that fills its box rides the whole way — its newest line stays in view', () => {
    expect(transcriptShift(291, 0)).toBe(291);
  });

  test('a short log, with room to spare under it, does not move at all', () => {
    expect(transcriptShift(291, 291)).toBe(0);
    expect(transcriptShift(291, 400)).toBe(0);
  });

  test('in between, it moves only by what would otherwise be covered', () => {
    expect(transcriptShift(291, 100)).toBe(191);
  });

  test('never downwards', () => {
    for (const take of [0, 10, 291]) for (const slack of [0, 5, 291, 900]) {
      expect(transcriptShift(take, slack)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('ClaudeConsole — the transcript and the keyboard', () => {
  test('the ScrollView sits in a box whose height the keyboard does not change', () => {
    expect(SRC).toContain('<View style={styles.bodySlot}>');
    expect(SRC).toContain('<Animated.View style={[styles.bodyHold, transcriptHoldStyle]}>');
    expect(SRC).toContain("bodySlot: { flex: 1, overflow: 'hidden' },");
    expect(SRC).toContain("bodyHold: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },");
    // Its bottom hangs out by what was taken, and the log slides on a transform.
    expect(SRC).toContain('return { bottom: -take, transform: [{ translateY: -transcriptShift(take, slack.value) }] };');
    // Android keeps the plain resize.
    expect(SRC).toContain('if (!IS_IOS) return { bottom: 0, transform: [{ translateY: 0 }] };');
  });

  test('the panel and the box read the SAME heights', () => {
    expect(SRC).toContain('return { height: consoleHeights(lift, maxHeight, expandProgress.value).lifted };');
    expect(SRC).toContain('const take = consoleHeights(lift, maxHeight, expandProgress.value).take;');
  });

  test('everything that runs on the UI thread says it is a worklet', () => {
    const helpers = SRC.slice(SRC.indexOf('export function consoleHeights'), SRC.indexOf('export default function ClaudeConsole'));
    expect(helpers.match(/'worklet';/g)).toHaveLength(2);
    const hold = SRC.slice(SRC.indexOf('const transcriptHoldStyle'), SRC.indexOf('const keyboardUpRef'));
    expect(hold).toContain("'worklet';");
    // No React state is touched from the animated style.
    expect(hold).not.toMatch(/setHiddenTop|useState/);
  });

  test('what the slot hides of the top can still be pulled into view, once the keyboard has settled', () => {
    expect(SRC).toContain('contentInset={{ top: hiddenTop, left: 0, bottom: 0, right: 0 }}');
    // Set on the Did events — after the ride, never during it.
    expect(SRC).toContain("Keyboard.addListener('keyboardDidShow', (e) => {");
    expect(SRC).toContain("Keyboard.addListener('keyboardDidHide', () => {");
    expect(SRC).not.toContain("'keyboardWillShow'");
    expect(SRC).not.toContain("'keyboardWillHide'");
  });
});
