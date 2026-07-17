import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { useServer } from '../../../context/ServerContext';
import { tapHaptic } from '../../../utils/haptics';
import EdgeSwipePage from './EdgeSwipePage';
import BoardTimeline from './BoardTimeline';

// "Conversation boards" (Phases 1+3): a messenger-style inbox of the user's
// boards — each row shows the board's latest activity as a preview line, and
// opens into that board's conversation (BoardTimeline: merged feed + board-
// scoped chat). An overlay reached from a Turtle header icon (mirrors the
// Friends page), not a tab-landing restructure — that promotion comes later
// once it's proven.

// Stable per-name colour for the leading disc (hash name → hue), matching the
// calendar's owner-colour convention so a board reads the same tint everywhere.
const boardColor = (name) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h}, 55%, 55%)`;
};

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

export default function ConversationsOverlay({ visible, onClose }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { api } = useServer();

  // Rows are { name, lastTs, latest } — latest/lastTs null when only the plain
  // names list was available (fallback path).
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [openBoard, setOpenBoard] = useState(null);

  const load = useCallback(async ({ isRefresh } = {}) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      // The overview endpoint is the inbox: every visible board (own + shared
      // with the caller — same isolation as /projects) with its latest item for
      // the preview line, already sorted by most recent activity.
      const r = await api.get('/projects-overview');
      if (r?.success && Array.isArray(r.boards)) {
        setBoards(r.boards.map((b) => ({ name: b.name, lastTs: b.lastTs || 0, latest: b.latest || null })));
      } else {
        throw new Error('no overview');
      }
    } catch {
      // Older server: fall back to the plain names list so the inbox still opens.
      try {
        const r = await api.get('/projects');
        const names = (Array.isArray(r) ? r : [])
          .filter((n) => typeof n === 'string' && n.trim())
          .sort((a, b) => a.localeCompare(b));
        setBoards(names.map((name) => ({ name, lastTs: 0, latest: null })));
      } catch {
        setBoards([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? boards.filter((b) => b.name.toLowerCase().includes(q)) : boards;
  }, [boards, query]);

  const renderItem = useCallback(({ item }) => {
    const tint = boardColor(item.name);
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => { tapHaptic(); setOpenBoard(item.name); }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.name} board`}
      >
        <View style={{
          width: 44, height: 44, borderRadius: 22,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: tint + '2A',
        }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: tint }}>
            {item.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: c.textPrimary }} numberOfLines={1}>{item.name}</Text>
          <Text style={{ fontSize: 13, color: c.textTertiary, marginTop: 1 }} numberOfLines={1}>
            {item.latest ? previewOf(item.latest) : 'Board conversation'}
          </Text>
        </View>
        {item.lastTs ? (
          <Text style={{ fontSize: 12, color: c.textTertiary }}>{timeAgo(item.lastTs)}</Text>
        ) : (
          <Icon name="chevron-right" size={22} color={c.textTertiary} />
        )}
      </TouchableOpacity>
    );
  }, [c]);

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

        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={c.textSecondary} />
          </View>
        ) : filtered.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
            <Icon name="forum-outline" size={40} color={c.textTertiary} />
            <Text style={{ color: c.textSecondary, marginTop: 12, textAlign: 'center' }}>
              {query ? 'No boards match your search.' : 'No boards yet — create one from Tasks.'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            renderItem={renderItem}
            keyExtractor={(b) => b.name}
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            ItemSeparatorComponent={() => (
              <View style={{ height: 1, backgroundColor: c.border, marginLeft: 72 }} />
            )}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => load({ isRefresh: true })} tintColor={c.textSecondary} />
            }
          />
        )}

        {/* Board conversation — nested overlay so it stacks over this page on
            iOS. Closing it refreshes the inbox so the preview/time reflect the
            messages just sent. */}
        <BoardTimeline
          visible={!!openBoard}
          board={openBoard}
          onClose={() => { setOpenBoard(null); load({ isRefresh: true }); }}
        />
      </View>
    </EdgeSwipePage>
  );
}
