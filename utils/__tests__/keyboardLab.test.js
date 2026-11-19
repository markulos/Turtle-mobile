/**
 * keyboardLab — the measuring, and the switches, behind the chat's keyboard
 * test panel.
 */
import fs from 'fs';
import path from 'path';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(() => Promise.resolve(null)), setItem: jest.fn(() => Promise.resolve()) },
}));

import {
  CONSOLE_MODES, DEFAULT_CONFIG, DRIVES, configName, describeMove, diagnose, getKeyboardLab, runPlan,
  setKeyboardLab,
} from '../keyboardLab';
import { addMove, worseOf } from '../../components/KeyboardLabStrip';

const read = (...p) => fs.readFileSync(path.resolve(__dirname, '..', '..', ...p), 'utf8');
const move = (over = {}) => ({
  opening: true, frames: 30, worstMs: 9, bestMs: 8.3, drops: 0, offMax: 2, firstMoveMs: 10, jsMs: 3, ...over,
});

describe('keyboardLab', () => {
  afterEach(() => setKeyboardLab(DEFAULT_CONFIG, { persist: false }));

  test('THE DEFAULT IS WHAT SHIPPED — nothing changes until something is switched', () => {
    expect(DEFAULT_CONFIG.drive).toBe('reanimated');
    expect(DEFAULT_CONFIG.console).toBe('resize');
    expect(getKeyboardLab()).toEqual(DEFAULT_CONFIG);
  });

  test('a setting it does not know falls back to the default, not to nothing', () => {
    setKeyboardLab({ drive: 'telepathy', console: 'vanish' }, { persist: false });
    expect(getKeyboardLab().drive).toBe('reanimated');
    expect(getKeyboardLab().console).toBe('resize');
    setKeyboardLab({ drive: 'spring', console: 'slide' }, { persist: false });
    expect(getKeyboardLab()).toMatchObject({ drive: 'spring', console: 'slide' });
  });

  test('the automatic run starts with what shipped and changes one thing at a time', () => {
    const chat = runPlan(false);
    expect(chat.map((c) => c.drive)).toEqual(DRIVES);
    const session = runPlan(true);
    expect(session[0]).toEqual({ drive: 'reanimated', console: 'resize' });
    // …then ONLY the console changes, so the two lines differ by one thing.
    expect(session[1]).toEqual({ drive: 'reanimated', console: 'slide' });
    for (const cfg of [...chat, ...session]) {
      expect(DRIVES).toContain(cfg.drive);
      expect(CONSOLE_MODES).toContain(cfg.console);
    }
  });

  test('names are short, and the console only shows in a session', () => {
    expect(configName({ drive: 'reanimated', console: 'resize' }, false)).toBe('A');
    expect(configName({ drive: 'reanimated', console: 'resize' }, true)).toBe('A·r');
    expect(configName({ drive: 'spring', console: 'slide' }, true)).toBe('C·s');
  });

  test('one fixed-width line per move, narrow enough for the panel', () => {
    const a = describeMove(move());
    const b = describeMove(move({ opening: false, frames: 7, worstMs: 120, drops: 14, offMax: 180, firstMoveMs: 96, jsMs: 240 }));
    expect(a).toHaveLength(b.length);
    expect(a.length).toBeLessThanOrEqual(42);
    expect(a).toMatch(/^open /);
    expect(b).toMatch(/^close/);
  });

  test('the verdict names the CAUSE: dropping, trailing, late — or clean', () => {
    expect(diagnose(move())).toBe('ok');
    expect(diagnose(move({ drops: 5 }))).toBe('DROP');
    // One very long frame is a stumble even if the count works out.
    expect(diagnose(move({ worstMs: 45 }))).toBe('DROP');
    expect(diagnose(move({ offMax: 60 }))).toBe('TRAIL');
    expect(diagnose(move({ firstMoveMs: 120 }))).toBe('LATE');
    // Dropping outranks the others: it is the one that costs the rest.
    expect(diagnose(move({ drops: 5, offMax: 60, firstMoveMs: 120 }))).toBe('DROP');
  });

  test('a clean repeat does not hide a bad move', () => {
    const bad = move({ drops: 6, worstMs: 50 });
    const good = move();
    expect(worseOf(bad, good)).toBe(bad);
    expect(worseOf(good, bad)).toBe(bad);
    let rows = addMove([], 'A', bad);
    rows = addMove(rows, 'A', good);
    rows = addMove(rows, 'A', move({ opening: false }));
    rows = addMove(rows, 'B', good);
    expect(rows).toHaveLength(2);
    expect(rows[0].open).toBe(bad);
    expect(rows[0].close.opening).toBe(false);
  });

  test('EVERY handler that runs on the UI thread says it is a worklet', () => {
    // A function reaching the UI runtime without the directive throws there,
    // and in a release build that throw is fatal. jest cannot see it.
    for (const rel of [['utils', 'keyboardLab.js'], ['components', 'KeyboardDriver.jsx']]) {
      const src = read(...rel);
      const code = src.slice(src.indexOf('import '));
      const handlers = code.match(/\bon(Start|Move|Interactive|End): \(e\) => \{/g) || [];
      const reactions = code.match(/\(h\) => \{/g) || [];
      const frames = code.match(/useFrameCallback\(\(info\) => \{/g) || [];
      const prepares = code.match(/=> [{][^}]*'worklet';[^}]*return /g) || [];
      const directives = code.match(/'worklet';/g) || [];
      expect(handlers.length + reactions.length + frames.length).toBeGreaterThan(0);
      expect(directives).toHaveLength(handlers.length + reactions.length + frames.length + prepares.length);
      // …and nothing from React Native's own Easing, which is not a worklet.
      expect(code).not.toMatch(/\bEasing\b/);
    }
  });

  test('the chat is lifted by ONE shared value, fed by one driver at a time', () => {
    const screen = read('screens', 'TurtleScreen', 'index.jsx');
    expect(screen).toMatch(/<KeyboardDriver drive=\{keyboardLab\.drive\} out=\{keyboardHeight\} \/>/);
    expect(screen).toMatch(/const keyboard = useMemo\(\(\) => \(\{ height: keyboardHeight \}\), \[keyboardHeight\]\);/);
    // The screen no longer tracks the keyboard itself.
    expect(screen).not.toMatch(/=\s*useAnimatedKeyboard\(/);
    const driver = read('components', 'KeyboardDriver.jsx');
    // One of three, never more than one mounted.
    expect(driver).toMatch(/if \(drive === 'controller'\) return <ControllerDrive out=\{out\} \/>;/);
    expect(driver).toMatch(/if \(drive === 'spring'\) return <SpringDrive out=\{out\} \/>;/);
    expect(driver).toMatch(/return <ReanimatedDrive out=\{out\} \/>;/);
  });

  test('the console can SLIDE instead of resizing — a transform, not a layout change', () => {
    const src = read('screens', 'TurtleScreen', 'components', 'ClaudeConsole.jsx');
    expect(src).toMatch(/slide = false/);
    // Sliding, the panel's height does not depend on the keyboard at all.
    const slideStyle = src.slice(src.indexOf('const slidePanelStyle'), src.indexOf('const slideBodyStyle'));
    // The panel keeps its RESTING height and is pushed back by what the resize
    // would have taken off; the transcript rides up by the same amount.
    expect(slideStyle).toContain('return { height: rest, transform: [{ translateY: take }] };');
    const body = src.slice(src.indexOf('const slideBodyStyle'), src.indexOf('const slideBodyStyle') + 400);
    expect(body).toContain('return { transform: [{ translateY: -take }] };');
    // Compact, there is nothing to take: the panel just rides the dock.
    expect(src).toContain('return { rest, take: rest - lifted };');
  });
});
