/**
 * FriendChatPage — a conversation with one person in the pond.
 *
 * The pond has had person-to-person messages for a while (routes/messages.js,
 * and the web app's MessagesScreen) and the phone had no way in: the Friends
 * page listed everyone and a row did nothing when you pressed it. This is that
 * missing half, and nothing about the protocol is new here.
 *
 * ─── What it copies, deliberately ──────────────────────────────────────────
 *
 * The SHAPE is BoardTimeline's and the input is `ChatComposer`, the app's one
 * chat body — the same component the main Turtle chat and every board
 * conversation use. A second chat that looked like a different app for one
 * screen is exactly the drift the shared composer exists to stop.
 *
 * ─── Delivery is HTTP; the socket is only a bell ───────────────────────────
 *
 * `message:new` carries no text on purpose — socket auth is in observe mode on
 * the pond, so private content must not ride it (routes/messages.js explains
 * this at length). The ping says "there is traffic with this person" and the
 * thread refetches over authenticated HTTP. It is an ACCELERATOR, never the
 * delivery: everything here is still correct if the socket never connects.
 *
 * The listener itself is NOT here. It lives on the app-level socket in
 * DownloadsContext, because the tab navigator is lazy and a listener mounted
 * inside a tab does not exist until that tab is first opened.
 *
 * ─── Why a send is optimistic AND reconciled ───────────────────────────────
 *
 * The server pings both sides immediately after answering the POST, so OUR OWN
 * ping routinely triggers a refetch that beats the POST's reply home. The
 * bubble therefore has to be recognisable in a server row whose id we have
 * never seen — `utils/friendMessages` does that matching, and is where the
 * ordering and de-duplication live because they are the parts that look fine
 * on a fast link and go wrong on a slow one.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, BackHandler, FlatList, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import EdgeSwipePage from '../../TurtleScreen/components/EdgeSwipePage';
import ChatComposer from '../../../components/ChatComposer';
import AnimalAvatar from '../../../components/AnimalAvatar';
import { useServer } from '../../../context/ServerContext';
import { useSyncSignals } from '../../../context/DownloadsContext';
import { panelTopInset, panelBottomInset } from '../../../components/tabBarLayout';
import { depth } from '../../../utils/surfaceDepth';
import { inkOn } from '../../../utils/accentColor';
import { tapHaptic, notifyHaptic } from '../../../utils/haptics';
import useKeyboardHeight from '../../../utils/useKeyboardHeight';
import { resolveAvatarUrl } from '../../../utils/avatarUrl';
import {
  mergeThread, optimisticMessage, timeLabel, startsNewDay, dayLabel,
} from '../../../utils/friendMessages';

export default function FriendChatPage({
  visible,
  onClose,
  friend,          // { id, name, avatarUrl }
  theme,
  isDark,
  serverBase,
}) {
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { api } = useServer();
  const { messagesVersion, messagesPing } = useSyncSignals();
  const keyboard = useKeyboardHeight();

  const [rows, setRows] = useState([]);        // what the pond says
  const [locals, setLocals] = useState([]);    // bubbles it has not caught up with
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const listRef = useRef(null);
  const seq = useRef(0);
  const friendId = friend?.id || null;

  const thread = useMemo(() => mergeThread(rows, locals), [rows, locals]);

  // ── Reading the thread ────────────────────────────────────────────────────
  // Reading also marks THEIR messages read, server-side, which is what clears
  // the badge — so this is not a plain GET and must not be fired speculatively.
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!friendId) return;
    if (!quiet) setLoading(true);
    try {
      const res = await api.get(`/messages/${encodeURIComponent(friendId)}?limit=200`);
      const list = Array.isArray(res?.messages) ? res.messages : [];
      setRows(list);
      setError(null);
      // Anything the server now carries is no longer in flight. Keep only the
      // bubbles that FAILED — those are the record that a send did not land.
      setLocals((prev) => prev.filter((l) => l.failed));
    } catch (e) {
      // A refresh that fails leaves what is already on screen alone; only a
      // first read has nothing to fall back to.
      if (!quiet) setError(e?.message || 'Could not open this conversation');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [api, friendId]);

  // Opening the page reads it. Closing clears the thread rather than keeping a
  // stale one warm — the next open may be a different person, and a flash of
  // the wrong conversation is worse than a spinner.
  useEffect(() => {
    if (!visible || !friendId) {
      setRows([]); setLocals([]); setDraft(''); setError(null);
      return;
    }
    load();
  }, [visible, friendId, load]);

  // The bell. Refetch only when the traffic is with THIS person — the ping
  // names them, so a conversation with someone else does not cost a round trip
  // here. A ping with no name (an older pond) is taken at face value.
  useEffect(() => {
    if (!visible || !friendId || !messagesVersion) return;
    const who = messagesPing?.withUserId;
    if (who && String(who) !== String(friendId)) return;
    load({ quiet: true });
  }, [messagesVersion, messagesPing, visible, friendId, load]);

  // Android back closes the THREAD, not the page under it.
  useEffect(() => {
    if (!visible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose?.(); return true; });
    return () => sub.remove();
  }, [visible, onClose]);

  /**
   * Keep the newest message in view.
   *
   * Driven by EVENTS, never by a timer. A `setTimeout(…, 60)` here is a guess
   * at when the list has finished laying out, and a guess that outlives the
   * screen: the timer fires, the list is gone, and `scrollToEnd` reaches into
   * an unmounted VirtualizedList. Content-size change is the real signal, and
   * it already fires on first paint and on every message added.
   *
   * Guarded anyway, because the keyboard path can still race a close.
   */
  const stickToEnd = useCallback((animated = false) => {
    if (!listRef.current) return;
    try { listRef.current.scrollToEnd({ animated }); } catch { /* list went away */ }
  }, []);

  // The keyboard shrinks the list rather than changing its content, so there is
  // no content-size event to ride — the newest bubble would sit behind the
  // composer otherwise.
  useEffect(() => {
    if (!visible || !thread.length) return;
    stickToEnd(true);
  }, [keyboard, visible, thread.length, stickToEnd]);

  // ── Sending ───────────────────────────────────────────────────────────────
  const send = useCallback(async (text, retryOf = null) => {
    const content = String(text ?? '').trim();
    if (!content || !friendId) return;

    seq.current += 1;
    const bubble = retryOf
      ? { ...retryOf, failed: false }
      : optimisticMessage(content, { seq: seq.current });

    setLocals((prev) => (retryOf
      ? prev.map((l) => (l.localId === retryOf.localId ? bubble : l))
      : [...prev, bubble]));
    if (!retryOf) setDraft('');
    setSending(true);
    try {
      await api.post(`/messages/${encodeURIComponent(friendId)}`, { content });
      // The POST's own row is not spliced in here: the refetch below is the one
      // source of truth for what the thread contains, and mergeThread already
      // recognises this bubble in it. Splicing as well is how a message ends up
      // on screen twice.
      await load({ quiet: true });
    } catch (e) {
      notifyHaptic('error');
      setLocals((prev) => prev.map((l) => (
        l.localId === bubble.localId ? { ...l, failed: true } : l
      )));
    } finally {
      setSending(false);
    }
  }, [api, friendId, load]);

  const retry = useCallback((bubble) => {
    tapHaptic();
    send(bubble.content, bubble);
  }, [send]);

  // ── Rows ──────────────────────────────────────────────────────────────────
  const s = useMemo(() => makeStyles(theme), [theme]);

  const renderItem = useCallback(({ item, index }) => {
    const previous = index > 0 ? thread[index - 1] : null;
    const newDay = startsNewDay(item, previous);
    const mine = !!item.mine;
    const body = (
      <View style={mine ? s.wrapMine : s.wrapTheirs}>
        <Pressable
          disabled={!item.failed}
          onPress={() => retry(item)}
          style={[
            mine ? (item.failed ? s.bubbleFailed : s.bubbleMine) : s.bubbleTheirs,
            item.local && !item.failed && s.bubbleSending,
          ]}
        >
          <Text style={mine && !item.failed ? s.bodyMine : s.bodyTheirs}>{item.content}</Text>
          <Text style={mine && !item.failed ? s.stampMine : s.stampTheirs}>
            {item.failed ? 'Not sent — tap to try again' : timeLabel(item.createdAt)}
          </Text>
        </Pressable>
      </View>
    );
    if (!newDay) return body;
    return (
      <View>
        <Text style={s.daySeparator}>{dayLabel(item.createdAt)}</Text>
        {body}
      </View>
    );
  }, [thread, s, retry]);

  const avatar = resolveAvatarUrl(friend?.avatarUrl, serverBase);

  return (
    <EdgeSwipePage overlay visible={visible} onClose={onClose}>
      <View style={[s.page, { backgroundColor: c.background }]}>
        {/* The back key is IN the row, so the name lays out beside it rather
            than under it (STYLE-RULES §4b). */}
        <View style={[s.header, { paddingTop: panelTopInset(insets.top) }]}>
          <Pressable
            onPressIn={() => tapHaptic()}
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={s.backKey}
            accessibilityRole="button"
            accessibilityLabel="Back to friends"
            testID="friend-chat-back"
          >
            <Icon name="chevron-left" size={28} color={c.textPrimary} />
          </Pressable>
          {avatar ? (
            <Image source={{ uri: avatar }} style={s.avatar} contentFit="cover" cachePolicy="memory-disk" transition={150} />
          ) : (
            <AnimalAvatar id={friend?.id} size={32} />
          )}
          <Text style={s.title} numberOfLines={1}>{friend?.name || 'Message'}</Text>
        </View>

        {loading && !thread.length ? (
          <View style={s.centre}><ActivityIndicator color={c.textSecondary} /></View>
        ) : error && !thread.length ? (
          <View style={s.centre}>
            <Text style={s.errorText}>{error}</Text>
            <Pressable onPress={() => load()} style={s.retryKey} accessibilityRole="button">
              <Text style={s.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={thread}
            keyExtractor={(m) => String(m.localId || m.id)}
            renderItem={renderItem}
            contentContainerStyle={s.listContent}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            scrollIndicatorInsets={{ right: 1 }}
            indicatorStyle={isDark ? 'white' : 'black'}
            onContentSizeChange={() => stickToEnd(false)}
            ListEmptyComponent={(
              <View style={s.centre}>
                <Icon name="chat-outline" size={40} color={c.textMuted} />
                <Text style={s.emptyText}>
                  No messages yet. Say something to {friend?.name || 'them'}.
                </Text>
              </View>
            )}
            testID="friend-chat-list"
          />
        )}

        {/* The composer clears the DOCK when the keyboard is down — it floats
            over this page and reserves no layout space. With the keyboard up
            there is no dock to clear, only the keyboard itself. */}
        <ChatComposer
          theme={theme}
          value={draft}
          onChangeText={setDraft}
          onSend={() => send(draft)}
          sending={sending}
          disabled={!friendId}
          placeholder={`Message ${friend?.name || ''}…`}
          marginBottom={keyboard > 0 ? keyboard + 8 : panelBottomInset(insets.bottom)}
          inputProps={{ testID: 'friend-chat-input' }}
        />
      </View>
    </EdgeSwipePage>
  );
}

const makeStyles = (theme) => {
  const c = theme.colors;
  return StyleSheet.create({
    page: { flex: 1 },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 12, paddingBottom: 10,
    },
    backKey: { width: 30, height: 36, marginLeft: -6, alignItems: 'center', justifyContent: 'center' },
    avatar: { width: 32, height: 32, borderRadius: 16 },
    title: { flex: 1, fontSize: 17, fontWeight: '700', color: c.textPrimary },

    listContent: { paddingVertical: 10, flexGrow: 1 },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28 },
    emptyText: { fontSize: 14, color: c.textTertiary, textAlign: 'center' },
    errorText: { fontSize: 14, color: c.textSecondary, textAlign: 'center' },
    retryKey: {
      paddingHorizontal: 16, height: 36, borderRadius: 18, justifyContent: 'center',
      backgroundColor: c.surfaceElevated, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    },
    retryText: { fontSize: 13, fontWeight: '700', color: c.textPrimary },

    daySeparator: {
      alignSelf: 'center', marginTop: 14, marginBottom: 6,
      fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: c.textTertiary,
    },

    // Bubbles, from BoardTimeline — same radii, same tail, same max width, so a
    // conversation with a person reads like every other conversation.
    wrapMine: { paddingHorizontal: 14, paddingVertical: 3, alignItems: 'flex-end' },
    wrapTheirs: { paddingHorizontal: 14, paddingVertical: 3, alignItems: 'flex-start' },
    bubbleMine: {
      maxWidth: '82%', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9,
      backgroundColor: c.accentInfo, borderBottomRightRadius: 5, borderBottomLeftRadius: 18,
    },
    bubbleFailed: {
      maxWidth: '82%', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9,
      backgroundColor: c.accentError + '33', borderBottomRightRadius: 5, borderBottomLeftRadius: 18,
    },
    bubbleTheirs: {
      maxWidth: '82%', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9,
      backgroundColor: c.surfaceElevated, borderBottomRightRadius: 18, borderBottomLeftRadius: 5,
      ...depth(theme, 'card'),
    },
    bubbleSending: { opacity: 0.65 },
    // Inked against the bubble's own fill: `background` is near-white on a light
    // theme and vanishes once the accent is a pale one.
    bodyMine: { fontSize: 15, lineHeight: 20, color: inkOn(c.accentInfo) },
    bodyTheirs: { fontSize: 15, lineHeight: 20, color: c.textPrimary },
    stampMine: { fontSize: 10, marginTop: 3, alignSelf: 'flex-end', color: inkOn(c.accentInfo), opacity: 0.7 },
    stampTheirs: { fontSize: 10, marginTop: 3, alignSelf: 'flex-end', color: c.textTertiary },
  });
};
