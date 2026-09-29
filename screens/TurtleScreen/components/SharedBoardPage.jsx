/**
 * SharedBoardPage — a board somebody else gave you, opened.
 *
 * The receiving end of routes/albumAccess.js. Everything on this page comes
 * from ONE endpoint, `GET /api/shared-albums/:shareId/items`, and the share id
 * is the whole of the authorisation: the server pins the query to the owner
 * recorded on that row, so there is no parameter here — not the album name, not
 * a user id — that could widen what comes back. That is why this page sends the
 * id and nothing else.
 *
 * READ-ONLY ON PURPOSE. An album share carries permission 'view' and the server
 * stores nothing else today, so there is no select mode, no tagging, no delete
 * and no upload. The one thing you may do is hand the board back — "Leave" —
 * which is the recipient's half of DELETE /api/album-access/:id.
 *
 * Rendered as an EdgeSwipePage in OVERLAY mode, like ShareInsightsPage: the
 * vault already lives inside a Modal and iOS will not present a second sibling
 * Modal over an open one (see memory: ios-nested-pagesheet-modal-gotcha). The
 * lightbox below is in-tree for the same reason, and it turns the page's
 * back-swipe off while it is up so the edge gesture cannot close the page from
 * under an open photo.
 *
 * CHROME RULE: the floating tab dock paints over this in-tree page, so the grid
 * ends with `bottomInset` of clearance.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Dimensions, FlatList, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import EdgeSwipePage from './EdgeSwipePage';
import { tapHaptic, notifyHaptic } from '../../../utils/haptics';

const COLUMNS = 3;
const GAP = 2;
const PAGE_SIZE = 200;

/** A media row's best thumbnail, falling back the way the owner's own grid does. */
const thumbOf = (item) => item?.thumbnailUrl || item?.thumbnailLgUrl || item?.compressedUrl || item?.rawUrl;
/** …and its best full-size source, for the lightbox. */
const fullOf = (item) => item?.compressedUrl || item?.rawUrl || item?.thumbnailLgUrl || item?.thumbnailUrl;

/**
 * The lightbox. A horizontal pager over the same list the grid is showing —
 * deliberately NOT the vault's PhotoViewer, which is wired to the owner's
 * stores, edit actions and tag writes. None of those apply to a board you were
 * given, and borrowing that component would mean disabling most of it.
 */
function Lightbox({ items, index, onClose, onIndexChange, getFullUrl, theme }) {
  const { width, height } = Dimensions.get('window');
  const listRef = useRef(null);
  const c = theme.colors;

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', zIndex: 40 }]}>
      <FlatList
        ref={listRef}
        data={items}
        horizontal
        pagingEnabled
        initialScrollIndex={index}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        keyExtractor={(item) => `lb:${item.id}`}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const next = Math.round(e.nativeEvent.contentOffset.x / width);
          if (next !== index) onIndexChange(next);
        }}
        renderItem={({ item }) => (
          <Pressable onPress={onClose} style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
            {item.type === 'video' || item.type === 'audio' ? (
              // Playback is the owner's app. Here it is honest about what it is
              // rather than showing a still that pretends to be tappable.
              <View style={{ alignItems: 'center', gap: 10 }}>
                <MaterialCommunityIcons
                  name={item.type === 'video' ? 'play-circle-outline' : 'music-circle-outline'}
                  size={64}
                  color="#fff"
                />
                <Text style={{ color: '#fff', fontSize: 13 }} numberOfLines={1}>
                  {item.originalName || (item.type === 'video' ? 'Video' : 'Audio')}
                </Text>
              </View>
            ) : (
              <Image
                source={{ uri: getFullUrl(fullOf(item)) }}
                style={{ width, height }}
                contentFit="contain"
                transition={140}
                recyclingKey={`lb:${item.id}`}
              />
            )}
          </Pressable>
        )}
      />
      <Pressable
        onPress={onClose}
        hitSlop={14}
        accessibilityRole="button"
        accessibilityLabel="Close photo"
        style={{ position: 'absolute', top: 48, right: 18, width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.45)' }}
      >
        <MaterialCommunityIcons name="close" size={20} color="#fff" />
      </Pressable>
      <View style={{ position: 'absolute', bottom: 40, alignSelf: 'center' }}>
        <Text style={{ color: c.textSecondary || '#bbb', fontSize: 12 }}>
          {`${index + 1} of ${items.length}`}
        </Text>
      </View>
    </View>
  );
}

export default function SharedBoardPage({
  visible,
  /** The row from GET /api/shared-albums — carries the id, the name and the owner. */
  board,
  api,
  theme,
  getFullUrl,
  topInset = 0,
  bottomInset = 0,
  onClose,
  /** Called after the recipient leaves, so the strip behind stops listing it. */
  onLeft,
}) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null); // index, or null

  const shareId = board?.shareId;
  const { width } = Dimensions.get('window');
  const cell = Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS);
  const c = theme.colors;
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // Fresh read every open. A board you were given can gain photos, lose them,
  // or be taken back entirely between one look and the next.
  useEffect(() => {
    if (!visible || !shareId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setItems([]);
    setPage(1);
    setLightbox(null);
    (async () => {
      try {
        const res = await api.get(`/shared-albums/${shareId}/items?page=1&limit=${PAGE_SIZE}`);
        if (cancelled) return;
        setItems(res?.items || []);
        setTotal(res?.total || 0);
        setHasMore(!!res?.hasMore);
      } catch (e) {
        if (cancelled) return;
        // A 404 here is the honest case, not a bug: the owner revoked it, or
        // deleted the board, while you were looking at the card.
        setError(
          /not found/i.test(e?.message || '')
            ? 'This board is no longer shared with you.'
            : (e?.message || 'Could not open this board'),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, shareId, api]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const res = await api.get(`/shared-albums/${shareId}/items?page=${next}&limit=${PAGE_SIZE}`);
      // Concatenate by id rather than blindly: the owner adding a photo between
      // two page reads shifts the window, and a duplicate key crashes the list.
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...(res?.items || []).filter((i) => !seen.has(i.id))];
      });
      setHasMore(!!res?.hasMore);
      setPage(next);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [api, hasMore, loading, loadingMore, page, shareId]);

  const leave = useCallback(() => {
    Alert.alert(
      `Leave “${board?.album}”?`,
      `It will disappear from your vault. ${board?.ownerName || 'The owner'} can always share it again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/album-access/${shareId}`);
              notifyHaptic('success');
              onLeft?.(shareId);
              onClose?.();
            } catch (e) {
              Alert.alert('Could not leave', e?.message || 'Please try again.');
            }
          },
        },
      ],
    );
  }, [api, board, onClose, onLeft, shareId]);

  return (
    <EdgeSwipePage overlay visible={visible} onClose={onClose} swipeEnabled={lightbox === null}>
      <View style={[styles.page, { paddingTop: topInset }]}>
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back to boards"
            style={styles.headerBack}
          >
            <MaterialCommunityIcons name="chevron-left" size={28} color={c.textPrimary} />
          </Pressable>
          <View style={styles.headerTitleSlot}>
            <Text style={styles.headerTitle} numberOfLines={1}>{board?.album}</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {`From ${board?.ownerName || 'someone in your pond'}${total ? ` · ${total} item${total === 1 ? '' : 's'}` : ''}`}
            </Text>
          </View>
          <Pressable
            testID="shared-board-leave"
            onPress={() => { tapHaptic(); leave(); }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Leave ${board?.album}`}
            style={styles.headerAction}
          >
            <MaterialCommunityIcons name="exit-to-app" size={20} color={c.textSecondary} />
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={c.textSecondary} />
        ) : error ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{error}</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {`${board?.ownerName || 'The owner'} hasn’t put anything in this board yet.`}
            </Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            numColumns={COLUMNS}
            columnWrapperStyle={{ gap: GAP }}
            contentContainerStyle={{ gap: GAP, paddingBottom: bottomInset + 24 }}
            onEndReached={loadMore}
            onEndReachedThreshold={0.6}
            ListFooterComponent={loadingMore
              ? <ActivityIndicator style={{ marginVertical: 16 }} color={c.textSecondary} />
              : null}
            renderItem={({ item, index }) => (
              <Pressable
                testID={`shared-item-${item.id}`}
                onPress={() => { tapHaptic(); setLightbox(index); }}
                accessibilityRole="imagebutton"
                accessibilityLabel={item.originalName || 'Photo'}
                style={{ width: cell, height: cell, backgroundColor: c.surfaceHighlight }}
              >
                <Image
                  source={{ uri: getFullUrl(thumbOf(item)) }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
                  transition={120}
                  recyclingKey={`shared:${item.id}`}
                />
                {item.type === 'video' || item.type === 'audio' ? (
                  <View style={styles.kindBadge}>
                    <MaterialCommunityIcons
                      name={item.type === 'video' ? 'play' : 'music-note'}
                      size={11}
                      color="#fff"
                    />
                  </View>
                ) : null}
              </Pressable>
            )}
          />
        )}

        {lightbox !== null && items.length ? (
          <Lightbox
            items={items}
            index={lightbox}
            onIndexChange={setLightbox}
            onClose={() => setLightbox(null)}
            getFullUrl={getFullUrl}
            theme={theme}
          />
        ) : null}
      </View>
    </EdgeSwipePage>
  );
}

const makeStyles = (theme) => {
  const c = theme.colors;
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 10, gap: 4 },
    headerBack: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
    headerTitleSlot: { flex: 1, minWidth: 0 },
    headerTitle: { fontSize: 19, fontWeight: '700', color: c.textPrimary },
    headerSubtitle: { fontSize: 12, color: c.textTertiary || c.textSecondary, marginTop: 1 },
    headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    empty: { paddingHorizontal: 28, paddingTop: 48, alignItems: 'center' },
    emptyText: { fontSize: 13.5, color: c.textSecondary, textAlign: 'center', lineHeight: 19 },
    kindBadge: {
      position: 'absolute', right: 4, bottom: 4,
      width: 18, height: 18, borderRadius: 9,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.5)',
    },
  });
};
