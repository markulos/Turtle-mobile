/**
 * ScheduleCard — the day panel's task row: the TIME on the left, a soft
 * tinted card on the right (docs/STYLE-RULES.md §1, "schedule cards").
 *
 * Reads like a planner page: a light column of clock labels, then a card
 * washed in the board's colour (pastel on the light page, a deeper tint on
 * the dark one) carrying the title, the board name, a completion ring and
 * the time range bottom-right. Nothing else — the details live one tap away
 * in the inspector. Untimed rows keep the same shape with a quiet label in
 * the time column so the eye scans one straight edge.
 */
import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { tapHaptic, impactHaptic } from '../../../utils/haptics';
import { boardLabel } from '../utils/taskHelpers';

/** "08 AM" / "08:30 AM" (or "08:30" in 24 h) for a minutes-since-midnight value. */
export function clockLabel(minutes, use24h = false) {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  const mm = String(m).padStart(2, '0');
  if (use24h) return `${String(h).padStart(2, '0')}:${mm}`;
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = String(h % 12 || 12).padStart(2, '0');
  return m ? `${h12}:${mm} ${ap}` : `${h12} ${ap}`;
}

/** A #RRGGBB colour at `alpha` (0–1); anything else falls back to `fallback`. */
export function tintOf(hex, alpha, fallback) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

function ScheduleCard({
  task, timeLabel, range, color, done, theme, onPress, onLongPress, onToggle, owner, onOwnerPress, trailing, subtitle, testID,
  // Tap the time column to re-time the task. Omitted where the column carries
  // something that isn't a time (the Pending strip shows a due DATE there), so
  // the gesture only exists where it means what it looks like.
  onTimePress,
}) {
  const c = theme.colors;
  const dark = theme.mode === 'dark';
  const fill = tintOf(color, dark ? 0.26 : 0.18, dark ? c.surfaceElevated : c.surface);
  const title = task?.title || 'Untitled';
  const sub = subtitle !== undefined ? subtitle : (task?.project ? boardLabel(task.project) : '');
  const timeText = (
    <Text style={[styles.time, { color: c.textSecondary }]} numberOfLines={1}>{timeLabel}</Text>
  );
  return (
    <View style={styles.row} testID={testID}>
      {onTimePress ? (
        <Pressable
          onPressIn={() => tapHaptic()}
          onPress={() => onTimePress(task)}
          hitSlop={{ top: 10, bottom: 10, left: 12, right: 4 }}
          accessibilityRole="button"
          accessibilityLabel={`Edit the time for ${title}, currently ${timeLabel}`}
          testID={testID ? `${testID}-time` : undefined}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          {timeText}
        </Pressable>
      ) : timeText}
      <Pressable
        onPressIn={() => tapHaptic()}
        onPress={() => onPress?.(task)}
        onLongPress={() => onLongPress?.(task)}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={`${title}${sub ? `, ${sub}` : ''}${range ? `, ${range}` : ''}${done ? ', done' : ''}`}
        style={({ pressed }) => [styles.card, { backgroundColor: fill }, pressed && styles.pressed, done && styles.done]}
      >
        <View style={styles.top}>
          <Text style={[styles.title, { color: c.textPrimary }, done && styles.struck]} numberOfLines={2}>{title}</Text>
          {onToggle && (
            <TouchableOpacity
              onPressIn={() => impactHaptic('light')}
              onPress={() => onToggle(task)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!done }}
              accessibilityLabel={done ? 'Mark not done' : 'Mark done'}
              style={[styles.ring, { borderColor: c.textPrimary }, done && { backgroundColor: c.textPrimary }]}
            >
              {done && <Icon name="check" size={14} color={c.background} />}
            </TouchableOpacity>
          )}
        </View>
        {!!sub && <Text style={[styles.sub, { color: c.textSecondary }]} numberOfLines={1}>{sub}</Text>}
        <View style={styles.bottom}>
          {owner ? (
            <TouchableOpacity
              style={[styles.owner, { backgroundColor: owner.color }]}
              onPress={() => onOwnerPress?.(task)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`Owner: ${owner.name}. Open profile`}
            >
              <Text style={styles.ownerText}>{(owner.name || '?').trim().charAt(0).toUpperCase()}</Text>
            </TouchableOpacity>
          ) : <View />}
          <View style={styles.bottomRight}>
            {trailing}
            {!!range && <Text style={[styles.range, { color: c.textTertiary }]} numberOfLines={1}>{range}</Text>}
          </View>
        </View>
      </Pressable>
    </View>
  );
}

export default memo(ScheduleCard);

export const TIME_COL_W = 74;

// A stretch of free hours longer than this collapses into ONE "Nh free" row
// (the reference lists every hour, but a 06:00 → 22:00 day with two tasks
// would be sixteen dashed rows).
export const CONDENSE_AFTER_HOURS = 3;

/**
 * The condensed hour timeline for the day panel's compact schedule: from the
 * first task's hour to the last task's end, one row per hour — a task card
 * on the hour a task starts (the card stands for the hours it covers), a
 * dashed empty row for a free hour, and a single "free" row for a long
 * empty stretch. `segments` are {task, start, end} in minutes, start-sorted.
 * Returns [{ kind: 'task', seg, minute } | { kind: 'empty', minute } |
 * { kind: 'free', minute, minutes }].
 */
export function buildCondensedRows(segments) {
  const segs = (segments || []).filter((s) => s && Number.isFinite(s.start)).slice().sort((a, b) => a.start - b.start);
  if (!segs.length) return [];
  const rows = [];
  const dayEnd = Math.max(...segs.map((s) => Math.max(s.end || 0, s.start + 1)));
  let cursor = Math.floor(segs[0].start / 60) * 60; // the hour the day starts on
  let i = 0;
  let guard = 0;
  while ((i < segs.length || cursor < dayEnd) && guard++ < 200) {
    const seg = segs[i];
    if (seg && seg.start < cursor + 60) {
      // Starts inside this hour (or earlier, overlapping the previous card).
      rows.push({ kind: 'task', seg, minute: seg.start });
      i += 1;
      // The card covers its hours: resume on the first hour after it ends
      // (never move backwards past the hour we are on).
      const endHour = Math.ceil(Math.max(seg.end || seg.start + 1, seg.start + 1) / 60) * 60;
      cursor = Math.max(cursor + 60, endHour);
      continue;
    }
    // A free hour. Measure the free run up to the next task (or the day's end).
    const next = seg ? Math.floor(seg.start / 60) * 60 : dayEnd;
    const freeHours = Math.max(1, Math.ceil((next - cursor) / 60));
    if (freeHours > CONDENSE_AFTER_HOURS) {
      rows.push({ kind: 'empty', minute: cursor });
      rows.push({ kind: 'free', minute: cursor + 60, minutes: (freeHours - 1) * 60 });
      cursor += freeHours * 60;
    } else {
      rows.push({ kind: 'empty', minute: cursor });
      cursor += 60;
    }
  }
  return rows;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  // The time reads CLEARLY beside its card (the reference's "08 AM"): a
  // mid-size medium-weight label in the secondary ink, on the card's first
  // line. Minutes stay ("08:30 AM"); the column is wide enough for them.
  //
  // It LINES UP with that first line rather than floating above it: the same
  // top inset as the card (14) and the same lineHeight as the title (21), so
  // the two line boxes start at the same y and are the same height — the ink
  // centres identically in both. It used to guess with paddingTop 15 against
  // the title's natural leading and sat a few points high.
  time: {
    width: TIME_COL_W,
    paddingTop: 14,
    paddingRight: 6,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.1,
  },
  card: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    minHeight: 72,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 21,
  },
  struck: {
    textDecorationLine: 'line-through',
  },
  ring: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  sub: {
    fontSize: 13,
    fontWeight: '400',
    marginTop: 3,
  },
  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  bottomRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 'auto',
  },
  range: {
    fontSize: 12,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
  owner: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
  },
  done: {
    opacity: 0.55,
  },
});
