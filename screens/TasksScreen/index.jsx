import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
  Alert,
  Keyboard,
  Platform,
  LayoutAnimation,
  TextInput,
  ScrollView,
  useWindowDimensions,
  PixelRatio,
} from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing as ReEasing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { useServer } from '../../context/ServerContext';
import { useTheme } from '../../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTaskData } from './hooks/useTaskData';
import { useCollapsibleTasks } from './hooks/useCollapsibleTasks';
import { advanceDueDate, minDate, maxDate, localTodayStr, lastCompletedDate, isTaskDoneNow, matchesRecurrence, nextOccurrenceAfter, itemTypeOf, taskPassesFilters, boardLabel } from './utils/taskHelpers';
import { tapHaptic, impactHaptic } from '../../utils/haptics';

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
const agendaDateLabel = (key) => {
  const todayStr = localTodayStr();
  if (key === todayStr) return 'Today';
  const then = parseYMDLocal(key);
  const now = parseYMDLocal(todayStr);
  const diff = Math.round((then.getTime() - now.getTime()) / 86400000);
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const label = `${AGENDA_MONTHS[then.getMonth()]} ${then.getDate()}`;
  return then.getFullYear() === now.getFullYear() ? label : `${label}, ${then.getFullYear()}`;
};

// Same stable per-owner colour as the calendar badges and the FilterMenu
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
  ProjectDropdown,
  configureProjectDropdownAnimation,
  FilterMenu,
  TaskStatsModal,
  ProjectManager,
  TaskForm,
  TaskDetail,
  TaskItem,
  TimelineTaskRow,
  UNIFORM_CARD_H,
  SectionHeader,
  CalendarView,
} from './components';
import FriendCard from '../TurtleScreen/components/FriendCard';
import EdgeSwipePage from '../TurtleScreen/components/EdgeSwipePage';
import { useNavigation } from '@react-navigation/native';
import { useCommandBus } from '../../context/CommandBusContext';
import { useCelebration } from '../../context/CelebrationContext';

// Must match MAX_HEIGHT in ProjectDropdown.jsx — the page below the picker
// is translated down by exactly this much as the picker reveals, so the two
// stay seamlessly joined.
const PROJECT_DROPDOWN_HEIGHT = 360;
// Same duration + easing the ProjectDropdown uses for its own height reveal,
// so the page-shift below tracks the picker's bottom edge frame-for-frame.
const DROPDOWN_OPEN_MS = 280;
const DROPDOWN_CLOSE_MS = 240;
const DROPDOWN_EASE = ReEasing.bezier(0.4, 0, 0.2, 1);

// Distinct project colours that read well against the green/yellow palette.
// Module-level (a pure constant) so it isn't rebuilt on every render.
const PROJECT_COLORS = [
  '#4CAF50', // Green
  '#2196F3', // Blue
  '#9C27B0', // Purple
  '#FF5722', // Deep Orange
  '#00BCD4', // Cyan
  '#795548', // Brown
  '#E91E63', // Pink
  '#3F51B5', // Indigo
  '#009688', // Teal
  '#FF9800', // Orange
  '#607D8B', // Blue Grey
  '#8BC34A', // Light Green
  '#00E676', // Bright Green
  '#2979FF', // Bright Blue
  '#D500F9', // Bright Purple
  '#FF3D00', // Bright Orange
  '#00B0FF', // Light Blue
  '#76FF03', // Lime
  '#FFEA00', // Yellow
  '#FF9100', // Amber
];

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
function PastPlaceholderRow({ theme, isFirst, isLast }) {
  const pulse = getSharedPulse();
  const block = theme.colors.border;
  const rail = theme.mode === 'dark' ? '#FFFFFF' : '#000000';
  const card = theme.mode === 'dark' ? theme.colors.surfaceHighlight : theme.colors.surface;
  const bar = (w, h, extra) => ({ width: w, height: h, borderRadius: h / 2, backgroundColor: block, ...(extra || {}) });
  return (
    <View style={{ flexDirection: 'row', marginBottom: 12, paddingHorizontal: 14 }} pointerEvents="none">
      {/* Rail — same strong connecting line + a hollow "unloaded" dot where
          the completion toggle sits on real rows (40×40 slot, dot centred). */}
      <View style={{ width: 40, alignSelf: 'stretch', alignItems: 'center' }}>
        {!isFirst && <View style={{ position: 'absolute', left: 19, top: 0, height: 20, width: 2, backgroundColor: rail }} />}
        {!isLast && <View style={{ position: 'absolute', left: 19, top: 20, bottom: -12, width: 2, backgroundColor: rail }} />}
        <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: card, borderWidth: 1.5, borderColor: block }} />
        </View>
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
  const card = theme.mode === 'dark' ? theme.colors.surfaceHighlight : theme.colors.surface;
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
        <View style={{ alignSelf: 'flex-end', width: 56, height: 11, borderRadius: 6, backgroundColor: theme.colors.border, marginBottom: 4 }} />
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
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { isConnected, api } = useServer();
  const { celebrate } = useCelebration();
  const navigation = useNavigation();
  const { dispatch: dispatchCommand } = useCommandBus();
  const menuAnimation = useRef(new Animated.Value(0)).current;
  const [showDropdown, setShowDropdown] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showStats, setShowStats] = useState(false);
  // Mirror of the calendar's selected day (CalendarView owns it; it reports
  // up via onSelectedDateChange) so the stats panel can show that day's
  // scheduled/completed counts.
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [showProjectManager, setShowProjectManager] = useState(false);
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
  const [showDetail, setShowDetail] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  // True when the edit form was reached by continuing the calendar quick
  // inspector (so it presents as a continuation, not a fresh slide-up).
  const [formContinue, setFormContinue] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  // Accordion for the task tree: only ONE task row's subtasks/details are
  // expanded at a time — expanding another collapses the previous, so exactly
  // one item is ever "open". null = none expanded.
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const handleToggleTaskExpand = useCallback(
    (id) => setExpandedTaskId((prev) => (prev === id ? null : id)),
    [],
  );
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(true);
  const [selectedProject, setSelectedProject] = useState('All');
  const [selectedTags, setSelectedTags] = useState([]);
  const [tagFilterMode, setTagFilterMode] = useState('any');
  // Shared-calendar "whose tasks" filter. Empty = show everyone's; otherwise a
  // list of user ids to show. The owner identity rides on each task DTO
  // (userId/ownerName) from the server, so the option list is derived straight
  // from the loaded tasks — no extra fetch needed.
  const [selectedOwners, setSelectedOwners] = useState([]);
  const [viewMode, setViewMode] = useState('calendar'); // 'list' or 'calendar'
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
  // between DAYS inside the planner instead of switching to the list view.
  const [dayPlannerOpen, setDayPlannerOpen] = useState(false);

  // ── List ⇄ Calendar horizontal pager ─────────────────────────────────
  // The two views sit side by side in a paging ScrollView so the user can
  // swipe left/right between them (like the photos viewer), in addition to the
  // header toggle. Page order = calendar (left, the default) | list (right).
  // The calendar's own gestures are vertical (month FlatList + the bottom-sheet
  // drag), so a horizontal page-swipe never fights them.
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
  const VIEW_PAGES = ['calendar', 'list'];
  const viewIndex = (m) => (m === 'calendar' ? 0 : 1);
  // Tap the header toggle → set the mode AND glide the pager to that page.
  const goToView = useCallback((mode) => {
    setViewMode(mode);
    pagerRef.current?.scrollTo({ x: viewIndex(mode) * pagerSize.width, y: 0, animated: true });
  }, [pagerSize.width]);
  // Settle after a swipe → adopt whichever page we landed on (no re-scroll, so
  // this can't fight goToView's programmatic scroll).
  const onPagerSettle = useCallback((e) => {
    const w = pagerSize.width || windowWidth;
    const idx = Math.round(e.nativeEvent.contentOffset.x / w);
    const mode = VIEW_PAGES[idx] || 'calendar';
    setViewMode((prev) => (prev === mode ? prev : mode));
  }, [pagerSize.width, windowWidth]);

  // NOTE: the selected-day completion stats (dayStats / dayPct) live AFTER the
  // useTaskData() call below — they read `tasks`, and declaring them up here
  // (above the hook) left `tasks` undefined on first render, throwing
  // "cannot read property 'filter' of undefined".

  // ── Project-picker reveal (smooth) ───────────────────────────────────
  // The picker itself is an absolute overlay (see ProjectDropdown). To keep
  // the original "the page slides down as the picker opens" look WITHOUT
  // relayouting the heavy list/calendar every frame, we push the page with a
  // compositor-only transform: translateY = progress * height. progress runs
  // on the UI thread with the exact same timing/easing as the picker's own
  // height animation, so the page's top edge stays glued to the picker's
  // bottom edge throughout the open/close.
  const dropdownProgress = useSharedValue(showDropdown ? 1 : 0);
  useEffect(() => {
    dropdownProgress.value = withTiming(showDropdown ? 1 : 0, {
      duration: showDropdown ? DROPDOWN_OPEN_MS : DROPDOWN_CLOSE_MS,
      easing: DROPDOWN_EASE,
    });
  }, [showDropdown, dropdownProgress]);
  const contentShiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dropdownProgress.value * PROJECT_DROPDOWN_HEIGHT }],
  }));

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
    // Animate the list's bottom-padding change along the SAME curve and
    // duration iOS reports for the keyboard, so the content rises in lockstep
    // with it instead of snapping. LayoutAnimation's built-in `keyboard` type
    // is exactly the OS keyboard curve; `e.duration` matches its speed.
    const syncToKeyboard = (e) => {
      LayoutAnimation.configureNext({
        duration: e?.duration || 250,
        update: { type: LayoutAnimation.Types.keyboard },
      });
    };
    const showListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        syncToKeyboard(e);
        setKeyboardHeight(e.endCoordinates.height);
        setKeyboardVisible(true);
      }
    );
    const hideListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      (e) => {
        syncToKeyboard(e);
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
    loadData, saveTasks, collectTags, addProject, deleteProject,
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
  // The header now reflects just the tasks SCHEDULED for the selected calendar
  // day (under the active project/tag filter), completed vs total — tap it to
  // open the stats panel for all-time / per-project breakdowns. Mirrors the
  // modal's `day` logic so the two always agree.
  const dayStats = useMemo(() => {
    const d = calendarDate instanceof Date ? calendarDate : new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // Same shared active-filter predicate as the tree/calendar/agenda (owner +
    // project + tags) so the header count agrees with what's actually shown.
    const filters = { selectedProject, selectedTags, tagFilterMode, selectedOwners };
    const scheduled = tasks.filter((t) => t.dueDate === dateStr && taskPassesFilters(t, filters));
    const completed = scheduled.filter((t) => t.completed).length;
    return { total: scheduled.length, completed };
  }, [tasks, calendarDate, selectedProject, selectedTags, tagFilterMode, selectedOwners]);
  const dayPct = dayStats.total ? Math.round((dayStats.completed / dayStats.total) * 100) : 0;

  // Create a memoized mapping of project names to colors
  const projectColorMap = useMemo(() => {
    const map = {};
    projects.forEach((project, index) => {
      map[project] = PROJECT_COLORS[index % PROJECT_COLORS.length];
    });
    return map;
  }, [projects]);

  // Get color for a project
  const getProjectColor = (projectName) => {
    if (!projectName || projectName === 'All') return theme.colors.textSecondary;
    return projectColorMap[projectName] || theme.colors.textSecondary;
  };
  
  // Use collapsible tasks hook - ALL collapsed by default
  const collapsible = useCollapsibleTasks(tasks, projects, {
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
  //     creations from any composer and remote adds via socket refetch),
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
    const unsub = navigation.addListener('focus', bumpOrderEpoch);
    return unsub;
  }, [navigation, bumpOrderEpoch]);

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
    const past = visible
      .filter(isPast)
      .map((t) => ({ t, k: stampOf(t) }))
      .sort((a, b) => a.k - b.k)
      .map(({ t }) => ({ id: t.id, dateKey: agendaRowDateKey(t) }));
    // Upcoming: dated open tasks from today onward (date asc, timed before
    // untimed within a day), then the undated backlog newest-first. Grouping
    // key = the due date it was SORTED under (undated rows get no divider).
    const open = visible.filter((t) => !isPast(t));
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
  }, [membershipKey, orderEpoch, selectedProject, selectedTags, tagFilterMode, selectedOwners, searchQuery]);

  // Live lookup for hydration — fresh objects every tasks change, so a ticked
  // row repaints (✓, strikethrough) in its frozen slot.
  const tasksById = useMemo(() => {
    const m = new Map();
    for (const t of tasks || []) m.set(t.id, t);
    return m;
  }, [tasks]);

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
  const [pastArmed, setPastArmed] = useState(false);
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
  const PAST_DIVIDER_H = Math.round(46 * Math.max(1, PixelRatio.getFontScale()));
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
    if (upcomingTasks.length) {
      upcomingHeaderIndex = items.length;
      items.push(agendaChrome.upcomingHeader);
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
  }, [upcomingTasks, pastZone]);
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
  // Deferred while the keyboard is transitioning (its global LayoutAnimation
  // would capture the mount); the keyboardVisible dep re-runs the timer once
  // it settles.
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

  useEffect(() => {
    if (showFilterMenu) {
      Animated.spring(menuAnimation, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
    } else {
      Animated.timing(menuAnimation, { 
        toValue: 0, 
        duration: 200, 
        useNativeDriver: true,
        easing: Easing.out(Easing.ease)
      }).start();
    }
  }, [showFilterMenu, menuAnimation]);

  const handleSaveTask = async (taskData) => {
    if (taskData.tags?.length > 0) await collectTags(taskData.tags);

    const newTasks = taskData.id && tasks.find(t => t.id === taskData.id)
      ? tasks.map(t => t.id === taskData.id ? taskData : t)
      // Preserve any subtasks the caller provided (e.g. re-adding a previous
      // task copies its subtasks); default to [] only when none were given.
      : [...tasks, { ...taskData, subtasks: taskData.subtasks || [] }];

    await saveTasks(newTasks);
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
  const handleToggleComplete = async (id, occurrenceDate) => {
    const now = Date.now();
    const task = tasksRef.current.find(t => t.id === id);
    if (!task) return;

    // NOTE: this handler changes DATA ONLY. The agenda renders from a frozen
    // order snapshot (see agendaOrder), so a tick — any tick: plain, overdue,
    // recurring, untick — repaints the row in its existing slot and cannot
    // restructure the list. No position-pin choreography needed here anymore.

    const rec = task.recurring || task.recurrence || 'none';
    if (rec && rec !== 'none') {
      // RECURRING: per-occurrence completion is ADDITIVE (mirrors web). Ticking a
      // day records it in meta.completedDates (so it renders ticked on its day)
      // AND advances dueDate (so the next one shows). Un-ticking removes the date
      // and pulls dueDate back to it. `completed` stays false so the series keeps
      // repeating.
      //
      // Callers WITH a day context (day panel) pass occurrenceDate. Single-row
      // views (Upcoming, project/tag tree, detail) pass none — resolve it here:
      //   • already done-now → UNTICK the most recent ticked occurrence
      //   • else → TICK max(dueDate, today), so completing an OVERDUE series
      //     marks TODAY done (row shows the check) instead of back-filling a
      //     missed day and instantly re-rendering as "due today, unchecked".
      const today = localTodayStr();
      const last = lastCompletedDate(task);
      // done-now must MIRROR isTaskDoneNow (incl. a legacy completed=true flag —
      // reachable via the auto-complete event sweep or editing a completed task
      // into a recurring one) — otherwise the row reads checked while the
      // handler ticks, and the checkmark can never be cleared.
      const doneNow = task.completed || (!!last && last >= today);
      // occ can be null: legacy completed=true with no ticked dates — the tap
      // then simply clears the flag below.
      const occ = occurrenceDate || (doneNow ? last : (maxDate(task.dueDate, today) || today));
      const prev = Array.isArray(task.meta?.completedDates) ? task.meta.completedDates : [];
      const isTicking = !!occ && !prev.includes(occ);
      const nextCompletedDates = !occ
        ? prev
        : isTicking
          ? [...new Set([...prev, occ])] // dedup: a rapid double-tap can't duplicate the date
          : prev.filter(d => d !== occ);
      // dueDate mechanics (an UNDATED recurring task stays undated — a
      // tick/untick round-trip must fully revert):
      //   TICK, on-pattern occ  → advance one period from it, never below the
      //         current anchor (back-filling a past day can't regress).
      //   TICK, OFF-pattern occ (overdue series completed from a single-row
      //         view records TODAY) → jump to the next ON-PATTERN date after it,
      //         preserving the weekly/monthly anchor (Mon stays Mon).
      //   UNTICK, on-pattern occ → re-expose that day (min); off-pattern → the
      //         anchor never moved for it, so leave dueDate alone.
      let nextDueDate = task.dueDate;
      if (occ && task.dueDate) {
        if (isTicking) {
          const onPattern = occ === task.dueDate || occ < task.dueDate || matchesRecurrence(task.dueDate, rec, occ);
          const stepped = onPattern ? advanceDueDate(occ, rec) : nextOccurrenceAfter(task.dueDate, rec, occ);
          nextDueDate = maxDate(task.dueDate, stepped);
        } else {
          const onPattern = occ === task.dueDate || matchesRecurrence(occ, rec, task.dueDate) || matchesRecurrence(task.dueDate, rec, occ);
          nextDueDate = onPattern ? minDate(task.dueDate, occ) : task.dueDate;
        }
      }
      const newTasks = tasksRef.current.map(t =>
        t.id === id
          ? {
              ...t,
              dueDate: nextDueDate,
              // A live series never holds the done-forever flag; clearing it
              // also un-sticks legacy completed=true recurring rows.
              completed: false,
              completedAt: isTicking ? now : t.completedAt,
              completedTime: isTicking ? new Date(now).toISOString() : t.completedTime,
              meta: { ...(t.meta || {}), completedDates: nextCompletedDates },
            }
          : t
      );
      await saveTasks(newTasks);
      // Celebrate a fresh occurrence tick (not an untick) — AFTER the save is
      // confirmed. saveTasks reverts + re-throws on failure, so a rolled-back
      // completion never gets confetti/points.
      if (isTicking) celebrate({ points: 10, kind: 'task' });
      return;
    }

    const willComplete = !task.completed;
    const newTasks = tasksRef.current.map(t => {
      if (t.id !== id) return t;
      const completed = !t.completed;
      return {
        ...t,
        completed,
        completedAt: completed ? now : null,
        completedTime: completed ? new Date(now).toISOString() : null
      };
    });
    await saveTasks(newTasks);
    // Celebrate completing (not un-completing) a one-off task — after the save
    // is confirmed (saveTasks reverts + re-throws on failure).
    if (willComplete) celebrate({ points: 10, kind: 'task' });
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

  const handleDelete = (id) => {
    const task = tasksRef.current.find(t => t.id === id);
    const hasSubtasks = task?.subtasks && task.subtasks.length > 0;
    
    // Skip confirmation if no subtasks
    if (!hasSubtasks) {
      saveTasks(tasksRef.current.filter(t => t.id !== id));
      return;
    }
    
    Alert.alert('Delete Task', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Delete', 
        style: 'destructive',
        onPress: () => saveTasks(tasksRef.current.filter(t => t.id !== id))
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

  // `continueFromQuick` is true only on the hand-off from the calendar quick
  // inspector (drag up / "Edit details"): the full form then rises from where
  // the quick card sat — and keeps the backdrop dim steady — so it reads as the
  // same sheet continuing, not a second sheet re-sliding from off-screen.
  const openEditForm = (task, continueFromQuick = false) => {
    setEditingTask(task);
    setFormContinue(continueFromQuick);
    setShowTaskForm(true);
  };

  // Open the unified create form pre-set to a kind chosen from the calendar
  // "+" menu (birthday / task / event). The type stays switchable inside the form.
  // `date` (YYYY-MM-DD, optional) pre-fills the due/occasion date when creating
  // from a specific tapped calendar day.
  const openCreateForm = useCallback((type, date) => {
    setEditingTask(null);
    setNewItemType(type || 'task');
    setNewItemDate(date || null);
    setFormContinue(false);
    setShowTaskForm(true);
  }, []);

  const openDetail = (task) => {
    setSelectedTask(task);
    setShowDetail(true);
  };

  const closeTaskForm = () => {
    setShowTaskForm(false);
    setEditingTask(null);
  };

  const styles = createStyles(theme);

  // ── Photos-style sliding segmented control ──────────────────────────
  // The active pill + the two icons' opacities are driven by the pager's
  // scroll offset (1:1, native thread), so the toggle slides smoothly with the
  // swipe AND on tap — exactly like the Photos tab bar's bezier indicator,
  // instead of the old discrete active-background snap. Calendar = left page
  // (index 0), list = right page (index 1).
  const TOGGLE_SEG_WIDTH = 40;
  const pagerWidth = pagerSize.width || windowWidth;
  const toggleIndicatorX = pagerScrollX.interpolate({
    inputRange: [0, pagerWidth],
    outputRange: [0, TOGGLE_SEG_WIDTH],
    extrapolate: 'clamp',
  });
  const calActiveOp = pagerScrollX.interpolate({ inputRange: [0, pagerWidth], outputRange: [1, 0], extrapolate: 'clamp' });
  const listActiveOp = pagerScrollX.interpolate({ inputRange: [0, pagerWidth], outputRange: [0, 1], extrapolate: 'clamp' });

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
  const hasActiveFilters = !showIncompleteOnly || selectedTags.length > 0 || selectedOwners.length > 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
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

      {/* Custom Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.projectSelector}
          // Toggle the inline picker. configureNext fires BEFORE the
          // state change so the native UIManager registers the layout
          // animation against the same commit that adds/removes the
          // dropdown. Running it inside the dropdown's own useEffect
          // (which is post-commit) was the cause of the previous
          // "doesn't animate" bug — the animation queued but the
          // layout had already settled.
          onPress={() => {
            configureProjectDropdownAnimation();
            setShowDropdown(v => !v);
          }}
        >
          <View style={[styles.projectSelectorSquare, { backgroundColor: getProjectColor(selectedProject) }]} />
          <Text style={styles.projectSelectorText} numberOfLines={1}>
            {selectedProject === 'All' ? 'All' : boardLabel(selectedProject)}
          </Text>
          {/* Chevron flips 180° while the picker is open. The
              transform sits on a small wrapper because Icon doesn't
              accept transform directly. */}
          <View style={{ transform: [{ rotate: showDropdown ? '180deg' : '0deg' }] }}>
            <Icon name="chevron-down" size={18} color={theme.colors.textTertiary} />
          </View>
        </TouchableOpacity>
        
        <View style={styles.headerRight}>
          {/* Filter button — lives in the header (was a floating FAB at the
              bottom-right that overlapped the calendar/list content). Opens
              the same FilterMenu bottom-sheet; shows a count badge when any
              filter is active. */}
          <TouchableOpacity
            style={[styles.headerFilterBtn, hasActiveFilters && styles.headerFilterBtnActive]}
            onPress={() => setShowFilterMenu(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon
              name="filter-variant"
              size={20}
              color={hasActiveFilters ? theme.colors.textPrimary : theme.colors.textTertiary}
            />
            {hasActiveFilters && (
              <View style={styles.headerFilterBadge}>
                <Text style={styles.headerFilterBadgeText}>
                  {selectedTags.length + selectedOwners.length + (!showIncompleteOnly ? 1 : 0)}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {/* View Mode Toggle — a sliding segmented control modelled on the
              Photos tab bar: the active pill + the icon cross-fades track the
              pager's scroll offset 1:1, so it glides with the swipe (and on
              tap) instead of snapping. Calendar = left page, list = right. */}
          <View style={styles.viewToggle}>
            {/* Sliding active pill (bound to the pager scroll). */}
            <Animated.View
              pointerEvents="none"
              style={[styles.viewToggleIndicator, { transform: [{ translateX: toggleIndicatorX }] }]}
            />
            <TouchableOpacity
              style={styles.viewBtn}
              onPressIn={() => tapHaptic()}
              onPress={() => goToView('calendar')}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Calendar view"
            >
              {/* Active (bright) icon fades in as this page becomes current;
                  the inactive (dim) icon underneath fades out. */}
              <Animated.View style={[styles.viewBtnIconLayer, { opacity: calActiveOp }]}>
                <Icon name="calendar-month" size={20} color={theme.colors.textPrimary} />
              </Animated.View>
              <Animated.View style={{ opacity: listActiveOp }}>
                <Icon name="calendar-month" size={20} color={theme.colors.textTertiary} />
              </Animated.View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.viewBtn}
              onPressIn={() => tapHaptic()}
              onPress={() => goToView('list')}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="List view"
            >
              <Animated.View style={[styles.viewBtnIconLayer, { opacity: listActiveOp }]}>
                <Icon name="format-list-bulleted" size={20} color={theme.colors.textPrimary} />
              </Animated.View>
              <Animated.View style={{ opacity: calActiveOp }}>
                <Icon name="format-list-bulleted" size={20} color={theme.colors.textTertiary} />
              </Animated.View>
            </TouchableOpacity>
          </View>
          
          {/* The header count now reflects just the SELECTED DAY's tasks
              (completed / scheduled). Tap to open the stats panel where the
              metric can switch to all-time + per-project breakdowns. */}
          <TouchableOpacity
            style={styles.statsContainer}
            onPress={() => setShowStats(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <Text style={styles.statsText}>{dayStats.completed}/{dayStats.total}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Full-bleed day-completion bar, directly under the header — a 3px
          solid-white fill on a faint track, matching the photos loading bar.
          Spans the whole screen width; reflects the selected day's ratio. */}
      <View style={styles.dayProgressTrack}>
        <View style={[styles.dayProgressFill, { width: `${dayPct}%` }]} />
      </View>

      {/* Project-picker overlay host. The picker (rendered at the bottom of
          this host) is an absolute overlay pinned just below the header.
          Everything else lives in the sibling "shift layer" below, which the
          reveal translates DOWN by the picker's height — a compositor-only
          transform, so the heavy list/calendar never relayouts (that was the
          stutter). overflow:hidden clips the shifted layer's bottom so it
          can't spill over the tab bar / FAB. Modals inside render via RN
          portals, so the transform doesn't touch them. */}
      <View style={styles.dropdownHost}>
      <Reanimated.View style={[styles.dropdownShiftLayer, contentShiftStyle]}>

      {/* Active Filters */}
      {hasActiveFilters && (
        <View style={styles.activeFiltersBar}>
          <Animated.ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {!showIncompleteOnly && (
              <View style={[styles.filterChip, styles.warningChip]}>
                <Icon name="eye-off" size={12} color={theme.colors.accentWarning} />
                <Text style={[styles.filterChipText, styles.warningChipText]}>Showing Completed</Text>
                <TouchableOpacity onPress={() => setShowIncompleteOnly(true)}>
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
      <FilterMenu
        visible={showFilterMenu}
        onClose={() => setShowFilterMenu(false)}
        tasks={tasks}
        selectedProject={selectedProject}
        owners={owners}
        filters={{
          showIncompleteOnly,
          setShowIncompleteOnly,
          selectedTags,
          setSelectedTags,
          toggleTagFilter: (tag) => {
            setSelectedTags(prev =>
              prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
            );
          },
          tagFilterMode,
          setTagFilterMode,
          selectedOwners,
          setSelectedOwners,
          toggleOwnerFilter: (userId) => {
            setSelectedOwners(prev =>
              prev.includes(userId) ? prev.filter(u => u !== userId) : [...prev, userId]
            );
          },
          clearFilters: () => {
            setShowIncompleteOnly(true);
            setSelectedTags([]);
            setTagFilterMode('any');
            setSelectedOwners([]);
          },
          hasActiveFilters: selectedTags.length > 0 || !showIncompleteOnly || selectedOwners.length > 0
        }}
        animation={menuAnimation}
      />

      <TaskStatsModal
        visible={showStats}
        onClose={() => setShowStats(false)}
        tasks={tasks}
        selectedProject={selectedProject}
        selectedTags={selectedTags}
        tagFilterMode={tagFilterMode}
        selectedDate={calendarDate}
      />

      <ProjectManager
        visible={showProjectManager}
        onClose={() => setShowProjectManager(false)}
        projects={projects}
        tasks={tasks}
        onAdd={addProject}
        onDelete={deleteProject}
      />

      <TaskForm
        visible={showTaskForm}
        onClose={closeTaskForm}
        onSave={handleSaveTask}
        onDelete={deleteTask}
        initialData={editingTask}
        initialType={newItemType}
        initialDate={newItemDate}
        continueFromQuick={formContinue}
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
        onStartPomodoro={() => {
          // Route through the Turtle chat's /pomodoro pipeline (CommandBus
          // delivers it exactly as if typed); the task title rides along as the
          // session label. Then jump to the Turtle tab where the timer lives.
          const label = (selectedTask?.title || '').trim();
          dispatchCommand(label ? `/pomodoro focus ${label}` : '/pomodoro focus');
          setShowDetail(false);
          navigation.navigate('Turtle');
        }}
      />

      {/* Owner profile — opened by tapping a task's owner badge on the shared
          calendar. Built from what the task list carries (name + that person's
          tasks); phone/role/avatar light up once a members feed is wired in. */}
      <FriendCard
        friend={profileOwner ? { id: profileOwner.userId, displayName: profileOwner.ownerName } : null}
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
        scrollEnabled={!dayPlannerOpen}
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
        {/* Page 0 — Calendar */}
        <View style={{ width: pagerSize.width, height: pagerSize.height }}>
        <CalendarView
          tasks={tasks}
          selectedProject={selectedProject}
          selectedTags={selectedTags}
          tagFilterMode={tagFilterMode}
          selectedOwners={selectedOwners}
          // Global FilterMenu "incomplete only" toggle — apply it to the calendar
          // too so completed tasks drop out of the day-cell lists (matching the
          // task tree), not just render struck-through.
          showIncompleteOnly={showIncompleteOnly}
          multiUser={multiUser}
          onTaskPress={openDetail}
          onTaskLongPress={openEditForm}
          onToggleComplete={handleToggleComplete}
          onUpdateTask={handleUpdateTask}
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
          onCreateForDate={(dateStr) => openCreateForm('task', dateStr)}
          // Tap a task's owner badge → open that person's profile card.
          onOwnerPress={(t) => { if (t?.userId) setProfileOwner({ userId: t.userId, ownerName: t.ownerName }); }}
        />
        </View>
        {/* Page 1 — List */}
        <View style={{ width: pagerSize.width, height: pagerSize.height }}>
        {/* Board scope + the Calendar/List switch live in the global header, and
            the View/Edit toggle moved to the All Boards page (the only surface
            where edit mode still does anything). So the Upcoming list opens
            straight into search + the agenda — no redundant toolbar. */}
        <View style={styles.listClip}>
          {/* Simple search box — always visible, activates (focuses) on tap.
              Replaced the old overscroll "pull-down" reveal, which was fiddly. */}
          <View style={styles.searchBar}>
            <View style={styles.searchInputRow}>
              <Icon name="magnify" size={18} color={theme.colors.textTertiary} style={styles.searchIcon} />
              <TextInput
                ref={searchInputRef}
                style={styles.searchInput}
                placeholder="Search tasks and subtasks..."
                placeholderTextColor={theme.colors.textPlaceholder}
                value={searchQuery}
                onChangeText={setSearchQuery}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="while-editing"
              />
              {searchQuery.length > 0 && Platform.OS !== 'ios' && (
                <TouchableOpacity
                  onPress={() => setSearchQuery('')}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={styles.searchClearBtn}
                >
                  <Icon name="close-circle" size={16} color={theme.colors.textTertiary} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={styles.listShift}>
          <FlashList
            ref={listRef}
            data={agenda.items}
            keyExtractor={(item, index) => (item ? `${item.__past ? 'past-' : ''}${item.__upcoming ? 'upcoming-' : ''}${item.id || index}` : `cell-${index}`)}
            // Recycling pools by cell shape — the FlashList (chat-grade) win.
            getItemType={(item) => {
              if (item.__agendaHeader) return `header-${item.__agendaHeader}`;
              if (item.__gap) return 'gap';
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
            // Scrolling carries NO logic — fills are visibility-driven; this
            // only tracks the offset for the keyboard-scroll helpers.
            onScroll={(e) => {
              scrollY.current = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
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

              const prev = index > 0 ? items[index - 1] : null;
              const next = index < items.length - 1 ? items[index + 1] : null;

              // ── Date dividers (real labels, fixed-height in the past zone,
              // natural in upcoming) — the rail runs through them unless they
              // lead their band (nothing above to connect to). ──────────────
              if (item.__divider) {
                const leadsBand = !!prev?.__agendaHeader;
                return (
                  <View style={[styles.agendaDateDivider, item.__past ? { height: PAST_DIVIDER_H } : null]}>
                    {!leadsBand && <View style={styles.agendaRailThrough} pointerEvents="none" />}
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
                  item={item}
                  onPress={openDetail}
                  onLongPress={openEditForm}
                  onToggleComplete={(it) => handleToggleComplete(it.id)}
                  isFirst={isFirstRow}
                  isLast={isLastRow}
                  // The left rail is the STRONG line here — black in light
                  // mode, white in dark so it stays visible.
                  railColor={theme.mode === 'dark' ? '#FFFFFF' : '#000000'}
                  // Slightly lighter card than the default elevated surface —
                  // matches the airier feel of the day-schedule to-do cards.
                  cardColor={theme.mode === 'dark' ? theme.colors.surfaceHighlight : theme.colors.surface}
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
              paddingBottom: Math.max(100, keyboardHeight + 20),
            }}
            // NO RefreshControl — the pull/scroll up is plain native motion
            // into the preloaded skeleton zone; data still refreshes on focus,
            // socket pushes, and the calendar page's pull-to-refresh.
            viewabilityConfig={viewabilityConfig}
            onViewableItemsChanged={onViewableItemsChanged}
            // The doorway to the boards tree, at the very bottom of the
            // agenda — the tree itself lives on its own pushed page.
            ListFooterComponent={
              <TouchableOpacity
                onPressIn={() => tapHaptic()}
                onPress={() => setBoardsPageOpen(true)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Open all boards"
                style={styles.allBoardsButton}
              >
                <FourColorBoardsIcon size={18} />
                <Text style={styles.allBoardsButtonText}>All Boards</Text>
                {collapsible.groupedData.filter((s) => s.type === 'project').length > 0 && (
                  <View style={styles.allBoardsCountBadge}>
                    <Text style={styles.allBoardsCountText}>
                      {collapsible.groupedData.filter((s) => s.type === 'project').length}
                    </Text>
                  </View>
                )}
                <Icon name="chevron-right" size={20} color={theme.colors.textTertiary} />
              </TouchableOpacity>
            }
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
                    onPress={() => {
                      setEditingTask(null);
                      setShowTaskForm(true);
                    }}
                    style={styles.addNewTaskBtn}
                  >
                    <Icon name="plus" size={20} color={theme.colors.textPrimary} />
                    <Text style={styles.addNewTaskText}>Add new task</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          />
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
      </Animated.ScrollView>
      </Reanimated.View>

      {/* Project picker — absolute overlay on top of the shift layer. Its
          own height/opacity reveal (ProjectDropdown.jsx) is byte-for-byte
          unchanged; it just no longer sits in flow, so it pushes nothing.
          The shift layer above moves with the same progress, so the page
          stays glued to the picker's bottom edge through the open/close. */}
      <ProjectDropdown
        visible={showDropdown}
        onClose={() => {
          configureProjectDropdownAnimation();
          setShowDropdown(false);
        }}
        projects={projects}
        tasks={tasks}
        selected={selectedProject}
        onSelect={(project) => {
          configureProjectDropdownAnimation();
          setSelectedProject(project);
          setShowDropdown(false);
        }}
        onManage={() => setShowProjectManager(true)}
        onAddProject={addProject}
        getProjectColor={getProjectColor}
        incomingShareLabels={sharedInLabels}
      />
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
                          <TextInput
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
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  projectSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  projectSelectorText: { 
    fontSize: theme.typography.body, 
    fontWeight: '600', 
    marginLeft: 8, 
    marginRight: 8,
    color: theme.colors.textPrimary 
  },
  projectSelectorSquare: {
    width: 16,
    height: 16,
    borderRadius: 3,
  },
  statsContainer: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  statsText: {
    fontSize: theme.typography.body,
    color: theme.colors.textTertiary,
  },
  // Full-width day-completion bar under the header — photos-loading style:
  // a 3px solid-white fill on a faint white track, edge to edge.
  dayProgressTrack: {
    width: '100%',
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
  },
  dayProgressFill: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.95)',
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
    marginRight: 12,
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
  viewToggle: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    padding: 2,
    marginRight: 12,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
    position: 'relative', // anchors the absolute sliding pill
  },
  // The sliding active pill — its translateX is bound to the pager scroll so it
  // glides between the two segments 1:1 with the swipe (Photos-tab style).
  viewToggleIndicator: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 2,
    width: 40, // = TOGGLE_SEG_WIDTH; matches a segment's width
    borderRadius: 6,
    // Match the Photos tab bar's pill exactly: a light fill (white on light,
    // near-grey on dark) with a soft drop shadow, so it reads as a lifted
    // iOS-style segmented-control thumb gliding over the track.
    backgroundColor: theme.mode === 'dark' ? '#333333' : '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  viewBtn: {
    width: 40, // fixed so the sliding pill aligns with each segment 1:1
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Active (bright) icon layer, stacked over the inactive (dim) one; their
  // opacities cross-fade as the pager scrolls.
  viewBtnIconLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  // View/Edit toggle — now hosted in the All Boards page header (edit mode
  // reveals each project's inline add-task + tag controls).
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    padding: 2,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
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
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  upcomingHeaderText: {
    fontSize: theme.typography.body,
    fontWeight: '800',
    color: theme.colors.textPrimary,
    letterSpacing: 0.3,
    flex: 1,
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
  // Vertical rail continuing the timeline through the divider — same x (≈33),
  // width (2) and STRONG colour as the agenda's rail (black / white), so the
  // left line stays unbroken and prominent across the divider.
  agendaRailThrough: {
    position: 'absolute',
    left: 33,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: theme.mode === 'dark' ? '#FFFFFF' : '#000000',
  },
  agendaDateLabel: {
    alignSelf: 'flex-end',
    fontSize: 12,
    fontWeight: '600',
    // Faint date word.
    color: theme.colors.textTertiary,
    letterSpacing: 0.2,
    marginBottom: 4,
  },
  agendaDateLine: {
    // Stop clear of the strong left rail (rail ≈ x33) so they never intersect or
    // cut; run to the row's right edge.
    marginLeft: 66,
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
  boardsPageTitle: {
    flex: 1,
    fontSize: theme.typography.body,
    fontWeight: '800',
    color: theme.colors.textPrimary,
    letterSpacing: 0.3,
  },
  // The breathing room between the upcoming agenda and the project tree below.
  upcomingGap: {
    height: 14,
    marginTop: 4,
    marginBottom: 4,
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
