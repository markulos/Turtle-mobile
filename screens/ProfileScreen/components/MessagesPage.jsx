/**
 * MessagesPage — every conversation you have, in one list.
 *
 * ─── The door that was missing ─────────────────────────────────────────────
 *
 * The phone could open a THREAD and had no way to find one. A direct message
 * was reachable from a push notification, or from a row of the Friends
 * LEADERBOARD — a scoreboard that happens to list people. If nobody had
 * written to you lately there was no door at all, and "who has messaged me"
 * was a question the app could not answer.
 *
 * `GET /api/messages` has answered it the whole time: one grouped query for
 * the last message of every conversation and how many are unread. Nothing in
 * the app called it until now.
 *
 * ─── What it does NOT do ───────────────────────────────────────────────────
 *
 * It does not mark anything read: opening the thread does that, server-side,
 * and the thread already tells us how many it cleared. So this list refetches
 * when it comes back rather than keeping its own idea of what has been seen —
 * two places deciding what "unread" means is how a badge gets stuck on.
 *
 * It is an in-tree `EdgeSwipePage overlay` like every other pushed page on
 * this screen, mounted as a SIBLING of FriendChatPage so the chat draws over
 * it (last sibling wins), exactly as FriendsPage does.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View,
} from 'react-native';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import EdgeSwipePage from '../../TurtleScreen/components/EdgeSwipePage';
import AnimalAvatar from '../../../components/AnimalAvatar';
import { resolveAvatarUrl } from '../../../utils/avatarUrl';
import DirectMessageIcon from '../../../components/DirectMessageIcon';
import { dockOccupied } from '../../../components/tabBarLayout';
import { tapHaptic } from '../../../utils/haptics';
import { TAP_ONLY } from '../../../utils/pressBehavior';
import { insetRule } from '../../../utils/surfaceDepth';
import { useServer } from '../../../context/ServerContext';
import { useSyncSignals } from '../../../context/DownloadsContext';
import usePondPeople from '../../../utils/usePondPeople';
import { messagePreviewLine } from '../../../utils/messageAttachments';
import { threadRows, threadWhen } from '../../../utils/messageThreads';
import { SCROLL_INDICATOR } from '../../../utils/scrollIndicator';

function ThreadRow({ row, theme, onPress, baseUrl }) {
  const c = theme.colors;
  const unread = row.unread > 0;
  const preview = messagePreviewLine(row.last);
  // The row has carried the photo all along (threadRows reads it off the pond
  // roster, and `open` below hands it to the thread) — the list just never
  // drew it, so the inbox showed generated animals for people whose own
  // picture appears the moment you open the conversation.
  const photo = resolveAvatarUrl(row.avatarUrl, baseUrl);
  return (
    <Pressable
      {...TAP_ONLY}
      onPressIn={() => tapHaptic()}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={unread
        ? `${row.name}, ${row.unread} unread. ${preview}`
        : `${row.name}. ${preview}`}
      testID={`thread-row-${row.userId}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {/* The generated disc is UNDER the photo, not instead of it: a picture
          still loading, or one that fails, shows a face rather than a hole.
          Same layering as FaceStack, which is where this pattern lives. */}
      <View style={styles.avatar}>
        <AnimalAvatar id={row.userId} size={44} fallbackLabel={row.name} />
        {photo ? (
          <Image
            testID={`thread-avatar-${row.userId}`}
            source={{ uri: photo }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            transition={120}
            recyclingKey={`thread-face:${photo}`}
          />
        ) : null}
      </View>
      <View style={styles.rowText}>
        <View style={styles.rowTop}>
          <Text
            style={[styles.name, { color: c.textPrimary }, unread && styles.nameUnread]}
            numberOfLines={1}
          >
            {row.name}
          </Text>
          <Text style={[styles.when, { color: c.textTertiary }]} numberOfLines={1}>
            {threadWhen(row.at)}
          </Text>
        </View>
        <View style={styles.rowBottom}>
          {/* The last line of the conversation, whoever said it. "You: " is
              the difference between "they are waiting on me" and "I am waiting
              on them", which is most of what an inbox is read for. */}
          <Text
            style={[styles.preview, { color: unread ? c.textSecondary : c.textTertiary }, unread && styles.previewUnread]}
            numberOfLines={1}
          >
            {row.last?.mine ? `You: ${preview}` : preview}
          </Text>
          {unread && (
            <View style={[styles.dot, { backgroundColor: c.accent || c.accentInfo }]} testID={`thread-unread-${row.userId}`} />
          )}
        </View>
      </View>
    </Pressable>
  );
}

export default function MessagesPage({ visible, onClose, onOpenThread, theme, insets }) {
  const c = theme.colors;
  const { api, getBaseUrl } = useServer();
  // Where a relative avatar path hangs off. The pond answers on several names
  // (a LAN ip, a Tailscale name, app.t3d.ca), so the origin is whichever one
  // we are actually talking to — see resolveAvatarUrl.
  const base = getBaseUrl?.();
  const people = usePondPeople();
  const { messagesVersion } = useSyncSignals();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const rows = useMemo(() => threadRows(payload, people), [payload, people]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const res = await api.get('/messages');
      setPayload(res && res.success ? res : { threads: [] });
      setError(null);
    } catch (e) {
      setError(e?.message || 'Could not load your messages');
    } finally {
      setLoading(false);
    }
  }, [api]);

  // On OPEN, and again on every socket ping while it is up — the ping is
  // content-free by design (routes/messages.js), so the refetch IS the
  // delivery. Also covers coming back from a thread, which is when the unread
  // marks have just been cleared server-side.
  useEffect(() => { if (visible) load(); }, [visible, load]);
  useEffect(() => { if (visible && messagesVersion) load({ quiet: true }); }, [visible, messagesVersion, load]);

  const open = useCallback((row) => {
    onOpenThread?.({ id: row.userId, name: row.name, avatarUrl: row.avatarUrl });
  }, [onOpenThread]);

  return (
    <EdgeSwipePage overlay visible={visible} onClose={onClose}>
      <View style={[styles.page, { backgroundColor: c.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" testID="messages-back">
            <Icon name="chevron-left" size={28} color={c.textPrimary} />
          </Pressable>
          <Text style={[styles.title, { color: c.textPrimary }]}>Messages</Text>
          {loading && rows.length > 0 ? <ActivityIndicator size="small" color={c.textMuted} /> : null}
        </View>
        <View style={insetRule(theme)} />

        <FlatList {...SCROLL_INDICATOR}
          data={rows}
          keyExtractor={(r) => r.userId}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: dockOccupied(insets.bottom) + 24 },
            rows.length === 0 && styles.listEmpty,
          ]}
          ItemSeparatorComponent={() => <View style={[insetRule(theme), styles.sep]} />}
          refreshControl={
            <RefreshControl refreshing={loading && rows.length > 0} onRefresh={load} tintColor={c.textSecondary} />
          }
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator size="small" color={c.textMuted} style={styles.spinner} />
            ) : (
              <View style={styles.empty}>
                <DirectMessageIcon size={34} color={c.textMuted} />
                <Text style={[styles.emptyTitle, { color: c.textSecondary }]}>
                  {error ? 'Could not load your messages' : 'No conversations yet'}
                </Text>
                <Text style={[styles.emptyHint, { color: c.textTertiary }]}>
                  {error
                    ? 'Pull down to try again.'
                    : 'Open someone from Friends to start one, or send them a photo from the Photos tab.'}
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => (
            <ThreadRow row={item} theme={theme} onPress={() => open(item)} baseUrl={base} />
          )}
        />
      </View>
    </EdgeSwipePage>
  );
}

const styles = StyleSheet.create({
  // Clips the photo to the same disc the generated avatar draws, and gives
  // the two layers one box to share.
  avatar: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden' },
  page: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 10 },
  title: { flex: 1, fontSize: 17, fontWeight: '700' },
  list: { paddingTop: 4 },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  sep: { marginLeft: 72 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11 },
  pressed: { opacity: 0.6 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, minWidth: 0, fontSize: 15.5, fontWeight: '600' },
  nameUnread: { fontWeight: '800' },
  when: { fontSize: 11.5, flexShrink: 0, fontVariant: ['tabular-nums'] },
  preview: { flex: 1, minWidth: 0, fontSize: 13 },
  previewUnread: { fontWeight: '600' },
  dot: { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
  spinner: { marginTop: 24 },
  empty: { alignItems: 'center', gap: 8, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 15, fontWeight: '700' },
  emptyHint: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
});
