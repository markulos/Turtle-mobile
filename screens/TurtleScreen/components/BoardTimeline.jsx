import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { useTheme } from '../../../context/ThemeContext';
import { useServer } from '../../../context/ServerContext';
import { tapHaptic } from '../../../utils/haptics';
import EdgeSwipePage from './EdgeSwipePage';
import ChatComposer, { ComposerAction } from '../../../components/ChatComposer';
import MediaLightbox from '../../../components/MediaLightbox';
import { TaskForm } from '../../TasksScreen/components/TaskForm';

// One board's CONVERSATION (conversation-boards Phase 3): the merged feed of
// everything on the board — tasks, events, notes, media (rendered as compact
// inline events) — interleaved with the board's chat, plus a composer that
// sends board-scoped messages (POST /turtle/chat with `board`; the server
// answers with Turtle AI given the board's items as context). Newest sits at
// the bottom like any messenger: the list is `inverted` over the API's
// newest-first pages, so scrolling up walks into older history. Still opened
// as a nested `overlay` EdgeSwipePage from the conversations list (a sibling
// Modal would silently not present on iOS — see the nested-modal gotcha).

const PAGE = 40;

// Per-kind leading glyph + accent, so a glance down the feed reads the mix of
// item types the way a messenger reads message kinds.
const KIND_META = {
  task:      { icon: 'check-circle-outline', tint: 'accentInfo' },
  event:     { icon: 'calendar-star',        tint: 'accentInfo' },
  birthday:  { icon: 'cake-variant',         tint: 'accentError' },
  note:      { icon: 'note-text-outline',    tint: 'accentWarning' },
  media:     { icon: 'image-outline',        tint: 'accentSuccess' },
  chat:      { icon: 'message-outline',      tint: 'textSecondary' },
  changelog: { icon: 'history',              tint: 'accentSuccess' },
};

// Relative "time-ago" for the row's trailing stamp — mirrors a messenger's
// last-activity label. Falls back to an absolute short date past a week.
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

export default function BoardTimeline({ visible, board, onClose }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { api, getBaseUrl, getMediaBaseUrl } = useServer();

  // Prefer the HTTP/2 media origin (shared expo-image cache) when the probe
  // landed; fall back to the http origin. Stored media paths are /api/-relative
  // (thumbnailUrl/rawUrl start with /api/), so strip the base's own /api suffix.
  const mediaBase = (getMediaBaseUrl ? getMediaBaseUrl() : getBaseUrl()).replace(/\/api$/, '');
  const getFullUrl = useCallback((p) => {
    if (!p) return null;
    return /^https?:/i.test(p) ? p : mediaBase + p;
  }, [mediaBase]);

  // Composer "＋ task" → the unified TaskForm, pre-associated with THIS board
  // (the callback itself is defined after `load`/`dirtyRef` below, so it can
  // depend on the CURRENT-board `load` rather than a stale first-render one).
  const [quickOpen, setQuickOpen] = useState(false);

  // TaskForm needs the full board list (its Board chip lets the user change
  // off the preset) + tag list, plus handlers for creating a brand-new board
  // or collecting brand-new tags typed inline. Loaded once on mount (see the
  // effect below) — cheap and avoids racing the composer's "+" tap.
  const [projects, setProjects] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const projectsLoadedRef = useRef(false);
  const loadProjectsAndTags = useCallback(async () => {
    if (projectsLoadedRef.current) return;
    projectsLoadedRef.current = true;
    try {
      const [projectsData, tagsData] = await Promise.all([api.get('/projects'), api.get('/tags')]);
      setProjects(Array.isArray(projectsData) ? projectsData : []);
      setAllTags(Array.isArray(tagsData) ? tagsData : []);
    } catch (e) {
      projectsLoadedRef.current = false; // fetch failed — allow a retry next open
    }
  }, [api]);

  // Kick the load off on MOUNT rather than on composer-open: BoardTimeline is
  // mounted once (as a sibling overlay under ConversationsOverlay) well before
  // any board is opened, so this has resolved long before the user ever taps
  // "+" — closing the race where TaskForm would briefly see `projects=[]` and
  // wrongly show "Will create new board" for a board that already exists
  // (which also fired a needless POST /projects/add on a fast save).
  // loadProjectsAndTags is itself guarded by projectsLoadedRef, so this is a
  // one-shot fetch regardless of remounts/re-renders.
  useEffect(() => { loadProjectsAndTags(); }, [loadProjectsAndTags]);

  // Optimistic-first (mirrors useTaskData's addProject): show the new board
  // immediately, persist in the background, reconcile/roll back on response.
  const addProjectFromBoard = useCallback(async (name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return false;
    const alreadyExists = projects.includes(trimmed);
    if (!alreadyExists) {
      setProjects((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed].sort((a, b) => a.localeCompare(b))));
    }
    try {
      const res = await api.post('/projects/add', { name: trimmed });
      if (res && Array.isArray(res.projects)) setProjects(res.projects);
      return true;
    } catch (e) {
      if (!alreadyExists) setProjects((prev) => prev.filter((p) => p !== trimmed));
      console.error('Failed to add board:', e);
      Alert.alert('Error', 'Failed to add board');
      return false;
    }
  }, [api, projects]);

  // Mirrors useTaskData's collectTags — persist newly-typed tags so they show
  // up as suggestions everywhere else too.
  const collectTagsFromBoard = useCallback(async (tagsArray) => {
    const newTags = (tagsArray || []).filter((t) => !allTags.includes(t));
    if (newTags.length === 0) return;
    try {
      await api.post('/tags/collect', { tags: newTags });
      setAllTags((prev) => [...prev, ...newTags].sort());
    } catch (e) { /* best-effort — tags still saved on the task itself */ }
  }, [api, allTags]);

  // Tapped chat image/video → full-screen lightbox. { uri, isVideo } | null.
  const [lightbox, setLightbox] = useState(null);
  const openLightbox = useCallback((item) => {
    // Full-res raw for the viewer (the row itself shows the thumbnail).
    const uri = getFullUrl(item.rawUrl || item.thumbnailUrl);
    if (!uri) return;
    tapHaptic();
    setLightbox({ uri, isVideo: !!(item.mediaType && item.mediaType !== 'image') });
  }, [getFullUrl]);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextBefore, setNextBefore] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // Guards a stale response from a previously-open board writing into the list
  // after the user has already switched to another (each open bumps the token).
  const reqToken = useRef(0);

  const load = useCallback(async (before) => {
    if (!board) return;
    const token = ++reqToken.current;
    const isFirst = before == null;
    isFirst ? setLoading(true) : setLoadingMore(true);
    setError(null);
    try {
      const qs = `limit=${PAGE}${before != null ? `&before=${before}` : ''}`;
      const r = await api.get(`/boards/${encodeURIComponent(board)}/timeline?${qs}`);
      if (token !== reqToken.current) return; // superseded — drop
      const rows = Array.isArray(r?.items) ? r.items : [];
      // Keep optimistic local rows (still sending / failed) across a refresh;
      // server pages replace only the persisted portion.
      setItems((prev) => (isFirst ? [...prev.filter((it) => it.local), ...rows] : [...prev, ...rows]));
      setNextBefore(r?.nextBefore ?? null);
    } catch (e) {
      if (token !== reqToken.current) return;
      setError(e?.message || 'Could not load this board.');
      if (isFirst) setItems([]);
    } finally {
      if (token === reqToken.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [api, board]);

  // Tracks whether THIS open produced server-side activity (a chat send) —
  // the inbox only needs its expensive overview refresh when something
  // actually changed; a silent back-out shouldn't cost a full board scan.
  const dirtyRef = useRef(false);

  // (Re)load whenever the page opens onto a board. Clearing here (not on close)
  // keeps the previous board's rows from flashing under the new title.
  useEffect(() => {
    if (visible && board) {
      dirtyRef.current = false;
      setItems([]);
      setNextBefore(null);
      setDraft('');
      load(null);
    }
  }, [visible, board, load]);

  // Persist a task created from THIS board's composer via POST /tasks/single
  // (the whole-list POST the Tasks screen uses isn't reachable here), then
  // refresh the feed so it shows inline. Deps include `load` so it always calls
  // the CURRENT board's loader — not a stale first-render one (board was null
  // then, which would no-op the refresh and invite duplicate taps).
  const createTaskFromBoard = useCallback(async (finalTask) => {
    try {
      await api.post('/tasks/single', finalTask);
      dirtyRef.current = true; // the inbox overview should re-count on close
      load(null);              // pull the new task into the merged feed
    } catch (e) {
      // Non-fatal: the composer already closed optimistically. Surface nothing
      // louder than a console note — the user can retry from the Tasks tab.
      console.warn('Board quick-task create failed:', e?.message || e);
    }
  }, [api, load]);

  // The last few chat turns (oldest→newest), handed to the AI as conversation
  // history so the board thread stays coherent turn to turn.
  const recentChatHistory = useMemo(() => (
    items
      .filter((it) => it.kind === 'chat' && !it.failed && (it.content || it.title))
      .slice(0, 10)
      .reverse()
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || m.title }))
  ), [items]);

  // Optimistic board-scoped send: the bubble lands NOW, the POST rides in the
  // background, and a failure marks the bubble (tap to retry) instead of
  // blocking the composer. Functional updaters throughout — replies from an
  // earlier send must never clobber a newer list.
  const sendBoardMessage = useCallback(async (text, retryOfId = null) => {
    const body = String(text || '').trim();
    if (!body || !board) return;
    const localId = retryOfId || `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setDraft('');
    setSending(true);
    setItems((prev) => {
      const rest = retryOfId ? prev.filter((it) => it.id !== retryOfId) : prev;
      return [{ id: localId, kind: 'chat', role: 'user', content: body, ts: Date.now(), local: true }, ...rest];
    });
    try {
      // Mark on ATTEMPT, not success — the POST can land server-side even if
      // reading the reply fails client-side, so conservative is correct.
      dirtyRef.current = true;
      const r = await api.post('/turtle/chat', { message: body, history: recentChatHistory, board });
      const reply = r?.reply;
      setItems((prev) => {
        let next = prev.map((it) => (it.id === localId ? { ...it, local: false } : it));
        if (reply) {
          next = [{
            id: `local-ai-${Date.now()}`, kind: 'chat', role: 'assistant',
            content: reply, ts: Date.now(), source: 'app',
          }, ...next];
        }
        return next;
      });
    } catch (e) {
      setItems((prev) => prev.map((it) => (it.id === localId ? { ...it, failed: true } : it)));
    } finally {
      setSending(false);
    }
  }, [api, board, recentChatHistory]);

  // Per-row styles hoisted OUT of renderItem: the old inline objects allocated
  // a dozen fresh style objects per cell per render pass. Static parts live in
  // one theme-keyed StyleSheet; per-item variants are precomputed pairs
  // (user/assistant, failed, done) so a row render only picks references.
  const rowStyles = useMemo(() => StyleSheet.create({
    chatWrapUser: { paddingHorizontal: 14, paddingVertical: 3, alignItems: 'flex-end' },
    chatWrapAI: { paddingHorizontal: 14, paddingVertical: 3, alignItems: 'flex-start' },
    bubbleUser: {
      maxWidth: '82%', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9,
      backgroundColor: c.accentInfo, borderBottomRightRadius: 5, borderBottomLeftRadius: 18,
    },
    bubbleUserFailed: {
      maxWidth: '82%', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9,
      backgroundColor: c.accentError + '33', borderBottomRightRadius: 5, borderBottomLeftRadius: 18,
    },
    bubbleAI: {
      maxWidth: '82%', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9,
      backgroundColor: c.surfaceElevated, borderBottomRightRadius: 18, borderBottomLeftRadius: 5,
    },
    bubbleSending: { opacity: 0.65 },
    fromUser: { fontSize: 11, fontWeight: '700', color: '#ffffffB0', marginBottom: 2 },
    fromAI: { fontSize: 11, fontWeight: '700', color: c.accentSuccess, marginBottom: 2 },
    bodyUser: { fontSize: 15, lineHeight: 20, color: '#fff' },
    bodyAI: { fontSize: 15, lineHeight: 20, color: c.textPrimary },
    stampUser: { fontSize: 10, marginTop: 3, alignSelf: 'flex-end', color: '#ffffff99' },
    stampAI: { fontSize: 10, marginTop: 3, alignSelf: 'flex-end', color: c.textTertiary },
    mediaWrap: { paddingHorizontal: 14, paddingVertical: 4, alignItems: 'flex-start' },
    mediaCard: { maxWidth: '74%', borderRadius: 16, overflow: 'hidden', backgroundColor: c.surfaceElevated },
    mediaImg: { width: 210, height: 210 },
    mediaMissing: { width: 210, height: 150, alignItems: 'center', justifyContent: 'center' },
    videoBadge: {
      position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: 13,
      backgroundColor: '#000000A6', alignItems: 'center', justifyContent: 'center',
    },
    mediaMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6 },
    mediaMetaText: { flex: 1, fontSize: 12, color: c.textSecondary },
    mediaStamp: { fontSize: 10, color: c.textTertiary },
    feedRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, alignItems: 'flex-start', gap: 12 },
    feedIcon: {
      width: 30, height: 30, borderRadius: 15, marginTop: 1,
      alignItems: 'center', justifyContent: 'center',
    },
    feedBody: { flex: 1 },
    feedTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    feedTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: c.textPrimary },
    feedTitleDone: {
      flex: 1, fontSize: 14, fontWeight: '600', color: c.textPrimary,
      textDecorationLine: 'line-through', opacity: 0.6,
    },
    feedStamp: { fontSize: 11, color: c.textTertiary },
    feedSubtitle: { fontSize: 12, color: c.textSecondary, marginTop: 1 },
  }), [c]);

  const renderItem = useCallback(({ item }) => {
    // Chat rows render as real bubbles; everything else stays a compact feed
    // event (the "X added a task" texture between messages).
    if (item.kind === 'chat') {
      const isUser = item.role !== 'assistant';
      const body = item.content || item.title || '';
      const from = !isUser
        ? 'Turtle'
        : (item.source && item.source !== 'app' ? item.source : null);
      const bubble = isUser
        ? (item.failed ? rowStyles.bubbleUserFailed : rowStyles.bubbleUser)
        : rowStyles.bubbleAI;
      return (
        <TouchableOpacity
          activeOpacity={item.failed ? 0.6 : 1}
          disabled={!item.failed}
          onPress={() => item.failed && sendBoardMessage(body, item.id)}
          style={isUser ? rowStyles.chatWrapUser : rowStyles.chatWrapAI}
        >
          <View style={item.local && !item.failed ? [bubble, rowStyles.bubbleSending] : bubble}>
            {!!from && (
              <Text style={isUser ? rowStyles.fromUser : rowStyles.fromAI}>
                {from}
              </Text>
            )}
            <Text style={isUser ? rowStyles.bodyUser : rowStyles.bodyAI}>
              {body}
            </Text>
            <Text style={isUser ? rowStyles.stampUser : rowStyles.stampAI}>
              {item.failed ? 'Failed — tap to retry' : item.local ? 'sending…' : timeAgo(item.ts)}
            </Text>
          </View>
        </TouchableOpacity>
      );
    }

    // Media rows show the ACTUAL uploaded image inline (thumbnail → raw
    // fallback), rendered as a photo card on the feed side — not a bare
    // icon+name row. A video keeps a play badge over its poster frame.
    if (item.kind === 'media') {
      const uri = getFullUrl(item.thumbnailUrl || item.rawUrl);
      const isVideo = item.mediaType && item.mediaType !== 'image';
      return (
        <View style={rowStyles.mediaWrap}>
          <View style={rowStyles.mediaCard}>
            <TouchableOpacity activeOpacity={0.9} disabled={!uri} onPress={() => openLightbox(item)}>
              {uri ? (
                <Image
                  source={{ uri }}
                  style={rowStyles.mediaImg}
                  contentFit="cover"
                  transition={150}
                  recyclingKey={uri}
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={rowStyles.mediaMissing}>
                  <Icon name="image-off-outline" size={28} color={c.textTertiary} />
                </View>
              )}
              {isVideo && !!uri && (
                <View style={rowStyles.videoBadge}>
                  <Icon name="play" size={16} color="#fff" />
                </View>
              )}
            </TouchableOpacity>
            <View style={rowStyles.mediaMetaRow}>
              <Icon name="image-outline" size={13} color={c.textTertiary} />
              <Text style={rowStyles.mediaMetaText} numberOfLines={1}>
                {item.title || 'Photo'}
              </Text>
              <Text style={rowStyles.mediaStamp}>{timeAgo(item.ts)}</Text>
            </View>
          </View>
        </View>
      );
    }

    const meta = KIND_META[item.kind] || KIND_META.note;
    const tint = c[meta.tint] || c.textSecondary;
    const done = item.kind === 'task' && item.completed;
    return (
      <View style={rowStyles.feedRow}>
        {/* Icon tint varies per KIND — only the backgroundColor stays inline. */}
        <View style={[rowStyles.feedIcon, { backgroundColor: tint + '22' }]}>
          <Icon name={done ? 'check' : meta.icon} size={16} color={tint} />
        </View>
        <View style={rowStyles.feedBody}>
          <View style={rowStyles.feedTitleRow}>
            <Text
              style={done ? rowStyles.feedTitleDone : rowStyles.feedTitle}
              numberOfLines={2}
            >
              {item.title || '(untitled)'}
            </Text>
            <Text style={rowStyles.feedStamp}>{timeAgo(item.ts)}</Text>
          </View>
          {!!item.subtitle && (
            <Text style={rowStyles.feedSubtitle} numberOfLines={2}>
              {item.subtitle}
            </Text>
          )}
        </View>
      </View>
    );
  }, [c, rowStyles, sendBoardMessage, getFullUrl, openLightbox]);

  const keyExtractor = useCallback((it, i) => `${it.kind}:${it.id ?? i}`, []);


  // Explicit wrapper so EdgeSwipePage / button press event args can't leak
  // through as a truthy "did activity" flag — the parent inbox only refreshes
  // its (expensive) overview when this open actually sent something.
  const handleClose = useCallback(() => onClose(dirtyRef.current), [onClose]);

  return (
    <EdgeSwipePage overlay visible={visible} onClose={handleClose} swipeEnabled={!lightbox && !quickOpen}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: c.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header — back chevron + the board name, mirroring the Friends page. */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 6,
          paddingTop: insets.top + 6, paddingBottom: 10, paddingHorizontal: 10,
          borderBottomWidth: 1, borderBottomColor: c.border,
        }}>
          <TouchableOpacity
            onPress={handleClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
            accessibilityLabel="Back"
            accessibilityRole="button"
          >
            <Icon name="chevron-left" size={28} color={c.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: c.textPrimary }} numberOfLines={1}>
              {board}
            </Text>
            <Text style={{ fontSize: 12, color: c.textTertiary }}>Board conversation</Text>
          </View>
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={c.textSecondary} />
          </View>
        ) : error ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
            <Icon name="cloud-off-outline" size={40} color={c.textTertiary} />
            <Text style={{ color: c.textSecondary, marginTop: 12, textAlign: 'center' }}>{error}</Text>
            <TouchableOpacity onPress={() => load(null)} style={{ marginTop: 16 }}>
              <Text style={{ color: c.accentInfo, fontWeight: '600' }}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : items.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
            <Icon name="forum-outline" size={40} color={c.textTertiary} />
            <Text style={{ color: c.textSecondary, marginTop: 12, textAlign: 'center' }}>
              Nothing here yet — say something about this board.
            </Text>
          </View>
        ) : (
          <FlatList
            // Inverted over newest-first data: index 0 (newest) renders at the
            // visual bottom, exactly like a messenger. Reaching the "end" of
            // the inverted list = scrolling up into older history.
            inverted
            data={items}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            contentContainerStyle={{ paddingVertical: 10 }}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            onEndReachedThreshold={0.4}
            onEndReached={() => {
              if (nextBefore != null && !loadingMore) load(nextBefore);
            }}
            // In an inverted list the footer renders at the visual TOP — right
            // where the older-history spinner belongs.
            ListFooterComponent={loadingMore ? (
              <View style={{ paddingVertical: 18 }}>
                <ActivityIndicator color={c.textSecondary} />
              </View>
            ) : null}
          />
        )}

        {/* Composer — the SAME ChatComposer as the main Turtle chat, so board
            conversations look + feel identical. Turtle AI answers with this
            board's items as its working context. */}
        <ChatComposer
          theme={theme}
          value={draft}
          onChangeText={setDraft}
          onSend={() => sendBoardMessage(draft)}
          sending={sending}
          placeholder={`Message ${board || 'board'}…`}
          marginBottom={Math.max(insets.bottom, 8)}
          actions={(
            <ComposerAction
              theme={theme}
              icon="checkbox-marked-circle-plus-outline"
              onPress={() => { tapHaptic(); setQuickOpen(true); }}
              accessibilityLabel="New task on this board"
            />
          )}
        />
      </KeyboardAvoidingView>

      {/* Unified task creator, pre-associated with this board (TaskForm's
          Board chip still lets it be changed — the inline expand is the
          whole point of the shared form). Opens COLLAPSED (no `id`/
          `initialData`) — same fast path as the Tasks screen's "+".
          lockType: this saves via createTaskFromBoard → POST /tasks/single,
          which only persists a plain task (no item_type/meta column) — and
          events/birthdays have no board anyway. Without this, switching to
          Event/Birthday from a board and saving would silently drop the
          type + meta (color/guests/yearly), landing as a bare task. */}
      <TaskForm
        visible={quickOpen}
        asOverlay
        onClose={() => setQuickOpen(false)}
        onSave={createTaskFromBoard}
        initialType="task"
        lockType
        initialProject={board || ''}
        projects={projects}
        allTags={allTags}
        onAddProject={addProjectFromBoard}
        onCollectTags={collectTagsFromBoard}
      />

      {/* Full-screen image/video viewer — in-tree overlay above the board
          (a sibling Modal wouldn't present over this EdgeSwipePage on iOS). */}
      <MediaLightbox
        visible={!!lightbox}
        uri={lightbox?.uri}
        isVideo={lightbox?.isVideo}
        onClose={() => setLightbox(null)}
      />
    </EdgeSwipePage>
  );
}
