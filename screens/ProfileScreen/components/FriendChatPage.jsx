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
 * ─── Photos ────────────────────────────────────────────────────────────────
 *
 * A message can carry up to six, as VAULT MEDIA IDS rather than bytes — the
 * photo goes through the ordinary media pipeline first and the message
 * references what came back, so a sent photo is a vault item like any other.
 * The composer therefore uploads on PICK, not on send (services/vaultAttach says
 * why), and a bubble draws its photo straight from `/api/media/display/:id` —
 * no lookup first, and crucially the only thing that works for a photo someone
 * sent YOU, since `/media/by-ids` is owner-scoped. MessagePhotos explains it.
 *
 * A photo IS a message: the send key arms with nothing typed, and a wordless
 * bubble draws no empty line under the picture.
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
  ActivityIndicator, BackHandler, Linking, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import EdgeSwipePage from '../../TurtleScreen/components/EdgeSwipePage';
import ChatComposer from '../../../components/ChatComposer';
import AnimalAvatar from '../../../components/AnimalAvatar';
import MessageLinkCard from '../../../components/MessageLinkCard';
import MessageActionsSheet from '../../../components/MessageActionsSheet';
import AttachmentViewer from '../../../components/AttachmentViewer';
import MessagePhotos from './MessagePhotos';
import MessageDraftPhotos, { MessageAttachKey } from './MessageDraftPhotos';
import { pickPhotos, uploadErrorMessage, uploadPickedAsset } from '../../../services/vaultAttach';
import {
  attachmentIdsOf,
  attachmentRoom,
  canSendMessage,
  toAttachments,
} from '../../../utils/messageAttachments';
import { useServer, getApiAuthToken } from '../../../context/ServerContext';
import { useSyncSignals } from '../../../context/DownloadsContext';
import { panelTopInset, panelBottomInset } from '../../../components/tabBarLayout';
import { depth } from '../../../utils/surfaceDepth';
import { inkOn } from '../../../utils/accentColor';
import { tapHaptic, impactHaptic, notifyHaptic } from '../../../utils/haptics';
import useKeyboardHeight from '../../../utils/useKeyboardHeight';
import { resolveAvatarUrl } from '../../../utils/avatarUrl';
import { copyText } from '../../../utils/copyText';
import { FROST_OVERLAP } from '../../../utils/frostedChat';
import { viewerImageUrl } from '../../../utils/mediaAttachments';
import { firstLinkUrl, linkSegments } from '../../../utils/messageLinks';
import {
  mergeThread, optimisticMessage, timeLabel, startsNewDay, dayLabel,
} from '../../../utils/friendMessages';

/** How long a copy confirmation stays up. */
const TOAST_MS = 1800;

/**
 * The newest message sits at the ABSOLUTE BOTTOM, and stays there.
 *
 * Lifted wholesale from the main chat (TurtleScreen's CHAT_MAINTAIN_POSITION),
 * because that one was already made to run properly and a second, different
 * answer to the same question is how two chats in one app start behaving
 * differently.
 *
 *   startRenderingFromBottom  — the thread OPENS at the newest line, with no
 *     scroll-to-end afterwards to go wrong. A hand-rolled version has to
 *     survive the content height moving several times after first paint (the
 *     messages land, the dock is measured and changes the inset, a link
 *     preview resolves and makes a bubble taller) and be re-park-proof at each
 *     one. This is the list doing it natively instead.
 *   autoscrollToBottomThreshold — a new message pulls the view down only if
 *     the reader was already within a fifth of a screen of the bottom. Being
 *     yanked out of history because something arrived is the other half of the
 *     complaint, and this is the same number the main chat uses.
 *
 * Frozen at module scope: FlashList treats this as layout CONFIGURATION, so an
 * object literal in the render body hands it a new identity on every render —
 * which here means every keystroke in the composer.
 */
const CHAT_PINNED_TO_BOTTOM = {
  startRenderingFromBottom: true,
  autoscrollToBottomThreshold: 0.2,
};

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
  const { api, getBaseUrl } = useServer();
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

  // Measured height of the floating composer dock. The list is inset by it so
  // the newest message rests just clear of the frost while older ones scroll
  // UNDER it — the same arrangement the main chat uses.
  //
  // Seeded, so the first frame does not overlap before onLayout lands, and
  // seeded GENEROUSLY on purpose: over-guessing shows a gap that closes a
  // frame later, under-guessing hides the newest message behind the composer,
  // which is the one thing this screen must never do.
  const [dockHeight, setDockHeight] = useState(220);

  const thread = useMemo(() => mergeThread(rows, locals), [rows, locals]);

  // Photos are addressed by id through /api/media/display/:id, so there is
  // nothing to resolve first — see MessagePhotos for why that is also the only
  // thing that works for a photo somebody sent US.
  const photoOrigin = useMemo(() => String(serverBase || '').replace(/\/api$/, ''), [serverBase]);

  /**
   * The pictures of one message, as `{ key, uri }`.
   *
   * A bubble still in flight draws the LOCAL files it was sent with, so a photo
   * is on screen the instant Send is pressed and does not blink when the upload
   * lands. Everything settled is addressed by vault id through the display tier.
   */
  const photoFramesOf = useCallback((message) => {
    const local = Array.isArray(message?.localUris) ? message.localUris : [];
    if (local.length) return local.map((uri, i) => ({ key: `local-${i}`, uri }));
    return attachmentIdsOf(message).map((id) => ({
      key: id,
      uri: viewerImageUrl(photoOrigin, { id }),
    }));
  }, [photoOrigin]);

  /** The same pictures, in the shape AttachmentViewer wants. */
  const photosOf = useCallback(
    (message) => photoFramesOf(message).map(({ key, uri }) => ({
      key, uri, previewUri: uri, name: null,
    })),
    [photoFramesOf],
  );

  // The full-size viewer. It holds the pictures of the ONE message that was
  // tapped, so paging walks that message rather than the whole conversation.
  const [viewer, setViewer] = useState(null);
  const openPhotos = useCallback((images, index) => {
    if (images?.length) { impactHaptic('light'); setViewer({ images, index }); }
  }, []);
  useEffect(() => { if (!visible) setViewer(null); }, [visible]);

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
   * Going to TEXT brings you to the newest message.
   *
   * The ONE thing `maintainVisibleContentPosition` cannot do for us. The
   * keyboard changes no CONTENT, so there is no size change for the list to
   * anchor against — it only makes the dock taller, which pushes the bottom of
   * the conversation up behind it. Unconditional on the way up: "I am about to
   * type" is a statement about wanting the end of the conversation, even from
   * someone who was reading history a moment ago.
   */
  const keyboardUp = keyboard > 0;
  useEffect(() => {
    if (!visible || !keyboardUp || !thread.length) return;
    try { listRef.current?.scrollToEnd?.({ animated: true }); } catch { /* list went away */ }
  }, [keyboardUp, visible, thread.length]);

  // ── The draft's photos ────────────────────────────────────────────────────
  //
  // Each entry is { key, uri, asset, error }. `uri` is the LOCAL file the picker
  // handed over, and it is what the strip AND the sent bubble both draw: it is
  // already on the device, so it paints with no network at all.
  //
  // ── Sending does not wait for the upload ────────────────────────────────
  // The upload starts the moment a photo is picked, but Send no longer blocks on
  // it. Press it and the bubble is on screen immediately, drawn from the local
  // file; the upload finishes behind it, and only then does the message POST.
  // So the wait that used to sit between "I chose a photo" and "I may send it"
  // now sits where nobody is looking at it.
  const [photos, setPhotos] = useState([]);
  const photoSeq = useRef(0);
  // key → Promise<mediaId>. The promise IS the upload: anything that needs the
  // id awaits it rather than polling a flag, so a send that arrives mid-upload
  // simply joins the one already running instead of starting a second.
  const uploads = useRef(new Map());

  /** Start this photo's upload, or hand back the one already in flight. */
  const uploadOf = useCallback((entry) => {
    const running = uploads.current.get(entry.key);
    if (running) return running;
    const started = uploadPickedAsset({
      uploadUrl: `${getBaseUrl()}/media/upload`,
      token: getApiAuthToken(),
      asset: entry.asset,
      label: `message:${entry.asset?.fileName || entry.key}`,
    }).then(
      (media) => media.id,
      (e) => {
        // Forgotten, so a retry genuinely retries rather than re-awaiting a
        // promise that has already rejected.
        uploads.current.delete(entry.key);
        setPhotos((prev) => prev.map((p) => (
          p.key === entry.key ? { ...p, error: uploadErrorMessage(e) } : p
        )));
        throw e;
      },
    );
    uploads.current.set(entry.key, started);
    return started;
  }, [getBaseUrl]);

  // Closing the thread — or switching to another person — empties the strip. A
  // photo picked for one conversation following you into another is the kind of
  // mistake you cannot take back.
  useEffect(() => { setPhotos([]); uploads.current.clear(); }, [visible, friendId]);

  const removePhoto = useCallback((key) => {
    tapHaptic();
    setPhotos((prev) => prev.filter((p) => p.key !== key));
    uploads.current.delete(key);
  }, []);

  const addPhotos = useCallback(async () => {
    const room = attachmentRoom(photos);
    if (room <= 0) return;
    const picked = await pickPhotos({ limit: room }).catch(() => null);
    if (!picked || picked.status !== 'picked') return;

    const entries = picked.assets.map((asset) => {
      photoSeq.current += 1;
      return { key: `p${photoSeq.current}`, uri: asset.uri, asset, error: null };
    });
    setPhotos((prev) => [...prev, ...entries]);
    // Started now, awaited later — by Send, if it has not finished by then.
    for (const entry of entries) uploadOf(entry).catch(() => { /* the entry carries it */ });
  }, [photos, uploadOf]);

  // ── Sending ───────────────────────────────────────────────────────────────
  const send = useCallback(async (text, retryOf = null) => {
    const content = String(text ?? '').trim();
    // A retry re-sends exactly the photos that bubble carried; a new send takes
    // the strip, minus anything whose upload has already failed. A PHOTO IS A
    // MESSAGE, so words are not required — only one of the two.
    const carried = retryOf ? (retryOf.photos || []) : photos.filter((p) => !p.error);
    if (!canSendMessage(content, carried) || !friendId) return;

    seq.current += 1;
    const bubble = retryOf
      ? { ...retryOf, failed: false }
      : {
        ...optimisticMessage(content, { seq: seq.current }),
        // Drawn from the device while the upload runs, so the picture is on
        // screen before the network has been asked for anything.
        localUris: carried.map((p) => p.uri),
        // Kept so a tap-to-retry can re-upload rather than re-pick.
        photos: carried,
      };

    setLocals((prev) => (retryOf
      ? prev.map((l) => (l.localId === retryOf.localId ? bubble : l))
      : [...prev, bubble]));
    if (!retryOf) { setDraft(''); setPhotos([]); }
    setSending(true);
    try {
      // Usually already resolved — the upload began when the photo was picked.
      const ids = await Promise.all(carried.map((entry) => uploadOf(entry)));
      // The ids go onto the OPTIMISTIC bubble before the POST, and that matters:
      // mergeThread recognises this bubble in the server's answer by its content
      // AND its attachments, so a bubble that never learned its ids would sit on
      // screen beside the real row instead of settling into it.
      if (ids.length) {
        setLocals((prev) => prev.map((l) => (
          l.localId === bubble.localId ? { ...l, attachments: toAttachments(ids) } : l
        )));
      }
      // `attachments` only rides along when there are some: an ordinary message
      // is still the plain `{ content }` body this endpoint has always taken.
      await api.post(`/messages/${encodeURIComponent(friendId)}`, {
        content,
        ...(ids.length ? { attachments: toAttachments(ids) } : null),
      });
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
  }, [api, friendId, load, photos, uploadOf]);

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

  // The verbs. Each appears only when it would actually do something — a row
  // that does nothing is worse than an absent one, which is why a photo sent
  // with no words offers no "Copy message" to copy an empty string with.
  const heldActions = useMemo(() => {
    if (!held) return [];
    const content = held.content || '';
    const link = firstLinkUrl(content);
    const rows = [];
    if (content.trim()) {
      rows.push({
        key: 'copy-message',
        label: 'Copy message',
        icon: 'content-copy',
        onSelect: () => { copyText(content).then((r) => reportCopy(r, 'Message')); },
      });
    }
    // The pictures of the held message, in its own order — the same list a tap
    // on one of them opens, so the sheet and the photo agree on what is next.
    const openable = photosOf(held);
    if (openable.length) {
      rows.push({
        key: 'open-photos',
        label: openable.length === 1 ? 'Open photo' : `Open ${openable.length} photos`,
        icon: 'image-outline',
        onSelect: () => openPhotos(openable, 0),
      });
    }
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
  }, [held, reportCopy, say, photosOf, openPhotos]);

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
    const photoFrames = photoFramesOf(item);
    // A photo sent on its own has no words, and an empty <Text> would still
    // claim a line of leading under the picture.
    const hasText = String(item.content || '').trim().length > 0;
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
          {photoFrames.length > 0 && (
            <MessagePhotos
              photos={photoFrames}
              mine={inked}
              theme={theme}
              onOpen={(index) => openPhotos(photosOf(item), index)}
            />
          )}
          {!!link && (
            <MessageLinkCard
              url={link}
              mine={inked}
              theme={theme}
              serverBase={serverBase}
              onLongPress={onHold}
              testID={`friend-chat-link-${item.localId || item.id}`}
            />
          )}
          {/* One outer <Text> so the message still wraps and selects as one
              paragraph; the links are nested spans inside it, which is the
              only way react-native makes part of a line pressable. Holding a
              link has to raise the sheet too — a long press does NOT pass
              from a nested Text to its parent. */}
          {hasText && (
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
          )}
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
  }, [thread, s, retry, hold, theme, serverBase, photoFramesOf, photosOf, openPhotos]);

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
          <View style={s.listWrap}>
          <FlashList
            ref={listRef}
            data={thread}
            keyExtractor={(m) => String(m.localId || m.id)}
            renderItem={renderItem}
            // The whole of the scroll behaviour, and the reason there is no
            // hand-rolled version of it here any more. See CHAT_PINNED_TO_BOTTOM.
            maintainVisibleContentPosition={CHAT_PINNED_TO_BOTTOM}
            // FlashList ignores `style`, so the flex:1 lives on the wrapper View.
            contentContainerStyle={{ paddingVertical: 10, paddingBottom: dockHeight + FROST_OVERLAP }}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            // The scrollbar stops at the composer rather than running under it.
            scrollIndicatorInsets={{ right: 1, bottom: dockHeight }}
            indicatorStyle={isDark ? 'white' : 'black'}
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
          </View>
        )}

        {/* The composer DOCK — an absolute overlay, not a row in the column.
            That is the whole difference between a frosted bar and a bar that
            merely looks frosted: there has to be chat behind it to see.
            Measured, because the composer grows with the text in it and the
            list's inset has to follow (the main chat's dock does the same).

            The composer clears the floating tab dock when the keyboard is
            down — it reserves no layout space. With the keyboard up there is
            no dock to clear, only the keyboard itself. */}
        <View
          style={s.dock}
          // box-none, or the transparent strip between the composer and the
          // tab dock becomes a dead zone that eats presses meant for the
          // messages showing through it.
          pointerEvents="box-none"
          testID="friend-chat-dock"
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            // Guard: this fires on every keyboard frame and on every line the
            // input grows by, and each set re-lays out the list.
            setDockHeight((prev) => (prev === h ? prev : h));
          }}
        >
          {/* A copy is invisible, so without this "Copy message" reads as an
              option that did nothing. Inside the dock, so it rides the
              keyboard with the composer instead of tracking it by hand. */}
          {!!toast && (
            <View pointerEvents="none" style={s.toastWrap}>
              <View style={s.toast}>
                <Text numberOfLines={1} style={s.toastText} testID="friend-chat-toast">{toast}</Text>
              </View>
            </View>
          )}
          <ChatComposer
            theme={theme}
            value={draft}
            onChangeText={setDraft}
            onSend={() => send(draft)}
            sending={sending}
            disabled={!friendId}
            // A PHOTO IS A MESSAGE — the key arms with nothing typed. It no
            // longer waits on the upload either: send puts the bubble on screen
            // from the local file and the upload finishes behind it.
            canSend={canSendMessage(draft, photos) && !!friendId}
            placeholder={photos.length > 0
              ? 'Say something about it, or just send…'
              : `Message ${friend?.name || ''}…`}
            topSlot={<MessageDraftPhotos items={photos} theme={theme} onRemove={removePhoto} />}
            actions={(
              <MessageAttachKey
                ids={photos}
                theme={theme}
                disabled={!friendId}
                onPress={addPhotos}
              />
            )}
            marginBottom={keyboard > 0 ? keyboard + 8 : panelBottomInset(insets.bottom)}
            inputProps={{ testID: 'friend-chat-input' }}
          />
        </View>
      </View>

      <MessageActionsSheet
        visible={!!held}
        onClose={() => setHeld(null)}
        message={held}
        actions={heldActions}
        theme={theme}
        testID="friend-chat-actions"
      />

      {/* A photo, full size. The same viewer a note's attachments open — it takes
          URLs, so it never routes through the media vault. */}
      <AttachmentViewer
        visible={!!viewer}
        images={viewer?.images || []}
        index={viewer?.index || 0}
        onClose={() => setViewer(null)}
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

    listWrap: { flex: 1 },
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

    // The composer's own layer, over the conversation rather than beside it.
    // Nothing sets a height: it is whatever the composer (plus its keyboard /
    // dock margin) comes to, and `onLayout` reports that to the list.
    dock: { position: 'absolute', left: 0, right: 0, bottom: 0 },

    // The copy confirmation, stacked above the composer inside the dock so it
    // rides the keyboard with it. `pointerEvents: 'none'` on the view itself,
    // so it can never swallow a press meant for a bubble underneath.
    toastWrap: { alignItems: 'center', marginBottom: 8 },
    toast: {
      maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
      backgroundColor: 'rgba(22,26,32,0.94)',
      ...depth(theme, 'overlay'),
    },
    toastText: { fontSize: 12.5, fontWeight: '600', color: '#fff' },
  });
};
