/**
 * BoardRail — the Tasks header's board selector: one inset card per board in
 * a horizontal rail, an add/edit key first, then "All". Tap a card to scope the
 * list and the calendar to that board; long-press to manage boards. Each
 * card carries the board's progress (done / total, a hairline track, the
 * overdue count) so the rail IS the status view — no dropdown, no separate
 * stats chip.
 *
 * The look is the reference tile's (docs/STYLE-RULES.md §1, inset cards):
 * a panel a step below the page with a lit hairline rim, small-caps label,
 * bold tabular figures, muted caption. The SELECTED card inverts — text
 * colour as its fill — the way a pressed key on a Teenage Engineering panel
 * lights up. Restrained: two type sizes, one accent (the board colour dot).
 */
import React, { memo, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { tapHaptic, impactHaptic } from '../../../utils/haptics';
import { boardLabel } from '../utils/taskHelpers';
import { insetCardPalette } from '../utils/cardPalette';

const CARD_W = 128; // minimum; a card grows to fit its whole title (capped)
const CARD_H = 66;

function BoardCard({ label, dot, stat, selected, onPress, onLongPress, pal, testID }) {
  const total = stat?.total || 0;
  const done = stat?.done || 0;
  const overdue = stat?.overdue || 0;
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  const fg = selected ? pal.card : pal.text;
  const sub = selected ? pal.card : pal.muted;
  return (
    <Pressable
      onPressIn={() => tapHaptic()}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}: ${done} of ${total} done${overdue ? `, ${overdue} overdue` : ''}${selected ? ', selected' : ''}`}
      testID={testID}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: selected ? pal.text : pal.card,
          borderColor: selected ? pal.text : pal.edge,
          borderTopColor: selected ? pal.text : pal.edgeTop,
        },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.cardTop}>
        {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
        <Text style={[styles.label, { color: sub }]} numberOfLines={1}>{label}</Text>
      </View>
      <View style={styles.cardBottom}>
        <Text style={[styles.count, styles.countWrap, { color: fg }]} numberOfLines={1}>
          {done}<Text style={[styles.countTotal, { color: sub }]}>/{total}</Text>
        </Text>
        {overdue > 0 && (
          <Text style={[styles.late, { color: selected ? pal.card : '#F87171' }]} numberOfLines={1}>{overdue} late</Text>
        )}
      </View>
      <View style={[styles.track, { backgroundColor: selected ? 'rgba(127,127,127,0.35)' : pal.track }]}>
        <View style={[styles.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: fg }]} />
      </View>
    </Pressable>
  );
}

function BoardRail({ boards, selected, stats, colorOf, onSelect, onManage, onAddBoard, theme }) {
  const pal = useMemo(() => insetCardPalette(theme), [theme]);
  const allStat = stats?.All || { total: 0, done: 0, overdue: 0 };
  return (
    <ScrollView
      horizontal
      // A ScrollView is flexGrow 1 by default: as a column child it would
      // swallow every free point above the calendar (that was the "calendar
      // gone, margins everywhere" bug). The rail is exactly one card tall.
      style={styles.railScroll}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
      keyboardShouldPersistTaps="handled"
      testID="board-rail"
    >
      {/* Add / edit boards — FIRST on the rail, where the thumb lands.
          It takes the same charcoal fill as an unselected board card. The
          palette is drawn for ink ON that fill — its rim and icon colours are
          near-white — so an unfilled key was white-on-white and invisible on
          the light page. Filled, it reads as the rail's first key. */}
      <Pressable
        onPressIn={() => tapHaptic()}
        onPress={onAddBoard}
        accessibilityRole="button"
        accessibilityLabel="Add or edit boards"
        testID="board-card-add"
        style={({ pressed }) => [
          styles.addKey,
          { backgroundColor: pal.card, borderColor: pal.edge, borderTopColor: pal.edgeTop },
          pressed && styles.pressed,
        ]}
      >
        <Icon name="plus" size={20} color={pal.text} />
        <Icon name="pencil-outline" size={13} color={pal.sub} style={styles.addKeySub} />
      </Pressable>
      <BoardCard
        label="All"
        dot={null}
        stat={allStat}
        selected={selected === 'All'}
        onPress={() => onSelect('All')}
        onLongPress={() => onManage?.(null)}
        pal={pal}
        testID="board-card-All"
      />
      {boards.map((name) => (
        <BoardCard
          key={name}
          label={boardLabel(name)}
          dot={colorOf(name)}
          stat={stats?.[name]}
          selected={selected === name}
          onPress={() => onSelect(name)}
          onLongPress={() => { impactHaptic('medium'); onManage?.(name); }}
          pal={pal}
          testID={`board-card-${name}`}
        />
      ))}
    </ScrollView>
  );
}

export default memo(BoardRail);

const styles = StyleSheet.create({
  railScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  rail: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
    gap: 8,
    alignItems: 'center',
  },
  card: {
    minWidth: CARD_W,
    maxWidth: 240,
    height: CARD_H,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingTop: 9,
    overflow: 'hidden',
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  label: {
    flexShrink: 1,
    flexGrow: 0,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  countWrap: {
    flexShrink: 1,
  },
  count: {
    fontSize: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
  countTotal: {
    fontSize: 12,
    fontWeight: '600',
  },
  late: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    flexShrink: 1,
    marginLeft: 8,
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
  },
  fill: {
    height: 3,
  },
  // Solid rim, not dashed: RN renders a dashed border with a borderRadius
  // inconsistently (iOS quietly falls back to solid, Android clips the
  // corners), and the charcoal fill is what carries the key now anyway.
  addKey: {
    width: 44,
    height: CARD_H,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  addKeySub: {
    opacity: 0.9,
  },
  pressed: {
    opacity: 0.6,
  },
});
