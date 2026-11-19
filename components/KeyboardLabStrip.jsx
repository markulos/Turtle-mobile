/**
 * KeyboardLabStrip — the readout and the switches of utils/keyboardLab, as a
 * panel under the chat header.
 *
 * RUN TEST opens and closes the keyboard by itself, twice for each setting,
 * and writes one line per move. Nobody has to judge anything by eye: the
 * lines are the answer, and a screenshot of them is the report.
 *
 * It keeps its own state. The reports arrive ten times in a run and must not
 * re-render the chat screen — that would be a profiler causing what it
 * measures (dockMotionProbe says the same of the navigator).
 *
 * TEMPORARY. It comes out when the keyboard is fixed; the driver that wins
 * stays.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard, Platform, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import {
  DRIVES, DRIVE_LETTER, configName, describeMove, diagnose, getKeyboardLab, onKeyboardReport, runPlan,
  setKeyboardLab, useKeyboardLab, useKeyboardProbe,
} from '../utils/keyboardLab';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const HIT = { top: 10, bottom: 10, left: 8, right: 8 };
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** The automatic run: how long it waits at each step, and how many times round. */
export const RUN = { settle: 600, open: 1500, closed: 1300, rounds: 2 };

/** Of two moves the same way, keep the WORSE — a clean repeat must not hide a bad one. */
export function worseOf(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (b.drops !== a.drops) return b.drops > a.drops ? b : a;
  return b.worstMs > a.worstMs ? b : a;
}

export function addMove(rows, name, move) {
  const side = move.opening ? 'open' : 'close';
  const at = rows.findIndex((r) => r.name === name);
  if (at < 0) return [...rows, { name, [side]: move }];
  const next = rows.slice();
  next[at] = { ...rows[at], [side]: worseOf(rows[at][side], move) };
  return next;
}

export default function KeyboardLabStrip({ height, inputRef, inSession }) {
  const lab = useKeyboardLab();
  useKeyboardProbe(height);

  const [rows, setRows] = useState([]);
  const [running, setRunning] = useState(false);
  const alive = useRef(true);
  const name = configName(lab, inSession);
  const nameRef = useRef(name);
  nameRef.current = name;

  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => onKeyboardReport((move) => {
    if (alive.current) setRows((prev) => addMove(prev, nameRef.current, move));
  }), []);

  const run = useCallback(async () => {
    if (running) return;
    const before = getKeyboardLab();
    setRunning(true);
    setRows([]);
    try {
      for (const cfg of runPlan(inSession)) {
        if (!alive.current) return;
        setKeyboardLab(cfg, { persist: false });
        await wait(RUN.settle);
        for (let i = 0; i < RUN.rounds; i += 1) {
          if (!alive.current) return;
          if (inputRef && inputRef.current && inputRef.current.focus) inputRef.current.focus();
          await wait(RUN.open);
          Keyboard.dismiss();
          await wait(RUN.closed);
        }
      }
    } finally {
      setKeyboardLab({ drive: before.drive, console: before.console }, { persist: false });
      if (alive.current) setRunning(false);
    }
  }, [running, inSession, inputRef]);

  if (!lab.open) {
    return (
      <TouchableOpacity
        style={styles.chip}
        hitSlop={HIT}
        activeOpacity={0.6}
        onPress={() => setKeyboardLab({ open: true })}
        accessibilityRole="button"
        accessibilityLabel="Show the keyboard test panel"
        testID="keyboard-lab-chip"
      >
        <Text style={styles.chipText}>KB test</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.panel} testID="keyboard-lab">
      <View style={styles.bar}>
        <Text style={styles.title} numberOfLines={1}>KEYBOARD TEST · {inSession ? 'Claude session' : 'chat'}</Text>
        <TouchableOpacity
          style={[styles.key, styles.keyLit, running && styles.keyOff]}
          hitSlop={HIT}
          activeOpacity={0.6}
          disabled={running}
          onPress={run}
          accessibilityRole="button"
          accessibilityLabel={running ? 'Keyboard test running' : 'Run the keyboard test'}
          testID="keyboard-lab-run"
        >
          <Text style={styles.keyLitText}>{running ? 'Running…' : 'Run test'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.key}
          hitSlop={HIT}
          activeOpacity={0.6}
          onPress={() => setKeyboardLab({ open: false })}
          accessibilityRole="button"
          accessibilityLabel="Hide the keyboard test panel"
        >
          <Text style={styles.keyText}>Hide</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.bar}>
        <Text style={styles.label}>Follow</Text>
        {DRIVES.map((drive) => (
          <TouchableOpacity
            key={drive}
            style={[styles.key, lab.drive === drive && styles.keyLit]}
            hitSlop={HIT}
            activeOpacity={0.6}
            disabled={running}
            onPress={() => setKeyboardLab({ drive })}
            accessibilityRole="button"
            accessibilityState={{ selected: lab.drive === drive }}
            accessibilityLabel={`Follow the keyboard with ${drive}`}
          >
            <Text style={lab.drive === drive ? styles.keyLitText : styles.keyText}>{DRIVE_LETTER[drive]}</Text>
          </TouchableOpacity>
        ))}
        {inSession && (
          <>
            <Text style={[styles.label, styles.labelGap]}>Console</Text>
            {['resize', 'slide'].map((mode) => (
              <TouchableOpacity
                key={mode}
                style={[styles.key, lab.console === mode && styles.keyLit]}
                hitSlop={HIT}
                activeOpacity={0.6}
                disabled={running}
                onPress={() => setKeyboardLab({ console: mode })}
                accessibilityRole="button"
                accessibilityState={{ selected: lab.console === mode }}
                accessibilityLabel={`Console ${mode}s with the keyboard`}
              >
                <Text style={lab.console === mode ? styles.keyLitText : styles.keyText}>{mode}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}
      </View>

      {rows.length === 0 ? (
        <Text style={styles.hint}>
          Tap Run test. It opens and closes the keyboard by itself for each setting (about {inSession ? 25 : 18} seconds),
          then screenshot this panel. A = as shipped.
        </Text>
      ) : rows.map((row) => (
        <View key={row.name} style={styles.row} testID="keyboard-lab-row">
          {['open', 'close'].map((side) => (row[side] ? (
            <Text key={side} style={styles.line} numberOfLines={1}>
              {row.name.padEnd(4, ' ')}{describeMove(row[side])}  {diagnose(row[side])}
            </Text>
          ) : null))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // White on black, whatever the theme: it is an instrument, not part of the page.
  panel: {
    backgroundColor: 'rgba(8,8,10,0.9)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  title: { flex: 1, flexShrink: 1, minWidth: 0, color: '#FFFFFF', fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  label: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600' },
  labelGap: { marginLeft: 8 },
  key: {
    minWidth: 30,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  keyLit: { backgroundColor: '#FFFFFF' },
  keyOff: { opacity: 0.5 },
  keyText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  keyLitText: { color: '#000000', fontSize: 11, fontWeight: '700' },
  hint: { color: 'rgba(255,255,255,0.7)', fontSize: 11, lineHeight: 15 },
  row: { gap: 1 },
  line: { color: '#FFFFFF', fontFamily: MONO, fontSize: 8.5 },
  chip: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(8,8,10,0.75)',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  chipText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
});
