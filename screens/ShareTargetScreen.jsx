/**
 * ShareTargetScreen
 *
 * Rendered when the OS launches the app via the iOS / Android Share
 * sheet. Receives a payload from expo-share-intent (text, URL, or
 * image files) and lets the user pick a pinned Board destination.
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
 *   - When the user taps a board, we POST to /api/share with base64-
 *     encoded image data (one request for the whole payload).
 *   - On success we show a checkmark briefly, then call
 *     resetShareIntent() which returns control to the normal app.
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
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as FileSystem from 'expo-file-system/legacy';
import { useTheme } from '../context/ThemeContext';
import { useServer } from '../context/ServerContext';

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
  project: 'Project',
  tag: 'Tag',
  album: 'Album',
};

export default function ShareTargetScreen({ shareIntent, onDismiss }) {
  const { theme, isDark } = useTheme();
  const { api, serverIP, isConnected } = useServer();

  // ── State ────────────────────────────────────────────────────
  const [boards, setBoards] = useState([]);
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [boardsError, setBoardsError] = useState(null);
  // 'idle' | 'sending' | 'success' | 'error'  — drives the visual state
  // of the screen after the user picks a board.
  const [phase, setPhase] = useState('idle');
  const [phaseError, setPhaseError] = useState(null);
  const [selectedBoardKey, setSelectedBoardKey] = useState(null);

  // ── Derived: what is actually being shared? ─────────────────
  // expo-share-intent normalizes the payload across iOS/Android into
  // { text, webUrl, files } where files is an array of native file
  // objects with { path, mimeType, fileName }.
  const text = shareIntent?.text || null;
  const url = shareIntent?.webUrl || null;
  const files = Array.isArray(shareIntent?.files) ? shareIntent.files : [];
  const imageFiles = files.filter((f) => (f?.mimeType || '').startsWith('image/'));
  const totalImages = imageFiles.length;

  // ── Fetch pinned boards on mount ────────────────────────────
  // Use ?pinned=1 so the picker shows the curated subset rather than
  // every tag in the database (potentially 100+).
  const loadPinned = useCallback(async () => {
    if (!isConnected) {
      setBoardsError('Not connected to the Turtle server.');
      return;
    }
    setLoadingBoards(true);
    setBoardsError(null);
    try {
      const res = await api.get('/boards?pinned=1');
      setBoards(Array.isArray(res?.boards) ? res.boards : []);
    } catch (e) {
      console.error('[Share] Failed to load boards:', e);
      setBoardsError(e.message || 'Failed to load destinations.');
    } finally {
      setLoadingBoards(false);
    }
  }, [api, isConnected]);

  useEffect(() => {
    loadPinned();
  }, [loadPinned]);

  // ── Build the share payload + POST ──────────────────────────
  // Reads every image file as base64 and bundles them into the JSON
  // body /api/share expects. We do this lazily (on board-tap) rather
  // than on mount because reading + base64-encoding 10MB photos
  // shouldn't happen for users who cancel.
  const sendToBoard = async (board) => {
    const key = `${board.kind}::${board.name}`;
    setSelectedBoardKey(key);
    setPhase('sending');
    setPhaseError(null);

    try {
      // 1. Convert any image files to base64. Each file is read
      //    independently so a single bad file doesn't kill the others
      //    (we log + skip rather than abort the whole share).
      const encodedImages = [];
      for (const f of imageFiles) {
        try {
          const data = await FileSystem.readAsStringAsync(f.path, { encoding: 'base64' });
          encodedImages.push({
            filename: f.fileName || `share-${Date.now()}.jpg`,
            mimeType: f.mimeType,
            dataBase64: data,
          });
        } catch (e) {
          console.warn('[Share] Failed to read', f.path, e.message);
        }
      }

      // 2. POST. The server endpoint returns { success, chatLogId,
      //    noteId?, mediaIds, imageUrls } on success.
      const body = {
        board: { kind: board.kind, name: board.name },
        payload: {
          text: text || undefined,
          url: url || undefined,
          images: encodedImages.length > 0 ? encodedImages : undefined,
        },
        channel: 'ios-share',
      };
      const res = await api.post('/share', body);
      if (!res?.success) {
        throw new Error(res?.error || 'Server rejected the share.');
      }

      // 3. Brief success affordance, then dismiss. The auto-dismiss
      //    keeps the share extension feeling lightweight — the user
      //    doesn't have to tap "done" themselves.
      setPhase('success');
      setTimeout(() => {
        onDismiss?.();
      }, 900);
    } catch (e) {
      console.error('[Share] POST failed:', e);
      setPhase('error');
      setPhaseError(e.message || 'Send failed.');
      // Leave the screen on error so the user can retry — they'll tap
      // a board again (or cancel).
      setSelectedBoardKey(null);
    }
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
          theme={theme}
        />

        {/* Status banner during error phase */}
        {phase === 'error' && phaseError && (
          <View style={[styles.errorBanner, { backgroundColor: 'rgba(248,113,113,0.10)', borderColor: 'rgba(248,113,113,0.3)' }]}>
            <Icon name="alert-circle-outline" size={16} color={theme.colors.accentError} />
            <Text style={{ color: theme.colors.accentError, flex: 1, fontSize: 13 }}>{phaseError}</Text>
          </View>
        )}

        {/* Boards picker */}
        <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
          Send to
        </Text>

        {loadingBoards && (
          <View style={styles.centerState}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        )}

        {boardsError && !loadingBoards && (
          <View style={[styles.errorBanner, { backgroundColor: 'rgba(248,113,113,0.10)', borderColor: 'rgba(248,113,113,0.3)' }]}>
            <Icon name="cloud-off-outline" size={16} color={theme.colors.accentError} />
            <Text style={{ color: theme.colors.accentError, flex: 1, fontSize: 13 }}>{boardsError}</Text>
            <TouchableOpacity onPress={loadPinned}>
              <Text style={{ color: theme.colors.accentError, fontWeight: '600', fontSize: 13 }}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loadingBoards && !boardsError && boards.length === 0 && (
          <View style={styles.centerState}>
            <Icon name="pin-outline" size={36} color={theme.colors.textMuted} />
            <Text style={[styles.centerTitle, { color: theme.colors.textPrimary, fontSize: 15 }]}>
              No pinned boards yet
            </Text>
            <Text style={[styles.centerBody, { color: theme.colors.textMuted, fontSize: 12 }]}>
              Open Turtle on the web, go to Settings → Share boards, and pin some projects, tags, or albums.
            </Text>
          </View>
        )}

        {!loadingBoards && boards.map((b) => {
          const key = `${b.kind}::${b.name}`;
          const isMe = selectedBoardKey === key;
          const sending = isMe && phase === 'sending';
          const succeeded = isMe && phase === 'success';
          // Disable other rows while a send is in flight so the user
          // can't double-tap two destinations.
          const disabled = phase === 'sending' && !isMe;
          return (
            <TouchableOpacity
              key={key}
              activeOpacity={0.75}
              onPress={() => sendToBoard(b)}
              disabled={disabled || sending || succeeded}
              style={[
                styles.boardRow,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  opacity: disabled ? 0.4 : 1,
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
              {/* Trailing affordance: arrow at rest, spinner during
                  send, checkmark on success. */}
              {sending ? (
                <ActivityIndicator size="small" color={theme.colors.primary} />
              ) : succeeded ? (
                <Icon name="check-circle" size={22} color={theme.colors.accentSuccess} />
              ) : (
                <Icon name="chevron-right" size={22} color={theme.colors.textMuted} />
              )}
            </TouchableOpacity>
          );
        })}
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
function SharePreview({ text, url, imageFiles, theme }) {
  const hasImages = imageFiles.length > 0;
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
      {!hasImages && !hasText && !hasUrl && (
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
  previewThumb: { width: 88, height: 88, borderRadius: 8, backgroundColor: '#222' },
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
