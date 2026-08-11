/**
 * GestureProbeOverlay — the face of utils/gestureProbe, DEV BUILDS ONLY.
 *
 * A small pill in the bottom-left corner that turns amber/red the moment the
 * app stops keeping up with your finger. Tap it for the findings list, where
 * each row can be written into **Notes as app feedback** as a ready-to-send
 * Claude prompt — the point being that you drive the app, it notices what felt
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
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet, Platform, AppState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useServer } from '../context/ServerContext';
import gestureProbe, { BAD_MS, SLOW_MS, buildFixPrompt } from '../utils/gestureProbe';

const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;
const STORAGE_KEY = 'gestureProbe.findings.v1';

// Where feedback lands, and how it's labelled.
//
// Earlier versions posted to /tasks/single, so a finding became a REAL task —
// dated today it then showed up on the calendar's day to-do list, mixed into
// actual work. Findings are app feedback, not work: they now go to Notes via
// the same path as the Notes composer's Feedback mode (a note of type 'todo'
// stamped with the app + platform tags), so they sit with the rest of the
// Turtle feedback and never touch the calendar.
const FEEDBACK_APP_TAG = 'Turtle App';
const FEEDBACK_PLATFORM_TAG = 'Mobile app';
// Extra tag of our own so probe-generated feedback is separable from feedback
// typed by hand.
const FEEDBACK_TAGS = [FEEDBACK_APP_TAG, FEEDBACK_PLATFORM_TAG, 'perf'];

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
  const [checked, setChecked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const saveTimer = useRef(null);

  const toggleChecked = useCallback((key) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

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
    // Park the drift monitor while the app is away. iOS stops timers outright
    // when the app leaves the foreground, so without this the first tick back
    // measures the entire absence as one block — the finding that read
    // "691,956ms" was a phone in a pocket, not a stall. Injected here for the
    // same reason persistence is: the probe stays free of react-native imports.
    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') gestureProbe.resume();
      else gestureProbe.suspend();
    });
    return () => {
      alive = false;
      unsub();
      appStateSub.remove();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      gestureProbe.setPersist(null);
      gestureProbe.stop();
    };
  }, []);

  const findings = state.findings || [];
  const worst = findings.length ? findings[0].worstMs : 0;

  // Write the checked findings into Notes as Turtle feedback.
  // Explicit button, never automatic: these are rows the user will actually see
  // in Notes, and a debugger that spams the list is one you turn off.
  const writeFeedback = useCallback(async (rows) => {
    if (!rows.length || busy) return;
    setBusy(true);
    setNote('');
    let ok = 0;
    let lastError = '';
    for (const f of rows) {
      try {
        const res = await api.post('/turtle/note', {
          // Both field names on purpose: the handler historically reads `note`
          // (the web chat /note path) and only newer builds accept `content`.
          // Same dual-send the Notes composer does.
          note: `Mobile feedback: ${f.label} — ${Math.round(f.worstMs)}ms`,
          content: `Mobile feedback: ${f.label} — ${Math.round(f.worstMs)}ms`,
          description: buildFixPrompt(f),
          // Feedback mode in the Notes composer persists as a to-do note, so
          // these match it exactly and appear alongside hand-typed feedback.
          type: 'todo',
          done: false,
          tags: FEEDBACK_TAGS,
        });
        // The route answers { success, noteId } — treat anything else as a
        // failure rather than reporting a write that never landed.
        if (!res || res.success === false || !res.noteId) {
          throw new Error(res?.error || 'server rejected the note');
        }
        ok += 1;
        setWritten((prev) => new Set(prev).add(f.key));
        setChecked((prev) => { const n = new Set(prev); n.delete(f.key); return n; });
      } catch (e) {
        lastError = e?.message || String(e);
        console.warn('[probe] could not write feedback:', lastError);
      }
    }
    setBusy(false);
    setNote(ok === rows.length
      ? `Added ${ok} to Notes as ${FEEDBACK_APP_TAG} feedback`
      : `Added ${ok} of ${rows.length}${lastError ? ` — ${lastError}` : ''}`);
  }, [api, busy]);

  const copyAll = useCallback(async () => {
    const text = gestureProbe.buildPrompts().map((p) => p.prompt).join('\n\n---\n\n');
    await Clipboard.setStringAsync(text || 'No findings yet.');
    setNote('Copied every prompt to the clipboard');
  }, []);

  if (hidden) return null;

  const selected = findings.filter((f) => checked.has(f.key));

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
                // Whole row is the checkbox — check off what's worth reporting,
                // then send them together as feedback.
                <TouchableOpacity
                  key={f.key}
                  style={styles.row}
                  onPress={() => toggleChecked(f.key)}
                  activeOpacity={0.7}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: checked.has(f.key) }}
                >
                  <Icon
                    name={checked.has(f.key) ? 'checkbox-marked' : 'checkbox-blank-outline'}
                    size={20}
                    color={checked.has(f.key) ? '#4ade80' : '#5f6368'}
                  />
                  <Icon name={KIND_ICON[f.kind] || 'alert'} size={18} color={colorFor(f.worstMs)} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{f.label}</Text>
                    <Text style={styles.rowMeta}>
                      {f.kind} · {f.count}× · worst {Math.round(f.worstMs)}ms
                      {written.has(f.key) ? ' · sent' : ''}
                    </Text>
                  </View>
                  {written.has(f.key) ? (
                    <Icon name="check-circle-outline" size={18} color="#4ade80" />
                  ) : null}
                </TouchableOpacity>
              ))}
            </ScrollView>

            {note ? <Text style={styles.note}>{note}</Text> : null}

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, (busy || !selected.length) && styles.btnOff]}
                onPress={() => writeFeedback(selected)}
                disabled={busy || !selected.length}
              >
                <Text style={styles.btnPrimaryText}>
                  {busy ? 'Sending…' : selected.length
                    ? `Send ${selected.length} as feedback`
                    : 'Check items to send'}
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
              Sent items land in Notes as feedback, tagged {FEEDBACK_TAGS.join(' · ')}.
              {'\n'}Long-press the pill to hide it for this session. Dev builds only.
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
