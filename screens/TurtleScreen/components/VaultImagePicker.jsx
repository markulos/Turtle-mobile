/**
 * VaultImagePicker — "pick a photo from Turtle", the second source for the
 * composer's image key.
 *
 * The composer could only ever reach the PHONE's camera roll, which is the
 * wrong library for half the things you want to show Claude: the photo is
 * already in the vault, on the server, and may never have been on this phone
 * at all (another pond member uploaded it, or it came off a camera). This is
 * the same picker shape as the system one — a grid of recent photos, tap to
 * choose — over the vault instead.
 *
 * IN-TREE overlay (absolute + high zIndex), NOT a Modal, for the same reason
 * MediaLightbox is: the chat mounts its own overlays, and on iOS a sibling
 * Modal over an open Modal silently fails to present.
 *
 * Deliberately NOT MediaGallery. That component is the vault — six thousand
 * lines of virtual paging, HD warming, filters and share flows — and none of
 * it is wanted for "show me my recent photos so I can pick one". This asks the
 * same endpoint for one page at a time and draws squares.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { buildGalleryUrl } from '../../../utils/galleryFilters';
import { tapHaptic } from '../../../utils/haptics';

const COLS = 3;
const GAP = 2;
const PAGE = 60;
const CELL = (Dimensions.get('window').width - GAP * (COLS - 1)) / COLS;
const HIT_SLOP_12 = { top: 12, bottom: 12, left: 12, right: 12 };

// Photos only, newest first. A video cannot be attached to a Claude turn, so
// offering one here would be offering a dead end.
//
// The values are the ones normalizeFilters actually accepts — 'photo', not
// 'image', and a sortBy from ['original','upload']. Anything else is dropped
// SILENTLY back to the default, and the default mediaType is 'all': a typo
// here doesn't fail, it just quietly fills the picker with videos.
const IMAGE_FILTERS = { mediaType: 'photo', sortBy: 'original', direction: 'desc' };

function Cell({ item, thumbUrl, onToggle, order, accent }) {
  const picked = order > 0;
  return (
    <Pressable
      style={({ pressed }) => [styles.cell, { opacity: pressed ? 0.7 : 1 }]}
      onPress={() => { tapHaptic(); onToggle(item); }}
      accessibilityRole="imagebutton"
      accessibilityState={{ selected: picked }}
      accessibilityLabel={item.filename || 'Vault photo'}
    >
      <Image
        source={{ uri: thumbUrl }}
        style={StyleSheet.absoluteFillObject}
        contentFit="cover"
        transition={120}
        cachePolicy="memory-disk"
        recyclingKey={String(item.id)}
      />
      {/* Numbered, not ticked: the number is the order they will be attached
          in, which is the order Claude will see them. With several photos of
          one thing, that order is usually the point. */}
      {picked ? (
        <>
          <View style={styles.cellPickedWash} pointerEvents="none" />
          <View style={[styles.cellBadge, { backgroundColor: accent }]} pointerEvents="none">
            <Text style={styles.cellBadgeText}>{order}</Text>
          </View>
        </>
      ) : null}
    </Pressable>
  );
}

export default function VaultImagePicker({ visible, onClose, onPick, theme, api, getFullUrl, maxSelection = 8 }) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Chosen ids, IN THE ORDER THEY WERE TAPPED — the order they'll be attached
  // in, and the order Claude will read them.
  const [picked, setPicked] = useState([]);
  // Paging is offset-based and one request deep: `exhausted` stops us asking
  // for a page past the end every time the user hits the bottom.
  const offsetRef = useRef(0);
  const exhaustedRef = useRef(false);
  const inFlightRef = useRef(false);

  const loadPage = useCallback(async (reset = false) => {
    if (inFlightRef.current) return;
    if (!reset && exhaustedRef.current) return;
    inFlightRef.current = true;
    if (reset) { offsetRef.current = 0; exhaustedRef.current = false; }
    setLoading(true);
    try {
      const url = buildGalleryUrl(IMAGE_FILTERS, { limit: PAGE, offset: offsetRef.current });
      const res = await api.get(url);
      const raw = (res && res.success && Array.isArray(res.items)) ? res.items : [];
      // Belt and braces over the mediaType filter: a row that reaches here as
      // a video is not something the composer can send.
      const page = raw.filter((it) => it && it.type !== 'video');
      // Paging is counted in ROWS THE SERVER RETURNED, not rows we kept: the
      // offset is its cursor, and advancing it by the filtered count would ask
      // for the same rows again and duplicate keys down the list.
      if (raw.length < PAGE) exhaustedRef.current = true;
      offsetRef.current += raw.length;
      setItems((prev) => (reset ? page : [...prev, ...page]));
      setError(null);
    } catch (e) {
      setError(e?.message || 'Could not load your photos');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [api]);

  // Fetch on OPEN, not on mount: the picker is mounted for the life of the
  // chat and opened rarely, and a stale page is worse than a fresh fetch that
  // costs one request.
  useEffect(() => {
    if (!visible) return;
    setItems([]);
    setPicked([]);
    loadPage(true);
  }, [visible, loadPage]);

  const toggle = useCallback((item) => {
    setPicked((prev) => {
      if (prev.includes(item.id)) return prev.filter((id) => id !== item.id);
      // Silently ignoring the tap past the cap would read as a broken cell, so
      // the count in the Add key is the only thing that stops moving — and it
      // says how many of how many.
      if (prev.length >= maxSelection) return prev;
      return [...prev, item.id];
    });
  }, [maxSelection]);

  const confirm = useCallback(() => {
    const byId = new Map(items.map((it) => [it.id, it]));
    onPick(picked.map((id) => byId.get(id)).filter(Boolean));
  }, [items, picked, onPick]);

  // Android back closes the picker, not the chat behind it.
  useEffect(() => {
    if (!visible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose?.(); return true; });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!visible) return null;

  const c = theme.colors;
  const empty = !loading && items.length === 0;

  return (
    <View style={[styles.overlay, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 6, borderBottomColor: c.border }]}>
        <Pressable
          onPress={onClose}
          hitSlop={HIT_SLOP_12}
          style={styles.headerKey}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Icon name="close" size={24} color={c.textPrimary} />
        </Pressable>
        <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={1}>Turtle photos</Text>
        {/* Add — lit only once something is chosen. Pressing it is what ends
            the picker; tapping a photo selects, it does not commit, because
            the whole point is being able to choose several. */}
        <Pressable
          onPress={confirm}
          disabled={picked.length === 0}
          hitSlop={HIT_SLOP_12}
          style={styles.headerAdd}
          accessibilityRole="button"
          accessibilityState={{ disabled: picked.length === 0 }}
          accessibilityLabel={picked.length ? `Attach ${picked.length} photo${picked.length === 1 ? '' : 's'}` : 'Attach — choose a photo first'}
          testID="vault-picker-add"
        >
          <Text
            style={[styles.headerAddText, { color: picked.length ? (c.accentInfo || c.primary || c.textPrimary) : c.textMuted }]}
            numberOfLines={1}
          >
            {picked.length ? `Add ${picked.length}` : 'Add'}
          </Text>
        </Pressable>
      </View>

      {empty ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: c.textSecondary }]}>
            {error || 'No photos in your vault yet.'}
          </Text>
          {error ? (
            <Pressable
              onPress={() => loadPage(true)}
              style={[styles.retry, { backgroundColor: c.surfaceElevated }]}
              accessibilityRole="button"
              accessibilityLabel="Retry loading your photos"
            >
              <Text style={[styles.retryText, { color: c.textPrimary }]}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <FlatList
          testID="vault-picker-grid"
          data={items}
          keyExtractor={(item) => String(item.id)}
          numColumns={COLS}
          columnWrapperStyle={styles.row}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          renderItem={({ item }) => (
            <Cell
              item={item}
              // The grid's own small derivative — never the raw, which on an
              // unmigrated row can be a 25MB HEIC.
              thumbUrl={getFullUrl(item.thumbnailUrl || item.compressedUrl || item.url)}
              onToggle={toggle}
              order={picked.indexOf(item.id) + 1}
              accent={c.accentInfo || c.primary || '#4ADE80'}
            />
          )}
          onEndReachedThreshold={0.6}
          onEndReached={() => loadPage(false)}
          ListFooterComponent={loading && items.length > 0 ? (
            <View style={styles.footer}><ActivityIndicator size="small" color={c.textMuted} /></View>
          ) : null}
        />
      )}

      {loading && items.length === 0 ? (
        <View style={styles.centreSpinner} pointerEvents="none">
          <ActivityIndicator size="large" color={c.textMuted} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1100,
    elevation: 1100,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerKey: { width: 44, height: 36, alignItems: 'center', justifyContent: 'center' },
  // Sized to the widest label it takes ("Add 8"), so the centred title doesn't
  // shift sideways as the count changes.
  headerAdd: { minWidth: 62, height: 36, paddingHorizontal: 6, alignItems: 'flex-end', justifyContent: 'center' },
  headerAddText: { fontSize: 15, fontWeight: '700' },
  title: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700' },
  row: { gap: GAP, marginBottom: GAP },
  cell: { width: CELL, height: CELL, overflow: 'hidden', backgroundColor: 'rgba(127,127,127,0.12)' },
  // Dims a chosen photo so the badge reads against a bright one and the
  // selection is visible at a glance across the grid.
  cellPickedWash: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  cellBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellBadgeText: { color: '#0B0B0C', fontSize: 12, fontWeight: '800' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 },
  emptyText: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 22 },
  retryText: { fontSize: 15, fontWeight: '700' },
  footer: { paddingVertical: 18, alignItems: 'center' },
  centreSpinner: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
