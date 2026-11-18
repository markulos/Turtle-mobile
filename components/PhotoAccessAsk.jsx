/**
 * PhotoAccessAsk — Turtle's own question about the photo library, asked once.
 *
 * Mark, 2026-11-18: "remove the prompt that asks to autosave photos. make it
 * ask once on uploading images but also have a checkmark for never ask again".
 *
 * What used to ask was the SYSTEM sheet, fired from
 * `VaultUploadContext.processBatch` at the top of every upload — every batch,
 * documents included, declined or not, and with limited access granted it
 * re-presented the photo picker each time. A system sheet has nowhere to put
 * "never again", which is why the ask had to move in here first.
 *
 * So this is the gate in front of it: one question, with the checkmark, and
 * the OS is only reached by answering yes. services/photoAccessPrompt holds
 * when it is due and what the answer means; this file is only the asking.
 *
 * ── Why a sheet and not an Alert ─────────────────────────────────────────
 *
 * The checkmark. An `Alert` on iOS takes buttons and nothing else, so a third
 * state ("no, and stop asking") would have had to be a third BUTTON — three
 * buttons of which two mean no is a worse question than one with a tickbox.
 *
 * Mounted at the app root beside the upload pill, because an upload outlives
 * the screen that started it.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  answerPhotoAccessAsk, onPhotoAccessAsk,
} from '../services/photoAccessPrompt';
import { useTheme } from '../context/ThemeContext';
import { impactHaptic, tapHaptic } from '../utils/haptics';
import { depth } from '../utils/surfaceDepth';
import { inkOn } from '../utils/accentColor';

export const ASK_TITLE = 'Let Turtle see your photo library?';
/**
 * The two things it actually buys, and nothing else.
 *
 * Said plainly because the honest answer to "why do you want this" is small:
 * the upload itself does not need it, and a No costs exactly these two.
 */
export const ASK_BODY = 'Only for two things: picking up an upload that was interrupted, and offering to clear the originals off your phone once they are safely in your vault.';
export const ASK_ALLOW = 'Allow access';
export const ASK_DECLINE = 'Not now';
export const ASK_NEVER = 'Don’t ask again';
/** Said out loud, so a No does not feel like it broke something. */
export const ASK_NOTE = 'Your photos upload either way. You can allow it later in your phone’s Settings › Turtle › Photos.';

export default function PhotoAccessAsk() {
  const { theme } = useTheme();
  const c = theme.colors;
  const [visible, setVisible] = useState(false);
  const [never, setNever] = useState(false);
  /**
   * The re-entrancy guard, and it has to be a REF: `setBusy`-style state is
   * not written until the next render, so two taps in one tick would both
   * reach the system sheet.
   */
  const answering = useRef(false);

  useEffect(() => onPhotoAccessAsk((due) => {
    setVisible(due);
    // Each fresh question starts with the box clear; a tick left over from a
    // previous one would silence a prompt nobody had read.
    if (due) {
      setNever(false);
      answering.current = false;
    }
  }), []);

  const answer = useCallback((allow) => {
    if (answering.current) return;
    answering.current = true;
    if (allow) impactHaptic('medium'); else tapHaptic();
    setVisible(false);
    // Fire and forget: the write and the system sheet are the service's job,
    // and this one is already off the screen.
    answerPhotoAccessAsk({ allow, never }).catch(() => {});
  }, [never]);

  if (!visible) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      // Android's back gesture is an answer — the quiet one — not a no-op.
      onRequestClose={() => answer(false)}
      testID="photo-access-ask"
    >
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: c.surfaceElevated || c.surface }, depth(theme, 'sheet')]}>
          <View style={[styles.badge, { backgroundColor: `${c.accent}1F` }]}>
            <Icon name="image-multiple-outline" size={22} color={c.accentInk} />
          </View>
          <Text style={[styles.title, { color: c.textPrimary }]}>{ASK_TITLE}</Text>
          <Text style={[styles.sub, { color: c.textSecondary }]}>{ASK_BODY}</Text>

          {/* THE CHECKMARK. A row, not a switch: this is a one-off answer to
              one question, and a switch reads as a setting that persists
              something you can come back to. */}
          <TouchableOpacity
            onPress={() => { tapHaptic(); setNever((on) => !on); }}
            accessibilityRole="checkbox"
            accessibilityLabel={ASK_NEVER}
            accessibilityState={{ checked: never }}
            testID="photo-access-never"
            style={styles.neverRow}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <View style={[
              styles.box,
              { borderColor: never ? c.accent : c.border, backgroundColor: never ? c.accent : 'transparent' },
            ]}
            >
              {never && <Icon name="check" size={14} color={inkOn(c.accent)} />}
            </View>
            <Text style={[styles.neverText, { color: c.textSecondary }]}>{ASK_NEVER}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => answer(true)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={ASK_ALLOW}
            testID="photo-access-allow"
            style={[styles.action, { backgroundColor: c.accent }]}
          >
            <Text style={[styles.actionText, { color: inkOn(c.accent) }]}>{ASK_ALLOW}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => answer(false)}
            hitSlop={{ top: 10, bottom: 10, left: 16, right: 16 }}
            accessibilityRole="button"
            accessibilityLabel={ASK_DECLINE}
            testID="photo-access-decline"
            style={styles.dismiss}
          >
            <Text style={[styles.dismissText, { color: c.textSecondary }]}>{ASK_DECLINE}</Text>
          </TouchableOpacity>
          <Text style={[styles.note, { color: c.textTertiary }]}>{ASK_NOTE}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
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
  neverRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    alignSelf: 'center', marginTop: 18,
  },
  box: {
    width: 20, height: 20, borderRadius: 6, borderCurve: 'continuous',
    borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
  },
  neverText: { fontSize: 13.5, fontWeight: '600' },
  // THE button: full width, so there is no question which one is the answer.
  action: {
    alignSelf: 'stretch', height: 48, borderRadius: 14, borderCurve: 'continuous',
    alignItems: 'center', justifyContent: 'center', marginTop: 16,
  },
  actionText: { fontSize: 15.5, fontWeight: '800' },
  dismiss: { paddingTop: 14, paddingBottom: 2 },
  dismissText: { fontSize: 14, fontWeight: '600' },
  note: { fontSize: 11.5, lineHeight: 16, textAlign: 'center', marginTop: 4 },
});
