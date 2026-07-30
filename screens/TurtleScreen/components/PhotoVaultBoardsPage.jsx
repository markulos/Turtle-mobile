import React, { forwardRef, useCallback, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PhotoVaultBoardCard from './PhotoVaultBoardCard';

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
const CARD_WIDTH = (Dimensions.get('window').width - EDGE_PAD * 2 - COLUMN_GAP) / 2;
const LOAD_ERROR_COPY = 'Unable to load boards';
const REFRESH_ERROR_COPY = 'Couldn’t refresh boards.';

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
  onScroll,
  onContentSizeChange,
  onLayout,
}, ref) => {
  const visibleBoards = hasLoadedAlbums ? boards : [];
  const onPrimary = theme.colors.onPrimary ?? theme.colors.background;
  const searchRef = useRef(null);

  // Clearing is part of typing, not the end of it — keep the field focused so the
  // keyboard stays up and the user can retype immediately (standard search UX).
  const clearSearch = useCallback(() => {
    onQueryChange('');
    searchRef.current?.focus();
  }, [onQueryChange]);

  const renderHeader = () => (
    <View style={[styles.header, { paddingTop: topInset, backgroundColor: theme.colors.background }]}>
      <View style={styles.searchRow}>
        <View style={[styles.search, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Icon name="magnify" size={21} color={theme.colors.textMuted} />
          <TextInput
            ref={searchRef}
            value={query}
            onChangeText={onQueryChange}
            placeholder="Search your boards"
            placeholderTextColor={theme.colors.textMuted}
            accessibilityLabel="Search your boards"
            // Incremental search: filter as you type, never take the keyboard
            // away. Submitting is a no-op (blurOnSubmit=false) because results
            // are already live, and autocorrect/caps only get in the way of
            // matching board names.
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            returnKeyType="search"
            blurOnSubmit={false}
            clearButtonMode="never"
            style={[styles.searchInput, { color: theme.colors.textPrimary }]}
          />
          {query ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear board search"
              onPress={clearSearch}
              style={styles.clearSearch}
            >
              <Icon name="close-circle" size={21} color={theme.colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add photos to a board"
          onPress={onAdd}
          style={[styles.addButton, { backgroundColor: theme.colors.primary }]}
        >
          <Icon name="plus" size={25} color={theme.colors.background} />
        </Pressable>
      </View>
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
              style={[
                styles.sort,
                {
                  backgroundColor: selected ? theme.colors.primary : theme.colors.surface,
                  borderColor: selected ? theme.colors.primary : theme.colors.border,
                },
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
          {query ? `No boards match “${query}”.` : 'Create your first board by adding photos.'}
        </Text>
        {!query && (
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
    <Animated.FlatList
      ref={ref}
      data={visibleBoards}
      keyExtractor={(board) => board.name}
      numColumns={2}
      renderItem={({ item }) => (
        <PhotoVaultBoardCard
          board={item}
          width={CARD_WIDTH}
          theme={theme}
          resolveCoverUrl={resolveCoverUrl}
          onPress={onOpenBoard}
          onLongPress={onLongPressBoard}
          onPressIn={onCardPressIn}
        />
      )}
      // Elements, NOT functions. VirtualizedList renders a function-valued
      // ListHeaderComponent as `<ListHeaderComponent />`; a header function
      // defined in this render body is a new identity — and therefore a new
      // element type — on every render, so React tore down and rebuilt the
      // header on each keystroke, killing the focused TextInput and dismissing
      // the keyboard. Passing the rendered element keeps the type stable.
      ListHeaderComponent={renderHeader()}
      ListEmptyComponent={renderEmpty()}
      contentContainerStyle={[styles.content, { backgroundColor: theme.colors.background }]}
      columnWrapperStyle={visibleBoards.length ? styles.row : undefined}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      onScroll={onScroll}
      onContentSizeChange={onContentSizeChange}
      onLayout={onLayout}
    />
  );
});

const styles = StyleSheet.create({
  content: { paddingHorizontal: EDGE_PAD, paddingBottom: 24 },
  header: { marginHorizontal: -EDGE_PAD, paddingHorizontal: EDGE_PAD, paddingBottom: 16 },
  searchRow: { flexDirection: 'row', gap: 10 },
  search: { height: 46, flex: 1, borderWidth: 1, borderRadius: 23, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8 },
  searchInput: { flex: 1, fontSize: 16, height: '100%' },
  clearSearch: { width: 44, height: 44, marginRight: -12, alignItems: 'center', justifyContent: 'center' },
  addButton: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  sortScroller: { marginTop: 14 },
  sorts: { flexDirection: 'row', gap: 8, paddingRight: EDGE_PAD },
  sort: { minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  sortLabel: { fontSize: 14, fontWeight: '600' },
  retryBanner: { marginTop: 12, minHeight: 44, borderWidth: 1, borderRadius: 12, paddingLeft: 12, paddingRight: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  retryBannerText: { fontSize: 14, fontWeight: '600' },
  retryBannerAction: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  retryBannerActionText: { fontSize: 14, fontWeight: '700' },
  row: { gap: COLUMN_GAP },
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
