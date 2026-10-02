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
 *
 * ─── Links are not plain text ──────────────────────────────────────────────
 *
 * A URL someone sends is pressable where it was written, and the FIRST link in
 * a message also gets a preview card above the text (`MessageLinkCard`): a
 * thumbnail, the page's title and a line of summary, so the message is still
 * recognisable a week later. Holding any bubble raises
 * `MessageActionsSheet` — copy the message, copy or open its link.
 *
 * Both halves are shared components rather than markup in this file, so the
 * board conversations (BoardTimeline) can take the same treatment without a
 * second implementation of either. This matches the web app's MessagesScreen,
 * and the preview itself is the pond's existing unfurl service, so a link
 * previewed on the phone is already cached for the web and the other way
 * round.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, BackHandler, FlatList, Linking, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import EdgeSwipePage from '../../TurtleScreen/components/EdgeSwipePage';
import ChatComposer from '../../../components/ChatComposer';
import AnimalAvatar from '../../../components/AnimalAvatar';
import MessageLinkCard from '../../../components/MessageLinkCard';
import MessageActionsSheet from '../../../components/MessageActionsSheet';
import { useServer } from '../../../context/ServerContext';
import { useSyncSignals } from '../../../context/DownloadsContext';
import { panelTopInset, panelBottomInset } from '../../../components/tabBarLayout';
import { depth } from '../../../utils/surfaceDepth';
import { inkOn } from '../../../utils/accentColor';
import { tapHaptic, impactHaptic, notifyHaptic } from '../../../utils/haptics';
import useKeyboardHeight from '../../../utils/useKeyboardHeight';
import { resolveAvatarUrl } from '../../../utils/avatarUrl';
import { copyText } from '../../../utils/copyText';
import { firstLinkUrl, linkSegments } from '../../../utils/messageLinks';
import {
  mergeThread, optimisticMessage, timeLabel, startsNewDay, dayLabel,
} from '../../../utils/friendMessages';

/** How long a copy confirmation stays up. */
const TOAST_MS = 1800;

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

  // ── Holding a message ─────────────────────────────────────────────────────
  // The sheet lives here, not in the bubble: only one may be open at a time,
  // and a Modal mounted per row is a Modal per row.
  const [held, setHeld] = useState(null);
  const [toast, setToast] = useState(null);

  // One timer, cleared on unmount — a toast outliving the page would set state
  // on something gone.
  const toastTimer = useRef(null);
  const say = useCallback((text) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Closing the thread takes the sheet with it.
  useEffect(() => { if (!visible) setHeld(null); }, [visible]);

  const hold = useCallback((item) => {
    // A hold IS a tap-shaped gesture, not a movement, so it earns its haptic —
    // and react-native has already cancelled it if the finger travelled.
    impactHaptic('light');
    setHeld(item);
  }, []);

  /**
   * What copyText did, in words. It returns three outcomes rather than a
   * boolean because they are three different things to tell someone: it is on
   * the clipboard, the share sheet took it somewhere, or nothing happened
   * (an older build with no expo-clipboard, and the share sheet dismissed).
   */
  const reportCopy = useCallback((outcome, noun) => {
    if (outcome === 'copied') say(`${noun} copied`);
    else if (outcome === 'shared') say(`${noun} shared`);
    else say(`Could not copy ${noun.toLowerCase()}`);
  }, [say]);

  // The verbs. The link pair only appears when the message HAS a link — a row
  // that does nothing is worse than an absent one.
  const heldActions = useMemo(() => {
    if (!held) return [];
    const content = held.content || '';
    const link = firstLinkUrl(content);
    const rows = [{
      key: 'copy-message',
      label: 'Copy message',
      icon: 'content-copy',
      onSelect: () => { copyText(content).then((r) => reportCopy(r, 'Message')); },
    }];
    if (link) {
      rows.push({
        key: 'copy-link',
        label: 'Copy link',
        icon: 'link-variant',
        onSelect: () => { copyText(link).then((r) => reportCopy(r, 'Link')); },
      }, {
        key: 'open-link',
        label: 'Open link',
        icon: 'open-in-new',
        onSelect: () => { Linking.openURL(link).catch(() => say('Could not open that link')); },
      });
    }
    return rows;
  }, [held, reportCopy, say]);

  // ── Rows ──────────────────────────────────────────────────────────────────
  const s = useMemo(() => makeStyles(theme), [theme]);

  const renderItem = useCallback(({ item, index }) => {
    const previous = index > 0 ? thread[index - 1] : null;
    const newDay = startsNewDay(item, previous);
    const mine = !!item.mine;
    const inked = mine && !item.failed;
    const bodyStyle = inked ? s.bodyMine : s.bodyTheirs;
    const link = firstLinkUrl(item.content);
    const segments = linkSegments(item.content);
    const onHold = () => hold(item);
    const body = (
      <View style={mine ? s.wrapMine : s.wrapTheirs}>
        <Pressable
          // A failed bubble keeps its tap-to-retry; every other bubble has
          // nothing to do on a tap, and `disabled` would take the HOLD away
          // with it — so only the press handler is conditional.
          onPress={item.failed ? () => retry(item) : undefined}
          onLongPress={onHold}
          delayLongPress={400}
          testID={`friend-chat-bubble-${item.localId || item.id}`}
          style={[
            mine ? (item.failed ? s.bubbleFailed : s.bubbleMine) : s.bubbleTheirs,
            item.local && !item.failed && s.bubbleSending,
          ]}
        >
          {!!link && (
            <MessageLinkCard
              url={link}
              mine={inked}
              theme={theme}
              serverBase={serverBase}
              onLongPress={onHold}
              onLoaded={() => stickToEnd(false)}
              testID={`friend-chat-link-${item.localId || item.id}`}
            />
          )}
          {/* One outer <Text> so the message still wraps and selects as one
              paragraph; the links are nested spans inside it, which is the
              only way react-native makes part of a line pressable. Holding a
              link has to raise the sheet too — a long press does NOT pass
              from a nested Text to its parent. */}
          <Text style={bodyStyle}>
            {segments.map((seg, i) => (seg.url ? (
              <Text
                key={i}
                style={[bodyStyle, s.link, inked && s.linkMine]}
                onPress={() => { Linking.openURL(seg.url).catch(() => {}); }}
                onLongPress={onHold}
                suppressHighlighting
              >
                {seg.text}
              </Text>
            ) : (
              <Text key={i} style={bodyStyle}>{seg.text}</Text>
            )))}
          </Text>
          <Text style={inked ? s.stampMine : s.stampTheirs}>
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
  }, [thread, s, retry, hold, theme, serverBase, stickToEnd]);

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

        {/* A copy is invisible, so without this "Copy message" reads as an
            option that did nothing. Sits above the composer, which is itself
            lifted by the keyboard — so the toast rides with it. */}
        {!!toast && (
          <View
            pointerEvents="none"
            style={[s.toastWrap, {
              bottom: (keyboard > 0 ? keyboard + 8 : panelBottomInset(insets.bottom)) + 72,
            }]}
          >
            <View style={s.toast}>
              <Text numberOfLines={1} style={s.toastText} testID="friend-chat-toast">{toast}</Text>
            </View>
          </View>
        )}
      </View>

      <MessageActionsSheet
        visible={!!held}
        onClose={() => setHeld(null)}
        message={held}
        actions={heldActions}
        theme={theme}
        testID="friend-chat-actions"
      />
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

    // A link in prose. On THEIR bubble it takes the accent; on the sender's own
    // the fill is already the accent, so it keeps the bubble's ink and is told
    // apart by the underline alone.
    link: { color: c.accentInfo, textDecorationLine: 'underline' },
    linkMine: { color: inkOn(c.accentInfo), textDecorationLine: 'underline' },

    // The copy confirmation. Above the composer, clear of the keyboard, and
    // `pointerEvents: 'none'` so it can never swallow a press meant for a
    // bubble underneath it.
    toastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
    toast: {
      maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
      backgroundColor: 'rgba(22,26,32,0.94)',
      ...depth(theme, 'overlay'),
    },
    toastText: { fontSize: 12.5, fontWeight: '600', color: '#fff' },
  });
};
