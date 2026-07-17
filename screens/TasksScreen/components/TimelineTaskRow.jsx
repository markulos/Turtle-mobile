import React from 'react';
import { View, Text, TouchableOpacity, PixelRatio } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { itemTypeOf, formatDueDate } from '../utils/taskHelpers';
import { tapHaptic } from '../../../utils/haptics';
import TaskCountdownBadge from './TaskCountdownBadge';

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
const DOT = 16; // diameter of the small completion toggle circle on the rail

// Locked card height for `uniform` rows (see below): paddingVertical 9×2 +
// when-line ~18 + one-line title ~20 + subtitle ~18 = 74 at fontScale 1. The
// agenda's PAST zone relies on every row being EXACTLY this + ROW_GAP tall, so
// its lazy-load placeholders occupy identical space and swaps never move the
// layout. Scaled by the device's accessibility font scale (constant for the
// app's lifetime) so large-text users don't get sheared cards — the zone's
// arithmetic stays exact because every consumer shares these constants.
const FONT_SCALE = Math.max(1, PixelRatio.getFontScale());
export const UNIFORM_CARD_H = Math.round(74 * FONT_SCALE);
export const UNIFORM_ROW_H = UNIFORM_CARD_H + ROW_GAP;

// A single task/event rendered as a timeline entry: an activity icon on a
// connecting rail, then a card with the date + time range, a live countdown
// badge (minute precision) to when it happens, the title, and a grey subtitle.
// Keeps every existing action — tap → inspector, long-press → full edit, tap
// the toggle → complete.
// `uniform`: locks the card to UNIFORM_CARD_H with a ONE-line title, making
// the whole row a fixed UNIFORM_ROW_H — required by the agenda's past zone,
// where skeleton placeholders must match real rows to the pixel.
export const TimelineTaskRow = ({ item, onPress, onLongPress, onToggleComplete, isFirst, isLast, hideDate, done, doneDate, hideCountdown, railColor, cardColor, uniform }) => {
  const { theme, timeFormat } = useTheme();
  const c = theme.colors || {};
  const use24h = timeFormat === '24h';

  // Resilient token reads — mobile themes don't all expose the same names.
  const cText = c.text || c.textPrimary || '#11181C';
  const cSub = c.textSecondary || c.textTertiary || '#8A8F98';
  const cMuted = c.textTertiary || c.textPlaceholder || cSub;
  const cCard = c.surfaceElevated || c.card || c.surface || '#16181D';
  // Caller can override the card fill (the agenda uses a slightly lighter tone).
  const cCardBg = cardColor || cCard;
  const cBorder = c.border || 'rgba(127,127,127,0.25)';
  // The connecting rail can be emphasised by the caller (the agenda draws it as
  // the strong black/white line); defaults to the faint border tint.
  const cRail = railColor || cBorder;

  // Completion-toggle palette. Done = a filled disc — black on light, white on
  // dark — with a contrasting checkmark; not-done = a small circle with a WHITE
  // centre and a grey ring, so it reads as an empty checkbox on the dark card.
  const isDark = theme.mode === 'dark';
  const cCheckFill = isDark ? '#FFFFFF' : '#000000';
  const cCheckMark = isDark ? '#000000' : '#FFFFFF';
  const cCheckOutline = cSub;

  // `done` (optional) overrides the raw boolean — recurring tasks track
  // per-occurrence completion in meta.completedDates, so the CALLER decides
  // what "checked" means in its context (per-day in the day panel, done-now in
  // the Upcoming agenda). Fall back to the plain boolean for old call sites.
  const completed = done !== undefined ? !!done : !!item.completed;

  // "When" line — the date plus the time range, so each upcoming row states
  // exactly when it happens: "Today · 2:30 PM — 3:00 PM", "Tomorrow", etc. The
  // live countdown to the right (TaskCountdownBadge) carries the minute ticker.
  // In a single-day panel the date is redundant (the panel header already shows
  // it), so `hideDate` drops it and the when-line shows just the time range.
  // When a recurring row is checked, `doneDate` (the ticked occurrence) drives
  // the label — otherwise the row would flash the ALREADY-ADVANCED next dueDate
  // ("Tomorrow") the instant you complete it, which reads as a glitch.
  const whenDate = (completed && doneDate) ? doneDate : item.dueDate;
  const dateLabel = (!hideDate && whenDate) ? formatDueDate(whenDate) : '';
  const start = item.time ? fmtTime(item.time, use24h) : '';
  const end = item.time && Number(item.duration) > 0 ? fmtTime(addMinutes(item.time, item.duration), use24h) : '';
  const timePart = start ? (end ? `${start} — ${end}` : start) : '';
  const whenLabel = dateLabel
    ? (timePart ? `${dateLabel} · ${timePart}` : dateLabel)
    : (timePart || 'No date');

  const typeLabel = { event: 'Event', birthday: 'Birthday' }[itemTypeOf(item)];
  const subtitle = item.project || typeLabel || 'No Board';

  return (
    <View style={{ flexDirection: 'row', marginBottom: ROW_GAP, paddingHorizontal: 14 }}>
      {/* Rail column — connecting line segments + the completion toggle */}
      <View style={{ width: ICON, alignSelf: 'stretch', alignItems: 'center' }}>
        {!isFirst && (
          <View style={{ position: 'absolute', left: ICON_CENTRE - 1, top: 0, height: ICON_CENTRE, width: 2, backgroundColor: cRail }} />
        )}
        {!isLast && (
          <View style={{ position: 'absolute', left: ICON_CENTRE - 1, top: ICON_CENTRE, bottom: -ROW_GAP, width: 2, backgroundColor: cRail }} />
        )}
        {/* Completion toggle — a small circle sitting on the rail. Tap it to
            complete: it fills in (black on light / white on dark) with a
            contrasting checkmark; incomplete is a white-centred circle with a
            grey ring. The 40px touch target keeps the tap area generous while
            the visible disc stays small and centred on the connecting line. */}
        <TouchableOpacity
          onPress={() => { tapHaptic(); onToggleComplete?.(item); }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={completed ? 'Mark not done' : 'Mark done'}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={{ width: ICON, height: ICON, alignItems: 'center', justifyContent: 'center' }}
        >
          <View
            style={{
              width: DOT,
              height: DOT,
              borderRadius: DOT / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: completed ? cCheckFill : '#FFFFFF',
              borderWidth: completed ? 0 : 1.5,
              borderColor: cCheckOutline,
            }}
          >
            {completed && <Icon name="check" size={DOT - 5} color={cCheckMark} />}
          </View>
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
          backgroundColor: cCardBg,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: cBorder,
          paddingVertical: 9,
          paddingHorizontal: 12,
          opacity: completed ? 0.65 : 1,
          // Uniform mode: pixel-exact card height so the row's total height is
          // a constant the agenda's placeholder geometry can rely on.
          ...(uniform ? { height: UNIFORM_CARD_H, overflow: 'hidden', justifyContent: 'center' } : {}),
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
          <Text style={{ fontSize: 12, color: cMuted, flexShrink: 1 }} numberOfLines={1}>{whenLabel}</Text>
          {/* Live countdown to when it happens — minute precision (blue when
              upcoming, red once it's passed, amber for an all-day task today).
              Hidden while checked: after a recurring tick the dueDate has
              advanced, so the badge would count down to the NEXT occurrence —
              reading as "it didn't complete". */}
          {!completed && !hideCountdown && (
            <View style={{ marginLeft: 8 }}>
              <TaskCountdownBadge task={item} />
            </View>
          )}
        </View>
        <Text
          style={{ fontSize: 15, fontWeight: '600', color: cText, textDecorationLine: completed ? 'line-through' : 'none' }}
          // Uniform rows cap the title to ONE line — a wrapped title is the
          // one thing that made row heights vary.
          numberOfLines={uniform ? 1 : 2}
        >
          {item.title}
        </Text>
        <Text style={{ fontSize: 13, color: cSub, marginTop: 1 }} numberOfLines={1}>{subtitle}</Text>
      </TouchableOpacity>
    </View>
  );
};
