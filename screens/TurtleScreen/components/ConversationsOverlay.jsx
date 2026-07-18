import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
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

// Instagram-style collage avatar: a board with photos shows up to 4 of its
// most recent thumbnails packed into the 44px disc (1 = full, 2 = side-by-side
// columns, 3 = big left + two stacked right, 4 = 2×2 grid). Boards without
// photos keep the tinted-initial disc. Thumbs hydrate lazily AFTER the names
// list renders, so this only ever upgrades a row in place.
const AVATAR_SIZE = 44;
const AvatarCell = ({ uri, style, onError }) => (
  <Image
    source={{ uri }}
    style={style}
    contentFit="cover"
    transition={150}
    recyclingKey={uri}
    cachePolicy="memory-disk"
    onError={onError}
  />
);
const BoardAvatar = React.memo(function BoardAvatar({ name, thumbs, base, tint }) {
  // Thumbs whose fetch failed (deleted media, missing file) drop out so the
  // collage degrades naturally — 4 cells → 3-cell layout → … → initial disc —
  // instead of rendering blank squares.
  const [failed, setFailed] = useState(() => new Set());
  const markFailed = (u) => setFailed((prev) => (prev.has(u) ? prev : new Set(prev).add(u)));
  const urls = (thumbs || [])
    .map((t) => (typeof t === 'string' && t ? (t.startsWith('http') ? t : base + t) : null))
    .filter(Boolean)
    .filter((u) => !failed.has(u))
    .slice(0, 4);
  if (!urls.length) {
    return (
      <View style={{
        width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: tint + '2A',
      }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: tint }}>
          {name.charAt(0).toUpperCase()}
        </Text>
      </View>
    );
  }
  const cell = (i, style) => (
    <AvatarCell uri={urls[i]} style={style} onError={() => markFailed(urls[i])} />
  );
  return (
    <View style={{
      width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2,
      overflow: 'hidden', flexDirection: 'row',
      backgroundColor: tint + '2A',
    }}>
      {urls.length === 1 && cell(0, { flex: 1 })}
      {urls.length === 2 && (
        <>
          {cell(0, { flex: 1, marginRight: 0.5 })}
          {cell(1, { flex: 1, marginLeft: 0.5 })}
        </>
      )}
      {urls.length === 3 && (
        <>
          {cell(0, { flex: 1, marginRight: 0.5 })}
          <View style={{ flex: 1, marginLeft: 0.5 }}>
            {cell(1, { flex: 1, marginBottom: 0.5 })}
            {cell(2, { flex: 1, marginTop: 0.5 })}
          </View>
        </>
      )}
      {urls.length === 4 && (
        <>
          <View style={{ flex: 1, marginRight: 0.5 }}>
            {cell(0, { flex: 1, marginBottom: 0.5 })}
            {cell(2, { flex: 1, marginTop: 0.5 })}
          </View>
          <View style={{ flex: 1, marginLeft: 0.5 }}>
            {cell(1, { flex: 1, marginBottom: 0.5 })}
            {cell(3, { flex: 1, marginTop: 0.5 })}
          </View>
        </>
      )}
    </View>
  );
});

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
  const { api, getBaseUrl, getMediaBaseUrl } = useServer();
  // Same origin selection as MediaGallery's getFullUrl: prefer the HTTP/2
  // media origin when the probe succeeded (shared expo-image cache, faster
  // multiplexed loads), fall back to the http origin. thumbnailUrl paths
  // already start with /api/, so strip the base's own /api suffix.
  const mediaBase = (getMediaBaseUrl ? getMediaBaseUrl() : getBaseUrl()).replace(/\/api$/, '');

  // Rows are { name, lastTs, latest } — latest/lastTs null when only the plain
  // names list was available (fast path / fallback).
  const [boards, setBoards] = useState([]);
  // { [boardName]: [thumbnailUrl, ...] } — lazily hydrated collage avatars.
  const [avatars, setAvatars] = useState({});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // True when BOTH tiers failed while we had nothing to show — drives the
  // "couldn't reach the server" + Retry state instead of the misleading
  // "No boards yet" empty state.
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [openBoard, setOpenBoard] = useState(null);

  // Instagram-style loading: the names list is INSTANT, everything else
  // hydrates in place. Three tiers —
  //   0. stale-while-revalidate: whatever list we already have stays visible;
  //   1. GET /projects (cheap names query) paints rows within ~1 round-trip;
  //   2. GET /projects-overview (latest item per board, the expensive merge)
  //      replaces the list with previews + activity ordering when it lands.
  // A generation counter + an overview-applied flag keep the merges ordered:
  // a slow names response can never overwrite a newer overview.
  const loadGen = useRef(0);
  const boardsLenRef = useRef(0);
  boardsLenRef.current = boards.length;

  const load = useCallback(async ({ isRefresh } = {}) => {
    const gen = ++loadGen.current;
    let overviewApplied = false;
    isRefresh ? setRefreshing(true) : setLoading(true);

    // Tier 1 — instant names (only fills an EMPTY list; never downgrades
    // previews already on screen).
    if (boardsLenRef.current === 0) {
      api.get('/projects').then((r) => {
        if (gen !== loadGen.current || overviewApplied) return;
        const names = (Array.isArray(r) ? r : [])
          .filter((n) => typeof n === 'string' && n.trim())
          .sort((a, b) => a.localeCompare(b));
        if (names.length) {
          setBoards((prev) => (prev.length ? prev : names.map((name) => ({ name, lastTs: 0, latest: null }))));
          setLoadFailed(false);
          setLoading(false);
        }
      }).catch(() => { /* overview below is the authoritative path */ });
    }

    // Tier 3 — lazy avatar hydration, riding the same trigger as the list
    // (open / pull-to-refresh / board-close) so collages track renames,
    // deletions, and new photos. Non-blocking; failure keeps initial discs.
    api.get('/boards/avatars')
      .then((r) => { if (gen === loadGen.current && r?.success && r.avatars) setAvatars(r.avatars); })
      .catch(() => { /* initial discs stay */ });

    // Tier 2 — the full inbox (own + shared boards, latest item per board,
    // sorted by most recent activity).
    try {
      const r = await api.get('/projects-overview');
      if (gen !== loadGen.current) return;
      if (r?.success && Array.isArray(r.boards)) {
        overviewApplied = true;
        setBoards(r.boards.map((b) => ({ name: b.name, lastTs: b.lastTs || 0, latest: b.latest || null })));
        setLoadFailed(false);
      }
    } catch {
      // The names tier (or the previous list) stays on screen when we have
      // one; with NOTHING on screen this is a real failure — say so instead
      // of pretending the user has no boards.
      if (gen === loadGen.current && boardsLenRef.current === 0) setLoadFailed(true);
    } finally {
      if (gen === loadGen.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [api]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  // A different server is a different pond — the tier-0 stale cache must not
  // carry across origins. Wipe it and orphan any in-flight old-server fetches.
  const prevOriginRef = useRef(mediaBase);
  useEffect(() => {
    if (prevOriginRef.current === mediaBase) return;
    prevOriginRef.current = mediaBase;
    loadGen.current += 1;
    setBoards([]);
    setAvatars({});
    if (visible) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaBase]);

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
        <BoardAvatar name={item.name} thumbs={avatars[item.name]} base={mediaBase} tint={tint} />
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
  }, [c, avatars, mediaBase]);

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
