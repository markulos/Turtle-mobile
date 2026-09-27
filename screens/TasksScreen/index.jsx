import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  Image,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
  Alert,
  Keyboard,
  Platform,
  ScrollView,
  useWindowDimensions,
  PixelRatio,
  AppState,
} from 'react-native';
import { depth, insetRule } from '../../utils/surfaceDepth';
import { SCREEN_TITLE, SCREEN_TITLE_ROW_H } from '../../utils/headerType';
import AppTextInput from '../../components/AppTextInput';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { useServer } from '../../context/ServerContext';
import { useSyncSignals } from '../../context/DownloadsContext';
import { alignedStamp, taskSessionFromPush } from '../../utils/pomodoroState';
import { useTheme } from '../../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTaskData } from './hooks/useTaskData';
import { useCollapsibleTasks } from './hooks/useCollapsibleTasks';
import { advanceDueDate, minDate, maxDate, localTodayStr, lastCompletedDate, isTaskDoneNow, matchesRecurrence, nextOccurrenceAfter, itemTypeOf, taskPassesFilters, boardLabel } from './utils/taskHelpers';
// What starting a focus session writes onto the task it is for — a slot on
// today at the minute the block began, and only where there was no time yet.
import { startPatch } from './utils/focusStart';
import { completionChange } from './utils/completionChange';
import { tapHaptic, impactHaptic, selectionHaptic, markGesture } from '../../utils/haptics';
import { resolveAvatarUrl } from '../../utils/avatarUrl';

// An event is "over" once its end is in the past — start time + duration (a
// default hour when unset), or the end of its day for an all-day event. Used to
// auto-tick events off the calendar; birthdays and recurring items are exempt
// (they're not one-shot, so "done forever" would be wrong).
const EVENT_DEFAULT_DURATION_MIN = 60;

// ── Agenda date dividers (Upcoming / Past) ────────────────────────────────
// The Upcoming + Past agendas group their rows under a full-width hairline with
// a short date word on the right ("Today" / "Tomorrow" / "July 20"). A divider
// renders only when a row's date differs from the row above it, and rows with no
// date get none — so empty dates are simply skipped.
const AGENDA_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const parseYMDLocal = (ymd) => {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const ymdFromMs = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// The date a row belongs under: completed rows sit on the day they were ticked;
// everything else on its due date. Undated rows return null (no divider).
const agendaRowDateKey = (item) => {
  if (!item) return null;
  // A recurring occurrence ticked today has an ADVANCED (future) dueDate but
  // belongs under the DAY IT WAS TICKED — group it there, not under next week.
  if (isTaskDoneNow(item) && !item.completed) {
    const d = lastCompletedDate(item);
    if (d) return d;
  }
  // Otherwise prefer the DUE date so a row's date group is stable across
  // completion (a non-recurring task's due date doesn't change when you tick it).
  if (typeof item.dueDate === 'string' && item.dueDate) return item.dueDate.slice(0, 10);
  if (item.completed || isTaskDoneNow(item)) {
    const d = lastCompletedDate(item);
    if (d) return d;
    if (item.completedAt) return ymdFromMs(item.completedAt);
  }
  return null;
};
// Short, human date word for a YYYY-MM-DD key: Today / Tomorrow / Yesterday, or
// "July 20" (with the year appended only when it isn't the current year).
const agendaDateLabelWith = (months, relative = true) => (key) => {
  const todayStr = localTodayStr();
  if (relative && key === todayStr) return 'Today';
  const then = parseYMDLocal(key);
  const now = parseYMDLocal(todayStr);
  const diff = Math.round((then.getTime() - now.getTime()) / 86400000);
  if (relative && diff === 1) return 'Tomorrow';
  if (relative && diff === -1) return 'Yesterday';
  const label = `${months[then.getMonth()]} ${then.getDate()}`;
  return then.getFullYear() === now.getFullYear() ? label : `${label}, ${then.getFullYear()}`;
};
// The list's date dividers, which have the full width of the page to sit in.
const agendaDateLabel = agendaDateLabelWith(AGENDA_MONTHS);
// The pointer's readout, which does NOT. It lives in the ~74pt margin, with
// about 64pt of text width, and TWO things follow from that.
//
// The months are abbreviated: "September 2" wrapped mid-WORD to "Septembe /
// r 2".
//
// And it states a DATE, never a relative word — no "Today" / "Tomorrow" /
// "Yesterday" here, though the dividers still use them. At the readout's 15pt
// both "Yesterday" and "Tomorrow" overrun 64pt and wrap, stranding a letter on
// a second line. The relation has its own line now (see `dayOffsetLabel` and
// TimelinePointer's offset word), set small enough to fit and placed above or
// below the reading according to which way it points — so nothing is lost, the
// two say different things, and neither can wrap.
const agendaDateLabelShort = agendaDateLabelWith(AGENDA_MONTHS.map((m) => m.slice(0, 3)), false);
// How many days a date key is from today — negative for the past. The pointer's
// offset word is this, put into words.
const daysFromToday = (key) => {
  if (!key) return null;
  const now = parseYMDLocal(localTodayStr());
  const then = parseYMDLocal(key);
  return Math.round((then.getTime() - now.getTime()) / 86400000);
};

// Same stable per-owner colour as the calendar badges and the filter panel
// swatch (hash userId → hue), so the active-filter chip matches everywhere.
const ownerColor = (userId) => {
  if (!userId) return '#888888';
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) % 360;
  return `hsl(${h}, 60%, 52%)`;
};

const eventIsOver = (item, nowMs) => {
  if (!item || itemTypeOf(item) !== 'event') return false;
  if (item.recurring && item.recurring !== 'none') return false;
  if (!item.dueDate || typeof item.dueDate !== 'string') return false;
  const [y, m, d] = item.dueDate.split('-').map(Number);
  if (!y || !m || !d) return false;
  if (item.time && /^\d{1,2}:\d{2}/.test(item.time)) {
    const [hh, mm] = item.time.split(':').map(Number);
    const dur = Number(item.duration) > 0 ? Number(item.duration) : EVENT_DEFAULT_DURATION_MIN;
    return new Date(y, m - 1, d, hh, mm + dur, 0, 0).getTime() <= nowMs;
  }
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime() <= nowMs;
};
import {
  TaskForm,
  TaskDetail,
  TaskItem,
  TimelineTaskRow,
  UNIFORM_CARD_H,
  SectionHeader,
  CalendarView,
} from './components';
// The x the agenda's thread is drawn at — shared with the rows so the
// dividers' segments and the rows' segments are one line.
import {
  RAIL_ABS_X, RAIL_W, threadColor, TimelineGutter, TimelinePointer,
  // The band's width and the card column's left edge — the agenda's own chrome
  // aligns to these so it clears the gutter and matches the rows exactly.
  GUTTER_W, MARGIN_EDGE_X, CARD_COL_X, ROW_PAD,
  // The gap a cell carries below its card — the magnet measures where a card's
  // centre really is, and a cell's layout box includes it.
  ROW_GAP,
  setScrubbing as setGutterScrubbing,
} from './components/TimelineTaskRow';
import { clockLabel } from './components/ScheduleCard';
// `pointerLabel` is aliased: the screen already has state by that name.
import { indexAtContentY, dayKeyAt, pointerParts, activeRowIdAt, markContentY, virtualLeadFor, nearestCardCenter, magnetPull } from './utils/timelinePointer';
import { VIEW_PAGES, DEFAULT_VIEW, VIEW_SEGMENTS, viewIndex, viewAtOffset } from './utils/viewPages';
import { buildTaskIndex } from './utils/taskSearch';
import { inboxDestination, inboxDestinationLabel, inboxTaskFrom, inboxTasks } from './utils/inboxDestination';
import InboxCapture from './components/InboxCapture';
import InboxList from './components/InboxList';
import PlannerSearchPanel from './components/PlannerSearchPanel';
import PlannerFilterPanel from './components/PlannerFilterPanel';
import { boardCardPalette } from './utils/cardPalette';
import { boardColorAt } from './utils/boardColors';
import FriendCard from '../TurtleScreen/components/FriendCard';
import PeoplePopover from './components/PeoplePopover';
import EdgeSwipePage from '../TurtleScreen/components/EdgeSwipePage';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useCommandBus } from '../../context/CommandBusContext';
import { useOpenTarget } from '../../context/OpenTargetContext';
import { useCelebration } from '../../context/CelebrationContext';
import { STATUS_OPTIONS } from './components/StatusSegment';
import BoardManagerSheet from './components/BoardManagerSheet';
import TaskInspectorSheet from './components/TaskInspectorSheet';
import SchedulePickerSheet from './components/SchedulePickerSheet';
import OverviewPage from './components/OverviewPage';
import FocusPage from './components/FocusPage';
import { mergeFocusLog } from './utils/focusStats';
// So a block started from the Focus tab still pings THIS device when it ends.
import { getExpoPushTokenSafe } from '../../services/vaultPush';

// The row's real board, or null. "None" is stored three ways — absent, empty,
// and the legacy 'No Project' sentinel (see boardLabel) — and all three mean
// the same plain card.
const boardOf = (t) => (t?.project && t.project !== 'No Project' ? t.project : null);


// Distinct project colours that read well against the green/yellow palette.
// Module-level (a pure constant) so it isn't rebuilt on every render.
// The three pages, their order and the arithmetic that keeps the pager and its
// segmented control agreeing — see utils/viewPages.

// The breath above the agenda's first band header. Small on purpose: this is
// air under the chrome, NOT the depth the timeline mark needs above the first
// card — that is the pointer's virtual lead, and it nets this off so the two
// cannot double-count (see agendaVirtualLead).
const AGENDA_TOP_PAD = 12;

// The header's side margin. The vault's, and the title row and the tab track
// share it so the title's first letter and the first tab's slot line up.
const HEADER_PAD_X = 16;

// ── The agenda's magnet ─────────────────────────────────────────────────────
// The MARK never moves — it is the one fixed thing on the screen and the whole
// timeline is read against it. So the attraction acts on the other side of the
// pair: the cards slide to the mark, never the mark to a card.
//
// How far they may slide under the lean, and how hard it pulls. At this
// strength the slide peaks around 4pt of the 5 it is allowed, so the clamp is
// a guard rather than the thing you feel.
//
// HISTORY, because it shipped broken twice and the cause was not the magnet:
// the agenda grew a lead-in above its first card at the same time, and
// FlashList's `getLayout` is PADDING-RELATIVE while a scroll offset is not
// (see `markContentY`). Every reading — the readout, the lit row, and the
// magnet's idea of which card was nearest — was that padding further down the
// timeline than the mark really was. Hence "it lit the wrong card" and "it
// pulls between items": the magnet was aiming at a card a row and a half from
// the mark. One missing term, three symptoms.
const MAGNET_LEAN_MAX = 5;
const MAGNET_STRENGTH = 0.32;
// A settle NEVER moves the list further than this. Beyond it the mark is not
// "near" a card at all — it is sitting on a band header, or in the gap between
// the two bands — and pulling the list to one from there would be the opposite
// of controlled.
const MAGNET_SETTLE_MAX = 64;
// Under this it is already there; moving would be a twitch, not a settle.
const MAGNET_SETTLE_MIN = 1.5;

// The board palette lives in utils/boardColors — shared with the calendar,
// which used to hash board names into a palette of its own.

// Lazy-load placeholder shown at the top of the history band while an older
// batch resolves. Fixed-height rows (icon-rail dot + card with two text bars)
// that roughly mirror a TimelineTaskRow, so real rows swap in with no reflow.
// A slow opacity pulse reads as "loading". Module-level so it isn't rebuilt each
// render; native-driver opacity keeps the pulse off the JS thread.
function PastSkeleton({ theme, rows = 4 }) {
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 620, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 620, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const bar = (w) => ({ width: w, height: 11, borderRadius: 6, backgroundColor: theme.colors.border });
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 8 }} pointerEvents="none">
      {Array.from({ length: rows }).map((_, i) => (
        <Animated.View
          key={`past-skeleton-${i}`}
          style={{ opacity: pulse, flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}
        >
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.border, marginRight: 14 }} />
          <View style={{
            flex: 1,
            height: 54,
            borderRadius: 12,
            backgroundColor: theme.colors.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            paddingHorizontal: 14,
            justifyContent: 'center',
          }}>
            <View style={[bar('62%'), { marginBottom: 9 }]} />
            <View style={bar('34%')} />
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

// ONE shared pulse for every placeholder cell. The list's render window can
// hold 100+ mounted placeholders at once — a per-cell Animated.loop multiplied
// that into a hundred concurrent animations; a single native-driver loop that
// every cell's opacity consumes costs the same as one, and the synchronized
// pulse reads better anyway. Lazily started, never stopped (one idle native
// animation for the app's lifetime is free).
let sharedPulse = null;
function getSharedPulse() {
  if (!sharedPulse) {
    sharedPulse = new Animated.Value(0.45);
    Animated.loop(
      Animated.sequence([
        Animated.timing(sharedPulse, { toValue: 1, duration: 620, useNativeDriver: true }),
        Animated.timing(sharedPulse, { toValue: 0.45, duration: 620, useNativeDriver: true }),
      ]),
    ).start();
  }
  return sharedPulse;
}

// One PAST-zone placeholder row, PIXEL-IDENTICAL in footprint to a `uniform`
// TimelineTaskRow (same paddingHorizontal 14 / 40px rail / 12px card gap /
// UNIFORM_CARD_H card / 12px row gap = UNIFORM_ROW_H total). The zone's whole
// point is that a fill swaps this for the real row with ZERO dimensional
// change, so the geometry here must mirror TimelineTaskRow's exactly — change
// one only in lockstep with the other. Soft pulse on the card reads as
// "loading"; module-level so it isn't rebuilt each render.
function PastPlaceholderRow({ theme }) {
  const pulse = getSharedPulse();
  const block = theme.colors.border;
  // A slot whose row hasn't loaded has no board yet either — the PLAIN card,
  // so the swap to a real row changes tone only when that row turns out to
  // belong to a board.
  const card = boardCardPalette(theme, null).card;
  const bar = (w, h, extra) => ({ width: w, height: h, borderRadius: h / 2, backgroundColor: block, ...(extra || {}) });
  return (
    <View style={{ flexDirection: 'row', marginBottom: 12, paddingHorizontal: 14 }} pointerEvents="none">
      {/* Time column — a short bar where the real row prints its time. Width
          and inset track TimelineTaskRow's TIME_COL so the placeholder's
          footprint stays pixel-identical to a real row; it hugs the column's
          LEFT edge, and wears the band's own ink rather than the page's,
          because it sits ON the black gutter. */}
      <View style={{ width: 74, paddingTop: 9, alignItems: 'flex-start', justifyContent: 'center', height: 22 + 9 }}>
        <View style={bar(44, 9, { backgroundColor: 'rgba(255,255,255,0.22)' })} />
      </View>
      {/* Card — locked to the uniform card height; when/title/subtitle bars. */}
      <Animated.View
        style={{
          flex: 1,
          marginLeft: 12,
          height: UNIFORM_CARD_H,
          overflow: 'hidden',
          justifyContent: 'center',
          backgroundColor: card,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: theme.colors.border,
          paddingHorizontal: 12,
          opacity: pulse,
        }}
      >
        <View style={bar('30%', 10, { marginBottom: 9 })} />
        <View style={bar('68%', 13, { marginBottom: 8 })} />
        <View style={bar('42%', 11)} />
      </Animated.View>
    </View>
  );
}

// ── Upcoming-agenda cold-load skeleton ──────────────────────────────────────
// A high-end loading state for the Upcoming agenda, shown ONLY on a genuine
// cold start (nothing cached). The REAL header (icon + "Upcoming") stays put
// for continuity — only the count and rows read as "loading" — and a soft
// gradient sheen sweeps across placeholder timeline rows shaped exactly like a
// TimelineTaskRow (rail dot + connecting line + card with when/title/subtitle
// bars). It's an overlay that FADES to reveal the real rows underneath once
// /tasks resolves, so content cross-fades in instead of popping. Module-level
// (like PastSkeleton) so it isn't rebuilt each render; native-driver
// transforms/opacity keep every animation off the JS thread.

// A highlight band that sweeps left→right across its (overflow-hidden) parent —
// the signature "shimmer" of a premium skeleton. Full-block-width gradient
// translated by ±screen so the soft band travels edge to edge.
function ShimmerSweep({ theme }) {
  const { width } = useWindowDimensions();
  const x = useRef(new Animated.Value(-width)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(x, {
        toValue: width,
        duration: 1250,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [x, width]);
  const hi = theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.6)';
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ translateX: x }] }]}>
      <LinearGradient
        colors={['transparent', hi, 'transparent']}
        locations={[0.35, 0.5, 0.65]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

// One placeholder timeline row — rail (connecting line + dot) + card (when /
// title / subtitle bars). Bar widths vary per row so the block reads as organic
// content, not a repeating pattern. Fades + slides in with a small per-row
// stagger for a polished entrance rather than appearing all at once.
function UpcomingSkeletonRow({ theme, index, titleW, isFirst, isLast }) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 320,
      delay: 55 * index,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter, index]);
  const block = theme.colors.border;
  const card = boardCardPalette(theme, null).card;
  const bar = (w, h, extra) => ({ width: w, height: h, borderRadius: h / 2, backgroundColor: block, ...(extra || {}) });
  return (
    <Animated.View
      style={{
        flexDirection: 'row',
        paddingHorizontal: 14,
        marginBottom: 12,
        opacity: enter,
        transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
      }}
    >
      {/* Rail column — connecting line segments (above/below the dot) mirror
          TimelineTaskRow's rail so the placeholder lines up with real rows.
          alignSelf:'stretch' makes it span the card height so the line runs the
          full row (not just the dot's box). */}
      <View style={{ width: 40, alignSelf: 'stretch', alignItems: 'center' }}>
        {!isFirst && <View style={{ position: 'absolute', left: 19, top: 0, height: 20, width: 2, backgroundColor: block, opacity: 0.5 }} />}
        {!isLast && <View style={{ position: 'absolute', left: 19, top: 20, bottom: -12, width: 2, backgroundColor: block, opacity: 0.5 }} />}
        <View style={{ width: 16, height: 16, borderRadius: 8, marginTop: 12, backgroundColor: block }} />
      </View>
      {/* Card */}
      <View style={{ flex: 1, marginLeft: 12, backgroundColor: card, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, paddingVertical: 9, paddingHorizontal: 12 }}>
        <View style={bar('32%', 10, { marginTop: 2, marginBottom: 9 })} />
        <View style={bar(titleW, 13, { marginBottom: 8 })} />
        <View style={bar('46%', 11)} />
      </View>
    </Animated.View>
  );
}

const UPCOMING_SKELETON_WIDTHS = ['86%', '68%', '92%', '74%', '58%', '80%'];

function UpcomingSkeleton({ theme, rows = 6 }) {
  return (
    <View style={{ overflow: 'hidden' }}>
      {/* Real header — continuity: only the count + rows are "loading". */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm }}>
        <Icon name="clock-fast" size={16} color={theme.colors.accentInfo} />
        <Text style={{ fontSize: theme.typography.body, fontWeight: '800', color: theme.colors.textPrimary, letterSpacing: 0.3, flex: 1 }}>
          Upcoming
        </Text>
        <View style={{ minWidth: 22, height: 20, paddingHorizontal: 7, borderRadius: 10, backgroundColor: theme.colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.border }} />
        </View>
      </View>
      {/* Date-group divider placeholder (matches agendaDateDivider metrics). */}
      <View style={{ paddingTop: 12, paddingBottom: 14, paddingRight: 14 }}>
        {/* 19 tall like the real label's line box, so the skeleton and what
            replaces it are the same height and the swap does not jump. */}
        <View style={{ alignSelf: 'flex-end', width: 64, height: 19, borderRadius: 6, backgroundColor: theme.colors.border, marginBottom: 5 }} />
        <View style={{ marginLeft: 66, height: 1, backgroundColor: theme.colors.border }} />
      </View>
      {Array.from({ length: rows }).map((_, i) => (
        <UpcomingSkeletonRow
          key={`upcoming-skeleton-${i}`}
          theme={theme}
          index={i}
          titleW={UPCOMING_SKELETON_WIDTHS[i % UPCOMING_SKELETON_WIDTHS.length]}
          isFirst={i === 0}
          isLast={i === rows - 1}
        />
      ))}
      {/* Sheen sweeping over the whole block. */}
      <ShimmerSweep theme={theme} />
    </View>
  );
}

// Fading overlay: shows the skeleton during a cold load, then cross-fades to the
// real agenda when data arrives and unmounts. Sits above the SectionList so the
// misleading "No tasks yet" empty state never flashes on a cold start.
function UpcomingSkeletonOverlay({ visible, theme }) {
  const [mounted, setMounted] = useState(visible);
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    } else if (mounted) {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 340,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start(({ finished }) => { if (finished) setMounted(false); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  if (!mounted) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { opacity, backgroundColor: theme.colors.background, zIndex: 5 }]}
    >
      <UpcomingSkeleton theme={theme} rows={6} />
    </Animated.View>
  );
}

// A gentle pulsing dot beside the Upcoming count while a background revalidation
// is in flight — a quiet "syncing" cue on app resume/reconnect that never
// blanks or blocks the list.
function SyncDot({ theme }) {
  const pulse = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 620, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.3, duration: 620, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{ width: 6, height: 6, borderRadius: 3, marginLeft: 8, backgroundColor: theme.colors.accentInfo, opacity: pulse }}
    />
  );
}

// The "All Boards" glyph: four circles in a 2×2 square, each a DIFFERENT colour
// — a compact stand-in for "multiple boards" that reads livelier than the plain
// folder icon it replaces. Colours are fixed (not themed) so the four always
// stay distinct on both light and dark. `size` is the whole box; each circle is
// half that, minus the gap, so they tuck into the four corners.
const BOARDS_ICON_COLORS = ['#4C9AFF', '#34C759', '#FF9F0A', '#FF6B6B'];
function FourColorBoardsIcon({ size = 18, gap = 2 }) {
  const d = (size - gap) / 2;
  return (
    <View style={{ width: size, height: size, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignContent: 'space-between' }}>
      {BOARDS_ICON_COLORS.map((c, i) => (
        <View key={i} style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: c }} />
      ))}
    </View>
  );
}

export default function TasksScreen() {
  const { theme, timeFormat } = useTheme();
  const insets = useSafeAreaInsets();
  // The tab bar floats over the page now, so lists clear it themselves.
  const tabBarHeight = useBottomTabBarHeight();
  const { isConnected, api, getBaseUrl } = useServer();
  // Cross-device change pings off the app-level socket (context/DownloadsContext).
  // Counters, not payloads: the server deliberately sends nothing, so the answer
  // to "what changed" is always a refetch over authenticated HTTP.
  const { tasksVersion, focusVersion, focusPush } = useSyncSignals();
  const { celebrate } = useCelebration();
  const navigation = useNavigation();
  const route = useRoute();
  const { dispatch: dispatchCommand } = useCommandBus();
  // True while the Boards page has a drill-down up (a board, a stat's list,
  // the stats sheet). Those are absolute overlays INSIDE the pager's page, so
  // the pager has to stop paging under them — otherwise a left-edge back-swipe
  // and a page-swipe are the same gesture, and the wrong one wins.
  const [boardsDrilled, setBoardsDrilled] = useState(false);
  // Mirror of the calendar's selected day (CalendarView owns it; it reports
  // up via onSelectedDateChange) so the stats panel can show that day's
  // scheduled/completed counts.
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [showProjectManager, setShowProjectManager] = useState(false);
  // The board a long-press on the rail asked to edit; the sheet opens on it.
  const [manageBoard, setManageBoard] = useState(null);
  // The BOARDS page's filter panel: the status keys and the board rail, folded
  // away until its key is pressed. It used to be a tray revealed over whatever
  // page you were reading, which is why it had to be an absolute layer with a
  // counter-shifted page under it; on its own page it is simply a section that
  // expands, and the page scrolls.
  // ── The Planner's search and filter, on the HEADER ────────────────────────
  //
  // Both used to belong to the Boards tab — folded inside the one page whose
  // contents they had least to do with. To look for a task you had to first
  // swipe to a page you did not want, and an Agenda narrowed by a tag had no
  // control anywhere on it to widen again. They are header keys now, so they
  // are on every tab, and what the search MEANS is decided by the tab you
  // opened it from (see PlannerSearchPanel).
  const [searchOpen, setSearchOpen] = useState(false);
  const [plannerQuery, setPlannerQuery] = useState('');
  // 'all' | 'todo' | 'overdue' | 'done' — the panel's scope chips. Kept on the
  // screen rather than inside the panel so the scope you chose survives closing
  // it; re-picking "to do" on every single search is a tax.
  const [searchScope, setSearchScope] = useState('all');
  const [filterOpen, setFilterOpen] = useState(false);
  // The board picker, opened from the title. Its own query, kept apart from the
  // search panel's: they are two different questions and neither should inherit
  // the other's half-typed words.
  const [boardPickerOpen, setBoardPickerOpen] = useState(false);
  const [boardQuery, setBoardQuery] = useState('');
  // The day panel's task inspector. The calendar reports the tap; the sheet is
  // mounted HERE, in a transparent Modal, so it sits over the header chrome,
  // the day panel and the tab bar — everything else in the app. Holding the id
  // (not the task) keeps the sheet on the live row as edits land.
  const [inspector, setInspector] = useState(null); // { id, date }
  const inspectorTask = useMemo(
    () => (inspector ? (tasks || []).find((t) => t && t.id === inspector.id) || null : null),
    [inspector, tasks],
  );
  const closeInspector = useCallback(() => setInspector(null), []);
  const openBoardManager = useCallback((name = null) => {
    setManageBoard(typeof name === 'string' ? name : null);
    setShowProjectManager(true);
  }, []);
  const [showTaskForm, setShowTaskForm] = useState(false);
  // Whose-profile-is-open: { userId, ownerName } set when a task's owner badge
  // is tapped on the shared calendar; drives the FriendCard popup below.
  const [profileOwner, setProfileOwner] = useState(null);
  // Item type to pre-select when CREATING via the calendar "+" menu
  // ('task' | 'event' | 'birthday'). Ignored when editing an existing item.
  const [newItemType, setNewItemType] = useState('task');
  // Date (YYYY-MM-DD) to pre-fill when creating from a tapped calendar day's
  // "+" button. Null for the FAB create menu (no specific day chosen).
  const [newItemDate, setNewItemDate] = useState(null);
  // The board a new task is born into (the rail's selection at the moment the
  // + key was pressed; null = the form's own default).
  const [newItemProject, setNewItemProject] = useState(null);
  // Title + time already entered in the day panel's finder before "Full form"
  // was pressed. Empty for every other entry point into the form.
  const [newItemTitle, setNewItemTitle] = useState('');
  const [newItemTime, setNewItemTime] = useState('');
  const [showDetail, setShowDetail] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  // True when the edit form was reached by continuing the calendar quick
  // inspector (so it presents as a continuation, not a fresh slide-up).
  const [selectedTask, setSelectedTask] = useState(null);
  // Accordion for the task tree: only ONE task row's subtasks/details are
  // expanded at a time — expanding another collapses the previous, so exactly
  // one item is ever "open". null = none expanded.
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const handleToggleTaskExpand = useCallback(
    (id) => setExpandedTaskId((prev) => (prev === id ? null : id)),
    [],
  );
  // Status keys in the header (StatusSegment): 'todo' | 'done' | 'all'.
  // `showIncompleteOnly` stays as the derived boolean the calendar / tree /
  // agenda already understand; 'done' is applied on top (see doneOnly).
  const [statusFilter, setStatusFilter] = useState('todo');
  const showIncompleteOnly = statusFilter === 'todo';
  const doneOnly = statusFilter === 'done';
  const setShowIncompleteOnly = useCallback((v) => setStatusFilter(v ? 'todo' : 'all'), []);
  const [selectedProject, setSelectedProject] = useState('All');
  // What the one header key says, and whether it lights. The board wins the
  // label when one is picked — it is the narrower scope, and the status still
  // reads from the keys inside the panel. Default state ('All' + 'to do') says
  // plain "Boards" and stays unlit, so a lit key always means the list you are
  // looking at is not the whole list. The key is named for what it OPENS (the
  // boards), not for the abstract act of filtering.
  // What the title's second half says. The board you are scoped to, or "All
  // Boards" when you are not — never blank, and never the bare sentinel 'All',
  // which reads as a truncation rather than as a scope.
  const plannerScopeLabel = selectedProject && selectedProject !== 'All'
    ? boardLabel(selectedProject)
    : 'All Boards';
  const filterScoped = selectedProject !== 'All' || statusFilter !== 'todo';
  const filterKeyLabel = selectedProject !== 'All'
    ? boardLabel(selectedProject)
    : (statusFilter === 'todo' ? 'Boards' : STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label || 'Boards');
  const [selectedTags, setSelectedTags] = useState([]);
  const [tagFilterMode, setTagFilterMode] = useState('any');
  // Shared-calendar "whose tasks" filter. Empty = show everyone's; otherwise a
  // list of user ids to show. The owner identity rides on each task DTO
  // (userId/ownerName) from the server, so the option list is derived straight
  // from the loaded tasks — no extra fetch needed.
  const [selectedOwners, setSelectedOwners] = useState([]);
  const [viewMode, setViewMode] = useState(DEFAULT_VIEW); // see VIEW_PAGES
  // Read by the pager's one-shot seed, which runs in an onLayout callback that
  // must not be rebuilt every time the mode changes.
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  // Edit vs View mode for the LIST view. Default VIEW: a clean list with no
  // add-task inputs or tag-edit affordances cluttering it — just the projects,
  // tag groups, and tasks. Edit mode reveals the inline "add task", tag
  // rename/add, etc. (gated throughout on `editMode`).
  const [editMode, setEditMode] = useState(false);
  // The boards tree lives on its OWN page (a pageSheet Modal) — opened from
  // the "All Boards" button at the very bottom of the Upcoming agenda.
  const [boardsPageOpen, setBoardsPageOpen] = useState(false);
  // True while the calendar's day-schedule planner (bottom sheet) is raised.
  // When open, the calendar⇄list pager is locked so horizontal swipes page
  // between DAYS inside the planner instead of switching to the list view —
  // and the header below stands down, so the planner opens ALL THE WAY to the
  // top of the screen instead of stopping under two rows of keys it can't use
  // anyway (the pager is locked; the planner has its own + key).
  const [dayPlannerOpen, setDayPlannerOpen] = useState(false);
  // The header does NOT stand down when the planner opens — it used to
  // unmount, then (briefly) fold away on a timing curve, and both were wrong
  // for the same reason: the view pill and the Boards key are how you get OUT
  // of the day you are planning, and taking them away to win a header's worth
  // of height traded navigation for space. `dayPlannerOpen` now does one job,
  // locking the pager so a horizontal swipe pages between DAYS. The planner
  // stops below the header instead — see SHEET_RAISED_GAP in CalendarView.

  // ── Agenda ⇄ Calendar ⇄ Boards horizontal pager ──────────────────────
  // THREE views side by side in a paging ScrollView, swiped between exactly
  // the way the media vault's Photos / Music / Files are — a paging scroller
  // whose offset drives a sliding segmented control 1:1, so the pill tracks
  // the swipe rather than snapping after it.
  //
  // Order: agenda | calendar | boards. The calendar keeps the middle, which is
  // what makes it one swipe from either neighbour — it is the page you leave
  // and come back to. The views' own gestures are vertical (the agenda's list,
  // the calendar's month FlatList and its bottom-sheet drag), so a horizontal
  // page-swipe never fights them.
  const { width: windowWidth } = useWindowDimensions();
  const pagerRef = useRef(null);
  // Live horizontal offset of the calendar⇄list pager, tracked on the native
  // thread so the header segmented-control slider tracks the swipe 1:1 — the
  // same interface the Photos tab bar uses (MediaGallery `pageScrollX`).
  const pagerScrollX = useRef(new Animated.Value(0)).current;
  // Measured page box. Width is seeded from the window so the initial
  // contentOffset lands on the right page before onLayout fires; height is
  // measured (a ScrollView's children need a bounded height for the nested
  // SectionList / calendar FlatList to scroll).
  const [pagerSize, setPagerSize] = useState({ width: windowWidth, height: 0 });
  // Tap the header toggle → set the mode AND glide the pager to that page.
  const goToView = useCallback((mode) => {
    setViewMode(mode);
    pagerRef.current?.scrollTo({ x: viewIndex(mode) * pagerSize.width, y: 0, animated: true });
  }, [pagerSize.width]);
  // Settle after a swipe → adopt whichever page we landed on (no re-scroll, so
  // this can't fight goToView's programmatic scroll).
  const onPagerSettle = useCallback((e) => {
    const mode = viewAtOffset(e.nativeEvent.contentOffset.x, pagerSize.width || windowWidth);
    setViewMode((prev) => (prev === mode ? prev : mode));
  }, [pagerSize.width, windowWidth]);
  // The calendar is no longer page 0, so the pager cannot simply start at its
  // natural offset any more. It is seeded ONCE, imperatively, on the first
  // layout that reports a width — NOT with a `contentOffset` prop: rebuilding
  // that object each render makes RN re-apply it to the native ScrollView, and
  // on Android that yanks the scroll back mid-swipe on any unrelated re-render
  // (the "stuck half-way" glitch the old comment warned about). One
  // non-animated scroll in the same frame as the layout is invisible.
  //
  // Gated on a MEASURED page box, not merely on a width: the width is seeded
  // from the window so the pages have one before layout, but the height is 0
  // until the real layout lands, and a scroll issued against content the
  // native view has not sized yet is silently dropped — which would leave the
  // pill on Calendar and the page on Agenda.
  const pagerSeeded = useRef(false);
  useEffect(() => {
    if (pagerSeeded.current) return;
    const { width, height } = pagerSize;
    if (!(width > 0) || !(height > 0)) return;
    pagerSeeded.current = true;
    const x = viewIndex(viewModeRef.current) * width;
    if (x <= 0) return;
    // Next frame: the layout that gave us these numbers is still committing.
    const raf = requestAnimationFrame(() => {
      pagerRef.current?.scrollTo({ x, y: 0, animated: false });
    });
    return () => cancelAnimationFrame(raf);
  }, [pagerSize]);

  // NOTE: the selected-day completion stats (dayStats / dayPct) live AFTER the
  // useTaskData() call below — they read `tasks`, and declaring them up here
  // (above the hook) left `tasks` undefined on first render, throwing
  // "cannot read property 'filter' of undefined".


  // Inline add task state per project
  const [inlineAddingProject, setInlineAddingProject] = useState(null);
  const [inlineTaskTitle, setInlineTaskTitle] = useState('');
  const inlineInputRef = useRef(null);

  // Task search — a simple always-visible box at the top of the list.
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef(null);

  // Ref for scrolling to items when keyboard appears
  const listRef = useRef(null);
  const scrollY = useRef(0);
  
  // Keyboard handling
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  
  useEffect(() => {
    // The keyboard height only PADS the list's bottom so content can scroll
    // clear of the keyboard; nothing on screen is re-laid-out to make room
    // (house keyboard rule). The global LayoutAnimation this used to fire on
    // every keyboard event captured every unrelated layout change in flight
    // — sheets, chips and rows all eased a beat behind the keyboard.
    const showListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        setKeyboardHeight(e.endCoordinates.height);
        setKeyboardVisible(true);
      }
    );
    const hideListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
        setKeyboardVisible(false);
      }
    );
    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, []);
  
  const {
    tasks, setTasks, projects, allTags,
    loadData, saveTasks, saveTaskPatch, createTask, collectTags, addProject, renameProject, deleteProject,
    handleAddSubtask,
    handleToggleSubtask,
    handleDeleteSubtask,
    handleUpdateSubtask,
    deleteTask,
    loading,
    refreshing,
    onRefresh,
    lazyRefresh,
    initializing,
    syncing,
  } = useTaskData(api, isConnected, () => celebrate({ points: 10, kind: 'task' }));

  // ── CROSS-DEVICE TASK SYNC ────────────────────────────────────────────────
  // `tasks:changed` fires for every write the change concerns me — mine, and
  // anything I am on — from any device. Until this existed the phone had no task
  // realtime path AND no refetch on focus, so a task added, ticked, rescheduled
  // or deleted on the desktop could sit unseen here for the whole life of the
  // process. The ping carries nothing on purpose, so the only sane reaction is to
  // re-read; `lazyRefresh` is silent (never blanks the list, never spins) and
  // coalescing (a burst of pings is one fetch, and a ping that lands inside the
  // throttle window is parked rather than dropped).
  // Keyed on the COUNTER alone, the refresher read through a ref: `lazyRefresh`
  // changes identity whenever the api does (a reconnect), and useTaskData
  // already reloads on that — putting it in the deps would just double the work.
  const lazyRefreshRef = useRef(lazyRefresh);
  lazyRefreshRef.current = lazyRefresh;
  useEffect(() => {
    if (tasksVersion === 0) return;   // nothing has pinged yet; the mount load covers it
    lazyRefreshRef.current();
  }, [tasksVersion]);

  // Returning to the app is the other catch-up: a change made elsewhere while
  // the phone was asleep arrived at a socket that was deliberately disconnected
  // to save battery, and there is no replay for it. Kept here as well as in the
  // socket context so this screen's freshness never depends on that socket
  // having come up at all (offline start, unauthenticated first run).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') lazyRefreshRef.current();
    });
    return () => sub?.remove();
  }, []);

  // Boards shared WITH me → { boardName: sharerDisplayName }, for the picker's
  // "shared in" badge. The board names themselves already arrive via GET
  // /projects (now scoped to mine + shared); this just labels which are shared.
  const [sharedInLabels, setSharedInLabels] = useState({});
  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;
    (async () => {
      try {
        const sh = await api.get('/shares');
        if (cancelled) return;
        const map = {};
        for (const s of Array.isArray(sh?.incoming) ? sh.incoming : []) map[s.project] = s.fromName;
        setSharedInLabels(map);
      } catch { /* keep last */ }
    })();
    return () => { cancelled = true; };
  }, [api, isConnected]);

  // Always-current snapshot of `tasks` so the row handlers below (held by
  // memoized TaskItem rows) read the LATEST array, never a stale closure.
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  // Distinct task owners present on the shared calendar, derived from the task
  // DTOs (each carries userId + ownerName). Drives the "whose tasks" filter
  // option list and the per-owner colour badges. `multiUser` gates both: a
  // solo pond shows no person-filter and no badges (nothing to disambiguate).
  const owners = useMemo(() => {
    const seen = new Map();
    for (const t of tasks) {
      if (t.userId && !seen.has(t.userId)) {
        seen.set(t.userId, { userId: t.userId, ownerName: t.ownerName || 'Unknown' });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.ownerName.localeCompare(b.ownerName));
  }, [tasks]);
  const multiUser = owners.length > 1;

  // The pond's MEMBER RECORDS, keyed by user id.
  //
  // The task DTOs carry userId + ownerName and nothing else — no picture, no
  // phone, no role, no sign-in state, no stats. Everything else about a person
  // lives on /api/friends, which already returns the lot
  // ({ id, phone, displayName, avatarUrl, role, joined, stats }). So this is
  // one call rather than a change to the task payload, and it feeds BOTH the
  // owner badge on a card and the profile card behind it — which used to be
  // built from the task DTO alone and therefore showed a blank avatar, "Member"
  // with no detail, "Hasn't signed in yet" for someone who had, and dashes
  // where the stats are.
  //
  // Only on a SHARED pond: a solo pond draws no owner badges at all, so
  // fetching a member list to decorate them would be a request for nothing.
  // Refetched when the set of owners changes (someone new shows up), which is
  // also when a newly-uploaded picture gets picked up.
  const [ownerMembers, setOwnerMembers] = useState({});
  const ownerKey = owners.map((o) => o.userId).join(',');
  useEffect(() => {
    if (!multiUser) { setOwnerMembers({}); return undefined; }
    let alive = true;
    (async () => {
      // /friends and /me, because /friends is "everyone EXCEPT me" — tapping
      // your OWN badge would otherwise find no record and get the same blank
      // card this is fixing. Settled together so the map is never half-built.
      const [friendsRes, meRes] = await Promise.allSettled([api.get('/friends'), api.get('/me')]);
      const next = {};
      if (friendsRes.status === 'fulfilled') {
        const r = friendsRes.value;
        const list = Array.isArray(r?.friends) ? r.friends : (Array.isArray(r) ? r : []);
        for (const m of list) if (m?.id) next[m.id] = m;
      }
      if (meRes.status === 'fulfilled' && meRes.value?.user?.id) {
        // `joined` is absent from /me (the server derives it from last_login_at
        // for OTHER people). You are reading this, so you have signed in.
        next[meRes.value.user.id] = { ...meRes.value.user, joined: true };
      }
      if (alive && Object.keys(next).length) setOwnerMembers(next);
    })();
    return () => { alive = false; };
    // getBaseUrl deliberately NOT a dep: ServerContext rebuilds it on every
    // provider render, which would refetch the member list for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, multiUser, ownerKey]);

  const serverBase = getBaseUrl().replace(/\/api$/, '');

  // Everything a BADGE needs about a person, from one id. Used for the task
  // owner and for each of a task's involvedUsers, so both come out of the same
  // place and a person looks the same whichever role they are in on a card.
  // The name falls back through the member record, the task's own ownerName
  // (passed by the caller when it has one) and finally the id, so a badge is
  // never blank while the member list is still loading.
  const memberOf = useCallback((userId, fallbackName) => {
    if (!userId) return null;
    const m = ownerMembers[userId];
    return {
      id: userId,
      name: m?.displayName || fallbackName || m?.phone || 'Member',
      color: ownerColor(userId),
      avatarUrl: resolveAvatarUrl(m?.avatarUrl, serverBase),
      // The basic facts the popover lists under a name. Undefined while the
      // member list is loading, which the popover reads as "nothing to say"
      // rather than printing blanks.
      role: m?.role,
      phone: m?.phone,
      joined: m?.joined,
    };
  }, [ownerMembers, serverBase]);

  // ── Focus blocks, per task ─────────────────────────────────────────────
  //
  // Two facts a card shows: how many pomodoros a task has already had, and —
  // if one is running on it right now — how long is left. Both come from the
  // pond, which is the source of truth for a timer that has to survive the app
  // being backgrounded, killed, or opened on another device.
  //
  // GET /pomodoros is the whole list (server-capped at 200) so the counts are
  // ONE call rather than one per task; /pomodoros/active is the single running
  // block. Refetched when a timer is started from here, when the running block
  // runs out, and — since the pond started announcing focus changes — whenever
  // `pomodoro-task-changed` or `pomodoro-state` reaches the app-level socket,
  // which is what makes a block started on the desktop show up here. (This note
  // used to say "when the screen regains focus"; there has never been a
  // focus refetch of pomodoros, and there is still none — an event says it
  // better than a revisit can.)
  //
  // THREE MORE READS, because the pond keeps focus in two stores and the Focus
  // page has to see both (see the note on `mergeFocusLog`):
  //   · /pomodoro/stats — the chat timer's finished sessions, which is where a
  //     block with no task attached is the ONLY place it can be;
  //   · /pomodoro/widget — the unified "what is live right now", task-linked or
  //     loose, which is what lets the Focus tab's ring count down a block that
  //     no task owns.
  const [pomoByTask, setPomoByTask] = useState({});   // taskId -> completed count
  // Every block from both stores, joined and deduped — the Focus page's data.
  const [pomoLog, setPomoLog] = useState([]);
  // Tasks by id, as a ref: see boardOfTaskId.
  const tasksByIdRef = useRef(new Map());
  // { taskId, endsAt, startedAt, durationMinutes } — the length comes along so
  // the live key can draw how much of the block is LEFT, not just when it ends.
  const [activePomo, setActivePomo] = useState(null);
  // The LOOSE running block: the chat-style timer, when no task-linked one is
  // live. Same shape as activePomo with a null taskId, so the Focus page's ring
  // does not care which of the two it was handed.
  const [looseFocus, setLooseFocus] = useState(null);
  const loadPomodoros = useCallback(async () => {
    try {
      const [listRes, activeRes, chatRes, widgetRes] = await Promise.allSettled([
        api.get('/pomodoros'),
        api.get('/pomodoros/active'),
        // 200 is the endpoint's own ceiling, and the same cap /pomodoros has —
        // the two halves of the log are read to the same depth.
        api.get('/pomodoro/stats?limit=200'),
        api.get('/pomodoro/widget'),
      ]);
      const taskList = listRes.status === 'fulfilled' && Array.isArray(listRes.value?.pomodoros)
        ? listRes.value.pomodoros
        : [];
      if (listRes.status === 'fulfilled') {
        const counts = {};
        for (const p of taskList) {
          // Only blocks actually SEEN THROUGH count. A cancelled or abandoned
          // one is not focus the task received. Counted off the TASK list alone:
          // a loose block has no task to tally against.
          if (p?.taskId && p.status === 'completed' && p.completedAt) {
            counts[p.taskId] = (counts[p.taskId] || 0) + 1;
          }
        }
        setPomoByTask(counts);
      }
      // The raw run, kept as well as reduced: the cards want a count per task,
      // and the Focus page wants the blocks themselves (when, how long, seen
      // through or not). Both stores, one block each. A failed chat read is an
      // empty second half rather than a failed refresh — the task-linked half is
      // still worth showing.
      if (listRes.status === 'fulfilled' || chatRes.status === 'fulfilled') {
        const chatRecent = chatRes.status === 'fulfilled' && Array.isArray(chatRes.value?.recent)
          ? chatRes.value.recent
          : [];
        setPomoLog(mergeFocusLog(taskList, chatRecent));
      }
      if (activeRes.status === 'fulfilled') {
        const a = activeRes.value?.pomodoro;
        const mins = Number(a?.durationMinutes) || 25;
        // The stamp is the pond's clock; serverNow (when the pond sends it)
        // measures this phone against it, so the ring lands on the same second
        // the desktop shows — the same rule the loose timer always had.
        const startedAt = alignedStamp(Number(a?.startedAt), activeRes.value?.serverNow);
        const endsAt = a ? startedAt + mins * 60000 : null;
        setActivePomo(a?.taskId && endsAt > Date.now()
          ? { taskId: a.taskId, mode: 'focus', endsAt, startedAt, durationMinutes: mins }
          : null);
      }
      if (widgetRes.status === 'fulfilled') {
        const w = widgetRes.value;
        // `source: 'task'` is a block /pomodoros/active already told us about,
        // in more detail (it knows the taskId). Only the loose one is news.
        // Breaks are skipped: this drives the FOCUS ring.
        // Breaks ride along now that the deck can start one: a break you cannot
        // see counting down is a break you start twice. It carries its mode, so
        // the deck knows which of the two it is drawing — and `chatSessionToBlock`
        // still drops breaks from the STATS, because a break is time spent not
        // focusing and has no business in the totals or the streak.
        const liveMode = w?.mode === 'break' ? 'break' : 'focus';
        const wStartedAt = alignedStamp(Number(w?.startedAt), w?.serverNow);
        const wEndsAt = alignedStamp(Number(w?.endsAt), w?.serverNow);
        const loose = w?.active && w.source === 'server'
          && wEndsAt > Date.now()
          ? {
            taskId: null,
            mode: liveMode,
            startedAt: wStartedAt,
            endsAt: wEndsAt,
            durationMinutes: Math.max(1, Math.round((wEndsAt - wStartedAt) / 60000)),
          }
          : null;
        setLooseFocus(loose);
      }
    } catch { /* offline — the cards simply show no tally and no countdown */ }
  }, [api]);
  useEffect(() => { loadPomodoros(); }, [loadPomodoros]);

  // A focus block changing anywhere → re-read both stores. `pomodoro-task-changed`
  // is a task-linked block starting, stopping or completing (it lives in
  // `task_pomodoros`, which no socket used to announce, so the only surface that
  // ever noticed was the tray HUD — because it polls); `pomodoro-state` is the
  // pond's own timer, which is the loose block this page's ring can be drawing.
  // Both arrive as one counter off the app-level socket. This is what the comment
  // above USED to claim happened on screen focus, which it never did.
  const loadPomodorosRef = useRef(loadPomodoros);
  loadPomodorosRef.current = loadPomodoros;
  useEffect(() => {
    if (focusVersion === 0) return;   // the mount load already covers first paint
    loadPomodorosRef.current();
  }, [focusVersion]);

  // The push WITH the state: the pond's own stamps, applied the moment they
  // land — the ring moves before the re-read above has even gone out, and it
  // moves even when that read is slow. Undefined session = the pond could not
  // say → re-read; null = nothing running; a live block = draw it.
  useEffect(() => {
    if (!focusPush) return;
    const next = taskSessionFromPush(focusPush.payload, Date.now());
    if (next.action === 'set') setActivePomo(next.session);
    else if (next.action === 'clear') setActivePomo(null);
    else loadPomodorosRef.current();
  }, [focusPush]);

  // ── The task the next session is FOR ──────────────────────────────────────
  // An id rather than the task itself, so a rename or a reschedule while the
  // deck is open shows through instead of freezing a copy. Null = a loose
  // block, which is a perfectly good block: the deck counts either.
  const [focusTaskId, setFocusTaskId] = useState(null);
  // Read by startFocusHere, which must not be rebuilt every time the choice
  // changes — it is handed to a memoised page.
  const focusTaskIdRef = useRef(focusTaskId);
  focusTaskIdRef.current = focusTaskId;
  /**
   * Giving the task a slot on today's timeline at the minute the block began.
   *
   * THE DEFINITION IS FURTHER DOWN (`stampFocusSlot`) because it needs the
   * agenda's order-epoch bump, which is declared with the snapshot it belongs
   * to. Held in a ref — the same shape as `loadPomodorosRef` above — so all
   * three ways into a focus session can reach ONE definition rather than each
   * growing its own copy of the rule. That was the bug: the calendar's start
   * keys stamped, and the Focus tab's key, its search and a task card's key
   * did not, so whether working on something put it on the timeline depended
   * on which key you happened to press.
   */
  const stampFocusSlotRef = useRef(null);
  // The deck's own task picker. Its own query for the same reason the board
  // picker has one: three searches that inherited each other's half-typed words
  // would be one search with three names.
  const [focusPickOpen, setFocusPickOpen] = useState(false);
  const [focusPickQuery, setFocusPickQuery] = useState('');

  /**
   * The one block the Focus page's deck draws.
   *
   * Task-linked wins: it is the copy that knows which task the time belongs to,
   * and it is the precedence /pomodoro/widget and the timer bar already use — so
   * the deck, the task card's circle and the tray widget can never disagree
   * about which timer is the timer.
   */
  const focusBlock = activePomo || looseFocus;

  /**
   * The task the deck names — the RUNNING block's if there is one, otherwise
   * the one picked for the next session.
   *
   * The running block wins because it is the fact: a session started from a
   * task's own card, or from the header search, is task-linked without anything
   * here having chosen it, and a deck showing the task you were ABOUT to pick
   * while a different one counts down would be lying about what is running.
   */
  const focusTask = useMemo(() => {
    const id = focusBlock?.taskId || focusTaskId;
    if (!id) return null;
    return (tasks || []).find((t) => t && t.id === id) || null;
  }, [tasks, focusBlock, focusTaskId]);

  // Re-read once the running block has RUN OUT. The card retires its own live
  // key off its countdown, so this is not what clears the circle — it is what
  // moves the finished block into the task's tally without waiting for the
  // screen to be left and come back to. Keyed on the UNIFIED block, so a loose
  // one lands in the Focus page's figures the same way a task-linked one does.
  useEffect(() => {
    const endsAt = focusBlock?.endsAt;
    if (!endsAt) return undefined;
    const ms = endsAt - Date.now();
    if (ms <= 0) return undefined;
    // A second past the end: the server settles elapsed blocks on read, and
    // asking at the exact millisecond can land on the wrong side of that.
    const id = setTimeout(() => { loadPomodoros(); }, ms + 1000);
    return () => clearTimeout(id);
  }, [focusBlock, loadPomodoros]);

  // ── What the Focus page needs on top of the log ───────────────────────────
  // Which board a block's task belongs to. The blocks know only a taskId, and
  // "where did the time go" is the one question the log cannot answer alone.
  const boardOfTaskId = useCallback(
    (taskId) => boardOf(tasksByIdRef.current?.get(taskId)) || null,
    [],
  );
  /**
   * The task a logged block was for, or null.
   *
   * The same shape as boardOfTaskId and for the same reason: the log rows carry
   * a taskId and nothing else, so naming the task — or finding out it has been
   * deleted since — is the screen's job, not the page's. Null is a real answer
   * here, and the one that stops the Focus page offering to resume something
   * that no longer exists.
   */
  const taskOfId = useCallback(
    (taskId) => (taskId ? tasksByIdRef.current?.get(taskId) || null : null),
    [],
  );
  /**
   * The planned length of a fresh block, so the IDLE ring shows the length the
   * timer will actually run rather than a number of its own.
   *
   * Inferred from the last block that ran. It used to ask /pomodoro/widget for a
   * `focusMinutes`, which that endpoint has never returned — it answers about a
   * RUNNING timer, not about the saved settings — so the ring was pinned to 25
   * no matter what the pond was set to. The durations themselves live in the
   * pomodoro service's memory and are only ever announced over the socket
   * (`pomodoro-durations`); there is no REST read to ask instead.
   *
   * So: the length of the most recent block is the length of the next one, which
   * is right in every case except the first block after the setting was changed
   * somewhere else. Only the idle reading rides on this — a RUNNING ring counts
   * the live block's own duration, which comes off the server.
   */
  const [focusMinutes, setFocusMinutes] = useState(25);
  useEffect(() => {
    // pomoLog is newest-first, so the first usable planned length is the latest.
    const last = pomoLog.find((p) => Number(p?.durationMinutes) > 0);
    if (last) setFocusMinutes(Math.round(Number(last.durationMinutes)));
  }, [pomoLog]);

  /**
   * Start a focus block FROM THE FOCUS TAB, and stay on it.
   *
   * The task-card path (`startPomodoroFor`) routes through the chat's command
   * bus and jumps to the Turtle tab, because a task's block is announced in the
   * chat and its card lives there. This one must not: the ring on this page IS
   * the timer, and being thrown into a conversation to watch a countdown was the
   * whole complaint.
   *
   * So it goes straight at the REST start — the same endpoint the completion
   * notification's "Start focus" button uses — which starts the shared timer
   * server-side, broadcasts it to every other client over the socket, and writes
   * the session to history when it ends. No chat line, no navigation.
   *
   * The push token travels with it so the pond pings THIS device when the block
   * runs out (the same targeting the socket start uses). That is what keeps the
   * ding working when the app is in a pocket — the in-app chime only sounds when
   * the app is open to hear it.
   */
  const startFocusHere = useCallback(async () => {
    const startedAt = Date.now();
    const taskId = focusTaskIdRef.current;
    // Working on it IS the decision about when: an untimed task gets a slot on
    // today at this minute. Fired before the round trip, like the optimistic
    // block below — the schedule should answer the tap, not the network.
    if (taskId) stampFocusSlotRef.current?.(tasksByIdRef.current?.get(taskId));
    // Optimistically, because a deck that waits for a round trip is a deck that
    // does not answer the tap that started it. Corrected from the response a
    // moment later, which is also how the true duration arrives.
    //
    // A block WITH a task is the task-linked kind, so it lands in that task's
    // own tally and its card's little timer — which is the whole point of
    // assigning one, and is why the optimistic copy goes to activePomo rather
    // than to the loose slot.
    const optimistic = {
      taskId: taskId || null,
      mode: 'focus',
      startedAt,
      endsAt: startedAt + focusMinutes * 60000,
      durationMinutes: focusMinutes,
    };
    if (taskId) setActivePomo(optimistic); else setLooseFocus(optimistic);
    try {
      if (taskId) {
        // Cancels any in-flight block for us: one live timer at a time, the
        // same precedence the timer bar and the tray widget already use.
        await api.post('/pomodoro/start-task', { taskId, durationMinutes: focusMinutes });
        loadPomodoros();
        return;
      }
      const pushToken = await getExpoPushTokenSafe();
      const r = await api.post('/pomodoro/start', { mode: 'focus', pushToken: pushToken || undefined });
      const s = Number(r?.startedAt);
      const e = Number(r?.endsAt);
      if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
        setLooseFocus({
          taskId: null,
          mode: 'focus',
          startedAt: s,
          endsAt: e,
          durationMinutes: Math.max(1, Math.round((e - s) / 60000)),
        });
      }
    } catch {
      // The pond never took it. Put the deck back to idle rather than count
      // down a block that does not exist anywhere but here.
      if (taskId) setActivePomo(null); else setLooseFocus(null);
    }
  }, [api, focusMinutes, loadPomodoros]);

  /**
   * Start a BREAK, from the same deck.
   *
   * The other half of the cycle, and the same endpoint with the other mode —
   * the pond has always understood breaks; the planner simply had no way to ask
   * for one, so taking a break meant going to the chat tab to type `/pomodoro
   * break`. A break is never task-linked: it is time spent away from the work,
   * so pinning it to a task would be a lie the totals would then repeat.
   */
  const startBreakHere = useCallback(async () => {
    const startedAt = Date.now();
    setActivePomo(null);
    setLooseFocus({
      taskId: null,
      mode: 'break',
      startedAt,
      // Corrected the moment the pond answers — a break's length is the pond's
      // setting, not the focus length, and this is only what fills the gap.
      endsAt: startedAt + 5 * 60000,
      durationMinutes: 5,
    });
    try {
      const pushToken = await getExpoPushTokenSafe();
      const r = await api.post('/pomodoro/start', { mode: 'break', pushToken: pushToken || undefined });
      const s = Number(r?.startedAt);
      const e = Number(r?.endsAt);
      if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
        setLooseFocus({
          taskId: null,
          mode: 'break',
          startedAt: s,
          endsAt: e,
          durationMinutes: Math.max(1, Math.round((e - s) / 60000)),
        });
      }
    } catch {
      setLooseFocus(null);
    }
  }, [api]);

  /**
   * Stop whatever block is running, from the Focus tab.
   *
   * REST rather than the chat command bus: stopping a timer from the planner
   * should not put a line in a conversation. The endpoint cancels whichever
   * timer is live — task-linked first, the same precedence as everywhere else —
   * and the socket bridge tells the chat and the web app about it, so the card
   * over there goes away too.
   */
  const stopFocusHere = useCallback(async () => {
    // Both, on the tap: the ring must go idle immediately, and only one of the
    // two can have been live anyway.
    setActivePomo(null);
    setLooseFocus(null);
    try {
      await api.post('/pomodoro/stop', {});
    } catch { /* offline — the pond still has it, and the next read will say so */ }
    loadPomodoros();
  }, [api, loadPomodoros]);

  const pomodoroFor = useCallback((taskId) => {
    if (!taskId) return null;
    const count = pomoByTask[taskId] || 0;
    const live = activePomo?.taskId === taskId ? activePomo : null;
    // Nothing to say about this task — let the card skip the whole thing
    // rather than render a zero and an absent timer.
    if (!count && !live) return null;
    return {
      count,
      endsAt: live?.endsAt || null,
      startedAt: live?.startedAt || null,
      durationMinutes: live?.durationMinutes || null,
    };
  }, [pomoByTask, activePomo]);

  /**
   * Where a LIVE key goes. The running block's card lives on the Turtle tab —
   * the same place `startPomodoroFor` jumps to — so a tap on a counting-down
   * circle opens the timer it belongs to instead of starting a second block on
   * a task that is already being worked on.
   */
  const openPomodoro = useCallback(() => {
    navigation.navigate('Turtle');
  }, [navigation]);

  // The list a card's avatar stack opens. Held HERE, not in the calendar: a
  // popover mounted inside the day pane would be clipped by the pane, the
  // pager and the sheet in turn (docs/STYLE-RULES.md §4).
  const [peopleList, setPeopleList] = useState(null); // { people, anchor }
  const openPeopleList = useCallback((people, _task, anchor) => {
    if (!people?.length) return;
    tapHaptic();
    setPeopleList({ people, anchor });
  }, []);

  // The member behind the open profile card. The task DTO is the FALLBACK, not
  // the source: it knows the id and the name, so the card still opens with
  // something real on a pond that could not be reached.
  const profileFriend = useMemo(() => {
    if (!profileOwner) return null;
    const member = ownerMembers[profileOwner.userId];
    return {
      ...(member || {}),
      id: profileOwner.userId,
      displayName: member?.displayName || profileOwner.ownerName || null,
    };
  }, [profileOwner, ownerMembers]);

  // Keep the owner filter honest if the underlying set shrinks (e.g. a member's
  // tasks disappear): drop any selected id that no longer exists.
  useEffect(() => {
    setSelectedOwners((prev) => {
      if (prev.length === 0) return prev;
      const valid = prev.filter((id) => owners.some((o) => o.userId === id));
      return valid.length === prev.length ? prev : valid;
    });
  }, [owners]);

  // ── Selected-day completion (drives the header count + full-width bar) ──
  // Per-board progress for the rail — done / total / overdue, board-wide
  // (the rail is the status view; filters scope the list, not the rail).
  const boardStats = useMemo(() => {
    const today = localTodayStr();
    const stats = { All: { total: 0, done: 0, overdue: 0 } };
    for (const name of projects) stats[name] = { total: 0, done: 0, overdue: 0 };
    for (const t of tasks) {
      if (!t || itemTypeOf(t) !== 'task') continue;
      const done = !!(t.completed || isTaskDoneNow(t));
      const late = !done && !!t.dueDate && t.dueDate < today;
      const buckets = [stats.All];
      if (t.project && stats[t.project]) buckets.push(stats[t.project]);
      for (const b of buckets) { b.total += 1; if (done) b.done += 1; if (late) b.overdue += 1; }
    }
    return stats;
  }, [tasks, projects]);
  // Tasks under the DONE key: the calendar and the tree take a pre-filtered
  // list; the agenda gates below.
  const doneTasks = useMemo(() => (doneOnly ? tasks.filter((t) => t && (t.completed || isTaskDoneNow(t))) : tasks), [tasks, doneOnly]);

  // Create a memoized mapping of project names to colors
  const projectColorMap = useMemo(() => {
    const map = {};
    projects.forEach((project, index) => {
      map[project] = boardColorAt(index);
    });
    return map;
  }, [projects]);

  // Get color for a project. Memoized on the map it reads: it is handed to
  // MEMOIZED children (the calendar's month pages and day panes), whose
  // comparators shallow-compare every prop — a fresh closure each render would
  // bust their memo on every keystroke elsewhere on the screen.
  const getProjectColor = useCallback((projectName) => {
    if (!projectName || projectName === 'All') return theme.colors.textSecondary;
    return projectColorMap[projectName] || theme.colors.textSecondary;
  }, [projectColorMap, theme.colors.textSecondary]);
  
  // Use collapsible tasks hook - ALL collapsed by default
  const collapsible = useCollapsibleTasks(doneTasks, projects, {
    showIncompleteOnly,
    selectedProject,
    selectedTags,
    tagFilterMode,
    selectedOwners,
    searchQuery,
  });

  // ── THE AGENDA'S FROZEN ORDER ───────────────────────────────────────────────
  // The agenda (Past band + Upcoming band) renders from an ORDER SNAPSHOT that
  // is rebuilt only at explicit boundaries — NEVER because a task's fields
  // changed. This is the from-scratch fix for "ticking a checkbox blanks the
  // tab": every previous design re-partitioned/re-sorted the bands on the tick
  // commit (completed flips, a recurring dueDate advances, done-now re-stamps),
  // which moved/removed the very rows FlashList was anchored to — and each
  // patched path (sticky pins, mvcp blips, divider dedup) left another one.
  // With a frozen order a tick is a PURE REPAINT: same ids, same keys, same
  // positions, same fixed heights — the list is geometrically inert, so there
  // is nothing left that CAN blank, by construction.
  //
  // Rebuild boundaries (the snapshot's deps + explicit bumps):
  //   • membership changes — a task ADDED or DELETED (ids join/leave; covers
  //     creations from any composer, and remote adds/deletes, which now really
  //     do arrive by socket: `tasks:changed` → lazyRefresh → a new id set. When
  //     this note was written no task socket existed, so the only way a remote
  //     add reached the list was the user pulling to refresh),
  //   • the active filters / search / board scope change,
  //   • the screen regains FOCUS (returning to the tab re-files ✓ rows into
  //     history — same "on the next visit" behaviour the pins had),
  //   • an EDIT-FORM save (dates/projects can move a row between groups —
  //     handleSaveTask bumps `orderEpoch` explicitly).
  // Content edits that arrive between boundaries (ticks, server echoes of
  // them) hydrate into the SAME slots via tasksById below.
  const [orderEpoch, setOrderEpoch] = useState(0);
  const bumpOrderEpoch = useCallback(() => setOrderEpoch((e) => e + 1), []);
  useEffect(() => {
    // Deferred one frame: the focus re-snapshot (re-files ✓ rows into history)
    // used to run synchronously INSIDE the tab-switch frame, so every return
    // to this tab paid a full agendaOrder rebuild before anything painted.
    // rAF lets the already-rendered tab appear instantly; the rebuild lands on
    // the next frame — same behavior, imperceptibly later.
    const unsub = navigation.addListener('focus', () => {
      requestAnimationFrame(bumpOrderEpoch);
      // Coming back to the tab is also a catch-up. The web app has refetched on
      // window focus all along; mobile had NO focus refetch of any kind, which is
      // why the phone could show a days-old list. Silent and coalescing, so the
      // re-snapshot above still paints first.
      lazyRefreshRef.current();
    });
    return unsub;
  }, [navigation, bumpOrderEpoch]);

  /**
   * Starting a focus session on an untimed task gives it a slot on TODAY, at the
   * minute the block began.
   *
   * WHAT and WHEN live in utils/focusStart (`startPatch`, pure and tested on its
   * own); this is the write. It is a no-op for a task that already has a time
   * and for a loose block, which is what makes it safe to call from every start
   * path unconditionally.
   *
   * One MERGING patch of this row, like a reschedule — a whole-list save is a
   * delete-and-reinsert on the server, so it would clobber whatever another
   * device changed meanwhile. Its own outbox key ('schedule'), because a queued
   * stamp and a queued tick of the same task are different writes and must both
   * survive.
   *
   * The clock is read HERE, at the press, rather than from any ticking minute
   * the calendar keeps: "when the session started" has to be the real minute.
   */
  const stampFocusSlot = useCallback(async (task) => {
    const patch = startPatch(task);
    if (!patch) return;
    const nextTasks = tasksRef.current.map((t) => (t.id === task.id ? { ...t, ...patch } : t));
    try {
      await saveTaskPatch(task.id, patch, nextTasks, 'schedule');
    } catch {
      /* saveTaskPatch has already reverted the row and told the user */
      return;
    }
    // The row has moved out of the day's untimed list and onto its timeline, so
    // it now belongs under a different heading — a frozen-order boundary, the
    // same as a reschedule.
    bumpOrderEpoch();
  }, [saveTaskPatch, bumpOrderEpoch]);
  stampFocusSlotRef.current = stampFocusSlot;

  // Changes ONLY when the SET of task ids changes — edits to existing tasks
  // (ticks included) leave it identical, so the snapshot below doesn't re-run.
  const membershipKey = useMemo(() => (tasks || []).map((t) => t.id).sort().join('\n'), [tasks]);

  // The snapshot: ordered {id, dateKey} entries per band, partitioned + sorted
  // with the SAME rules the live memos used, evaluated once per boundary.
  // dateKeys are FROZEN here too, so the divider structure (which derives from
  // them) cannot change between boundaries either — a recurring tick advances
  // the task's dueDate, but its row stays in the group it was in.
  // Reads tasks via tasksRef (kept current inline during render) so the
  // deliberate exclusion of `tasks` from the deps never reads stale data when
  // a boundary DOES fire.
  const agendaOrder = useMemo(() => {
    const source = tasksRef.current || [];
    const todayStr = localTodayStr();
    const now = new Date();
    const nowMs = now.getTime();
    const filters = { selectedProject, selectedTags, tagFilterMode, selectedOwners, searchQuery };
    const hasDate = (t) => typeof t.dueDate === 'string' && !!t.dueDate;
    // A today-dated task whose TIME has already passed is overdue — it belongs
    // in the Past band, not Upcoming (mirrors isPast's today-branch exactly, so
    // every task lands in exactly one band).
    const duePassedToday = (t) => {
      if (t.dueDate === todayStr && t.time) {
        const [h, m] = String(t.time).split(':').map(Number);
        const due = new Date(now); due.setHours(h || 0, m || 0, 0, 0);
        return due.getTime() < nowMs;
      }
      return false;
    };
    // "Past" = completed (or done-now recurring) OR an incomplete item whose
    // due moment has already passed.
    const isPast = (t) => {
      if (t.completed || isTaskDoneNow(t)) return true;
      if (hasDate(t)) {
        if (t.dueDate < todayStr) return true;
        return duePassedToday(t);
      }
      return false;
    };
    // Past sorts ASCENDING by the DUE date first (ticking never re-sorts a
    // dated row); done-now recurring rows stamp by the day they were ticked
    // (their dueDate has already advanced); undated completions fall back to
    // completion/creation time.
    const stampOf = (t) => {
      if (isTaskDoneNow(t) && !t.completed) {
        const d = lastCompletedDate(t);
        if (d) return new Date(`${d}T23:59:59`).getTime();
      }
      if (hasDate(t)) {
        const [h, m] = String(t.time || '00:00').split(':').map(Number);
        const dd = new Date(`${t.dueDate}T00:00:00`);
        dd.setHours(h || 0, m || 0, 0, 0);
        return dd.getTime();
      }
      if (t.completedAt) return t.completedAt;
      const d = lastCompletedDate(t);
      if (d) return new Date(`${d}T23:59:59`).getTime();
      return t.createdAt || 0;
    };
    const visible = source.filter((t) => t && taskPassesFilters(t, filters));
    // "Show incomplete only" is a LIST-level concern (see taskHelpers' note on
    // why completion isn't in taskPassesFilters), applied here at SNAPSHOT time
    // rather than in the live hydration path. That keeps a tick a pure repaint:
    // the ticked row holds its slot until the next rebuild boundary (refocus /
    // add / delete / edit-save), exactly like every other filter — filtering it
    // live would yank the row out from under FlashList mid-tick, the very class
    // of bug the frozen order exists to prevent.
    // Only completed / done-now rows drop; overdue-but-OPEN tasks are still
    // incomplete, so they stay in the Past band.
    const inScope = statusFilter === 'todo'
      ? visible.filter((t) => !(t.completed || isTaskDoneNow(t)))
      : statusFilter === 'done'
        ? visible.filter((t) => t.completed || isTaskDoneNow(t))
        : visible;
    const past = inScope
      .filter(isPast)
      .map((t) => ({ t, k: stampOf(t) }))
      .sort((a, b) => a.k - b.k)
      .map(({ t }) => ({ id: t.id, dateKey: agendaRowDateKey(t) }));
    // Upcoming: dated open tasks from today onward (date asc, timed before
    // untimed within a day), then the undated backlog newest-first. Grouping
    // key = the due date it was SORTED under (undated rows get no divider).
    const open = inScope.filter((t) => !isPast(t));
    const dated = open
      .filter(hasDate)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || String(a.time || '99:99').localeCompare(String(b.time || '99:99')));
    const undated = open
      .filter((t) => !hasDate(t))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const upcoming = [
      ...dated.map((t) => ({ id: t.id, dateKey: t.dueDate.slice(0, 10) })),
      ...undated.map((t) => ({ id: t.id, dateKey: null })),
    ];
    return { past, upcoming };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membershipKey, orderEpoch, selectedProject, selectedTags, tagFilterMode, selectedOwners, searchQuery, statusFilter]);

  // Live lookup for hydration — fresh objects every tasks change, so a ticked
  // row repaints (✓, strikethrough) in its frozen slot.
  const tasksById = useMemo(() => {
    const m = new Map();
    for (const t of tasks || []) m.set(t.id, t);
    return m;
  }, [tasks]);
  // Read by boardOfTaskId, which is declared ABOVE this (it is passed to the
  // Focus page) and must not be rebuilt on every task edit — a new function
  // identity there would re-aggregate every block on every keystroke.
  tasksByIdRef.current = tasksById;

  // Hydrated bands: frozen order + live data, with the frozen dateKey arrays
  // kept index-ALIGNED (a deleted id drops from both in the same pass).
  const pastBand = useMemo(() => {
    const rows = []; const keys = [];
    for (const e of agendaOrder.past) {
      const t = tasksById.get(e.id);
      if (t) { rows.push(t); keys.push(e.dateKey); }
    }
    return { rows, keys };
  }, [agendaOrder, tasksById]);
  const upcomingBand = useMemo(() => {
    const rows = []; const keys = [];
    for (const e of agendaOrder.upcoming) {
      const t = tasksById.get(e.id);
      if (t) { rows.push(t); keys.push(e.dateKey); }
    }
    return { rows, keys };
  }, [agendaOrder, tasksById]);
  // Downstream (zone building, fills, counts, headers) keeps its names.
  const upcomingTasks = upcomingBand.rows;

  // ── History band: SCROLL UP to reveal done/overdue tasks ───────────────────
  // The backlog (completed + overdue) always sits ABOVE "Upcoming", but the view
  // is ANCHORED to Upcoming on mount so it stays hidden until you scroll UP into
  // it — no pull-to-refresh gesture. Older batches then lazy-load as you keep
  // going, back to the very first task. maintainVisibleContentPosition keeps the
  // viewport pinned during those upward loads, and a floating "Latest" button
  // appears while you're up in the past to jump back down to Upcoming.
  const PAST_BATCH = 30;
  // Start with history HIDDEN (limit 0) so the list opens on "Upcoming" (today)
  // at the very top instead of deep in the past. Older/completed tasks then
  // lazy-load ABOVE as you scroll UP. This replaces the old "open in the past,
  // then scrollToLocation down to today" anchor, which janked/failed over the
  // long virtualized distance and left you staring at last month's tasks on load.
  const [pastLimit, setPastLimit] = useState(0);
  const [viewingPast, setViewingPast] = useState(false);
  // Whether the history zone above Upcoming is MATERIALIZED. False at mount so
  // the list opens exactly on today (any pre-mounted content above would claim
  // offset 0); flipped ONCE, AT IDLE, shortly after first paint (see the
  // preload effect below) — never during a gesture. That mounts a capped set
  // of SKELETON placeholder rows above; the position-pin's compensation runs
  // on a still viewport, so nothing visibly moves. From then on the user's
  // own scrolling is the only driver: placeholders FILL IN-PLACE as they
  // become visible (same task-id keys, so the swap moves nothing) and the
  // layout never changes shape again. No gesture hooks, no readjustments.
  // Armed PER SCOPE. The arm is stored as the scope key it was granted for, so
  // the moment the scope (board / status / tags / owners / search) changes the
  // zone reads as disarmed IN THE SAME RENDER — the list remounts (key below)
  // with no history above Upcoming, opens at offset 0 exactly like first
  // paint, and the preload effect re-arms it one idle beat later. Before this
  // the zone survived a board change: the list kept a scroll offset sized for
  // the OLD board's history while the new board's was a fraction of it, and
  // FlashList's native position-hold anchored on a recycled cell — a screen of
  // blank above "Upcoming" (the "massive margin" bug).
  const agendaScopeKey = useMemo(
    () => JSON.stringify([selectedProject, statusFilter, selectedTags, tagFilterMode, selectedOwners, searchQuery]),
    [selectedProject, statusFilter, selectedTags, tagFilterMode, selectedOwners, searchQuery],
  );
  const [pastArmedKey, setPastArmedKey] = useState(null);
  const pastArmed = pastArmedKey === agendaScopeKey;
  const setPastArmed = useCallback((v) => setPastArmedKey(v ? agendaScopeKey : null), [agendaScopeKey]);
  // A scope change also drops the "viewing history" pill and any fill lock.
  useEffect(() => {
    setViewingPast(false);
    growReadyRef.current = true;
    placeholderVisibleRef.current = false;
    scrollY.current = 0;
  }, [agendaScopeKey]);
  // One upward batch in flight at a time. Cleared when a grow is dispatched,
  // re-armed once the new slice actually commits — scrollEventThrottle floods
  // the near-top zone with events, and without this every frame would stack
  // another +PAST_BATCH grow.
  const growReadyRef = useRef(true);
  // Whether any skeleton placeholder is currently on screen (kept fresh by
  // onViewableItemsChanged). Drives the self-sustaining fill chain in the
  // re-arm effect: fills convert rows at the seam, which may be below the
  // viewport — this ref is how the chain knows the user is still looking at
  // unfilled cells.
  const placeholderVisibleRef = useRef(false);
  // Every cell in the history zone is FIXED-HEIGHT — real rows via
  // TimelineTaskRow's `uniform` mode (UNIFORM_ROW_H), placeholders via
  // PastPlaceholderRow (identical footprint), and date dividers locked to
  // PAST_DIVIDER_H. With FlashList (chat-grade recycler) this uniformity is
  // what makes recycling estimates exact and the skeleton→real swaps
  // dimensionally invisible; the old SectionList-era seam arithmetic
  // (measured header/footer + bodyH + a correction loop) is gone — FlashList's
  // built-in maintainVisibleContentPosition holds the viewport through the
  // zone's one idle mount, exactly like the chat holds position when history
  // prepends.
  // 12 padding + a 19pt line box + 5 + the 1pt rule + 14 padding = 51. Spelled
  // out as the sum rather than as a magic 51 because it is NOT free to be
  // wrong: the whole zone's recycling estimates are built on every divider
  // being exactly this tall, so anything that changes agendaDateLabel's line
  // box has to come back here.
  const PAST_DIVIDER_H = Math.round((12 + 19 + 5 + 1 + 14) * Math.max(1, PixelRatio.getFontScale()));
  // A band header's own height ("Past" / "Upcoming" — icon, label, count, on
  // theme.spacing.sm of padding). Only ever used as a LEAD-IN estimate (see
  // the pointer's virtual lead), never as layout, so an approximation is honest
  // it would not be in the history zone's arithmetic above.
  const AGENDA_BAND_HEAD_H = Math.round(30 * Math.max(1, PixelRatio.getFontScale()));
  // Stable divider items per date-key OCCURRENCE. Keyed `date#n` (not just the
  // date): the sort stamp and the group key can disagree for legacy undated
  // tasks, letting the same date recur non-contiguously — reusing one object
  // for both runs would emit duplicate list keys and corrupt the in-place
  // swap reconciliation.
  const dividerItemsRef = useRef(new Map());
  // Same, for the Upcoming band's date dividers (separate id namespace).
  const upDividerItemsRef = useRef(new Map());
  // The Past band renders from the SAME frozen snapshot (see agendaOrder):
  // partition, order and divider keys were all fixed at the last boundary, so
  // a tick up here — completing an overdue task, ticking a recurring series —
  // repaints the row where it sits. No mvcp blips, no relocation cases.
  const pastTasks = pastBand.rows;

  const pastAllLoaded = pastLimit >= pastTasks.length;

  // Rendered window = the most-recent `pastLimit` past tasks; growing the limit
  // pulls OLDER ones in at the top.
  const pastSlice = useMemo(() => {
    if (!pastTasks.length) return [];
    return pastTasks.slice(Math.max(0, pastTasks.length - pastLimit));
  }, [pastTasks, pastLimit]);

  // Fill the next older batch: visible PLACEHOLDER rows become real rows
  // IN-PLACE (the placeholder and the row it becomes share the task-id key, so
  // nothing in the layout moves — no scroll bookkeeping at all). growReady =
  // one batch in flight at a time (viewability events can burst); the 90ms
  // defer keeps the 30-row commit off the scroll gesture's critical path —
  // the placeholders are already on screen pulsing, so the beat reads as
  // data arriving, not jank.
  const olderTimerRef = useRef(null);
  const loadOlderPast = useCallback(() => {
    if (!growReadyRef.current) return;
    if (pastLimit >= pastTasks.length) return; // nothing older left
    growReadyRef.current = false;
    olderTimerRef.current = setTimeout(() => {
      olderTimerRef.current = null;
      setPastLimit((n) => Math.min(pastTasks.length, n + PAST_BATCH));
    }, 90);
  }, [pastTasks.length, pastLimit]);
  useEffect(() => () => { if (olderTimerRef.current) clearTimeout(olderTimerRef.current); }, []);
  // Viewability handlers must be identity-stable (SectionList requirement), so
  // the fill trigger reaches the CURRENT loader through a ref.
  const loadOlderRef = useRef(loadOlderPast);
  loadOlderRef.current = loadOlderPast;

  // Tagged-copy caches, keyed on the ORIGINAL task object. Tagging used to
  // spread fresh copies on every render, so growing the history window gave
  // EVERY row (past + upcoming + tree) a new item identity → memoized rows all
  // re-rendered → each upward batch janked the whole list. Reusing the same
  // copy while the underlying task object is unchanged keeps row identities
  // stable, so a prepend only mounts the new rows. A data refetch replaces the
  // task objects themselves → fresh copies, as it should.
  const taggedPastRef = useRef(new WeakMap());
  const taggedUpcomingRef = useRef(new WeakMap());
  // Placeholder copies get their own cache: the SAME task renders first as a
  // skeleton ({__placeholder}) and later as a real row — two distinct stable
  // identities, one shared list key (the task id), which is what makes the
  // fill an in-place swap the layout never feels.
  const placeholderPastRef = useRef(new WeakMap());
  const tagCopy = (cache, t, flag) => {
    let c = cache.get(t);
    if (!c) {
      c = { ...t, [flag]: true };
      cache.set(t, c);
    }
    return c;
  };
  const placeholderCopy = (t) => {
    let c = placeholderPastRef.current.get(t);
    if (!c) {
      c = { id: t.id, __past: true, __placeholder: true };
      placeholderPastRef.current.set(t, c);
    }
    return c;
  };

  // EVERY not-yet-loaded past task, as a skeleton row — the FULL history is
  // indexed the moment the zone arms (photo-vault style: every item owns its
  // slot up front). This keeps the section's item count CONSTANT at
  // pastTasks.length for the whole session: the earlier design windowed the
  // placeholders to one batch, so each fill ADDED items above (extent kept
  // changing → the list "jumped around"). Now a fill only flips existing
  // cells from skeleton to real (same keys) — the length never moves, so
  // neither does the scroll. Off-screen cells stay unmounted (virtualized),
  // so thousands of light placeholder entries cost nothing.
  // The FULL history zone, indexed up front (photo-vault style): every past
  // task owns a fixed-height cell from the moment the zone arms — REAL date
  // dividers included as their own fixed-height data items, with labels
  // computed from the indexed tasks' dates (all local data), so the date
  // lines show immediately while row content fills in async. The divider
  // set derives from task dates alone — IDENTICAL before and after any fill
  // — so a fill flips row cells skeleton→real (same keys) and nothing else:
  // the section's cell count and every cell's height are constants.
  const pastZone = useMemo(() => {
    if (!pastArmed || !pastTasks.length) return { data: [] };
    const end = Math.max(0, pastTasks.length - pastLimit); // first LOADED index
    const data = [];
    let prevKey = null;
    const runCounts = new Map(); // dateKey → how many runs of it seen this walk
    for (let i = 0; i < pastTasks.length; i++) {
      const t = pastTasks[i];
      // FROZEN group key (index-aligned with the frozen order): the divider
      // structure was fixed at the last snapshot boundary, so a tick that
      // changes a task's dates cannot add/move/remove a divider mid-session.
      const key = pastBand.keys[i];
      if (key && key !== prevKey) {
        // Occurrence-suffixed identity: sort stamp and group key can disagree
        // for legacy undated tasks, so a date CAN start a second run — each
        // run must be its own list item or keys collide.
        const run = runCounts.get(key) || 0;
        runCounts.set(key, run + 1);
        const cacheKey = `${key}#${run}`;
        let div = dividerItemsRef.current.get(cacheKey);
        if (!div) {
          div = { id: run === 0 ? `div-${key}` : `div-${key}-${run}`, __past: true, __divider: true, dateKey: key };
          dividerItemsRef.current.set(cacheKey, div);
        }
        data.push(div);
        prevKey = key;
      }
      data.push(i < end ? placeholderCopy(t) : tagCopy(taggedPastRef.current, t, '__past'));
    }
    return { data };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastArmed, pastTasks, pastLimit]);

  // The agenda is ONE FLAT list, chat-style (the Turtle chat is the reference
  // for how this should scroll — FlashList's recycler + its built-in
  // maintainVisibleContentPosition are what make the chat silky, so the
  // agenda now uses the exact same shape): headers, date dividers, gaps,
  // placeholders and rows are all typed ITEMS. The boards tree lives on its
  // own pushed page. Chrome items keep stable identities via a ref.
  const agendaChrome = useRef({
    pastHeader: { id: 'agenda-past-header', __agendaHeader: 'past' },
    upcomingHeader: { id: 'agenda-upcoming-header', __agendaHeader: 'upcoming' },
    // The dashed "Add task" template card that heads the Upcoming band.
    addCard: { id: 'agenda-add-card', __addCard: true },
    pastGap: { id: 'agenda-past-gap', __gap: true },
    upcomingGap: { id: 'agenda-upcoming-gap', __gap: true },
  }).current;
  const agenda = useMemo(() => {
    const items = [];
    if (pastZone.data.length) {
      items.push(agendaChrome.pastHeader);
      items.push(...pastZone.data);
      items.push(agendaChrome.pastGap);
    }
    let upcomingHeaderIndex = -1;
    // The band renders even with no rows (outside a search) so the add card
    // is always there to start from — an empty board reads as an invitation.
    if (upcomingTasks.length || !searchQuery) {
      upcomingHeaderIndex = items.length;
      items.push(agendaChrome.upcomingHeader);
      items.push(agendaChrome.addCard);
      // Upcoming's date dividers as items too (same architecture as the past
      // zone — no inline prev-row peeking in renderItem). Tag the row copies
      // (__upcoming) so their keys don't collide with the SAME task shown in
      // the boards page's groups.
      let prevKey = null;
      const runCounts = new Map(); // dateKey → runs seen this walk (belt-and-braces)
      for (let i = 0; i < upcomingTasks.length; i++) {
        const t = upcomingTasks[i];
        // FROZEN group key (index-aligned with the frozen order — the due date
        // the row was SORTED under at the last boundary). A tick that advances
        // a recurring task's dueDate can't re-emit an already-used date group:
        // the divider walk sees the snapshot, not the live field, so duplicate
        // divider keys — the recycler corruption that blanked this tab — are
        // impossible between boundaries. Undated rows get no divider.
        const key = upcomingBand.keys[i];
        if (key && key !== prevKey) {
          // Occurrence-suffixed identity, mirroring the past zone: even if sort
          // and grouping ever diverge again, a second run of a date becomes its
          // OWN item (a harmless extra label) — never one object twice.
          const run = runCounts.get(key) || 0;
          runCounts.set(key, run + 1);
          const cacheKey = `${key}#${run}`;
          let div = upDividerItemsRef.current.get(cacheKey);
          if (!div) {
            div = { id: run === 0 ? `updiv-${key}` : `updiv-${key}-${run}`, __upcoming: true, __divider: true, dateKey: key };
            upDividerItemsRef.current.set(cacheKey, div);
          }
          items.push(div);
          prevKey = key;
        }
        items.push(tagCopy(taggedUpcomingRef.current, t, '__upcoming'));
      }
      items.push(agendaChrome.upcomingGap);
    }
    return { items, upcomingHeaderIndex };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcomingTasks, pastZone, searchQuery]);
  // "Scroll to today" reads the CURRENT seam index, not a captured one.
  const upcomingHeaderIndexRef = useRef(-1);
  upcomingHeaderIndexRef.current = agenda.upcomingHeaderIndex;

  // Re-arm the filler once a dispatched batch has actually committed — the
  // paired clear lives inside loadOlderPast. Keyed on the slice length so an
  // all-loaded no-op grow keeps it disarmed until the data changes;
  // pastTasks.length covers the pool itself growing while the window is
  // exhausted (e.g. first completion of the day). The arm is deferred one
  // frame so events queued before the commit can't stack a second batch.
  // THEN the chain self-sustains: fills always convert the NEWEST unloaded
  // rows (at the seam), which with the fully-indexed zone can be BELOW the
  // viewport while the user parks far up in older skeletons — the visible
  // set doesn't change, so viewability won't re-fire on its own. If
  // placeholders are still on screen (ref kept by onViewableItemsChanged),
  // keep filling until the view holds only real rows.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      growReadyRef.current = true;
      // Refresh viewability truth BEFORE trusting placeholderVisibleRef: an
      // in-place fill doesn't change the viewable key set, so the callback
      // won't re-fire on its own and the ref can hold a stale true — which
      // would chain-load ALL of history in the background. recordInteraction
      // forces a re-evaluation; the correction lands within a frame, bounding
      // any overshoot to a single extra batch.
      try { listRef.current?.recordInteraction?.(); } catch (e) { /* ignore */ }
      if (placeholderVisibleRef.current) loadOlderRef.current?.();
    });
    return () => cancelAnimationFrame(raf);
  }, [pastSlice.length, pastTasks.length]);

  // PRELOAD the skeleton zone: one idle beat after first paint (and again
  // after every "Scroll to today" remount, which disarms it), the placeholder
  // set mounts above Upcoming while the viewport is STILL — the pin's offset
  // compensation lands invisibly because nothing is moving. By the time the
  // user scrolls up, the dummies are already there: plain native scrolling
  // into pre-existing content, zero gesture-time mounting, zero readjustment.
  // Deferred while the keyboard is up (the viewport is not still while it
  // moves); the keyboardVisible dep re-runs the timer once it settles.
  useEffect(() => {
    if (pastArmed || pastTasks.length === 0 || keyboardVisible) return;
    const t = setTimeout(() => {
      // Fills stay locked over the mount commit; the effect below releases
      // them once FlashList's position-hold has absorbed the insertion.
      growReadyRef.current = false;
      setPastArmed(true);
    }, 80); // right after first paint — the zone is part of "initial load"
    return () => clearTimeout(t);
  }, [pastArmed, pastTasks.length, keyboardVisible]);

  // Eager-arm guard against the empty-flash. The preload effect above arms the
  // history zone on an 80ms idle beat (to protect the mount's "open on today at
  // offset 0" anchor). But if the agenda would otherwise render EMPTY — no
  // upcoming rows left while past tasks exist — that 80ms is a visible flash of
  // the "no tasks" empty state before the just-completed task reappears in
  // history (completing your LAST upcoming task, with the zone not yet armed:
  // pastTasks goes 0→1 but pastZone stays [] until arm). With zero upcoming
  // rows there's no offset-0 anchor to protect, so arm IMMEDIATELY. useLayoutEffect
  // flips it before the empty frame paints, so there's no flash at all.
  useLayoutEffect(() => {
    if (!pastArmed && pastTasks.length > 0 && upcomingTasks.length === 0) {
      setPastArmed(true);
    }
  }, [pastArmed, pastTasks.length, upcomingTasks.length]);

  // Post-arm release. FlashList's built-in maintainVisibleContentPosition
  // holds the viewport through the zone's insertion natively (the chat's
  // exact mechanism for history prepends) — there is NO positioning loop
  // anymore. One beat after the mount commits, unlock fills and kick a
  // truthful viewability pass (a placeholder already on screen won't re-fire
  // the callback on its own).
  useEffect(() => {
    if (!pastArmed) return;
    const t = setTimeout(() => {
      growReadyRef.current = true;
      try { listRef.current?.recordInteraction?.(); } catch (e) { /* ignore */ }
    }, 160);
    return () => clearTimeout(t);
  }, [pastArmed]);

  // While any history row is on-screen, offer a jump back down to "latest" —
  // and whenever a PLACEHOLDER row is on-screen, fill it: this is the whole
  // lazy-load driver now. Scrolling into the skeleton zone loads that batch
  // in-place; parked in it, the chain continues (fill → commit → re-arm →
  // still-visible placeholders → next fill) until the view has no skeletons.
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 30 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    let anyPast = false;
    let anyPlaceholder = false;
    for (const v of viewableItems) {
      if (!v.item) continue;
      if (v.item.__past) anyPast = true;
      if (v.item.__placeholder) anyPlaceholder = true;
    }
    setViewingPast((prev) => (prev === anyPast ? prev : anyPast));
    // Freshness for the self-sustaining chain (see the re-arm effect): fills
    // stop the moment no skeleton is on screen.
    placeholderVisibleRef.current = anyPlaceholder;
    if (anyPlaceholder) loadOlderRef.current?.();
  }).current;

  // ── The timeline pointer ──────────────────────────────────────────────────
  // A fixed mark on the gutter's edge that reads whatever the agenda is
  // passing under it. Scrolling scrubs the timeline PAST the pointer, so the
  // mark itself never moves — it's the one still thing on the screen, and its
  // readout is where you are in the timeline.
  //
  // Position is a fraction of the list's height (an upper-third playhead),
  // clamped so it stays sane on a very short or very tall viewport.
  const [listH, setListH] = useState(0);
  const pointerTop = Math.max(110, Math.min(280, Math.round(listH * 0.3)));
  // ── The lead-in above the first card, no longer drawn ─────────────────────
  //
  // The mark is pinned `pointerTop` into the list and the list scrolls past it,
  // so without depth above the agenda's first item the TOP of the timeline can
  // never reach the mark: scrolled all the way up, the first card sits above
  // it, and the one row you cannot read is the one you are looking at.
  //
  // That depth used to be real padding, and it looked like exactly what it was
  // — you opened the Agenda and the first thing you saw was a band of nothing.
  // So the page draws none, and the same depth is supplied to the POINTER
  // instead as a virtual lead it spends over the first few points of scroll
  // (see `markContentY`). The blank band goes; the first card stays reachable.
  //
  // How deep: enough to bring the first card's CENTRE to the mark, not its top
  // edge. The old padding aimed at the top and was therefore half a card deeper
  // than anything needed. Measured against the chrome that ALWAYS precedes the
  // first card of a band — its header and its first date divider — plus half a
  // uniform card, so it holds whatever that first card turns out to be.
  // One term drawn, one term virtual, and their sum is the depth the mark needs
  // — see `virtualLeadFor`, which owns the arithmetic so the two cannot drift
  // apart the next time either of them is tuned.
  const agendaVirtualLead = virtualLeadFor({
    pointerTop,
    chromeAbove: AGENDA_BAND_HEAD_H + PAST_DIVIDER_H,
    cardHeight: UNIFORM_CARD_H,
    drawnPad: AGENDA_TOP_PAD,
  });
  const agendaVirtualLeadRef = useRef(agendaVirtualLead);
  agendaVirtualLeadRef.current = agendaVirtualLead;
  const pointerTopRef = useRef(pointerTop);
  pointerTopRef.current = pointerTop;
  const [pointerLabel, setPointerLabel] = useState(null);
  // The row the mark is on. State rather than a ref because the list has to
  // re-render to move the emphasis — but it changes once per row you pass, not
  // once per frame, and the DIMMING of the others is a shared animated value
  // that costs no render at all (see scrubDim).
  const [activeRowId, setActiveRowId] = useState(null);
  const [scrubbing, setScrubbing] = useState(false);
  // Bumped on each day crossing — the pointer springs on the change, so the
  // kick and the buzz land on the same frame.
  const [dayBeat, setDayBeat] = useState(0);
  // `armed` keeps the FIRST resolution silent: landing on the agenda is not a
  // day crossing, and buzzing on mount would be a phantom.
  const pointerRef = useRef({ dateKey: null, label: null, armed: false, activeId: null });
  const scrubTimer = useRef(null);
  // The scroll handler runs every frame; it reads the agenda off a ref rather
  // than closing over it so it never has to be rebuilt as the list changes.
  const agendaRef = useRef(agenda.items);
  agendaRef.current = agenda.items;
  // Mirrors `scrubbing` so the handler can tell "already open" without
  // depending on state it may not have re-rendered with yet.
  const scrubbingRef = useRef(false);
  // Is a finger on the agenda RIGHT NOW? Not "is it scrolling" — a finger
  // resting on a stopped list is still a finger, and the pointer stays open
  // for it. See armScrubClose.
  const agendaTouchingRef = useRef(false);
  // Is the list being DRAGGED? Only used to decide whether to believe a
  // touch-cancel: during a drag the scroll view is the one cancelling, and the
  // finger is still down. See onAgendaTouchUp.
  const agendaDraggingRef = useRef(false);

  // ── The magnet ────────────────────────────────────────────────────────────
  // Two stages, both of which move the TIMELINE. The mark is fixed throughout.
  //
  // WHILE THE LIST MOVES the cards LEAN toward it — a few points at most,
  // fading to nothing by the time the mark is halfway between two of them (see
  // `magnetPull`). It is felt rather than watched. This lean is a TRANSFORM,
  // not a scroll: the cards slide those few points without the scroller being
  // touched, which is the whole reason it can run under a live gesture.
  //
  // WHEN IT STOPS the SCROLL closes the rest: a short glide bringing the
  // nearest card's centre to rest exactly under the mark. The lean relaxes as
  // it arrives, being recomputed from the shrinking distance every frame.
  //
  // The readout does NOT compensate for the lean, deliberately. The lean is
  // zero at a card's centre and zero again at the midpoint between two — so
  // wherever it is big enough to see, which card the mark is on is not in
  // question, and where the answer is marginal there is nothing to correct.
  // (An earlier version did correct for it, one frame late, which was both
  // unnecessary and its own small source of error.)
  const cardLean = useRef(new Animated.Value(0)).current;
  // Last value written to it, so a frame that moves the lean by a fraction of
  // a point doesn't pay for a bridge write.
  const cardLeanRef = useRef(0);
  // What the settle needs: the offset that puts the nearest card's centre on
  // the mark, and whether there was a card in view to measure at all.
  const magnetRef = useRef({ offset: 0, live: false });
  // Held while a settle's own glide plays out, so the scroll it generates
  // cannot settle again on top of itself.
  const settlingRef = useRef(false);
  const settleLockTimer = useRef(null);
  const settleTimer = useRef(null);

  // Which item is under the pointer right now. FlashList knows the content
  // geometry (computeVisibleIndices + getLayout), so this is a scan of the
  // handful of on-screen items rather than anything measured or guessed.
  const resolvePointer = useCallback(() => {
    const list = listRef.current;
    const items = agendaRef.current;
    if (!list?.computeVisibleIndices || !list?.getLayout || !items?.length) return;
    let range;
    try { range = list.computeVisibleIndices(); } catch (e) { return; }
    if (!range) return;
    // Where the mark is in the space `getLayout` answers in. Any content
    // PADDING above the rows has to come back off — FlashList's layouts are
    // relative to the first child, so otherwise every reading lands that far
    // down the timeline (see `markContentY`). Asked of the list rather than
    // assumed: it is the measured truth, and it stays right if anything is ever
    // put above the rows again.
    const lead = list.getFirstItemOffset ? (list.getFirstItemOffset() || 0) : 0;
    // …and the depth the page deliberately does NOT draw goes back on as the
    // virtual lead, which is what keeps the first card reachable now that there
    // is no blank band above it.
    const targetY = markContentY(
      scrollY.current,
      pointerTopRef.current,
      lead,
      agendaVirtualLeadRef.current,
    );
    const from = Math.max(0, range.startIndex);
    const to = Math.min(range.endIndex, items.length - 1);
    const getLayout = (i) => list.getLayout(i); // bound: FlashList's ref methods want their `this`
    const hit = indexAtContentY(targetY, from, to, getLayout);
    if (hit < 0) return;

    // The lean. Computed BEFORE the readout's own early exits: an undated row
    // or a stretch of chrome has nothing to print, but the mark is still
    // passing cards and they should still feel it.
    const near = nearestCardCenter(items, from, to, getLayout, targetY, ROW_GAP);
    if (near) {
      const delta = near.center - targetY; // + = the centre is below the mark
      // Where the settle lands. Back in SCROLL-OFFSET space (+ lead), because
      // that is what scrollToOffset speaks — the mirror of the subtraction
      // above, and the half of it that was missing when this last shipped.
      magnetRef.current = { offset: near.center + lead - pointerTopRef.current, live: true };
      // Range = half the row's pitch, so the pull is spent exactly where the
      // nearest card changes hands.
      const pull = magnetPull(delta, Math.max(24, near.pitch / 2), MAGNET_STRENGTH, MAGNET_LEAN_MAX);
      // NEGATED onto the list: a centre BELOW the mark (delta > 0) has to come
      // UP the screen to reach it. The mark itself does not move.
      if (Math.abs(pull - cardLeanRef.current) > 0.2) {
        cardLeanRef.current = pull;
        cardLean.setValue(-pull);
      }
    } else if (magnetRef.current.live) {
      magnetRef.current = { offset: 0, live: false };
      cardLeanRef.current = 0;
      cardLean.setValue(0);
    }

    const dateKey = dayKeyAt(items, hit);
    if (!dateKey) return;
    const parts = pointerParts(
      items[hit],
      dateKey,
      agendaDateLabelShort,
      (mins) => clockLabel(mins, timeFormat === '24h', { pad: false }),
      (it) => itemTypeOf(it) === 'event',
    );
    if (!parts) return;
    // How far ahead of / behind today the reading is — the pointer turns this
    // into its offset word, and puts it above or below the reading by sign.
    const offsetDays = daysFromToday(dateKey);
    // One string to compare against — this runs on every scroll frame, and
    // comparing the fields by hand here is how they drift apart. The offset is
    // IN it: two different days can print the same reading across a year
    // boundary, and the day count is the part that changed.
    const label = `${parts.time ? `${parts.day} · ${parts.time}` : parts.day}|${offsetDays}`;

    if (dateKey !== pointerRef.current.dateKey) {
      // Subtle tick on every new day the timeline crosses.
      if (pointerRef.current.armed) {
        selectionHaptic();
        setDayBeat((b) => b + 1);
      }
      pointerRef.current.dateKey = dateKey;
      pointerRef.current.armed = true;
    }
    // Which row the mark is actually sitting on, so it can state itself while
    // the rest settle back. Guarded the same way the label is: this runs on
    // every scroll frame, but the id only changes as you pass a row.
    // Chrome the mark happens to be sitting on keeps the last real row lit —
    // see activeRowIdAt.
    const activeId = activeRowIdAt(items, hit, pointerRef.current.activeId);
    if (activeId !== pointerRef.current.activeId) {
      pointerRef.current.activeId = activeId;
      setActiveRowId(activeId);
    }
    // Only ever setState when the printed string actually changes — this runs
    // on every scroll frame.
    if (label !== pointerRef.current.label) {
      pointerRef.current.label = label;
      setPointerLabel({ ...parts, offsetDays });
    }
  }, [timeFormat]);

  /**
   * Close the pointer: the mark, the readout and the band headers go.
   *
   * Armed a beat after the last movement — EXCEPT while a finger is still on
   * the list. Holding still is not the same as being finished: you have stopped
   * the timeline on a row to read it, and having the mark and its headers fade
   * out from under a finger that never left the screen is the chrome deciding
   * you are done when you are visibly not. It closes when you let go.
   */
  const armScrubClose = useCallback(() => {
    clearTimeout(scrubTimer.current);
    if (agendaTouchingRef.current) return;
    scrubTimer.current = setTimeout(() => {
      scrubbingRef.current = false;
      setGutterScrubbing(false);
      setScrubbing(false);
      // Let the emphasis go with the scrub. `scrubDim` returns to 1 on its
      // own, but the bold title would otherwise stay on whichever row the
      // mark happened to stop over.
      pointerRef.current.activeId = null;
      setActiveRowId(null);
    }, 650);
  }, []);

  // A scroll opens the pointer (and hands it the margin, see `scrubFade`);
  // going quiet for a beat closes it again.
  const onAgendaScroll = useCallback((e) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
    // The list is moving, so no touch feedback may fire off it (STYLE-RULES §3,
    // "a tap is not a gesture"). Stamped every frame; the gate decays on its own.
    markGesture();
    if (!scrubbingRef.current) {
      scrubbingRef.current = true;
      setGutterScrubbing(true);
      setScrubbing(true);
    }
    armScrubClose();
    resolvePointer();
  }, [resolvePointer, armScrubClose]);

  /**
   * A finger is on the agenda — touching it, not necessarily scrolling it.
   *
   * These are the raw touch events rather than `onScrollBeginDrag`, which is
   * the whole point: a drag-begin only arrives once the list actually MOVES, so
   * a finger resting on a stopped timeline is invisible to it. The wrapper View
   * carries them, so they see every touch in the list's subtree without
   * claiming the responder away from the rows or the scroll.
   */
  const onAgendaTouchDown = useCallback(() => {
    agendaTouchingRef.current = true;
    // Hold the chrome open for as long as the finger is down.
    clearTimeout(scrubTimer.current);
    // A finger back on the list also cancels a settle that has not started yet:
    // you are scrolling again, and the list must not move under a touch.
    clearTimeout(settleTimer.current);
  }, []);

  /**
   * The finger left — or the platform says it did, which is not the same claim.
   *
   * A CANCEL DURING A DRAG IS NOT A LIFT. iOS scroll views cancel the touches
   * they deliver to their subviews the moment they start scrolling
   * (`canCancelContentTouches`), and React Native forwards that to us as
   * `onTouchCancel` with the finger still very much on the glass. Believing it
   * would break the exact case this exists for: scroll, stop, keep holding —
   * the chrome would fade out from under a finger that never left.
   *
   * So a cancel is only a lift when no drag is in flight. When one is, the
   * authoritative lift is `onScrollEndDrag`, which fires when the finger
   * actually comes up — and clearing it there is what stops a swallowed cancel
   * stranding the pointer open forever.
   */
  const onAgendaTouchUp = useCallback((kind) => {
    if (kind === 'cancel' && agendaDraggingRef.current) return;
    agendaTouchingRef.current = false;
    // Only now does the quiet beat start. Nothing to close if the pointer was
    // never open — a tap on a still agenda must not make the mark appear.
    if (scrubbingRef.current) armScrubClose();
  }, [armScrubClose]);

  const onAgendaTouchEnd = useCallback(() => onAgendaTouchUp('end'), [onAgendaTouchUp]);
  const onAgendaTouchCancel = useCallback(() => onAgendaTouchUp('cancel'), [onAgendaTouchUp]);

  // The settle: glide the last few points so the nearest card's centre comes
  // to rest under the mark. A plain animated scroll — the list's own motion,
  // not a competing animation laid over it — and only ever a SHORT one (see
  // MAGNET_SETTLE_MAX), so it reads as the list finding its detent rather than
  // as the screen taking the wheel.
  const settleToNearestCard = useCallback(() => {
    if (settlingRef.current) return;
    const list = listRef.current;
    const { offset, live } = magnetRef.current;
    if (!list || !live) return;
    // How far the list will actually travel — which is what the guards are
    // about, and is not the same as the distance the lean was derived from.
    const d = Math.abs(offset - scrollY.current);
    if (d < MAGNET_SETTLE_MIN || d > MAGNET_SETTLE_MAX) return;
    // Never into the bounce: at either end the scroller is already holding a
    // position of its own and a settle would fight it.
    if (offset < 0) return;
    settlingRef.current = true;
    try { list.scrollToOffset({ offset, animated: true }); } catch (e) { /* nothing scrollable */ }
    clearTimeout(settleLockTimer.current);
    settleLockTimer.current = setTimeout(() => { settlingRef.current = false; }, 420);
  }, []);

  // When a scroll has actually STOPPED. Two ways in, and they are not the same
  // event: a flick hands off to momentum and ends with onMomentumScrollEnd,
  // while a finger that dragged the list to a halt ends with onScrollEndDrag
  // and no momentum at all. Waiting on the drag end alone would miss every
  // flick; acting on it immediately would settle mid-flick, the instant before
  // momentum takes over — so the drag end arms a short timer that momentum
  // cancels if it begins.
  const onAgendaScrollEndDrag = useCallback(() => {
    // The authoritative finger-lift for a drag. See onAgendaTouchUp: while a
    // drag is in flight a touch-cancel is disbelieved, so THIS is what releases
    // the pointer's hold — without it a swallowed cancel would strand it open.
    agendaDraggingRef.current = false;
    agendaTouchingRef.current = false;
    if (scrubbingRef.current) armScrubClose();
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(settleToNearestCard, 80);
  }, [settleToNearestCard, armScrubClose]);
  const onAgendaMomentumBegin = useCallback(() => {
    clearTimeout(settleTimer.current);
  }, []);
  const onAgendaMomentumEnd = useCallback(() => {
    clearTimeout(settleTimer.current);
    settleToNearestCard();
  }, [settleToNearestCard]);
  // A finger back on the list cancels a settle that has not started yet — you
  // are scrolling again, and the list must not move under a touch.
  const onAgendaTouchStart = useCallback(() => {
    // A drag is now in flight, which is what makes a touch-cancel untrustworthy.
    agendaDraggingRef.current = true;
    agendaTouchingRef.current = true;
    clearTimeout(scrubTimer.current);
    clearTimeout(settleTimer.current);
  }, []);

  // Settle the readout whenever the agenda itself changes under a still
  // finger (a fill, a new task), not only when something scrolls.
  useEffect(() => {
    const t = setTimeout(resolvePointer, 60);
    return () => clearTimeout(t);
  }, [agenda.items, listH, resolvePointer]);

  useEffect(() => () => {
    clearTimeout(scrubTimer.current);
    clearTimeout(settleTimer.current);
    clearTimeout(settleLockTimer.current);
    // Leaving mid-scrub would strand the rows' times faded out.
    setGutterScrubbing(false);
  }, []);
  // "Scroll to today" — rebuilt for INSTANT response, mid-flick included.
  //
  // Why the old one felt dead until scrolling stopped: a live deceleration is
  // a native animation writing contentOffset every frame, and FlashList's
  // scrollToIndex is itself a multi-step walk (estimate → render → correct,
  // it returns a Promise). Fired during momentum, the momentum's next frame
  // stomped each step, so the jump only ever "took" once the flick died.
  //
  // The fix is the canonical one: KILL the momentum first — re-anchoring at
  // the current offset with a non-animated scrollTo cancels the native
  // deceleration dead (visually a no-op) — then, one frame later on a still
  // viewport, do the single non-animated jump to the seam index. Fills stay
  // locked from tap to landing; `release` re-arms them, re-establishes
  // viewability truth, and drops the pill exactly once (bounded fallback in
  // case the scrollToIndex promise never settles).
  const goToLatest = useCallback(() => {
    // No fill may land mid-jump.
    if (olderTimerRef.current) { clearTimeout(olderTimerRef.current); olderTimerRef.current = null; }
    growReadyRef.current = false;
    // …and no magnet either: the jump's own momentum-kill and landing would
    // otherwise read as "a scroll stopped" and pull the list off the seam it
    // was just asked to land on.
    clearTimeout(settleTimer.current);
    settlingRef.current = true;
    clearTimeout(settleLockTimer.current);
    settleLockTimer.current = setTimeout(() => { settlingRef.current = false; }, 700);
    // 1. Kill any in-flight momentum RIGHT NOW, on the tap.
    try {
      listRef.current?.scrollToOffset({ offset: Math.max(0, scrollY.current), animated: false });
    } catch (e) { /* nothing scrollable */ }
    const idx = upcomingHeaderIndexRef.current;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      growReadyRef.current = true;
      placeholderVisibleRef.current = false; // truth re-established below
      try { listRef.current?.recordInteraction?.(); } catch (e) { /* ignore */ }
      setViewingPast(false);
    };
    // 2. One frame later (momentum dead, offset settled) — the single jump.
    requestAnimationFrame(() => {
      try {
        if (idx >= 0) {
          const p = listRef.current?.scrollToIndex({ index: idx, animated: false });
          if (p && typeof p.then === 'function') {
            // FlashList resolves once its step-walk lands; release then. The
            // timeout is a bounded fallback ONLY (no correction loops).
            p.then(() => requestAnimationFrame(release), release);
            setTimeout(release, 600);
            return;
          }
        } else {
          listRef.current?.scrollToOffset({ offset: 0, animated: false });
        }
      } catch (e) { /* nothing scrollable */ }
      requestAnimationFrame(release);
    });
  }, []);

  // Scroll a task row above the keyboard when its subtask input focuses.
  // TaskItem rows (where inline subtask editing happens) render ONLY on the
  // boards page now, so this targets that page's own list — whose sections
  // are collapsible.groupedData 1:1 (no synthetic agenda sections to offset
  // around, and no mvcp pin to unblock).
  const boardsListRef = useRef(null);
  const boardsScrollY = useRef(0);
  const treeSectionsRef = useRef(collapsible.groupedData);
  treeSectionsRef.current = collapsible.groupedData;
  const scrollToItem = useCallback((itemId) => {
    const sections = treeSectionsRef.current || [];
    let itemIndex = -1;
    let sectionIndex = -1;

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (section.type === 'tag' && section.data) {
        const idx = section.data.findIndex(item => item.id === itemId);
        if (idx !== -1) {
          sectionIndex = i;
          itemIndex = idx;
          break;
        }
      }
    }

    if (sectionIndex !== -1 && itemIndex !== -1 && boardsListRef.current) {
      try {
        boardsListRef.current.scrollToLocation({
          sectionIndex,
          itemIndex,
          viewOffset: 100, // Scroll so item is not at the very bottom
          animated: true,
        });
      } catch (e) { /* nothing to scroll */ }
    }
  }, []);
  
  // Project chevron rotation animations
  const projectRotations = useRef({}).current;
  
  // Initialize rotation animations for projects
  useEffect(() => {
    projects.forEach(project => {
      if (!projectRotations[project]) {
        projectRotations[project] = new Animated.Value(0);
      }
    });
  }, [projects]);
  
  // Animate project chevron when expanded state changes
  useEffect(() => {
    Object.entries(collapsible.expandedProjects).forEach(([project, isExpanded]) => {
      if (projectRotations[project]) {
        Animated.timing(projectRotations[project], {
          toValue: isExpanded ? 1 : 0,
          duration: 200,
          useNativeDriver: true,
        }).start();
      }
    });
  }, [collapsible.expandedProjects]);

  const handleSaveTask = async (taskData) => {
    if (taskData.tags?.length > 0) await collectTags(taskData.tags);

    const isEdit = taskData.id && tasksRef.current.some(t => t.id === taskData.id);
    if (isEdit) {
      await saveTasks(tasksRef.current.map(t => (t.id === taskData.id ? taskData : t)));
    } else {
      // A CREATE goes as one row, not as the whole list. POST /tasks is a
      // delete-and-reinsert of everything I own, so adding a task from a
      // snapshot taken before the desktop's last save deleted whatever the
      // desktop had added since — the new task appeared and someone else's work
      // quietly vanished. POST /tasks/single inserts this row and nothing else.
      // (Subtasks the caller provided are preserved — re-adding a previous task
      // copies them — and createTask defaults them to [] when none were given.)
      await createTask(taskData);
    }
    // An edit-form save is a FROZEN-ORDER boundary: dates/projects may have
    // changed, so the agenda re-files the row into its new group now (creates
    // already rebuild via membershipKey; this covers same-id edits).
    bumpOrderEpoch();
  };

  // Toggling a task card's checkbox. Mirrors the web app's revised
  // recurring-completion logic (web TasksScreen.handleToggleComplete):
  // completing a RECURRING task doesn't mark it done forever — it advances
  // the dueDate to the next occurrence and leaves the task active, so it
  // reappears on its next scheduled day. We still stamp completedAt /
  // completedTime so callers know when the last occurrence was checked off,
  // even though `completed` stays false. Non-recurring tasks (and
  // un-completing anything) fall through to the plain boolean toggle.
  /**
   * Start a focus timer for a task. Routes through the Turtle chat's
   * /pomodoro pipeline (CommandBus delivers it exactly as if typed) with the
   * task title as the session label, then jumps to the Turtle tab where the
   * timer card lives.
   *
   * One definition, two callers: the task card's action key and the circle key
   * beside every schedule row.
   *
   * TWO STORES, and starting one is not starting the other. The pond keeps the
   * chat timer in memory (`pomodoroService`, the socket's `pomodoro-state`,
   * which is what the Turtle tab's card draws) and TASK-linked blocks in the
   * `task_pomodoros` table (which is what `/pomodoros/active` and `/pomodoros`
   * answer from, and the only one of the two that knows which task a timer
   * belongs to — `pomodoro-start` takes a mode and a duration, no task).
   *
   * The chat command starts only the first. So the timer ran, the Turtle tab
   * showed it, and every card on this screen kept showing a plain start key:
   * the store they read had no row. The tally was stuck at the same zero for
   * the same reason, since a task's count is its COMPLETED rows.
   *
   * So we write the row too. Its length is read back off the live timer rather
   * than assumed, because the chat timer runs at whatever focus duration the
   * user has saved — hardcoding 25 here would have the card counting down to a
   * different zero than the timer it is reporting.
   */
  const startPomodoroFor = useCallback(async (task) => {
    const label = (task?.title || '').trim();
    // BEFORE the navigate: this is the last moment the row is still in hand, and
    // the stamp must not wait on a chat round trip the way the task_pomodoros
    // row below does. An untimed task gets a slot on today at this minute — the
    // calendar's start keys used to be the only ones that did this, and they
    // route through here (see stampFocusSlot / utils/focusStart).
    stampFocusSlotRef.current?.(task);
    dispatchCommand(label ? `/pomodoro focus ${label}` : '/pomodoro focus');
    navigation.navigate('Turtle');
    if (!task?.id) return;
    try {
      // The command travels through the bus and the socket before the pond has
      // a timer to report; ask after it lands.
      await new Promise((resolve) => setTimeout(resolve, 700));
      let durationMinutes = 25;
      try {
        // `source: 'server'` is the chat timer — the one just started. A
        // 'task' answer would be some OTHER block's row still in flight, whose
        // length says nothing about this one.
        const live = await api.get('/pomodoro/widget');
        if (live?.active && live.source === 'server' && live.endsAt > live.startedAt) {
          // Measured from the timer's own ends, so this does not care whether
          // `totalSec` is seconds or something else.
          durationMinutes = Math.max(1, Math.round((live.endsAt - live.startedAt) / 60000));
        }
      } catch { /* unreachable — 25 is the pond's own default too */ }
      // Cancels any in-flight row for us: one live block at a time, the same
      // precedence the timer bar and the tray widget already use.
      await api.post('/pomodoro/start-task', { taskId: task.id, durationMinutes });
    } catch { /* offline — the Turtle tab still has the timer, the card won't */ }
    loadPomodoros();
  }, [api, dispatchCommand, navigation, loadPomodoros]);

  const handleToggleComplete = async (id, occurrenceDate) => {
    const task = tasksRef.current.find(t => t.id === id);
    if (!task) return;

    // NOTE: this handler changes DATA ONLY. The agenda renders from a frozen
    // order snapshot (see agendaOrder), so a tick — any tick: plain, overdue,
    // recurring, untick — repaints the row in its existing slot and cannot
    // restructure the list. No position-pin choreography needed here anymore.
    //
    // WHAT it becomes (including every recurrence rule) lives in
    // utils/completionChange.js, shared with the tests. HOW it is saved is the
    // part that matters for sync: one MERGING patch of this row, never the
    // whole list — a list save is a delete-and-reinsert on the server, so the
    // last device to save used to overwrite the other one's ticks.
    const { next, patch, isTicking } = completionChange(task, occurrenceDate);
    const newTasks = tasksRef.current.map(t => (t.id === id ? next : t));
    await saveTaskPatch(id, patch, newTasks);
    // Celebrate a fresh tick (never an undo) — AFTER the save is confirmed.
    // saveTaskPatch reverts + re-throws on failure, so a rolled-back
    // completion never gets confetti or points.
    if (isTicking) celebrate({ points: 10, kind: 'task' });
  };
  
  const handleUpdateTask = async (taskId, updates) => {
    const newTasks = tasksRef.current.map(t => {
      if (t.id !== taskId) return t;
      return { ...t, ...updates };
    });
    await saveTasks(newTasks);
  };

  // Auto-complete events once they're over — an event in the past is, by
  // definition, done, so its checkbox ticks itself off in the calendar without
  // anyone tapping it. Sweeps on task changes and once a minute (to catch an
  // event ending while the app is open). One batched save; idempotent — after a
  // sweep there's nothing left to flip, so it doesn't loop.
  useEffect(() => {
    const sweep = () => {
      const now = Date.now();
      const list = tasksRef.current || [];
      const due = list.filter((t) => !t.completed && eventIsOver(t, now));
      if (due.length === 0) return;
      const ids = new Set(due.map((t) => t.id));
      const iso = new Date(now).toISOString();
      saveTasks(list.map((t) =>
        ids.has(t.id) ? { ...t, completed: true, completedAt: now, completedTime: iso } : t
      ));
    };
    sweep();
    const id = setInterval(sweep, 60000);
    return () => clearInterval(id);
    // saveTasks/tasksRef are stable refs; re-sweep whenever the task set changes.
  }, [tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deleting goes through `deleteTask` (DELETE /tasks/:id), not through a
  // filtered whole-list POST. The list POST deletes and reinserts every row I
  // own, so removing one task re-asserted my possibly-stale copy of all the
  // others and wiped anything another device had added meanwhile — losing work
  // as a side effect of a delete.
  const handleDelete = (id) => {
    const task = tasksRef.current.find(t => t.id === id);
    const hasSubtasks = task?.subtasks && task.subtasks.length > 0;

    // Skip confirmation if no subtasks
    if (!hasSubtasks) {
      deleteTask(id);
      return;
    }

    Alert.alert('Delete Task', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteTask(id)
      }
    ]);
  };

  const handleInlineAdd = (project, tags, title) => {
    const actualProject = project === 'No Project' ? '' : project;
    
    const newTask = {
      title: title,
      description: '',
      priority: 'medium',
      completed: false,
      project: actualProject,
      dueDate: '',
      tags: tags || [],
      subtasks: [],
      id: Date.now().toString(),
      createdAt: Date.now()
    };
    
    handleSaveTask(newTask);
  };

  const handleRenameTag = async (project, oldTag, newTag) => {
    // Update all tasks that have the old tag
    const updatedTasks = tasks.map(task => {
      if (!task.tags || task.tags.length === 0) return task;
      
      // Check if task has the old tag
      const tagIndex = task.tags.indexOf(oldTag);
      if (tagIndex === -1) return task;
      
      // Replace old tag with new tag
      const newTags = [...task.tags];
      newTags[tagIndex] = newTag;
      
      return { ...task, tags: newTags };
    });
    
    await saveTasks(updatedTasks);
  };

  const handleAddTagToSection = async (project, existingTags, newTag) => {
    // Find all tasks in this section (matching project and existing tags)
    const updatedTasks = tasks.map(task => {
      // Check if task matches this section
      const taskProject = task.project || 'No Project';
      const sectionProject = project || 'No Project';
      
      if (taskProject !== sectionProject) return task;
      
      // For Untagged section, we want tasks with no tags
      // For tagged sections, we want tasks with the existing tags
      const taskTags = task.tags || [];
      const isUntaggedSection = !existingTags || existingTags.length === 0;
      const isTaskUntagged = !taskTags || taskTags.length === 0;
      
      if (isUntaggedSection && !isTaskUntagged) return task;
      if (!isUntaggedSection) {
        // Check if task has any of the section's tags
        const hasMatchingTag = existingTags.some(tag => taskTags.includes(tag));
        if (!hasMatchingTag) return task;
      }
      
      // Add the new tag to the task
      return { ...task, tags: [...taskTags, newTag] };
    });
    
    await saveTasks(updatedTasks);
    await collectTags([newTag]);
  };

  const openEditForm = (task) => {
    setEditingTask(task);
    setShowTaskForm(true);
  };

  // Open the unified create form pre-set to a kind chosen from the calendar
  // "+" menu (birthday / task / event). The type stays switchable inside the form.
  // `date` (YYYY-MM-DD, optional) pre-fills the due/occasion date when creating
  // from a specific tapped calendar day. This is now the single NEW-item entry
  // point (the FAB-equivalent "Add new task" button and the calendar day "+"
  // both route through it with type 'task') — TaskForm itself opens COLLAPSED
  // for new items (no initialData), so the fast path is preserved.
  // `seed` carries whatever the caller has already collected — the day
  // panel's finder hands over the title typed into it and the time chip, so
  // "Full form" continues that task instead of starting a blank one.
  const openCreateForm = useCallback((type, date, project, seed = null) => {
    setEditingTask(null);
    setNewItemType(type || 'task');
    setNewItemDate(date || null);
    setNewItemProject(project || null);
    setNewItemTitle(seed?.title || '');
    setNewItemTime(seed?.time || '');
    setShowTaskForm(true);
  }, []);

  /**
   * Arrive here already composing.
   *
   * The chat's "New task" button is an `open` action carrying { compose: true }
   * (server: services/chatCommands.js), so the assistant hands off to this
   * screen's real editor instead of the chat drawing a lesser copy of it.
   * Anything else that can navigate here — a deep link, the web app — gets the
   * same behaviour for free by passing the same param.
   *
   * The param is CLEARED as it is consumed. React Navigation keeps params on
   * the route until they are replaced, so leaving it set would mean the form
   * springs open again every time the user returns to this tab, and a second
   * press of the same chat button would be a no-op because the params object
   * never changed and the effect never re-ran.
   */
  useEffect(() => {
    if (!route.params?.compose) return;
    navigation.setParams({ compose: undefined, composeType: undefined, composeDate: undefined });
    openCreateForm(route.params.composeType || 'task', route.params.composeDate || null);
  }, [route.params?.compose, route.params?.composeType, route.params?.composeDate, navigation, openCreateForm]);

  const openDetail = (task) => {
    setSelectedTask(task);
    setShowDetail(true);
  };

  // ── Reschedule from the agenda's time bubble ───────────────────────────────
  // The bubble is the row's when, so tapping it edits the when — a dated row
  // goes straight to the wheels, an undated one picks its day first (see
  // SchedulePickerSheet). Held as the task itself: the sheet is open exactly
  // when there is a row to reschedule.
  const [reschedulingTask, setReschedulingTask] = useState(null);

  const handleReschedule = useCallback(async ({ dueDate, time }) => {
    const task = reschedulingTask;
    if (!task?.id) return;
    // One MERGING patch of this row, like a completion — a whole-list save is a
    // delete-and-reinsert on the server, so it would clobber whatever another
    // device changed meanwhile. Its own outbox key: a queued reschedule and a
    // queued tick of the same task are different writes and must both survive.
    const patch = { dueDate, time: time || '' };
    const nextTasks = tasksRef.current.map((t) => (t.id === task.id ? { ...t, ...patch } : t));
    try {
      await saveTaskPatch(task.id, patch, nextTasks, 'schedule');
    } catch {
      /* saveTaskPatch has already reverted the row and told the user */
      return;
    }
    // A move is a FROZEN-ORDER boundary, like an edit-form save: the row now
    // belongs to a different day, so the agenda re-files it under that date's
    // divider instead of showing a new time under the old heading.
    bumpOrderEpoch();
  }, [reschedulingTask, saveTaskPatch, bumpOrderEpoch]);

  // A task handed over from elsewhere (global search): open its detail the
  // way a tap here would. Prefer the loaded row (subtasks, meta); fall back
  // to the handed hit if this list has not loaded it.
  const { pending: pendingTarget, clear: clearTarget } = useOpenTarget();
  useEffect(() => {
    if (!pendingTarget || pendingTarget.kind !== 'task') return;
    const found = (tasks || []).find((t) => t && t.id === pendingTarget.id);
    clearTarget();
    openDetail(found || pendingTarget.item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTarget, tasks]);

  const closeTaskForm = () => {
    setShowTaskForm(false);
    setEditingTask(null);
  };

  const styles = createStyles(theme);

  // ── The media vault's tab picker ────────────────────────────────────
  // No track, no pill — the labels with a short bar that slides from one to
  // the next, 1:1 with the pager's scroll (MediaGallery's picker, to the
  // point). Both the bar and each segment's two ink layers read the same
  // pagerScrollX on the native thread, so the whole thing tracks the finger
  // through a swipe rather than snapping at the end of one.
  const pagerWidth = pagerSize.width || windowWidth;
  // Tabs are sized to their own CONTENT and laid left to right, Pinterest's
  // board headers rather than a segmented control: equal thirds forced every
  // label into the same slot whatever its length, which is what kept the type
  // small. Content-width lets them breathe, and the row scrolls when they run
  // past the edge — which four tabs at this size do.
  //
  // So the bar has to move AND resize: each tab's own x and width, measured
  // (font metrics, the icon and the user's font scale are not computable).
  const [tabLayouts, setTabLayouts] = useState({});
  const measureTab = useCallback((mode, x, w) => {
    const nx = Math.round(x);
    const nw = Math.round(w);
    if (!nw) return;
    // Functional update + no-op guard: onLayout fires on every re-measure
    // (rotation, font scale), and an unconditional setState here would loop.
    setTabLayouts((prev) => {
      const cur = prev[mode];
      if (cur && cur.x === nx && cur.width === nw) return prev;
      return { ...prev, [mode]: { x: nx, width: nw } };
    });
  }, []);
  // Before the first layout: something plausible, so the bar is never a
  // zero-width speck parked at the origin on the opening frame.
  const tabFallback = (i) => ({ x: i * 96, width: 80 });
  const tabBoxes = VIEW_SEGMENTS.map((s, i) => tabLayouts[s.mode] || tabFallback(i));
  // Derived from the segment list rather than written out per page — a
  // hand-listed range is exactly what breaks, silently and by parking the bar
  // under the wrong label, the day a tab is added.
  const pageStops = VIEW_SEGMENTS.map((_, i) => i * pagerWidth);
  // BOTH ends animate, and both are transforms: the native animated module
  // handles transforms and opacity only, so `width` is out — the bar is 1pt
  // wide and scaled, with its origin on the left so the translate places its
  // left edge. Square ends, deliberately: scaleX on a rounded bar smears the
  // caps into a lens, and Pinterest's rule is square anyway.
  const tabUnderlineX = pagerScrollX.interpolate({
    inputRange: pageStops,
    outputRange: tabBoxes.map((b) => b.x),
    extrapolate: 'clamp',
  });
  const tabUnderlineScale = pagerScrollX.interpolate({
    inputRange: pageStops,
    outputRange: tabBoxes.map((b) => b.width),
    extrapolate: 'clamp',
  });
  // Keep the live tab on screen once the row is wider than the header. Only
  // when it actually overflows, and never animated on the first settle.
  const tabScrollRef = useRef(null);
  useEffect(() => {
    const box = tabLayouts[viewMode];
    if (!box) return;
    const visible = pagerWidth - HEADER_PAD_X * 2;
    const right = box.x + box.width;
    if (right <= visible) { tabScrollRef.current?.scrollTo({ x: 0, animated: true }); return; }
    tabScrollRef.current?.scrollTo({ x: Math.max(0, right - visible + 24), animated: true });
  }, [viewMode, tabLayouts, pagerWidth]);

  // ── What the header's two keys work on ────────────────────────────────────
  //
  // THE INDEX, rebuilt only when the tasks change. Searching re-scores it on
  // every keystroke; re-lowercasing every title of every task per letter typed
  // is the difference between a field that answers as you type and one that
  // stutters behind you. See utils/taskSearch.
  const taskIndex = useMemo(() => buildTaskIndex(tasks), [tasks]);

  // ── The Inbox tab's own list ──────────────────────────────────────────────
  const inboxLabel = useMemo(() => inboxDestinationLabel(projects), [projects]);
  const inbox = useMemo(() => inboxTasks(tasks, projects), [tasks, projects]);
  // Which line the capture field just made, so exactly one row animates in
  // rather than the whole list replaying on every add.
  const [freshInboxId, setFreshInboxId] = useState(null);


  /**
   * The labels worth offering, sorted — the filter panel's Labels section.
   *
   * Tags actually PRESENT on the tasks in view, not the pond's whole collected
   * vocabulary (`allTags`, which keeps every tag ever typed). And narrowed to
   * the board when one is picked, the way the old sheet did: a label that
   * exists only on another board is a chip that can only ever empty the list.
   */
  const filterTags = useMemo(() => {
    const set = new Set();
    for (const t of tasks || []) {
      if (!t) continue;
      if (selectedProject && selectedProject !== 'All') {
        const inBoard = selectedProject === 'No Project' ? !t.project : t.project === selectedProject;
        if (!inBoard) continue;
      }
      for (const tag of (Array.isArray(t.tags) ? t.tags : [])) if (tag) set.add(tag);
    }
    return [...set].sort((a, b) => String(a).localeCompare(String(b)));
  }, [tasks, selectedProject]);

  /**
   * How many items survive the filters as they currently stand — the number
   * the filter panel's footer shows. Live, so a chip that empties the Planner
   * says so before you close the panel to find out.
   */
  const filterMatchCount = useMemo(() => {
    const f = { selectedProject, selectedTags, tagFilterMode, selectedOwners, searchQuery: '' };
    let n = 0;
    for (const t of tasks || []) {
      if (!t || !taskPassesFilters(t, f)) continue;
      const done = !!(t.completed || isTaskDoneNow(t));
      if (statusFilter === 'todo' && done) continue;
      if (statusFilter === 'done' && !done) continue;
      n += 1;
    }
    return n;
  }, [tasks, selectedProject, selectedTags, tagFilterMode, selectedOwners, statusFilter]);

  /** Everything back to its default. One key, because four is an errand. */
  const clearAllFilters = useCallback(() => {
    setSelectedProject('All');
    setStatusFilter('todo');
    setSelectedTags([]);
    setSelectedOwners([]);
    setTagFilterMode('any');
  }, []);

  /**
   * Start a focus block ON A TASK, from the Focus tab's search.
   *
   * The task-card path (`startPomodoroFor`) announces the block in the chat and
   * jumps to the Turtle tab. This one must not: you were on Focus, you picked
   * something to work on, and the ring is right there — being thrown into a
   * conversation to watch it is the complaint the whole tab was rebuilt around.
   * Same REST endpoint, no command bus, no navigation.
   */
  const startFocusOnTask = useCallback(async (task) => {
    if (!task?.id) return;
    const startedAt = Date.now();
    // A slot on today at this minute, if it had no time — the same rule every
    // other way into a session follows. See stampFocusSlot.
    stampFocusSlotRef.current?.(task);
    // Optimistic, so the ring answers the tap rather than the round trip.
    setActivePomo({
      taskId: task.id,
      startedAt,
      endsAt: startedAt + focusMinutes * 60000,
      durationMinutes: focusMinutes,
    });
    try {
      // Cancels any in-flight block for us: one live timer at a time, the same
      // precedence the timer bar and the tray widget already use.
      await api.post('/pomodoro/start-task', { taskId: task.id, durationMinutes: focusMinutes });
    } catch {
      // The pond never took it — back to idle rather than counting down a block
      // that exists nowhere but here.
      setActivePomo(null);
    }
    loadPomodoros();
  }, [api, focusMinutes, loadPomodoros]);

  /**
   * Resume a block from the Focus page's recent list: start a fresh session on
   * the task that block was for.
   *
   * ASKS FIRST IF SOMETHING IS ALREADY RUNNING. `/pomodoro/start-task` cancels
   * any in-flight block for us — one live timer at a time — so without this a
   * mis-tap on a list of history would silently end the session you are in the
   * middle of, with nothing on screen having warned you. A block on the SAME
   * task is not a question at all: it is already running, and the deck above is
   * already showing it.
   */
  const resumeFocusBlock = useCallback((task) => {
    if (!task?.id) return;
    const live = focusBlock && focusBlock.endsAt > Date.now() ? focusBlock : null;
    if (live?.taskId === task.id) return;
    if (!live) { startFocusOnTask(task); return; }
    Alert.alert(
      'A block is running',
      `Stop it and start a new ${focusMinutes}-minute block on "${(task.title || 'this task').trim()}"?`,
      [
        { text: 'Keep going', style: 'cancel' },
        { text: 'Start new', style: 'destructive', onPress: () => startFocusOnTask(task) },
      ],
    );
  }, [focusBlock, focusMinutes, startFocusOnTask]);

  /**
   * What the search is FOR right now. The tab decides, and it is read at the
   * moment the key is pressed rather than while the panel is open — swiping
   * underneath a panel is not possible, and a mode that changed out from under
   * an open list would re-rank it for no visible reason.
   */
  const openSearch = useCallback(() => {
    setPlannerQuery('');
    setSearchOpen(true);
  }, []);

  if (!isConnected) {
    return (
      <View style={[styles.centerContainer, { paddingTop: insets.top }]}>
        <Image
          source={require('../../assets/pond-offline.png')}
          style={[styles.offlineImage, { tintColor: theme.colors.textTertiary }]}
          resizeMode="contain"
        />
        <Text style={styles.offlineText}>Unable to reach pond</Text>
        <Text style={styles.offlineSubtext}>Check your connection, or set your pond in Settings.</Text>
      </View>
    );
  }

  // Check if any filters active
  const hasActiveFilters = selectedTags.length > 0 || selectedOwners.length > 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* No notch strip and no screen-level StatusBar here any more. Both
          existed for one case — the planner covering the whole screen, safe
          area included, so the band at the top had to follow the sheet's colour
          and the clock had to go light with it. The header stays up now and the
          planner stops below it, so the safe area is only ever the page's own
          colour and App.js's StatusBar is already right. */}
      {/* Whisper-faint gradient wash — barely-there white with a
          breath of cool blue at the top, fading to nothing. Reads as
          a soft halo / atmospheric depth cue rather than a visible
          gradient. Alpha values are intentionally tiny (0.06 → 0)
          so the underlying theme background stays dominant; the
          gradient is just the lightest hint of warmth over the dark. */}
      <LinearGradient
        colors={[
          'rgba(205, 220, 255, 0.07)',  // top-left: faint blue-tinted white
          'rgba(235, 240, 255, 0.025)', // middle: even fainter
          'rgba(255, 255, 255, 0)',     // bottom-right: dissolved out
        ]}
        locations={[0, 0.55, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={styles.backgroundGradient}
        pointerEvents="none"
      />

      {/* Header — the media vault's, to the point: a large two-weight title,
          then a picker that is just labels with a bar sliding under them. No
          track, no pill, and a hairline at the foot with a breath of room
          above it, so the chrome ends on a line rather than trailing off.

          It stays up through everything, the day planner included: it is the
          only way between the three views, and the planner is a sheet over the
          page rather than a replacement for it. */}
      <View style={styles.headerChrome}>
        <View style={styles.headerTitleRow}>
          {/* THE TITLE IS THE BOARD PICKER. The scope it names is the one thing
              on this header that can be changed, and it was only changeable from
              a section inside a panel inside another tab — so the label said
              which board you were on and offered no way to be on another. A
              title that states a scope should be the way to pick it. */}
          <TouchableOpacity
            style={styles.headerTitleKey}
            onPressIn={() => tapHaptic()}
            onPress={() => { setBoardQuery(''); setBoardPickerOpen(true); }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Planner, ${plannerScopeLabel}. Choose a board.`}
            testID="planner-scope-key"
          >
            <Text style={styles.headerTitleLarge} numberOfLines={1}>
              {/* Two weights, the vault's exactly: the constant half hairline,
                  the half that actually varies in a regular weight. What the
                  board IS is the part worth reading. */}
              <Text style={styles.headerTitleThin}>Planner </Text>
              <Text style={styles.headerTitleStrong}>{`• ${plannerScopeLabel}`}</Text>
            </Text>
            {/* The one mark that says the title opens something. Small and in
                the muted ink — it is a disclosure, not a control competing with
                the two keys on the right. */}
            <Icon name="chevron-down" size={17} color={theme.colors.textTertiary} />
          </TouchableOpacity>
          {/* The two keys, on the TITLE row so they clear the tab picker and
              stay put across all four tabs. The title shrinks to them rather
              than under them — a long board name must never push a control off
              the edge (STYLE-RULES §2). */}
          <TouchableOpacity
            style={styles.headerKey}
            onPressIn={() => tapHaptic()}
            onPress={openSearch}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Search the Planner"
            testID="planner-search-key"
          >
            <Icon name="magnify" size={20} color={theme.colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.headerKey, (filterScoped || hasActiveFilters) && styles.headerKeyLit]}
            onPressIn={() => tapHaptic()}
            onPress={() => setFilterOpen(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={
              hasActiveFilters
                ? `Filters, ${selectedTags.length + selectedOwners.length} active`
                : 'Filters'
            }
            testID="planner-filter-key"
          >
            <Icon
              name="filter-variant"
              size={20}
              color={(filterScoped || hasActiveFilters) ? theme.colors.background : theme.colors.textSecondary}
            />
            {hasActiveFilters && (
              <View style={styles.headerFilterBadge}>
                <Text style={styles.headerFilterBadgeText}>{selectedTags.length + selectedOwners.length}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          ref={tabScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabScroll}
          contentContainerStyle={styles.tabTrack}
          keyboardShouldPersistTaps="handled"
        >
          {/* The bar. 1pt wide and SCALED to the live tab's measured width,
              with its origin on the left so the translate places its left
              edge — both ends of the move are transforms, which is what keeps
              it on the native driver. See tabUnderlineScale. */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.tabUnderline,
              { transform: [{ translateX: tabUnderlineX }, { scaleX: tabUnderlineScale }] },
            ]}
          />
          {VIEW_SEGMENTS.map((seg, i) => {
            // 1:1 scroll physics: full strength on its own page, nothing on
            // either neighbour, cross-faded across the swipe between.
            const inputRange = [(i - 1) * pagerWidth, i * pagerWidth, (i + 1) * pagerWidth];
            const activeOp = pagerScrollX.interpolate({ inputRange, outputRange: [0, 1, 0], extrapolate: 'clamp' });
            // 0.6, not 1: an inactive tab is still legible, still the same ink, just
            // plainly not the one you are on. The pair still cross-fades through a
            // swipe, so the weight change rides along with the opacity.
            const inactiveOp = pagerScrollX.interpolate({ inputRange, outputRange: [0.6, 0, 0.6], extrapolate: 'clamp' });
            return (
              <TouchableOpacity
                key={seg.mode}
                // The TAB is measured, not its label: the bar underlines the
                // whole thing, icon included, and the row's own x is what the
                // translate needs.
                onLayout={(e) => measureTab(seg.mode, e.nativeEvent.layout.x, e.nativeEvent.layout.width)}
                style={[styles.tabSeg, i === VIEW_SEGMENTS.length - 1 && styles.tabSegLast]}
                onPressIn={() => tapHaptic()}
                onPress={() => goToView(seg.mode)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: viewMode === seg.mode }}
                accessibilityLabel={`${seg.label} view`}
                testID={`view-tab-${seg.mode}`}
              >
                {/* Two stacked rows. Cross-fading opacities beats recolouring:
                    an opacity rides the native driver, a colour does not. The
                    ACTIVE row is absolute so the pair never affect each other's
                    layout, and the INACTIVE one (the lighter weight) is what
                    sizes the tab — so the tab's width does not jump by a point
                    as the weight cross-fades under it. */}
                <Animated.View style={[styles.tabSegRow, styles.tabSegRowActive, { opacity: activeOp }]}>
                  <Icon name={seg.icon} size={13} color={theme.colors.textPrimary} />
                  <Text style={[styles.tabSegText, styles.tabSegTextActive]} numberOfLines={1}>{seg.label}</Text>
                </Animated.View>
                <Animated.View style={[styles.tabSegRow, { opacity: inactiveOp }]}>
                  <Icon name={seg.icon} size={13} color={theme.colors.textPrimary} />
                  <Text style={[styles.tabSegText, styles.tabSegTextInactive]} numberOfLines={1}>{seg.label}</Text>
                </Animated.View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
      <View style={styles.headerRule} />

      {/* Project-picker overlay host. The picker (rendered at the bottom of
          this host) is an absolute overlay pinned just below the header.
          Everything else lives in the sibling "shift layer" below, which the
          reveal translates DOWN by the picker's height — a compositor-only
          transform, so the heavy list/calendar never relayouts (that was the
          stutter). overflow:hidden clips the shifted layer's bottom so it
          can't spill over the tab bar / FAB. Modals inside render via RN
          portals, so the transform doesn't touch them. */}
      <View style={styles.dropdownHost}>
      <View style={styles.dropdownShiftLayer}>

      {/* Active Filters. The BOARD scope rides here too now: the header key
          that used to state it is gone, and a silently-filtered agenda with
          nothing on screen saying so is the one thing that change must not
          cost. Tapping the chip clears the scope, the way the others do. */}
      {(hasActiveFilters || selectedProject !== 'All') && (
        <View style={styles.activeFiltersBar}>
          <Animated.ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {selectedProject !== 'All' && (
              <View style={[styles.filterChip, styles.tagFilterChip]}>
                <View style={[styles.ownerFilterDot, { backgroundColor: getProjectColor(selectedProject) }]} />
                <Text style={[styles.filterChipText, styles.tagFilterChipText]}>{boardLabel(selectedProject)}</Text>
                <TouchableOpacity
                  onPress={() => setSelectedProject('All')}
                  accessibilityRole="button"
                  accessibilityLabel={`Clear board scope, ${boardLabel(selectedProject)}`}
                  testID="clear-board-scope"
                >
                  <Icon name="close" size={14} color={theme.colors.textTertiary} />
                </TouchableOpacity>
              </View>
            )}
            {selectedTags.map(tag => (
              <View key={tag} style={[styles.filterChip, styles.tagFilterChip]}>
                <Icon name="tag" size={12} color={theme.colors.textPrimary} />
                <Text style={[styles.filterChipText, styles.tagFilterChipText]}>{tag}</Text>
                <TouchableOpacity onPress={() =>
                  setSelectedTags(prev => prev.filter(t => t !== tag))
                }>
                  <Icon name="close" size={14} color={theme.colors.textTertiary} />
                </TouchableOpacity>
              </View>
            ))}
            {/* Whose-tasks selections — one chip per selected owner, with the
                same colour dot the calendar badges carry. Tap × to drop just
                that person; this mirrors how the tag chips above work. */}
            {selectedOwners.map(ownerId => {
              const owner = owners.find(o => o.userId === ownerId);
              return (
                <View key={ownerId} style={[styles.filterChip, styles.ownerFilterChip]}>
                  <View style={[styles.ownerFilterDot, { backgroundColor: ownerColor(ownerId) }]} />
                  <Text style={[styles.filterChipText, styles.tagFilterChipText]}>
                    {owner ? owner.ownerName : 'Unknown'}
                  </Text>
                  <TouchableOpacity onPress={() =>
                    setSelectedOwners(prev => prev.filter(id => id !== ownerId))
                  }>
                    <Icon name="close" size={14} color={theme.colors.textTertiary} />
                  </TouchableOpacity>
                </View>
              );
            })}
          </Animated.ScrollView>
        </View>
      )}

      {/* Modals — ProjectDropdown is no longer here; it lives inline
          below the header so it reveals as part of the page flow. */}
      {/* The header's two keys, as pages.
          Both are EdgeSwipePage overlays rather than Modals: this screen is
          already inside a page, and on iOS a sibling Modal over an open one
          silently fails to present. They also replace three surfaces that used
          to disagree — the Boards tab's fold-out, its board rail, and a tags /
          people bottom sheet reachable only from inside that fold. */}
      <PlannerSearchPanel
        visible={searchOpen}
        // The tab you opened it from is the errand: find a task, find a board,
        // or pick something to focus on.
        mode={viewMode}
        query={plannerQuery}
        onQueryChange={setPlannerQuery}
        onClose={() => setSearchOpen(false)}
        scope={searchScope}
        onScopeChange={setSearchScope}
        taskIndex={taskIndex}
        projects={projects}
        selectedProject={selectedProject}
        boardStats={boardStats}
        boardColor={getProjectColor}
        onOpenTask={(task) => { setSearchOpen(false); openDetail(task); }}
        onFocusTask={(task) => { setSearchOpen(false); startFocusOnTask(task); }}
        // Picking a board scopes the whole Planner to it — the title says so,
        // and every tab is already looking at that scope.
        onPickBoard={(name) => { setSearchOpen(false); setSelectedProject(name); }}
        theme={theme}
        isDark={theme.mode === 'dark'}
      />

      {/* The board picker. FULL SCREEN, unlike the two above: it is not a
          search within the page you are on, it is the choice of what the whole
          Planner is about — every tab reads the scope it sets — so it takes the
          screen the way the vault's board search does rather than sitting in a
          frame of the page it is replacing. */}
      <PlannerSearchPanel
        visible={boardPickerOpen}
        mode="boards"
        fullScreen
        query={boardQuery}
        onQueryChange={setBoardQuery}
        onClose={() => setBoardPickerOpen(false)}
        projects={projects}
        selectedProject={selectedProject}
        boardStats={boardStats}
        boardColor={getProjectColor}
        onPickBoard={(name) => { setBoardPickerOpen(false); setSelectedProject(name); }}
        theme={theme}
        isDark={theme.mode === 'dark'}
      />

      {/* The deck's task picker. The same panel and the same rows as the
          header's search, in its ASSIGN mode: the header's focus search starts
          a block on what you pick, this one only says what the next one will be
          about — you still press Start session. Two entry points, two verbs,
          and each says which it is on its own field. */}
      <PlannerSearchPanel
        visible={focusPickOpen}
        mode="assign"
        query={focusPickQuery}
        onQueryChange={setFocusPickQuery}
        onClose={() => setFocusPickOpen(false)}
        scope={searchScope}
        onScopeChange={setSearchScope}
        taskIndex={taskIndex}
        selectedProject={selectedProject}
        onAssignTask={(task) => { setFocusPickOpen(false); setFocusTaskId(task?.id || null); }}
        theme={theme}
        isDark={theme.mode === 'dark'}
      />

      <PlannerFilterPanel
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        theme={theme}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        projects={projects}
        selectedProject={selectedProject}
        onSelectProject={setSelectedProject}
        tags={filterTags}
        selectedTags={selectedTags}
        onToggleTag={(tag) => setSelectedTags((prev) => (
          prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
        ))}
        tagFilterMode={tagFilterMode}
        onTagModeChange={setTagFilterMode}
        owners={owners}
        selectedOwners={selectedOwners}
        onToggleOwner={(userId) => setSelectedOwners((prev) => (
          prev.includes(userId) ? prev.filter((u) => u !== userId) : [...prev, userId]
        ))}
        ownerColor={ownerColor}
        matchCount={filterMatchCount}
        onClearAll={clearAllFilters}
        bottomInset={tabBarHeight}
      />

      <TaskForm
        visible={showTaskForm}
        onClose={closeTaskForm}
        onSave={handleSaveTask}
        onDelete={deleteTask}
        initialData={editingTask}
        initialType={newItemType}
        initialDate={newItemDate}
        initialProject={newItemProject}
        initialTitle={newItemTitle}
        initialTime={newItemTime}
        projects={projects}
        allTags={allTags}
        onAddProject={addProject}
        onCollectTags={collectTags}
      />

      <TaskDetail
        // Derive the detail task LIVE from `tasks` (not the snapshot captured
        // at openDetail) so toggling a subtask checkbox — which updates the
        // `tasks` array — re-renders the popup with the new state. Without this
        // the checkbox never visually flips ("can't cross off subtasks").
        task={selectedTask ? (tasks.find(t => t.id === selectedTask.id) || selectedTask) : null}
        visible={showDetail}
        onClose={() => setShowDetail(false)}
        onEdit={() => { setShowDetail(false); openEditForm(selectedTask); }}
        onToggleComplete={() => { handleToggleComplete(selectedTask.id); setShowDetail(false); }}
        onDelete={() => { handleDelete(selectedTask.id); setShowDetail(false); }}
        onTagPress={() => {}}
        onToggleSubtask={handleToggleSubtask}
        onContinue={() => {
          // "Continue today" — re-add the open task to today as a
          // progress-carrying copy. Resolve the live task from `tasks`
          // (the detail captures a snapshot at open). Subtasks are cloned
          // with fresh ids but keep their completed / completedAt /
          // completedTime via the spread ("the status it already had");
          // the copy itself starts open and non-recurring — a fresh
          // continuation of the still-open original.
          const src = selectedTask
            ? (tasks.find((t) => t.id === selectedTask.id) || selectedTask)
            : null;
          if (!src) return;
          const now = Date.now();
          const d = new Date(now);
          const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          const clonedSubtasks = (src.subtasks || []).map((st, i) => ({
            ...st,
            id: `${now}-${i}-${Math.random().toString(36).slice(2, 6)}`,
            createdAt: now,
          }));
          handleSaveTask({
            id: `${now}`,
            title: src.title,
            description: src.description || '',
            priority: src.priority || 'medium',
            completed: false,
            completedAt: null,
            completedTime: null,
            project: src.project || '',
            dueDate: today,
            time: src.time || null,
            duration: src.duration ?? null,
            tags: src.tags || [],
            subtasks: clonedSubtasks,
            recurring: 'none',
            createdAt: now,
          });
          setShowDetail(false);
        }}
        onStartPomodoro={() => { startPomodoroFor(selectedTask); setShowDetail(false); }}
      />

      {/* Owner profile — opened by tapping a task's owner badge on the shared
          calendar. Built from what the task list carries (name + that person's
          tasks); phone/role/avatar light up once a members feed is wired in. */}
      {/* The avatar stack's list. Rendered at the screen root so it covers the
          tab bar and cannot be clipped; picking someone hands off to the full
          profile card below. */}
      <PeoplePopover
        visible={!!peopleList}
        people={peopleList?.people || []}
        anchor={peopleList?.anchor}
        theme={theme}
        onClose={() => setPeopleList(null)}
        onPick={(person) => {
          setPeopleList(null);
          setProfileOwner({ userId: person.id, ownerName: person.name });
        }}
      />

      <FriendCard
        friend={profileFriend}
        // Resolves this member's server-relative avatarUrl. Without it the card
        // had no way to turn "/api/avatars/x.jpg" into something loadable.
        serverBase={serverBase}
        tasks={profileOwner ? tasks.filter((t) => t.userId === profileOwner.userId) : []}
        onClose={() => setProfileOwner(null)}
      />

      {/* (The All Boards page renders as the LAST child of the screen root —
          an in-tree EdgeSwipePage overlay must paint above the pager. See the
          bottom of this component.) */}

      {/* Swipeable Calendar ⇄ List pager. Both views are mounted side by side
          so the user can swipe between them; the header toggle scrolls it too.
          NOTE: we deliberately do NOT pass `contentOffset` (the Photos pager
          doesn't either). Rebuilding a fresh contentOffset object each render
          makes RN re-apply it to the native ScrollView — on Android that yanks
          the scroll back mid-swipe whenever an unrelated re-render lands (the
          "stuck half-way" glitch). Calendar is index 0 = the natural start
          offset, so no seeding is needed; the header toggle uses scrollTo. The
          measured size gives the nested lists a bounded height. */}
      <Animated.ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        // Lock the calendar⇄list pager while the day-schedule planner is open,
        // so a horizontal swipe pages between DAYS inside the planner instead
        // of switching to the list view (see CalendarView's dayPan).
        scrollEnabled={!dayPlannerOpen && !boardsDrilled}
        // Match the Photos pager: no edge rubber-banding, so the clamped pill
        // never sits still while the content bounces — the slide stays 1:1.
        bounces={false}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onMomentumScrollEnd={onPagerSettle}
        // Feed the live page offset to the header segmented control (native
        // thread) so its slider tracks the swipe frame-for-frame.
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: pagerScrollX } } }],
          { useNativeDriver: true }
        )}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setPagerSize((p) => (p.width === width && p.height === height ? p : { width, height }));
        }}
        style={styles.viewPager}
      >
        {/* Page 0 — Agenda (the list). */}
        <View style={{ width: pagerSize.width, height: pagerSize.height }}>
        {/* Board scope + the Calendar/List switch live in the global header, and
            the View/Edit toggle moved to the All Boards page (the only surface
            where edit mode still does anything). So the Upcoming list opens
            straight into search + the agenda — no redundant toolbar. */}
        <View style={styles.listClip}>
          {/* Search bar removed — the Upcoming list opens straight into the
              agenda (the old always-visible box read as a stray black band
              under the header). searchQuery stays '' so agenda filtering is a
              no-op; wire a new entry point here if search comes back. */}
          <View
            style={styles.listShift}
            // The pointer sits a third of the way down the LIST, not the
            // screen, so it has to know how tall the list actually is.
            onLayout={(e) => {
              const h = Math.round(e.nativeEvent.layout.height);
              setListH((prev) => (prev === h ? prev : h));
            }}
          >
          {/* The timeline's black band, behind the list and ONE piece: the
              rows, the date dividers and the gaps between them all scroll over
              it, so the margin is continuous instead of restarting at every
              row. Skipped when there is nothing to scroll — a black stripe
              beside the empty state is just a stray band. */}
          {agenda.items.length > 0 && (
            <TimelineGutter
              theme={theme}
              // The window the pointer's swerve fills. Null until the list is
              // measured — the same condition the pointer itself mounts on, so
              // the line is never left with a gap and nothing to bridge it.
              notchTop={listH > 0 ? pointerTop : null}
            />
          )}
          {/* The magnet's lean, on the TIMELINE — the cards slide the last few
              points toward the mark, because the mark is fixed and it is the
              list that comes to it. A transform, deliberately: it costs no
              layout and no scroll write, so it can run under a live gesture
              without the scroller ever feeling it. Only the list carries it —
              the band, the thread and the mark behind and over it stay put,
              which is what the lean is measured against. */}
          {/* The touch handlers ride the WRAPPER, not the list. They are plain
              touch events, so they never claim the responder — the rows still
              take their taps and the scroller still takes its drags — and being
              a parent is what lets them see every touch in the subtree. This is
              the only place that knows a finger is down while nothing moves. */}
          <Animated.View
            style={{ flex: 1, transform: [{ translateY: cardLean }] }}
            onTouchStart={onAgendaTouchDown}
            onTouchEnd={onAgendaTouchEnd}
            onTouchCancel={onAgendaTouchCancel}
            testID="agenda-touch-surface"
          >
          <FlashList
            // Remount per scope: a fresh list opens on Upcoming at offset 0
            // (see agendaScopeKey) instead of inheriting the previous scope's
            // offset + position-hold anchor.
            key={agendaScopeKey}
            ref={listRef}
            data={agenda.items}
            // LOAD-BEARING. `renderItem` closes over `activeRowId` to mark the
            // row under the pointer, but the list recycles cells and will not
            // re-run renderItem just because a closed-over value changed — so
            // without this every row keeps the `active={false}` it was first
            // rendered with, and the card under the mark dims along with all
            // the others instead of standing at full strength.
            extraData={activeRowId}
            keyExtractor={(item, index) => (item ? `${item.__past ? 'past-' : ''}${item.__upcoming ? 'upcoming-' : ''}${item.id || index}` : `cell-${index}`)}
            // Recycling pools by cell shape — the FlashList (chat-grade) win.
            getItemType={(item) => {
              if (item.__agendaHeader) return `header-${item.__agendaHeader}`;
              if (item.__gap) return 'gap';
              if (item.__addCard) return 'addCard';
              if (item.__divider) return 'divider';
              if (item.__placeholder) return 'placeholder';
              return item.__past ? 'pastRow' : 'upcomingRow';
            }}
            // Chat-style position holding: FlashList's built-in
            // maintainVisibleContentPosition stays at its v2 DEFAULT (always
            // on — the machinery that keeps the Turtle chat rock-steady when
            // history prepends). It absorbs the skeleton zone's one idle
            // mount; with the agenda's order FROZEN between boundaries there
            // is no relocation case left to toggle it off for, and FlashList
            // pauses its own offset correction during scrollToIndex jumps.
            // Drag-to-dismiss the keyboard (iMessage-style) when the
            // user scrolls a task list with the search keyboard up.
            // Without these props the keyboard sticks and the user has
            // no obvious gesture to close it.
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            // Scrolling still carries NO fill logic — fills are
            // visibility-driven. It tracks the offset for the keyboard-scroll
            // helpers, and drives the timeline pointer (see resolvePointer):
            // cheap arithmetic over the on-screen items, and it only ever
            // setStates when the readout's text actually changes.
            onScroll={onAgendaScroll}
            scrollEventThrottle={16}
            // The magnet's settle — see settleToNearestCard. These are how a
            // scroll's END is detected; the scroll itself is untouched.
            onScrollBeginDrag={onAgendaTouchStart}
            onScrollEndDrag={onAgendaScrollEndDrag}
            onMomentumScrollBegin={onAgendaMomentumBegin}
            onMomentumScrollEnd={onAgendaMomentumEnd}
            renderItem={({ item, index }) => {
              if (!item) return null;
              const items = agenda.items;

              // ── Band headers (Past / Upcoming) as plain items ─────────────
              if (item.__agendaHeader === 'past') {
                return (
                  <View style={styles.upcomingHeader}>
                    <Icon name="history" size={16} color={theme.colors.textTertiary} />
                    <Text style={styles.upcomingHeaderText}>Past</Text>
                    <View style={styles.upcomingCountBadge}>
                      <Text style={styles.upcomingCountText}>{pastTasks.length}</Text>
                    </View>
                    <Text style={styles.pastHint}>
                      {pastAllLoaded ? 'the beginning' : 'scroll up for older'}
                    </Text>
                  </View>
                );
              }
              if (item.__agendaHeader === 'upcoming') {
                return (
                  <View style={styles.upcomingHeader}>
                    <Icon name="clock-fast" size={16} color={theme.colors.accentInfo} />
                    <Text style={styles.upcomingHeaderText}>Upcoming</Text>
                    <View style={styles.upcomingCountBadge}>
                      <Text style={styles.upcomingCountText}>{upcomingTasks.length}</Text>
                    </View>
                    {/* Quiet "syncing" cue during a background revalidation
                        (app resume / reconnect) — never blanks the list. */}
                    {syncing && <SyncDot theme={theme} />}
                  </View>
                );
              }

              // ── Band gaps (the breathing room after each band) ───────────
              if (item.__gap) return <View style={styles.upcomingGap} />;
              // The add-task template: a dashed card at the head of Upcoming
              // that creates INTO the active board (active-board inheritance).
              if (item.__addCard) {
                const scoped = selectedProject !== 'All';
                return (
                  <TouchableOpacity
                    style={styles.addTaskCard}
                    onPressIn={() => tapHaptic()}
                    onPress={() => openCreateForm('task', null, scoped ? selectedProject : null)}
                    activeOpacity={0.6}
                    accessibilityRole="button"
                    accessibilityLabel={scoped ? `Add task to ${boardLabel(selectedProject)}` : 'Add task'}
                    testID="agenda-add-task"
                  >
                    <View style={styles.addTaskIcon}>
                      <Icon name="plus" size={18} color={theme.colors.textPrimary} />
                    </View>
                    <View style={styles.addTaskTextCol}>
                      <Text style={styles.addTaskTitle} numberOfLines={1}>Add task</Text>
                      <Text style={styles.addTaskCaption} numberOfLines={1}>
                        {scoped ? `to ${boardLabel(selectedProject)}` : 'to any board'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }

              const prev = index > 0 ? items[index - 1] : null;
              const next = index < items.length - 1 ? items[index + 1] : null;

              // ── Date dividers (real labels, fixed-height in the past zone,
              // natural in upcoming) — the rail runs through them unless they
              // lead their band (nothing above to connect to). ──────────────
              if (item.__divider) {
                return (
                  <View style={[styles.agendaDateDivider, item.__past ? { height: PAST_DIVIDER_H } : null]}>
                    {/* No rail segment: TimelineGutter draws the thread whole,
                        behind the list. A segment here would stack on it and
                        composite darker — see TimelineGutter. */}
                    <Text style={styles.agendaDateLabel}>{agendaDateLabel(item.dateKey)}</Text>
                    <View style={styles.agendaDateLine} />
                  </View>
                );
              }

              // Rail endpoints: a row is "first" when only its band header —
              // possibly with the leading divider — sits above it; "last" when
              // the band's gap follows.
              const isFirstRow = !!prev?.__agendaHeader
                || (!!prev?.__divider && !!items[index - 2]?.__agendaHeader);
              const isLastRow = !!next?.__gap;

              // ── Past zone: unloaded slot with the identical footprint ────
              if (item.__placeholder) {
                return <PastPlaceholderRow theme={theme} isFirst={isFirstRow} isLast={isLastRow} />;
              }

              // ── Rows. Past = `uniform` (fixed footprint, swaps invisible);
              // upcoming = natural height. ─────────────────────────────────
              return (
                <TimelineTaskRow
                  uniform={!!item.__past}
                  // The row under the mark. Only ever true for one row, and
                  // only while a scrub is in flight — `scrubDim` rests at 1,
                  // so a still list shows no emphasis at all.
                  active={!!activeRowId && item.id === activeRowId}
                  item={item}
                  onPress={openDetail}
                  onLongPress={openEditForm}
                  onToggleComplete={(it) => handleToggleComplete(it.id)}
                  // The time bubble is the row's when — tapping it reschedules.
                  onPressTime={setReschedulingTask}
                  isFirst={isFirstRow}
                  isLast={isLastRow}
                  // The left rail is the STRONG line here — black in light
                  // mode, white in dark so it stays visible.
                  railColor={theme.mode === 'dark' ? '#FFFFFF' : '#000000'}
                  // The card wears its board's colour; a row with no board
                  // gets the plain (white) card. `getProjectColor` answers
                  // with a neutral grey for "no board", which would paint a
                  // grey card that looks like a board — so ask only when
                  // there IS one.
                  boardColor={boardOf(item) ? getProjectColor(boardOf(item)) : null}
                  // Recurring rows read ✓ while their latest ticked occurrence
                  // is still current (done-now) and label the when-line with
                  // THAT date — not the already-advanced next dueDate.
                  done={isTaskDoneNow(item)}
                  doneDate={lastCompletedDate(item)}
                />
              );
            }}
            contentContainerStyle={{
              // FlashList accepts padding-only container styles; styles.list
              // was paddingBottom-only, folded in here.
              // A BREATH above the Past header, and only a breath: the deep
              // lead-in that used to sit here was a band of blank page you saw
              // every time you opened the Agenda, but flush against the tab
              // underline the band header had nothing to sit in. The depth the
              // MARK needs is separate and is handed to the pointer instead
              // (agendaVirtualLead), which already nets this padding off.
              paddingTop: AGENDA_TOP_PAD,
              // Clears the floating tab bar (which no longer reserves space)
              // or the keyboard, whichever is taller.
              paddingBottom: Math.max(tabBarHeight + 24, keyboardHeight + 20),
            }}
            // NO RefreshControl — the pull/scroll up is plain native motion
            // into the preloaded skeleton zone; data still refreshes on focus,
            // socket pushes, and the calendar page's pull-to-refresh.
            viewabilityConfig={viewabilityConfig}
            onViewableItemsChanged={onViewableItemsChanged}
            ListEmptyComponent={(
              <View style={styles.emptyState}>
                <Icon
                  name={searchQuery ? 'magnify-close' : 'folder-open'}
                  size={64}
                  color={theme.colors.textMuted}
                />
                <Text style={styles.emptyText}>
                  {searchQuery
                    ? `No matches for "${searchQuery}"`
                    : (showIncompleteOnly && tasks.some(t => t.completed)
                      ? 'No incomplete tasks'
                      : 'No tasks yet')}
                </Text>
                {!searchQuery && (
                  <TouchableOpacity
                    onPressIn={() => impactHaptic('medium')}
                    onPress={() => openCreateForm('task')}
                    style={styles.addNewTaskBtn}
                  >
                    <Icon name="plus" size={20} color={theme.colors.textPrimary} />
                    <Text style={styles.addNewTaskText}>Add new task</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          />
          </Animated.View>
          {/* The pointer, OVER the list (the notch stands proud of the band,
              across the thread) but pointerEvents:none, so it marks the spot
              without ever catching a scroll. Needs the list measured first —
              its position is a fraction of that height. */}
          {agenda.items.length > 0 && listH > 0 && (
            <TimelinePointer
              theme={theme}
              label={pointerLabel}
              scrubbing={scrubbing}
              beat={dayBeat}
              top={pointerTop}
            />
          )}
          {/* Cold-load skeleton for the Upcoming agenda — a fading overlay that
              cross-fades to the real rows the moment /tasks resolves (see
              UpcomingSkeletonOverlay). pointerEvents none; unmounts after the
              fade. Only ever visible on a genuine cold start (nothing cached);
              a warm cache paints instantly and this never mounts. */}
          <UpcomingSkeletonOverlay visible={initializing} theme={theme} />
          {/* Floating "Scroll to today" pill — appears while you've scrolled UP
              into the history band; tap to glide (animated) back down to today's
              tasks at the top of Upcoming. box-none so it never blocks list taps. */}
          {viewingPast && (
            <View style={styles.goToLatestWrap} pointerEvents="box-none">
              <TouchableOpacity
                style={styles.goToLatestBtn}
                onPressIn={() => tapHaptic()}
                onPress={goToLatest}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Scroll to today"
              >
                <Icon name="arrow-down" size={16} color={theme.colors.accentInfo} />
                <Text style={styles.goToLatestText}>Scroll to today</Text>
              </TouchableOpacity>
            </View>
          )}
          </View>
        </View>
        </View>
        {/* Page 1 — Calendar. The middle, so it is one swipe from either side. */}
        <View style={{ width: pagerSize.width, height: pagerSize.height }}>
        <CalendarView
          tasks={doneTasks}
          selectedProject={selectedProject}
          selectedTags={selectedTags}
          tagFilterMode={tagFilterMode}
          selectedOwners={selectedOwners}
          // The filter panel's "to do only" status — apply it to the calendar
          // too so completed tasks drop out of the day-cell lists (matching the
          // task tree), not just render struck-through.
          showIncompleteOnly={showIncompleteOnly}
          multiUser={multiUser}
          memberOf={memberOf}
          onPeoplePress={openPeopleList}
          pomodoroFor={pomodoroFor}
          onOpenPomodoro={openPomodoro}
          onTaskPress={openDetail}
          onTaskLongPress={openEditForm}
          onInspectTask={(task, dateStr) => setInspector({ id: task.id, date: dateStr || null })}
          onToggleComplete={handleToggleComplete}
          onStartPomodoro={startPomodoroFor}
          onUpdateTask={handleUpdateTask}
          onDeleteTask={deleteTask}
          projects={projects}
          // THE board colour — the same map the board rail, the header key and
          // the agenda's cards read. The calendar had its own hash-of-the-name
          // palette, so one board was two different colours depending on which
          // page you were looking at.
          boardColorOf={getProjectColor}
          onAddTask={(title, project, dueDate, time, extras) => {
            // `time` is the fourth argument — set when the user
            // long-pressed a slot on the day calendar grid. Null for
            // the regular "Add a new task" placeholder flow, in which
            // case the task is created untimed (omit the field rather
            // than store an empty string the server would interpret
            // as "set to 00:00").
            // `extras` (fifth arg) carries description/tags/subtasks when the
            // user re-adds a previously-existing task from the title
            // suggestions — copied onto this fresh instance with the new date.
            const newTask = {
              title,
              description: extras?.description || '',
              priority: extras?.priority || 'medium',
              completed: false,
              project,
              dueDate,
              tags: extras?.tags || [],
              subtasks: extras?.subtasks || [],
              id: Date.now().toString(),
              createdAt: Date.now(),
              ...(time ? { time } : {}),
            };
            handleSaveTask(newTask);
          }}
          refreshing={refreshing}
          onRefresh={onRefresh}
          // NOTE: intentionally no onDateChange refresh. Selecting a day is a
          // pure client-side view change — every task is already loaded, and the
          // hook re-validates on mount / reconnect / pull-to-refresh. Firing a
          // network reload on each tap replaced `tasks` with a fresh reference,
          // blowing away the per-month cell cache and rebuilding every visible
          // month right as the tap committed → the ~1s "delay until selected".
          onSelectedDateChange={setCalendarDate}
          onPlannerOpenChange={setDayPlannerOpen}
          // The day-planner's "+" creates a task pre-dated to the tapped day;
          // the type is still switchable inside the form.
          onCreateForDate={(dateStr, seed) => openCreateForm('task', dateStr, null, seed)}
          // Tap a task's owner badge → open that person's profile card.
          onOwnerPress={(t) => { if (t?.userId) setProfileOwner({ userId: t.userId, ownerName: t.ownerName }); }}
        />
        </View>

        {/* Page 2 — Boards. The Overview panel, embedded: no page shell and no
            header of its own.
            The search and filter keys that used to sit above it are on the
            PLANNER HEADER now, where every tab can reach them — this page was
            never the right owner for controls that scope the Agenda and the
            Calendar. The board rail went with them: picking a board is the
            filter panel's Board section, and this page already lists the boards
            and drills into one. */}
        <View style={{ width: pagerSize.width, height: pagerSize.height }}>
          {/* CAPTURE FIRST. The page used to open on four statistics and a list
              of boards — answers to questions you only have once you already
              use the app. The question a first-timer actually has is "where do
              I put a thing", and it was three taps away behind a floating key
              on another tab. The scope line that used to sit here is gone with
              it: the header already says which board you are on. */}
          <OverviewPage
            embedded
            // The capture field and its list go INSIDE the page's scroller (see
            // OverviewPage's `header`). As siblings above it they were outside
            // the only scroll view here and took their height off it, so a few
            // lines in the list left nothing scrollable underneath.
            header={({ overviewKey }) => (
              <View style={styles.inboxCaptureRow}>
                <InboxCapture
                  trailing={overviewKey}
                  destinationLabel={inboxLabel}
                  onAdd={(title) => {
                    const task = inboxTaskFrom(title, projects);
                    if (!task) return;
                    // Remembered for one render so the list knows which line to
                    // slide in — see InboxList. The id is the createdAt stamp.
                    setFreshInboxId(task.id);
                    handleSaveTask(task);
                  }}
                  theme={theme}
                />
                <InboxList
                  items={inbox.items}
                  total={inbox.total}
                  freshId={freshInboxId}
                  destinationLabel={inboxLabel}
                  c={theme.colors}
                  theme={theme}
                  onOpenTask={openDetail}
                  onOpenAll={() => setSelectedProject(inboxDestination(projects) || 'No Project')}
                />
              </View>
            )}
            visible={viewMode === 'boards'}
            tasks={tasks}
            boards={projects}
            colorOf={getProjectColor}
            sharedIn={sharedInLabels}
            selectedProject={selectedProject}
            calendarDate={calendarDate}
            onSelectBoard={(name) => setSelectedProject(name)}
            // The pencil beside a board's name opens the board's own sheet —
            // the same one a long-press on the rail used to.
            onEditBoard={(name) => openBoardManager(name)}
            onOpenFilters={() => setFilterOpen(true)}
            filterCount={selectedTags.length + selectedOwners.length}
            bottomInset={tabBarHeight}
            theme={theme}
            onDrillChange={setBoardsDrilled}
            onOpenTask={openDetail}
            // Born on the board being looked at, with no due date — the finder
            // is a capture field, not the full form (which is one tap further
            // in, from the task itself).
            onAddTask={(title, project) => {
              handleSaveTask({
                title,
                description: '',
                priority: 'medium',
                completed: false,
                project,
                dueDate: '',
                tags: [],
                subtasks: [],
                id: Date.now().toString(),
                createdAt: Date.now(),
              });
            }}
          />
        </View>

        {/* Page 3 — Focus. The countdown, what the blocks add up to, and the
            way into one.
            It reads the SAME /pomodoros the task cards' tallies come from, so
            the page and the little keys on the cards can never disagree about
            how much focus a thing has had — joined with the chat timer's own
            history, which is the only place a block with no task attached to it
            can live (see mergeFocusLog).
            `active` is the UNIFIED live block, so starting from here counts down
            HERE instead of handing you to the chat. */}
        <View style={{ width: pagerSize.width, height: pagerSize.height }}>
          <FocusPage
            sessions={pomoLog}
            active={focusBlock}
            focusMinutes={focusMinutes}
            boardOfTask={boardOfTaskId}
            taskOfId={taskOfId}
            // Tapping a recent block starts a fresh session on its task — and
            // the stamp rides along, so resuming something also gives it a slot
            // on today (see stampFocusSlot).
            onResumeBlock={resumeFocusBlock}
            focusTask={focusTask}
            onPickTask={() => { setFocusPickQuery(''); setFocusPickOpen(true); }}
            onClearTask={() => setFocusTaskId(null)}
            // A thought parked mid-block lands exactly where one typed on the
            // Inbox tab lands — one capture destination, not two.
            onJot={(line) => {
              const t = inboxTaskFrom(line, projects);
              if (t) handleSaveTask(t);
            }}
            onStart={startFocusHere}
            onStartBreak={startBreakHere}
            onStop={stopFocusHere}
            theme={theme}
            bottomInset={tabBarHeight + 24}
          />
        </View>
      </Animated.ScrollView>
      </View>

      {/* (The board rail and the status keys used to hang here as an absolute
          tray revealed over the page. They live on the BOARDS page now, behind
          its filter key — see the pager below.) */}
      </View>

      {/* The "+" create button now lives in the day-planner header's right
          corner (CalendarView's headerAddBtn) — a single white add button with
          the task count to its left. The old floating bottom-right FAB was
          removed to de-clutter the calendar page (smart minimalism). */}

      {/* ALL BOARDS — the project/tag tree on its OWN page, pushed in from the
          right Instagram-style (EdgeSwipePage: slide-in + left-edge swipe-back).
          The `overlay` form renders IN-TREE (no native modal), which is what
          lets TaskDetail / TaskForm — sibling Modals — present directly on top
          (see memory ios-nested-pagesheet-modal-gotcha), so tapping a task here
          opens its card and returns you to this page. Rendered LAST in the
          screen root so the absolute-fill overlay paints above the pager.
          Everything the tree had inline in the agenda list lives here
          unchanged: collapsible project groups, tag sections, TaskItem rows
          with subtask editing, and the edit-mode add-task affordances. */}
      <EdgeSwipePage
        visible={boardsPageOpen}
        onClose={() => setBoardsPageOpen(false)}
        overlay
      >
        <View style={[styles.boardsPageRoot, { paddingTop: insets.top }]}>
          <View style={styles.boardsPageHeader}>
            <TouchableOpacity
              onPress={() => setBoardsPageOpen(false)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Icon name="chevron-left" size={26} color={theme.colors.textPrimary} />
            </TouchableOpacity>
            <FourColorBoardsIcon size={18} />
            <Text style={styles.boardsPageTitle}>All Boards</Text>
            {/* View/Edit toggle — moved here from the Upcoming list toolbar. Edit
                mode reveals each project's inline "add a task" affordance (and
                the tag-group add/rename controls); View keeps the browse clean. */}
            <View style={styles.modeToggle}>
              <TouchableOpacity
                style={[styles.modeBtn, !editMode && styles.modeBtnActive]}
                onPress={() => setEditMode(false)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="View mode"
              >
                <Icon name="eye-outline" size={15} color={!editMode ? theme.colors.textPrimary : theme.colors.textTertiary} />
                <Text style={[styles.modeBtnText, !editMode && styles.modeBtnTextActive]}>View</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeBtn, editMode && styles.modeBtnActive]}
                onPress={() => setEditMode(true)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Edit mode"
              >
                <Icon name="pencil-outline" size={15} color={editMode ? theme.colors.textPrimary : theme.colors.textTertiary} />
                <Text style={[styles.modeBtnText, editMode && styles.modeBtnTextActive]}>Edit</Text>
              </TouchableOpacity>
            </View>
          </View>
          <SectionList
            ref={boardsListRef}
            sections={collapsible.groupedData}
            keyExtractor={(item, index) => (item ? `${item.id || index}` : `board-section-${index}`)}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            stickySectionHeadersEnabled={false}
            onScroll={(e) => { boardsScrollY.current = e.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={32}
            contentContainerStyle={{ paddingBottom: Math.max(60, keyboardHeight + 20) }}
            renderItem={({ item, section }) => {
              if (!item || section.type !== 'tag' || !section.isExpanded) return null;
              return (
                <TaskItem
                  item={item}
                  expanded={expandedTaskId === item.id}
                  onToggleExpand={handleToggleTaskExpand}
                  // Direct: the in-tree overlay imposes no modal constraints,
                  // so the task card opens right over this page.
                  onPress={() => openDetail(item)}
                  onToggleComplete={handleToggleComplete}
                  onLongPress={openEditForm}
                  onAddSubtask={handleAddSubtask}
                  onToggleSubtask={handleToggleSubtask}
                  onDeleteSubtask={handleDeleteSubtask}
                  onUpdateSubtask={handleUpdateSubtask}
                  onUpdateTask={handleUpdateTask}
                  onDeleteTask={handleDelete}
                  listRef={boardsListRef}
                  scrollY={boardsScrollY}
                  scrollToItem={() => scrollToItem(item.id)}
                  keyboardVisible={keyboardVisible}
                />
              );
            }}
            renderSectionHeader={({ section }) => {
              if (section.type === 'project') {
                // Project header with collapse toggle. A coloured left border +
                // count badge (in the project's colour) make each project
                // visually distinct at a glance.
                const projColor = getProjectColor(section.project);
                return (
                  <View style={styles.projectSection}>
                    <TouchableOpacity
                      style={[styles.projectHeader, { borderLeftColor: projColor }]}
                      onPress={() => collapsible.toggleProjectExpand(section.project)}
                      activeOpacity={0.7}
                    >
                      <Animated.View style={{
                        transform: [{
                          rotate: (projectRotations[section.project] || new Animated.Value(0)).interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0deg', '90deg']
                          })
                        }]
                      }}>
                        <Icon name="chevron-right" size={22} color={projColor} />
                      </Animated.View>
                      <Text style={styles.projectHeaderText} numberOfLines={1}>{boardLabel(section.title)}</Text>
                      {section.visibleTaskCount > 0 && (
                        <View style={styles.projectCountBadge}>
                          <Text style={[styles.projectCountText, { color: projColor }]}>{section.visibleTaskCount}</Text>
                        </View>
                      )}
                    </TouchableOpacity>

                    {/* Add task input — shown only in EDIT mode, so View mode
                        stays clean. */}
                    {section.isExpanded && editMode && (
                      inlineAddingProject === section.project ? (
                        // Inline input mode
                        <View style={styles.projectAddTaskContainer}>
                          <AppTextInput
                            ref={inlineInputRef}
                            style={styles.projectAddTaskInputField}
                            placeholder="Add a new task"
                            placeholderTextColor={theme.colors.textPlaceholder}
                            value={inlineTaskTitle}
                            onChangeText={setInlineTaskTitle}
                            onSubmitEditing={() => {
                              if (inlineTaskTitle.trim()) {
                                handleInlineAdd(section.project, [], inlineTaskTitle.trim());
                                setInlineTaskTitle('');
                                setInlineAddingProject(null);
                              }
                            }}
                            autoFocus
                            blurOnSubmit={false}
                            returnKeyType="done"
                            onBlur={() => {
                              // Delay to allow button press first
                              setTimeout(() => {
                                setInlineTaskTitle('');
                                setInlineAddingProject(null);
                              }, 200);
                            }}
                          />
                          <TouchableOpacity
                            style={styles.projectAddTaskClose}
                            onPress={() => {
                              setInlineTaskTitle('');
                              setInlineAddingProject(null);
                            }}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          >
                            <Icon name="close" size={18} color={theme.colors.textTertiary} />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        // Placeholder mode
                        <TouchableOpacity
                          style={styles.projectAddTaskPlaceholder}
                          onPress={() => setInlineAddingProject(section.project)}
                          activeOpacity={0.7}
                        >
                          <View style={styles.projectAddTaskInput} pointerEvents="none">
                            <Text style={styles.projectAddTaskText}>Add a new task</Text>
                          </View>
                        </TouchableOpacity>
                      )
                    )}
                  </View>
                );
              }

              // Tag group header - only shown if parent project is expanded
              return (
                <SectionHeader
                  section={section}
                  expanded={section.isExpanded}
                  editMode={editMode}
                  onToggleExpand={() => collapsible.toggleTagGroupExpand(section.project, section.title)}
                  onAddTask={handleInlineAdd}
                  onRenameTag={handleRenameTag}
                  onAddTagToSection={handleAddTagToSection}
                  projectColor={getProjectColor(section.project)}
                />
              );
            }}
            ListEmptyComponent={(
              <View style={styles.emptyState}>
                <Icon name="folder-open" size={64} color={theme.colors.textMuted} />
                <Text style={styles.emptyText}>No boards yet</Text>
              </View>
            )}
          />
        </View>
      </EdgeSwipePage>

      {/* (Overview is no longer a page you open from here — it IS the
          Boards tab, embedded in the pager above.) */}

      {/* Board manager: the app's sheet shell, mounted LAST so it draws over
          every other overlay on this screen. Rename keeps the selection on the
          renamed board; a row tap scopes the screen and closes. */}
      {showProjectManager && (
        <BoardManagerSheet
          boards={projects}
          tasks={tasks}
          stats={boardStats}
          colorOf={getProjectColor}
          sharedIn={sharedInLabels}
          selected={selectedProject}
          initialBoard={manageBoard}
          bottomInset={tabBarHeight}
          theme={theme}
          onClose={() => setShowProjectManager(false)}
          onAdd={addProject}
          onRename={async (from, to) => {
            const ok = await renameProject(from, to);
            if (ok && selectedProject === from) setSelectedProject(to);
            return ok;
          }}
          onDelete={(name, opts) => {
            if (selectedProject === name) setSelectedProject('All');
            return deleteProject(name, opts);
          }}
          onSelect={(name) => { setSelectedProject(name); setShowProjectManager(false); }}
        />
      )}

      {/* The day panel's inspector, in a transparent Modal so it covers the
          tab bar as well — the one overlay on this screen that has to sit
          above everything. Its own date / time pickers are Modals NESTED in
          its tree (not siblings of this one), which iOS presents fine. */}
      {!!inspectorTask && (
        <Modal
          visible
          transparent
          animationType="none"
          statusBarTranslucent
          onRequestClose={closeInspector}
          supportedOrientations={['portrait', 'landscape']}
        >
          <TaskInspectorSheet
            task={inspectorTask}
            onClose={closeInspector}
            onUpdateTask={handleUpdateTask}
            onToggleComplete={handleToggleComplete}
            onDeleteTask={deleteTask}
            // The tap came from one day's occurrence — tick THAT day.
            contextDate={inspector?.date || null}
            // On a shared calendar, name the co-owner so a move can offer to
            // tell them.
            notifyTargetName={multiUser ? (inspectorTask.ownerName || null) : null}
            boards={projects}
            colorOf={getProjectColor}
            use24h={timeFormat === '24h'}
            // Nothing of the app shows under this sheet, so its footer only
            // has to clear the home indicator.
            bottomInset={insets.bottom}
            theme={theme}
            onOpenFull={() => { closeInspector(); openEditForm(inspectorTask); }}
          />
        </Modal>
      )}

      {/* Reschedule, opened from an agenda row's time bubble. Its own Modal,
          so it covers the tab bar like the inspector does. */}
      <SchedulePickerSheet
        visible={!!reschedulingTask}
        task={reschedulingTask}
        onSubmit={handleReschedule}
        onClose={() => setReschedulingTask(null)}
      />
    </View>
  );
}

const createStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  // Positioned host for the project-picker overlay. flex:1 so it fills the
  // space below the header; overflow:hidden clips the shift layer's bottom
  // (translated down by the picker height) so it never draws over the tab
  // bar / FAB. Absolute children (the picker) anchor to this host's top.
  dropdownHost: {
    flex: 1,
    overflow: 'hidden',
  },
  // The page content (filters bar + list/calendar) that slides down as the
  // picker reveals. flex:1 so the list/calendar keep their full height; the
  // translateY is applied via the animated contentShiftStyle.
  dropdownShiftLayer: {
    flex: 1,
  },
  // Horizontal paging ScrollView holding the calendar + list pages.
  viewPager: {
    flex: 1,
  },
  // Full-screen gradient layer — sits behind the entire screen via
  // absoluteFillObject. zIndex 0 keeps it under regular flex children
  // (which default to elevation 0 but render in DOM order, on top).
  backgroundGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  centerContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: theme.colors.background 
  },
  offlineImage: {
    width: 54,
    height: 45,
  },
  offlineText: {
    fontSize: 13,
    color: theme.colors.textTertiary,
    marginTop: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  offlineSubtext: {
    fontSize: 11,
    color: theme.colors.textMuted,
    marginTop: 5,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  
  // The key row: view pill · status keys · filter · +. No bottom rule —
  // the board rail under it is the header's second line.
  // ── The header, the media vault's ─────────────────────────────────────────
  // Title row, then the picker, then a hairline. Every number here is the
  // vault's (MediaGallery's header): a 44pt title row on HEADER_PAD_X, a 34pt
  // track with 8 under it, a 3pt bar with 2pt caps, and 15pt labels at 700 /
  // 500. Copied rather than approximated — two tab bars that are ALMOST the
  // same is worse than two that are obviously different.
  headerChrome: {
    backgroundColor: theme.colors.background,
  },
  // The groove under the header. Its own element rather than the chrome's
  // border, because it is TWO hairlines — see `insetRule`: a shadow line with a
  // highlight under it, which is what reads as a cut in the page rather than a
  // line drawn on it.
  headerRule: insetRule(theme),
  // A ROW now: the title, then the search and filter keys hard right. They sit
  // on this line rather than under the tab picker so they are in the same place
  // on all four tabs, and so the picker keeps its full width to scroll in.
  headerTitleRow: {
    height: SCREEN_TITLE_ROW_H,
    paddingHorizontal: HEADER_PAD_X,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // The title AS a key: the label and its disclosure on one line, taking all
  // the room the two keys on the right do not need.
  headerTitleKey: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  headerTitleLarge: {
    // Shrinks to whatever sits beside it rather than pushing it off the edge
    // (STYLE-RULES §2).
    flex: 1,
    // The app's screen title (utils/headerType): every tab's title is this
    // size, so the set reads as one product. The two WEIGHTS below are this
    // header's own — the constant half hairline, the half that varies regular.
    ...SCREEN_TITLE,
    color: theme.colors.textPrimary,
  },

  headerTitleThin: { fontWeight: '100' },
  headerTitleStrong: { fontWeight: '400' },
  // A horizontal ScrollView is flexGrow:1 by default and would swallow the
  // column's free height; the row is exactly one tab tall.
  tabScroll: { flexGrow: 0, marginBottom: 10 },
  tabTrack: {
    paddingHorizontal: HEADER_PAD_X,
    height: 40,
    flexDirection: 'row',
    alignItems: 'stretch',
    position: 'relative',
  },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    // ONE POINT wide, scaled to the live tab. Square, and that is not a
    // compromise: scaleX on a rounded bar stretches the caps into a lens, and
    // the rule this is copied from is square anyway.
    //
    // left:0, NOT the track's padding: a tab's measured `x` already includes
    // the container's padding (Yoga gives a child's layout.x from the parent's
    // border box), so adding it here again would park the bar one margin to
    // the right of the tab it belongs under.
    left: 0,
    width: 1,
    // Scaled down with the type it underlines: 3pt under a 13pt label is a
    // rule with a label on it rather than a label with a rule under it.
    height: 2.5,
    transformOrigin: 'left',
    // THE highlight, not the ink: the bar is the one thing on the header that
    // says which page you are on, and the accent is what says 'active'
    // everywhere else in the app.
    backgroundColor: theme.colors.accent || theme.colors.accentInfo,
  },
  // Sized to its own content, with the gap AFTER it — Pinterest's board
  // headers, not equal thirds. The gap is the ONLY thing separating two tabs,
  // so it does all the work of telling them apart: at 24 with four tabs the
  // row read as one long string of words, and widening it buys more legibility
  // than any amount of extra type size would.
  tabSeg: { justifyContent: 'center', alignItems: 'center', marginRight: 30, zIndex: 1 },
  tabSegLast: { marginRight: 0 },
  // Icon and word on one line. The ACTIVE row is absolute so it can sit over
  // the inactive one without either affecting the other's layout — and so its
  // onLayout reports the row's CONTENT width, which is what the bar is sized
  // to.
  tabSegRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // Tighter than the gap BETWEEN tabs, and by a wide margin: an icon and its
    // word have to read as one thing, or the eye counts eight items in the row
    // instead of four. This is the whole reason the between-gap can do its job.
    gap: 4,
  },
  tabSegRowActive: { position: 'absolute' },
  // 17 → 13. The reference board headers carry a WORD each; these carry a word
  // AND an icon, and four of them — so the same size that reads as display
  // type there read as a crowded banner here. The room comes from the gaps
  // now, which is the cheaper place to buy it.
  //
  // No negative tracking with it: −0.2 was tuned at 17 and at 13 it closes up
  // letters that need the air.
  tabSegText: { fontSize: 13, letterSpacing: 0 },
  tabSegTextActive: { fontWeight: '700', color: theme.colors.textPrimary },
  // The SAME ink as the active label — the opacity above is what separates
  // them. A second, dimmer colour on top of a 60% opacity compounds into
  // something closer to 40%, which is where a label stops being legible and
  // starts being a smudge you have to lean in at.
  tabSegTextInactive: { fontWeight: '500', color: theme.colors.textPrimary },
  // ── The Boards page's own chrome ──────────────────────────────────────────
  // Its key row: the scope's name, then search and filter. Deliberately NOT a
  // second header bar — the segmented control above is the header, so this is
  // a row of keys on the page, at the page's own margin.
  // The capture block's slot. NO horizontal padding: it lives inside the
  // Overview page's scroller now, whose contentContainer already carries the
  // page's 16pt margin — taking it again here would inset it from everything
  // it sits above.
  inboxCaptureRow: {
    paddingBottom: 12,
  },
  // The header's two keys. Bare glyphs at rest — the title line is not a
  // toolbar, and two outlined boxes beside a title read as a second header —
  // and a filled key only when the filter is actually narrowing something.
  headerKey: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerKeyLit: {
    backgroundColor: theme.colors.textPrimary,
  },
  headerBoardDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Header filter button — replaces the old bottom-right floating FAB so the
  // filter control sits in the header and no longer overlaps screen content.
  // Sized + bordered to match the viewToggle sitting next to it.
  headerFilterBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: theme.colors.surface,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 0,
    ...depth(theme, 'control'),
  },
  headerFilterBtnActive: {
    backgroundColor: theme.colors.surfaceElevated,
  },
  headerFilterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: theme.colors.accentError,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  headerFilterBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  // (The old segmented control — a track, a sliding pill and two 84pt
  //  segments — is gone. The picker is the vault's now: bare labels with a
  //  bar under them. See headerChrome / tabTrack above.)
  
  // View/Edit toggle — now hosted in the All Boards page header (edit mode
  // reveals each project's inline add-task + tag controls).
  // The boards PAGE's header title ("All Boards"), not the Inbox tab's — the
  // tab's own scope line is gone, and with it the SECOND style of this name
  // that had been shadowing this one. They were different sizes and only this
  // one ever reached the screen; the duplicate key was the tell.
  boardsPageTitle: {
    flex: 1,
    fontSize: theme.typography.body,
    fontWeight: '800',
    color: theme.colors.textPrimary,
    letterSpacing: 0.3,
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    padding: 2,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
    ...depth(theme, 'control'),
  },
  modeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  modeBtnActive: {
    backgroundColor: theme.colors.surfaceElevated,
  },
  modeBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textTertiary,
  },
  modeBtnTextActive: {
    color: theme.colors.textPrimary,
  },
  // Spacing between consecutive project groups, so projects read as distinct
  // blocks rather than one undivided list.
  // "Upcoming" agenda header (synthetic section at the top of the list view).
  upcomingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    // STOPS AT THE BAND'S EDGE. This used to start at x=16 and paint an opaque
    // page-coloured strip straight across the gutter — deliberately, because a
    // header writing dark ink onto the black band would have been unreadable.
    // But cutting the band is what left HOLES in it: the pointer's notch is
    // pinned to a fixed y, so whenever a header happened to be scrolled under
    // it the notch had no band to bite into and its shoulders floated as loose
    // black crescents on the white page.
    //
    // Starting at the gutter's edge solves both at once — the header never
    // touches the band (so it stays readable and the band stays unbroken), and
    // its content lines up with the card column rather than the screen edge.
    marginLeft: MARGIN_EDGE_X,
    paddingLeft: CARD_COL_X - MARGIN_EDGE_X,
    paddingRight: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    // Still opaque: it separates the two bands from the rows above it.
    backgroundColor: theme.colors.background,
  },
  upcomingHeaderText: {
    fontSize: theme.typography.body,
    fontWeight: '800',
    color: theme.colors.textPrimary,
    letterSpacing: 0.3,
    flex: 1,
  },
  // The dashed add-task template at the head of Upcoming: an empty inset
  // slot the next task drops into.
  // It is a TASK CARD, so it occupies exactly what a task card occupies: the
  // same column, the same width, the same height, the same corner. It used to
  // run marginHorizontal:16 — starting left of the gutter, ending flush with
  // the screen edge — so it was visibly wider than every card under it AND
  // painted an opaque strip over the band (another hole for the notch to fall
  // into). Only the dashed edge sets it apart now, which is the one difference
  // that carries meaning: this is the empty slot, not a task.
  addTaskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginLeft: CARD_COL_X,
    marginRight: ROW_PAD,
    marginBottom: 12,
    height: UNIFORM_CARD_H,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
    // Transparent now. The opacity existed only to hide the band this card
    // used to overlap; clear of the gutter it has nothing to hide, and an
    // empty slot should show the page through it.
    backgroundColor: 'transparent',
  },
  addTaskIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTaskTextCol: {
    flex: 1,
  },
  addTaskTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  addTaskCaption: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    color: theme.colors.textTertiary,
    marginTop: 1,
  },
  upcomingCountBadge: {
    minWidth: 22,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upcomingCountText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.accentInfo,
    fontVariant: ['tabular-nums'],
  },
  // Floating "Latest" jump pill — centred near the bottom of the list while the
  // user is scrolled up in the history band. The wrapper spans the width (so the
  // pill centres) and is box-none, so only the pill itself catches taps.
  goToLatestWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: 'center',
    zIndex: 20,
  },
  goToLatestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  goToLatestText: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  // Faint affordance on the Past header — "scroll up for older" / "the beginning".
  pastHint: {
    fontSize: 11,
    fontWeight: '500',
    color: theme.colors.textTertiary,
    marginLeft: 8,
  },
  // Agenda date divider — a short FAINT date word ("Today" / "July 20") on the
  // right with a FAINT line beneath it. The line stops CLEAR of the strong black
  // timeline rail (no intersection, no cutting), and a gap under the line cuts
  // between each date group's tasks. `position: relative` anchors the rail.
  agendaDateDivider: {
    position: 'relative',
    paddingTop: 12,
    // The gap BELOW the line that cuts between date groups' tasks.
    paddingBottom: 14,
    paddingRight: 14,
  },
  // The thread, continuing through the divider — same x, same hairline width
  // and the same colour as the rail TimelineTaskRow draws, so the line is
  // unbroken from the first row of the agenda to the last. All three are
  // IMPORTED rather than repeated: the divider and the rows agreeing on these
  // numbers is the whole difference between one timeline and a column of
  // dashes. (This segment used to be full-strength ink while the rows drew
  // theirs at 45%, so the line darkened at every date.)
  agendaRailThrough: {
    position: 'absolute',
    left: RAIL_ABS_X - RAIL_W / 2,
    top: 0,
    bottom: 0,
    width: RAIL_W,
    backgroundColor: threadColor(theme),
  },
  // The date a group of rows belongs to. It is the agenda's only signpost —
  // every card below it says a time but not a day — so at 12pt in the faintest
  // ink it was the hardest thing on the page to read and the thing you most
  // often needed. Up to 15, a step firmer in colour, and with the tracking
  // opened rather than tightened: a short right-aligned date reads as a label
  // that way instead of as a cramped caption.
  //
  // STILL QUIET. The weight, the alignment and the rule under it are unchanged,
  // so it gained legibility without becoming a heading that competes with the
  // band headers above it.
  //
  // `lineHeight` is EXPLICIT and load-bearing: the past zone locks its dividers
  // to PAST_DIVIDER_H, and a height that came from the platform's own idea of
  // a 15pt line would make that constant a guess that drifts per OS version.
  agendaDateLabel: {
    alignSelf: 'flex-end',
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    letterSpacing: 0.3,
    marginBottom: 5,
  },
  agendaDateLine: {
    // Start clear of the thread (and of the beads strung on it) so the date
    // rule never cuts across it; run to the row's right edge.
    // Starts at the CARD's left edge (row padding + time column + card gap),
    // so the date rule never crosses the thread or a bubble.
    marginLeft: 14 + 74 + 12,
    height: 1,
    // Faint line.
    backgroundColor: theme.colors.border,
  },
  // "All Boards" — the doorway row at the very bottom of the agenda.
  allBoardsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 14,
    marginTop: 10,
    marginBottom: 6,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...depth(theme, 'control'),
  },
  allBoardsButtonText: {
    flex: 1,
    fontSize: theme.typography.body,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    letterSpacing: 0.2,
  },
  allBoardsCountBadge: {
    minWidth: 22,
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allBoardsCountText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  // The boards page (pageSheet Modal) that hosts the project/tag tree.
  boardsPageRoot: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  boardsPageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  // The breathing room between the upcoming agenda and the project tree below.
  // The rule that separates the two bands. It STOPS at the gutter, like the
  // headers do — drawn full-width it ruled a pale line straight across the
  // black margin, which is a seam in the one element that has to read as
  // continuous for the notch to look part of its edge.
  upcomingGap: {
    height: 14,
    marginTop: 4,
    marginBottom: 4,
    marginLeft: MARGIN_EDGE_X,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  projectSection: {
    marginTop: 8,
  },
  projectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
    // Coloured accent edge (colour set inline per project) — the quickest
    // visual cue for which project a block belongs to.
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  projectHeaderText: {
    fontSize: theme.typography.body,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    marginLeft: theme.spacing.sm,
    flex: 1,
  },
  // Count of the project's currently-visible tasks, tinted in the project colour.
  projectCountBadge: {
    minWidth: 22,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  projectCountText: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  projectAddTaskPlaceholder: {
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  projectAddTaskInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 6,
    padding: 8,
    paddingLeft: theme.spacing.xl,
  },
  projectAddTaskText: {
    fontSize: theme.typography.body,
    color: theme.colors.textPlaceholder,
  },
  projectAddTaskContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  projectAddTaskInputField: {
    flex: 1,
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 6,
    padding: 8,
    paddingLeft: theme.spacing.xl,
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    marginRight: 8,
  },
  projectAddTaskClose: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },

  listClip: {
    flex: 1,
    overflow: 'hidden',
  },
  listShift: {
    flex: 1,
  },
  searchBar: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.colors.background,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  searchInputRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 36,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: theme.typography.body,
    color: theme.colors.inputText,
    padding: 0,
  },
  searchClearBtn: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },

  activeFiltersBar: {
    backgroundColor: theme.colors.background,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    marginRight: 8,
    ...depth(theme, 'control'),
  },
  warningChip: { 
    backgroundColor: 'rgba(255, 193, 7, 0.15)' 
  },
  tagFilterChip: {
    backgroundColor: theme.colors.surface
  },
  ownerFilterChip: {
    backgroundColor: theme.colors.surface,
  },
  ownerFilterDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 2,
  },
  filterChipText: { 
    fontSize: theme.typography.body, 
    color: theme.colors.textPrimary, 
    marginHorizontal: 4 
  },
  warningChipText: { 
    color: theme.colors.accentWarning 
  },
  tagFilterChipText: { 
    color: theme.colors.textSecondary 
  },
  
  list: { 
    paddingBottom: 100 
  },
  emptyState: { 
    alignItems: 'flex-start',
    marginTop: 80,
    paddingLeft: theme.spacing.xl,
    paddingRight: theme.spacing.md,
  },
  emptyText: { 
    marginTop: 16, 
    color: theme.colors.textSecondary, 
    fontSize: theme.typography.body 
  },
  addNewTaskBtn: { 
    marginTop: 20, 
    backgroundColor: theme.colors.surfaceElevated, 
    paddingHorizontal: 24, 
    paddingVertical: 12, 
    borderRadius: 24, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  addNewTaskText: { 
    color: theme.colors.textPrimary, 
    fontWeight: '600', 
    marginLeft: 8, 
    fontSize: theme.typography.body 
  },

});
