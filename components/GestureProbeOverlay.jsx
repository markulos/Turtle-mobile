/**
 * GestureProbeOverlay — the face of utils/gestureProbe, DEV BUILDS ONLY.
 *
 * A small pill in the bottom-left corner that turns amber/red the moment the
 * app stops keeping up with your finger. Tap it for the findings list, where
 * each row can be written into the to-do list as a **ready-to-send Claude
 * prompt** — the point being that you drive the app, it notices what felt
 * wrong, and you hand the resulting prompt to a session later without having
 * to remember or re-describe anything.
 *
 * Renders `null` in a release build (and the probe never starts), so nothing
 * here reaches a family install.
 *
 * Styling is intentionally hard-coded rather than themed: this is a developer
 * instrument, not product chrome, and it must look identical in both themes so
 * a screenshot of it is unambiguous.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useServer } from '../context/ServerContext';
import gestureProbe, { BAD_MS, SLOW_MS, buildFixPrompt } from '../utils/gestureProbe';

const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;
const STORAGE_KEY = 'gestureProbe.findings.v1';

const KIND_ICON = {
  'freeze-after-touch': 'hand-back-left-off',
  'js-blocked': 'timer-sand',
  'slow-response': 'speedometer-slow',
};

const colorFor = (ms) => (ms >= BAD_MS ? '#f87171' : ms >= SLOW_MS ? '#fbbf24' : '#4ade80');

export default function GestureProbeOverlay() {
  if (!IS_DEV) return null;
  return <ProbeOverlayBody />;
}

function ProbeOverlayBody() {
  const insets = useSafeAreaInsets();
  const { api } = useServer();
  const [state, setState] = useState(() => gestureProbe.getState());
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [written, setWritten] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const saveTimer = useRef(null);

  // Start collecting on mount; restore anything from before the last Metro
  // reload so a finding found at 2am survives the reload that follows it.
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!alive || !raw) return;
        try { gestureProbe.hydrate(JSON.parse(raw)); } catch { /* corrupt — start clean */ }
      })
      .catch(() => {});
    // Debounced persistence, injected rather than imported by the probe so the
    // probe itself stays dependency-free and safe to call from hot paths.
    gestureProbe.setPersist((findings) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(findings)).catch(() => {});
      }, 1200);
    });
    gestureProbe.start();
    const unsub = gestureProbe.subscribe(setState);
    return () => {
      alive = false;
      unsub();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      gestureProbe.setPersist(null);
      gestureProbe.stop();
    };
  }, []);

  const findings = state.findings || [];
  const worst = findings.length ? findings[0].worstMs : 0;

  // Write findings into the real to-do list as prompts. Explicit button, never
  // automatic: this writes rows the user will actually see in Tasks, and a
  // debugger that spams the task list is a debugger you turn off.
  const writeTodos = useCallback(async (rows) => {
    if (!rows.length || busy) return;
    setBusy(true);
    setNote('');
    let ok = 0;
    for (const f of rows) {
      try {
        await api.post('/tasks/single', {
          title: `[probe] ${f.label} — ${Math.round(f.worstMs)}ms`,
          description: buildFixPrompt(f),
          priority: f.worstMs >= BAD_MS ? 'high' : 'medium',
          tags: ['perf', 'probe'],
        });
        ok += 1;
        setWritten((prev) => new Set(prev).add(f.key));
      } catch (e) {
        console.warn('[probe] could not write to-do:', e?.message || e);
      }
    }
    setBusy(false);
    setNote(ok === rows.length
      ? `Wrote ${ok} prompt${ok === 1 ? '' : 's'} to your to-do list`
      : `Wrote ${ok} of ${rows.length} — check the server connection`);
  }, [api, busy]);

  const copyAll = useCallback(async () => {
    const text = gestureProbe.buildPrompts().map((p) => p.prompt).join('\n\n---\n\n');
    await Clipboard.setStringAsync(text || 'No findings yet.');
    setNote('Copied every prompt to the clipboard');
  }, []);

  if (hidden) return null;

  const pending = findings.filter((f) => !written.has(f.key));

  return (
    <>
      <View pointerEvents="box-none" style={[styles.host, { bottom: insets.bottom + 96 }]}>
        <TouchableOpacity
          pointerEvents="auto"
          onPress={() => setOpen(true)}
          onLongPress={() => setHidden(true)}
          activeOpacity={0.8}
          style={[styles.pill, { borderColor: colorFor(worst) }]}
        >
          <Icon name="pulse" size={13} color={colorFor(worst)} />
          <Text style={styles.pillText}>
            {findings.length === 0 ? 'probe' : `${findings.length} · ${Math.round(worst)}ms`}
          </Text>
        </TouchableOpacity>
      </View>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Gesture probe</Text>
                <Text style={styles.sheetSub}>
                  {state.running ? 'watching' : 'stopped'} · {state.totalStalls} stall
                  {state.totalStalls === 1 ? '' : 's'} · worst {state.worstStallMs}ms
                </Text>
              </View>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Icon name="close" size={22} color="#9aa0a6" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{ maxHeight: 320 }}
              scrollIndicatorInsets={{ right: 1 }}
              indicatorStyle="white"
            >
              {findings.length === 0 ? (
                <Text style={styles.empty}>
                  Nothing yet. Drive the app — swipe the photo viewer, open photos, scroll the
                  grid — and anything that lags behind your finger lands here.
                </Text>
              ) : findings.map((f) => (
                <View key={f.key} style={styles.row}>
                  <Icon name={KIND_ICON[f.kind] || 'alert'} size={18} color={colorFor(f.worstMs)} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{f.label}</Text>
                    <Text style={styles.rowMeta}>
                      {f.kind} · {f.count}× · worst {Math.round(f.worstMs)}ms
                      {written.has(f.key) ? ' · in to-do' : ''}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => writeTodos([f])}
                    disabled={busy}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Icon
                      name={written.has(f.key) ? 'check-circle-outline' : 'playlist-plus'}
                      size={20}
                      color={written.has(f.key) ? '#4ade80' : '#e8eaed'}
                    />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>

            {note ? <Text style={styles.note}>{note}</Text> : null}

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, (busy || !pending.length) && styles.btnOff]}
                onPress={() => writeTodos(pending)}
                disabled={busy || !pending.length}
              >
                <Text style={styles.btnPrimaryText}>
                  {busy ? 'Writing…' : `Write ${pending.length} to to-do`}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={copyAll}>
                <Text style={styles.btnText}>Copy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btn}
                onPress={() => { gestureProbe.clear(); setWritten(new Set()); setNote('Cleared'); }}
              >
                <Text style={styles.btnText}>Clear</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.foot}>
              Long-press the pill to hide it for this session. Dev builds only.
            </Text>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 12, zIndex: 9999 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.72)', borderWidth: 1,
  },
  pillText: { color: '#e8eaed', fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: '#17181b', borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingHorizontal: 16, paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#3c4043',
  },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  sheetTitle: { color: '#e8eaed', fontSize: 17, fontWeight: '800' },
  sheetSub: { color: '#9aa0a6', fontSize: 11.5, marginTop: 2 },
  empty: { color: '#9aa0a6', fontSize: 13, lineHeight: 19, paddingVertical: 18 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2a2c30',
  },
  rowTitle: { color: '#e8eaed', fontSize: 13.5, fontWeight: '700' },
  rowMeta: { color: '#9aa0a6', fontSize: 11, marginTop: 2 },
  note: { color: '#4ade80', fontSize: 11.5, marginTop: 10 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  btn: {
    paddingHorizontal: 14, paddingVertical: 11, borderRadius: 10,
    backgroundColor: '#26282c', alignItems: 'center', justifyContent: 'center',
  },
  btnPrimary: { flex: 1, backgroundColor: '#4ade80' },
  btnOff: { opacity: 0.45 },
  btnText: { color: '#e8eaed', fontSize: 13, fontWeight: '700' },
  btnPrimaryText: { color: '#0a0a0a', fontSize: 13, fontWeight: '800' },
  foot: {
    color: '#5f6368', fontSize: 10.5, marginTop: 10, textAlign: 'center',
    ...Platform.select({ ios: { letterSpacing: 0.2 }, default: {} }),
  },
});
