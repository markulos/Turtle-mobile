/**
 * InboxList — what you have just written, strung on a thread.
 *
 * The capture field builds a list, so the list is under it, on the page, in the
 * order you typed it. Not cards: a STRING. A hairline runs down the left with a
 * bead on it per line, every bead on the same x, so the column reads as one
 * continuous thing being added to rather than as N objects that happen to be
 * stacked — the difference between a grocery list and a filing cabinet.
 *
 * The thread is drawn ONCE, behind the rows, rather than as a segment per row.
 * Per-row segments were tried on the agenda and abandoned: abutting hairlines
 * composite darker where they meet, so the line thickens at every join and the
 * list gains a rung ladder it was never meant to have.
 *
 * ─── The new line arrives, it does not appear ──────────────────────────────
 *
 * One translation, top of the list, on the frame the item first renders. It is
 * the only motion here and it earns it: the field empties the instant you press
 * the key, so without it the only evidence that anything happened is a row that
 * was not there before — and a list that changes between blinks is a list you
 * have to re-read to trust. Sliding it down from under the field says where it
 * came from.
 *
 * Native driver, transform and opacity only, so a long list costs nothing on
 * the JS thread while it plays.
 */
import React, { memo, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { tapHaptic } from '../../../utils/haptics';
import { ridgeRule } from '../../../utils/surfaceDepth';
// Shared with the board rows and with the tasks they reveal: every bead on this
// page sits on ONE string, so the geometry cannot live in any one of them.
import { THREAD_X, BEAD, ROW_PAD_LEFT } from '../utils/threadGeometry';

/** Long enough to read as an arrival, short enough not to be in the way. */
const DROP_MS = 260;

/**
 * One line on the string.
 *
 * `fresh` is what animates: the row the capture field just made. Everything
 * else renders at rest, which matters more than it sounds — animating the whole
 * list on every add would re-play a dozen rows for one new line.
 */
const Line = memo(function Line({ task, fresh, last, c, ridge, onPress }) {
  const drop = useRef(new Animated.Value(fresh ? 0 : 1)).current;
  useEffect(() => {
    if (!fresh) return undefined;
    const anim = Animated.timing(drop, {
      toValue: 1,
      duration: DROP_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [fresh, drop]);

  const style = {
    opacity: drop,
    transform: [{
      // From just under the field, down into place. Small: this is a hand-off
      // between two things a few points apart, not a journey.
      translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }),
    }],
  };

  return (
    <Animated.View style={style}>
      <Pressable
        onPressIn={() => tapHaptic()}
        onPress={() => onPress?.(task)}
        accessibilityRole="button"
        accessibilityLabel={task.title}
        testID={`inbox-line-${task.id}`}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        {/* The bead, centred on the thread behind it. */}
        <View style={[styles.bead, { backgroundColor: c.background, borderColor: c.textTertiary }]} />
        <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={2}>{task.title}</Text>
        {!!task.dueDate && (
          <Icon name="calendar-blank-outline" size={14} color={c.textTertiary} />
        )}
      </Pressable>
      {/* A RIDGE, not a hairline: each line you write sits on its own edge.
          See `ridgeRule` — the highlight above the shadow is what makes two
          hairlines read as a lip rather than as a drawn line. */}
      {!last && <View style={[styles.rule, ridge]} />}
    </Animated.View>
  );
});

function InboxList({ items, total, freshId, c, theme, onOpenTask, onOpenAll, destinationLabel }) {
  // Built once for the whole list rather than per row: it is the same two
  // hairlines twelve times over.
  const ridge = ridgeRule(theme || { mode: 'light', colors: c });
  if (!items || items.length === 0) {
    return (
      <Text style={[styles.empty, { color: c.textTertiary }]} testID="inbox-list-empty">
        Nothing in {destinationLabel} yet — write the first line above.
      </Text>
    );
  }
  return (
    <View style={styles.wrap} testID="inbox-list">
      {/* One thread, behind everything, rather than a segment per row. */}
      <View style={[styles.thread, { backgroundColor: c.border }]} pointerEvents="none" />
      {items.map((t, i) => (
        <Line
          key={t.id}
          task={t}
          fresh={t.id === freshId}
          last={i === items.length - 1}
          c={c}
          ridge={ridge}
          onPress={onOpenTask}
        />
      ))}
      {total > items.length && (
        <Pressable
          onPressIn={() => tapHaptic()}
          onPress={onOpenAll}
          accessibilityRole="button"
          accessibilityLabel={`Show all ${total}`}
          testID="inbox-list-more"
          style={({ pressed }) => [styles.more, pressed && styles.pressed]}
        >
          <Text style={[styles.moreText, { color: c.textSecondary }]}>
            {`${total - items.length} more`}
          </Text>
          <Icon name="chevron-right" size={16} color={c.textTertiary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  // Stops short at both ends so the string does not run out of the list into
  // the field above or the boards below.
  thread: {
    position: 'absolute',
    left: THREAD_X,
    top: 10,
    bottom: 10,
    width: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: ROW_PAD_LEFT,
    paddingRight: 2,
    paddingVertical: 11,
  },
  // Filled with the PAGE's colour, not left hollow: the thread runs behind it,
  // and a transparent bead would have a line through its middle.
  bead: {
    position: 'absolute',
    left: THREAD_X - BEAD / 2,
    width: BEAD,
    height: BEAD,
    borderRadius: BEAD / 2,
    borderWidth: 1.5,
  },
  title: { flex: 1, fontSize: 15.5, lineHeight: 20 },
  // The rule starts where the text does, so it never crosses the thread. Its
  // own height comes from `ridgeRule` — the two borders ARE the line.
  rule: { marginLeft: ROW_PAD_LEFT },
  more: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingLeft: ROW_PAD_LEFT, paddingVertical: 10,
  },
  moreText: { fontSize: 13, fontWeight: '600' },
  empty: { fontSize: 13.5, lineHeight: 19, paddingVertical: 10 },
  pressed: { opacity: 0.6 },
});

export default memo(InboxList);
