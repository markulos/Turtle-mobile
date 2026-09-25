import React from 'react';
import { View, Text, TouchableOpacity, PixelRatio, StyleSheet } from 'react-native';
import { TAP_ONLY } from '../../../utils/pressBehavior';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { itemTypeOf, formatDueDate } from '../utils/taskHelpers';
import { tapHaptic } from '../../../utils/haptics';
import TaskCountdownBadge from './TaskCountdownBadge';
import { HatchBackdrop } from './HatchBackdrop';
import { boardCardPalette } from '../utils/cardPalette';
import { clockLabel } from './ScheduleCard';

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
const DOT = 22; // diameter of the completion ring overlaid on the card's right edge
// The time column on the left of every row. Wider than it was: the time is
// now held INSIDE its bubble rather than sitting beside one, so the column has
// to fit "08:30 PM" and its padding — at 62 the label truncated to "08:30…".
const TIME_COL = 74;
const ROW_PAD = 14;
// Gap between the time column and the card — the channel the thread runs down.
const CARD_GAP = 12;

// ── The timeline's thread and its bubbles ───────────────────────────────────
// One continuous line down the agenda, with the times hanging off its LEFT and
// the cards starting immediately to its RIGHT: the line is the boundary
// between the two columns, so it reads as one spine with the clock on one side
// and the content on the other.
//
// It used to run through the MIDDLE of the time column, with each bubble
// threaded onto it — which put the line inside the times rather than between
// the times and the tasks. The bubbles now sit flush against its left side and
// reach it with a short connector stub, so they're still visibly strung on the
// spine without straddling it.
//
// CRITICAL: an absolutely-positioned child's `left` is measured from its
// parent's BORDER box in Yoga — the parent's padding is NOT added. The rows
// carry ROW_PAD of horizontal padding and the date dividers carry none, so an
// earlier version used two different numbers meaning to reach the same x and
// drew two parallel lines 14pt apart. Both sides now use this one absolute
// value verbatim.
export const RAIL_ABS_X = ROW_PAD + TIME_COL + Math.round(CARD_GAP / 2);
// A full point wide — a hairline (one device pixel) read as too faint to be a
// spine at this length.
export const RAIL_W = 1;
// THE thread's colour — one value for every segment that draws it (this row,
// its stub, and the agenda's date dividers in TasksScreen/index.jsx). It used
// to be two: the rows drew the strong ink at 45% opacity while the dividers
// drew it at full strength, so the line visibly darkened at every date. Black
// at 60% here, and its exact counterpart on the dark page — a 60%-black line
// on a black background is no line at all.
export const threadColor = (theme) =>
  (theme?.mode === 'dark' ? 'rgba(255,255,255,0.60)' : 'rgba(0,0,0,0.60)');
// The stub joining each bubble's right edge to the thread. It spans the whole
// channel from the time column's edge to the line, so the bubble never floats.
const STUB_W = RAIL_ABS_X - (ROW_PAD + TIME_COL);
// The bubble: a pill holding the whole time, centred on the thread. Opaque, so
// the line is hidden behind its body and visible above and below it.
const PILL_H = 22;
// Where the pill's centre sits inside the row — on the card's first line, not
// the middle of the card (a card's height is its layout, not its duration).
const PILL_TOP = 9;
const PILL_CENTRE = PILL_TOP + PILL_H / 2;
const parseHM = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

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
export const TimelineTaskRow = ({ item, onPress, onLongPress, onToggleComplete, onPressTime, isFirst, isLast, hideDate, done, doneDate, hideCountdown, railColor, boardColor, uniform, whenLabelFallback = 'No date', trailing, hatchColor, owner, onOwnerPress }) => {
  const { theme, timeFormat } = useTheme();
  const c = theme.colors || {};
  const use24h = timeFormat === '24h';

  // The card wears its BOARD (utils/cardPalette): the board's colour mixed
  // into the dark panel, and that panel plain — unchanged — when the row has
  // no board. The inks ride along with the fill, so no call site has to think
  // about contrast.
  const inv = boardCardPalette(theme, boardColor);
  const cText = inv.text;
  const cSub = inv.sub;
  const cMuted = inv.muted;
  const cCardBg = inv.card;
  const cBorder = inv.edge;
  // The thread itself is NOT the caller's to colour — it is one line down the
  // whole agenda and every segment of it uses `threadColor`. `railColor` is
  // the BUBBLE's ink (the agenda's strong black/white pill).
  //
  // It used to be drawn ONLY on the date dividers between groups, which is why
  // the agenda's left edge read as a row of disconnected black dashes rather
  // than a timeline: the line existed at the joins and nowhere else. It runs
  // through every row now, bridging the gap below it, so the dividers' own
  // segments are continuations of one line instead of the whole of it.
  const rail = railColor || cBorder;
  const thread = threadColor(theme);

  // The completion ring takes the card's own inks (see the render).

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

  // An event says so on the bubble instead of showing a clock. It isn't a
  // thing you do AT a time the way a task is — it's a thing that's on that
  // day — and the card's when-line still carries the hour for the ones that
  // have one, so naming the kind here costs nothing and reads at a glance.
  const isEvent = itemTypeOf(item) === 'event';
  const bubbleLabel = isEvent
    ? 'Event'
    : (item.time ? clockLabel(parseHM(item.time), use24h) : '—');

  // The subtitle names the board, falling back to the item's KIND for the
  // kinds the row doesn't otherwise state. An event's kind is on the bubble
  // now, so repeating it here would print "Event" twice on one card.
  const typeLabel = { birthday: 'Birthday' }[itemTypeOf(item)];
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
            {!completed && !hideCountdown && <TaskCountdownBadge task={item} palette={inv} />}
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
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: ROW_GAP, paddingHorizontal: 14 }}>
      {/* The thread. One continuous line down the whole agenda: it runs from
          this row's top (unless the row opens a band, where there is nothing
          above to join) PAST the bottom by the row gap, so the next row's
          segment starts exactly where this one ends and the join is invisible.
          It passes BEHIND the bubble, which is what makes it read as threaded
          through rather than as two stubs meeting a marker. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: RAIL_ABS_X - RAIL_W / 2,
          top: isFirst ? PILL_CENTRE : 0,
          bottom: isLast ? undefined : -ROW_GAP,
          height: isLast ? PILL_CENTRE : undefined,
          width: RAIL_W,
          backgroundColor: thread,
        }}
      />

      {/* The stub joining this row's bubble to the thread, at the bubble's own
          height — the bubble sits left of the line now, so without this it
          would read as a label floating beside a rule. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: ROW_PAD + TIME_COL,
          top: PILL_CENTRE - RAIL_W / 2,
          width: STUB_W,
          height: RAIL_W,
          backgroundColor: thread,
        }}
      />

      {/* The bubble — and it HOLDS the time rather than sitting beside one.
          Hung off the LEFT of the thread, flush against the channel it runs
          down, so the times stay clear of the cards.

          Filled while the task is still to happen, hollow once it is done: it
          is still strung on the thread, but it has stopped being a thing that
          is waiting.

          Tapping it reschedules — the time alone when the row already has a
          date, otherwise date-then-time (see onPressTime). */}
      <View style={{ width: TIME_COL, alignItems: 'flex-end', paddingTop: PILL_TOP }}>
        <TouchableOpacity
          onPress={onPressTime ? () => { tapHaptic(); onPressTime(item); } : undefined}
          disabled={!onPressTime}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 8 }}
          accessibilityRole={onPressTime ? 'button' : undefined}
          accessibilityLabel={onPressTime
            ? (item.dueDate ? 'Change time' : 'Set date and time')
            : undefined}
          style={{
            minWidth: 44,
            height: PILL_H,
            paddingHorizontal: 8,
            borderRadius: PILL_H / 2,
            borderWidth: 1.5,
            borderColor: rail,
            backgroundColor: completed ? theme.colors.background : rail,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontSize: 11.5,
              fontWeight: '700',
              // On the filled pill the text is the PAGE's colour, not the
              // theme's ink: the pill is the strong black/white rail colour,
              // so ordinary text on it would be invisible.
              color: completed ? theme.colors.textSecondary : theme.colors.background,
              fontVariant: ['tabular-nums'],
              letterSpacing: 0.1,
            }}
            numberOfLines={1}
          >
            {bubbleLabel}
          </Text>
        </TouchableOpacity>
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
          marginLeft: CARD_GAP,
          backgroundColor: cCardBg,
          borderRadius: 16,
          borderWidth: 1,
          // Board tasks get a hairline border in the board's colour (matches the
          // hatch backdrop); everything else keeps the neutral card border.
          borderColor: hatchColor || cBorder,
          // Inset: the recess catches light along its top edge.
          borderTopColor: hatchColor || inv.edgeTop,
          paddingVertical: 9,
          paddingLeft: 12,
          // Room for the completion ring overlaid on the right edge.
          paddingRight: 12 + DOT + 12,
          opacity: completed ? 0.65 : 1,
          ...inv.shadow,
          // Uniform mode: pixel-exact card height so the row's total height is
          // a constant the agenda's placeholder geometry can rely on.
          ...(uniform ? { height: UNIFORM_CARD_H, justifyContent: 'center' } : {}),
          // With a trailing accessory the card lays out as [text | button].
          ...(trailing ? { flexDirection: 'row', alignItems: 'center' } : {}),
        }}
      >
        {/* Low-opacity diagonal hatch in the board's colour, behind the content
            (callers pass hatchColor when the task belongs to a board). */}
        <HatchBackdrop color={hatchColor} style={{ borderRadius: 12 }} />
        {trailing ? (
          <>
            <View style={{ flex: 1, minWidth: 0 }}>{cardBody}</View>
            {trailing}
          </>
        ) : cardBody}
        {/* Completion ring — INSIDE the card, overlaid on its right edge and
            vertically centred. Done = filled with the card's text colour and a
            check in the card colour; not done = a hairline ring. */}
        <TouchableOpacity
          onPress={() => { tapHaptic(); onToggleComplete?.(item); }}
          activeOpacity={0.7}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: completed }}
          accessibilityLabel={completed ? 'Mark not done' : 'Mark done'}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center', zIndex: 4, elevation: 4 }}
        >
          <View
            style={{
              width: DOT,
              height: DOT,
              borderRadius: DOT / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: completed ? cText : 'transparent',
              borderWidth: completed ? 0 : 1.5,
              borderColor: cText,
            }}
          >
            {completed && <Icon name="check" size={DOT - 8} color={cCardBg} />}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </View>
  );
};
