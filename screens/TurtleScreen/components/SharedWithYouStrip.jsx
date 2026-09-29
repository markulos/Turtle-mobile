/**
 * SharedWithYouStrip — the boards in your vault that aren't yours.
 *
 * Pinned in the boards grid header, under All Photos and above your own. A
 * horizontal strip rather than more two-column cards, for the same reason All
 * Photos is full width: these are not your boards and folding them into the
 * same grid would say they are. The strip also can't push your own content off
 * the first screen when somebody shares ten albums at once.
 *
 * Each card carries everything GET /api/shared-albums already returns — the
 * owner, the count and up to four covers — so the strip costs ONE request for
 * the whole row and never a follow-up per card.
 *
 * Renders NOTHING when nobody has shared anything, including while the first
 * read is in flight: an empty "Shared with you" heading on a vault where this
 * has never happened is a promise of a feature rather than a view of your
 * things. It appears the moment there is something in it.
 */
import React, { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AnimalAvatar from '../../../components/AnimalAvatar';
import { resolveAvatarUrl } from '../../../utils/avatarUrl';

export const CARD_W = 132;
const COVER_H = 96;

/**
 * The cover mosaic: one image filling the tile, or a 2×2 when there are four.
 * Same shape as a board card's so a shared board reads as the same kind of
 * object, just smaller.
 */
function Covers({ covers, resolveCoverUrl, theme }) {
  const list = (covers || []).filter(Boolean).slice(0, 4);
  if (!list.length) {
    return (
      <View style={[styles.cover, styles.coverEmpty, { backgroundColor: theme.colors.surfaceHighlight }]}>
        <MaterialCommunityIcons name="image-outline" size={20} color={theme.colors.textMuted} />
      </View>
    );
  }
  if (list.length < 4) {
    return (
      <Image
        source={{ uri: resolveCoverUrl(list[0]) }}
        style={styles.cover}
        contentFit="cover"
        transition={120}
        recyclingKey={`shared-cover:${list[0]}`}
      />
    );
  }
  return (
    <View style={[styles.cover, styles.mosaic]}>
      {list.map((url, i) => (
        <Image
          key={`${url}:${i}`}
          source={{ uri: resolveCoverUrl(url) }}
          style={styles.mosaicCell}
          contentFit="cover"
          transition={120}
          recyclingKey={`shared-cover:${url}`}
        />
      ))}
    </View>
  );
}

function SharedWithYouStrip({ boards, theme, resolveCoverUrl, baseUrl, onOpen, width }) {
  if (!boards || boards.length === 0) return null;
  const c = theme.colors;

  return (
    <View style={styles.wrap} testID="shared-with-you">
      <View style={styles.head}>
        <MaterialCommunityIcons name="account-multiple-outline" size={13} color={c.textSecondary} />
        <Text style={[styles.headText, { color: c.textSecondary }]}>SHARED WITH YOU</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        // The strip lives inside a vertical FlatList header; without this a
        // horizontal drag that starts slightly off-axis is stolen by the list.
        directionalLockEnabled
      >
        {boards.map((board) => {
          const owner = { userId: board.ownerUserId, name: board.ownerName, avatarUrl: board.ownerAvatarUrl };
          const avatar = resolveAvatarUrl(board.ownerAvatarUrl, baseUrl);
          return (
            <Pressable
              key={board.shareId}
              testID={`shared-board-${board.shareId}`}
              onPress={() => onOpen?.(board)}
              accessibilityRole="button"
              accessibilityLabel={`${board.album}, shared by ${board.ownerName}, ${board.count} ${board.count === 1 ? 'item' : 'items'}`}
              style={({ pressed }) => [styles.card, { width: width || CARD_W }, pressed && { opacity: 0.75 }]}
            >
              <Covers covers={board.covers} resolveCoverUrl={resolveCoverUrl} theme={theme} />
              <Text style={[styles.name, { color: c.textPrimary }]} numberOfLines={1}>{board.album}</Text>
              <View style={styles.byline}>
                <View style={styles.disc}>
                  <AnimalAvatar id={owner.userId} size={14} fallbackLabel={owner.name} />
                  {avatar ? (
                    <Image
                      source={{ uri: avatar }}
                      style={StyleSheet.absoluteFillObject}
                      contentFit="cover"
                      transition={120}
                      recyclingKey={`owner:${avatar}`}
                    />
                  ) : null}
                </View>
                <Text style={[styles.byText, { color: c.textTertiary || c.textSecondary }]} numberOfLines={1}>
                  {board.ownerName}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 18 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  headText: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.9 },
  row: { gap: 10, paddingRight: 8 },
  card: {},
  cover: { width: '100%', height: COVER_H, borderRadius: 10, overflow: 'hidden' },
  coverEmpty: { alignItems: 'center', justifyContent: 'center' },
  mosaic: { flexDirection: 'row', flexWrap: 'wrap' },
  mosaicCell: { width: '50%', height: '50%' },
  name: { fontSize: 13, fontWeight: '600', marginTop: 6 },
  byline: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  disc: { width: 14, height: 14, borderRadius: 7, overflow: 'hidden' },
  byText: { fontSize: 11, flex: 1, minWidth: 0 },
});

export default memo(SharedWithYouStrip);
