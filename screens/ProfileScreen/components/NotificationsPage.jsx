/**
 * NotificationsPage — what happened on your tasks while you were elsewhere.
 *
 * The pond has kept these all along (a row per comment on a task that is
 * yours, or that you have commented on) and the web app shows them. The phone
 * had no page for them at all, so the only trace of a comment was a push that
 * was gone once dismissed.
 *
 * ─── Opening it is reading it ──────────────────────────────────────────────
 *
 * There is no per-row "mark read": the list is short and the point of the
 * page is to look at it. So opening the page marks everything read on the
 * pond, and clears the count on the Profile tab at once (optimistic — the
 * dot is decoration, and the next sync corrects it if the write failed).
 *
 * The rows that WERE new keep their dot for as long as this visit lasts, so
 * you can still tell which ones you have not seen before.
 *
 * Tapping a row opens the task it is about, on the Tasks tab, through the
 * same OpenTarget channel a search hit uses.
 *
 * An in-tree `EdgeSwipePage overlay`, like every other pushed page here.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import EdgeSwipePage from '../../TurtleScreen/components/EdgeSwipePage';
import AnimalAvatar from '../../../components/AnimalAvatar';
import { dockOccupied } from '../../../components/tabBarLayout';
import { tapHaptic } from '../../../utils/haptics';
import { TAP_ONLY } from '../../../utils/pressBehavior';
import { insetRule } from '../../../utils/surfaceDepth';
import { useServer } from '../../../context/ServerContext';
import { threadWhen } from '../../../utils/messageThreads';
import { notificationLine, notificationRows, unreadNotifications } from '../../../utils/notificationRows';
import { requestAttentionRefresh, setAttention } from '../../../utils/attention';
import { SCROLL_INDICATOR } from '../../../utils/scrollIndicator';

function NotificationRow({ row, theme, onPress }) {
  const c = theme.colors;
  const line = notificationLine(row);
  const gone = !row.taskExists;
  return (
    <Pressable
      {...TAP_ONLY}
      onPressIn={() => { if (!gone) tapHaptic(); }}
      onPress={gone ? undefined : onPress}
      disabled={gone}
      accessibilityRole="button"
      accessibilityState={{ disabled: gone }}
      accessibilityLabel={`${row.unread ? 'New. ' : ''}${line}: ${row.title}.${row.preview ? ` ${row.preview}` : ''}`}
      testID={`notification-row-${row.id}`}
      style={({ pressed }) => [styles.row, pressed && !gone && styles.pressed]}
    >
      <AnimalAvatar id={row.actorId || row.id} size={44} fallbackLabel={row.actor || '?'} />
      <View style={styles.rowText}>
        <View style={styles.rowTop}>
          <Text
            style={[styles.line, { color: c.textPrimary }, row.unread && styles.lineUnread]}
            numberOfLines={1}
          >
            {line}
          </Text>
          <Text style={[styles.when, { color: c.textTertiary }]} numberOfLines={1}>
            {threadWhen(row.at)}
          </Text>
        </View>
        <View style={styles.rowBottom}>
          <Text
            style={[styles.title, { color: gone ? c.textTertiary : c.textSecondary }, gone && styles.gone]}
            numberOfLines={1}
          >
            {row.title}
          </Text>
          {row.unread && (
            <View style={[styles.dot, { backgroundColor: c.accent || c.accentInfo }]} testID={`notification-unread-${row.id}`} />
          )}
        </View>
        {row.preview ? (
          <Text style={[styles.preview, { color: c.textTertiary }]} numberOfLines={2}>
            {row.preview}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function NotificationsPage({ visible, onClose, onOpenTask, theme, insets }) {
  const c = theme.colors;
  const { api } = useServer();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const rows = useMemo(() => notificationRows(payload), [payload]);

  // Marked read once per load that found something new — not on every render.
  const marking = useRef(false);
  const markRead = useCallback(async (loaded) => {
    if (marking.current || unreadNotifications(loaded) === 0) return;
    marking.current = true;
    // The dot clears now; the pond hears about it behind that.
    setAttention({ notifications: 0 });
    try {
      // No ids: "everything of mine", which is what was just shown.
      await api.post('/notifications/read', {});
    } catch {
      // The write did not land, so the pond still counts them: ask for the
      // truth rather than leave the tab saying nothing is waiting.
      requestAttentionRefresh();
    } finally {
      marking.current = false;
    }
  }, [api]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const res = await api.get('/notifications');
      const next = res && res.success !== false ? res : { notifications: [] };
      setPayload(next);
      setError(null);
      markRead(notificationRows(next));
    } catch (e) {
      setError(e?.message || 'Could not load your notifications');
    } finally {
      setLoading(false);
    }
  }, [api, markRead]);

  // Every time it is opened — a page that loaded once would show yesterday's
  // list for the rest of the session.
  useEffect(() => { if (visible) load(); }, [visible, load]);

  const open = useCallback((row) => {
    if (!row.taskExists) return;
    onOpenTask?.({ id: row.taskId, title: row.title });
  }, [onOpenTask]);

  return (
    <EdgeSwipePage overlay visible={visible} onClose={onClose}>
      <View style={[styles.page, { backgroundColor: c.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" testID="notifications-back">
            <Icon name="chevron-left" size={28} color={c.textPrimary} />
          </Pressable>
          <Text style={[styles.heading, { color: c.textPrimary }]} numberOfLines={1}>Notifications</Text>
          {loading && rows.length > 0 ? <ActivityIndicator size="small" color={c.textMuted} /> : null}
        </View>
        <View style={insetRule(theme)} />

        <FlatList {...SCROLL_INDICATOR}
          data={rows}
          keyExtractor={(r) => r.id}
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
                <Icon name="bell-outline" size={34} color={c.textMuted} />
                <Text style={[styles.emptyTitle, { color: c.textSecondary }]}>
                  {error ? 'Could not load your notifications' : 'Nothing new'}
                </Text>
                <Text style={[styles.emptyHint, { color: c.textTertiary }]}>
                  {error
                    ? 'Pull down to try again.'
                    : 'When someone comments on one of your tasks, it shows up here.'}
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => (
            <NotificationRow row={item} theme={theme} onPress={() => open(item)} />
          )}
        />
      </View>
    </EdgeSwipePage>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 10 },
  heading: { flex: 1, minWidth: 0, fontSize: 17, fontWeight: '700' },
  list: { paddingTop: 4 },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  sep: { marginLeft: 72 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 11, minHeight: 66 },
  pressed: { opacity: 0.6 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  line: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '600' },
  lineUnread: { fontWeight: '800' },
  when: { fontSize: 11.5, flexShrink: 0, fontVariant: ['tabular-nums'] },
  title: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '600' },
  gone: { textDecorationLine: 'line-through', fontWeight: '400' },
  preview: { fontSize: 13, lineHeight: 18 },
  dot: { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
  spinner: { marginTop: 24 },
  empty: { alignItems: 'center', gap: 8, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 15, fontWeight: '700' },
  emptyHint: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
});
