import React, { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PhotoVaultBoardCard from './PhotoVaultBoardCard';
import {
  HIT_SLOP_8,
  PICKER_GAP,
  ROW_COVER,
  SEARCH_ENTER,
  SEARCH_EXIT,
  VaultResultRow,
  VaultSearchDock,
  useVaultSearch,
} from './VaultSearchDock';

// Re-exported because MediaGallery imports them from here: the vault header
// slides away on the same curve this page lifts on. They are defined once, in
// the dock both vault tabs share.
export { SEARCH_ENTER, SEARCH_EXIT };

const SORTS = [
  { mode: 'recent', label: 'Recent', icon: 'clock-outline' },
  { mode: 'alphabetical', label: 'A–Z', icon: 'sort-alphabetical-ascending' },
  { mode: 'largest', label: 'Largest', icon: 'image-multiple-outline' },
];

// Grid proportions taken from the Pinterest boards reference (1170px wide @3x,
// i.e. a 390pt screen): cards sit 20px (≈7pt) from the screen edges with the
// same 20px between columns, which lands each card at ~185pt.
const EDGE_PAD = 7;
const COLUMN_GAP = 7;
// Long-press does nothing on All Photos: it is not renameable or deletable.
const NOOP = () => {};
const CARD_WIDTH = (Dimensions.get('window').width - EDGE_PAD * 2 - COLUMN_GAP) / 2;
const LOAD_ERROR_COPY = 'Unable to load boards';
const REFRESH_ERROR_COPY = 'Couldn’t refresh boards.';

/**
 * One search result, in the vault's shared row (VaultSearchDock): cover square,
 * name, count. The leading square and the shared dot are this page's; the shape
 * around them is the same one the Files tab's folder results use.
 */
const BoardRow = React.memo(function BoardRow({ board, theme, resolveCoverUrl, onPress, onLongPress, onPressIn }) {
  const cover = board.covers?.[0];
  return (
    <VaultResultRow
      theme={theme}
      name={board.name}
      meta={`${board.itemLabel ?? board.metadata}${board.recency ? `  ${board.recency}` : ''}`}
      accessibilityLabel={`${board.name}, ${board.count} item${board.count === 1 ? '' : 's'}${board.isLive ? ', shared on the web' : ''}`}
      onPress={() => onPress(board.name)}
      onLongPress={() => onLongPress(board.name)}
      onPressIn={onPressIn}
      leading={cover ? (
        <Image
          source={{ uri: resolveCoverUrl(cover) }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          transition={120}
          recyclingKey={`row:${cover}`}
        />
      ) : (
        <Icon name="image-multiple-outline" size={20} color={theme.colors.textMuted} />
      )}
      trailing={board.isLive ? (
        <View style={[styles.rowSharedDot, { backgroundColor: theme.colors.accentInfo || theme.colors.primary }]} />
      ) : null}
    />
  );
});

function BoardSkeleton({ index, theme }) {
  return (
    <View testID={`board-skeleton-${index}`} style={[styles.skeleton, { width: CARD_WIDTH }]}>
      <View style={[styles.skeletonCollage, { backgroundColor: theme.colors.surfaceElevated }]} />
      <View style={[styles.skeletonLine, { backgroundColor: theme.colors.surfaceHighlight }]} />
      <View style={[styles.skeletonMeta, { backgroundColor: theme.colors.surface }]} />
    </View>
  );
}

const PhotoVaultBoardsPage = forwardRef(({
  boards,
  allPhotos,
  onOpenAllPhotos,
  loading,
  error,
  hasLoadedAlbums = false,
  query,
  sortMode,
  theme,
  topInset,
  resolveCoverUrl,
  onQueryChange,
  onSortModeChange,
  onAdd,
  onRetry,
  onOpenBoard,
  onLongPressBoard,
  onCardPressIn,
  onOpenShareInsights,
  // The cog at the right of every board's caption — opens that board's sharing
  // card (people + the public link, in one place).
  onOpenShareSettings,
  // Origin for relative avatar paths on the shared-with faces.
  baseUrl,
  onScroll,
  onContentSizeChange,
  onLayout,
  // Fires when the page enters / leaves search mode, so the vault's title +
  // Boards/Music tabs can stand down and let the field rise to the top.
  onSearchActiveChange,
  // The top inset the page keeps while SEARCHING — the bare safe area, once
  // the vault header has slid away. The difference between this and `topInset`
  // is how far the page lifts.
  searchTopInset,
  // POINTS the chrome is currently pushed off the top, tracking the scroll
  // one-for-one (utils/scrollChrome). Pixels rather than a 0→1 progress so the
  // dock and the header above it move at the SAME rate as each other and as
  // the finger, instead of each covering its own distance in the same time.
  chromePx,
  // Reports the measured dock height up, so the parent can cap the travel
  // budget at the larger of the two things that hide.
  onDockHeight,
}, ref) => {
  const visibleBoards = hasLoadedAlbums ? boards : [];
  const onPrimary = theme.colors.onPrimary ?? theme.colors.background;
  // Measured so the list can reserve exactly the dock's height and the dock can
  // travel exactly its own height when it hides — no guesses, no gap.
  const [dockH, setDockH] = useState(0);

  // ── The lift ────────────────────────────────────────────────────────────
  // How far the page rises when search takes over: exactly the height of the
  // vault header it is being allowed to use (topInset covers that header;
  // searchTopInset is the bare safe area left once it has gone).
  //
  // The mode, the lift, the exit glide and the dock's geometry all live in
  // VaultSearchDock now — this page and the Files tab are the same search, so
  // they are the same code. What stays here is what is actually about BOARDS:
  // which list is on screen, the sort chips, the pinned All Photos card.
  const lift = Math.max(0, topInset - (searchTopInset ?? topInset));
  const search = useVaultSearch({
    query,
    items: visibleBoards,
    onQueryChange,
    onSearchActiveChange,
    lift,
  });
  const { searching, displayQuery, displayItems: displayBoards } = search;

  /**
   * Opening a result ends the typing, so the keyboard goes — the board you were
   * hunting for is about to fill the screen and nothing is left to type into.
   * `keyboardShouldPersistTaps="handled"` means the tap lands on the row with
   * the keyboard still up, so it has to be dismissed here rather than by the
   * usual tap-outside.
   *
   * Only the KEYBOARD, though — deliberately not the whole search. Search mode
   * survives (same reason the field has no onBlur exit): come back from the
   * board and your query and its results are still there to pick the next one
   * from, instead of a page that threw the search away behind your back.
   */
  const openBoard = useCallback((name) => {
    Keyboard.dismiss();
    onOpenBoard(name);
  }, [onOpenBoard]);

  const openAllPhotos = useCallback((name) => {
    Keyboard.dismiss();
    onOpenAllPhotos(name);
  }, [onOpenAllPhotos]);

  // The search dock is OUTSIDE the list, always. It used to ride in the list's
  // header, which made the field a child of whichever list was mounted — and
  // switching between the two-up grid and the results rows remounts the list
  // (numColumns can only change across a remount). That would have torn the
  // focused TextInput out mid-keystroke and dropped the keyboard.
  const renderSearchDock = () => (
    <View style={[styles.searchDock, { paddingTop: topInset + PICKER_GAP, backgroundColor: theme.colors.background }]}>
      <VaultSearchDock
        search={search}
        theme={theme}
        placeholder="Search your boards"
        accessibilityLabel="Search your boards"
        cancelLabel="Cancel board search"
        clearLabel="Clear board search"
        trailingIcon="plus"
        trailingLabel="Add photos to a board"
        onTrailingPress={onAdd}
        onChangeText={onQueryChange}
        testIDPrefix="board-search"
      />

      {/* Sort chips — in the DOCK, not in the list header, so they stay put
          while the boards scroll under them. They used to ride in
          ListHeaderComponent and left the screen with the first flick, which
          meant re-sorting a long library was: scroll all the way back up,
          then choose. The field above them was already fixed; these are the
          other half of the same control surface and belong beside it.

          Still gone while SEARCHING — results are relevance-ordered, so a
          sort choice would not describe them. */}
      {!searching ? (
      <ScrollView
          testID="board-sort-scroll"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sorts}
          style={styles.sortScroller}
        >
          {SORTS.map(({ mode, label, icon }) => {
            const selected = sortMode === mode;
            return (
              <Pressable
                key={mode}
                accessibilityRole="button"
                accessibilityLabel={`Sort boards by ${mode}`}
                accessibilityState={{ selected }}
                onPress={() => onSortModeChange(mode)}
                hitSlop={HIT_SLOP_8}
                style={[
                  styles.sort,
                  // Filled, borderless pills as in the reference — the unselected
                  // fill does the work the border used to.
                  { backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceElevated },
                ]}
              >
                <Icon
                  testID={selected ? `sort-selected-${mode}` : undefined}
                  name={selected ? 'check' : icon}
                  size={16}
                  color={selected ? onPrimary : theme.colors.textSecondary}
                />
                <Text style={[styles.sortLabel, { color: selected ? onPrimary : theme.colors.textSecondary }]}>{label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {/* A refresh that failed is reported under the field in BOTH modes. It
          used to live with the sort chips, which search takes away — and
          "nothing matched" reads very differently when the list you searched
          is a stale one. */}
      {error && hasLoadedAlbums && (
        <View style={[styles.retryBanner, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
          <Text style={[styles.retryBannerText, { color: theme.colors.textSecondary }]}>{REFRESH_ERROR_COPY}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading boards"
            onPress={onRetry}
            style={styles.retryBannerAction}
          >
            <Text style={[styles.retryBannerActionText, { color: theme.colors.primary }]}>Retry</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  // Everything the grid shows ABOVE the boards: the sort chips and the pinned
  // All Photos card. None of it survives into search mode — the results start
  // directly under the field, which is the whole ask.
  const renderGridHeader = () => (
    <View style={styles.gridHeader}>

      {/* All Photos — the whole library as a board, pinned above the user's own.
          Deliberately outside the grid data: it is never reordered by the sort
          chips, because it is a fixed entry point rather than content. Full
          width so it reads as the parent of the two-column boards below.

          It does go away WHILE SEARCHING, though. Pinned, it sat above the
          results claiming to be one — a card that matches every query because
          it was never filtered at all. During a search the only thing on the
          page should be what matched. */}
      {allPhotos && !displayQuery ? (
        <View style={styles.allPhotosSlot}>
          <PhotoVaultBoardCard
            board={allPhotos}
            width={CARD_WIDTH * 2 + COLUMN_GAP}
            theme={theme}
            resolveCoverUrl={resolveCoverUrl}
            onPress={openAllPhotos}
            onLongPress={NOOP}
          />
        </View>
      ) : null}
    </View>
  );

  const renderEmpty = () => {
    if (!hasLoadedAlbums && !error) {
      return <View style={styles.skeletonGrid}>{[0, 1, 2, 3].map((index) => <BoardSkeleton key={index} index={index} theme={theme} />)}</View>;
    }

    if (!hasLoadedAlbums) {
      return (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>{LOAD_ERROR_COPY}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading boards"
            onPress={onRetry}
            style={[styles.emptyAction, { backgroundColor: theme.colors.surfaceElevated }]}
          >
            <Text style={[styles.emptyActionText, { color: theme.colors.textPrimary }]}>Retry</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={styles.empty}>
        <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
          {displayQuery ? `No boards match “${displayQuery}”.` : 'Create your first board by adding photos.'}
        </Text>
        {!displayQuery && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add photos to create a board"
            onPress={onAdd}
            style={[styles.emptyAction, { backgroundColor: theme.colors.surfaceElevated }]}
          >
            <Text style={[styles.emptyActionText, { color: theme.colors.textPrimary }]}>Add photos</Text>
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.page, { backgroundColor: theme.colors.background }]}>
      <Animated.View style={[styles.lift, { marginBottom: -lift }, search.liftStyle]}>
      {/* The dock is ABSOLUTE over the list now, not stacked above it in flow.
          That is what lets it leave: in flow, sliding it up would drag the list
          with it and there would be nothing underneath. Over the list, it
          travels its own height and the boards are already there behind it —
          which is the whole Pinterest read. The list reserves the same height
          as top padding, so at rest nothing has moved. */}
      <Animated.View
        style={[
          styles.dockWrap,
          chromePx && dockH > 0 ? {
            transform: [{
              translateY: chromePx.interpolate({
                inputRange: [0, dockH],
                outputRange: [0, -dockH],
                extrapolate: 'clamp',
              }),
            }],
          } : null,
        ]}
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          // Thresholded: onLayout fires on every sub-pixel wobble, and a state
          // write per frame would re-render the whole page mid-scroll.
          if (h > 0) {
            setDockH((prev) => (Math.abs(prev - h) >= 1 ? h : prev));
            onDockHeight?.(h);
          }
        }}
      >
        {renderSearchDock()}
      </Animated.View>
      <Animated.FlatList
        // The key is what swaps the layout: numColumns cannot change on a
        // mounted list (RN says so outright), so grid ⇄ rows is a remount. The
        // search field is deliberately not inside this subtree, so the remount
        // costs nothing but the scroll offset.
        key={searching ? 'boards-rows' : 'boards-grid'}
        ref={ref}
        // displayBoards, not visibleBoards: through a cancel the parent has
        // already gone back to the full set, and these rows must keep showing
        // the matches until the page has landed.
        data={displayBoards}
        keyExtractor={(board) => board.name}
        numColumns={searching ? 1 : 2}
        renderItem={({ item }) => (searching ? (
          <BoardRow
            board={item}
            theme={theme}
            resolveCoverUrl={resolveCoverUrl}
            onPress={openBoard}
            onLongPress={onLongPressBoard}
            onPressIn={onCardPressIn}
          />
        ) : (
          <PhotoVaultBoardCard
            board={item}
            width={CARD_WIDTH}
            theme={theme}
            resolveCoverUrl={resolveCoverUrl}
            onPress={openBoard}
            onLongPress={onLongPressBoard}
            onPressIn={onCardPressIn}
            onPressShared={onOpenShareInsights}
            onPressShareSettings={onOpenShareSettings}
            baseUrl={baseUrl}
          />
        ))}
        // Elements, NOT functions. VirtualizedList renders a function-valued
        // ListHeaderComponent as `<ListHeaderComponent />`; a header function
        // defined in this render body is a new identity — and therefore a new
        // element type — on every render, so React tore down and rebuilt the
        // header on each keystroke. (The field has since moved out of the list
        // entirely, but the sort chips would still churn.)
        ListHeaderComponent={searching ? null : renderGridHeader()}
        ListEmptyComponent={renderEmpty()}
        contentContainerStyle={[styles.content, { backgroundColor: theme.colors.background, paddingTop: dockH, paddingBottom: 24 + lift }]}
        columnWrapperStyle={!searching && displayBoards.length ? styles.gridRow : undefined}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={onScroll}
        // The chrome rides an Animated.event on this prop. Left at the default
        // iOS coalesces scroll events down to a trickle, and one-for-one
        // tracking of a signal that only arrives now and then is a header that
        // steps rather than follows.
        scrollEventThrottle={16}
        onContentSizeChange={onContentSizeChange}
        onLayout={onLayout}
      />
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  page: { flex: 1 },
  // Over the list, not above it. zIndex keeps it on top of the boards it is
  // sliding away from; the list's own paddingTop holds the space it occupies
  // at rest, so nothing jumps when it is shown.
  dockWrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 6 },
  // The lifting layer. Its negative bottom margin is static: it is always
  // `lift` taller than the page, so the rise is a transform with nothing
  // underneath it to re-lay out.
  lift: { flex: 1 },
  content: { paddingHorizontal: EDGE_PAD },
  // The dock the field lives in, above the list rather than inside it.
  searchDock: { paddingHorizontal: EDGE_PAD, paddingBottom: 10 },
  gridHeader: { marginHorizontal: -EDGE_PAD, paddingHorizontal: EDGE_PAD, paddingBottom: 16 },
  // The shared row's shape lives in VaultSearchDock; only the marker this page
  // hangs off the end of it is here.
  rowSharedDot: { width: 7, height: 7, borderRadius: 3.5 },
  sortScroller: { marginTop: 14 },
  allPhotosSlot: { marginTop: 16 },
  sorts: { flexDirection: 'row', gap: 8, paddingRight: EDGE_PAD },
  // Filled grey pills, no border, ~32pt tall as in the reference. The 44pt
  // accessible target comes from hitSlop rather than the visible height.
  sort: { height: 34, borderRadius: 17, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  sortLabel: { fontSize: 15, fontWeight: '600' },
  retryBanner: { marginTop: 12, minHeight: 44, borderWidth: 1, borderRadius: 12, paddingLeft: 12, paddingRight: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  retryBannerText: { fontSize: 14, fontWeight: '600' },
  retryBannerAction: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  retryBannerActionText: { fontSize: 14, fontWeight: '700' },
  gridRow: { gap: COLUMN_GAP },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: COLUMN_GAP },
  skeleton: { marginBottom: 26 },
  skeletonCollage: { aspectRatio: 1.46, borderRadius: 12 },
  skeletonLine: { width: '68%', height: 16, borderRadius: 8, marginTop: 8, marginHorizontal: 2 },
  skeletonMeta: { width: '45%', height: 13, borderRadius: 7, marginTop: 5, marginHorizontal: 2 },
  empty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 24 },
  emptyText: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  emptyAction: { marginTop: 16, borderRadius: 22, paddingHorizontal: 18, minHeight: 44, justifyContent: 'center' },
  emptyActionText: { fontSize: 15, fontWeight: '700' },
});

export default PhotoVaultBoardsPage;
