/**
 * ShareTargetScreen
 *
 * Rendered when the OS launches the app via the iOS / Android Share
 * sheet. Receives a payload from expo-share-intent (text, URL, or
 * image files) and lets the user pick a Board destination.
 *
 * The screen answers two different questions, in this order:
 *
 * 1. WHAT should happen to it — three tiles across the top, always in the
 *    same order, so the choice is read rather than hunted for:
 *
 *      Download  the bytes. Shared photos land in the vault as-is; a link
 *                goes to the "Download" album, which the server
 *                ghost-downloads into the vault.
 *      Audio     the same link or file, sound only (outputKind:'audio'),
 *                into the Music Vault.
 *      Inbox     nothing is fetched at all — the LINK itself is what gets
 *                kept, as an untagged note, for reading later. The server
 *                unfurls it in the background so the note ends up with a real
 *                headline, a summary, and a thumbnail rather than a bare URL.
 *
 *    A tile that cannot work for the current payload is not rendered, so
 *    there is never a button that quietly does nothing: a share of loose
 *    photos has no link, so it shows no Inbox.
 *
 * 2. WHERE it should live — everything below the tiles. Search reaches any
 *    board (project / tag / album) whether pinned or not, and typing a name
 *    that doesn't exist offers to create it, so a brand-new topic never
 *    requires a trip to the web app first.
 *
 *    For a link, the server ranks the user's OWN boards against the unfurled
 *    page and returns the ones that actually fit, which we list first under
 *    "Suggested for this link". Pinned boards follow under "Pinned" — they're
 *    the one-tap common case, but a topical match beats a favourite. The
 *    ranking is lexical by default and Claude-assisted when the server has an
 *    API key; either way the server only ever returns boards that exist (plus,
 *    from the AI path, at most one proposed new tag flagged `create`), so
 *    nothing here can route a share at a destination that isn't real.
 *
 * The two are visually distinct on purpose — tiles are verbs, rows are
 * places. Rendering "Download" as another board row was what made an ACTION
 * and a BOARD NAMED "Download" read as the same thing.
 *
 *   text/url → creates a note tagged with the board name (server-side
 *              routing handles project vs tag — both look the same in
 *              the existing notes schema, which stores project as a
 *              tag string).
 *   images   → uploaded to /api/share which writes them to media with
 *              tags=[boardName] AND a chat_log entry so they appear
 *              in the web chat preview pane.
 *
 * Lifecycle:
 *   - App.js detects `hasShareIntent` from useShareIntent() and renders
 *     this screen as a modal overlay instead of the normal tab nav.
 *   - Standard board taps hand text/link/image work to ShareUploadContext and
 *     dismiss immediately.
 *   - Music Vault file taps wait only for app-owned staging, then dismiss while
 *     native streaming continues; URL imports dismiss immediately.
 *   - Cancel button skips the POST and just resetShareIntent()s.
 *
 * Edge cases handled:
 *   - serverIP not configured → friendly "open Turtle on the web first"
 *     state with a Cancel button.
 *   - No pinned boards → friendly "pin a board on web first" state.
 *   - Network error during POST → inline error, user can retry.
 *   - HEIC images from iPhone → passed straight through; the server's
 *     Sharp pipeline already handles HEIC via heic-convert.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Image,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext';
import { useServer } from '../context/ServerContext';
import { useShareUpload } from '../context/ShareUploadContext';
import { impactHaptic, notifyHaptic } from '../utils/haptics';
import {
  classifySharedFile,
  isHttpImportUrl,
  supportedAudioVideoFiles,
} from '../utils/shareMediaClassifier';

// Local cache of the boards list so the picker renders INSTANTLY on open
// instead of waiting on the network — we show the cached list immediately and
// refresh /boards in the background. Bumped suffix if the row shape changes.
const BOARDS_CACHE_KEY = 'shareBoardsCache:v1';

/** Which icon to show for each board kind. Keeps the per-kind config
 *  in one place so a future "folder" or "saved-search" kind only
 *  needs an entry here + on the server's VALID_KINDS set. */
const KIND_ICONS = {
  project: 'folder-multiple',
  tag: 'tag',
  album: 'image-multiple',
};

/** What the user-visible label looks like next to each kind. */
const KIND_LABELS = {
  project: 'Board',
  tag: 'Tag',
  album: 'Album',
};

export default function ShareTargetScreen({ shareIntent, onDismiss }) {
  const { theme } = useTheme();
  const { api, serverIP, isConnected } = useServer();
  const { enqueueShare, enqueueAudioShare } = useShareUpload();

  // ── State ────────────────────────────────────────────────────
  const [boards, setBoards] = useState([]);
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [boardsError, setBoardsError] = useState(null);
  const [query, setQuery] = useState('');
  const [handoffError, setHandoffError] = useState(null);
  // Unfurled link metadata + the boards the server thinks it belongs on.
  // Both arrive from one POST /share/preview; both are optional — the sheet is
  // fully usable while they're still in flight or if they never arrive.
  const [preview, setPreview] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [suggested, setSuggested] = useState([]);
  const [aiSuggested, setAiSuggested] = useState(false);
  const [audioHandoffBusy, setAudioHandoffBusy] = useState(false);
  const audioHandoffInFlightRef = useRef(false);
  const audioHandoffDismissedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Derived: what is actually being shared? ─────────────────
  // expo-share-intent normalizes the payload across iOS/Android into
  // { text, webUrl, files } where files is an array of native file
  // objects with { path, mimeType, fileName }.
  const text = shareIntent?.text || null;
  const url = shareIntent?.webUrl || null;
  const files = Array.isArray(shareIntent?.files) ? shareIntent.files : [];
  const imageFiles = files.filter((file) => classifySharedFile(file) === 'image');
  const mediaFiles = supportedAudioVideoFiles(files);
  const hasImportUrl = isHttpImportUrl(url);
  const showAudioDestination = mediaFiles.length > 0 || hasImportUrl;
  const hasStandardContent = !!text || !!url || imageFiles.length > 0;

  // The link we unfurl. iOS often hands the SAME url twice — once as webUrl and
  // once as the plain-text body (that's the duplicated address in the payload
  // card) — so fall back to `text` when it is itself a link and there's no
  // webUrl. Trimmed here so the effect below doesn't re-fire on whitespace.
  const linkUrl = (url && url.trim())
    || (isHttpImportUrl(text) ? String(text).trim() : '')
    || '';

  // Free text worth showing on its own. When the shared text IS the shared
  // link, rendering it a second time is what made the payload card a wall of
  // URL — the card shows the unfurled link instead, so drop the duplicate.
  const captionText = (() => {
    const trimmed = (text || '').trim();
    if (!trimmed) return '';
    if (!linkUrl) return trimmed;
    if (trimmed === linkUrl) return '';
    // Some apps append the bare link to a real caption; keep the caption, drop
    // the tail so the address isn't shown twice.
    const stripped = trimmed.replace(linkUrl, '').trim();
    return stripped === '' ? '' : stripped;
  })();

  // ── Fetch ALL boards on mount ───────────────────────────────
  // We pull the full universe (not ?pinned=1) so the search box can find
  // any project / tag / album. Each row carries an `isPinned` flag, which
  // we use to surface the curated subset first under "Suggested". The list
  // is alphabetised server-side (pinned-first when unfiltered).
  const loadBoards = useCallback(async () => {
    if (!isConnected) {
      // Only surface a hard error if we have nothing cached to show.
      setBoards((prev) => {
        if (prev.length === 0) setBoardsError('Not connected to the Turtle server.');
        return prev;
      });
      return;
    }
    setLoadingBoards(true);
    setBoardsError(null);
    try {
      const res = await api.get('/boards');
      const list = Array.isArray(res?.boards) ? res.boards : [];
      setBoards(list);
      // Write-through so the next share opens instantly on this list.
      AsyncStorage.setItem(BOARDS_CACHE_KEY, JSON.stringify(list)).catch(() => {});
    } catch (e) {
      console.error('[Share] Failed to load boards:', e);
      // Keep any cached list visible; only show the error if we have nothing.
      setBoards((prev) => {
        if (prev.length === 0) setBoardsError(e.message || 'Failed to load destinations.');
        return prev;
      });
    } finally {
      setLoadingBoards(false);
    }
  }, [api, isConnected]);

  // Hydrate from the local cache the moment the sheet opens, so the picker
  // paints immediately — the network refresh below then reconciles. We never
  // touch image data here (only on pick), keeping the open instant.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(BOARDS_CACHE_KEY);
        if (cancelled || !raw) return;
        const cached = JSON.parse(raw);
        if (Array.isArray(cached) && cached.length > 0) {
          // Don't clobber a fresh network result that may have already landed.
          setBoards((prev) => (prev.length > 0 ? prev : cached));
        }
      } catch (e) { /* ignore a corrupt cache — the fetch will repopulate it */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    loadBoards();
  }, [loadBoards]);

  // ── Unfurl the link + ask where it belongs ──────────────────
  // One round trip: the server fetches the page (or serves its cache), and
  // returns the card metadata plus its board suggestions together. Fire and
  // forget — the sheet has already painted, and every consumer of this state
  // renders a sensible fallback while it's null.
  //
  // Deliberately NOT blocking the action tiles: the whole point of the share
  // sheet is that Download / Audio / Inbox are tappable the instant it opens,
  // and a slow or dead page must never hold that up. The worst case is a card
  // that stays as the bare hostname.
  useEffect(() => {
    if (!linkUrl || !isConnected) return undefined;
    let cancelled = false;
    setPreviewBusy(true);
    (async () => {
      try {
        const res = await api.post('/share/preview', { url: linkUrl });
        if (cancelled) return;
        if (!res?.success) throw new Error(res?.error || 'preview failed');
        setPreview(res.preview || null);
        setSuggested(Array.isArray(res.suggestions) ? res.suggestions : []);
        setAiSuggested(!!res.aiSuggestions);
      } catch (e) {
        // Non-fatal by design — a link that won't unfurl is still shareable.
        if (!cancelled) console.warn('[Share] link preview failed:', e.message);
      } finally {
        if (!cancelled) setPreviewBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [linkUrl, isConnected, api]);

  // ── Derived: search + sections ──────────────────────────────
  // When the user is searching we collapse to one flat result list across
  // every board. Otherwise we split into Suggested (pinned, quick-send)
  // and All boards (the rest).
  const q = query.trim().toLowerCase();
  const isAudioBoard = (board) => (
    board?.kind === 'album' && String(board?.name || '').toLowerCase() === 'audio'
  );
  const visibleBoards = hasStandardContent
    ? boards.filter((board) => !(showAudioDestination && isAudioBoard(board)))
    : [];
  const matches = q
    ? visibleBoards.filter((b) => String(b?.name || '').toLowerCase().includes(q))
    : null;

  // Server suggestions, minus anything this payload can't route to (the Audio
  // album, when the Audio tile already owns that destination). A suggestion
  // flagged `create` is a board that doesn't exist yet, so it is NOT filtered
  // against visibleBoards — it carries the create flag through to pickBoard.
  const boardKey = (b) => `${b.kind}::${b.name}`;
  const knownBoards = new Set(visibleBoards.map(boardKey));
  const suggestedBoards = hasStandardContent
    ? suggested.filter((s) => (
      s && s.kind && s.name
        && !(showAudioDestination && isAudioBoard(s))
        && (s.create ? !knownBoards.has(boardKey(s)) : knownBoards.has(boardKey(s)))
    ))
    : [];
  // Everything below the suggestions is de-duped against them, so a board never
  // appears twice in the same list.
  const suggestedKeys = new Set(suggestedBoards.map(boardKey));
  const pinned = visibleBoards.filter((b) => b.isPinned && !suggestedKeys.has(boardKey(b)));
  const unpinned = visibleBoards.filter((b) => !b.isPinned && !suggestedKeys.has(boardKey(b)));
  // Offer "create a new board" whenever the typed name doesn't already match an
  // existing board exactly (case-insensitive) — so a brand-new topic is one tap
  // away without leaving the share sheet. New boards are created as tags.
  const exactMatch = q
    ? visibleBoards.some((b) => String(b?.name || '').toLowerCase() === q)
    : false;
  const canCreate = hasStandardContent && q.length > 0 && !exactMatch;
  // Only block the UI on the network when we have NOTHING cached to paint. Once
  // the cache (or a fetch) has populated boards, refreshes happen silently.
  const busyEmpty = hasStandardContent && loadingBoards && boards.length === 0;

  // ── Pick a board → hand off + dismiss ───────────────────────
  // Optimistic-by-default: we do NOT read or encode any image here. We hand the
  // board + the raw file refs to the app-level ShareUploadProvider, fire a
  // confirmation haptic, and dismiss IMMEDIATELY. The encode + upload run in the
  // background (owned by something that outlives this modal) and their progress /
  // outcome surface in the floating ShareUploadToast — so 10–30 large photos no
  // longer block the sheet.
  // Sends the NORMALISED payload, not the raw intent: `linkUrl` puts the
  // address in the url slot even when the OS only handed us plain text, and
  // `captionText` drops the caption when it's a duplicate of that address.
  // Both matter server-side — it keys the unfurl off the url, and a caption
  // that's just the link would otherwise become the note's headline.
  const pickBoard = (board) => {
    if (!hasStandardContent) return;
    notifyHaptic('success');
    enqueueShare({ board, text: captionText, url: linkUrl, imageFiles });
    onDismiss?.();
  };

  // ── The three top actions ────────────────────────────────────
  // Everything you can do with a share that ISN'T "file it on a board".
  // All three already exist server-side; this just names them plainly:
  //
  //   Download  → the bytes. Shared photos go to the vault as-is; a link goes
  //               to the "Download" album, which the server ghost-downloads.
  //   Audio     → the same link/file, but only the sound (outputKind:'audio').
  //   Inbox     → nothing is fetched. The link itself is what gets kept.
  const DOWNLOAD_BOARD = { kind: 'album', name: 'Download' };

  // A link can be fetched; loose photos are already bytes. Video/audio FILES
  // are deliberately excluded: the standard share path carries text, links and
  // images only, so offering "Download" for a shared video file would be a
  // button that quietly does nothing. Audio is that case's supported route.
  const canDownload = hasImportUrl || imageFiles.length > 0;
  const canInbox = !!linkUrl || !!captionText;

  const pickDownload = () => {
    if (!canDownload) return;
    // A link is handed to the downloader; bare photos just land in the vault.
    pickBoard(hasImportUrl ? DOWNLOAD_BOARD : null);
  };

  // Save the LINK and nothing else - no fetch, no media row. Images are dropped
  // on purpose: "Inbox" means the address, not the contents. No board either:
  // that's what makes the server file it as an untagged note rather than onto
  // a board, and it's the whole difference between the Inbox and the rows below.
  const pickInbox = () => {
    if (!canInbox) return;
    notifyHaptic('success');
    enqueueShare({ board: null, text: captionText, url: linkUrl, imageFiles: [] });
    onDismiss?.();
  };

  const pickAudio = () => {
    if (audioHandoffInFlightRef.current) return;
    audioHandoffInFlightRef.current = true;
    setAudioHandoffBusy(true);
    setHandoffError(null);

    void (async () => {
      try {
        await enqueueAudioShare({
          mediaFiles,
          url: hasImportUrl ? url : null,
        });
      } catch (error) {
        audioHandoffInFlightRef.current = false;
        if (!mountedRef.current) return;
        setAudioHandoffBusy(false);
        setHandoffError(error.message || 'Could not preserve the shared media.');
        notifyHaptic('error');
        return;
      }

      if (!mountedRef.current || audioHandoffDismissedRef.current) return;
      audioHandoffDismissedRef.current = true;
      notifyHaptic('success');
      onDismiss?.();
    })();
  };

  // ── A single tappable destination row ───────────────────────
  // Tapping sends immediately (quick-send) — there's no confirm step.
  // Shared across the Suggested / All boards / search-results sections.
  //   suggestion — render as a match for THIS link: accent-tinted icon, the
  //                server's one-line reason instead of the generic kind label,
  //                and (for a proposed new tag) a "will be created" hint.
  const renderBoard = (b, { suggestion = false } = {}) => {
    const key = `${b.kind}::${b.name}`;
    const tint = suggestion ? theme.colors.primary : theme.colors.textSecondary;
    const subtitle = suggestion
      ? [b.create ? 'New tag' : (KIND_LABELS[b.kind] || b.kind), b.reason].filter(Boolean).join(' · ')
      : (KIND_LABELS[b.kind] || b.kind);
    return (
      <TouchableOpacity
        key={key}
        activeOpacity={0.75}
        onPressIn={() => impactHaptic('medium')}
        onPress={() => pickBoard(b)}
        style={[
          styles.boardRow,
          {
            backgroundColor: theme.colors.surface,
            borderColor: suggestion ? theme.colors.primary : theme.colors.border,
          },
        ]}
      >
        <View style={[styles.boardIcon, { backgroundColor: theme.colors.surfaceElevated || theme.colors.surface }]}>
          <Icon
            name={b.create ? 'tag-plus-outline' : (KIND_ICONS[b.kind] || 'circle-outline')}
            size={18}
            color={tint}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.boardName, { color: theme.colors.textPrimary }]} numberOfLines={1}>
            {b.name}
          </Text>
          <Text style={[styles.boardKind, { color: theme.colors.textMuted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        {/* Tapping hands off to the background uploader + dismisses instantly,
            so a static chevron is the only affordance needed here. */}
        <Icon name="chevron-right" size={22} color={theme.colors.textMuted} />
      </TouchableOpacity>
    );
  };

  // ── The "create a new board" row ────────────────────────────
  // Reuses the search box as the name field: type a destination that doesn't
  // exist, then tap this to create it (as a tag) AND send the share to it in one
  // shot. Same trailing spinner / checkmark states as a normal board row.
  const renderCreateRow = (name) => {
    return (
      <TouchableOpacity
        key="__create_new_board__"
        activeOpacity={0.75}
        onPressIn={() => impactHaptic('medium')}
        onPress={() => pickBoard({ kind: 'tag', name, create: true })}
        style={[
          styles.boardRow,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.accentSuccess,
            borderStyle: 'dashed',
          },
        ]}
      >
        <View style={[styles.boardIcon, { backgroundColor: theme.colors.surfaceElevated || theme.colors.surface }]}>
          <Icon name="plus" size={18} color={theme.colors.accentSuccess} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.boardName, { color: theme.colors.textPrimary }]} numberOfLines={1}>
            Create “{name}”
          </Text>
          <Text style={[styles.boardKind, { color: theme.colors.textMuted }]}>
            New board · sends here
          </Text>
        </View>
        <Icon name="plus-circle-outline" size={22} color={theme.colors.accentSuccess} />
      </TouchableOpacity>
    );
  };

  // ── Render: status states ────────────────────────────────────
  // After a successful send we show a quick confirmation. After an
  // error we leave the picker visible with the error banner.

  // Not connected — usually means the user opened the share extension
  // without ever configuring the server URL in the main app.
  if (!isConnected && !serverIP) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <Header onDismiss={onDismiss} title="Send to Turtle" theme={theme} />
        <View style={styles.centerState}>
          <Icon name="server-network-off" size={48} color={theme.colors.textMuted} />
          <Text style={[styles.centerTitle, { color: theme.colors.textPrimary }]}>
            Turtle isn't connected
          </Text>
          <Text style={[styles.centerBody, { color: theme.colors.textMuted }]}>
            Open the Turtle app and sign in to your server first, then come back to share.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <Header onDismiss={onDismiss} title="Send to Turtle" theme={theme} />

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Preview — show what is about to be sent */}
        <SharePreview
          text={captionText}
          url={linkUrl}
          preview={preview}
          previewBusy={previewBusy}
          imageFiles={imageFiles}
          mediaFiles={mediaFiles}
          theme={theme}
        />

        {/* ── The three things you can do with a share ─────────────────
            One row, always in the same order, so the choice is read at a
            glance instead of hunted for among board rows. Anything that
            cannot work for THIS payload is not rendered - a share of loose
            photos has no link to keep, so it shows no Inbox. */}
        {(canDownload || showAudioDestination || canInbox) && (
          <>
            <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary, marginTop: 4 }]}>
              Save as
            </Text>
            <View style={styles.actionRow}>
              {canDownload && (
                <ActionTile
                  theme={theme}
                  icon="tray-arrow-down"
                  tint={theme.colors.accentInfo}
                  title="Download"
                  subtitle="Keep the file"
                  accessibilityLabel="Download - keep the file"
                  onPress={pickDownload}
                />
              )}
              {showAudioDestination && (
                <ActionTile
                  theme={theme}
                  icon="music-note"
                  tint={theme.colors.accentSuccess}
                  title="Audio"
                  subtitle="Just the sound"
                  accessibilityLabel="Audio - just the sound"
                  busy={audioHandoffBusy}
                  onPress={pickAudio}
                />
              )}
              {canInbox && (
                <ActionTile
                  theme={theme}
                  icon="bookmark-outline"
                  tint={theme.colors.textSecondary}
                  title="Inbox"
                  subtitle="Link only"
                  accessibilityLabel="Inbox - save the link only"
                  onPress={pickInbox}
                />
              )}
            </View>
          </>
        )}

        {!!handoffError && (
          <View style={[styles.errorBanner, { backgroundColor: 'rgba(248,113,113,0.10)', borderColor: 'rgba(248,113,113,0.3)' }]}>
            <Icon name="alert-circle-outline" size={16} color={theme.colors.accentError} />
            <Text style={{ color: theme.colors.accentError, flex: 1, fontSize: 13 }}>{handoffError}</Text>
          </View>
        )}


        {/* Search box — find any board (even unpinned) OR name a new one to
            create. Shown as soon as we have anything to show (cached list paints
            instantly); hidden only while the FIRST load is running with nothing
            cached, or on a hard error. */}
        {hasStandardContent && !busyEmpty && !boardsError && (
          <>
            <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
              Or file it on a board
            </Text>
          <View style={[styles.searchBox, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Icon name="magnify" size={18} color={theme.colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search boards, or type a new name"
              placeholderTextColor={theme.colors.textMuted}
              style={[styles.searchInput, { color: theme.colors.textPrimary }]}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close-circle" size={18} color={theme.colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          </>
        )}

        {busyEmpty && (
          <View style={styles.centerState}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        )}

        {hasStandardContent && boardsError && (
          <View style={[styles.errorBanner, { backgroundColor: 'rgba(248,113,113,0.10)', borderColor: 'rgba(248,113,113,0.3)' }]}>
            <Icon name="cloud-off-outline" size={16} color={theme.colors.accentError} />
            <Text style={{ color: theme.colors.accentError, flex: 1, fontSize: 13 }}>{boardsError}</Text>
            <TouchableOpacity onPress={loadBoards}>
              <Text style={{ color: theme.colors.accentError, fontWeight: '600', fontSize: 13 }}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!hasStandardContent && !showAudioDestination && (
          <View style={styles.centerState}>
            <Icon name="file-cancel-outline" size={36} color={theme.colors.textMuted} />
            <Text style={[styles.centerTitle, { color: theme.colors.textPrimary, fontSize: 15 }]}>
              Unsupported share
            </Text>
            <Text style={[styles.centerBody, { color: theme.colors.textMuted, fontSize: 12 }]}>
              Turtle can send text, links, images, audio, and video from this screen.
            </Text>
          </View>
        )}

        {hasStandardContent && !busyEmpty && !boardsError && visibleBoards.length === 0
          && suggestedBoards.length === 0 && !q && (
          <View style={styles.centerState}>
            <Icon name="folder-off-outline" size={36} color={theme.colors.textMuted} />
            <Text style={[styles.centerTitle, { color: theme.colors.textPrimary, fontSize: 15 }]}>
              No boards yet
            </Text>
            <Text style={[styles.centerBody, { color: theme.colors.textMuted, fontSize: 12 }]}>
              Type a name in the box above to create your first board and send this straight to it.
            </Text>
          </View>
        )}

        {/* Searching → the "create new board" row (when the name is new) on top,
            then a flat result list across every board. */}
        {hasStandardContent && !busyEmpty && !boardsError && matches && (
          <>
            {canCreate && renderCreateRow(query.trim())}
            {matches.length > 0 ? (
              <>
                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary, marginTop: canCreate ? 18 : 0 }]}>
                  {matches.length} result{matches.length === 1 ? '' : 's'}
                </Text>
                {matches.map((b) => renderBoard(b))}
              </>
            ) : !canCreate ? (
              <View style={styles.centerState}>
                <Icon name="magnify-close" size={32} color={theme.colors.textMuted} />
                <Text style={[styles.centerBody, { color: theme.colors.textMuted, fontSize: 13 }]}>
                  No boards match “{query.trim()}”.
                </Text>
              </View>
            ) : null}
          </>
        )}

        {/* Not searching → link suggestions, then Pinned, then All boards.
            Suggestions lead because a board that matches THIS link beats a
            board the user happens to have favourited. */}
        {hasStandardContent && !busyEmpty && !boardsError && !matches
          && (visibleBoards.length > 0 || suggestedBoards.length > 0) && (
          <>
            {suggestedBoards.length > 0 && (
              <>
                <View style={styles.sectionLabelRow}>
                  <Icon
                    name={aiSuggested ? 'auto-fix' : 'label-variant-outline'}
                    size={13}
                    color={theme.colors.primary}
                  />
                  <Text style={[styles.sectionLabel, { color: theme.colors.primary, marginBottom: 0 }]}>
                    Suggested for this link
                  </Text>
                </View>
                {suggestedBoards.map((b) => renderBoard(b, { suggestion: true }))}
              </>
            )}
            {pinned.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary, marginTop: suggestedBoards.length > 0 ? 18 : 0 }]}>
                  Pinned
                </Text>
                {pinned.map((b) => renderBoard(b))}
              </>
            )}
            {unpinned.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary, marginTop: (pinned.length > 0 || suggestedBoards.length > 0) ? 18 : 0 }]}>
                  All boards
                </Text>
                {unpinned.map((b) => renderBoard(b))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── ActionTile ───────────────────────────────────────────────
// One of the top-row choices. Deliberately a TILE and not another board-style
// row: these are verbs, the rows below are places, and making them look alike
// was why "download" and "a board called Download" felt like the same thing.
function ActionTile({ theme, icon, tint, title, subtitle, onPress, busy = false, accessibilityLabel }) {
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ busy, disabled: busy }}
      onPressIn={() => { if (!busy) impactHaptic('medium'); }}
      onPress={onPress}
      style={[
        styles.actionTile,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: busy ? 0.6 : 1,
        },
      ]}
    >
      <View style={[styles.actionIcon, { backgroundColor: theme.colors.surfaceElevated || theme.colors.background }]}>
        {busy
          ? <ActivityIndicator size="small" color={tint} />
          : <Icon name={icon} size={20} color={tint} />}
      </View>
      <Text style={[styles.actionTitle, { color: theme.colors.textPrimary }]} numberOfLines={1}>
        {title}
      </Text>
      <Text style={[styles.actionSubtitle, { color: theme.colors.textMuted }]} numberOfLines={1}>
        {subtitle}
      </Text>
    </TouchableOpacity>
  );
}

// ── Header ───────────────────────────────────────────────────
function Header({ onDismiss, title, theme }) {
  return (
    <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
      <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>{title}</Text>
      <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={[styles.headerCancel, { color: theme.colors.primary }]}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── LinkCard ─────────────────────────────────────────────────
// A shared link, rendered the way every messaging app renders one: thumbnail,
// headline, one-line summary, source. The raw address is reduced to the
// hostname — a share of a Facebook permalink is 300 characters of tracking
// parameters, and showing that verbatim told the user nothing about what they
// were sending while burying the rest of the sheet.
//
// Three states, and each is a complete card rather than a placeholder:
//   • metadata resolved  → thumbnail + title + description + host
//   • still unfurling    → host + a spinner on the title line
//   • unfurl failed/none → host alone, which is the honest answer
function LinkCard({ url, preview, busy, theme }) {
  let host = preview?.host || '';
  if (!host) {
    // Cheap client-side fallback so the card is never empty on the first frame
    // (or when the page can't be unfurled at all).
    const m = /^https?:\/\/(?:www\.)?([^/?#]+)/i.exec(url || '');
    host = m ? m[1] : (url || '');
  }
  const title = preview?.title || '';
  const description = preview?.description || '';
  const isVideo = preview?.mediaType === 'video';

  return (
    <View style={[styles.linkCard, { backgroundColor: theme.colors.surfaceElevated || theme.colors.background }]}>
      {!!preview?.thumbUrl && (
        <View>
          <Image
            source={{ uri: preview.thumbUrl }}
            style={styles.linkThumb}
            resizeMode="cover"
          />
          {/* Play glyph on a video link, same affordance as a chat preview —
              it isn't playable here, it just tells you what you're saving. */}
          {isVideo && (
            <View style={styles.linkPlayBadge}>
              <Icon name="play" size={18} color="#fff" />
            </View>
          )}
        </View>
      )}
      <View style={styles.linkBody}>
        <View style={styles.linkHostRow}>
          <Icon name="link-variant" size={13} color={theme.colors.textMuted} />
          <Text style={[styles.linkHost, { color: theme.colors.textMuted }]} numberOfLines={1}>
            {preview?.siteName || host}
          </Text>
          {busy && !preview && <ActivityIndicator size="small" color={theme.colors.textMuted} />}
        </View>
        <Text
          style={[styles.linkTitle, { color: theme.colors.textPrimary }]}
          numberOfLines={2}
        >
          {title || host}
        </Text>
        {!!description && (
          <Text
            style={[styles.linkDescription, { color: theme.colors.textMuted }]}
            numberOfLines={2}
          >
            {description}
          </Text>
        )}
      </View>
    </View>
  );
}

// ── SharePreview ─────────────────────────────────────────────
// Compact summary of the share payload at the top of the screen, so
// the user can confirm what they're about to send.
function SharePreview({ text, url, preview, previewBusy, imageFiles, mediaFiles, theme }) {
  const hasImages = imageFiles.length > 0;
  const hasMedia = mediaFiles.length > 0;
  const hasText = !!text;
  const hasUrl = !!url;

  return (
    <View
      style={[
        styles.preview,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}
    >
      {hasImages && (
        <>
          {/* Count header so a big multi-select reads at a glance — tapping a
              board below sends all of them ("Send 8 photos"). */}
          <View style={styles.previewCountRow}>
            <Icon name="image-multiple" size={16} color={theme.colors.textSecondary} />
            <Text style={[styles.previewCount, { color: theme.colors.textPrimary }]}>
              {imageFiles.length === 1 ? 'Send 1 photo' : `Send ${imageFiles.length} photos`}
            </Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
          >
            {imageFiles.map((f, i) => (
              <Image
                key={i}
                source={{ uri: f.path }}
                style={styles.previewThumb}
                resizeMode="cover"
              />
            ))}
          </ScrollView>
        </>
      )}
      {hasMedia && (
        <View style={styles.previewRow}>
          <Icon name="music-note-plus" size={16} color={theme.colors.textSecondary} />
          <Text style={{ color: theme.colors.textPrimary, flex: 1, fontSize: 13 }}>
            {mediaFiles.length === 1
              ? `Send ${mediaFiles[0]?.fileName || '1 audio/video file'}`
              : `Send ${mediaFiles.length} audio/video files`}
          </Text>
        </View>
      )}
      {hasUrl && (
        <LinkCard url={url} preview={preview} busy={previewBusy} theme={theme} />
      )}
      {hasText && (
        <View style={styles.previewRow}>
          <Icon name="text" size={16} color={theme.colors.textSecondary} />
          <Text
            style={{ color: theme.colors.textPrimary, flex: 1, fontSize: 13, lineHeight: 18 }}
            numberOfLines={4}
          >
            {text}
          </Text>
        </View>
      )}
      {!hasImages && !hasMedia && !hasText && !hasUrl && (
        <Text style={{ color: theme.colors.textMuted, fontSize: 13, fontStyle: 'italic' }}>
          Empty share
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  headerCancel: { fontSize: 15, fontWeight: '500' },
  scrollContent: { padding: 16, paddingBottom: 40 },
  preview: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginBottom: 18,
    gap: 8,
  },
  previewRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  previewCountRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  previewCount: { fontSize: 13, fontWeight: '600' },
  previewThumb: { width: 88, height: 88, borderRadius: 8, backgroundColor: '#222' },
  // Link card. The thumbnail is edge-to-edge inside the card (overflow hidden
  // clips it to the rounded corners) with the text block below it, which is the
  // shape every chat app uses for a link and therefore the one that reads as
  // "this is the page you're about to save".
  linkCard: { borderRadius: 10, overflow: 'hidden' },
  // 16:9 keeps og:image at its native aspect for the overwhelming majority of
  // pages, so the crop doesn't cut the subject out of the frame.
  linkThumb: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#222' },
  linkPlayBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkBody: { padding: 10, gap: 3 },
  linkHostRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  linkHost: { fontSize: 11, fontWeight: '600', textTransform: 'lowercase', flexShrink: 1 },
  linkTitle: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  linkDescription: { fontSize: 12, lineHeight: 16 },
  // The three top actions. Equal-width tiles so no option looks like the
  // default, and tall enough that the label + one line of explanation both fit
  // without truncating on a narrow phone.
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  actionTile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTitle: { fontSize: 13.5, fontWeight: '700' },
  actionSubtitle: { fontSize: 10.5, fontWeight: '500' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 8,
  },
  // Icon + label on one baseline, for the section headers that carry a glyph.
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  boardIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boardName: { fontSize: 15, fontWeight: '500' },
  boardKind: { fontSize: 11, marginTop: 2 },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 14,
  },
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 32,
    gap: 12,
  },
  centerTitle: { fontSize: 17, fontWeight: '600' },
  centerBody: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
});

