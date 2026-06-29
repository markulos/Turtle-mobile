import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { itemIconOf, itemColorOf, itemTypeOf, isOverdue } from '../utils/taskHelpers';
import { tapHaptic } from '../../../utils/haptics';

// ── Quick time helpers (self-contained so this row works in any list) ──────────
// Format "HH:MM" honoring the user's 12/24h preference.
const fmtTime = (hhmm, use24h) => {
  if (!hhmm || typeof hhmm !== 'string') return '';
  const [hs, ms] = hhmm.split(':');
  let h = Number(hs);
  const m = Number(ms);
  if (Number.isNaN(h) || Number.isNaN(m)) return '';
  if (use24h) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
};

// Add `mins` to "HH:MM" → "HH:MM", clamped to the same day.
const addMinutes = (hhmm, mins) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  let total = h * 60 + m + (Number(mins) || 0);
  total = Math.min(total, 24 * 60 - 1);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

// Diameter of the activity icon on the rail + where its centre sits, so the
// connecting line segments line up with it exactly.
const ICON = 40;
const ICON_CENTRE = ICON / 2;
const ROW_GAP = 12; // vertical gap below each row; the rail bridges it

// A single task/event rendered as a timeline entry: an activity icon on a
// connecting rail, then a card with the time range, a done/upcoming/overdue
// status chip, the title, and a grey subtitle. Keeps every existing action —
// tap → inspector, long-press → full edit, tap the icon → toggle complete.
export const TimelineTaskRow = ({ item, onPress, onLongPress, onToggleComplete, isFirst, isLast }) => {
  const { theme, timeFormat } = useTheme();
  const c = theme.colors || {};
  const use24h = timeFormat === '24h';

  // Resilient token reads — mobile themes don't all expose the same names.
  const cText = c.text || c.textPrimary || '#11181C';
  const cSub = c.textSecondary || c.textTertiary || '#8A8F98';
  const cMuted = c.textTertiary || c.textPlaceholder || cSub;
  const cCard = c.surfaceElevated || c.card || c.surface || '#16181D';
  const cBorder = c.border || 'rgba(127,127,127,0.25)';
  const cInfo = c.accentInfo || c.primary || '#3B82F6';
  const cSuccess = c.accentSuccess || '#2BA84A';
  const cWarning = c.accentWarning || '#E8911A';
  const cError = c.accentError || c.accentDanger || '#E5484D';

  const completed = !!item.completed;
  const overdue = !completed && !!item.dueDate && isOverdue(item.dueDate);
  const accent = itemColorOf(item) || cInfo;

  // Status chip.
  const status = completed
    ? { bg: cSuccess, icon: 'check', label: 'Done' }
    : overdue
      ? { bg: cError, icon: 'alert-circle-outline', label: 'Overdue' }
      : { bg: cWarning, icon: 'clock-outline', label: 'Upcoming' };

  // Time range — "HH:MM — HH:MM" when a duration is known, else just the start.
  const start = item.time ? fmtTime(item.time, use24h) : '';
  const end = item.time && Number(item.duration) > 0 ? fmtTime(addMinutes(item.time, item.duration), use24h) : '';
  const timeLabel = start ? (end ? `${start} — ${end}` : start) : 'No time';

  const typeLabel = { event: 'Event', birthday: 'Birthday' }[itemTypeOf(item)];
  const subtitle = item.project || typeLabel || 'No project';

  return (
    <View style={{ flexDirection: 'row', marginBottom: ROW_GAP, paddingHorizontal: 14 }}>
      {/* Rail column — connecting line segments + the activity icon */}
      <View style={{ width: ICON, alignSelf: 'stretch', alignItems: 'center' }}>
        {!isFirst && (
          <View style={{ position: 'absolute', left: ICON_CENTRE - 1, top: 0, height: ICON_CENTRE, width: 2, backgroundColor: cBorder }} />
        )}
        {!isLast && (
          <View style={{ position: 'absolute', left: ICON_CENTRE - 1, top: ICON_CENTRE, bottom: -ROW_GAP, width: 2, backgroundColor: cBorder }} />
        )}
        <TouchableOpacity
          onPress={() => { tapHaptic(); onToggleComplete?.(item); }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={completed ? 'Mark not done' : 'Mark done'}
          style={{
            width: ICON,
            height: ICON,
            borderRadius: ICON / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: completed ? cSuccess : cCard,
            borderWidth: completed ? 0 : 1.5,
            borderColor: completed ? cSuccess : accent,
          }}
        >
          <Icon
            name={completed ? 'check' : itemIconOf(item)}
            size={completed ? 20 : 18}
            color={completed ? '#fff' : accent}
          />
        </TouchableOpacity>
      </View>

      {/* Card */}
      <TouchableOpacity
        onPress={() => onPress?.(item)}
        onLongPress={() => onLongPress?.(item)}
        activeOpacity={0.75}
        delayLongPress={300}
        style={{
          flex: 1,
          marginLeft: 12,
          backgroundColor: cCard,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: cBorder,
          paddingVertical: 9,
          paddingHorizontal: 12,
          opacity: completed ? 0.65 : 1,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
          <Text style={{ fontSize: 12, color: cMuted, flexShrink: 1 }} numberOfLines={1}>{timeLabel}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, backgroundColor: status.bg, marginLeft: 8 }}>
            <Icon name={status.icon} size={11} color="#fff" />
            <Text style={{ fontSize: 11, fontWeight: '600', color: '#fff' }}>{status.label}</Text>
          </View>
        </View>
        <Text
          style={{ fontSize: 15, fontWeight: '600', color: cText, textDecorationLine: completed ? 'line-through' : 'none' }}
          numberOfLines={2}
        >
          {item.title}
        </Text>
        <Text style={{ fontSize: 13, color: cSub, marginTop: 1 }} numberOfLines={1}>{subtitle}</Text>
      </TouchableOpacity>
    </View>
  );
};
