/**
 * SendInTurtleSheet — "send these to somebody in the pond".
 *
 * ─── Why this exists ───────────────────────────────────────────────────────
 *
 * Sharing a photo from the vault meant the OS share sheet, which is the right
 * answer for anyone OUTSIDE Turtle and an absurd one for the people already in
 * it: the photo is downloaded out of the pond to a cache file, handed to
 * another app, uploaded again, and arrives for somebody whose copy of it is
 * sitting in the same pond it just left.
 *
 * Sending it as a message is none of that. A message carries VAULT MEDIA IDS
 * (see utils/messageAttachments), and a selected gallery item already IS one —
 * so this is a POST and nothing else. No download, no upload, no second copy,
 * and it works on a phone with no signal to spare.
 *
 * ─── What it is, and is not ────────────────────────────────────────────────
 *
 * Presentational: it lists the people it was handed and reports who was
 * chosen. The posting lives with the gallery, which owns the selection and the
 * api. It does not offer a message to type — sending a photo with a note
 * attached is the conversation's job, and this is the one-tap version. The
 * thread is where you say something about it.
 *
 * An in-tree absolute overlay in the app's top zIndex band, NOT a Modal: it
 * opens over the viewer (itself a Modal) and the selection bar, and iOS drops
 * a sibling Modal presented over an open one. STYLE-RULES §4.
 */
import React, { useCallback, useEffect, useMemo } from 'react';
import {
  ActivityIndicator, BackHandler, FlatList, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AnimalAvatar from '../../../components/AnimalAvatar';
import { tapHaptic } from '../../../utils/haptics';
import { TAP_ONLY } from '../../../utils/pressBehavior';
import { MAX_MESSAGE_ATTACHMENTS } from '../../../utils/messageAttachments';

/**
 * How many messages `count` photos will arrive as.
 *
 * A message holds six. Seven photos are therefore two messages, and the sheet
 * says so rather than letting six arrive and one go missing — which is what a
 * silent cap looks like from the other end of the conversation.
 */
export function sendPlan(count) {
  const n = Math.max(0, Number(count) || 0);
  const messages = Math.ceil(n / MAX_MESSAGE_ATTACHMENTS) || 0;
  return { count: n, messages };
}

/** "3 photos" / "7 photos, as 2 messages". */
export function sendSummary(count) {
  const { count: n, messages } = sendPlan(count);
  const photos = n === 1 ? '1 photo' : `${n} photos`;
  return messages > 1 ? `${photos}, as ${messages} messages` : photos;
}

function PersonRow({ person, busy, onPress, theme }) {
  const c = theme.colors;
  return (
    <Pressable
      {...TAP_ONLY}
      disabled={busy}
      onPressIn={() => tapHaptic()}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Send to ${person.name || 'them'}`}
      accessibilityState={{ disabled: !!busy }}
      testID={`send-in-turtle-${person.userId}`}
      style={({ pressed }) => [styles.row, (pressed || busy) && styles.rowDim]}
    >
      <AnimalAvatar id={person.userId} size={38} fallbackLabel={person.name} />
      <Text style={[styles.rowName, { color: c.textPrimary }]} numberOfLines={1}>
        {person.name || 'Someone'}
      </Text>
      {busy
        ? <ActivityIndicator size="small" color={c.textMuted} />
        : <Icon name="send" size={18} color={c.accentInfo || c.primary} />}
    </Pressable>
  );
}

export default function SendInTurtleSheet({
  visible, people = [], count = 0, busyFor = null, onClose, onSend, bottomInset = 0, theme,
}) {
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const summary = useMemo(() => sendSummary(count), [count]);

  // Android back closes the sheet, not whatever raised it.
  useEffect(() => {
    if (!visible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose?.(); return true; });
    return () => sub.remove();
  }, [visible, onClose]);

  const pick = useCallback((person) => {
    if (busyFor) return;
    onSend?.(person);
  }, [busyFor, onSend]);

  if (!visible) return null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]} pointerEvents="box-none" testID="send-in-turtle">
      <Pressable
        style={[StyleSheet.absoluteFill, styles.scrim]}
        accessibilityLabel="Close"
        onPress={onClose}
      />
      <View
        style={[styles.sheet, {
          backgroundColor: c.surfaceElevated,
          borderColor: c.border,
          paddingBottom: Math.max(insets.bottom, bottomInset) + 10,
        }]}
      >
        <View style={styles.grabWrap}><View style={[styles.grab, { backgroundColor: c.border }]} /></View>

        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={1}>Send in Turtle</Text>
            {/* Says how it will ARRIVE, not just how much was picked: six to a
                message is the protocol's limit, and a cap nobody mentions is
                how photos go missing between two people. */}
            <Text style={[styles.subtitle, { color: c.textTertiary }]} numberOfLines={1}>{summary}</Text>
          </View>
        </View>

        <FlatList
          data={people}
          keyExtractor={(p) => p.userId}
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.border }]} />}
          ListEmptyComponent={(
            <Text style={[styles.empty, { color: c.textTertiary }]}>
              Nobody else is in this pond yet. Invite someone from the People tab.
            </Text>
          )}
          renderItem={({ item }) => (
            <PersonRow
              person={item}
              busy={busyFor === item.userId}
              onPress={() => pick(item)}
              theme={theme}
            />
          )}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The app's top band — it opens over the viewer, which is itself a Modal.
  layer: { zIndex: 1000 },
  scrim: { backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '68%',
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
  },
  grabWrap: { alignItems: 'center', paddingVertical: 8 },
  grab: { width: 38, height: 4, borderRadius: 2 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 8 },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, fontWeight: '700' },
  subtitle: { fontSize: 12, marginTop: 1 },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowDim: { opacity: 0.6 },
  rowName: { flex: 1, minWidth: 0, fontSize: 15.5, fontWeight: '600' },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 50, opacity: 0.6 },
  empty: { fontSize: 13, paddingVertical: 20, textAlign: 'center' },
});
