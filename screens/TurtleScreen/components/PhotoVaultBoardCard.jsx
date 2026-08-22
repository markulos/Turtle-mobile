import React, { memo, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { FONTS } from '../../../utils/fonts';
import { TAP_ONLY_PRESSABLE } from '../../../utils/pressBehavior';

// `hiResPath` is an OPTIONAL larger source for a pane that renders big enough to
// show the grid thumbnail's softness (currently only the All Photos hero). It's
// handed to expo-image as the real source with the small thumb as the
// placeholder, so the cheap already-cached image paints on the first frame and
// the big one swaps in when it lands — a lazy upgrade, not a blocking load.
// Every other pane keeps requesting the small thumbnail alone.
const Cover = ({ path, slot, resolveCoverUrl, hiResPath }) => (
  <Image
    testID={`board-cover-${slot}`}
    source={{ uri: resolveCoverUrl(hiResPath || path) }}
    placeholder={hiResPath ? { uri: resolveCoverUrl(path) } : undefined}
    placeholderContentFit="cover"
    // Low priority so the upgrade never competes with the grid's own
    // thumbnails for the connection.
    priority={hiResPath ? 'low' : 'normal'}
    style={StyleSheet.absoluteFillObject}
    contentFit="cover"
    transition={160}
    recyclingKey={`${slot}:${hiResPath || path}`}
  />
);

const withAlpha = (color, hexAlpha) => (
  typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color + hexAlpha : undefined
);

// Published-to-the-web cue for the boards grid: a flashing dot plus a SHARED
// caps label in the info tint, so "this board is out on the web" reads at a
// glance while scrolling. It sits at the RIGHT END OF THE CAPTION, not over
// the collage — the covers are the content, and a badge floating on them would
// compete with the photos on every card in the grid.
//
// Tapping it opens that board's share insights page: the badge is the only
// place the grid admits a board is public, so it should also be the way in to
// who has opened it.
//
// Only shared boards mount this, so no animation runs for the ordinary case.
const SharedBadge = memo(function SharedBadge({ theme, boardName, onPress }) {
  const tint = theme.colors.accentInfo || theme.colors.primary;
  const flash = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // A FLASH, not a breath: fade down fast, hold dark for a beat, come back,
    // then rest lit for longer than it was out. The long lit rest is what keeps
    // a grid full of badges from reading as strobing noise.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(flash, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.delay(140),
        Animated.timing(flash, { toValue: 0, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.delay(700),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [flash]);

  return (
    <Pressable
      testID="board-shared-badge"
      accessibilityRole="button"
      accessibilityLabel={`${boardName} is shared on the web. See who has opened it`}
      onPress={onPress}
      // The pill is ~20pt tall by design; the touch target is not.
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={({ pressed }) => [
        styles.sharedPill,
        { backgroundColor: withAlpha(tint, pressed ? '3D' : '24'), opacity: pressed ? 0.9 : 1 },
      ]}
    >
      <Animated.View
        style={[
          styles.sharedDot,
          {
            backgroundColor: tint,
            opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [1, 0.15] }),
            transform: [{ scale: flash.interpolate({ inputRange: [0, 1], outputRange: [1, 0.7] }) }],
          },
        ]}
      />
      <Text style={[styles.sharedPillText, { color: tint }]}>SHARED</Text>
    </Pressable>
  );
});

function PhotoVaultBoardCard({
  board,
  width,
  theme,
  resolveCoverUrl,
  onPress,
  onLongPress,
  onPressIn,
  onPressShared,
}) {
  const covers = board.covers || [];
  const updated = board.metadata.includes(' · ')
    ? `, updated ${board.metadata.split(' · ')[1]}`
    : '';

  return (
    <Pressable
      // A board card fills most of the screen, so almost every vertical scroll
      // starts on one. Without the tap-only delay the card dims the instant you
      // begin scrolling the grid.
      {...TAP_ONLY_PRESSABLE}
      accessibilityRole="button"
      accessibilityLabel={`${board.name}, ${board.count} item${board.count === 1 ? '' : 's'}${updated}${board.isLive ? ', shared on the web' : ''}`}
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
              <Cover
                path={covers[0]}
                slot="hero"
                resolveCoverUrl={resolveCoverUrl}
                hiResPath={board.heroHiRes}
              />
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
      {/* Caption = text column + an optional state badge pinned to the right
          edge. The column is the flexible side so a long board name truncates
          instead of shoving the badge off the card. */}
      <View style={styles.caption}>
        <View style={styles.captionText}>
          <Text style={[styles.name, { color: theme.colors.textPrimary }]} numberOfLines={1}>
            {board.name}
          </Text>
          {/* Two-tone meta, as in the reference: the count carries the primary
              weight and the age trails it in muted text, with no separator dot.
              Falls back to the single metadata string for boards built before the
              model split the two. */}
          <Text style={[styles.metadata, { color: theme.colors.textPrimary }]} numberOfLines={1}>
            {board.itemLabel ?? board.metadata}
            {board.recency ? (
              <Text style={{ color: theme.colors.textTertiary ?? theme.colors.textSecondary }}>
                {`  ${board.recency}`}
              </Text>
            ) : null}
          </Text>
        </View>
        {board.isLive ? (
          <SharedBadge
            theme={theme}
            boardName={board.name}
            onPress={() => onPressShared?.(board.name)}
          />
        ) : null}
      </View>
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
    // Re-measured off the reference (1170px @3x): a 557x375px collage on a
    // 186pt card, and a corner arc of ~23px rather than the softer radius the
    // first pass used.
    aspectRatio: 1.48,
    borderRadius: 9,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  pane: { overflow: 'hidden' },
  // The seams between panes are hairlines — one device pixel, so they stay a
  // crisp line at any scale instead of the 2pt channel they used to cut, which
  // read as a gap between three photos rather than one divided image.
  heroPane: { width: '65%', height: '100%', borderRightWidth: StyleSheet.hairlineWidth },
  sideColumn: { width: '35%', height: '100%' },
  topPane: { height: '50%', borderBottomWidth: StyleSheet.hairlineWidth },
  bottomPane: { height: '50%' },
  emptyCover: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Caption block under the collage, scaled 1.3x off the 12/11pt pass. Medium
  // weight keeps the collage leading the card; metadata stays below the title.
  // Custom faces carry their own weight: RN ignores fontWeight once fontFamily
  // names a bundled font, so the bold title uses the Bold family directly.
  // Title sits a step down from the 15pt pass, and the caption block is tightened:
  // the two lines were separated by a 1pt margin PLUS ~5pt of combined leading
  // slack (20/18 line-heights on 14/13.5pt text), which read as a gap rather than
  // one block. Line-heights pulled close to the glyph size and the margin dropped
  // so the count sits directly under the name.
  // The 9pt gap under the collage now belongs to the caption ROW, so the badge
  // is centred against both text lines rather than hanging off the title.
  caption: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9 },
  captionText: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, lineHeight: 17, fontFamily: FONTS.semibold, paddingHorizontal: 2 },
  metadata: { fontSize: 13.5, lineHeight: 16, fontFamily: FONTS.medium, marginTop: 0, paddingHorizontal: 2 },
  // A step smaller than the board-menu pill: on a two-up grid card it is a
  // margin note, not a button.
  sharedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 999 },
  sharedDot: { width: 5, height: 5, borderRadius: 2.5 },
  sharedPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
});

export default memo(PhotoVaultBoardCard);
