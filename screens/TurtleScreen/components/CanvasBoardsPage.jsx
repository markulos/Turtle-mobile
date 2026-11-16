/**
 * Your canvases, on the phone.
 *
 * Two levels, the same shape the Music vault's playlists use: this page lists
 * the boards, and one board opens as its own pushed page so a left-edge swipe
 * walks back out of it. The second level is an `overlay` EdgeSwipePage because
 * iOS silently never presents a second sibling Modal over an open one.
 *
 * ─── What this is, and what it is not ──────────────────────────────────────
 *
 * It is the real boards: the same `users.settings.canvasBoards` the desktop
 * writes, read through utils/useCanvasBoards. Arrange a canvas on the desktop
 * and it is here; there is no mobile copy of anything and no server change
 * behind it.
 *
 * It is READ-ONLY, on purpose, and the page says so rather than letting you
 * find out. The desktop saves by rewriting the whole boards array, last writer
 * wins — tolerable between two browser tabs, not with a phone in your pocket
 * beside a desktop you left open. Moving things from here waits on that being
 * fixed; see utils/canvasDoc.
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { useServer } from '../../../context/ServerContext';
import { TAP_ONLY } from '../../../utils/pressBehavior';
import { tapHaptic } from '../../../utils/haptics';
import { itemCountLabel } from '../../../utils/canvasDoc';
import { openPlanFor, rawFileUrl } from '../../../utils/canvasView';
import { isPdfName } from '../../../utils/fileBadge';
import { canRenderPdf } from '../../../utils/pdfRenderer';
import { useCanvasBoards } from '../../../utils/useCanvasBoards';
import EdgeSwipePage from './EdgeSwipePage';
import CanvasBoardView from './CanvasBoardView';
import PdfViewer from './FilesVault/PdfViewer';
import { shareDocument } from './FilesVault/documentOpen';
import AttachmentViewer from '../../../components/AttachmentViewer';
import { SCROLL_INDICATOR } from '../../../utils/scrollIndicator';

/** "Tuesday" / "12 Mar" — enough to tell which canvas you were last on. */
const whenLabel = (ms) => {
  const n = Number(ms) || 0;
  if (!n) return '';
  try {
    const d = new Date(n);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString(undefined, sameYear
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
};

export default function CanvasBoardsPage({ visible, onClose }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { api, getBaseUrl, getMediaBaseUrl } = useServer();
  const { boards, loaded, refreshing, refresh } = useCanvasBoards(api);

  // Media bytes ride the probed HTTP/2 origin when there is one — the same
  // choice every other picture in this vault makes, so a photo already in
  // expo-image's cache is a cache hit here too.
  const origin = (getMediaBaseUrl ? getMediaBaseUrl() : getBaseUrl()).replace(/\/api$/, '');

  const [openId, setOpenId] = useState(null);
  const open = boards.find((b) => b.id === openId) || null;

  // One picture, full screen. The viewer takes URLs, so nothing here has to
  // route through the media vault's own gallery.
  const [viewer, setViewer] = useState(null);
  /** The document a tap sent to the vault's reader, as a vault row. */
  const [reading, setReading] = useState(null);

  /**
   * A canvas item, as the vault's own document code expects one.
   *
   * The reader and the share sheet both take a media ROW (`ensureLocalCopy`
   * wants an id to cache under and a `rawUrl` to fetch), and a canvas item is
   * a far smaller thing — an id and a cached label. Everything else is
   * derivable: the stored file is named `<id><ext>` and lives under
   * /api/media/raw, which is what utils/canvasView's rawFileUrl is built on.
   */
  const asVaultRow = useCallback((item) => {
    const name = item.label || 'Document';
    return {
      id: item.ref,
      originalName: name,
      filename: name,
      rawUrl: rawFileUrl('', item.ref, name),
      mimeType: isPdfName(name) ? 'application/pdf' : 'application/octet-stream',
    };
  }, []);

  /**
   * A tap on an item, to wherever that item goes (openPlanFor decides, and
   * says why).
   *
   * This used to send all three kinds to the picture viewer, pointed at the
   * variant endpoint — which answers 400 for anything that is not an image, so
   * tapping a document opened a viewer that could never paint.
   */
  const openMedia = useCallback(async (item) => {
    if (!item?.ref) return;
    const name = item.label || '';
    const plan = openPlanFor(name, { canRender: canRenderPdf() });

    if (plan === 'read') {
      setReading(asVaultRow(item));
      return;
    }
    if (plan === 'share') {
      try {
        await shareDocument(asVaultRow(item), { getFullUrl: (p) => `${origin}${p}` });
      } catch {
        // The sheet refusing, or the pond being unreachable. Nothing to
        // recover and nothing worth a modal on a board you are browsing.
      }
      return;
    }
    const uri = `${origin}/api/media/display/${encodeURIComponent(item.ref)}`;
    setViewer({ images: [{ key: item.id, uri, previewUri: uri, name: item.label || null }], index: 0 });
  }, [asVaultRow, origin]);

  const renderBoard = useCallback(({ item }) => (
    <TouchableOpacity
      {...TAP_ONLY}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${itemCountLabel(item.items.length)}`}
      testID={`canvas-board-${item.id}`}
      onPress={() => { tapHaptic(); setOpenId(item.id); }}
      style={styles.row}
    >
      <View style={[styles.rowArt, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}>
        <Icon name="shape-outline" size={22} color={c.accentInk || c.textSecondary} />
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color: c.textPrimary }]} numberOfLines={1}>{item.name}</Text>
        <Text style={[styles.rowMeta, { color: c.textTertiary }]} numberOfLines={1}>
          {[itemCountLabel(item.items.length), whenLabel(item.updatedAt)].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Icon name="chevron-right" size={22} color={c.textTertiary} />
    </TouchableOpacity>
  ), [c]);

  return (
    // `overlay`, like the photos page it is mounted beside: this vault can
    // itself be presented inside a Modal, and iOS silently never presents a
    // second sibling Modal over an open one.
    <EdgeSwipePage overlay visible={visible} onClose={onClose} swipeEnabled={!open}>
      <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 6 }}>
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Back to the vault"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={() => { tapHaptic(); onClose?.(); }}
            style={styles.backBtn}
          >
            <Icon name="chevron-left" size={28} color={c.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={1}>Canvases</Text>
        </View>

        <FlatList {...SCROLL_INDICATOR}
          testID="canvas-boards-list"
          data={boards}
          keyExtractor={(b) => b.id}
          renderItem={renderBoard}
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.border }]} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
          refreshControl={(
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.textMuted} />
          )}
          ListEmptyComponent={(
            <View style={styles.empty}>
              {!loaded ? (
                <ActivityIndicator size="small" color={c.textMuted} />
              ) : (
                <>
                  <Icon name="shape-outline" size={40} color={c.textTertiary} />
                  <Text style={[styles.emptyText, { color: c.textSecondary }]}>
                    No canvases yet. Arrange one on the desktop and pull down here.
                  </Text>
                </>
              )}
            </View>
          )}
        />

        {/* One board. Its own pushed page, nested inside this one — the same
            construction the Music vault's playlists use, and `overlay` for the
            same reason: iOS will not present a second sibling Modal over an
            open one. */}
        {/* The board stops answering the back-swipe while the reader is over
            it: the reader has its own, and two pages taking one gesture means
            the board closes out from under the document. */}
        <EdgeSwipePage overlay visible={!!open} onClose={() => setOpenId(null)} swipeEnabled={!reading}>
          <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 6 }}>
            <View style={styles.header}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Back to the canvases"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                onPress={() => { tapHaptic(); setOpenId(null); }}
                style={styles.backBtn}
              >
                <Icon name="chevron-left" size={28} color={c.textPrimary} />
              </TouchableOpacity>
              <View style={styles.titleBlock}>
                <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={1}>
                  {open?.name || ''}
                </Text>
                {/* Said out loud, not discovered: this is a view of the board,
                    and the desktop is where it is arranged. */}
                <Text style={[styles.subtitle, { color: c.textTertiary }]} numberOfLines={1}>
                  Pinch to zoom · double-tap to fit · view only
                </Text>
              </View>
            </View>
            {open ? (
              <CanvasBoardView
                board={open}
                origin={origin}
                theme={theme}
                onOpenMedia={openMedia}
              />
            ) : null}
          </View>

          <AttachmentViewer
            visible={!!viewer}
            images={viewer?.images || []}
            index={viewer?.index || 0}
            onClose={() => setViewer(null)}
          />

          {/* The vault's reader, over the board — mounted only once a document
              has been tapped, so a board of photos never pays for it. */}
          {reading ? (
            <PdfViewer
              visible
              item={reading}
              onClose={() => setReading(null)}
              getFullUrl={(p) => `${origin}${p}`}
              theme={theme}
            />
          ) : null}
        </EdgeSwipePage>
      </View>
    </EdgeSwipePage>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingBottom: 10 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  titleBlock: { flex: 1, minWidth: 0 },
  title: { fontSize: 22, fontWeight: '600' },
  subtitle: { fontSize: 11.5, marginTop: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  rowArt: {
    width: 44, height: 44, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowMeta: { fontSize: 12, marginTop: 2 },
  sep: { height: StyleSheet.hairlineWidth, marginHorizontal: 16, opacity: 0.6 },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 80, paddingHorizontal: 40 },
  emptyText: { fontSize: 13.5, textAlign: 'center', lineHeight: 20 },
});
