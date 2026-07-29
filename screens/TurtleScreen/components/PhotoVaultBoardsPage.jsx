import React, { forwardRef } from 'react';
import {
  Animated,
  Dimensions,
  Pressable,
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

const CARD_WIDTH = (Dimensions.get('window').width - 20 - 10) / 2;
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
  const renderHeader = () => (
    <View style={[styles.header, { paddingTop: topInset, backgroundColor: theme.colors.background }]}>
      <View style={styles.searchRow}>
        <View style={[styles.search, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Icon name="magnify" size={21} color={theme.colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={onQueryChange}
            placeholder="Search your boards"
            placeholderTextColor={theme.colors.textMuted}
            accessibilityLabel="Search your boards"
            style={[styles.searchInput, { color: theme.colors.textPrimary }]}
          />
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
      <View style={styles.sorts}>
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
                  backgroundColor: selected ? theme.colors.surfaceElevated : theme.colors.surface,
                  borderColor: selected ? theme.colors.textSecondary : theme.colors.border,
                },
              ]}
            >
              <Icon name={icon} size={16} color={selected ? theme.colors.textPrimary : theme.colors.textSecondary} />
              <Text style={[styles.sortLabel, { color: selected ? theme.colors.textPrimary : theme.colors.textSecondary }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      {error && boards.length > 0 && (
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
    if (error) {
      return (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>{LOAD_ERROR_COPY}</Text>
          <Pressable onPress={onRetry} style={[styles.emptyAction, { backgroundColor: theme.colors.surfaceElevated }]}>
            <Text style={[styles.emptyActionText, { color: theme.colors.textPrimary }]}>Retry</Text>
          </Pressable>
        </View>
      );
    }

    if (loading) {
      return <View style={styles.skeletonGrid}>{[0, 1, 2, 3].map((index) => <BoardSkeleton key={index} index={index} theme={theme} />)}</View>;
    }

    return (
      <View style={styles.empty}>
        <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
          {query ? `No boards match “${query}”.` : 'Create your first board by adding photos.'}
        </Text>
        {!query && (
          <Pressable onPress={onAdd} style={[styles.emptyAction, { backgroundColor: theme.colors.surfaceElevated }]}>
            <Text style={[styles.emptyActionText, { color: theme.colors.textPrimary }]}>Add photos</Text>
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <Animated.FlatList
      ref={ref}
      data={boards}
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
      ListHeaderComponent={renderHeader}
      ListEmptyComponent={renderEmpty}
      contentContainerStyle={[styles.content, { backgroundColor: theme.colors.background }]}
      columnWrapperStyle={boards.length ? styles.row : undefined}
      keyboardShouldPersistTaps="handled"
      onScroll={onScroll}
      onContentSizeChange={onContentSizeChange}
      onLayout={onLayout}
    />
  );
});

const styles = StyleSheet.create({
  content: { paddingHorizontal: 10, paddingBottom: 24 },
  header: { marginHorizontal: -10, paddingHorizontal: 10, paddingBottom: 18 },
  searchRow: { flexDirection: 'row', gap: 10 },
  search: { height: 50, flex: 1, borderWidth: 1, borderRadius: 25, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8 },
  searchInput: { flex: 1, fontSize: 16, height: '100%' },
  addButton: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  sorts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  sort: { minHeight: 36, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  sortLabel: { fontSize: 14, fontWeight: '600' },
  retryBanner: { marginTop: 12, minHeight: 40, borderWidth: 1, borderRadius: 12, paddingLeft: 12, paddingRight: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  retryBannerText: { fontSize: 14, fontWeight: '600' },
  retryBannerAction: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 8 },
  retryBannerActionText: { fontSize: 14, fontWeight: '700' },
  row: { gap: 10 },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  skeleton: { marginBottom: 20 },
  skeletonCollage: { aspectRatio: 1.28, borderRadius: 18 },
  skeletonLine: { width: '68%', height: 16, borderRadius: 8, marginTop: 8, marginHorizontal: 2 },
  skeletonMeta: { width: '45%', height: 13, borderRadius: 7, marginTop: 5, marginHorizontal: 2 },
  empty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 24 },
  emptyText: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  emptyAction: { marginTop: 16, borderRadius: 20, paddingHorizontal: 18, minHeight: 40, justifyContent: 'center' },
  emptyActionText: { fontSize: 15, fontWeight: '700' },
});

export default PhotoVaultBoardsPage;
