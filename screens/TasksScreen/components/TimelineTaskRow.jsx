import React from 'react';
import { View, Text, TouchableOpacity, PixelRatio } from 'react-native';
import { TAP_ONLY } from '../../../utils/pressBehavior';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { itemTypeOf, formatDueDate } from '../utils/taskHelpers';
import { tapHaptic } from '../../../utils/haptics';
import TaskCountdownBadge from './TaskCountdownBadge';
import { HatchBackdrop } from './HatchBackdrop';

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
export const TimelineTaskRow = ({ item, onPress, onLongPress, onToggleComplete, isFirst, isLast, hideDate, done, doneDate, hideCountdown, railColor, cardColor, uniform, whenLabelFallback = 'No date', trailing, hatchColor, owner, onOwnerPress }) => {
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
  // dark — with a contrasting checkmark. Not-done on light = a white centre with
  // a grey ring; on dark = a BLACK centre with a WHITE ring, so the empty box
  // reads crisply against the dark card.
  const isDark = theme.mode === 'dark';
  const cCheckFill = isDark ? '#FFFFFF' : '#000000';
  const cCheckMark = isDark ? '#000000' : '#FFFFFF';
  const cCheckOutline = cSub;
  const cCheckEmptyBg = isDark ? '#000000' : '#FFFFFF';
  const cCheckEmptyBorder = isDark ? '#FFFFFF' : cCheckOutline;
  // Opaque backing behind the toggle disc (black on dark, white on light) so the
  // connector line tucks cleanly UNDER the checkmark instead of showing through.
  const cCheckBackdrop = isDark ? '#000000' : '#FFFFFF';

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
    : (timePart || whenLabelFallback);

  const typeLabel = { event: 'Event', birthday: 'Birthday' }[itemTypeOf(item)];
  const subtitle = item.project || typeLabel || 'No Board';
  const ownerName = owner?.name?.trim() || null;

  // The card's text column (when-line + title + subtitle). Factored out so an
  // optional `trailing` accessory (e.g. Pending's "add to today" button) can sit
  // beside it in a row without disturbing the plain stacked layout every other
  // caller uses.
  const cardBody = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
        <Text style={{ fontSize: 12, color: cMuted, flexShrink: 1 }} numberOfLines={1}>{whenLabel}</Text>
        {(ownerName || (!completed && !hideCountdown)) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
            {ownerName && (
              <TouchableOpacity
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  marginRight: !completed && !hideCountdown ? 8 : 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: owner.color || cSub,
                }}
                onPress={() => onOwnerPress?.(item)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Owner: ${ownerName}. Open profile`}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '700' }}>
                  {ownerName.charAt(0).toUpperCase()}
                </Text>
              </TouchableOpacity>
            )}
            {!completed && !hideCountdown && <TaskCountdownBadge task={item} />}
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
    </>
  );

  return (
    <View style={{ flexDirection: 'row', marginBottom: ROW_GAP, paddingHorizontal: 14 }}>
      {/* Rail column — connecting line segments + the completion toggle.
          overflow visible + zIndex so the connector line below can spill out
          of this column and paint over the card. */}
      <View style={{ width: ICON, alignSelf: 'stretch', alignItems: 'center', overflow: 'visible', zIndex: 2 }}>
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
          // zIndex/elevation above the connector line so the checkmark paints
          // OVER it (line is above the card but below the checkmark).
          style={{ width: ICON, height: ICON, alignItems: 'center', justifyContent: 'center', zIndex: 4, elevation: 4 }}
        >
          {/* Opaque backdrop so the line disappears behind the checkmark. */}
          <View style={{ position: 'absolute', width: DOT + 2, height: DOT + 2, borderRadius: (DOT + 2) / 2, backgroundColor: cCheckBackdrop }} />
          <View
            style={{
              width: DOT,
              height: DOT,
              borderRadius: DOT / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: completed ? cCheckFill : cCheckEmptyBg,
              borderWidth: completed ? 0 : 1.5,
              borderColor: cCheckEmptyBorder,
            }}
          >
            {completed && <Icon name="check" size={DOT - 5} color={cCheckMark} />}
          </View>
        </TouchableOpacity>

        {/* Connector: a horizontal line from the CENTRE of the toggle circle
            (top = ICON_CENTRE − half thickness; the disc is centred at y=20 in
            the 40px toggle), running right over the card and lapping onto it by
            5px. left = ICON_CENTRE (start at circle centre); width reaches the
            card's left edge (ICON_CENTRE→ICON is the toggle's right half = 20,
            + 12px card margin) + 5px overlap = 37. Only drawn when the card has
            a time/date to point at. pointerEvents off so it never eats taps. */}
        {(item.time || (!hideDate && whenDate)) && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: ICON_CENTRE - 1,
              left: ICON_CENTRE,
              // Starts under the checkmark (masked by the backdrop) and runs to
              // 5px PAST the card's left edge: toggle right-half (ICON−ICON_CENTRE)
              // + 12px card margin + 5px overlap onto the card.
              width: (ICON - ICON_CENTRE) + 12 + 5,
              height: 1.5,
              backgroundColor: cCheckFill,
              opacity: 0.8,
              borderRadius: 1,
              // Above the card, below the checkmark.
              zIndex: 3,
              elevation: 3,
            }}
          />
        )}
      </View>

      {/* Card */}
      <TouchableOpacity
        {...TAP_ONLY}
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
          // Board tasks get a hairline border in the board's colour (matches the
          // hatch backdrop); everything else keeps the neutral card border.
          borderColor: hatchColor || cBorder,
          paddingVertical: 9,
          paddingHorizontal: 12,
          opacity: completed ? 0.65 : 1,
          // Uniform mode: pixel-exact card height so the row's total height is
          // a constant the agenda's placeholder geometry can rely on.
          ...(uniform ? { height: UNIFORM_CARD_H, overflow: 'hidden', justifyContent: 'center' } : {}),
          // With a trailing accessory the card lays out as [text | button].
          ...(trailing ? { flexDirection: 'row', alignItems: 'center' } : {}),
        }}
      >
        {/* Low-opacity diagonal hatch in the board's colour, behind the content
            (calendar day pane only — callers pass hatchColor when the task
            belongs to a board). Self-clips to the card's radius. */}
        <HatchBackdrop color={hatchColor} style={{ borderRadius: 12 }} />
        {trailing ? (
          <>
            <View style={{ flex: 1, minWidth: 0 }}>{cardBody}</View>
            {trailing}
          </>
        ) : cardBody}
      </TouchableOpacity>
    </View>
  );
};
