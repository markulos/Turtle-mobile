import React, { useState, useMemo, useRef, useEffect, useCallback, useContext } from 'react';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dockOccupied } from '../../../components/tabBarLayout';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  FlatList,
  Dimensions,
  LayoutAnimation,
  Platform,
  UIManager,
  Keyboard,
  RefreshControl,
  Pressable,
  Animated,
  AppState,
} from 'react-native';
import { depth } from '../../../utils/surfaceDepth';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withTiming,
  Easing,
  runOnJS,
  interpolate,
  interpolateColor,
  Extrapolation,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
// Resets the VirtualizedList "am I nested?" context for a subtree. The day
// pager below is a horizontal FlatList that legitimately lives inside the
// horizontal calendar⇄list pager (an Animated.ScrollView in TasksScreen) —
// same orientation, which RN flags with "VirtualizedLists should never be
// nested inside plain ScrollViews…". The nesting is intentional and the
// gesture conflict is already handled (the outer pager locks via
// scrollEnabled while the day planner is open), so we wrap the inner list to
// clear the context for that subtree only — the same escape hatch React
// Navigation uses. Not on RN's public index, hence the deep import.
import { VirtualizedListContextResetter } from 'react-native/Libraries/Lists/VirtualizedListContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import { blurProps, frostBorderColor } from '../../../utils/frostedChat';
import { useTheme } from '../../../context/ThemeContext';
import { formatDueDate, isOverdue, itemTypeOf, itemColorOf, itemIconOf, taskPassesFilters, matchesRecurrence, isOccurrenceCompleted, parseLocalYMD, boardLabel } from '../utils/taskHelpers';
import { monthLayout } from '../utils/monthLayout';
import { topFadeStops } from '../utils/topFadeStops';
import { LinearGradient } from 'expo-linear-gradient';
import ScheduleCard, { clockLabel, TIME_COL_W } from './ScheduleCard';
import { buildCompactRows, gapHourMarks, gapKey, gapNowOffset, minutesToTimeString } from '../utils/compactSchedule';
import { insetCardPalette } from '../utils/cardPalette';
import { finderDestination, KIND_SEP, FIELD_SEP } from '../utils/finderDestination';
import TaskFinderOverlay from './TaskFinderOverlay';
// (HatchBackdrop's import went with the task-card hatch. The month grid's
// today marker uses the local DiagonalHatch below, not this component.)
import { TaskSectionFrontier, DAY_SECTION_FIRST_PAINT } from './TaskSectionFrontier';
import { WheelTimePicker } from './WheelTimePicker';
import { tapHaptic } from '../../../utils/haptics';
import { useTapOnly } from '../../../utils/pressBehavior';

// Spring used for every snap of the day-tasks bottom sheet (drag release,
// tap-toggle, programmatic open). Tuned snappy-but-soft; expect on-device
// tweaking. Shared module constant so it's referentially stable.
// Softer, gently-settling spring so the day sheet rises/snaps with the same
// smooth feel as the add-task card's present animation (vs. a crisp snap).
const SHEET_SPRING = { damping: 21, stiffness: 205, mass: 0.9 };

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width, height: WINDOW_HEIGHT } = Dimensions.get('window');
const DAY_WIDTH = (width - 40) / 7;
// Full-bleed calendar column width. NOT `100/7 %`: that's 14.285714285714286%,
// and ×7 = 100.00000000000001 (float) — a hair over 100%, which under
// `flexWrap` bumps the 7th cell to a new row (the 6-per-row / empty-SAT bug).
// TRUNCATED to 14.2857% so 7 columns sum to 99.9999% (< 100, never wraps) while
// still filling the width edge-to-edge (the sub-pixel remainder is invisible).
// Shared by the weekday header AND the day cells so both stay pixel-aligned.
const CAL_COL_WIDTH = `${Math.floor((100 / 7) * 1e4) / 1e4}%`; // '14.2857%'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ── Calendar layout constants ─────────────────────────────────
//
// We render 12 months on each side of today in a vertical FlatList.
// Each month is forced to 6 grid rows (42 cells) by padding short
// months with trailing empty cells. This gives EVERY page in the list
// the same height — so `snapToInterval` can snap pixel-perfectly to
// month boundaries no matter where the user releases the scroll.
//
// MONTH_RANGE = 60 → ±60 months = 10 years on each side of today.
// 121 items × ~370px each is fine for FlatList (it virtualizes).
const MONTH_RANGE = 60;
const TODAY_INDEX = MONTH_RANGE;
const CELLS_PER_MONTH = 42; // 6 rows × 7 cols, padded
// Title block — larger now that it carries the month/year inline
// (matches the web app's 28px treatment). Fixed-height so every
// FlatList page stays exactly MONTH_HEIGHT for snapToInterval paging.
const MONTH_TITLE_HEIGHT = 72;
// Day-of-week labels (Sun…Sat) live INSIDE each month's page now
// — sitting just under the title, separated from it by a thin hairline.
// Reserving a fixed height keeps every FlatList page exactly
// MONTH_HEIGHT tall so snapping stays pixel-perfect.
const DAYS_HEADER_HEIGHT = 30;
const GRID_PADDING_TOP = 4;
// Comfortable horizontal indent for the calendar's content — matches
// the web app's left-aligned breathing room.
const CALENDAR_HORIZONTAL_PADDING = 16;
// Cells are slightly taller than wide so the calendar grid feels
// spacious — iOS Calendar uses a similar portrait-ish cell shape.
// With the left/right chevron header + standalone Today button gone,
// the grid claims that freed space.
const CELL_HEIGHT = DAY_WIDTH + 10;
// How tall a cell may GROW to fill a big screen. Past this the grid stops
// reading as a calendar and starts reading as a stretched table, and the space
// is better spent as symmetric air above and below the month — see
// `monthTopInset`. A cell still holds the day number + three task pills here.
const MAX_CELL_HEIGHT = DAY_WIDTH + 16;
// 6 rows of day cells. Each cell occupies DAY_WIDTH × CELL_HEIGHT of
// layout space. Plus the title, day-of-week labels, and paddingTop,
// this is the per-month FlatList page height.
// How far the fade reaches PAST the margin, into the first points of the month
// page. This is the part that turns the list's overflow clip into a dissolve:
// the gradient is at full page colour ON the clip and lets go over these few
// points, so a month scrolled up melts instead of being sliced through its
// glyphs. Short on purpose — the month title's text starts ~20pt into its 72pt
// band, so 18 lands on the leading above it and never on the words.
const TOP_FADE_FEATHER = 18;
// Compact ⇄ timeline used to cross-fade two layouts over a height-animating
// wrapper (SCHEDULE_FADE_MS / SCHEDULE_SWAP_MS). There is one layout now, so
// there is nothing to fade between: the switch opens or closes every gap, and
// the gaps' own transform (GAP_OPEN_MS below) is the whole animation.
// Everything on a month page ABOVE the six week rows — title, weekday labels,
// the pad under them. Constant per page, whatever the cell height works out to.
const MONTH_CHROME_HEIGHT = MONTH_TITLE_HEIGHT + DAYS_HEADER_HEIGHT + GRID_PADDING_TOP;
const MONTH_HEIGHT = MONTH_CHROME_HEIGHT + 6 * CELL_HEIGHT;
// FLOOR for the bottom strip reserved for the docked task-panel header peek —
// the grid fills the calendar viewport down to (but not behind) this. The real
// reserve is the sheet header's measured height (see `peekReserve`); this is
// only what's used for the frames before that measurement lands.
const SHEET_PEEK_RESERVE = 80;
// The air between the screen header and the RAISED day-planner card. The sheet
// used to travel all the way to the top of its container; the header then had
// to stand down to avoid being covered, which cost you the view pill and the
// Boards key for as long as you were planning a day. Stopping the card short
// instead keeps both, and the gap is what tells you this is a card over the
// page rather than a new screen. It is subtracted from the sheet's travel as
// well as added to its `top` — see sheetStyle.
const SHEET_RAISED_GAP = 12;
// No reserved strip at the top of the calendar viewport: the up-caret hint
// floats TRANSPARENTLY over the month title, exactly like the down-caret floats
// over the next month below. A reserved band read as an opaque header strip and
// clipped the top of the month title.

// ── Hourly timetable constants ────────────────────────────────
//
// An HOUR, in points — the scale the schedule draws empty time at. Only empty
// time: a task is a card of its own fixed height (ScheduleCard.CARD_H) saying
// what it runs from and to, because a block sized by duration made a 20-minute
// task 16 pt tall with its title clipped, and the shortest tasks are not the
// least important ones. An empty HOUR has nothing to say but how long it is, so
// it is the thing that gets to be measured in points.
//
// 48 → ~2× the web app's 36px, which is also what makes an open hour a slot you
// can actually aim at (§3's 44 pt, with room to spare).
const HOUR_HEIGHT = 48;
// ONE gutter for the whole day view. The hour labels inside an open gap and the
// cards' own time column are the same column — they interleave — so they cannot
// each own a width. ScheduleCard's is the one that has to hold "12:38 PM" in
// full, so it is the one that sets it.
const HOUR_LABEL_WIDTH = TIME_COL_W;
const { width: SCREEN_W } = Dimensions.get('window'); // off-screen start for the day-swipe slide
const DEFAULT_TASK_DURATION_MIN = 60;

// ── Expanding a gap ────────────────────────────────────────────────────────
// One hour row inside an expanded gap. FIXED, and that is what makes the
// animation honest: the open height is `rows × this`, known before a single
// pixel moves, so nothing has to be measured first and the expansion can start
// on the same frame as the tap. Measure-then-animate would cost a layout pass
// and show one frame at the wrong size.
// An expanded gap IS a slice of the timeline, so it is drawn at the timeline's
// own scale. At 26 the hours were a cramped list you could read but not aim
// at — and now that each one is a tap target for "make a task here", it has to
// be a slot you can actually hit (§3's 44 pt, with room to spare).
const GAP_HOUR_H = HOUR_HEIGHT;
// The rule row at the top of each slot: the hour label and its line. Fixed so
// the band can be placed against the line rather than against the row.
const GAP_RULE_H = 18;
// Where the hairline actually SITS inside that row. The row is 18 tall and
// centres its line, so the line is half way down — which is why a band drawn
// from the row's top edge started 9 pt above the line it was supposed to begin
// at, and ended 9 pt short of the next one. Everything that should line up
// with the LINE is offset by this, not by 0.
const GAP_LINE_Y = GAP_RULE_H / 2;
// Quick, and the same curve both ways. What makes this read as smooth is not
// the curve — it is that NO LAYOUT RUNS WHILE IT MOVES. The gap takes its full
// height in ONE layout pass on the frame of the tap, and everything below is
// translated straight back up by exactly that much; the animation is then a
// single translateY running to zero on the UI thread. The old version animated
// the box's `height`, which re-ran Yoga for the whole schedule every frame and
// left the ancestor's LinearTransition chasing a target that moved under it —
// that chase, not the easing, was the stutter.
const GAP_OPEN_MS = 190;
const GAP_CLOSE_MS = 160;
const GAP_EASE = Easing.out(Easing.quad);

/**
 * gapOffset — how far an opening gap's content is displaced from where it will
 * sit once the gap has settled, in points. The moving half of a reserve.
 *
 * A gap holds its space as real layout height and then TRANSLATES what that
 * space displaced back up by the same amount, so claiming the room moves
 * nothing; the animation is the translate running to zero. `reserved` is
 * whether the room is claimed at all, `progress` how far through the reveal it
 * is.
 *
 * ZERO AT REST — both rests, open and shut — and that is not an aesthetic
 * point. On Fabric a view whose content sits outside its own bounds is a view
 * whose content cannot be TOUCHED: `RCTViewComponentView.hitTest` rejects any
 * point outside bounds unless Yoga measured an `overflowInset`, and Yoga has
 * never heard of transforms. A settled gap with a live translate on it is a
 * column of hour slots you can see, and a `+` on each one you cannot press.
 * (It shipped that way for one update: the tap target died two views above the
 * slot.) So the displacement exists only while something is actually moving.
 */
export function gapOffset(reserved, progress, openH) {
  'worklet';
  return reserved ? (progress - 1) * openH : 0;
}

/**
 * CompactGap — the "6h30m" line between two scheduled tasks, the hours it opens
 * into, and EVERYTHING BELOW IT in the list, passed as children.
 *
 * The rest of the list is nested inside the gap rather than following it as a
 * sibling because that is what lets the whole expansion be one transform: the
 * same translateY that slides the hour rows down out from under the task above
 * carries the cards below down the page, in lockstep, so the block stays rigid
 * and nothing can drift out of step with anything else. Nesting each gap inside
 * the previous one makes the offsets compose for free — a card under two open
 * gaps inherits both without anyone summing anything.
 *
 * `reserved` is the LAYOUT state, `open` the intent. They differ only while a
 * close is in flight, which is exactly the point: the space has to outlive the
 * animation that gives it up, or the cards would arrive before it left. Both
 * `reserved` and the reveal are shared values, on the UI thread, for the reason
 * in the effect below.
 */
/**
 * GapHourSlot — one empty hour inside an opened gap, and the target that turns
 * it into a task.
 *
 * The RULE is drawn at the top with the + centred ON it, and the tappable BAND
 * is the space strictly between this rule and the next — the hour itself. The
 * band used to start at the rule and run the slot's full height, so it painted
 * over its own line and butted into the next one; the lines are the thing you
 * are reading the grid by, so the highlight goes between them, not across them.
 *
 * The press is `useTapOnly`: a slot is 48 pt of a scrolling, horizontally-paging
 * surface, so a swipe that begins on one must not light it or create anything.
 */
function GapHourSlot({ minute, label, onPick, styles, theme }) {
  const tap = useTapOnly(() => onPick?.(minute));
  return (
    <Pressable
      disabled={!onPick}
      accessibilityRole="button"
      accessibilityLabel={`Add a task at ${label}`}
      testID={`gap-hour-${minute}`}
      style={styles.compactGapHour}
      // The target is the BAND, not the layout box. The box starts at this
      // hour's rule ROW, whose hairline sits GAP_LINE_Y down inside it, so the
      // box runs from 9 pt above this hour's line to 9 pt above the next —
      // while the hour you can SEE runs line to line. Left alone, the bottom
      // 9 pt of a lit band belonged to the slot below it, and a tap there made
      // a task an hour later than the one it landed on. Shifting the target
      // down by the same offset the band uses makes what you press the thing
      // you pressed.
      hitSlop={{ top: -GAP_LINE_Y, bottom: GAP_LINE_Y }}
      {...tap.props}
    >
      {({ pressed }) => (
        <>
          {/* Lit only for a press that has held still — `settled` goes false
              the moment the finger travels, so a scroll never leaves a band
              glowing behind it. */}
          <View style={[styles.compactGapBand, pressed && tap.settled && styles.compactGapBandOn]} />
          <View style={styles.compactGapRule}>
            <Text style={styles.hourLabel} numberOfLines={1}>{label}</Text>
            <View style={styles.compactGapHourLine} />
          </View>
          {/* The + is the hour's hint, so it sits in the middle of the HOUR —
              vertically centred in the slot, on the right. On the rule it read
              as belonging to the line rather than to the space under it. */}
          {!!onPick && (
            <View style={styles.compactGapHourPlus} pointerEvents="none">
              <Icon name="plus" size={14} color={theme.colors.textMuted} />
            </View>
          )}
        </>
      )}
    </Pressable>
  );
}

function CompactGap({ row, open, onToggle, onPickHour, styles, theme, use24h, nowMinutes, showNow, children }) {
  const hours = useMemo(() => gapHourMarks(row.from, row.to), [row.from, row.to]);
  const openH = hours.length * GAP_HOUR_H;

  // Where NOW falls inside this stretch, in points down from the top of the
  // hour rows — or null when the clock is elsewhere, or this is not today. The
  // arithmetic is `gapNowOffset`; all this adds is the day.
  const nowY = useMemo(
    () => (showNow ? gapNowOffset(row.from, row.to, nowMinutes, { hourHeight: GAP_HOUR_H, lineY: GAP_LINE_Y }) : null),
    [showNow, row.from, row.to, nowMinutes],
  );

  // ── The reserve lives on ONE thread ─────────────────────────────────────
  //
  // `reserved` is whether the space is claimed, `progress` how far through the
  // reveal we are. Together they are one state — height openH with the content
  // held at -openH is "open but not yet revealed" — and the pair must never be
  // READ from different frames: height openH with the content NOT held is a
  // whole gap's worth of empty space, which is the list below dropping ~openH
  // and snapping back.
  //
  // `reserved` used to be React state, which put the two halves on two
  // pipelines: the height came from a React commit, the offset from a
  // Reanimated worklet that had `reserved` in its deps and so had to rebuild
  // and apply on its own next UI flush. Usually the same frame. Occasionally
  // one apart — the intermittent jump. (Moving the offset into React instead
  // fixed the jump and cost the touches; see `gapOffset`.)
  //
  // So BOTH are shared values. The height and the offset are two mappers
  // reading one value, dirtied together and flushed in the same UI frame, which
  // is one commit. Nothing can catch them apart, and claiming the space needs
  // no render at all — so there is no second pass to wait for either.
  const reserved = useSharedValue(open ? 1 : 0);
  // Starts settled rather than animating from 0 on mount: a gap that is already
  // open (it survived a re-render) must not replay its entrance.
  const progress = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    if (open) {
      reserved.value = 1;
      progress.value = withTiming(1, { duration: GAP_OPEN_MS, easing: GAP_EASE });
      return;
    }
    // Already shut — every closed gap on every pane mount lands here, and there
    // is no animation worth running from nothing to nothing.
    if (!reserved.value) return;
    progress.value = withTiming(0, { duration: GAP_CLOSE_MS, easing: GAP_EASE }, (finished) => {
      // Hand the space back only once the cards are standing on it again — on
      // the same thread, in the same frame the movement settles. An interrupted
      // close reports `finished` false, so a re-open never has the floor pulled
      // out from under it.
      if (finished) reserved.value = 0;
    });
  }, [open, reserved, progress]);

  // The SPACE. A step, not an animation: it takes two values and changes twice
  // per toggle, so no Yoga runs while anything is moving. It must not read
  // `progress` for that reason — a mapper that does would re-commit a layout
  // prop on every frame of the reveal, which is the whole-schedule relayout
  // this design exists to avoid.
  const bodyStyle = useAnimatedStyle(() => ({
    height: reserved.value * openH,
  }), [openH]);

  // The MOVEMENT. Two identical hooks rather than one shared style object,
  // because an animated style belongs to a single component.
  const hoursStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: gapOffset(reserved.value, progress.value, openH) }],
  }), [openH]);
  const shiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: gapOffset(reserved.value, progress.value, openH) }],
  }), [openH]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.value * 180}deg` }],
  }));

  const durText = fmtDur(row.minutes);

  return (
    <View style={styles.compactGapWrap}>
      {/* The clipping box. Its height is a step on the UI thread, set once per
          toggle; the rows inside are what move. They start a full box-height up
          — tucked behind the task above — and are uncovered as they travel
          down, which is why this reads as the space revealing them rather than
          them sliding out of a box that was already there.
          ONE view for the space and one for the movement, and at rest the
          movement is zero — which is what keeps the slots inside it pressable
          (see `gapOffset`). */}
      <Reanimated.View style={[styles.compactGapBody, bodyStyle]}>
        <Reanimated.View style={hoursStyle}>
          {/* Drawn with the schedule's own label and rule styles, in its own
              gutter, so an open gap IS a slice of the timeline — not a third
              kind of row that happens to list hours. Open every one of them and
              what you have is the whole day, hour by hour: that is all the
              "Timeline" control does. */}
          {hours.map((minute) => (
            /* Each hour is a SLOT: tap it and the finder opens with that time
               already pending, so "I have nothing at 4" and "put something at
               4" are the same gesture. The hours were only ever a readout
               before — you had to close the gap again and go find the + . */
            <GapHourSlot
              key={`gap-hour-${minute}`}
              minute={minute}
              label={clockLabel(minute, use24h, { pad: false })}
              onPick={onPickHour}
              styles={styles}
              theme={theme}
            />
          ))}
          {/* NOW. Inside the hours' own transform, so it is revealed with them
              rather than sitting still while the grid it belongs to slides out
              from under it — and inside the clipping box, so a gap closing
              takes the line with it. */}
          {nowY != null && (
            <View pointerEvents="none" style={[styles.gapNowLine, { top: nowY - 1 }]} testID={`gap-now-${row.from}`}>
              <View style={styles.nowDot} />
              <View style={styles.nowBar} />
            </View>
          )}
        </Reanimated.View>
      </Reanimated.View>

      {/* The control and the whole rest of the list ride the same offset, so
          the block stays rigid.
          The control stays put UNDER the hours, so the tap that opened it is
          the tap that closes it — it has simply been carried down the page by
          the thing it revealed. One chevron that turns over, not two icons
          swapping: a swap is a cut, and a cut is the one thing an organic
          expansion cannot have in it. */}
      <Reanimated.View style={shiftStyle}>
        <View style={styles.compactGapRow}>
          <View style={styles.compactGapSpacer} />
          <View style={styles.compactGapLine} />
          <Pressable
            onPress={onToggle}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={
              open
                ? `Collapse the ${durText} between these tasks`
                : `Show the ${durText} between these tasks, hour by hour`
            }
            testID={`schedule-gap-${row.from}-${row.to}`}
            style={({ pressed }) => [styles.compactGapLabel, pressed && { opacity: 0.55 }]}
          >
            <Text style={styles.compactGapText} numberOfLines={1}>{durText}</Text>
            <Reanimated.View style={chevronStyle}>
              <Icon name="chevron-down" size={13} color={theme.colors.textTertiary} />
            </Reanimated.View>
          </Pressable>
          <View style={styles.compactGapLine} />
        </View>
        {children}
      </Reanimated.View>
    </View>
  );
}

// Format a HH:MM string as a clock time. 24h → "15:45"; otherwise 12-hour
// AM/PM ("3:45 PM"). `use24h` flows from the timeFormat pref.
const formatTimeLabel = (hhmm, use24h = false) => {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (use24h) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const isPM = h >= 12;
  const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${dh}:${String(m).padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;
};

// "HH:MM" → minutes-since-midnight; minutes → clock time (honours the 24h
// pref via use24h); minutes → compact duration ("1h5m", "25m", "2h"). Used by
// the collapsed schedule's time ranges + gap labels.
const parseHM = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const fmtHM = (mins, use24h = false) => {
  const t = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60);
  const m = t % 60;
  if (use24h) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const isPM = h >= 12;
  const dh = h % 12 === 0 ? 12 : h % 12;
  return `${dh}:${String(m).padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;
};
const fmtDur = (mins) => {
  const v = Math.max(0, Math.round(mins));
  const h = Math.floor(v / 60);
  const m = v % 60;
  if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`;
  return `${m}m`;
};

// ── Pure date helpers (no theme / state dependency) ──────────
//
// Pulled out of the component so they aren't redefined on every render
// and so they can be reused without closure capture.

// Convert a #RRGGBB hex (the theme background) to an rgba() string at the
// given alpha — used to build the soft, fade-to-transparent gradient behind
// the swipe-hint chevrons so they overlay the grid instead of masking it.
// Non-hex inputs (already-rgba tokens) are returned unchanged.
const hexToRgba = (hex, alpha) => {
  if (typeof hex !== 'string' || hex[0] !== '#') return hex;
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const toDateString = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Weekday headers for the week strip (Sun→Sat) — the 3-letter abbreviation now
// sits INSIDE the highlight pill, above the date.
const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Selected-day highlight in the week strip — a soft rounded SQUARE (not a full
// circle) in a yellow-orange. Fixed hex (not a theme token) so the same warm
// highlight reads identically on BOTH the dark and light surface; the number on
// top uses a fixed dark ink so it stays legible on the orange in either mode.
const WEEK_SELECT_BG = '#F5A623';
const WEEK_SELECT_FG = '#1A1A1A';

// ── The TO-DO List sheet takes the PAGE's side ──────────────────────────────
// It used to be its own dark room in both app themes — a white-on-black pane
// over a white page. That was a defensible call while the pane covered the
// whole screen and had to be legible over any month colour behind it, but the
// sheet is a CARD now: it stops below the header (SHEET_RAISED_GAP) with the
// page visible around it, and a black card on a white page is a hole. So the
// pane follows the app theme — WHITE on a light theme, the same dark grey as
// before on a dark one.
//
// The surface is still the chat composer's frost: BlurView at composer
// strength under a translucent tint, so what's behind reads softly through.
// Nothing inside the panel paints a flat surface over it.
//
// Alpha is far higher than the composer's, for one reason: this pane carries
// paragraphs, not a one-line input, and it has a whole MONTH GRID behind it
// rather than a settled chat. At 0.74 the grid's own type — "September 2026",
// the day numbers, the little task chips — read straight through the panel and
// competed with the list for the same eye. 0.90 / 0.72 keeps the glass (you can
// still see the month move behind it) while making the panel's own text the
// only thing you can actually READ. The calendar behind also dims to 42 %
// (calendarStyle); the three together are what buy the glass.
const sheetFrost = (theme) =>
  theme.mode === 'dark' ? 'rgba(28, 28, 30, 0.72)' : 'rgba(255, 255, 255, 0.90)';

// The blur under that tint. The composer's 85 is tuned for a bar over chat;
// this is a full pane over a grid of small type, and type is exactly what a
// blur has to destroy for a frost to read as a surface rather than as a dirty
// window. 100 is the top of expo-blur's range.
const SHEET_BLUR = 100;

/**
 * The SHEEN — a vertical wash over the tint, and the thing that makes the pane
 * read as a pane of glass rather than as a flat translucent rectangle. Real
 * glass catches the light along its top edge and falls off quickly; that is all
 * this is.
 *
 * Three stops, not two, with the mid stop pulled up to 0.35: a straight
 * two-stop ramp over a tall pane spreads the falloff across the whole height,
 * which reads as a grey cast rather than as light, and is where gradient
 * banding shows. Front-loading it keeps the transition inside the top third,
 * where there are enough pixels per step that the steps are invisible.
 *
 * Very low alphas on purpose — at these values you should not be able to point
 * at a gradient, only notice that the top of the panel is lit.
 */
const sheetSheen = (theme) => (theme.mode === 'dark'
  ? {
    // On dark glass the light is the only thing that shows, so it works from
    // white rather than from the surface colour.
    colors: ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.03)', 'rgba(255,255,255,0)'],
    locations: [0, 0.35, 1],
  }
  : {
    // On light glass a WHITE sheen is invisible against a near-white tint, so
    // the falloff is the other way round: pure white at the top, settling into
    // the faintest cool shade at the foot. The cool end is what stops a big
    // white pane looking like paper.
    colors: ['rgba(255,255,255,0.85)', 'rgba(255,255,255,0.25)', 'rgba(228,232,240,0.16)'],
    locations: [0, 0.35, 1],
  });
// The sheet's base grey as a SOLID colour, kept for the dark palette below.
// Exported because components/index.jsx re-exports it.
export const SHEET_SOLID = '#1C1C1E';
// The sheet's top hairline and the same colour at zero alpha, per theme.
// Raised, the sheet is a card sitting under the header; a rule across its top
// edge only ever drew a second line under the one the header already has, so it
// fades out as the sheet parks (see sheetShapeStyle). Written out rather than
// read from frostBorderColor() because interpolateColor needs literal ends.
const SHEET_BORDER = { dark: 'rgba(255, 255, 255, 0.12)', light: 'rgba(0, 0, 0, 0.10)' };
const SHEET_BORDER_CLEAR = { dark: 'rgba(255, 255, 255, 0)', light: 'rgba(0, 0, 0, 0)' };

/**
 * The palette everything INSIDE the sheet is drawn with.
 *
 * Built from the LIVE app theme — mode included — so the components that branch
 * on `theme.mode === 'dark'` (ScheduleCard's board-colour wash, the week strip's
 * today pill, the hour grid's rules) take the branch that actually matches the
 * pane they are sitting on. It departs from the app theme in two ways, in both
 * modes:
 *
 *   • the pane and its cards are set ONE RUNG APART on the platform's own
 *     elevation ladder (#1C1C1E under #2C2C2E on dark, #FFFFFF under #F2F2F7 on
 *     light), because a card whose fill matches the pane has no edge left;
 *   • the ink is pushed to the ends (pure white / pure black rather than the
 *     app's softened #E0E0E0) — the pane is translucent, so its text needs the
 *     extra contrast against whatever is blurring through.
 *
 * The muted rung sits at 52 % rather than the app's 30 %: it is used for real
 * words here — the time column beside a task, the hint on an empty day — and at
 * 30 % over a translucent pane that measured ~3.5:1, under the 4.5:1 body text
 * has to clear.
 *
 * The user's accent carries over untouched, so the sheet still belongs to the
 * app they picked. The BORDERS deliberately do not: the accent tints them, and
 * every divider in here came out a muddy amber that read as a colour decision
 * rather than a rule. A divider's job is to be barely there.
 */
const sheetThemeFrom = (theme) => {
  const dark = theme.mode === 'dark';
  return {
    ...theme,
    colors: {
      ...theme.colors,
      background: dark ? SHEET_SOLID : '#FFFFFF',
      surface: dark ? '#2C2C2E' : '#F2F2F7',
      surfaceElevated: dark ? '#2C2C2E' : '#F2F2F7',
      surfaceHighlight: dark ? '#3A3A3C' : '#E6E6EB',
      textPrimary: dark ? '#FFFFFF' : '#000000',
      textSecondary: dark ? 'rgba(255, 255, 255, 0.78)' : 'rgba(0, 0, 0, 0.78)',
      textTertiary: dark ? 'rgba(255, 255, 255, 0.62)' : 'rgba(0, 0, 0, 0.62)',
      textMuted: dark ? 'rgba(255, 255, 255, 0.52)' : 'rgba(0, 0, 0, 0.52)',
      textPlaceholder: dark ? 'rgba(255, 255, 255, 0.55)' : 'rgba(0, 0, 0, 0.55)',
      inputBackground: dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)',
      inputText: dark ? '#FFFFFF' : '#000000',
      border: dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.10)',
      borderStrong: dark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.18)',
    },
  };
};

// Build the months array ONCE at module load. The range is anchored
// to the date the module is first evaluated — fine for an app session,
// and the ±10y window means the user is extremely unlikely to scroll
// past the end. (If they do, `goToToday` brings them right back.)
const buildMonthsList = () => {
  const list = new Array(MONTH_RANGE * 2 + 1);
  const today = new Date();
  const baseYear = today.getFullYear();
  const baseMonth = today.getMonth();
  for (let i = -MONTH_RANGE; i <= MONTH_RANGE; i++) {
    list[i + MONTH_RANGE] = new Date(baseYear, baseMonth + i, 1);
  }
  return list;
};
const MONTHS_LIST = buildMonthsList();
// Map a date → its index in MONTHS_LIST (clamped). Computed from the list's
// first entry, NOT the module-load TODAY_INDEX, so it stays correct even if the
// session crosses a month boundary (opened June 30, tapped "Today" on July 1).
const monthIndexOf = (date) => {
  const d = new Date(date);
  const first = MONTHS_LIST[0];
  const idx = (d.getFullYear() - first.getFullYear()) * 12 + (d.getMonth() - first.getMonth());
  return Math.max(0, Math.min(MONTHS_LIST.length - 1, idx));
};

// ── Horizontal day-pager list ─────────────────────────────────
//
// The day planner's hourly timetable is a native paged FlatList — one
// page per calendar day, ±DAY_RANGE days around today. Built once at
// module load (anchored to today, same as MONTHS_LIST). ~2.2 years each
// side is far more than anyone swipes in a session, and goToToday snaps
// straight back if they somehow reach an edge. FlatList virtualizes, so
// only a handful of day pages are ever live.
const DAY_RANGE = 800;
const DAY_TODAY_INDEX = DAY_RANGE;
const MS_PER_DAY = 86400000;
const buildDaysList = () => {
  const list = new Array(DAY_RANGE * 2 + 1);
  const base = new Date(); base.setHours(0, 0, 0, 0);
  for (let i = -DAY_RANGE; i <= DAY_RANGE; i++) {
    const d = new Date(base); d.setDate(base.getDate() + i);
    list[i + DAY_RANGE] = d;
  }
  return list;
};
const DAYS_LIST = buildDaysList();
const DAYS_LIST_START = DAYS_LIST[0];
// Map a date → its index in DAYS_LIST (clamped to the built range).
const dayIndexOf = (date) => {
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const idx = Math.round((d.getTime() - DAYS_LIST_START.getTime()) / MS_PER_DAY);
  return Math.max(0, Math.min(DAYS_LIST.length - 1, idx));
};

/**
 * Where "today" sits in each list, measured WHEN CALLED.
 *
 * Both lists are built once at module load and anchored to the day the JS
 * bundle started; this app then stays resident for days. `TODAY_INDEX` and
 * `DAY_TODAY_INDEX` therefore mean "the day the bundle loaded", which is only
 * today on the first day. Every piece of mount state that means "today" reads
 * these instead — they measure against each list's own first entry, so they
 * stay right however stale the list is, and clamp inside it.
 *
 * Exported so the property can be tested directly: the answer must MOVE when
 * the date does, without the module being re-imported.
 */
export const todayDayIndex = () => dayIndexOf(new Date());
export const todayMonthIndex = () => monthIndexOf(new Date());

// Contribution heat colours — green → yellow → orange → red.
const CONTRIBUTION_COLORS = ['#9e9e9e', '#81c784', '#ffca28', '#ff9800', '#e57373'];
const getContributionColor = (count) => {
  if (count === 0) return CONTRIBUTION_COLORS[0];
  if (count <= 2)  return CONTRIBUTION_COLORS[1];
  if (count <= 5)  return CONTRIBUTION_COLORS[2];
  if (count <= 9)  return CONTRIBUTION_COLORS[3];
  return CONTRIBUTION_COLORS[4];
};

// Project colour palette — picked so distinct projects stay visually
// distinguishable even when several appear as dots on the same day cell.
const PROJECT_COLORS = [
  '#4CAF50', '#2196F3', '#9C27B0', '#FF5722', '#00BCD4',
  '#795548', '#E91E63', '#3F51B5', '#009688', '#FF9800',
];
const getProjectColor = (projectName) => {
  if (!projectName) return PROJECT_COLORS[0];
  let hash = 0;
  for (let i = 0; i < projectName.length; i++) {
    hash = projectName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length];
};

const getProjectCount = (dayTasks) => {
  const projects = new Set();
  for (const t of dayTasks) projects.add(t.project || 'No Project');
  return projects.size;
};

const getPriorityColor = (priority, theme) => {
  switch (priority) {
    case 'high':   return theme.colors.accentError   || '#FF4444';
    case 'medium': return theme.colors.accentWarning || '#FFAA00';
    case 'low':    return theme.colors.accentSuccess || '#44AA44';
    default:       return theme.colors.textTertiary;
  }
};

// ── Shared task-matching predicates ──────────────────────────
//
// Used by both the calendar heat-cell builder AND the task list for
// the selected date. Centralising here keeps the two views in lock-step
// — a task that lights up a cell in the calendar grid is the same task
// that shows in the list when you tap that cell.

// `taskPassesFilters` (owner + project + tags(+mode) + optional search) now
// lives in utils/taskHelpers as the single source of truth shared with the
// project tree and the Upcoming agenda — imported above.

// Does a task belong on `dateStr`? `dueDateOnly` is retained as a parameter
// (still passed `true` everywhere now that the Due/Open toggle is gone), but
// kept so the predicate stays self-documenting:
//
//   • dueDateOnly=true  — scheduled work: a task belongs to a day iff its
//     dueDate IS that day. Tasks with no due date never appear here. This is
//     the only mode the calendar uses now — the day grid shows the day's work
//     and the cross-day Pending strip carries the undated/untimed backlog.
//   • dueDateOnly=false — the date-agnostic backlog: every incomplete task,
//     full stop (`dateStr` ignored). No longer reached from the calendar, but
//     left intact for any future caller.
// `hideCompletedOccurrences` — the global "incomplete only" filter. It cannot be
// applied task-wide for a RECURRING task, because completion is per-occurrence
// (meta.completedDates): ticking Monday must hide Monday and leave Tuesday
// alone. So the filter has to be evaluated here, per day, rather than in the
// date-agnostic filteredTasks list.
// Exported for unit tests: the per-day occurrence rules are where the
// "incomplete only" filter has to be enforced for recurring tasks, and that is
// worth pinning without mounting this 3,500-line screen.
export const taskOccursOn = (task, dateStr, dueDateOnly, hideCompletedOccurrences = false) => {
  // Birthdays recur every year (unless their yearly flag was turned off): a
  // birthday belongs to ANY date whose month+day matches its stored date, so
  // it lights up the calendar on the same day every year. This is mode-agnostic
  // — a yearly occasion is a deadline regardless of the Due/Open toggle.
  const kind = itemTypeOf(task);
  if (kind === 'birthday' && task.dueDate) {
    if (task.meta && task.meta.yearly === false) return task.dueDate === dateStr;
    return task.dueDate.slice(5) === dateStr.slice(5);
  }
  // Events are single-date calendar items — anchored to their date in BOTH the
  // Due and Open lists (never floated into the date-agnostic backlog).
  if (kind === 'event') {
    return task.dueDate ? task.dueDate === dateStr : false;
  }
  if (dueDateOnly) {
    if (!task.dueDate) return false;
    // A ticked recurring occurrence stays visible (and renders checked) on its
    // own day even though dueDate advanced past it — completion is additive
    // (meta.completedDates), not destructive. Mirrors web's taskOccursOnDate.
    // Under "incomplete only" that day is exactly what should disappear, while
    // the series' other days keep matching below.
    if (isOccurrenceCompleted(task, dateStr)) return !hideCompletedOccurrences;
    // Real base instance — the task's own scheduled day.
    if (task.dueDate === dateStr) return true;
    // Virtual recurring occurrence: a repeating task ALSO belongs on every
    // future period boundary, so the calendar fans it out across its upcoming
    // occurrence dates. Without this, a repeating task only ever showed on its
    // single stored dueDate — so completing one occurrence (which advances the
    // base dueDate a period forward) made it vanish from the calendar instead
    // of simply moving to the next occurrence. Mirrors web's taskOccursOnDate.
    // Completed tasks stop fanning out (the advanced dueDate is the new anchor).
    const rec = task.recurring || task.recurrence || 'none';
    if (rec === 'none' || task.completed) return false;
    return matchesRecurrence(task.dueDate, rec, dateStr);
  }
  return !task.completed;
};

// Shared tasks array for empty day cells — one instance instead of 42 fresh
// arrays per month page. FROZEN so any future code that mutates a day's tasks
// in place throws immediately (Hermes runs strict) instead of silently
// spreading the mutation across every empty cell of every month.
const EMPTY_DAY_TASKS = Object.freeze([]);

// ── Single-pass month-cell builder ───────────────────────────
//
// Builds one month's 42 grid cells from a PRE-FILTERED task list by expanding
// each task onto the days it occupies — the exact days taskOccursOn(dueDateOnly
// =true) would match, but computed from the TASK side. That turns a month build
// from O(days × tasks) (the old per-cell `tasks.filter(taskOccursOn)`) into
// O(tasks + recurring × days): dated tasks, ticked occurrences and birthdays
// are O(1) date-key pushes; only RECURRING tasks still walk the month's days
// (through the same matchesRecurrence oracle, so semantics can't drift).
// Cell task-order matches the old filter exactly: tasks are pushed in list
// order, so each day's array is the original order.
/**
 * The figures that share the board's line under the panel header: the SHAPE of
 * the day the list is showing, as an array of already-worded facts.
 *
 * Deliberately NOT the timed count or the hours (the strip under the week row
 * says "3 timed · 3h") and not the backlog (the Pending section carries its own
 * count) — a subtitle that repeats what is already two rows below it is noise
 * dressed as detail. What it says is the one thing the panel says nowhere else:
 * the day's TOTAL, which includes its untimed tasks, and how much of it is
 * behind you.
 *
 * `total` is every task on the day, `open` the ones still to do.
 */
export const dayFacts = (total, open) => {
  const all = Math.max(0, Number(total) || 0);
  const left = Math.min(all, Math.max(0, Number(open) || 0));
  const done = all - left;
  // An empty day SAYS so, rather than "0 tasks · 0 done" — a row of zeroes
  // reads as a broken count, not as a clear day.
  if (all === 0) return ['nothing planned'];
  const facts = [`${all} ${all === 1 ? 'task' : 'tasks'}`];
  // "all done" rather than "5 done" once there is nothing left: at that point
  // the fact worth reading is that the day is finished, not the arithmetic.
  if (done > 0) facts.push(left === 0 ? 'all done' : `${done} done`);
  return facts;
};

export const buildMonthCells = (filteredTasks, targetDate, hideCompletedOccurrences = false) => {
  const year = targetDate.getFullYear();
  const month = targetDate.getMonth();
  const keyPrefix = `${year}-${month}`;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDayOfWeek = new Date(year, month, 1).getDay();
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`; // YYYY-MM-

  const byDay = new Array(daysInMonth + 1).fill(null); // 1-indexed, lazily filled

  for (const task of filteredTasks) {
    const seen = new Set(); // day numbers this task already occupies (dedupe)
    const pushDateStr = (dateStr) => {
      if (typeof dateStr !== 'string' || !dateStr.startsWith(prefix)) return;
      // "Incomplete only": drop the DAYS this task was ticked on, not the task.
      // Guarding here covers all three ways a day gets pushed below (the stored
      // dueDate, the completedDates replay, and the recurrence expansion), and
      // keeps this builder in step with taskOccursOn.
      if (hideCompletedOccurrences && isOccurrenceCompleted(task, dateStr)) return;
      const day = Number(dateStr.slice(8, 10));
      if (!Number.isInteger(day) || day < 1 || day > daysInMonth || seen.has(day)) return;
      seen.add(day);
      (byDay[day] || (byDay[day] = [])).push(task);
    };

    const kind = itemTypeOf(task);
    if (kind === 'birthday') {
      if (!task.dueDate) continue;
      if (task.meta && task.meta.yearly === false) { pushDateStr(task.dueDate); continue; }
      // Yearly: occupies the month+day match in ANY year → at most one day here.
      if (task.dueDate.length >= 10 && Number(task.dueDate.slice(5, 7)) === month + 1) {
        pushDateStr(prefix + task.dueDate.slice(8, 10));
      }
      continue;
    }
    if (kind === 'event') { if (task.dueDate) pushDateStr(task.dueDate); continue; }

    // Ordinary tasks: undated ones never occupy a calendar day (they live in
    // the Pending strip) — mirrors taskOccursOn's early `!task.dueDate` bail.
    if (!task.dueDate) continue;
    const cd = task.meta && task.meta.completedDates;
    if (Array.isArray(cd)) for (const ds of cd) pushDateStr(ds);
    pushDateStr(task.dueDate);
    const rec = task.recurring || task.recurrence || 'none';
    if (rec !== 'none' && !task.completed) {
      // Arithmetic recurrence expansion — computes this month's occurrence
      // days directly instead of asking matchesRecurrence about all ~31 days
      // (each such call re-parses two dates). Mirrors matchesRecurrence
      // EXACTLY: same parseLocalYMD parse (incl. overflow normalization), the
      // same "strictly after the base date" rule, and the same day-difference
      // arithmetic (calendar-day diffs are additive, so diff(day N) =
      // diff(day 1) + N - 1; the old Math.round absorbed DST the same way).
      // Equivalence is pinned by the randomized property test in scripts.
      const baseDt = parseLocalYMD(task.dueDate);
      if (baseDt) {
        const pushDay = (day) => {
          if (day < 1 || day > daysInMonth || seen.has(day)) return;
          seen.add(day);
          (byDay[day] || (byDay[day] = [])).push(task);
        };
        // Day-difference between this month's 1st and the base date.
        const diff1 = Math.round((new Date(year, month, 1).getTime() - baseDt.getTime()) / MS_PER_DAY);
        if (rec === 'daily') {
          // Every day strictly after the base: diff(day) = diff1 + day - 1 ≥ 1.
          for (let day = Math.max(1, 2 - diff1); day <= daysInMonth; day++) pushDay(day);
        } else if (rec === 'weekly' || rec === 'biweekly') {
          const step = rec === 'weekly' ? 7 : 14;
          // First day of this month on the recurrence lattice (diff ≡ 0 mod step)…
          let day = ((1 - diff1) % step + step) % step;
          if (day === 0) day = step;
          // …then jump forward onto strictly-positive diffs (base in/after month).
          const diffAt = diff1 + day - 1;
          if (diffAt <= 0) day += Math.ceil((1 - diffAt) / step) * step;
          for (; day <= daysInMonth; day += step) pushDay(day);
        } else if (rec === 'monthly') {
          // Same (normalized) day-of-month, any strictly later date.
          const bd = baseDt.getDate();
          if (bd <= daysInMonth && new Date(year, month, bd).getTime() > baseDt.getTime()) {
            pushDay(bd);
          }
        }
        // Unknown recurrence values fan out nowhere — matchesRecurrence's
        // default case returns false for them too.
      }
    }
  }

  // Assemble the padded 42-cell page (leading/trailing empties) exactly as the
  // old builder did, so every FlatList page keeps the same fixed height.
  const days = new Array(CELLS_PER_MONTH);
  let idx = 0;
  for (let i = 0; i < startDayOfWeek; i++) {
    days[idx++] = { type: 'empty', key: `${keyPrefix}-lead-${i}` };
  }
  for (let day = 1; day <= daysInMonth; day++) {
    days[idx++] = {
      type: 'day',
      day,
      date: new Date(year, month, day),
      dateStr: prefix + String(day).padStart(2, '0'),
      tasks: byDay[day] || EMPTY_DAY_TASKS,
      key: `${keyPrefix}-day-${day}`,
    };
  }
  while (idx < CELLS_PER_MONTH) {
    days[idx] = { type: 'empty', key: `${keyPrefix}-trail-${idx}` };
    idx++;
  }
  return days;
};

// ── Per-owner badge (shared calendar) ────────────────────────
// Each pond member's tasks get a stable colour + initial so you can tell at a
// glance whose task a chip is. Colour is derived by hashing the userId so the
// same person always reads as the same swatch, with no server-assigned palette.
const ownerColor = (userId) => {
  if (!userId) return '#888888';
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) % 360;
  return `hsl(${h}, 60%, 52%)`;
};
const ownerInitial = (name) => {
  const s = (name || '').trim();
  return s ? s[0].toUpperCase() : '?';
};

// ── One day pane (a single page of the horizontal day pager) ──────────
//
// Renders ONE calendar day's planner: the add-task / search controls, the
// pending/all-day strip, and the 24-hour timetable grid. Three of these
// live in the day FlatList at once (prev / current / next), so a swipe
// reveals the neighbouring days already laid out — the native paged
// FlatList then snaps between them exactly like the iOS Calendar day view
// (finger-tracked drag, momentum snap, no blank gap, no mid-flight swap).
//
// Build de-duplicated title suggestions for the "re-add a previous task"
// flow. Matches existing tasks whose title contains the typed query
// (case-insensitive). Collapses duplicate titles to a single representative
// — the richest one (most subtasks), tiebroken by most-recent — so re-adding
// copies the best template. Prefix matches sort first. Returns ≤ `limit` rows.
const buildTitleSuggestions = (tasks, query, limit = 6) => {
  const q = (query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const byTitle = new Map();
  for (const t of tasks || []) {
    const title = (t.title || '').trim();
    if (!title || !title.toLowerCase().includes(q)) continue;
    const key = title.toLowerCase();
    const sub = Array.isArray(t.subtasks) ? t.subtasks.length : 0;
    const rec = Math.max(t.completedAt || 0, t.createdAt || 0);
    const prev = byTitle.get(key);
    if (!prev || sub > prev._sub || (sub === prev._sub && rec > prev._rec)) {
      byTitle.set(key, { ...t, _sub: sub, _rec: rec });
    }
  }
  return Array.from(byTitle.values())
    .sort((a, b) => {
      const ap = a.title.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.title.toLowerCase().startsWith(q) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      if (b._sub !== a._sub) return b._sub - a._sub;
      return b._rec - a._rec;
    })
    .slice(0, limit);
};

// Copy a task's subtasks for a fresh re-add: reset completion + assign new
// ids so the new instance is fully independent of the original.
const resetSubtasksForReuse = (subtasks) =>
  (Array.isArray(subtasks) ? subtasks : []).map((st, i) => ({
    ...st,
    id: `${Date.now()}-${i}-${Math.floor(Math.random() * 1e6)}`,
    completed: false,
    completedAt: null,
    completedTime: null,
  }));

// Props that only drive the ACTIVE pane's live inputs (add-task / search).
// When a keystroke updates these, the two INACTIVE neighbour panes bail out of
// re-rendering entirely (see dayPaneEqual) — typing used to re-render all
// three mounted panes per keystroke.
const DAYPANE_ACTIVE_ONLY_PROPS = new Set([
  'isAddingTask', 'newTaskTitle', 'onSubmitAddTask', 'onCancelAdd',
  'pendingTime', 'onClearPendingTime', 'onEditPendingTime', 'onPickSuggestion',
  'isSearching', 'searchQuery', 'searchResults', 'onOpenSearchResult',
]);

// Custom React.memo comparator for DayPane. Shallow-equal, EXCEPT:
//  • active-only props are ignored while the pane is (and stays) inactive;
//  • nowMinutes (the once-a-minute clock tick) is ignored unless this pane IS
//    today — only today's pane draws the now-line, so the other mounted panes
//    skip the every-minute re-render.
function dayPaneEqual(prev, next) {
  for (const k in next) {
    if (Object.is(prev[k], next[k])) continue;
    if (!prev.isActive && !next.isActive && DAYPANE_ACTIVE_ONLY_PROPS.has(k)) continue;
    if (k === 'nowMinutes' && toDateString(next.date) !== next.todayStr) continue;
    return false;
  }
  return true;
}

// Interactive controls (add-task input, search box + results) only wire
// up on the ACTIVE pane (date === selectedDate); neighbours show inert
// placeholders so we never mount duplicate auto-focused TextInputs while
// paging. The strip + grid content is computed per-pane from its own date.
const DayPane = React.memo(function DayPane({
  date,
  isActive,
  // Full (unfiltered) task list — used ONLY by the re-add title suggestions.
  tasks,
  // (dateStr) => that day's filtered+sorted tasks, cached in the parent so a
  // pane re-render is a Map hit instead of a full re-filter of every task.
  getDayTasks,
  // toDateString(new Date()) computed once per parent render — keeps the pane
  // from re-deriving "today" (and lets dayPaneEqual gate the minute tick).
  todayStr,
  multiUser,
  theme,
  styles,
  use24h,
  nowMinutes,
  pendingTasks,
  untimedCollapsed,
  onToggleUntimedCollapsed,
  scheduleCollapsed,
  onToggleScheduleCollapsed,
  onTaskPress,
  onTaskInspect,
  onTaskLongPress,
  onToggleComplete,
  // (task) — start a focus timer for a row, from the circle key beside it.
  onStartPomodoro,
  // (task) — a LIVE key was pressed: open the running timer rather
  // than starting a second block on the same task.
  onOpenPomodoro,
  onUpdateTask, // used to pull an OPEN/pending task onto the viewed day
  // (task, dayStr) — tapping a row's time column opens the wheel picker on
  // that task, for the day this pane is showing.
  onEditTaskTime,
  // (userId, fallbackName) => { id, name, color, avatarUrl, … } | null. One
  // place that knows what a person looks like, for the owner and for everyone
  // else involved in a task.
  memberOf,
  // (people, task, anchor) — a card's avatar stack was tapped. The SCREEN owns
  // the list it opens: a popover mounted in here would be clipped by the pane,
  // the pager and the sheet in turn.
  onPeoplePress,
  // (taskId) => { count, endsAt } | null — focus spent on a task, and a block
  // running on it right now.
  pomodoroFor,
  // Owner-badge tap (shared calendar). Was referenced but never declared as a
  // prop — pressing a badge threw "ReferenceError: onOwnerPress is not defined".
  onOwnerPress,
  onOpenAddTaskAt,
  // Add-task (active pane only)
  isAddingTask,
  newTaskTitle,
  onChangeNewTaskTitle,
  onSubmitAddTask,
  onCancelAdd,
  pendingTime,
  onClearPendingTime,
  onEditPendingTime,
  onOpenAddTask,
  onPickSuggestion,
  onOpenFullCreate,
  // Search (active pane only)
  isSearching,
  searchQuery,
  onChangeSearchQuery,
  onOpenSearch,
  onCloseSearch,
  searchResults,
  onOpenSearchResult,
  // Refresh + layout
  refreshing,
  onRefresh,
  keyboardHeight,
}) {
  const scrollRef = useRef(null);
  const dayStr = toDateString(date);
  const isViewingToday = dayStr === todayStr;

  // ── The mode IS the gaps' default ──────────────────────────────────────
  //
  // There is ONE schedule. "Timeline" is not a second layout — it is this list
  // with every gap open, and "Compact" is the same list with them shut. So
  // `scheduleCollapsed` sets the DEFAULT each gap takes, and this map holds the
  // per-gap departures from it: one stretch opened on an otherwise compact day,
  // one hour-by-hour run closed inside an otherwise exploded one. Keyed by the
  // stretch a gap spans (gapKey), so retiming a task collapses the gap that no
  // longer exists rather than transferring the state to whatever row took its
  // index — and a gap that appears later (a task moved, a new one added) takes
  // the mode's default rather than inheriting a stale entry.
  //
  // Per-pane: paging to another day starts from the mode's default.
  const [gapOverrides, setGapOverrides] = useState(() => new Map());
  const gapIsOpen = useCallback(
    (key) => (gapOverrides.has(key) ? gapOverrides.get(key) : !scheduleCollapsed),
    [gapOverrides, scheduleCollapsed],
  );
  const toggleGap = useCallback((key, open) => {
    tapHaptic();
    setGapOverrides((prev) => {
      const next = new Map(prev);
      next.set(key, !open);
      return next;
    });
  }, []);

  // Switching modes RE-STATES every gap: the exploded timeline must not come up
  // with a hole in it where a gap was left shut, and the compact list must not
  // come back still carrying one open. Cleared during render rather than in an
  // effect, so the commit that changes the mode is also the one that moves the
  // gaps — an effect would show one frame of the old set first.
  const [prevMode, setPrevMode] = useState(scheduleCollapsed);
  if (prevMode !== scheduleCollapsed) {
    setPrevMode(scheduleCollapsed);
    setGapOverrides((prev) => (prev.size ? new Map() : prev));
  }

  // The inset dark card the Tasks tab uses (utils/cardPalette). The schedule's
  // cards are the same object as that list's, so they read from the same
  // palette rather than a second copy of the same intent.
  const inset = useMemo(() => insetCardPalette(theme), [theme]);

  // Stable per-pane binding of the time-column tap, so the memoised
  // ScheduleCards don't take a fresh callback on every pane render.
  const handleEditTime = useCallback((task) => onEditTaskTime?.(task, dayStr), [onEditTaskTime, dayStr]);
  const onTimePress = onEditTaskTime ? handleEditTime : undefined;

  // Title suggestions for the re-add flow — only on the active pane while the
  // add-task input is open and the user has typed ≥2 chars.
  const titleSuggestions = useMemo(
    () => (isActive && isAddingTask ? buildTitleSuggestions(tasks, newTaskTitle) : []),
    [isActive, isAddingTask, tasks, newTaskTitle]
  );

  // This day's tasks — the parent's per-date cache (same predicates the month
  // cells + header count use, so every surface stays in lock-step).
  const dayTasks = getDayTasks(dayStr);

  // Split this day's items into calendar occasions (events + birthdays), timed
  // tasks (those with a HH:MM start) and untimed tasks (dated for THIS day but
  // with no time yet). The untimed bucket is this day's "TBD" list — tasks that
  // belong to the day but haven't been slotted into an hour, shown below so they
  // appear in the day's to-do list instead of being lost. (The cross-day Pending
  // strip is now only the truly undated backlog — see pendingTasks.)
  const { occasions, timedTasks, untimedTasks } = useMemo(() => {
    const occ = [];
    const timed = [];
    const untimed = [];
    for (const task of dayTasks) {
      if (itemTypeOf(task) !== 'task') { occ.push(task); continue; }
      if (task.time && /^\d{1,2}:\d{2}/.test(task.time)) timed.push(task);
      else untimed.push(task);
    }
    return { occasions: occ, timedTasks: timed, untimedTasks: untimed };
  }, [dayTasks]);

  // Schedule model: each timed task as a {start,end,duration} segment (sorted
  // by start) plus the gap (minutes of empty time) to the NEXT task, so the
  // schedule can stack the tasks and label the stretches between them. Also
  // the day's total tracked minutes for the header count.
  const { segments, totalTimedMin } = useMemo(() => {
    const segs = timedTasks
      .map(task => {
        const start = parseHM(task.time);
        const duration = Number(task.duration) > 0 ? Number(task.duration) : DEFAULT_TASK_DURATION_MIN;
        return { task, start, end: start + duration, duration };
      })
      .sort((a, b) => a.start - b.start);
    let total = 0;
    segs.forEach((s, i) => {
      total += s.duration;
      const next = segs[i + 1];
      s.gapAfter = next ? Math.max(0, next.start - s.end) : null;
    });
    return { segments: segs, totalTimedMin: total };
  }, [timedTasks]);

  // The day as rows: the tasks, and the stretches of empty time between and
  // around them. An empty day is ONE row — a single 24 h gap — rather than
  // nothing at all, so a day with no plan on it is still the same timeline,
  // openable hour by hour like any other stretch.
  const scheduleRows = useMemo(() => buildCompactRows(segments), [segments]);

  // The cross-day Pending backlog. Carry-overs are computed against TODAY, so
  // on a PAST pane that day's own leftovers would appear twice — once in its
  // grid/TBD list, once in the strip. Drop this pane's own date here.
  const stripTasks = useMemo(
    () => pendingTasks.filter((t) => !t.dueDate || t.dueDate.slice(0, 10) !== dayStr),
    [pendingTasks, dayStr],
  );

  // No auto-scroll to "working hours" any more. That existed because the
  // expanded view was a fixed 24 × HOUR_HEIGHT grid whose midnight-to-8am was
  // dead space you had to be scrolled past — a y for any minute was a division.
  // The unified schedule has no such mapping (a task is a card of its own
  // height, wherever it sits in the day) and no dead space to skip: the tasks
  // are at the top, one line per empty stretch between them. There is nothing
  // left to scroll past, so the pane opens where the day does.

  /**
   * Everyone on a task, owner first: the badges a card carries.
   *
   * The OWNER only counts on a shared pond — a solo pond's every task is
   * yours, and a badge saying so on each row is noise. Anyone INVOLVED counts
   * always: they are there because someone put them there, which is exactly
   * the thing worth showing, and a task with involved people is multi-person
   * whatever the pond is. So the owner joins the line whenever the line would
   * exist at all, because "who else" is only meaningful next to "whose".
   *
   * De-duplicated: the owner is routinely in their own involvedUsers, and two
   * of the same face in a stack reads as a bug.
   */
  const rosterFor = useCallback((task) => {
    if (!memberOf || !task) return [];
    const involved = Array.isArray(task.involvedUsers) ? task.involvedUsers.filter(Boolean) : [];
    if (!involved.length && !multiUser) return [];
    const ids = [];
    for (const id of [task.userId, ...involved]) {
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids
      .map((id) => memberOf(id, id === task.userId ? task.ownerName : null))
      .filter(Boolean);
  }, [memberOf, multiUser]);

  // ── The compact list is built NESTED, not mapped flat ──────────────────
  // Everything after a gap row is rendered as that gap's CHILDREN, so the one
  // transform that opens the gap carries the whole tail of the list down with
  // it (see CompactGap). A `.map` cannot nest its own tail, hence the walk.
  const renderCompactRow = (row) => {
    const { seg } = row;
    const task = seg.task;
    const done = task.completed || isOccurrenceCompleted(task, dayStr);
    // The SAME card as the Pending and To-Do rows below it — ScheduleCard, a
    // soft wash of the board's colour with its keys beside it.
    //
    // It used to be the Tasks tab's inset CHARCOAL panel with the completion
    // ring overlaid inside its right edge, which made the one list read as two:
    // dark slabs on top, pale planner cards underneath, for rows that differ
    // only in whether a time is set. The board colour that ran down the left
    // edge is not lost — it IS the card's wash now, which is a louder signal
    // than a 3 pt rule was.
    //
    // NOW passes THROUGH the card when the clock is inside the task's own
    // stretch — the timeline's red line, cut to a stub on the card's left edge
    // (see ScheduleCard's `nowMark`). Placed by how far through the task the
    // minute is, not by an absolute y: a card is a fixed height whatever its
    // duration, so a proportion is the only reading of "where in this task we
    // are" that means anything. A zero-length segment has no inside to be in.
    const span = seg.end - seg.start;
    const nowAt = (isViewingToday && span > 0 && nowMinutes >= seg.start && nowMinutes < seg.end)
      ? (nowMinutes - seg.start) / span
      : null;
    return (
      <ScheduleCard
        key={task.id}
        nowAt={nowAt}
        task={task}
        theme={theme}
        timeLabel={clockLabel(seg.start, use24h, { pad: false })}
        range={`${clockLabel(seg.start, use24h, { pad: false })} – ${clockLabel(seg.end, use24h, { pad: false })}`}
        color={getProjectColor(task.project)}
        done={done}
        // A plain tap edits, a long press inspects — the order this list has
        // always used; the inspector is still the fastest read of a task.
        onPress={onTaskLongPress || onTaskPress}
        onLongPress={onTaskInspect || onTaskPress}
        // (id, dayStr) — what the handler actually takes. The ring this
        // replaced handed it the whole TASK, so `tasks.find(t => t.id === task)`
        // matched nothing and ticking a timed card quietly did nothing at all.
        onToggle={(it) => onToggleComplete?.(it.id, dayStr)}
        onStartPomodoro={onStartPomodoro}
        onOpenPomodoro={onOpenPomodoro}
        people={rosterFor(task)}
        onPeoplePress={onPeoplePress}
        pomodoro={pomodoroFor?.(task.id)}
        onTimePress={onTimePress}
        testID={`schedule-card-${task.id}`}
      />
    );
  };

  const renderCompactRows = (rows, from = 0) => {
    const out = [];
    for (let i = from; i < rows.length; i++) {
      const row = rows[i];
      // A gap is ONE row saying how long it is, until it is opened into the
      // hours it stands for. That is the only difference between the two modes:
      // "Timeline" opens every one of them at once, which is what makes the
      // exploded view this same list rather than a second one.
      if (row.kind === 'gap') {
        const key = gapKey(row);
        const open = gapIsOpen(key);
        // The tail of the list goes INSIDE the gap, so the walk ends here.
        out.push(
          <CompactGap
            key={key}
            row={row}
            open={open}
            onToggle={() => toggleGap(key, open)}
            onPickHour={(minute) => onOpenAddTaskAt?.(minutesToTimeString(minute))}
            styles={styles}
            theme={theme}
            use24h={use24h}
            nowMinutes={nowMinutes}
            showNow={isViewingToday}
          >
            {renderCompactRows(rows, i + 1)}
          </CompactGap>
        );
        return out;
      }
      out.push(renderCompactRow(row));
    }
    return out;
  };

  return (
    <View style={styles.dayPage}>
      <ScrollView
        ref={scrollRef}
        style={styles.taskList}
        contentContainerStyle={{ paddingBottom: Math.max(100, keyboardHeight + 20) }}
        // Let taps on the suggestion rows register on the FIRST tap while the
        // keyboard is up (default would just dismiss the keyboard instead).
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing || false}
            onRefresh={onRefresh}
            tintColor={theme.colors.accentSuccess}
            colors={[theme.colors.accentSuccess]}
          />
        }
      >
        {/* The finder is NOT here any more. It was a field at the top of this
            scroll view with its results underneath, which meant the answer list
            competed for room with the day's own schedule, the week strip and
            the sheet header — a handful of rows once the keyboard was up. It is
            a full-screen panel now (TaskFinderOverlay), mounted at the
            calendar's root so it gets the whole screen. */}

        {/* Events & Birthdays for this day — always-visible strip with the
            occasion colour + icon. Tap to open/edit, just like a task. */}
        {occasions.length > 0 && (
          <View style={styles.occasionSection}>
            <Text style={styles.occasionLabel}>Events & Birthdays</Text>
            {occasions.map((item) => {
              const color = itemColorOf(item) || theme.colors.accentInfo;
              const kind = itemTypeOf(item);
              const guestCount = Array.isArray(item.meta?.guests) ? item.meta.guests.length : 0;
              const sub = kind === 'birthday'
                ? 'Birthday'
                : (item.time ? formatTimeLabel(item.time, use24h) : 'All day');
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.occasionItem, { borderLeftColor: color }]}
                  onPress={() => onTaskPress?.(item)}
                  onLongPress={() => onTaskLongPress?.(item)}
                  activeOpacity={0.7}
                >
                  <Icon name={itemIconOf(item)} size={18} color={color} style={styles.occasionIcon} />
                  <View style={styles.occasionTextWrap}>
                    <Text style={styles.occasionTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.occasionMeta} numberOfLines={1}>
                      {sub}{guestCount > 0 ? ` · ${guestCount} guest${guestCount > 1 ? 's' : ''}` : ''}
                    </Text>
                  </View>
                  {multiUser && item.userId && (
                    <TouchableOpacity
                      style={[styles.ownerBadge, { backgroundColor: ownerColor(item.userId) }]}
                      onPress={() => onOwnerPress?.(item)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Owner: ${item.ownerName || 'Unknown'}. Open profile`}
                    >
                      <Text style={styles.ownerBadgeText}>{ownerInitial(item.ownerName)}</Text>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Schedule toolbar — count + total tracked time on the left, and the
            control that explodes the timeline: it opens every gap at once, or
            shuts them all again. */}
        <View style={styles.scheduleToolbar}>
          <Text style={styles.scheduleToolbarTitle}>
            {timedTasks.length} timed{totalTimedMin > 0 ? ` · ${fmtDur(totalTimedMin)}` : ''}
          </Text>
          <TouchableOpacity
            style={styles.scheduleToggleBtn}
            onPress={onToggleScheduleCollapsed}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={scheduleCollapsed ? 'Open every gap, hour by hour' : 'Close every gap back to a compact list'}
          >
            <Icon
              name={scheduleCollapsed ? 'arrow-expand-vertical' : 'arrow-collapse-vertical'}
              size={15}
              color={theme.colors.textSecondary}
            />
            <Text style={styles.scheduleToggleLabel}>{scheduleCollapsed ? 'Timeline' : 'Compact'}</Text>
          </TouchableOpacity>
        </View>

        {/* ── ONE timeline, in two states ──────────────────────────────────
            There is no compact view and no grid view any more; there is the
            schedule, and how far open it is. A gap between two tasks is a line
            saying "6h30m" until you open it into six and a half hours of
            slots — and "Timeline" is that same gesture applied to every gap at
            once. So the exploded view IS the collapsed one, exploded.

            Everything follows from that. The animation is not a cross-fade
            between two layouts (which is what it used to be, and why the cards
            appeared to be replaced rather than moved) — it is the per-gap
            transform the tap on a single "6h30m" already ran, all of them
            firing together: the hours slide down out from under the task above
            while everything below rides the same translate. Nothing is
            measured, no card is unmounted, and a task card is the SAME card at
            the same width in both states, because there is only one of it.

            The hour grid this replaced could not do that. It drew a task as a
            block whose HEIGHT was its duration, so a 20-minute task was a 16 pt
            sliver with a clipped title, and the switch had to swap one kind of
            card for another. Here duration is what the card SAYS, not how tall
            it is — which is also what makes the now-line's treatment on a card
            a proportion rather than a y. */}
        <View style={styles.scheduleBody}>
          {/* The "how do I put something here" answer, while the day has
              nothing timed on it. Once there is a card the affordance has
              explained itself. It reads the same in both states now: an empty
              day is a single 24 h gap, so the hour you tap is either on screen
              already or one tap away. */}
          {timedTasks.length === 0 && (
            <Text style={styles.timelineEmpty}>
              No timed tasks yet. Tap + above, or open the day below and tap an hour.
            </Text>
          )}
          <View style={styles.compactList}>
            {/* The gutter rule — one continuous hairline behind the whole
                schedule, with every time in the day right-aligned into it:
                the cards' own time column and the hour labels inside an open
                gap are the same column, so opening one adds lines to a gutter
                that never moves. */}
            <View pointerEvents="none" style={styles.hourRule} />

            {renderCompactRows(scheduleRows)}
          </View>
        </View>

        {/* To Do — this day's tasks with no time set yet. Dated for this day but
            unscheduled, shown BELOW the schedule; tap to inspect / add a time. */}
        {untimedTasks.length > 0 && (
          <View style={styles.untimedSection}>
            {/* marginBottom matches the scheduled compact list's header→first-
                card gap (toolbar paddingBottom 6 + list paddingTop 4) so the
                To-Do cards sit off the title, not flush against it. */}
            <View style={[styles.untimedHeader, { marginBottom: 10 }]}>
              <Text style={styles.untimedLabel}>To Do · No Time Set</Text>
              <Text style={styles.untimedCount}>{untimedTasks.length}</Text>
            </View>
            {/* Same planner row as the schedule, with a quiet "any time" in
                the time column so the cards keep one straight left edge.
                Tapping it is how a To-Do gets an hour: the wheel opens on the
                task and the pick lands on the day this pane is showing. */}
            <TaskSectionFrontier
              items={untimedTasks}
              sectionLabel="To-Do"
              theme={theme}
              renderItem={(task) => {
                const done = task.completed || isOccurrenceCompleted(task, dayStr);
                return (
                  <ScheduleCard
                    key={task.id}
                    task={task}
                    theme={theme}
                    timeLabel="any time"
                    range=""
                    color={task.project ? getProjectColor(task.project) : null}
                    done={done}
                    onPress={onTaskInspect || onTaskPress}
                    onLongPress={onTaskLongPress}
                    onToggle={(it) => onToggleComplete?.(it.id, dayStr)}
                    people={rosterFor(task)}
                    onPeoplePress={onPeoplePress}
                    pomodoro={pomodoroFor?.(task.id)}
                    onOpenPomodoro={onOpenPomodoro}
                    onTimePress={onTimePress}
                    testID={`todo-card-${task.id}`}
                  />
                );
              }}
            />
          </View>
        )}

        {/* Pending / All-Day strip — shown BELOW the day's schedule so the timed
            plan reads first and the backlog sits underneath it. */}
        {stripTasks.length > 0 && (
          <View style={styles.untimedSection}>
            {/* marginBottom matches the scheduled/To-Do header→first-card gap now
                that Pending renders as the same large cards. */}
            <TouchableOpacity
              style={[styles.untimedHeader, { marginBottom: 10 }]}
              onPress={onToggleUntimedCollapsed}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Pending tasks, ${stripTasks.length}, ${untimedCollapsed ? 'collapsed' : 'expanded'}`}
            >
              <Text style={styles.untimedLabel}>Pending Tasks</Text>
              <Text style={styles.untimedCount}>{stripTasks.length}</Text>
              <Icon
                name={untimedCollapsed ? 'chevron-down' : 'chevron-up'}
                size={18}
                color={theme.colors.textTertiary}
              />
            </TouchableOpacity>
            {/* Planner rows again; the time column carries the due date (or
                "no date") and the trailing key stamps the viewed day onto the
                task — moving it into this day's To-Do. */}
            {!untimedCollapsed && (
              <TaskSectionFrontier
                items={stripTasks}
                sectionLabel="Pending"
                theme={theme}
                // This section MOUNTS on a tap, so its first frame is the whole
                // felt cost of opening it: paint a screenful now, stream the
                // backlog in on idle frames after.
                initialBatch={DAY_SECTION_FIRST_PAINT}
                autoGrow
                renderItem={(task) => {
                  const done = task.completed || isOccurrenceCompleted(task, dayStr);
                  return (
                    <ScheduleCard
                      key={task.id}
                      task={task}
                      theme={theme}
                      timeLabel={task.dueDate ? task.dueDate.slice(5).replace('-', '/') : 'no date'}
                      range=""
                      color={task.project ? getProjectColor(task.project) : null}
                      done={done}
                      onPress={onTaskInspect || onTaskPress}
                      onLongPress={onTaskLongPress}
                      onToggle={(it) => onToggleComplete?.(it.id, dayStr)}
                      people={rosterFor(task)}
                      onPeoplePress={onPeoplePress}
                      pomodoro={pomodoroFor?.(task.id)}
                      onOpenPomodoro={onOpenPomodoro}
                      trailing={!done ? (
                        <TouchableOpacity
                          onPressIn={() => tapHaptic()}
                          onPress={() => onUpdateTask?.(task.id, { dueDate: dayStr, time: null })}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          accessibilityRole="button"
                          accessibilityLabel={isViewingToday ? 'Add this task to today' : 'Add this task to the selected day'}
                          style={styles.addTodayBtn}
                        >
                          <Icon name="calendar-arrow-right" size={18} color={theme.colors.primary} />
                        </TouchableOpacity>
                      ) : undefined}
                    />
                  );
                }}
              />
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}, dayPaneEqual);

// Highlight strings (selected / today) only matter to a month page when the
// date falls INSIDE that month — so a selection tap re-renders just the page
// losing the highlight and the page gaining it, not every mounted page (~13
// with the fast-scroll window). Everything else compares shallowly.
function monthPageEqual(prev, next) {
  for (const k in next) {
    if (Object.is(prev[k], next[k])) continue;
    if (k === 'selectedStr' || k === 'todayStr') {
      const touches = (v) => typeof v === 'string' && v.startsWith(next.monthPrefix);
      if (!touches(prev[k]) && !touches(next[k])) continue;
    }
    return false;
  }
  return true;
}

// ── Diagonal hatch fill (no SVG) ──────────────────────────────
//
// react-native-svg isn't in this app (adding it forces a native rebuild), so
// the selected-cell hatch is drawn with a handful of very tall, thin Views each
// rotated 45° — parallel diagonal bars. The parent clips them (overflow:hidden
// + borderRadius), so the bars only need to over-span the cell; positions cover
// cells up to ~150px wide and anything past the edge is clipped. Only one or two
// cells are ever selected at once, so the ~20 tiny Views cost nothing.
const HATCH_BARS = [];
for (let x = -60; x <= 150; x += 2) HATCH_BARS.push(x);
const DiagonalHatch = ({ color, lineWidth = StyleSheet.hairlineWidth }) =>
  HATCH_BARS.map((x) => (
    <View
      key={x}
      style={{
        position: 'absolute',
        left: x,
        top: -80,
        width: lineWidth,
        height: 260,
        backgroundColor: color,
        transform: [{ rotate: '45deg' }],
      }}
    />
  ));

// One month page of the vertical calendar FlatList — title band, day-of-week
// labels, and the 42-cell grid. Extracted from renderMonth and memoized with
// monthPageEqual; receives its CELLS prebuilt (cached per month upstream).
//
// Every page paints its OWN month/year title: gating the title to a window
// around currentMonthIndex tied its visibility to scroll state — a fast scroll
// outran it and landed on blank header bands until the snap finished. Painting
// unconditionally means the header is part of the page itself, with no pop-in
// and no dependence on scroll timing. The MONTH_TITLE_HEIGHT band is reserved
// on every page regardless, so snapping stays pixel-perfect.
const MonthPage = React.memo(function MonthPage({
  monthDate,
  monthPrefix, // eslint-disable-line no-unused-vars — read by monthPageEqual
  cells,
  monthH,
  cellH,
  todayStr,
  selectedStr,
  showCalendarDayTasks,
  theme,
  styles,
  onDatePress,
}) {
  // Very faint hairline colour for the in-between grid segments (see the
  // per-cell top/left borders below). Kept low-alpha so it reads as a whisper
  // of a table, not a hard rule.
  const gridLineColor = theme.mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
  return (
    <View style={[styles.monthPage, { height: monthH }]}>
      <View style={styles.monthYear}>
        <View style={styles.monthTitleRow}>
          <Text style={styles.monthText}>{MONTHS[monthDate.getMonth()]}</Text>
          <Text style={styles.yearText}>{monthDate.getFullYear()}</Text>
        </View>
        {/* The inline "Today" shortcut that used to sit here (top-right of each
            month) was removed — the fixed jump-to-today pill in the bottom-right
            of the calendar viewport is the single, always-in-the-same-spot way
            back to today now. */}
      </View>

      {/* Day-of-week labels — sit just under the title band. */}
      <View style={styles.daysHeader}>
        {DAYS.map(day => (
          <View key={day} style={styles.dayHeaderCell}>
            <Text style={styles.dayHeaderText}>{day}</Text>
          </View>
        ))}
      </View>

      <View style={styles.calendarGrid}>
        {cells.map((cell, idx) => {
          // Minimalist internal grid: a hairline on each cell's TOP + LEFT edge,
          // skipped on the first row (idx < 7) and first column (idx % 7 === 0).
          // That paints only the in-between segments — never the outer perimeter
          // — so the grid reads as a faint table, uniform across empty + day cells.
          const gridLine = {
            borderColor: gridLineColor,
            borderTopWidth: idx >= 7 ? StyleSheet.hairlineWidth : 0,
            borderLeftWidth: (idx % 7) !== 0 ? StyleSheet.hairlineWidth : 0,
          };
          if (cell.type === 'empty') {
            return <View key={cell.key} style={[styles.emptyCell, { height: cellH }, gridLine]} />;
          }
          const projectCount = getProjectCount(cell.tasks);
          const heat = getContributionColor(cell.tasks.length);
          // Highlight-only, computed here (cheap string compares) so selecting a
          // day re-paints just that cell — it doesn't rebuild the month data.
          const isToday = cell.dateStr === todayStr;
          const isSelected = cell.dateStr === selectedStr;
          return (
            <Pressable
              key={cell.key}
              // Light tap haptic on touch-DOWN so the cell reacts the instant
              // the finger lands. There is NO grey press wash: selecting goes
              // straight to the solid backdrop (no two-phase grey→colour), and
              // the haptic carries the "it reacted" feedback.
              onPressIn={() => tapHaptic()}
              onPress={() => onDatePress(cell.date)}
              style={[
                styles.dayCell,
                { height: cellH },
                gridLine,
                showCalendarDayTasks && styles.dayCellList,
              ]}
            >
              {/* Selected day = an OPAQUE backdrop with softly rounded corners,
                  applied instantly (no press wash). It's a SEPARATE absolutely-
                  positioned layer — not a background on the cell — so the square
                  hairline grid stays a clean table while the fill reads as a
                  rounded rectangle. ORANGE when it's today, else near-black
                  (light) / white (dark). The bold number sits on top of it. */}
              {/* Selected day — a DENSE, full-colour diagonal HATCH filling the
                  cell (clipped to the rounded rect): ORANGE when the selected day
                  is today, else near-BLACK (light) / white (dark). */}
              {isSelected && (
                <View
                  pointerEvents="none"
                  style={[
                    styles.daySelectedBackdrop,
                    isToday ? styles.daySelectedToday : styles.daySelectedOther,
                  ]}
                >
                  <DiagonalHatch
                    color={isToday ? WEEK_SELECT_BG : (theme.mode === 'dark' ? '#FFFFFF' : '#000000')}
                  />
                </View>
              )}
              {/* Today, when NOT selected — the same orange HATCH so today reads
                  as "selectable today"; the selection just deepens it (base tint)
                  and bolds the number. Hidden once today is tapped. */}
              {isToday && !isSelected && (
                <View pointerEvents="none" style={styles.todayHatchBackdrop}>
                  <DiagonalHatch color={WEEK_SELECT_BG} />
                </View>
              )}
              {/* Day number in a fixed box. The SELECTED day fills the whole
                  cell (orange/blue) with a bold white number; today-when-not-
                  selected keeps its tinted number; others stay neutral. */}
              <View style={[
                styles.dayNumWrap,
                showCalendarDayTasks && styles.dayNumWrapList,
              ]}>
                <Text style={[
                  styles.dayText,
                  showCalendarDayTasks && styles.dayTextList,
                  isToday && !isSelected && styles.todayText,
                  isSelected && (isToday ? styles.todaySelectedText : styles.selectedText),
                  // Days that HAVE activities keep the same neutral colour as
                  // empty days (no heat tint) — they're set apart only by a
                  // normal-weight number: heavier than the hairthin `200` of a
                  // blank day, but lighter than the bold `700` of the selected
                  // day. Skipped when selected/today (those own their weight).
                  !isSelected && !isToday && cell.tasks.length > 0 && styles.dayTextHasTasks,
                ]}>
                  {cell.day}
                </Text>
              </View>

              {showCalendarDayTasks ? (
                // iOS-Calendar-style tiny list: each task on a solid color
                // pill (the item's own color for events/birthdays, else its
                // priority color) with white text so titles read easily
                // against the grid on the phone.
                cell.tasks.length > 0 && (
                  <View style={styles.dayTaskList}>
                    {cell.tasks.slice(0, 3).map((t, idx) => {
                      const c = itemColorOf(t) || getPriorityColor(t.priority, theme);
                      return (
                        <View
                          key={t.id || idx}
                          style={[styles.dayTaskPill, { backgroundColor: c }]}
                        >
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.dayTaskItem,
                              { color: '#fff' },
                              (t.completed || isOccurrenceCompleted(t, cell.dateStr)) && styles.dayTaskItemDone,
                            ]}
                          >
                            {t.title || 'Untitled'}
                          </Text>
                        </View>
                      );
                    })}
                    {cell.tasks.length > 3 && (
                      <Text style={styles.dayTaskMore}>+{cell.tasks.length - 3} more</Text>
                    )}
                  </View>
                )
              ) : (
                projectCount > 0 && (
                  <View style={styles.projectDots}>
                    {Array.from({ length: Math.min(projectCount, 3) }).map((_, idx) => (
                      <View
                        key={idx}
                        style={[styles.projectDot, { backgroundColor: heat }]}
                      />
                    ))}
                    {projectCount > 3 && (
                      <Text style={[styles.moreProjects, { color: heat }]}>+</Text>
                    )}
                  </View>
                )
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}, monthPageEqual);

// One sliding week-strip day cell — memoized so a parent render (keystroke,
// sheet drag, minute tick) doesn't rebuild all ~29 windowed cells, each of
// which used to mint two fresh Animated interpolations per pass. A cell
// re-renders only when its own geometry, selection/today flag, or the centre
// measuring hook changes; the slide itself is the native track translate.
const WeekStripCell = React.memo(function WeekStripCell({
  idx,
  date,
  cellW,
  pillW,
  isActive,
  isToday,
  dayScrollX,
  styles,
  onPress,          // stable goToDate — receives this cell's date
  onPillSlotLayout, // set ONLY on the centre cell (fixed-pill measuring)
}) {
  const abbr = WEEKDAY_ABBR[date.getDay()];
  // On/off-pill cross-fade peaks when THIS cell's day page is centred under
  // the fixed pill: dayScrollX === idx * SCREEN_W.
  const { onPillOpacity, offPillOpacity } = useMemo(() => ({
    onPillOpacity: dayScrollX.interpolate({
      inputRange: [(idx - 1) * SCREEN_W, idx * SCREEN_W, (idx + 1) * SCREEN_W],
      outputRange: [0, 1, 0],
      extrapolate: 'clamp',
    }),
    offPillOpacity: dayScrollX.interpolate({
      inputRange: [(idx - 1) * SCREEN_W, idx * SCREEN_W, (idx + 1) * SCREEN_W],
      outputRange: [1, 0, 1],
      extrapolate: 'clamp',
    }),
  }), [dayScrollX, idx]);
  return (
    <TouchableOpacity
      style={[styles.weekDayCell, { position: 'absolute', left: (idx - DAY_TODAY_INDEX) * cellW, width: cellW }]}
      onPress={() => onPress(date)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
      accessibilityState={{ selected: isActive }}
    >
      <View style={[styles.weekPillSlot, { width: pillW }]} onLayout={onPillSlotLayout}>
        {/* Today (when not selected) = a soft filled pill; fades out as the
            orange pill slides over it. */}
        {isToday && (
          <Animated.View
            pointerEvents="none"
            style={[styles.weekTodayPill, { opacity: offPillOpacity }]}
          />
        )}
        {/* Weekday abbreviation — cross-fades to on-pill ink. */}
        <View style={styles.weekDowRow}>
          <Animated.Text style={[styles.weekDow, { opacity: offPillOpacity }]}>{abbr}</Animated.Text>
          <Animated.Text style={[styles.weekDow, styles.weekDowOnPill, { opacity: onPillOpacity }]}>{abbr}</Animated.Text>
        </View>
        {/* Date number — same cross-fade. */}
        <View style={styles.weekNumRow}>
          <Animated.Text style={[styles.weekDayNum, { opacity: offPillOpacity }]}>{date.getDate()}</Animated.Text>
          <Animated.Text style={[styles.weekDayNum, styles.weekDayNumOnPill, { opacity: onPillOpacity }]}>{date.getDate()}</Animated.Text>
        </View>
      </View>
    </TouchableOpacity>
  );
});

export const CalendarView = ({
  tasks,
  onTaskPress,
  onTaskLongPress,
  onToggleComplete,
  // (task) — the circle key beside a schedule row starts a focus timer for it.
  onStartPomodoro,
  // (task) — a LIVE key was pressed: open the running timer rather
  // than starting a second block on the same task.
  onOpenPomodoro,
  // (userId, fallbackName) => a person record, for the badges on a card.
  memberOf,
  // (people, task, anchor) — a card's avatar stack was tapped.
  onPeoplePress,
  // (taskId) => focus spent on a task, and any block running on it.
  pomodoroFor,
  // A task block was tapped: (task, dateStr). The inspector itself is mounted
  // by the SCREEN, over everything — inside the calendar it drew beneath the
  // header chrome, the tab bar and this host's own clipping.
  onInspectTask,
  selectedProject,
  selectedTags,
  tagFilterMode,
  // Shared-calendar "whose tasks" filter (list of user ids to show; empty =
  // everyone) + multiUser flag (more than one person owns visible tasks) which
  // gates the per-owner colour badge so a solo calendar stays uncluttered.
  selectedOwners,
  // Global "incomplete only" filter (the FilterMenu's completed toggle). When
  // true (the app default), completed tasks are hidden from the calendar too —
  // matching the task tree — so the day-cell lists don't surface finished items.
  // Defaults false so an unpassed prop preserves the old "show everything" shape.
  showIncompleteOnly = false,
  multiUser,
  onAddTask,
  onUpdateTask,
  // (taskId) => void — the inspector's Delete.
  onDeleteTask,
  // The board names, for the inspector's board keys.
  projects = [],
  refreshing,
  onRefresh,
  onDateChange,
  // Reports the currently-selected calendar day up to the screen so the
  // header stats panel can show that day's scheduled/completed counts.
  onSelectedDateChange,
  // Reports whether the day-schedule planner (bottom sheet) is raised, so the
  // parent can lock the calendar⇄list pager while it's open — horizontal
  // swipes then page between DAYS instead of switching to the list view.
  onPlannerOpenChange,
  // Opens the unified create form pre-dated to a given day (YYYY-MM-DD), fired
  // by the day-planner header's "+" button.
  onCreateForDate,
  // (task, { dueDate, time }) => void — delivers a "rescheduled" heads-up to a
  // task's co-owner. Optional; the quick inspector's reschedule flow asks first.
  onNotifyReschedule,
  // (task) => void — tapping a task's owner badge opens that person's profile.
  onOwnerPress,
}) => {
  const { theme, timeFormat, showCalendarDayTasks, calendarFreeScroll } = useTheme();
  const use24h = timeFormat === '24h';
  // currentMonthIndex is the source of truth for "which month is on
  // screen". currentDate is derived from it so all the existing
  // .getMonth()/.getFullYear() reads keep working unchanged.
  // Opens on TODAY'S month and TODAY'S date — derived when the view mounts,
  // never from the module-load constants.
  //
  // MONTHS_LIST / DAYS_LIST are built once at module load and anchored to the
  // day the JS bundle started. This app stays resident for days, so by the
  // time the calendar is opened that anchor can be a different day — and
  // `TODAY_INDEX` / `DAY_TODAY_INDEX` then point at the day the bundle loaded
  // rather than today. `selectedDate` said today while the pager opened on the
  // stale page: the highlight and the page disagreed. monthIndexOf/dayIndexOf
  // measure against the list's own first entry, so they stay right however old
  // the list is (and clamp, ±10 years / ±2.2 years, so they cannot fall off).
  const [currentMonthIndex, setCurrentMonthIndex] = useState(todayMonthIndex);
  const currentDate = MONTHS_LIST[currentMonthIndex];
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  // The day pager's page at mount. Same reasoning; read once so the initial
  // scroll index can never disagree with the initial selection.
  const initialDayIndexRef = useRef(todayDayIndex());
  // The strip is a CONTINUOUS sliding track of day cells under a FIXED centre
  // pill (see stripCenterIndex / windowDays / trackTranslateX below). Each cell is
  // absolutely positioned by its OWN day index and the track translates 1:1 with
  // the day pager, so weeks flow past the pill with no boundary jump; re-windowing
  // on settle only mounts/unmounts off-screen edge cells, moving nothing on screen.
  // Mirror the selected day up to the parent whenever it changes (used by
  // the header stats panel). Effect, not inline in every setter, so all
  // selection paths (tap, re-tap, "today") report without extra wiring.
  useEffect(() => {
    onSelectedDateChange?.(selectedDate);
  }, [selectedDate, onSelectedDateChange]);
  // Docked or raised, as a REF rather than state. Nothing in the render reads
  // it any more — the sheet's entire appearance is driven off the `sheet`
  // shared value on the UI thread — and the setState that used to live here
  // landed a full CalendarView render on the FIRST frame of every spring,
  // which is the hitch you feel as the panel starts moving. The ref flips the
  // instant a snap is committed, so a second tap mid-flight still computes the
  // right direction. true = docked.
  const dockedRef = useRef(true);
  // Tell the parent when the planner opens/closes (raised = !docked) so it
  // can lock the calendar⇄list pager while the day schedule is up.
  //
  // DEFERRED, not effect-driven: this flips `dayPlannerOpen` in the PARENT,
  // which re-renders the whole TasksScreen (both pager pages). Running it off
  // an effect on the docked/raised state landed that heavy render mid-spring —
  // the stutter felt on pull up/down. Instead the snap's completion callback fires
  // it AFTER the animation settles, so the sheet glides on the UI thread and
  // the React churn happens once it's already parked. `raise` = planner open.
  const notifyPlanner = useCallback((raise) => {
    onPlannerOpenChange?.(raise);
  }, [onPlannerOpenChange]);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  // When the user long-presses an hour on the day calendar grid, we
  // pre-fill this with the snapped HH:MM time so the next save
  // creates a task at that exact slot. Null when the user is adding
  // an "untimed" task via the regular Add placeholder.
  const [pendingTime, setPendingTime] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Switching days must NOT carry an open add-task / search input across. The
  // add-task and search fields use `autoFocus`, and they render on whichever
  // pane is active (date === selectedDate). If either state is still true when
  // the day changes, the newly-active pane re-mounts an autoFocus TextInput and
  // the keyboard pops up unbidden on a plain day-cell tap. Reset those
  // transient input states (and their drafts) whenever the selected day changes.
  useEffect(() => {
    setIsAddingTask(false);
    setNewTaskTitle('');
    setPendingTime(null);
    setIsSearching(false);
    setSearchQuery('');
  }, [selectedDate]);

  // Whether the "All Day" / Open-tasks list strip is collapsed. Defaults
  // COLLAPSED so the day's tasks open tidy — you see the header + count and
  // tap to expand the list, rather than a long list unfurled on first open.
  // Tap the header to fold/unfold; the mode toggle also sets it per mode.
  const [untimedCollapsed, setUntimedCollapsed] = useState(true);

  // Tapping a task block hands it UP with the day it was tapped on: the
  // screen mounts the inspector above every other layer in the app.
  const openInspector = useCallback(
    (task) => { if (task) onInspectTask?.(task, toDateString(selectedDateRef.current)); },
    [onInspectTask],
  );

  // Keyboard handling
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  
  useEffect(() => {
    // Pads the day pane's bottom so rows can scroll clear of the keyboard.
    // No LayoutAnimation on the event: a global one captured every other
    // layout change of that frame (the inspector, the fold) and dragged them
    // behind the keyboard.
    const showListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setKeyboardHeight(e.endCoordinates.height)
    );
    const hideListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardHeight(0)
    );
    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, []);
  
  // Track last tap for double-tap detection
  const lastTapRef = useRef(0);

  // ── Day-tasks bottom-sheet drive ─────────────────────────────
  //
  // `sheet` is the single source of truth for the panel's position:
  //   0 = docked  (calendar visible, only the header peeks at the bottom)
  //   1 = raised  (panel pulled up to full height, calendar hidden behind)
  //
  // A Pan gesture on the header drives `sheet` 1:1 with the finger; on
  // release it springs to the nearer snap, CARRYING THE FLING'S VELOCITY
  // into the spring so the sheet never stops dead at the moment your finger
  // leaves it. `dockedRef` is kept in lock-step at the snap endpoints
  // (dockedRef === true ⟺ docked ⟺ sheet 0) for the handlers that need to
  // know which way a toggle should go.
  const sheet = useSharedValue(0);          // starts docked (dockedRef=true)
  const sheetStart = useSharedValue(0);     // sheet value at gesture start
  // Seed containerH with the window height so the very first frame
  // computes a sensible (docked) translateY — otherwise travel=0 would
  // briefly render the sheet raised before onLayout corrects it.
  const containerH = useSharedValue(WINDOW_HEIGHT);
  const headerH = useSharedValue(84);       // measured via onLayout; est. default
  // The SAME measurement, in React state. The calendar's bottom reserve has to
  // be what the docked sheet really occupies, and the month-size memo can't
  // read a shared value. Rounded + thresholded so a sub-pixel re-measure can't
  // churn the layout.
  const [sheetHeaderH, setSheetHeaderH] = useState(SHEET_PEEK_RESERVE);
  // Gates the calendar's first paint. The month grid renders once at a static
  // fallback height (calAreaH=0) and again — grown to fill the screen — the
  // instant the area is measured, which reads as a visible "pop/resize" on
  // load. We hold the grid invisible until that first measure + re-anchor has
  // happened, then fade it in at the final geometry so only one layout is ever
  // seen. Starts at 1 on native re-mounts where calAreaH is already known.
  const contentReady = useSharedValue(0);

  // translateY travel = how far the sheet slides between docked and
  // raised. At sheet=1 translateY=0 (full up); at sheet=0 translateY=travel
  // (pushed down so only the header strip shows).
  // live in it, and none of them can be scrolled out from under the bar the way
  // list content can. Read from the context (not useBottomTabBarHeight) so the
  // calendar still renders outside a tab navigator; absent ⇒ 0, unchanged.
  const tabBarH = useContext(BottomTabBarHeightContext) ?? 0;
  const insets = useSafeAreaInsets();
  // Exact dock occupancy from the dock's own constants — see dockOccupied.
  // Zero when there's no tab bar (the calendar also renders outside one).
  const dockH = tabBarH > 0 ? dockOccupied(insets.bottom) : 0;
  // What the calendar must keep clear at the bottom. The docked sheet parks at
  // `containerH - headerH - dockH` (see sheetStyle), so the reserve has to be
  // the header's MEASURED height — a flat SHEET_PEEK_RESERVE left the last week
  // of the month sitting behind a header that measures taller than 80 once the
  // "TO-DO List" title and its date subtitle are in it. The constant stays
  // as the floor, for the frames before the header has been measured.
  const peekReserve = Math.max(SHEET_PEEK_RESERVE, sheetHeaderH) + dockH;

  const sheetStyle = useAnimatedStyle(() => {
    // Closed, the sheet rests with its header peeking at the bottom — minus the
    // floating tab card's height, or the card would sit ON the peek and make
    // today's task list unreachable.
    // Uses the dock's REAL occupancy (card + float gap + safe area), not the
    // tab-bar hook — under-reporting here is what left the header sitting
    // partly behind the dock instead of fully above it. Closed, the sheet shows
    // its whole header ABOVE the dock; the horizontal list below it is free to
    // tuck under the dock until you pull up.
    //
    // SHEET_RAISED_GAP comes off the travel because the sheet's own `top` is
    // already offset by it: the two have to agree or the docked peek drifts
    // down by exactly that gap.
    const travel = Math.max(0, containerH.value - headerH.value - dockH - SHEET_RAISED_GAP);
    return { transform: [{ translateY: travel * (1 - sheet.value) }] };
  });
  // The sheet is a CARD at both ends of the travel now — it stops below the
  // header rather than becoming the page — so the corners stay rounded the
  // whole way. Only the top hairline goes: raised, the card's top edge sits a
  // few points under the header's own rule, and two parallel lines that close
  // to each other read as a mistake. The border goes by COLOUR, not width:
  // width is layout, and changing it mid-spring would move the header (and with
  // it headerH, and with it the travel the spring is animating against).
  const sheetBorderOn = theme.mode === 'dark' ? SHEET_BORDER.dark : SHEET_BORDER.light;
  const sheetBorderOff = theme.mode === 'dark' ? SHEET_BORDER_CLEAR.dark : SHEET_BORDER_CLEAR.light;
  const sheetShapeStyle = useAnimatedStyle(() => ({
    borderTopColor: interpolateColor(sheet.value, [0.82, 1], [sheetBorderOn, sheetBorderOff]),
  }));
  // The header's own hairline — on when the sheet is raised (it separates the
  // title block from the week strip), off at the docked peek where the header
  // is a floating card edge. Opacity, not border width: see taskListHeader.
  const headerRuleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheet.value, [0.5, 1], [0, 1], Extrapolation.CLAMP),
  }));
  // The calendar DIMS behind the sheet instead of disappearing. The sheet is
  // frosted glass (see sheetFrost), and glass with a blank wall behind it is
  // just a wall: the month has to stay on screen for there to be anything to
  // blur. It goes far enough down that the day's text still reads cleanly over
  // it, and no further. The strip left visible ABOVE the raised card is the
  // calendar too — dimmed, so the gap reads as depth rather than a seam.
  const calendarStyle = useAnimatedStyle(() => ({
    // Sheet-cover dim × first-paint gate: both must be "open" to show the grid.
    opacity: contentReady.value * interpolate(sheet.value, [0, 0.85], [1, 0.42], Extrapolation.CLAMP),
  }));

  // Memoized so `styles` keeps a STABLE identity across renders. Unmemoized this
  // ran StyleSheet.create over a ~110-key object every render (keystroke, minute
  // tick, tap) and — worse — its fresh identity flowed into renderMonth/
  // renderDayItem deps + the React.memo'd DayPane prop, defeating EVERY memo
  // boundary in the file. This one line is the dominant calendar-lag fix.
  const styles = useMemo(() => createStyles(theme), [theme]);

  // The same sheet built against the sheet's own palette. The calendar
  // BEHIND the sheet keeps `styles`/`theme`; everything the sheet paints — its
  // header, the week strip, every day pane — takes these instead. Memoized for
  // the same reason as `styles` above: their identity flows into renderDayItem's
  // deps and DayPane's memo boundary.
  const sheetTheme = useMemo(() => sheetThemeFrom(theme), [theme]);
  const sheetStyles = useMemo(() => createStyles(sheetTheme), [sheetTheme]);

  // ── Fill-the-screen month sizing ─────────────────────────────
  // We measure the calendar area (`calAreaH`) and grow each cell so the
  // title block + day-of-week labels + 6 rows exactly fill the space
  // above the docked sheet peek. The MONTH_TITLE_HEIGHT band is reserved
  // on EVERY page (so snapping stays pixel-perfect) even though only the
  // active month actually paints its title into it — see renderMonth.
  // Falls back to the static MONTH_HEIGHT / CELL_HEIGHT until first layout.
  const [calAreaH, setCalAreaH] = useState(0);
  // The bottom strip the calendar must keep clear now includes the FLOATING tab
  // bar: the day-panel peek, the jump-to-today button and the swipe hint all
  const { monthH, cellH, monthTopInset } = useMemo(() => {
    const laid = monthLayout({
      areaH: calAreaH,
      bottomReserve: peekReserve,
      chromeH: MONTH_CHROME_HEIGHT,
      minCell: CELL_HEIGHT,
      maxCell: MAX_CELL_HEIGHT,
    });
    // Not measured yet — the static page height, top-anchored, for one frame.
    if (!laid) return { monthH: MONTH_HEIGHT, cellH: CELL_HEIGHT, monthTopInset: 0 };
    return { monthH: laid.monthH, cellH: laid.cellH, monthTopInset: laid.topInset };
  }, [calAreaH, peekReserve]);

  // The top fade's stops depend on the measured margin, so they are derived
  // here rather than written into the gradient by hand. See topFadeStops.
  const topFade = useMemo(
    () => topFadeStops(monthTopInset, TOP_FADE_FEATHER),
    [monthTopInset],
  );


  // Faint swipe-hint carets (up = previous month, down = next month).
  // A single shared value loops 0→1→0; the two chevrons read it with
  // opposite translateY so they breathe outward from the grid edges.
  const hintSV = useSharedValue(0);
  useEffect(() => {
    hintSV.value = withRepeat(
      withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [hintSV]);
  const hintTopStyle = useAnimatedStyle(() => ({
    opacity: 0.12 + hintSV.value * 0.20,
    transform: [{ translateY: hintSV.value * -4 }],
  }));
  const hintBottomStyle = useAnimatedStyle(() => ({
    opacity: 0.12 + hintSV.value * 0.20,
    transform: [{ translateY: hintSV.value * 4 }],
  }));

  // Snap the sheet to docked/raised and keep `dockedRef` in sync.
  // `raise=true` → panel up (docked false); `raise=false` → docked.
  const snapSheet = useCallback((raise) => {
    dockedRef.current = !raise;
    // Parent notify rides the spring's completion (see notifyPlanner) so the
    // heavy TasksScreen re-render lands after the settle, not during it. The
    // local side is now a ref, so NOTHING re-renders as the spring starts.
    sheet.value = withSpring(raise ? 1 : 0, SHEET_SPRING, (finished) => {
      'worklet';
      if (finished) runOnJS(notifyPlanner)(raise);
    });
  }, [sheet, notifyPlanner]);

  // Called from the Pan gesture's onEnd via runOnJS once the finger lifts, to
  // record which end the spring is heading for (the spring itself is already
  // running on the UI thread by then).
  const commitSheet = useCallback((raise) => {
    dockedRef.current = !raise;
  }, []);

  // Pan gesture on the header. activeOffsetY means a short tap (no
  // vertical travel) is NOT captured — it falls through to the header's
  // TouchableOpacity onPress (tap-to-toggle) and to the inline filter
  // button — while a deliberate vertical drag grabs the sheet.
  const headerPan = useMemo(() => Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onStart(() => {
      sheetStart.value = sheet.value;
    })
    .onUpdate((e) => {
      // The SAME travel sheetStyle uses, dock and raised-gap included. It used
      // to leave both out, so a drag moved the sheet slightly further than the
      // finger and the card crept ahead of your thumb over a long pull.
      const travel = Math.max(1, containerH.value - headerH.value - dockH - SHEET_RAISED_GAP);
      // Drag up (negative translationY) raises the sheet toward 1.
      const next = sheetStart.value - e.translationY / travel;
      sheet.value = Math.min(1, Math.max(0, next));
    })
    .onEnd((e) => {
      const travel = Math.max(1, containerH.value - headerH.value - dockH - SHEET_RAISED_GAP);
      // Project a little along the fling so a fast flick commits even
      // from past the midpoint.
      const normalizedV = -e.velocityY / travel;
      const projected = sheet.value + normalizedV * 0.12;
      const raise = projected >= 0.5;
      // Hand the fling's speed to the spring, in the sheet's own 0→1 units.
      // Without it the spring starts from rest: the sheet was tracking your
      // finger at speed and then, the instant you let go, restarted from a
      // dead stop — a visible break in one continuous gesture. With it the
      // release is just the point where the finger stops steering and the
      // spring takes over at the same speed.
      //
      // The parent pager-lock notify still waits for the settle, so the big
      // TasksScreen re-render never lands mid-animation (the pull stutter).
      sheet.value = withSpring(raise ? 1 : 0, { ...SHEET_SPRING, velocity: normalizedV }, (finished) => {
        'worklet';
        if (finished) runOnJS(notifyPlanner)(raise);
      });
      runOnJS(commitSheet)(raise);
    }), [sheet, sheetStart, containerH, headerH, dockH, commitSheet, notifyPlanner]);

  // ── Horizontal day pager ─────────────────────────────────────────────
  //
  // The day planner's hourly timetable is a native paged FlatList — one
  // page per calendar day (DAYS_LIST, ±DAY_RANGE around today). Swiping
  // pages between days exactly like the iOS Calendar day view: the
  // neighbouring days are already rendered just off-screen, so the swipe
  // tracks the finger and snaps with native momentum — no manual
  // translateX, no mid-flight data swap, no blank gap. This mirrors the
  // vertical month FlatList above, which moved to the same native-paging
  // model for the same race-free smoothness.
  const dayListRef = useRef(null);
  // The page index currently centred. Held in a ref (not state) so the
  // momentum/jump handlers can read+write it without re-render churn; the
  // visible day is mirrored into `selectedDate` for the rest of the UI.
  // Seeded from the day this view MOUNTED, not from the day the bundle loaded.
  // `DAY_TODAY_INDEX` is a module-load constant, and the app stays resident for
  // days — see the note on currentMonthIndex. (The same constant is still the
  // right thing at lines ~1547 / ~2023: there it is a coordinate ORIGIN that
  // cancels out of the translate, so it only has to be the same on both sides.)
  const currentDayIndexRef = useRef(initialDayIndexRef.current);

  // Live horizontal scroll offset of the day pager, captured natively so the
  // week-strip highlight can track the swipe 1:1 (mirrors the photo-vault tab
  // indicator). Seeded at today's offset so the pill is correctly placed on
  // the very first frame, before any scroll event fires.
  // THE pill's position on frame one. This is what made "today" look unselected
  // on opening: the pager starts on today's page (initialScrollIndex) while this
  // seed still pointed at the bundle-load day, so the week strip's highlight sat
  // on a different date until the first scroll event corrected it.
  const dayScrollX = useRef(new Animated.Value(initialDayIndexRef.current * SCREEN_W)).current;
  // Week-strip geometry, measured via onLayout so the sliding pill lines up
  // with the day cells on any screen width / font metrics. Seeded with
  // computed defaults and refined once laid out.
  const [stripW, setStripW] = useState(SCREEN_W);
  const [pillTop, setPillTop] = useState(6);
  const [pillH, setPillH] = useState(54);
  const cellW = (stripW - 12) / 7; // 12 = weekStrip paddingHorizontal (6 each side)
  // The highlight pill now wraps BOTH the weekday abbreviation and the date, so
  // it's a tall rounded square. Width tracks the cell (capped) so neighbours
  // don't touch; top/height come from measuring the cell's pill slot.
  const PILL_W = Math.min(Math.max(cellW - 8, 28), 52);

  // Move the pager (and selection) to a specific date. `animated` true gives
  // the native slide (week-strip taps); false jumps instantly (calendar cell
  // taps, Today) since the pager isn't on screen at that moment.
  const jumpToDate = useCallback((date, animated) => {
    const idx = dayIndexOf(date);
    currentDayIndexRef.current = idx;
    setSelectedDate(DAYS_LIST[idx]);
    onDateChange?.();
    // Instant jumps (calendar-cell tap, Today) may not emit onScroll, so anchor
    // the pill directly. Animated jumps let onScroll drive the slide instead.
    if (!animated) dayScrollX.setValue(idx * SCREEN_W);
    dayListRef.current?.scrollToOffset({ offset: idx * SCREEN_W, animated });
  }, [onDateChange, dayScrollX]);

  // ── Week strip (day selector above the hourly planner) ──────────────────
  // Tapping a week-strip day slides to it with the same native page-turn a
  // swipe uses, so tap and swipe feel identical.
  const goToDate = useCallback((date) => {
    if (dayIndexOf(date) === currentDayIndexRef.current) return;
    jumpToDate(date, true);
  }, [jumpToDate]);

  // User finished a swipe — adopt whichever day the pager landed on.
  const onDayScrollEnd = useCallback((e) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    const clamped = Math.max(0, Math.min(DAYS_LIST.length - 1, idx));
    // Re-window the rendered cells around the landed day (keeps a buffer either
    // side). With cells absolutely positioned by day index and the track
    // translate independent of the window, this moves NOTHING on screen — it only
    // mounts/unmounts off-screen edge cells. React bails if the value is unchanged.
    setStripCenterIndex(clamped);
    if (clamped !== currentDayIndexRef.current) {
      currentDayIndexRef.current = clamped;
      setSelectedDate(DAYS_LIST[clamped]);
      onDateChange?.();
    }
  }, [onDateChange]);

  const getDayItemLayout = useCallback((_, index) => ({
    length: SCREEN_W, offset: SCREEN_W * index, index,
  }), []);
  const dayKeyExtractor = useCallback((item) => toDateString(item), []);

  // ── Continuously-sliding week strip (iOS-Calendar feel) ─────────────────
  // The strip used to be a static 7-cell week that re-anchored discretely, which
  // CLAMPED the pill at the week edge and JUMPED it the full strip width at the
  // Sat→Sun boundary. Now it's a FIXED centre highlight with a horizontally-
  // sliding row of day cells under it: the row translates 1:1 with the day
  // pager, so the centred day always sits under the pill and weeks flow past
  // continuously — no boundary jump.
  //
  // stripCenterIndex = the DAYS_LIST index the rendered cell WINDOW is centred on.
  // Re-windowed on SETTLE only (onDayScrollEnd) — but because each cell is
  // absolutely positioned by its OWN day index and the track translate does NOT
  // depend on the window, re-windowing only mounts/unmounts off-screen edge cells:
  // nothing on screen moves. (This is the fix for the abrupt +1 snap that the old
  // window-rebasing translate produced when a swipe settled on the next day.)
  //
  // ── TUNING (if the pill/cells look misaligned on-device) ──
  //   • pillLeft   — horizontal position of the fixed pill (slot STRIP_CENTER_CELL)
  //   • base       — inside trackTranslateX; nudges the whole track left/right
  //   • STRIP_CENTER_CELL — which of the 7 visible slots (0..6) the pill sits over
  const [stripCenterIndex, setStripCenterIndex] = useState(() => initialDayIndexRef.current);
  const STRIP_HALF_WIN = 14;     // cells rendered each side of centre (fling buffer; re-window is invisible now, so generous)
  const STRIP_CENTER_CELL = 3;   // the pill sits over the middle of the 7 visible cells

  const windowDays = useMemo(() => {
    const out = [];
    for (let off = -STRIP_HALF_WIN; off <= STRIP_HALF_WIN; off++) {
      const idx = stripCenterIndex + off;
      if (idx >= 0 && idx < DAYS_LIST.length) out.push({ idx, date: DAYS_LIST[idx] });
    }
    return out;
  }, [stripCenterIndex]);

  // The pill is FIXED over the centre cell; the cell row slides under it.
  const pillLeft = 6 + STRIP_CENTER_CELL * cellW + (cellW - PILL_W) / 2;

  // Measure the centre cell's pill slot so the fixed pill lines up on any
  // screen width / font metrics. Stable identity — passed only to the centre
  // WeekStripCell, so re-windowing swaps which cell holds it without
  // re-rendering the rest.
  const measurePillSlot = useCallback((e) => {
    setPillTop(6 + e.nativeEvent.layout.y);
    setPillH(e.nativeEvent.layout.height);
  }, []);

  // Track translate — a PURE function of the day-pager scroll, with NO
  // stripCenterIndex term, so re-windowing the rendered cells can never rebase
  // it. Each cell is absolutely positioned at its own day index
  // (left = (idx - DAY_TODAY_INDEX) * cellW), so the only thing that animates is
  // this one translateX. Derivation: when the pager rests on day D
  // (dayScrollX = D*SCREEN_W) we want cell D at slot STRIP_CENTER_CELL, i.e.
  // 6 + L(D) + translate = 6 + CENTER*cellW with L(D) = (D - DAY_TODAY_INDEX)*cellW
  // ⇒ translate = (CENTER + DAY_TODAY_INDEX - D) * cellW — linear in dayScrollX.
  // This is what kills the abrupt one-day snap: the cell-reorder (UIManager) and
  // the translate-rebase (native animated) used to land a frame apart on-device;
  // now nothing reorders and the translate never rebases.
  const trackTranslateX = useMemo(() => {
    const base = (STRIP_CENTER_CELL + DAY_TODAY_INDEX) * cellW;
    return dayScrollX.interpolate({
      inputRange: [0, SCREEN_W],
      outputRange: [base, base - cellW],
      extrapolate: 'extend',
    });
  }, [cellW, dayScrollX]);

  // Latest-selection ref so handleDatePress can read the current selection
  // WITHOUT depending on it — keeps the handler's identity stable across
  // selection changes, which is what lets the memoized MonthPage skip
  // re-rendering the ~11 months a tap doesn't touch.
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;

  // Handle date selection with double-tap or re-tap detection
  const handleDatePress = useCallback((date) => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300; // ms
    const isDoubleTap = now - lastTapRef.current < DOUBLE_TAP_DELAY;
    const isAlreadySelected = selectedDateRef.current.toDateString() === date.toDateString();

    // Select the date (jumpToDate also moves the day pager + fires
    // onDateChange). A double-tap / re-tap additionally raises the panel.
    jumpToDate(date, false);
    if (isDoubleTap || isAlreadySelected) {
      snapSheet(true);
    }

    lastTapRef.current = now;
  }, [snapSheet, jumpToDate]);

  // Header tap toggles the sheet between docked and raised. (Drags are
  // handled separately by the Pan gesture wrapping the header.)
  const toggleExpand = useCallback(() => {
    snapSheet(dockedRef.current); // docked → raise; raised → dock
  }, [snapSheet]);

  // ── Day-pane control callbacks (passed to each DayPane) ───────────────
  // Opening the add-task / search inputs from a docked calendar first raises
  // the panel so the input isn't hidden behind it.
  const openAddTask = useCallback(() => {
    setIsAddingTask(true);
    if (dockedRef.current) toggleExpand();
  }, [toggleExpand]);
  const openSearch = useCallback(() => {
    setIsSearching(true);
    if (dockedRef.current) toggleExpand();
  }, [toggleExpand]);
  const closeSearch = useCallback(() => {
    setIsSearching(false);
    setSearchQuery('');
  }, []);
  const clearPendingTime = useCallback(() => setPendingTime(null), []);
  // Long-press on a day's hour grid → open the add-task input pre-filled
  // with that 15-min slot (the pane scrolls the input into view itself).
  const openAddTaskAt = useCallback((timeStr) => {
    setPendingTime(timeStr);
    setIsAddingTask(true);
  }, []);
  // Tapping the time pill on the add-task row opens the slick wheel picker so
  // the snapped drop-time can be fine-tuned (or cleared) before saving.
  const [editingTime, setEditingTime] = useState(false);
  // Opening the picker blurs the auto-focused add-task TextInput, which would
  // otherwise fire the input's onBlur→handleCancelAdd and tear down the whole
  // add row (clearing pendingTime). This one-shot ref tells that next cancel to
  // no-op so the row + pending time survive while the picker is up.
  const skipBlurCancelRef = useRef(false);
  const openTimeEditor = useCallback(() => {
    skipBlurCancelRef.current = true;
    setEditingTime(true);
  }, []);

  // Tapping an EXISTING row's time column opens the same wheel on that task.
  // Held here rather than in DayPane because three panes are mounted at once
  // and only one picker may be up.
  const [timeEditTarget, setTimeEditTarget] = useState(null); // { task, dayStr }
  const openTaskTimeEditor = useCallback((task, dayStr) => {
    if (task) setTimeEditTarget({ task, dayStr });
  }, []);
  const closeTaskTimeEditor = useCallback(() => setTimeEditTarget(null), []);
  const commitTaskTime = useCallback((t) => {
    const { task, dayStr } = timeEditTarget || {};
    if (!task) return;
    const patch = { time: t || '' };
    // The time lands on the day you set it FROM — that is what "give this
    // To-Do an hour" means when you're looking at Thursday. A repeating task
    // is the exception: its dueDate is the series anchor, so moving it would
    // drag every future occurrence along. Those just take the new time.
    const repeats = (task.recurring || task.recurrence || 'none') !== 'none';
    if (!repeats && dayStr && task.dueDate !== dayStr) patch.dueDate = dayStr;
    onUpdateTask?.(task.id, patch);
  }, [timeEditTarget, onUpdateTask]);

  // Fold/unfold the "All Day" untimed strip. Native LayoutAnimation
  // gives the height change a smooth ease without us animating a
  // measured height ourselves.
  const toggleUntimedCollapsed = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setUntimedCollapsed(prev => !prev);
  }, []);

  // Schedule view mode: COLLAPSED (default) = a compact stack of just the
  // timed tasks with the inter-task gaps shown as a number; EXPANDED = the
  // full 24-hour hour grid. Shared across panes so the choice persists as you
  // swipe day-to-day. The reveal is animated by Reanimated layout + enter/exit
  // on the swap wrapper itself (NOT LayoutAnimation — the two conflict).
  const [scheduleCollapsed, setScheduleCollapsed] = useState(true);
  const toggleScheduleCollapsed = useCallback(() => {
    setScheduleCollapsed(prev => !prev);
  }, []);

  // ── The one shared filter pass ───────────────────────────────
  // Every calendar surface (month cells, day panes, pending strip, search)
  // filters the SAME task set the same way — so run taskPassesFilters ONCE per
  // tasks/filter change and let everything below start from this list. The old
  // shape re-ran the full predicate per CELL (42 cells × ~13 mounted months ×
  // every task) on each cache reset.
  const filteredTasks = useMemo(() => {
    const filters = { selectedProject, selectedTags, tagFilterMode, selectedOwners };
    return tasks.filter(t =>
      taskPassesFilters(t, filters)
      // Honour the global "incomplete only" filter here too, so completed tasks
      // drop out of the month cells' day-lists (and the dots/heat/day panes)
      // exactly as they do from the task tree — not just get struck through.
      && (!showIncompleteOnly || !t.completed)
    );
  }, [tasks, selectedProject, selectedTags, tagFilterMode, selectedOwners, showIncompleteOnly]);

  // Per-month calendar cells (day number + that day's matching tasks), built
  // lazily via the single-pass buildMonthCells and CACHED per month.
  // Deliberately does NOT depend on selectedDate or "today": selection + today
  // are highlight-only, computed at render time — so tapping a day just
  // re-paints the highlighted number. The cache resets whenever the tasks or
  // active filters change (the filteredTasks identity).
  //
  // The cells ALWAYS render due-date-only dots (dueDateOnly=true semantics):
  // lighting up every day in a task's created→due range produced a flood of
  // dots that drowned out the actual deadlines.
  const buildCalendarDataFor = useMemo(() => {
    const cache = new Map();
    return (targetDate) => {
      const key = `${targetDate.getFullYear()}-${targetDate.getMonth()}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const days = buildMonthCells(filteredTasks, targetDate, showIncompleteOnly);
      cache.set(key, days);
      return days;
    };
  }, [filteredTasks, showIncompleteOnly]);

  // One day's tasks, ordered earliest-time-first — the same predicates the
  // month cells use, so what lights up in the grid matches the day's list.
  // Cached per date string; shared by the day panes AND the selected-date
  // header count, so a pane re-render is a Map hit, not a full re-filter.
  const getDayTasks = useMemo(() => {
    const cache = new Map();
    return (dateStr) => {
      const hit = cache.get(dateStr);
      if (hit) return hit;
      const list = filteredTasks
        .filter(t => taskOccursOn(t, dateStr, true, showIncompleteOnly))
        .sort((a, b) => {
          if (a.time && b.time) return a.time.localeCompare(b.time);
          if (a.time) return -1;
          if (b.time) return 1;
          return 0;
        });
      cache.set(dateStr, list);
      return list;
    };
  }, [filteredTasks, showIncompleteOnly]);

  // Tasks for the selected date — same cache the day panes read.
  const selectedDateTasks = getDayTasks(toDateString(selectedDate));

  // What the finder shows before anything is typed: this day's still-OPEN
  // tasks. `isOccurrenceCompleted` as well as `completed` — a repeating task
  // ticked for THIS day is done here even though the task itself is not.
  // (toDateString here rather than `selectedStr`, which is declared further
  // down — a const read above its declaration is a TDZ crash, not a warning.)
  const dayOpenTasks = useMemo(() => {
    const dstr = toDateString(selectedDate);
    return selectedDateTasks.filter((t) => !t.completed && !isOccurrenceCompleted(t, dstr));
  }, [selectedDateTasks, selectedDate]);

  // PENDING tasks — everything still OPEN that today's plan hasn't accounted
  // for. Two buckets:
  //   • the undated backlog (no due date, no time) — never had a day;
  //   • CARRY-OVERS: dated strictly BEFORE today and still not ticked, i.e.
  //     yesterday's (and last week's) unfinished work, which otherwise only
  //     existed on a day you'd have to swipe back to.
  // Repeating tasks are excluded from the carry-over bucket: their stored
  // dueDate is the series' start, so they'd sit here permanently while the grid
  // is already drawing today's occurrence.
  // Tasks dated today or later still live on their own day (timed grid or TBD
  // list) — the strip is the backlog, not a duplicate of the plan.
  const pendingTasks = useMemo(() => {
    const today = toDateString(new Date());
    // Epoch ms for "how recent is this", tolerating both the numeric timestamps
    // the app writes and any ISO string that reaches us from the server.
    const toMs = (v) => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') { const n = Date.parse(v); return Number.isNaN(n) ? 0 : n; }
      return 0;
    };
    // Most recent first = the day it was last due, else the day it was made, so
    // yesterday's leftovers sit above last month's and a task typed an hour ago
    // is at the top where you can act on it.
    const recencyOf = (t) => (t.dueDate
      ? (parseLocalYMD(t.dueDate)?.getTime() || 0)
      : toMs(t.createdAt || t.updatedAt));
    return filteredTasks
      .filter((t) => {
        if (t.completed || itemTypeOf(t) !== 'task') return false; // events/birthdays have their own strip
        if (!t.dueDate) return !(t.time && /^\d{1,2}:\d{2}/.test(t.time));
        if (t.dueDate.slice(0, 10) >= today) return false;
        return (t.recurring || t.recurrence || 'none') === 'none';
      })
      .sort((a, b) => {
        const d = recencyOf(b) - recencyOf(a);
        return d !== 0 ? d : (a.title || '').localeCompare(b.title || '');
      });
  }, [filteredTasks]);

  // Highlight strings, computed once per render and shared by the month
  // pages, week strip, and day panes (each used to call toDateString(new
  // Date()) themselves — the strip did it per CELL per render).
  const todayStr = toDateString(new Date());
  const selectedStr = toDateString(selectedDate);

  // True iff the selected date is "today" — drives the live red
  // now-line in the hour grid.
  const isViewingToday = selectedStr === todayStr;

  // Minutes-from-midnight for the now-line indicator. Only ticks when
  // the user is viewing today (otherwise the now-line is hidden and
  // recomputing would be wasted work). Updates once per minute, on the
  // minute boundary, so the line moves smoothly without per-second
  // re-renders.
  const [nowMinutes, setNowMinutes] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });
  useEffect(() => {
    if (!isViewingToday) return;
    const tick = () => {
      const n = new Date();
      setNowMinutes(n.getHours() * 60 + n.getMinutes());
    };
    tick();
    // Align the first interval to the next minute boundary so the
    // line jumps when the clock changes (not 0–59s after).
    // React Native setTimeout/setInterval return a *number* (not an
    // object like Node), so we can't attach the interval id to the
    // timeout id — that's where the "cannot create property '_interval'
    // on number" crash came from. Hold both ids in plain closure
    // variables instead and clear them in the cleanup.
    let intervalId = null;
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    const initialId = setTimeout(() => {
      tick();
      intervalId = setInterval(tick, 60_000);
    }, msToNextMinute);
    return () => {
      clearTimeout(initialId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [isViewingToday]);

  // ── Vertical FlatList paging between months ─────────────────
  //
  // The previous horizontal `Animated.Value` + PanResponder approach
  // had a fundamental race: native-side `setValue(0)` runs on the UI
  // thread immediately, while React's state commit is async — so for
  // one frame the new offset would apply to the OLD rail content,
  // briefly centring the wrong month.
  //
  // A native vertical FlatList sidesteps the race entirely. The scroll
  // offset IS the source of truth, native-scrolled at 60fps. We just
  // observe `onMomentumScrollEnd` and derive currentMonthIndex from
  // wherever the scroll landed. No `setValue`, no `useLayoutEffect`,
  // no PanResponder — and `snapToInterval` makes the page-snap feel
  // identical to iOS Calendar.
  const flatListRef = useRef(null);

  // Scroll-driven state sync. Triggered when the user lifts a finger
  // and the FlatList settles on a page, OR when a programmatic scroll
  // (from chevrons / Today) finishes its momentum.
  const onMomentumScrollEnd = useCallback((e) => {
    const idx = Math.round(e.nativeEvent.contentOffset.y / monthH);
    const clamped = Math.max(0, Math.min(MONTHS_LIST.length - 1, idx));
    if (clamped !== currentMonthIndex) {
      setCurrentMonthIndex(clamped);
    }
  }, [currentMonthIndex, monthH]);

  // (The moving-list top fade that used to live here — a shared value driven by
  // the list's drag/momentum events — went with the gradient it animated. The
  // month list's own onMomentumScrollEnd is passed straight through now.)

  // Scroll to a given month index. Used by the chevrons + Today
  // button. We set currentMonthIndex up front so the visible state
  // matches before the scroll animation finishes — `onMomentumScrollEnd`
  // will reconfirm the index when the scroll settles.
  const scrollToMonth = useCallback((targetIdx, animated = true) => {
    const clamped = Math.max(0, Math.min(MONTHS_LIST.length - 1, targetIdx));
    setCurrentMonthIndex(clamped);
    flatListRef.current?.scrollToIndex({ index: clamped, animated, viewPosition: 0 });
  }, []);

  // scrollToIndex can fail on first render before the FlatList has
  // measured. Standard FlatList workaround: retry after a tick.
  const onScrollToIndexFailed = useCallback((info) => {
    setTimeout(() => {
      flatListRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0 });
    }, 80);
  }, []);

  const goToToday = useCallback(() => {
    jumpToDate(new Date(), false);
    // Live month index (not the frozen module-load TODAY_INDEX) so we land on
    // the ACTUAL current month even if the app has been open across midnight
    // into a new month — otherwise the day pager shows today while the month
    // grid sits on last month.
    scrollToMonth(todayMonthIndex());
  }, [scrollToMonth, jumpToDate]);

  // Opening the calendar tomorrow must still open it on TOMORROW.
  //
  // Mounting anchors on today (see currentMonthIndex / selectedDate), but this
  // view is not remounted for days — the phone is backgrounded, midnight
  // passes, and coming back the grid is still sitting on yesterday with
  // yesterday highlighted. On return to the foreground, if the calendar DAY
  // has actually moved on, re-anchor exactly as the Today key does.
  //
  // Guarded on the day changing, not on every foreground: someone who browsed
  // to October, answered a message and came back should find October where
  // they left it.
  const anchoredDayRef = useRef(toDateString(new Date()));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const today = toDateString(new Date());
      if (today === anchoredDayRef.current) return;
      anchoredDayRef.current = today;
      goToToday();
    });
    return () => sub?.remove();
  }, [goToToday]);

  // FlatList per-item layout. With every month at exactly `monthH`,
  // this lets initialScrollIndex jump straight to today without measuring.
  const getItemLayout = useCallback((_, index) => ({
    length: monthH,
    offset: monthH * index,
    index,
  }), [monthH]);
  const keyExtractor = useCallback((item) => `${item.getFullYear()}-${item.getMonth()}`, []);

  // Mirror the committed month index into a ref so the re-anchor effect below
  // can read the latest WITHOUT re-running on every scroll-driven month change
  // (which would yank the list back mid-swipe).
  const currentMonthIndexRef = useRef(currentMonthIndex);
  currentMonthIndexRef.current = currentMonthIndex;

  // Re-anchor the month list whenever the per-page height (`monthH`) changes:
  // first when `calAreaH` is measured (static estimate → real fill-screen
  // height), and AGAIN on any later resize (rotation, split-screen, unfold).
  // `getItemLayout` maps scroll-offset → month via `monthH`, so a height change
  // that isn't re-anchored silently shows a DIFFERENT month at the same offset.
  // Not one-shot anymore — the old guard only fixed the first measure and left
  // the grid on the wrong month after a rotate. The calendar is revealed once,
  // right after the first anchor (the fade hides that initial layout swap).
  const didRescaleRef = useRef(false);
  useEffect(() => {
    if (calAreaH <= 0) return;
    const raf = requestAnimationFrame(() => {
      try {
        flatListRef.current?.scrollToIndex({ index: currentMonthIndexRef.current, animated: false, viewPosition: 0 });
      } catch (e) { /* getItemLayout makes this reliable; ignore races */ }
      if (!didRescaleRef.current) {
        didRescaleRef.current = true;
        contentReady.value = withTiming(1, { duration: 140 });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [calAreaH, monthH, contentReady]);

  const handleAddTask = useCallback(() => {
    if (!newTaskTitle.trim()) return;
    const dateStr = toDateString(selectedDateRef.current);
    onAddTask?.(
      newTaskTitle.trim(),
      // 'All' AND the 'No Project' sentinel both mean "no board" — passing the
      // sentinel through would store it as a real (truthy) board name, making
      // the task vanish from the very No-Board scope it was created in.
      selectedProject === 'All' || selectedProject === 'No Project' ? '' : selectedProject,
      dateStr,
      pendingTime, // null for the regular "Add a new task" flow; HH:MM
                   // when the user reached the input via a long-press
                   // on the day calendar grid.
    );
    setNewTaskTitle('');
    setIsAddingTask(false);
    setPendingTime(null);
  }, [newTaskTitle, onAddTask, selectedProject, pendingTime]);

  // Re-add a previously-existing task: create a fresh instance on the
  // selected day, copying the original's description + tags + subtasks
  // (reset to incomplete with new ids) and any pending time slot.
  const handlePickSuggestion = useCallback((task) => {
    const dateStr = toDateString(selectedDateRef.current);
    onAddTask?.(
      task.title,
      // Same sentinel guard as handleAddTask above.
      task.project || (selectedProject === 'All' || selectedProject === 'No Project' ? '' : selectedProject),
      dateStr,
      pendingTime,
      {
        description: task.description || '',
        priority: task.priority || 'medium',
        tags: Array.isArray(task.tags) ? task.tags : [],
        subtasks: resetSubtasksForReuse(task.subtasks),
      },
    );
    setNewTaskTitle('');
    setIsAddingTask(false);
    setPendingTime(null);
  }, [onAddTask, selectedProject, pendingTime]);

  // One month's worth of UI — a thin adapter over the memoized MonthPage.
  // Cells come prebuilt from the per-month cache; highlight strings are
  // computed once per render (component body) and MonthPage's comparator
  // scopes their changes to the month(s) they actually touch.
  const renderMonth = useCallback(({ item: monthDate }) => {
    const monthPrefix = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}-`;
    return (
      <MonthPage
        monthDate={monthDate}
        monthPrefix={monthPrefix}
        cells={buildCalendarDataFor(monthDate)}
        monthH={monthH}
        cellH={cellH}
        todayStr={todayStr}
        selectedStr={selectedStr}
        showCalendarDayTasks={showCalendarDayTasks}
        theme={theme}
        styles={styles}
        onDatePress={handleDatePress}
      />
    );
  }, [buildCalendarDataFor, handleDatePress, theme, styles, monthH, cellH, showCalendarDayTasks, selectedStr, todayStr]);

  // Sheet-header title + subtitle for the selected date.
  const { subtitle: taskSubtitle } = useMemo(() => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const isToday = selectedDate.toDateString() === today.toDateString();
    const isTomorrow = selectedDate.toDateString() === tomorrow.toDateString();

    // Format date for subtitle
    const dateStr = selectedDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });

    // One title, always: the date beside it says which day (with a quiet
    // "Today" / "Tomorrow" prefix when it applies).
    if (isToday) return { title: 'TO-DO List', subtitle: `Today · ${dateStr}` };
    if (isTomorrow) return { title: 'TO-DO List', subtitle: `Tomorrow · ${dateStr}` };
    return { title: 'TO-DO List', subtitle: dateStr };
  }, [selectedDate]);

  // The header at rest: the SAME line the finder shows, with the day spelled
  // the long way. The two used to be different shapes in the same place — a
  // 26 pt title over a subtitle, swapping for a small-caps destination line —
  // so opening the finder re-set the header in another typeface. One
  // composition means the swap only changes the words.
  const headerWhere = useMemo(() => finderDestination({
    dateLabel: taskSubtitle,
    board: selectedProject,
  }), [taskSubtitle, selectedProject]);

  // The board is ALWAYS on its own line now, under the header — quieter and
  // thinner than the line above it, because which list this is and which day
  // it shows is the header; the board is the scope it was filtered to.
  //
  // This used to be measured: the board sat inline and dropped below only when
  // it truncated ("AMB Archi…"), which took a text-layout callback and a
  // once-per-line latch to keep from oscillating. A header bigger than the 15
  // it was cannot hold three facts on one line anyway, so the decision is no
  // longer a decision and the measuring is gone.
  //
  // What shares that line with the board is the SHAPE OF THE DAY: how many
  // tasks it holds and how much of it is done. Deliberately NOT the timed
  // count or the hours (the strip under the week row says "3 timed · 3h") or
  // the backlog (the Pending section carries its own count) — a subtitle that
  // repeats what is already two rows below it is noise dressed as detail. This
  // pair is the one thing the panel does not say anywhere else: the day's
  // total includes its UNTIMED tasks, which the timed count by definition does
  // not.
  const headerFacts = useMemo(
    () => dayFacts(selectedDateTasks.length, dayOpenTasks.length),
    [selectedDateTasks, dayOpenTasks],
  );

  // Where a new task would land right now — the line that replaces the header
  // while the finder is open. Bare date, no "Today ·" prefix: the header can
  // afford that, one line carrying three facts over a keyboard cannot.
  const finderWhere = useMemo(() => finderDestination({
    dateLabel: selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    board: selectedProject,
  }), [selectedDate, selectedProject]);

  // The finder's "Full form": hand the day to the create form (events,
  // birthdays, every field) and close the finder.
  /**
   * "Full form" carries the work already done in the finder.
   *
   * Whatever has been typed, and the time chip if one was set, go with it —
   * the full form is meant to be the SAME task with more fields, not a blank
   * one. (This used to clear both and hand over only the date, so anyone who
   * typed a title and then wanted a board or a note retyped it.) The finder is
   * cleared after the values are read, not before.
   */
  /**
   * Close the finder, THEN hand off to whatever it was a doorway to.
   *
   * The finder is a native Modal, and so is everything it opens (the full
   * form, a task's card). Closing one and opening the other in the same commit
   * asks the platform to dismiss and present in a single pass — the nested-
   * sibling-Modal case this codebase routes around everywhere else. What it
   * leaves behind is the symptom rather than a crash: the finder is gone from
   * the screen, the destination never arrives, and the schedule underneath is
   * fully drawn and entirely untappable.
   *
   * One frame is all it takes to make them two separate transitions.
   */
  const handoffRef = useRef(null);
  useEffect(() => () => {
    if (handoffRef.current) cancelAnimationFrame(handoffRef.current);
  }, []);
  const closeFinderThen = useCallback((next) => {
    setIsAddingTask(false);
    setNewTaskTitle('');
    setPendingTime(null);
    if (handoffRef.current) cancelAnimationFrame(handoffRef.current);
    handoffRef.current = requestAnimationFrame(() => {
      handoffRef.current = null;
      next();
    });
  }, []);

  const openFullCreate = useCallback(() => {
    const title = newTaskTitle.trim();
    const time = pendingTime;
    const dateStr = toDateString(selectedDateRef.current);
    closeFinderThen(() => onCreateForDate?.(dateStr, { title, time }));
  }, [closeFinderThen, onCreateForDate, newTaskTitle, pendingTime]);

  const handleCancelAdd = useCallback(() => {
    // Swallow the single blur-cancel caused by opening the wheel time picker —
    // the add row must stay alive (and keep its pending time) while the user
    // is choosing a time.
    if (skipBlurCancelRef.current) {
      skipBlurCancelRef.current = false;
      return;
    }
    setNewTaskTitle('');
    setIsAddingTask(false);
    // Clear any long-press-derived time slot so the next manual
    // "Add a new task" tap doesn't accidentally inherit it.
    setPendingTime(null);
  }, []);

  // General task lookup. Matches title + description across the whole
  // library (respecting the active project/tag filters) so the user can
  // find any task and see when it's due. Sorted soonest-due first
  // (undated last); tapping a result opens the task.
  const searchResults = useMemo(() => {
    const query = newTaskTitle.trim().toLowerCase();
    if (!query) return [];

    return filteredTasks
      .filter(task => {
        const titleMatch = task.title?.toLowerCase().includes(query);
        const descMatch  = task.description?.toLowerCase().includes(query);
        return titleMatch || descMatch;
      })
      .sort((a, b) => {
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        if (a.dueDate) return -1; // dated tasks before undated
        if (b.dueDate) return 1;
        return 0;
      })
      .slice(0, 25);
  }, [newTaskTitle, filteredTasks]);

  // Open a search result for viewing/editing (where the due date can
  // also be changed). Replaces the old tap-to-reassign behaviour so the
  // search reads as a lookup, not a scheduling shortcut.
  const handleOpenSearchResult = useCallback((task) => {
    // Same handoff rule as "Full form": the card is a sibling Modal, so the
    // finder has to be gone before it is asked to present. See closeFinderThen.
    closeFinderThen(() => onTaskPress?.(task));
  }, [closeFinderThen, onTaskPress]);

  // Render one day page of the horizontal pager. The active page (its date
  // === selectedDate) wires up the live add-task / search inputs; neighbours
  // render inert placeholders so we never mount duplicate auto-focused fields.
  const renderDayItem = useCallback(({ item: date }) => (
    <DayPane
      date={date}
      isActive={toDateString(date) === selectedStr}
      tasks={tasks}
      getDayTasks={getDayTasks}
      todayStr={todayStr}
      multiUser={multiUser}
      theme={sheetTheme}
      styles={sheetStyles}
      use24h={use24h}
      nowMinutes={nowMinutes}
      pendingTasks={pendingTasks}
      untimedCollapsed={untimedCollapsed}
      onToggleUntimedCollapsed={toggleUntimedCollapsed}
      scheduleCollapsed={scheduleCollapsed}
      onToggleScheduleCollapsed={toggleScheduleCollapsed}
      onTaskPress={onTaskPress}
      onTaskInspect={openInspector}
      onTaskLongPress={onTaskLongPress}
      onToggleComplete={onToggleComplete}
      onUpdateTask={onUpdateTask}
      onEditTaskTime={openTaskTimeEditor}
      onOwnerPress={onOwnerPress}
      onOpenAddTaskAt={openAddTaskAt}
      isAddingTask={isAddingTask}
      newTaskTitle={newTaskTitle}
      onChangeNewTaskTitle={setNewTaskTitle}
      onSubmitAddTask={handleAddTask}
      onCancelAdd={handleCancelAdd}
      pendingTime={pendingTime}
      onClearPendingTime={clearPendingTime}
      onEditPendingTime={openTimeEditor}
      onOpenAddTask={openAddTask}
      onPickSuggestion={handlePickSuggestion}
      onOpenFullCreate={openFullCreate}
      isSearching={isSearching}
      searchQuery={searchQuery}
      onChangeSearchQuery={setSearchQuery}
      onOpenSearch={openSearch}
      onCloseSearch={closeSearch}
      searchResults={searchResults}
      onOpenSearchResult={handleOpenSearchResult}
      refreshing={refreshing}
      onRefresh={onRefresh}
      keyboardHeight={keyboardHeight}
      onStartPomodoro={onStartPomodoro}
      onOpenPomodoro={onOpenPomodoro}
      memberOf={memberOf}
      onPeoplePress={onPeoplePress}
      pomodoroFor={pomodoroFor}
    />
  ), [
    selectedStr, tasks, getDayTasks, todayStr,
    multiUser, sheetTheme, sheetStyles, use24h, nowMinutes, pendingTasks, untimedCollapsed,
    toggleUntimedCollapsed, scheduleCollapsed, toggleScheduleCollapsed,
    onTaskPress, openInspector, onTaskLongPress, onToggleComplete, onStartPomodoro, onOpenPomodoro, onUpdateTask, openTaskTimeEditor,
    onOwnerPress, memberOf, onPeoplePress, pomodoroFor, openAddTaskAt,
    isAddingTask, newTaskTitle, handleAddTask, handleCancelAdd, pendingTime, clearPendingTime,
    openTimeEditor,
    openAddTask, handlePickSuggestion, openFullCreate, isSearching, searchQuery, openSearch, closeSearch, searchResults,
    handleOpenSearchResult, refreshing, onRefresh, keyboardHeight,
  ]);

  return (
    <View
      style={styles.container}
      onLayout={(e) => { containerH.value = e.nativeEvent.layout.height; }}
    >
      {/* No collapsible top header — the month/year title now lives
          inside each calendar page (left-aligned, web-app styled).
          Collapse/expand of the calendar is driven by dragging (or
          tapping) the day-tasks sheet header below. */}

      {/* Calendar Content — always mounted behind the sheet. It fades
          out as the sheet rises to cover it (calendarStyle) so nothing
          shows through the sheet's rounded top corners at full travel. */}
      <Reanimated.View
        style={[styles.calendarContent, calendarStyle]}
        onLayout={(e) => setCalAreaH(e.nativeEvent.layout.height)}
      >
          {/* Minimal chrome — the whole collapsible top header, the
              chevron-left/right row, and the standalone Today button
              are all gone. Navigation is purely swipe-driven via the
              FlatList below; the Today shortcut floats inline with
              each month's title. Collapse/expand of the calendar is
              driven by the task panel header beneath it.

              The day-of-week labels (Sun…Sat) now render INSIDE each
              FlatList page (between the title and the grid) rather
              than as a static row above. That lets each month carry
              its own hairline divider between title and labels for a
              cleaner per-page visual. */}

          {/* Vertical month FlatList — replaces the old horizontal
              PanResponder rail. Native scroll = no JS/native race for
              the scroll offset, which was the source of the visible
              stutter when committing a snap. `snapToInterval` paginates
              to month boundaries; `onMomentumScrollEnd` writes the
              landed month back into React state. */}
          <FlatList
            ref={flatListRef}
            data={MONTHS_LIST}
            keyExtractor={keyExtractor}
            renderItem={renderMonth}
            getItemLayout={getItemLayout}
            initialScrollIndex={currentMonthIndex}
            onScrollToIndexFailed={onScrollToIndexFailed}
            onMomentumScrollEnd={onMomentumScrollEnd}
            // Signals FlatList that visible cells should re-render when
            // selectedDate changes — otherwise the "selected" highlight can
            // lag behind taps until the user scrolls. (No longer keyed on the
            // active month: every page paints its own title now, so it never
            // needs a re-render to appear/disappear.)
            extraData={+selectedDate}
            // Scroll style (setting). Paged (default): snap one whole month per
            // swipe via snapToInterval + fast deceleration. Free-form: drop the
            // snap so months flow continuously past the viewport like iOS
            // Calendar. onMomentumScrollEnd still derives the landed month in
            // both modes, so the header/state stays correct either way.
            snapToInterval={calendarFreeScroll ? undefined : monthH}
            snapToAlignment="start"
            decelerationRate={calendarFreeScroll ? 'normal' : 'fast'}
            showsVerticalScrollIndicator={false}
            // Each page is a full viewport, so windowSize (in viewport
            // units) ≈ months kept mounted. 13 = ~6 months above + below
            // the visible page, so a FAST scroll lands on already-rendered
            // months instead of blank pages. maxToRenderPerBatch +
            // updateCellsBatchingPeriod fill that window in fast while the
            // finger is still moving; getItemLayout means none of it needs
            // measuring. Each mounted page paints its own title, so headers
            // are populated across this whole window with no pop-in.
            windowSize={13}
            maxToRenderPerBatch={6}
            updateCellsBatchingPeriod={30}
            initialNumToRender={3}
            removeClippedSubviews
            style={{ height: monthH, marginTop: monthTopInset, marginBottom: peekReserve }}
          />

          {/* Top-edge fade over the empty margin above the month.
              White on the light page, near-black on the dark one: it's
              theme.colors.background either way, so the one gradient covers
              both modes.

              The shape is doing two things that pull against each other, and
              topFadeStops is where the arithmetic lives (with its own tests).

              CLEAR at the top: it used to open at full page colour flush under
              the header, which put a solid block across the strip — the page's
              backdrop died at the header instead of reaching it.

              FULL page colour ON the month list's top edge: that edge is a hard
              overflow clip, and a wash that has not reached full strength by
              the time it gets there does not hide a clip, it just tints one.
              That is what left "September 2026" sliced through the middle of
              its glyphs when the list was scrolled. Then it lets go again over
              TOP_FADE_FEATHER, which is what makes the cut read as a dissolve.

              So: clear, ramp, opaque exactly on the cut, gone a few points
              later — above the title's text, never across it. */}
          {monthTopInset > 0 && (
            <LinearGradient
              pointerEvents="none"
              colors={topFade.alphas.map((a) => hexToRgba(theme.colors.background, a))}
              locations={topFade.locations}
              style={[styles.topFade, { height: monthTopInset + TOP_FADE_FEATHER }]}
            />
          )}

          {/* There used to be a SECOND, deeper gradient here that faded in
              while the month list was moving (the iOS Calendar "weeks dissolve
              at the top edge" behaviour). It reached 34pt further down than the
              resting one, so every swipe washed the whole top of the grid out
              and then took it away again — a band appearing and disappearing on
              each move. The resting fade above is the only one now. */}

          {/* Faint animated swipe-hint carets — up = previous month, down = next
              month. pointerEvents none so they never intercept a tap/scroll; they
              fade with the calendar as the sheet rises (inside calendarStyle's
              fade). NO backdrop: the chevrons sit fully TRANSPARENT over the grid
              so they read as a light hint, never a solid overlay band. They live
              inside CalendarView, so they only ever show on the calendar page —
              never on the Upcoming list tab. */}
          <Reanimated.View pointerEvents="none" style={[styles.swipeHintTop, hintTopStyle]}>
            <Icon name="chevron-up" size={28} color={theme.colors.textSecondary} />
          </Reanimated.View>
          <Reanimated.View pointerEvents="none" style={[styles.swipeHintBottom, { bottom: peekReserve + 2 }, hintBottomStyle]}>
            <Icon name="chevron-down" size={28} color={theme.colors.textSecondary} />
          </Reanimated.View>

          {/* Jump-to-today button — pinned under the grid (just above the sheet
              peek), bottom-right so it clears the centred swipe-hint caret. Only
              shown when the calendar has drifted off today (a different month is
              on screen OR a non-today day is selected); tapping snaps the month
              list to today AND re-selects today. Redundant with the inline pill
              in each month header, but always in the same fixed spot. */}
          {(currentMonthIndex !== monthIndexOf(new Date()) || selectedStr !== todayStr) && (
            <TouchableOpacity
              // Lifted clear of the floating tab bar — pinned, so it can't be
              // scrolled out from under it.
              style={[styles.todayJumpBtn, { bottom: peekReserve + 8 }]}
              onPressIn={() => tapHaptic()}
              onPress={goToToday}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Jump to today"
            >
              <Icon name="calendar-today" size={15} color={theme.colors.accentSuccess} />
              <Text style={styles.todayJumpText}>Today</Text>
            </TouchableOpacity>
          )}
      </Reanimated.View>

      {/* Selected Date Tasks — a draggable bottom sheet. Always full
          height, absolutely positioned; sheetStyle slides it between
          docked (only the header peeks) and raised (covers the
          calendar). The header is wrapped in a Pan GestureDetector so
          it can be dragged up/down by the finger; a plain tap still
          toggles via the TouchableOpacity onPress. */}
      <Reanimated.View style={[sheetStyles.sheet, sheetStyle, sheetShapeStyle]}>
        {/* The chat composer's frost, in dark grey: a transparent sheet whose
            surface is a BlurView + a translucent tint (sheetFrost), so the
            calendar behind reads softly through it. Sections inside stay
            transparent — this is the only surface the pane has.

            Nothing opaque is painted over it. The sheet used to cross-fade to a
            solid fill as it parked, which meant the frost was only ever visible
            in transit; it is glass the whole way up now. */}
        <BlurView pointerEvents="none" style={StyleSheet.absoluteFill} {...blurProps(sheetTheme)} intensity={SHEET_BLUR} />
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: sheetFrost(sheetTheme) }]} />
        {/* The sheen, over the tint and under everything else — see sheetSheen. */}
        <LinearGradient
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          {...sheetSheen(sheetTheme)}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
        />
        {/* Only the header is the docked "peek" (its measured height drives the
            sheet travel). The week strip lives BELOW it, so it's off-screen
            when docked and slides into view only as the sheet is brought up. */}
        <GestureDetector gesture={headerPan}>
        <TouchableOpacity
          // ONE style, in both states. The docked variant used to drop the
          // bottom hairline, which is half a point of HEIGHT — it re-fired this
          // onLayout mid-spring, changed headerH, and so changed the very travel
          // the spring was animating against. The lift shadow is simply always
          // on: raised, it falls off the top of the sheet where nothing can see
          // it anyway.
          style={sheetStyles.taskListHeader}
          onPress={toggleExpand}
          activeOpacity={1}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            headerH.value = h;
            // Also drives the calendar's bottom reserve. Thresholded: this fires
            // again on any re-layout, and a state write per sub-pixel wobble
            // would re-run the month-size memo (and with it every mounted page).
            setSheetHeaderH((prev) => (Math.abs(prev - h) >= 1 ? Math.round(h) : prev));
          }}
        >
          <Reanimated.View pointerEvents="none" style={[sheetStyles.taskListHeaderRule, headerRuleStyle]} />
          {/* Grab handle — a little pill that reads as "drag me". Centered via a
              full-width wrapper (alignItems) so padding/layout can't offset it. */}
          <View style={sheetStyles.grabHandleWrap} pointerEvents="none">
            <View style={sheetStyles.grabHandle} />
          </View>
          <View style={sheetStyles.taskListHeaderContent}>
            {isAddingTask ? (
              /* Searching: the title block stands down and this one line takes
                 its place, which is what lifts the field up the panel — the
                 same move the media vault's board search makes. It is also the
                 only thing on screen saying where Return will put the task:
                 the day and the board are both decided elsewhere and both
                 scroll away once the results are up. */
              <Text
                style={[sheetStyles.finderDestination, sheetStyles.finderDestinationCompact]}
                numberOfLines={1}
                accessibilityLabel={`New task destination: ${finderWhere.speech}`}
                testID="day-finder-destination"
              >
                <Text style={sheetStyles.finderDestinationKind}>{finderWhere.kind}</Text>
                <Text style={sheetStyles.finderDestinationSep}>{KIND_SEP}</Text>
                {finderWhere.day}
                <Text style={sheetStyles.finderDestinationSep}>{FIELD_SEP}</Text>
                <Text style={finderWhere.filed ? sheetStyles.finderDestinationBoard : null}>
                  {finderWhere.board}
                </Text>
              </Text>
            ) : (
              /* Same line, same style as the finder's — see headerWhere, with
                 the board and the day's figures on a second line under it. ONE
                 accessibility label for the whole block, facts included: two
                 lines of header are one thing to a screen reader, not three. */
              <View
                accessibilityRole="header"
                accessibilityLabel={[headerWhere.speech, ...headerFacts].join(', ')}
              >
                <Text
                  style={sheetStyles.finderDestination}
                  numberOfLines={1}
                  accessible={false}
                  testID="day-header-destination"
                >
                  <Text style={sheetStyles.finderDestinationKind}>{headerWhere.kind}</Text>
                  <Text style={sheetStyles.finderDestinationSep}>{KIND_SEP}</Text>
                  {headerWhere.day}
                </Text>
                <Text
                  style={sheetStyles.headerBoardSubtitle}
                  numberOfLines={1}
                  accessible={false}
                  testID="day-header-board"
                >
                  {/* A REAL board is a fact worth reading; "All" is the
                      absence of one, so it stays a shade quieter. */}
                  <Text style={headerWhere.filed ? null : sheetStyles.headerBoardSubtitleAll}>
                    {headerWhere.board}
                  </Text>
                  {headerFacts.map((fact) => (
                    <Text key={fact}>
                      <Text style={sheetStyles.headerFactSep}>{FIELD_SEP}</Text>
                      <Text style={sheetStyles.headerFact}>{fact}</Text>
                    </Text>
                  ))}
                </Text>
              </View>
            )}
          </View>
          <View style={sheetStyles.taskListHeaderRight}>
            {/* ONE key: opens the finder — a single field that searches every
                task and creates one when nothing matches (its create row
                carries a "Full form" key for events, birthdays and every
                other field). × while open. */}
            <TouchableOpacity
              style={sheetStyles.headerAddBtn}
              onPressIn={() => tapHaptic()}
              onPress={(e) => { e.stopPropagation(); if (isAddingTask) handleCancelAdd(); else openAddTask(); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ expanded: isAddingTask }}
              accessibilityLabel={isAddingTask ? 'Close' : 'Search or add a task'}
              testID="day-finder-key"
            >
              <Icon name={isAddingTask ? 'close' : 'plus'} size={27} color={sheetTheme.colors.background} />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
        </GestureDetector>

        {/* Week strip — the 7 days of the selected day's week, active day
            highlighted. Sits ABOVE the sliding planner so it stays fixed while
            the hourly breakdown below slides day-to-day. Tap a day to jump
            (with the same slide as a swipe). */}
        <View
          style={sheetStyles.weekStrip}
          onLayout={(e) => setStripW(e.nativeEvent.layout.width)}
        >
          {/* Fixed centre highlight pill (painted first, BEHIND the cells). The
              cell row slides under it; each cell's text cross-fades to the
              on-pill ink as it passes under the pill, so it reads as one motion. */}
          <Animated.View
            pointerEvents="none"
            style={[
              sheetStyles.weekPill,
              { top: pillTop, height: pillH, width: PILL_W, left: pillLeft },
            ]}
          />
          {/* Horizontally-sliding TRACK of day cells. Each cell is absolutely
              positioned at its OWN day index, so only this track's native
              translateX moves; re-windowing never shifts a visible cell. The day
              pager drives the translate 1:1, so weeks flow past the fixed pill
              continuously. overflow:hidden on weekStrip clips the off-screen cells. */}
          <Animated.View
            style={[sheetStyles.weekTrack, { transform: [{ translateX: trackTranslateX }] }]}
          >
            {windowDays.map(({ idx, date: d }) => {
              const key = toDateString(d);
              return (
                <WeekStripCell
                  key={key}
                  idx={idx}
                  date={d}
                  cellW={cellW}
                  pillW={PILL_W}
                  isActive={key === selectedStr}
                  isToday={key === todayStr}
                  dayScrollX={dayScrollX}
                  styles={sheetStyles}
                  onPress={goToDate}
                  onPillSlotLayout={idx === stripCenterIndex ? measurePillSlot : undefined}
                />
              );
            })}
          </Animated.View>
        </View>

        {/* Horizontal day pager — one native paged page per calendar day.
            Neighbouring days render just off-screen so a swipe tracks the
            finger and snaps with native momentum, exactly like the iOS
            Calendar day view. Each page (DayPane) is its own vertical
            timetable ScrollView.

            This horizontal day pager lives inside the horizontal calendar⇄list
            pager (an Animated.ScrollView in TasksScreen) — same orientation, which
            RN flags with "VirtualizedLists should never be nested inside plain
            ScrollViews…". RN keys that warning off ScrollView.Context + matching
            orientation, so the real silencer is nulling ScrollView.Context for this
            subtree (`ScrollView.Context.Provider value={null}`). VirtualizedList-
            ContextResetter alone does NOT stop it — it resets a DIFFERENT context
            (VirtualizedListContext), so it's kept only for nested-scroll decoupling.
            The day pager owns its own paging, so dropping the outer scroll context
            is safe. */}
        <VirtualizedListContextResetter>
        <ScrollView.Context.Provider value={null}>
        <Animated.FlatList
          ref={dayListRef}
          data={DAYS_LIST}
          keyExtractor={dayKeyExtractor}
          renderItem={renderDayItem}
          getItemLayout={getDayItemLayout}
          initialScrollIndex={initialDayIndexRef.current}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onDayScrollEnd}
          // Drive the week-strip pill natively from the live scroll offset so
          // it tracks the finger 1:1 (matches the photo-vault tab indicator).
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: dayScrollX } } }],
            { useNativeDriver: true },
          )}
          scrollEventThrottle={16}
          // Keep a thin live window (current ± neighbours) so the swipe finds
          // its neighbours already laid out while memory stays bounded.
          windowSize={3}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          extraData={renderDayItem}
          style={sheetStyles.taskList}
        />
        </ScrollView.Context.Provider>
        </VirtualizedListContextResetter>
      </Reanimated.View>

      {/* The finder's own wheel is NOT here — it is handed to the panel and
          mounted inside its Modal (see the `overlays` prop below). Left as a
          sibling it drew underneath the panel, so the clock key looked dead.

          The same wheel for an EXISTING row — opened by tapping its time
          column. "Clear time" hands back null, which drops the task into the
          day's To-Do list rather than off the day. */}
      <WheelTimePicker
        visible={!!timeEditTarget}
        initialTime={timeEditTarget?.task?.time || null}
        onSelect={commitTaskTime}
        onClose={closeTaskTimeEditor}
      />

      {/* The finder, as a full panel. Mounted HERE — at the calendar's root,
          not inside a day pane — for two reasons: a pane is one page of a
          horizontal pager (three of them mounted at once), and the panel needs
          the whole screen rather than the room left inside a sheet. */}
      <TaskFinderOverlay
        visible={isAddingTask}
        theme={theme}
        topInset={insets.top}
        keyboardHeight={keyboardHeight}
        destination={finderWhere}
        value={newTaskTitle}
        onChangeText={setNewTaskTitle}
        onSubmit={handleAddTask}
        onCancel={handleCancelAdd}
        placeholder={pendingTime ? `New task at ${formatTimeLabel(pendingTime, use24h)}` : 'Search or add a task…'}
        timeLabel={pendingTime ? formatTimeLabel(pendingTime, use24h) : null}
        onEditTime={() => setEditingTime(true)}
        onClearTime={clearPendingTime}
        // Inside the panel's Modal, so it draws OVER it.
        overlays={(
          <WheelTimePicker
            visible={editingTime}
            initialTime={pendingTime}
            onSelect={setPendingTime}
            onClose={() => setEditingTime(false)}
          />
        )}
        showCreate={
          newTaskTitle.trim().length > 0
          && !searchResults.some((r) => (r.title || '').trim().toLowerCase() === newTaskTitle.trim().toLowerCase())
        }
        createCaption={`Create · ${finderWhere.day}${finderWhere.filed ? ` · ${finderWhere.board}` : ''}${pendingTime ? ` · ${formatTimeLabel(pendingTime, use24h)}` : ''}`}
        onOpenFullForm={openFullCreate}
        results={searchResults}
        resultsCaption={`${searchResults.length} matching · tap to open · + re-adds here`}
        // Before a single character is typed the panel is not blank: it opens
        // ON the day it would create into. Half of what the finder gets used
        // for is "is this already on today?", and that used to need the panel
        // closed again to answer. Open only — a day's DONE tasks are not what
        // you are checking against before adding another.
        idleResults={dayOpenTasks}
        idleCaption={
          dayOpenTasks.length
            ? `${dayOpenTasks.length} open · ${finderWhere.day} · tap to open · + re-adds here`
            : ''
        }
        idleEmptyHint={`Nothing open on ${finderWhere.day}. Type to search every task — or to name a new one.`}
        renderResult={(task) => {
          const overdue = !task.completed && isOverdue(task.dueDate);
          return (
            <View key={task.id} style={styles.searchResultItem}>
              <TouchableOpacity
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
                onPress={() => handleOpenSearchResult(task)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Open ${task.title}`}
              >
                <Icon
                  name={task.completed ? 'check-circle' : (task.dueDate ? 'calendar' : 'calendar-blank-outline')}
                  size={16}
                  color={task.completed ? theme.colors.accentSuccess : (overdue ? theme.colors.accentError : theme.colors.textTertiary)}
                  style={styles.resultIcon}
                />
                <View style={styles.resultContent}>
                  <Text style={[styles.resultTitle, task.completed && styles.taskTitleCompleted]} numberOfLines={1}>{task.title}</Text>
                  <Text style={[styles.resultMeta, overdue && { color: theme.colors.accentError }]} numberOfLines={1}>
                    {[task.project ? boardLabel(task.project) : null, task.dueDate ? `Due ${formatDueDate(task.dueDate)}${task.time ? ` · ${formatTimeLabel(task.time, use24h)}` : ''}` : 'No due date'].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                onPressIn={() => tapHaptic()}
                onPress={() => handlePickSuggestion(task)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Re-add ${task.title} on this day`}
                style={styles.finderReadd}
              >
                <Icon name="plus" size={18} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
          );
        }}
      />
    </View>
  );
};

const createStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    // Intentionally transparent so the parent TasksScreen's
    // LinearGradient backdrop can wash through behind the calendar.
    // The task panel below still has its own opaque surface — only
    // the calendar pane sits over the gradient.
    backgroundColor: 'transparent',
    position: 'relative',
  },
  
  // The collapsible top header has been removed; collapse/expand is
  // now driven entirely by the task panel header below.
  //
  // calendarContent now flex-fills the screen above the (absolutely-
  // positioned) task panel header. justifyContent
  // 'center' vertically centres the title + days row + month grid as
  // a group — so on a tall phone the calendar sits nicely centred
  // with breathing room above and below instead of being top-piled.
  calendarContent: {
    flex: 1,
    // The month grid grows to fill this area (via `cellH`) up to a cap, and
    // whatever is left over is split above and below it (`monthTopInset`) so
    // the month sits centred rather than piled at the top. The top/bottom
    // strips are reserved by the FlatList's own margins (not padding here) so
    // the absolute caret hints keep a stable top/bottom origin regardless of
    // Yoga's padding-vs-absolute behaviour.
    overflow: 'hidden',
  },
  // The fade over the top margin. zIndex 4 puts it above the month list and
  // below the swipe-hint caret (5), so the chevron reads ON the fade rather
  // than through it.
  topFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 4,
  },
  // Faint swipe-hint carets, centred horizontally at the top/bottom
  // edges of the calendar viewport. The bottom one sits just above the
  // reserved sheet-peek strip. Opacity/translate are animated inline.
  // Fixed height so the gradient backdrop has room to dissolve over a few
  // pixels; the chevron is anchored to the screen edge (the strong end of
  // the fade) and overflow is clipped so the gradient never bleeds past.
  swipeHintTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 52,
    alignItems: 'center',
    justifyContent: 'flex-start',
    overflow: 'hidden',
    zIndex: 5,
  },
  swipeHintBottom: {
    position: 'absolute',
    bottom: SHEET_PEEK_RESERVE + 2,
    left: 0,
    right: 0,
    height: 52,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
    zIndex: 5,
  },
  
  // Per-month title block — fixed height = MONTH_TITLE_HEIGHT so
  // every FlatList page is exactly MONTH_HEIGHT tall (`snapToInterval`
  // snaps to clean month boundaries). Left-aligned with the same
  // horizontal indent as the grid below, with the Today shortcut
  // floated to the right rail. A hairline divider sits at the bottom
  // edge — the thin, faint line separating the title from the
  // day-of-week labels below. `hairlineWidth` is the platform's
  // thinnest renderable line (0.5pt on most devices) and the alpha
  // keeps it deliberately faint so it reads as a structural cue, not
  // a hard rule.
  monthYear: {
    height: MONTH_TITLE_HEIGHT,
    paddingHorizontal: CALENDAR_HORIZONTAL_PADDING,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  // Inline row that holds the month name + year on a shared baseline.
  // Mirrors the web app's `<span>{monthName}</span><span>{year}</span>`
  // pattern — bold/heavy month sat against a whisper-thin year.
  monthTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    // Tight-but-readable gap between the two words. Web app uses 10px.
    columnGap: 8,
  },
  monthText: {
    fontSize: 26,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    letterSpacing: 0.2,
  },
  yearText: {
    fontSize: 26,
    // RN's '100' renders inconsistently — '200' is reliably thin
    // across iOS / Android and matches the web app's hair-thin feel.
    fontWeight: '200',
    color: theme.colors.textSecondary,
    letterSpacing: -0.6,
  },
  // Jump-to-today button pinned under the grid, above the sheet peek. A solid
  // rounded pill so it reads as a tappable action (vs. the faint caret hints).
  // Bottom-right keeps it clear of the centred down-caret. zIndex over the grid.
  todayJumpBtn: {
    position: 'absolute',
    right: CALENDAR_HORIZONTAL_PADDING,
    bottom: SHEET_PEEK_RESERVE + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    // Lift the pill off the grid so it reads as floating chrome.
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    zIndex: 6,
  },
  todayJumpText: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.accentSuccess,
  },
  // Day-of-week labels — lives inside each FlatList page now (below
  // the title block's hairline divider, above the grid). Fixed height
  // keeps every page exactly MONTH_HEIGHT tall for clean snapping. No
  // own border — the divider on monthYear above does that job.
  daysHeader: {
    height: DAYS_HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    // Full-bleed: no L/R indent so the 7 weekday labels line up with the
    // edge-to-edge day cells below (no margin beside Sun / Sat).
    paddingHorizontal: 0,
  },
  dayHeaderCell: {
    // Same CAL_COL_WIDTH as the day cells — flex:1 distributed leftover pixels
    // differently than the grid, drifting labels off their columns at full
    // bleed. Shared width = labels sit dead-centre over each day.
    width: CAL_COL_WIDTH,
    alignItems: 'center',
  },
  dayHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.colors.textTertiary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  // One FlatList page = one month. Fixed at MONTH_HEIGHT (computed
  // from DAY_WIDTH + title + paddingTop) so every page snaps the same
  // way regardless of how many actual days the month has — short
  // months get trailing empty cells (see buildCalendarDataFor's pad).
  monthPage: {
    width,
    height: MONTH_HEIGHT,
  },
  // Calendar cell grid — picks up the calendar's shared left/right
  // indent so cells line up vertically with the day labels above.
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // Full-bleed grid: each of the 7 columns is 100/7 % of the FULL screen
    // width, so days span edge-to-edge with no overall L/R margin.
    paddingHorizontal: 0,
    paddingTop: GRID_PADDING_TOP,
  },
  // Empty cells (leading + trailing pad) match the dayCell layout
  // footprint so rows stay aligned and every month occupies exactly
  // 6 rows of CELL_HEIGHT each. `width: 1/7 of the row` via flexBasis
  // so all 7 columns fill the available horizontal space evenly even
  // when CALENDAR_HORIZONTAL_PADDING changes.
  emptyCell: {
    width: CAL_COL_WIDTH,
    height: CELL_HEIGHT,
  },
  dayCell: {
    width: CAL_COL_WIDTH,
    height: CELL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    // Square (no radius) so the hairline grid segments read as a clean table.
    // The selected-day fill is a separate ROUNDED layer (daySelectedBackdrop),
    // not a background on this cell, so rounding it never curves the grid.
    // `position: relative` anchors that absolute backdrop to the cell.
    borderRadius: 0,
    position: 'relative',
  },
  // The day number sits in a fixed 30×30 box so every cell's number stays
  // aligned regardless of selection. Selection is shown by highlighting the
  // NUMBER itself (colour + weight), NOT a filled disc behind it.
  dayNumWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  // List mode: shrink the number box (the dots-mode default is a fixed 30×30,
  // which would eat half a small cell) so the three task pills below get room.
  // A short auto-width box with a hair of air beneath the number.
  dayNumWrapList: {
    width: 'auto',
    height: 16,
    borderRadius: 0,
    marginBottom: 1,
  },
  // Day numbers — hairthin weight matches the iOS Calendar /
  // reference-design aesthetic. RN's '100' renders inconsistently
  // across platforms ('100' often falls back to '400' on Android);
  // '200' is the reliably-thin weight that still feels delicate.
  // tabular-nums keeps "11" and "10" the same horizontal width as
  // "1" and "0" so columns stay aligned.
  dayText: {
    fontSize: theme.typography.body,
    // Monochrome numbering — pure black in light mode, pure white in dark.
    // Every non-selected day number (blank, has-tasks, today) reads in this
    // one ink; days are set apart by WEIGHT, not colour.
    color: theme.mode === 'dark' ? '#FFFFFF' : '#000000',
    fontWeight: '200',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.3,
  },
  // Days WITH activities — same neutral colour as a blank day, set apart only
  // by a normal weight. Sits between the hairthin `200` (empty days) and the
  // bold `700` (selected day) so an active day reads as "has something" without
  // shouting or pulling in a heat colour.
  dayTextHasTasks: {
    fontWeight: '400',
  },
  // Today (not selected) — monochrome BOLD number sitting over the orange hatch
  // backdrop (todayHatchBackdrop). No underline; the hatch is today's marker.
  todayText: {
    fontWeight: '700',
  },
  // Today (not selected) hatch layer — a clipped rounded rect that holds the
  // DiagonalHatch bars, same inset + radius as the selection backdrop so it
  // occupies the exact same footprint.
  todayHatchBackdrop: {
    position: 'absolute',
    top: 2,
    left: 2,
    right: 2,
    bottom: 2,
    borderRadius: 12,
    overflow: 'hidden',
  },
  // Selected number — bold, in the normal monochrome ink (black in light / white
  // in dark). The selection is a hatch over a faint tint, so the cell background
  // still shows through the gaps; the number contrasts with THAT, not the lines.
  selectedText: {
    color: theme.mode === 'dark' ? '#FFFFFF' : '#000000',
    fontWeight: '700',
  },
  // Selected + today — same bold ink over the orange hatch.
  todaySelectedText: {
    color: theme.mode === 'dark' ? '#FFFFFF' : '#000000',
    fontWeight: '700',
  },
  // Selection backdrop LAYER — a rounded rectangle that nearly fills the cell,
  // sitting behind the day number as its own absolute layer so the square
  // hairline grid is untouched. Inset a hair on every side so the curved corners
  // breathe against the grid instead of pinching into the line intersections;
  // radius 12 matches the week strip's rounded pill (borderRadius 14, scaled to
  // these slightly smaller cells).
  // Selection backdrop LAYER — a clipped, radiused rounded rectangle that holds
  // the dense DiagonalHatch bars (overflow:hidden clips them to the rounded
  // corners). Its own absolute layer so the square hairline grid is untouched;
  // inset a hair on every side so the curved corners breathe against the grid.
  daySelectedBackdrop: {
    position: 'absolute',
    top: 2,
    left: 2,
    right: 2,
    bottom: 2,
    borderRadius: 12,
    overflow: 'hidden',
  },
  // Base tint UNDER the hatch — a whisper of the accent so the hatched region
  // reads as a filled selection. ORANGE for today; neutral ink for other days.
  daySelectedToday: {
    backgroundColor: hexToRgba(WEEK_SELECT_BG, 0.12),
  },
  daySelectedOther: {
    backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  // List mode: top-align the cell so the day number sits at the top with the
  // task titles stacked beneath it (vs centered for the dots mode).
  dayCellList: {
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    paddingTop: 3,
    paddingHorizontal: 3,
    overflow: 'hidden', // clip the title list to the cell — never bleed into the next row
  },
  // List mode: a tighter, smaller day number than the dots-mode default so it
  // claims less of the cell — leaving vertical room for three task pills.
  dayTextList: {
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 15,
    marginBottom: 0,
  },
  dayTaskList: {
    alignSelf: 'stretch',
    gap: 1,
  },
  // iOS-style event pill: a soft tinted rounded chip per task. Slim vertical
  // padding + tight line-height so three chips stack inside a single day cell.
  dayTaskPill: {
    borderRadius: 3,
    paddingHorizontal: 3,
    paddingVertical: 0,
  },
  dayTaskItem: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '600',
  },
  dayTaskItemDone: {
    textDecorationLine: 'line-through',
    opacity: 0.55,
  },
  dayTaskMore: {
    fontSize: 8,
    lineHeight: 11,
    fontWeight: '700',
    color: theme.colors.textTertiary,
    paddingHorizontal: 3,
    marginTop: 1,
  },
  projectDots: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 2,
    position: 'absolute',
    bottom: 6,
  },
  projectDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  moreProjects: {
    fontSize: 8,
    fontWeight: 'bold',
    marginLeft: 1,
  },
  // The day-tasks bottom sheet. Absolutely positioned over the calendar;
  // `sheetStyle` translateY slides it between docked (only the header strip
  // visible at the bottom) and raised. overflow:hidden clips the body to the
  // rounded top corners.
  //
  // `top` is SHEET_RAISED_GAP, not 0: raised, the card stops that far below the
  // screen header instead of swallowing it, which is what leaves the view pill
  // and the Boards key reachable while you plan a day. sheetStyle takes the
  // same gap off the travel so the docked peek is unmoved.
  sheet: {
    position: 'absolute',
    top: SHEET_RAISED_GAP,
    left: 0,
    right: 0,
    bottom: 0,
    // Transparent: the frost (BlurView + tint, painted first inside) is the
    // surface, like the chat composer.
    backgroundColor: 'transparent',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    // TOP hairline only. Side borders would narrow the day pager's viewport
    // by 2 px while its pages stay SCREEN_W wide — pagingEnabled then snaps
    // 2 px short on every page and the error accumulates with the page
    // index (today is hundreds of pages in): the "offset after sliding to
    // the next day" bug.
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: frostBorderColor(theme),
    overflow: 'hidden',
  },
  // Drag-handle pill centred at the top of the sheet header — the affordance
  // that says "drag me up/down". Matches the add-task card's handle (44×5,
  // stronger ink) so the two sheets read as one design language.
  grabHandleWrap: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  grabHandle: {
    width: 44,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: theme.colors.borderStrong || theme.colors.border,
  },
  // The sheet's grab header. Matched to the add-task card's soft upward shadow
  // so the docked peek reads as the same floating card — and the shadow stays
  // on when the sheet is raised, where it has nothing above it to fall on.
  //
  // NO border, and nothing here varies with docked/raised: this view's measured
  // height IS the sheet's travel (headerH), so any style that changes with the
  // sheet's state changes the distance the sheet is in the middle of covering.
  // The line under the header when raised is drawn by taskListHeaderRule, an
  // absolute hairline that costs no layout.
  taskListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    // Extra top padding leaves room for the grab-handle pill above the
    // title; bottom stays 12 for a balanced strip.
    paddingTop: 18,
    paddingBottom: 12,
    backgroundColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 18,
  },
  // The hairline the header used to carry as a real border. Absolute, so it
  // paints without occupying any height (see taskListHeader).
  taskListHeaderRule: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
  },
  taskListHeaderContent: {
    flex: 1,
  },
  taskListHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // White "+" add button on the header's right edge — a CIRCLE with a solid
  // primary-ink fill and a background-coloured "+" cut-out. Proportioned to the
  // golden ratio: the 27px glyph sits in a 44px disc (44 / 27 ≈ 1.62 ≈ φ), so
  // the ring of negative space around the "+" reads balanced. marginRight pulls
  // it off the screen edge a touch.
  headerAddBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.textPrimary,
    marginLeft: 12,
    marginRight: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  calendarHint: {
    fontSize: 11,
    color: theme.colors.accentSuccess,
    marginTop: 2,
    fontStyle: 'italic',
  },
  calendarHintBlue: {
    color: '#64B5F6', // Light blue
  },
  // The panel's header, in BOTH states: at rest it says which day the list is
  // showing, and while the finder is open it says where a new task will land.
  // (The 26 / 700 title and its subtitle it replaced are gone — two shapes in
  // one place meant opening the finder re-set the header in another typeface.)
  // Quiet by design: the list under it is what the eye should land on.
  finderDestination: {
    // The panel's header, so it carries the size a header wants. 13 was right
    // while this was only the caption the finder put over a title; 15 was
    // right while it was still sharing the line with a board name. At rest it
    // is the biggest type on the panel — still a clear step up from the 15,
    // and the room it took from that line is what let the board drop below it.
    // (22 first, which was a header loud enough to compete with the day it was
    // naming; 18 is 0.8 of it.)
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 0.2,
    color: theme.colors.textSecondary,
    paddingVertical: 4,
  },
  // The FINDER's copy of that line stays at the old 15. It keeps all three
  // facts — kind, day, board — on ONE line, because it sits over a keyboard
  // with a field under it and has no second line to give: the header can
  // afford to be 22 and drop the board below, this cannot.
  finderDestinationCompact: {
    fontSize: 15,
  },
  // The kind, in the ink of a label rather than of content.
  finderDestinationKind: {
    color: theme.colors.textTertiary,
    letterSpacing: 0.8,
  },
  // The separators recede: they are punctuation between three facts, and at
  // full strength the pipe and the bullet read as loudly as the words.
  finderDestinationSep: {
    color: theme.colors.textTertiary,
    fontWeight: '400',
  },
  // The board and the day's figures, on their own line under the header. THIN
  // against the 18 pt line above it — the scope the list was filtered to and
  // the shape of the day, not a second header competing with the first — but
  // 15 rather than the 13 it started at: three facts at 13 under an 18 pt line
  // read as fine print. ('200' is the weight that renders reliably thin on
  // both iOS and Android — '100' falls back to regular on Android, see
  // `taskCount`.) Pulled up under the header's own bottom padding, so the two
  // lines read as one block rather than two rows.
  headerBoardSubtitle: {
    fontSize: 15,
    fontWeight: '200',
    letterSpacing: 0.3,
    color: theme.colors.textSecondary,
    marginTop: -4,
  },
  // A REAL board gets the ink of a fact; "All" stays quiet, because "all" is
  // the absence of a destination rather than one worth pointing at.
  headerBoardSubtitleAll: {
    color: theme.colors.textTertiary,
  },
  // The day's figures sit BEHIND the board they follow: the board is the scope
  // you chose, the counts are what that scope happens to hold today.
  headerFact: {
    color: theme.colors.textTertiary,
  },
  // Punctuation between facts, quieter still — at full strength a row of
  // bullets reads as loudly as the words between them.
  headerFactSep: {
    color: theme.colors.textTertiary,
    opacity: 0.55,
  },
  finderDestinationBoard: {
    color: theme.colors.textPrimary,
  },
  // "{N} Tasks" — hairline-thin weight ('200' renders reliably thin on both
  // iOS + Android, unlike '100' which falls back to regular on Android).
  taskCount: {
    fontSize: theme.typography.body,
    fontWeight: '200',
    color: theme.colors.textSecondary,
  },
  taskList: {
    flex: 1,
  },
  // Completed-task visuals — referenced by both the untimed strip
  // and the timed blocks in the hour grid below.
  taskItemCompleted: {
    opacity: 0.6,
  },
  taskTitleCompleted: {
    textDecorationLine: 'line-through',
    color: theme.colors.textTertiary,
  },

  // ── Hour-timetable view ─────────────────────────────────────
  // Untimed ("All Day") header strip — sits above the hour grid for
  // tasks that don't have a HH:MM start time.
  untimedSection: {
    paddingLeft: 8,
    paddingRight: 16,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: 'transparent',
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  // Tappable header row holding the "All Day" label, count, and the
  // collapse chevron. marginBottom carries the spacing that used to
  // live on untimedLabel (kept only when the strip is expanded — the
  // task rows below provide their own padding).
  // One page of the horizontal day pager — exactly one screen wide so
  // `pagingEnabled` snaps cleanly day-to-day. It stretches to the pager's
  // height (cross-axis), letting the inner timetable ScrollView (taskList,
  // flex:1) fill the sheet.
  dayPage: {
    width: SCREEN_W,
  },
  // ── Week strip ──────────────────────────────────────────────
  weekStrip: {
    flexDirection: 'row',
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingTop: 6,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  // The single sliding highlight — a TALL rounded square wrapping both the
  // weekday abbreviation and the date. Absolutely positioned + translated to
  // track the day pager; width/height/top come inline from measured geometry.
  weekPill: {
    position: 'absolute',
    left: 0,
    borderRadius: 14,
    backgroundColor: WEEK_SELECT_BG,
  },
  // The sliding track holding the day cells. A normal flow child (so it still
  // gives the strip its height) whose cells are absolutely positioned by day
  // index — re-windowing never moves them; only its translateX animates. Height
  // is the cell's fixed height (slot 54 + cell padding 8 = 62) since absolute
  // cells don't contribute layout height.
  weekTrack: {
    height: 62,
  },
  weekDayCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  // The per-cell column the pill sits over: abbreviation stacked above the
  // date, centred. Width is set inline (= PILL_W) so it lines up with the pill.
  weekPillSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: 14,
  },
  // Today (not selected) = a soft neutral fill of the same shape, behind the
  // text. Fades out as the orange pill slides over it.
  weekTodayPill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 14,
    backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.06)',
  },
  // Fixed-height rows so the absolutely-positioned on-pill text overlays the
  // resting text exactly (lineHeight === row height centres both).
  weekDowRow: {
    alignSelf: 'stretch',
    height: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  weekDow: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 15,
    color: theme.colors.textTertiary,
  },
  // On-pill abbreviation (dark ink, legible on the yellow-orange fill).
  weekDowOnPill: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    lineHeight: 15,
    color: WEEK_SELECT_FG,
    fontWeight: '700',
  },
  weekNumRow: {
    alignSelf: 'stretch',
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekDayNum: {
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 22,
    color: theme.colors.textPrimary,
  },
  // Dark-ink date drawn on top of the pill; absolutely fills the number row so
  // it sits exactly over the resting number and cross-fades in with the pill.
  weekDayNumOnPill: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    textAlign: 'center',
    lineHeight: 22,
    color: WEEK_SELECT_FG,
    fontWeight: '700',
  },
  // ── Events & Birthdays strip ────────────────────────────────
  occasionSection: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
    backgroundColor: 'transparent',
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  occasionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textTertiary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  occasionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: 8,
    borderLeftWidth: 3,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 6,
    ...depth(theme, 'card'),
  },
  occasionIcon: {
    marginRight: 10,
  },
  occasionTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  occasionTitle: {
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    fontWeight: '600',
  },
  occasionMeta: {
    fontSize: 11,
    color: theme.colors.textTertiary,
    marginTop: 1,
  },
  untimedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
    paddingLeft: 8,
  },
  untimedLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textTertiary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  // Count chip — sits just right of the label, pushing the chevron to
  // the far edge via marginRight: 'auto'.
  untimedCount: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textTertiary,
    marginLeft: 6,
    marginRight: 'auto',
  },
  // Round "add to today's To-Do" button sitting as the right accessory on a
  // Pending TimelineTaskRow card. Reads as a tappable control (bordered surface
  // disc) without competing with the card's title.
  addTodayBtn: {
    marginLeft: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    ...depth(theme, 'control'),
  },
  // Smaller priority chip used inside compact rows / blocks where the
  // larger priorityIndicator would crowd the title.
  priorityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginLeft: 8,
  },
  // Small round per-owner badge (initial on a hashed colour) — shown only on a
  // shared calendar (multiUser) so you can tell whose task a chip is at a glance.
  ownerBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginLeft: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
  },
  // ── Schedule toolbar + collapsed (compact) schedule ─────────
  scheduleToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
    backgroundColor: 'transparent',
  },
  scheduleToolbarTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textTertiary,
    letterSpacing: 0.3,
  },
  scheduleToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: theme.colors.surfaceElevated,
    ...depth(theme, 'control'),
  },
  scheduleToggleLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  // The schedule's own box. NO left padding and 8 on the right, because the
  // gutter's x is measured from this edge (hourLabel starts at 0, the cards
  // stop 8 short of the other side) — a pad here would step the rule sideways.
  // No overflow:hidden: the box no longer clips anything (each gap clips its
  // own hours), and clipping here took the cards' shadows with it.
  scheduleBody: {
    backgroundColor: 'transparent',
    paddingLeft: 0,
    paddingRight: 8,
    paddingTop: 4,
    paddingBottom: 24,
  },
  // The empty-day hint, above the schedule. One line, tight padding: it sits
  // between the toolbar and the day's first row.
  timelineEmpty: {
    fontSize: 13,
    color: theme.colors.textTertiary,
    textAlign: 'center',
    paddingTop: 10,
    paddingBottom: 14,
    paddingHorizontal: 24,
    lineHeight: 19,
  },
  // ── The schedule ───────────────────────────────────────────────────────
  // A gutter of right-aligned times against one continuous rule, cards to the
  // right of it, and a labelled line for each stretch of empty time — which
  // opens into that stretch's hours, drawn in the same gutter at the same x.
  //
  // `position: relative` anchors hourRule, which runs behind the whole thing.
  //
  // (The `compactCard*` set that used to live here — a card this list drew
  // itself — is gone: the rows are ScheduleCards, the same object the To-Do and
  // Pending lists below use, so there is one card in the day panel and not
  // three.)
  compactList: {
    position: 'relative',
    paddingBottom: 4,
  },
  // A skipped stretch: hairlines either side of the duration, starting at the
  // gutter rule so it reads as belonging to the timeline and not to a card.
  compactGapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  compactGapSpacer: {
    width: HOUR_LABEL_WIDTH,
  },
  compactGapLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
  },
  compactGapText: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.2,
    color: theme.colors.textTertiary,
    fontVariant: ['tabular-nums'],
  },
  // The duration and its chevron are one target. Padded so the 11pt label is
  // not an 11pt tap; hitSlop takes it the rest of the way to 44.
  compactGapLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  // An expanded gap: the hours, then the same duration line underneath, now
  // reading as "collapse". Keeping the control in the same place means the tap
  // that opened it is the tap that closes it, just further down the list.
  // No margin of its own — the duration line it ends with carries the same
  // bottom gap a collapsed gap row does, so opening one doesn't add a second.
  compactGapWrap: {},
  // The clipping box. Its height is set in one step per toggle (see CompactGap)
  // and the rows inside it are transformed through it; overflow:hidden is what
  // makes them appear to be uncovered by the box rather than to slide out of an
  // already-full-size container.
  compactGapBody: {
    overflow: 'hidden',
  },
  // One hour: its rule along the top, and the empty band under it down to the
  // next rule. Must match GAP_HOUR_H — the open height is computed from it, so
  // a change here without one there animates to the wrong size.
  compactGapHour: {
    height: GAP_HOUR_H,
    justifyContent: 'flex-start',
  },
  // A FIXED height, so the band below it knows exactly where the line ends.
  compactGapRule: {
    flexDirection: 'row',
    alignItems: 'center',
    height: GAP_RULE_H,
  },
  // The pressable band is the WHOLE slot: this hour's line down to the next,
  // top to bottom, so the lit area is the hour itself and not a strip inside
  // it. Inset past the time gutter, so the times keep a clean edge the way a
  // calendar's do.
  compactGapBand: {
    position: 'absolute',
    left: TIME_COL_W,
    right: 0,
    // From THIS hour's line to the next one: down by the line's offset inside
    // the rule row, then a full slot tall. `bottom: 0` measured the slot's box
    // instead, which sat the whole band 9 pt high.
    top: GAP_LINE_Y,
    height: GAP_HOUR_H,
    borderRadius: 10,
  },
  compactGapBandOn: {
    backgroundColor: theme.colors.surfaceElevated,
  },
  // Right-aligned, and centred on the slot's own height rather than on the
  // rule at its top.
  compactGapHourPlus: {
    position: 'absolute',
    right: 12,
    // The same box as the band, so the hint stays centred in the lit area
    // rather than in the slot's layout box.
    top: GAP_LINE_Y,
    height: GAP_HOUR_H,
    justifyContent: 'center',
    opacity: 0.6,
  },
  compactGapHourLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
  },
  // The vertical rule every time in the day is set against, and where the
  // schedule proper begins. Spans the whole list; the hour lines inside an open
  // gap start at the same x, so every horizontal line meets it.
  hourRule: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: HOUR_LABEL_WIDTH,
    width: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
  },
  hourLabel: {
    width: HOUR_LABEL_WIDTH,
    // Right-aligned INTO the rule, a fixed gap short of it, so the times form
    // an edge instead of a ragged column.
    paddingRight: 10,
    paddingTop: 2,
    textAlign: 'right',
    // Bigger and LIGHTER than it was (10/600). At 10pt the semibold was doing
    // the legibility work and the gutter read as heavy chrome competing with
    // the cards. 11pt at 500 is quieter — but weight is what was holding it up,
    // so the ink steps up to textSecondary to pay for it: net MORE readable
    // than before, not less. Same size/weight/ink as a card's own time column,
    // because inside an open gap the two sit in the same column.
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.2,
    color: theme.colors.textSecondary,
    // `fontVariant`, not `fontVariantNumeric` — RN only honours the array form,
    // so the old spelling was silently doing nothing and "11 AM"/"12 PM" were
    // free to sit at different widths.
    fontVariant: ['tabular-nums'],
  },
  // NOW, across the open hours of a gap — a red bar with a dot on the gutter.
  // Only inside a gap that has been opened: those are the only points on the
  // page where a minute has a y (see CompactGap's `nowY`). `top` is set per
  // render from the clock; pointerEvents:none on the wrapper so the hour slots
  // under the line stay tappable.
  //
  // Starts ON the gutter rule (the dot's -4 margin straddles it) rather than
  // 4 pt shy of it, so the marker reads as hanging off the same line the times
  // are set against.
  gapNowLine: {
    position: 'absolute',
    left: HOUR_LABEL_WIDTH,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    height: 2,
    zIndex: 2,
  },
  nowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.accentError || '#FF4444',
    marginLeft: -4,
  },
  nowBar: {
    flex: 1,
    height: 2,
    backgroundColor: theme.colors.accentError || '#FF4444',
  },
  // Add Task
  addTaskContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 8,
  },
  addTaskInput: {
    flex: 1,
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 6,
    padding: 10,
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    marginRight: 8,
  },
  addTaskClose: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Time chip shown inside the add-task row when the input was opened
  // from a long-press on the day calendar grid. Echoes the timeBadge
  // visual used on existing timed tasks so the user sees the same
  // "this has a time slot" affordance both here and on the saved
  // block once it lands. Tap dismisses → reverts to an untimed task.
  addTaskTimeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.textPrimary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
    marginRight: 8,
  },
  addTaskTimeChipMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addTaskTimeChipText: {
    fontSize: 12,
    color: theme.colors.background,
    fontWeight: '700',
  },
  // Subtle "add a time" affordance shown on the add-task row when no time
  // slot is pending (the plain "Add a new task" flow). Tapping opens the
  // wheel picker.
  addTaskTimeAdd: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  addTaskPlaceholder: {
    marginHorizontal: 16,
    marginVertical: 8,
  },
  addTaskInputBox: {
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 6,
    padding: 10,
  },
  addTaskPlaceholderText: {
    fontSize: theme.typography.body,
    color: theme.colors.textPlaceholder,
  },

  // Re-add title suggestions (dropdown under the add-task input)
  suggestionList: {
    marginHorizontal: 16,
    marginTop: -2,
    marginBottom: 8,
    backgroundColor: theme.colors.surfaceElevated || theme.colors.inputBackground,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    overflow: 'hidden',
    ...depth(theme, 'raised'),
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  suggestionTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  suggestionTitle: {
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    fontWeight: '500',
  },
  suggestionMeta: {
    fontSize: 11,
    color: theme.colors.textTertiary,
    marginTop: 1,
  },

  // Search styles
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 8,
  },
  searchInput: {
    flex: 1,
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 6,
    padding: 10,
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    marginRight: 8,
  },
  searchClose: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchPlaceholder: {
    marginHorizontal: 16,
    marginVertical: 8,
  },
  searchInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 6,
    padding: 10,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchPlaceholderText: {
    fontSize: theme.typography.body,
    color: theme.colors.textPlaceholder,
  },
  // The finder's result list (below the one field).
  // Lines up with the schedule below it (same side paddings → same time
  // column x).
  // The results, as a DROPDOWN hanging off the field rather than as rows loose
  // in the page — the same read as the media vault's board search: one surface,
  // its own edge, everything in it a candidate for the thing you are typing.
  // The edge matters more than it looks: without it the create card and the
  // matches were floating in the same space as the day's real schedule below,
  // and "a task you might make" and "a task you have" looked alike.
  finderResults: {
    marginTop: 10,
    marginHorizontal: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 4,
    overflow: 'hidden',
    ...depth(theme, 'card'),
  },
  // The ghost card, first in the dropdown: dashed, so it reads as a task-shaped
  // hole rather than as a task. Same card metrics as a real one (radius 18,
  // 16/14/12 padding, 72 min) so it sits in the list as a peer.
  finderCreate: {
    marginBottom: 10,
  },
  finderCreateCard: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong || theme.colors.border,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    minHeight: 72,
  },
  finderCreateTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  finderCreateRing: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: theme.colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  finderCreateTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 21,
    color: theme.colors.textPrimary,
  },
  finderCreateCaption: {
    fontSize: 13,
    fontWeight: '400',
    color: theme.colors.textSecondary,
    marginTop: 3,
  },
  finderCreateBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  finderCreateHint: {
    fontSize: 12,
    color: theme.colors.textTertiary,
  },
  finderFullKey: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong || theme.colors.border,
  },
  finderFullKeyText: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: theme.colors.textSecondary,
  },
  finderReadd: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchResults: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 12,
  },
  searchResultsTitle: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    color: theme.colors.textTertiary,
    marginBottom: 6,
    // Not italic any more: it is a section label inside the dropdown now, and
    // italics on a 11pt caption reads as an aside rather than as a heading.
    fontStyle: 'normal',
  },
  // A row IN the dropdown, not a card ON the page. The surface, radius and
  // border went with the panel that now holds them — a card inside a card is
  // two edges saying the same thing. Rows are told apart by a hairline, which
  // is what the media vault's result rows do.
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  resultIcon: {
    marginRight: 10,
  },
  resultContent: {
    flex: 1,
  },
  resultTitle: {
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    fontWeight: '500',
  },
  resultMeta: {
    fontSize: 11,
    color: theme.colors.textTertiary,
    marginTop: 2,
  },
  noResultsText: {
    fontSize: theme.typography.body,
    color: theme.colors.textMuted,
    textAlign: 'center',
    paddingVertical: 12,
    fontStyle: 'italic',
  },
});
