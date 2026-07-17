import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { useServer } from '../../../context/ServerContext';
import { tapHaptic } from '../../../utils/haptics';
import EdgeSwipePage from './EdgeSwipePage';

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
  const { api } = useServer();

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

  const renderItem = useCallback(({ item }) => {
    // Chat rows render as real bubbles; everything else stays a compact feed
    // event (the "X added a task" texture between messages).
    if (item.kind === 'chat') {
      const isUser = item.role !== 'assistant';
      const body = item.content || item.title || '';
      const from = !isUser
        ? 'Turtle'
        : (item.source && item.source !== 'app' ? item.source : null);
      return (
        <TouchableOpacity
          activeOpacity={item.failed ? 0.6 : 1}
          disabled={!item.failed}
          onPress={() => item.failed && sendBoardMessage(body, item.id)}
          style={{
            paddingHorizontal: 14, paddingVertical: 3,
            alignItems: isUser ? 'flex-end' : 'flex-start',
          }}
        >
          <View style={{
            maxWidth: '82%', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9,
            backgroundColor: isUser ? (item.failed ? c.accentError + '33' : c.accentInfo) : c.surfaceElevated,
            borderBottomRightRadius: isUser ? 5 : 18,
            borderBottomLeftRadius: isUser ? 18 : 5,
            opacity: item.local && !item.failed ? 0.65 : 1,
          }}>
            {!!from && (
              <Text style={{ fontSize: 11, fontWeight: '700', color: isUser ? '#ffffffB0' : c.accentSuccess, marginBottom: 2 }}>
                {from}
              </Text>
            )}
            <Text style={{ fontSize: 15, lineHeight: 20, color: isUser ? '#fff' : c.textPrimary }}>
              {body}
            </Text>
            <Text style={{
              fontSize: 10, marginTop: 3, alignSelf: 'flex-end',
              color: isUser ? '#ffffff99' : c.textTertiary,
            }}>
              {item.failed ? 'Failed — tap to retry' : item.local ? 'sending…' : timeAgo(item.ts)}
            </Text>
          </View>
        </TouchableOpacity>
      );
    }

    const meta = KIND_META[item.kind] || KIND_META.note;
    const tint = c[meta.tint] || c.textSecondary;
    const done = item.kind === 'task' && item.completed;
    return (
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, alignItems: 'flex-start', gap: 12 }}>
        <View style={{
          width: 30, height: 30, borderRadius: 15, marginTop: 1,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: tint + '22',
        }}>
          <Icon name={done ? 'check' : meta.icon} size={16} color={tint} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text
              style={{
                flex: 1, fontSize: 14, fontWeight: '600', color: c.textPrimary,
                textDecorationLine: done ? 'line-through' : 'none',
                opacity: done ? 0.6 : 1,
              }}
              numberOfLines={2}
            >
              {item.title || '(untitled)'}
            </Text>
            <Text style={{ fontSize: 11, color: c.textTertiary }}>{timeAgo(item.ts)}</Text>
          </View>
          {!!item.subtitle && (
            <Text style={{ fontSize: 12, color: c.textSecondary, marginTop: 1 }} numberOfLines={2}>
              {item.subtitle}
            </Text>
          )}
        </View>
      </View>
    );
  }, [c, sendBoardMessage]);

  const keyExtractor = useCallback((it, i) => `${it.kind}:${it.id ?? i}`, []);

  const canSend = draft.trim().length > 0 && !sending;

  // Explicit wrapper so EdgeSwipePage / button press event args can't leak
  // through as a truthy "did activity" flag — the parent inbox only refreshes
  // its (expensive) overview when this open actually sent something.
  const handleClose = useCallback(() => onClose(dirtyRef.current), [onClose]);

  return (
    <EdgeSwipePage overlay visible={visible} onClose={handleClose}>
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

        {/* Composer — board-scoped chat. Turtle AI answers with this board's
            items as its working context. */}
        <View style={{
          flexDirection: 'row', alignItems: 'flex-end', gap: 6,
          paddingHorizontal: 10, paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 8),
          borderTopWidth: 1, borderTopColor: c.border,
          backgroundColor: c.surface,
        }}>
          <TextInput
            style={{
              flex: 1, minHeight: 32, maxHeight: 96,
              paddingHorizontal: 12, paddingVertical: 6,
              borderRadius: 16, fontSize: 13,
              backgroundColor: c.surfaceElevated, color: c.textPrimary,
            }}
            placeholder={`Message ${board || 'board'}…`}
            placeholderTextColor={c.textTertiary}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            onPressIn={() => canSend && tapHaptic()}
            onPress={() => sendBoardMessage(draft)}
            disabled={!canSend}
            style={{
              width: 32, height: 32, borderRadius: 16,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: canSend ? c.accentInfo : c.surfaceElevated,
            }}
            accessibilityLabel="Send message"
            accessibilityRole="button"
          >
            {sending
              ? <ActivityIndicator size="small" color={canSend ? '#fff' : c.textTertiary} />
              : <Icon name="send" size={15} color={canSend ? '#fff' : c.textTertiary} />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </EdgeSwipePage>
  );
}
