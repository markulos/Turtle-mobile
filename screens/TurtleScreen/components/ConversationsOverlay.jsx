import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { tapHaptic } from '../../../utils/haptics';
import EdgeSwipePage from './EdgeSwipePage';
import { TAP_ONLY } from '../../../utils/pressBehavior';
import BoardTimeline from './BoardTimeline';
import BoardAvatar from './BoardAvatar';
import useBoardsOverview from '../hooks/useBoardsOverview';

// "Conversation boards" (Phases 1+3): a messenger-style inbox of the user's
// boards — each row shows the board's latest activity as a preview line, and
// opens into that board's conversation (BoardTimeline: merged feed + board-
// scoped chat). An overlay reached from a Turtle header icon (mirrors the
// Friends page), not a tab-landing restructure — that promotion comes later
// once it's proven.
//
// The disc, the per-name colour and the tiered load are all shared with the
// boards canvas (BoardsCanvas), which shows this same list as a map instead of
// a list — see BoardAvatar and useBoardsOverview.

const oneLine = (s, n = 64) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

// Messenger-style preview line from a board's single latest item (shape comes
// from GET /projects-overview → boardTimelineItems).
const previewOf = (latest) => {
  if (!latest) return 'No activity yet';
  if (latest.kind === 'chat') {
    return `${latest.role === 'assistant' ? 'Turtle: ' : ''}${oneLine(latest.content)}`;
  }
  if (latest.kind === 'task') return `Task · ${oneLine(latest.title)}${latest.completed ? ' ✓' : ''}`;
  if (latest.kind === 'note') return `${latest.noteType === 'todo' ? 'To-do' : 'Note'} · ${oneLine(latest.content)}`;
  if (latest.kind === 'media') return `Photo · ${oneLine(latest.name || latest.mediaType || '')}`;
  return oneLine(latest.title || latest.content || '');
};

// Relative last-activity stamp for the row's trailing edge.
const timeAgo = (ts) => {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 0) return 'soon';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export default function ConversationsOverlay({ visible, onClose, onOpenClaude }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  // Rows are { name, lastTs, latest, counts, total } — everything but `name` is
  // null while only the plain names list has landed (fast path / fallback).
  const {
    boards, avatars, mediaBase, loading, refreshing, loadFailed, load,
  } = useBoardsOverview(visible);
  const [query, setQuery] = useState('');
  const [openBoard, setOpenBoard] = useState(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? boards.filter((b) => b.name.toLowerCase().includes(q)) : boards;
  }, [boards, query]);

  // Row styles hoisted out of renderItem — the inbox can hold dozens of board
  // rows, and the old inline objects re-allocated five styles per row per
  // render. Theme-keyed; per-row values (avatar tint) stay put as props.
  const rowStyles = useMemo(() => StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
    body: { flex: 1 },
    name: { fontSize: 16, fontWeight: '600', color: c.textPrimary },
    preview: { fontSize: 13, color: c.textTertiary, marginTop: 1 },
    stamp: { fontSize: 12, color: c.textTertiary },
  }), [c]);

  const renderItem = useCallback(({ item }) => {
    return (
      <TouchableOpacity
        {...TAP_ONLY}
        activeOpacity={0.7}
        onPress={() => { tapHaptic(); setOpenBoard(item.name); }}
        style={rowStyles.row}
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.name} board`}
      >
        <BoardAvatar name={item.name} thumbs={avatars[item.name]} base={mediaBase} />
        <View style={rowStyles.body}>
          <Text style={rowStyles.name} numberOfLines={1}>{item.name}</Text>
          <Text style={rowStyles.preview} numberOfLines={1}>
            {item.latest ? previewOf(item.latest) : 'Board conversation'}
          </Text>
        </View>
        {item.lastTs ? (
          <Text style={rowStyles.stamp}>{timeAgo(item.lastTs)}</Text>
        ) : (
          <Icon name="chevron-right" size={22} color={c.textTertiary} />
        )}
      </TouchableOpacity>
    );
  }, [c, rowStyles, avatars, mediaBase]);

  return (
    <EdgeSwipePage visible={visible} onClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.background }}>
        {/* Header — back chevron + title, matching the Friends page chrome. */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 6,
          paddingTop: insets.top + 6, paddingBottom: 10, paddingHorizontal: 10,
        }}>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
            accessibilityLabel="Back"
            accessibilityRole="button"
          >
            <Icon name="chevron-left" size={28} color={c.textPrimary} />
          </TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: '700', color: c.textPrimary }}>Conversations</Text>
        </View>

        {/* Search */}
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingHorizontal: 14, height: 46, borderRadius: 14,
            backgroundColor: c.surfaceElevated,
            borderWidth: 1.5, borderColor: c.accentInfo + '55',
          }}>
            <Icon name="magnify" size={20} color={c.accentInfo} />
            <TextInput
              style={{ flex: 1, fontSize: 16, color: c.textPrimary, paddingVertical: 0 }}
              placeholder="Search boards"
              placeholderTextColor={c.textTertiary}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close-circle" size={18} color={c.textTertiary} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {loading && boards.length === 0 ? (
          // Spinner ONLY when we have nothing at all — once any list (names
          // fast-path or a previous open) is on screen, refreshes happen
          // behind it without blanking the inbox.
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={c.textSecondary} />
          </View>
        ) : filtered.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
            <Icon name={loadFailed ? 'wifi-off' : 'forum-outline'} size={40} color={c.textTertiary} />
            <Text style={{ color: c.textSecondary, marginTop: 12, textAlign: 'center' }}>
              {loadFailed
                ? "Couldn't reach the server."
                : query ? 'No boards match your search.' : 'No boards yet — create one from Tasks.'}
            </Text>
            {loadFailed && (
              <TouchableOpacity
                onPress={() => { tapHaptic(); load(); }}
                style={{
                  marginTop: 16, paddingHorizontal: 20, paddingVertical: 9,
                  borderRadius: 10, backgroundColor: c.surfaceElevated,
                  borderWidth: 1, borderColor: c.border,
                }}
                accessibilityRole="button"
                accessibilityLabel="Retry loading boards"
              >
                <Text style={{ color: c.textPrimary, fontWeight: '600' }}>Retry</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <FlatList
            data={filtered}
            renderItem={renderItem}
            keyExtractor={(b) => b.name}
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            // This list lives inside EdgeSwipePage — a transparent Modal whose
            // content sits in a translateX'd Animated.View. iOS lays the scroll
            // indicator out against the untransformed frame, so it drifted in
            // from the right edge and read as floating mid-list. An explicit
            // indicator inset pins it back to the trailing edge.
            showsVerticalScrollIndicator
            scrollIndicatorInsets={{ right: 1, top: 0, bottom: insets.bottom }}
            indicatorStyle={theme.mode === 'dark' ? 'white' : 'black'}
            ItemSeparatorComponent={() => (
              <View style={{ height: 1, backgroundColor: c.border, marginLeft: 72 }} />
            )}
            ListHeaderComponent={
              // Dedicated Claude session — pinned at the top of the inbox (only
              // when not searching). Opens the Claude coding session in the
              // main chat via the parent's onOpenClaude.
              !query.trim() && onOpenClaude ? (
                <View>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => { tapHaptic(); onOpenClaude(); }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}
                    accessibilityRole="button"
                    accessibilityLabel="Open Claude session"
                  >
                    <View style={{
                      width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: (c.accentWarning || '#FACC15') + '2A',
                    }}>
                      <Icon name="robot-outline" size={22} color={c.accentWarning || '#CA8A04'} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: '700', color: c.textPrimary }} numberOfLines={1}>Claude</Text>
                      <Text style={{ fontSize: 13, color: c.textTertiary, marginTop: 1 }} numberOfLines={1}>
                        AI coding session
                      </Text>
                    </View>
                    <Icon name="chevron-right" size={22} color={c.textTertiary} />
                  </TouchableOpacity>
                  <View style={{ height: 1, backgroundColor: c.border, marginLeft: 72 }} />
                </View>
              ) : null
            }
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => load({ isRefresh: true })} tintColor={c.textSecondary} />
            }
          />
        )}

        {/* Board conversation — nested overlay so it stacks over this page on
            iOS. Closing it refreshes the inbox ONLY when the visit actually
            sent something (didActivity), so a silent back-out doesn't cost a
            full overview scan. */}
        <BoardTimeline
          visible={!!openBoard}
          board={openBoard}
          onClose={(didActivity) => { setOpenBoard(null); if (didActivity) load({ isRefresh: true }); }}
        />
      </View>
    </EdgeSwipePage>
  );
}
