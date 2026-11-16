/**
 * UpdateReadyPrompt — the one button that takes the update already on the
 * phone.
 *
 * `services/launchUpdate` has been checking and downloading since 2026-11-13,
 * and applying nothing: expo-updates launches a downloaded update the next
 * time the app STARTS. An app left resident for a week never starts, so the
 * new version sat there and the only thing that said so was a dot on the
 * Profile tab. Mark, 2026-11-16: "anytime the app opens, have an autocheck if
 * there is a new update with a prompt … with just a button to update and
 * restart."
 *
 * So the check is unchanged and this is what says so. The rules for WHEN live
 * in services/updatePrompt, away from the renderer and the native module.
 *
 * ── The button is a RESTART, not a download ───────────────────────────────
 *
 * It only ever appears on `ready`, meaning the bytes are already here. That
 * is what lets it promise to be instant. `launchCheckSettled()` first all the
 * same — expo-updates will not take two fetches at once, and the foreground
 * re-check may be mid-flight — and then `fetchUpdateAsync` is a no-op that
 * returns what is already on disk.
 *
 * ── Why there is a way out, when the ask was "just a button" ──────────────
 *
 * This can appear over a half-written message. Saying no costs nothing: the
 * update is on the phone and applies on the next cold start regardless, which
 * is precisely what happened before this prompt existed. One prominent
 * button, one quiet way past it, and the note says so out loud.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as Updates from 'expo-updates';
import { launchCheckSettled } from '../services/launchUpdate';
import {
  PROMPT_ACTION, PROMPT_BODY, PROMPT_DISMISS, PROMPT_DISMISS_NOTE, PROMPT_TITLE,
} from '../services/updatePrompt';
import { useTheme } from '../context/ThemeContext';
import { impactHaptic, tapHaptic } from '../utils/haptics';
import { describeUpdateError } from '../utils/updatesSummary';
import { depth } from '../utils/surfaceDepth';
import { inkOn } from '../utils/accentColor';

export default function UpdateReadyPrompt({ visible, onDismiss, updates = Updates }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  /**
   * The re-entrancy guard, and it has to be a REF.
   *
   * `setBusy(true)` is a state update — a second tap landing in the same tick
   * still reads `busy === false` and starts a second run. Two reloadAsync
   * calls is a race for which bundle launches, which is not a thing to find
   * out about on a phone. `busy` stays for the SPINNER; this is the lock.
   */
  const running = useRef(false);

  const apply = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    impactHaptic('medium');
    setBusy(true);
    setError(null);
    try {
      // The launch check may still be downloading this very update; two
      // fetches at once is an error, one after the other is instant.
      await launchCheckSettled();
      await updates.fetchUpdateAsync();
      // The app relaunches here. Nothing after this line runs.
      await updates.reloadAsync();
    } catch (e) {
      // A failure must not leave a dead sheet with a spinning button: say what
      // happened and let them out. The update is still on the phone.
      setError(describeUpdateError(e));
      setBusy(false);
      running.current = false;
    }
  }, [updates]);

  if (!visible) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      // Android's back gesture is a dismissal, not a silent no-op.
      onRequestClose={busy ? undefined : onDismiss}
      testID="update-ready-prompt"
    >
      <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
        <View style={[styles.card, { backgroundColor: c.surfaceElevated || c.surface }, depth(theme, 'sheet')]}>
          <View style={[styles.badge, { backgroundColor: `${c.accent}1F` }]}>
            <Icon name="tray-arrow-down" size={22} color={c.accentInk} />
          </View>
          <Text style={[styles.title, { color: c.textPrimary }]}>{PROMPT_TITLE}</Text>
          <Text style={[styles.sub, { color: c.textSecondary }]}>{PROMPT_BODY}</Text>

          {!!error && (
            <Text style={[styles.error, { color: c.accentError }]} testID="update-ready-error">{error}</Text>
          )}

          <TouchableOpacity
            onPress={apply}
            disabled={busy}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={PROMPT_ACTION}
            accessibilityState={{ disabled: busy }}
            testID="update-ready-apply"
            style={[styles.action, { backgroundColor: c.accent }, busy && styles.actionBusy]}
          >
            {busy
              ? <ActivityIndicator size="small" color={inkOn(c.accent)} />
              : <Text style={[styles.actionText, { color: inkOn(c.accent) }]}>{PROMPT_ACTION}</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => { tapHaptic(); onDismiss?.(); }}
            disabled={busy}
            hitSlop={{ top: 10, bottom: 10, left: 16, right: 16 }}
            accessibilityRole="button"
            accessibilityLabel={PROMPT_DISMISS}
            testID="update-ready-dismiss"
            style={styles.dismiss}
          >
            <Text style={[styles.dismissText, { color: c.textSecondary }]}>{PROMPT_DISMISS}</Text>
          </TouchableOpacity>
          <Text style={[styles.note, { color: c.textTertiary }]}>{PROMPT_DISMISS_NOTE}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%', maxWidth: 380, borderRadius: 20, borderCurve: 'continuous',
    padding: 22, alignItems: 'center',
  },
  badge: {
    width: 44, height: 44, borderRadius: 14, borderCurve: 'continuous',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 19, fontWeight: '800', textAlign: 'center', marginTop: 12 },
  sub: { fontSize: 13.5, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  error: { fontSize: 12.5, lineHeight: 17, textAlign: 'center', marginTop: 12, fontWeight: '600' },
  // THE button: full width, so there is no question which one is the answer.
  action: {
    alignSelf: 'stretch', height: 48, borderRadius: 14, borderCurve: 'continuous',
    alignItems: 'center', justifyContent: 'center', marginTop: 18,
  },
  actionBusy: { opacity: 0.75 },
  actionText: { fontSize: 15.5, fontWeight: '800' },
  dismiss: { paddingTop: 14, paddingBottom: 2 },
  dismissText: { fontSize: 14, fontWeight: '600' },
  note: { fontSize: 11.5, lineHeight: 16, textAlign: 'center', marginTop: 4 },
});
