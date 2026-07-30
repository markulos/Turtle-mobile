import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const Cover = ({ path, slot, resolveCoverUrl }) => (
  <Image
    testID={`board-cover-${slot}`}
    source={{ uri: resolveCoverUrl(path) }}
    style={StyleSheet.absoluteFillObject}
    contentFit="cover"
    transition={160}
    recyclingKey={`${slot}:${path}`}
  />
);

function PhotoVaultBoardCard({
  board,
  width,
  theme,
  resolveCoverUrl,
  onPress,
  onLongPress,
  onPressIn,
}) {
  const covers = board.covers || [];
  const updated = board.metadata.includes(' · ')
    ? `, updated ${board.metadata.split(' · ')[1]}`
    : '';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${board.name}, ${board.count} item${board.count === 1 ? '' : 's'}${updated}`}
      onPress={() => onPress(board.name)}
      onLongPress={() => onLongPress(board.name)}
      onPressIn={onPressIn}
      delayLongPress={500}
      style={({ pressed }) => [
        styles.card,
        { width, opacity: pressed ? 0.86 : 1 },
      ]}
    >
      <View
        testID="board-collage"
        style={[
          styles.collage,
          { backgroundColor: theme.colors.surfaceElevated },
        ]}
      >
        {covers.length ? (
          <>
            <View
              testID="board-hero-pane"
              style={[
                styles.pane,
                styles.heroPane,
                { borderRightColor: theme.colors.background },
              ]}
            >
              <Cover path={covers[0]} slot="hero" resolveCoverUrl={resolveCoverUrl} />
            </View>
            <View style={styles.sideColumn}>
              <View
                style={[
                  styles.pane,
                  styles.topPane,
                  { borderBottomColor: theme.colors.background },
                ]}
              >
                {covers[1]
                  ? <Cover path={covers[1]} slot="top" resolveCoverUrl={resolveCoverUrl} />
                  : <View style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.colors.surfaceHighlight }]} />}
              </View>
              <View style={[styles.pane, styles.bottomPane]}>
                {covers[2]
                  ? <Cover path={covers[2]} slot="bottom" resolveCoverUrl={resolveCoverUrl} />
                  : <View style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.colors.surfaceHighlight }]} />}
              </View>
            </View>
          </>
        ) : (
          <View testID="board-empty-cover" style={styles.emptyCover}>
            <Icon name="image-multiple-outline" size={28} color={theme.colors.textMuted} />
          </View>
        )}
      </View>
      <Text style={[styles.name, { color: theme.colors.textPrimary }]} numberOfLines={1}>
        {board.name}
      </Text>
      <Text style={[styles.metadata, { color: theme.colors.textSecondary }]} numberOfLines={1}>
        {board.metadata}
      </Text>
    </Pressable>
  );
}

// Proportions measured off the Pinterest boards reference (1170px @3x = 390pt):
// a 555x380px collage (1.46 aspect, noticeably wider than tall), a 360px hero
// pane (65% of the card), ~6px internal gutters, and ~85px (26pt) of breathing
// room under the metadata before the next row of cards.
const styles = StyleSheet.create({
  card: { marginBottom: 26 },
  collage: {
    width: '100%',
    aspectRatio: 1.46,
    borderRadius: 12,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  pane: { overflow: 'hidden' },
  heroPane: { width: '65%', height: '100%', borderRightWidth: 2 },
  sideColumn: { width: '35%', height: '100%' },
  topPane: { height: '50%', borderBottomWidth: 2 },
  bottomPane: { height: '50%' },
  emptyCover: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Board title deliberately quiet: 0.6x the previous 16pt and a medium weight,
  // so the collage carries the card and the name reads as a caption under it.
  name: { fontSize: 9.6, lineHeight: 13, fontWeight: '500', marginTop: 9, paddingHorizontal: 2 },
  metadata: { fontSize: 14, lineHeight: 19, marginTop: 2, paddingHorizontal: 2 },
});

export default memo(PhotoVaultBoardCard);
