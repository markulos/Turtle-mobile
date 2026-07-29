/**
 * ShareTargetScreen
 *
 * Rendered when the OS launches the app via the iOS / Android Share
 * sheet. Receives a payload from expo-share-intent (text, URL, or
 * image files) and lets the user pick a Board destination.
 *
 * Destinations:
 *   - Pinned boards surface first under "Suggested" as quick-send rows
 *     (one tap → sent), so the common case stays a single tap.
 *   - The full universe of boards (every project / tag / album) is listed
 *     below under "All boards", with a search box so a destination that
 *     isn't pinned is still a couple of keystrokes away — no need to go
 *     pin it on the web first.
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
  const pinned = visibleBoards.filter((b) => b.isPinned);
  const unpinned = visibleBoards.filter((b) => !b.isPinned);
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
  const pickBoard = (board) => {
    if (!hasStandardContent) return;
    notifyHaptic('success');
    enqueueShare({ board, text, url, imageFiles });
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
  const renderBoard = (b) => {
    const key = `${b.kind}::${b.name}`;
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
            borderColor: theme.colors.border,
          },
        ]}
      >
        <View style={[styles.boardIcon, { backgroundColor: theme.colors.surfaceElevated || theme.colors.surface }]}>
          <Icon
            name={KIND_ICONS[b.kind] || 'circle-outline'}
            size={18}
            color={theme.colors.textSecondary}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.boardName, { color: theme.colors.textPrimary }]} numberOfLines={1}>
            {b.name}
          </Text>
          <Text style={[styles.boardKind, { color: theme.colors.textMuted }]}>
            {KIND_LABELS[b.kind] || b.kind}
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
          text={text}
          url={url}
          imageFiles={imageFiles}
          mediaFiles={mediaFiles}
          theme={theme}
        />

        {showAudioDestination && (
          <TouchableOpacity
            key="__music_vault__"
            activeOpacity={0.75}
            accessibilityLabel="Audio — Save to Music Vault"
            accessibilityState={{ busy: audioHandoffBusy, disabled: audioHandoffBusy }}
            disabled={audioHandoffBusy}
            onPressIn={() => {
              if (!audioHandoffInFlightRef.current) impactHaptic('medium');
            }}
            onPress={pickAudio}
            style={[
              styles.boardRow,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.accentSuccess,
                opacity: audioHandoffBusy ? 0.65 : 1,
              },
            ]}
          >
            <View style={[styles.boardIcon, { backgroundColor: theme.colors.surfaceElevated || theme.colors.surface }]}>
              <Icon name="music-box-multiple" size={18} color={theme.colors.accentSuccess} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.boardName, { color: theme.colors.textPrimary }]} numberOfLines={1}>
                Audio
              </Text>
              <Text style={[styles.boardKind, { color: theme.colors.textMuted }]}>
                Save to Music Vault
              </Text>
            </View>
            {audioHandoffBusy ? (
              <ActivityIndicator size="small" color={theme.colors.accentSuccess} />
            ) : (
              <Icon name="chevron-right" size={22} color={theme.colors.accentSuccess} />
            )}
          </TouchableOpacity>
        )}

        {!!handoffError && (
          <View style={[styles.errorBanner, { backgroundColor: 'rgba(248,113,113,0.10)', borderColor: 'rgba(248,113,113,0.3)' }]}>
            <Icon name="alert-circle-outline" size={16} color={theme.colors.accentError} />
            <Text style={{ color: theme.colors.accentError, flex: 1, fontSize: 13 }}>{handoffError}</Text>
          </View>
        )}

        {/* DEFAULT destination for photo shares: straight into the photo
            vault, as-is, no board tag. Pinned above every board so sharing
            from the iOS Photos app is one tap. board:null → the server files
            the images untagged (uploadDate = now, originalDate = EXIF). */}
        {imageFiles.length > 0 && (
          <TouchableOpacity
            key="__photo_vault__"
            activeOpacity={0.75}
            onPressIn={() => impactHaptic('medium')}
            onPress={() => pickBoard(null)}
            style={[
              styles.boardRow,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.accentInfo,
              },
            ]}
          >
            <View style={[styles.boardIcon, { backgroundColor: theme.colors.surfaceElevated || theme.colors.surface }]}>
              <Icon name="image-multiple" size={18} color={theme.colors.accentInfo} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.boardName, { color: theme.colors.textPrimary }]} numberOfLines={1}>
                Photo vault
              </Text>
              <Text style={[styles.boardKind, { color: theme.colors.textMuted }]}>
                Save as-is · no board
              </Text>
            </View>
            <Icon name="chevron-right" size={22} color={theme.colors.accentInfo} />
          </TouchableOpacity>
        )}

        {/* Search box — find any board (even unpinned) OR name a new one to
            create. Shown as soon as we have anything to show (cached list paints
            instantly); hidden only while the FIRST load is running with nothing
            cached, or on a hard error. */}
        {hasStandardContent && !busyEmpty && !boardsError && (
          <View style={[styles.searchBox, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Icon name="magnify" size={18} color={theme.colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search or name a new board"
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

        {hasStandardContent && !busyEmpty && !boardsError && visibleBoards.length === 0 && !q && (
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
                {matches.map(renderBoard)}
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

        {/* Not searching → Suggested (pinned, quick-send) then All boards. */}
        {hasStandardContent && !busyEmpty && !boardsError && !matches && visibleBoards.length > 0 && (
          <>
            {pinned.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                  Suggested
                </Text>
                {pinned.map(renderBoard)}
              </>
            )}
            {unpinned.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary, marginTop: pinned.length > 0 ? 18 : 0 }]}>
                  All boards
                </Text>
                {unpinned.map(renderBoard)}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
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

// ── SharePreview ─────────────────────────────────────────────
// Compact summary of the share payload at the top of the screen, so
// the user can confirm what they're about to send.
function SharePreview({ text, url, imageFiles, mediaFiles, theme }) {
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
        <View style={styles.previewRow}>
          <Icon name="link-variant" size={16} color={theme.colors.textSecondary} />
          <Text
            style={{ color: theme.colors.textPrimary, flex: 1, fontSize: 13 }}
            numberOfLines={2}
          >
            {url}
          </Text>
        </View>
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
