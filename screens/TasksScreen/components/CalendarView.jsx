import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
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
  TextInput,
  Keyboard,
  RefreshControl,
  Pressable,
  Animated,
} from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
  FadeIn,
  FadeOut,
  LinearTransition,
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
import { useTheme } from '../../../context/ThemeContext';
import { formatDueDate, isOverdue, itemTypeOf, itemColorOf, itemIconOf } from '../utils/taskHelpers';
import { TaskQuickInspector } from './TaskQuickInspector';
import { WheelTimePicker } from './WheelTimePicker';

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
// 6 rows of day cells. Each cell occupies DAY_WIDTH × CELL_HEIGHT of
// layout space. Plus the title, day-of-week labels, and paddingTop,
// this is the per-month FlatList page height.
const MONTH_HEIGHT = MONTH_TITLE_HEIGHT + DAYS_HEADER_HEIGHT + GRID_PADDING_TOP + 6 * CELL_HEIGHT;

// ── Hourly timetable constants ────────────────────────────────
//
// The selected-day task list renders as an hour-by-hour timetable
// (mirrors the web app's calendar preview). Each hour gets a row;
// timed tasks are absolutely positioned at their start minute.
//
// HOUR_HEIGHT = 48 → ~2× the web app's 36px so finger taps land
// comfortably and a 30-minute task is still readable (24px tall).
const HOUR_HEIGHT = 48;
const HOUR_LABEL_WIDTH = 56;
const HOUR_GRID_HEIGHT = HOUR_HEIGHT * 24;
const { width: SCREEN_W } = Dimensions.get('window'); // off-screen start for the day-swipe slide
const DEFAULT_TASK_DURATION_MIN = 60;
const MIN_TASK_BLOCK_HEIGHT = 28;

// Format an hour-of-day number as a clock label. 24h → "15:00"; otherwise the
// 12-hour AM/PM form ("3 PM", "12 AM"). `use24h` flows from the timeFormat pref.
const formatHourLabel = (h, use24h = false) => {
  if (use24h) return `${String(h).padStart(2, '0')}:00`;
  if (h === 0)  return '12 AM';
  if (h < 12)   return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
};

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

// Snap a Y coordinate inside the hour grid to the nearest 15-minute slot,
// returned as an "HH:MM" string. Module-level (pure) so the day-pager's
// per-day panes can share it.
const yToTimeString = (locationY) => {
  const totalMinutes = Math.round((locationY / HOUR_HEIGHT) * 60);
  const snapped = Math.round(totalMinutes / 15) * 15;
  const clamped = Math.max(0, Math.min(24 * 60 - 15, snapped));
  const hh = Math.floor(clamped / 60);
  const mm = clamped % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

// ── Pure date helpers (no theme / state dependency) ──────────
//
// Pulled out of the component so they aren't redefined on every render
// and so they can be reused without closure capture.

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

const taskPassesFilters = (task, { selectedProject, selectedTags, tagFilterMode, selectedOwners }) => {
  // Shared-calendar "whose tasks" filter. selectedOwners is a list of user ids
  // to show; empty/undefined means "everyone" (no filtering by person). A task
  // with no userId (legacy/unowned) only hides when a specific owner set is on.
  if (selectedOwners && selectedOwners.length > 0) {
    if (!task.userId || !selectedOwners.includes(task.userId)) return false;
  }
  if (selectedProject !== 'All') {
    const taskProject = task.project || 'No Project';
    if (taskProject !== selectedProject) return false;
  }
  if (selectedTags && selectedTags.length > 0) {
    const taskTagSet = new Set((task.tags || []).map(t => t.toLowerCase()));
    const needles = selectedTags.map(t => t.toLowerCase());
    const predicate = tagFilterMode === 'all' ? needles.every : needles.some;
    if (!predicate.call(needles, tag => taskTagSet.has(tag))) return false;
  }
  return true;
};

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
const taskOccursOn = (task, dateStr, dueDateOnly) => {
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
    return task.dueDate ? task.dueDate === dateStr : false;
  }
  return !task.completed;
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

// Interactive controls (add-task input, search box + results) only wire
// up on the ACTIVE pane (date === selectedDate); neighbours show inert
// placeholders so we never mount duplicate auto-focused TextInputs while
// paging. The strip + grid content is computed per-pane from its own date.
const DayPane = React.memo(function DayPane({
  date,
  isActive,
  tasks,
  selectedProject,
  selectedTags,
  tagFilterMode,
  selectedOwners,
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
  const isViewingToday = dayStr === toDateString(new Date());

  // Title suggestions for the re-add flow — only on the active pane while the
  // add-task input is open and the user has typed ≥2 chars.
  const titleSuggestions = useMemo(
    () => (isActive && isAddingTask ? buildTitleSuggestions(tasks, newTaskTitle) : []),
    [isActive, isAddingTask, tasks, newTaskTitle]
  );

  // This day's tasks — same predicates the calendar cells + header use.
  const dayTasks = useMemo(() => {
    const filters = { selectedProject, selectedTags, tagFilterMode, selectedOwners };
    return tasks
      .filter(t => taskPassesFilters(t, filters) && taskOccursOn(t, dayStr, true))
      .sort((a, b) => {
        if (a.time && b.time) return a.time.localeCompare(b.time);
        if (a.time) return -1;
        if (b.time) return 1;
        return 0;
      });
  }, [tasks, selectedProject, selectedTags, tagFilterMode, selectedOwners, dayStr]);

  // Split this day's items into calendar occasions (events + birthdays) and
  // timed tasks (those with a HH:MM start). Untimed tasks aren't bucketed here
  // — the cross-day Pending strip below is the single home for the backlog.
  const { occasions, timedTasks } = useMemo(() => {
    const occ = [];
    const timed = [];
    for (const task of dayTasks) {
      if (itemTypeOf(task) !== 'task') { occ.push(task); continue; }
      if (task.time && /^\d{1,2}:\d{2}/.test(task.time)) timed.push(task);
    }
    return { occasions: occ, timedTasks: timed };
  }, [dayTasks]);

  // Collapsed-schedule model: each timed task as a {start,end,duration} segment
  // (sorted by start) plus the gap (minutes of empty time) to the NEXT task, so
  // the compact view can stack the tasks and label the gaps between them. Also
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

  // The cross-day Pending backlog — incomplete untimed tasks across all dates.
  const stripTasks = pendingTasks;

  // Auto-scroll to a useful hour on mount (now-1h today, else 8 AM) so a
  // freshly-swiped day lands on working hours rather than midnight. Mount-
  // only — later now-line ticks must not yank the user's scroll position.
  useEffect(() => {
    const ref = scrollRef.current;
    if (!ref) return;
    // Only meaningful for the tall hour grid; the compact view starts at the
    // first task, so don't yank it down to "working hours".
    if (scheduleCollapsed) return;
    const anchor = isViewingToday ? Math.max(0, nowMinutes - 60) : 8 * 60;
    const id = requestAnimationFrame(() => {
      ref.scrollTo({ y: (anchor / 60) * HOUR_HEIGHT, animated: false });
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleCollapsed]);

  // Long-press an empty slot → open the add-task input pre-filled with that
  // time, then bring the (top-of-list) input into view.
  const handleLongPress = (e) => {
    const y = e?.nativeEvent?.locationY ?? 0;
    onOpenAddTaskAt(yToTimeString(y));
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  };

  return (
    <View style={styles.dayPage}>
      <ScrollView
        ref={scrollRef}
        style={styles.taskList}
        contentContainerStyle={{ paddingBottom: Math.max(100, keyboardHeight + 20) }}
        scrollEventThrottle={16}
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
        {/* Add Task — active pane shows the live input; others a placeholder. */}
        {isActive && isAddingTask ? (
          <View style={styles.addTaskContainer}>
            <TextInput
              style={styles.addTaskInput}
              placeholder={pendingTime ? `New task at ${formatTimeLabel(pendingTime, use24h)}` : 'Add a new task'}
              placeholderTextColor={theme.colors.textPlaceholder}
              value={newTaskTitle}
              onChangeText={onChangeNewTaskTitle}
              onSubmitEditing={onSubmitAddTask}
              autoFocus
              blurOnSubmit={false}
              returnKeyType="done"
              onBlur={() => setTimeout(onCancelAdd, 200)}
            />
            {/* Time slot. With a pending time the pill shows it and TAPS open
                the wheel picker to fine-tune it (× clears). With no time yet, a
                subtle clock button opens the picker to add one. */}
            {pendingTime ? (
              <View style={styles.addTaskTimeChip}>
                <TouchableOpacity
                  style={styles.addTaskTimeChipMain}
                  onPress={onEditPendingTime}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit time, currently ${formatTimeLabel(pendingTime, use24h)}`}
                >
                  <Icon name="clock-outline" size={12} color={theme.colors.background} />
                  <Text style={styles.addTaskTimeChipText}>{formatTimeLabel(pendingTime, use24h)}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={onClearPendingTime}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Clear time"
                >
                  <Icon name="close-circle" size={14} color={theme.colors.background} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.addTaskTimeAdd}
                onPress={onEditPendingTime}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Add a time"
              >
                <Icon name="clock-plus-outline" size={18} color={theme.colors.textTertiary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.addTaskClose}
              onPress={onCancelAdd}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon name="close" size={18} color={theme.colors.textTertiary} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Re-add suggestions — existing tasks matching the typed title.
            Tapping one creates a fresh task on this day, copying the
            original's description + tags + subtasks (reset to incomplete). */}
        {isActive && isAddingTask && titleSuggestions.length > 0 && (
          <View style={styles.suggestionList}>
            {titleSuggestions.map((s) => {
              const subCount = Array.isArray(s.subtasks) ? s.subtasks.length : 0;
              const metaParts = [];
              if (s.project) metaParts.push(s.project);
              if (subCount > 0) metaParts.push(`${subCount} subtask${subCount > 1 ? 's' : ''}`);
              return (
                <TouchableOpacity
                  key={s.id}
                  style={styles.suggestionRow}
                  activeOpacity={0.7}
                  onPress={() => onPickSuggestion?.(s)}
                >
                  <Icon
                    name={s.completed ? 'check-circle' : 'history'}
                    size={16}
                    color={s.completed ? theme.colors.accentSuccess : theme.colors.accentInfo}
                  />
                  <View style={styles.suggestionTextWrap}>
                    <Text style={styles.suggestionTitle} numberOfLines={1}>{s.title}</Text>
                    {metaParts.length > 0 && (
                      <Text style={styles.suggestionMeta} numberOfLines={1}>
                        {(s.completed ? 'Completed' : 'Pending') + ' · ' + metaParts.join(' · ')}
                      </Text>
                    )}
                  </View>
                  <Icon name="plus" size={16} color={theme.colors.textTertiary} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {!isActive || !isAddingTask ? (
          <TouchableOpacity
            style={styles.addTaskPlaceholder}
            onPress={onOpenAddTask}
            activeOpacity={0.7}
          >
            <View style={styles.addTaskInputBox} pointerEvents="none">
              <Text style={styles.addTaskPlaceholderText}>Add a new task</Text>
            </View>
          </TouchableOpacity>
        ) : null}

        {/* Search */}
        {isActive && isSearching ? (
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search tasks..."
              placeholderTextColor={theme.colors.textPlaceholder}
              value={searchQuery}
              onChangeText={onChangeSearchQuery}
              autoFocus
            />
            <TouchableOpacity
              style={styles.searchClose}
              onPress={onCloseSearch}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon name="close" size={18} color={theme.colors.textTertiary} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.searchPlaceholder}
            onPress={onOpenSearch}
            activeOpacity={0.7}
          >
            <View style={styles.searchInputBox} pointerEvents="none">
              <Icon name="magnify" size={16} color={theme.colors.textPlaceholder} style={styles.searchIcon} />
              <Text style={styles.searchPlaceholderText}>Search tasks</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Search Results */}
        {isActive && isSearching && searchQuery.trim() && (
          <View style={styles.searchResults}>
            {searchResults.length > 0 ? (
              <>
                <Text style={styles.searchResultsTitle}>
                  {searchResults.length} {searchResults.length === 1 ? 'task' : 'tasks'} · tap to open
                </Text>
                {searchResults.map(task => {
                  const overdue = !task.completed && isOverdue(task.dueDate);
                  return (
                    <TouchableOpacity
                      key={task.id}
                      style={styles.searchResultItem}
                      onPress={() => onOpenSearchResult(task)}
                    >
                      <Icon
                        name={task.dueDate ? 'calendar' : 'calendar-blank-outline'}
                        size={16}
                        color={overdue ? theme.colors.accentError : (task.dueDate ? theme.colors.accentSuccess : theme.colors.textTertiary)}
                        style={styles.resultIcon}
                      />
                      <View style={styles.resultContent}>
                        <Text
                          style={[styles.resultTitle, task.completed && styles.taskTitleCompleted]}
                          numberOfLines={1}
                        >
                          {task.title}
                        </Text>
                        <Text style={[styles.resultMeta, overdue && { color: theme.colors.accentError }]}>
                          {task.dueDate
                            ? `Due ${formatDueDate(task.dueDate)}${task.time ? ` · ${formatTimeLabel(task.time, use24h)}` : ''}`
                            : 'No due date'}
                        </Text>
                      </View>
                      <Icon name="chevron-right" size={18} color={theme.colors.textTertiary} />
                    </TouchableOpacity>
                  );
                })}
              </>
            ) : (
              <Text style={styles.noResultsText}>No tasks found</Text>
            )}
          </View>
        )}

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

        {/* Pending / All-Day strip */}
        {stripTasks.length > 0 && (
          <View style={styles.untimedSection}>
            <TouchableOpacity
              style={styles.untimedHeader}
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
            {!untimedCollapsed && stripTasks.map(task => (
              <TouchableOpacity
                key={task.id}
                style={[styles.untimedItem, task.completed && styles.taskItemCompleted]}
                onPress={() => onTaskPress?.(task)}
                onLongPress={() => onTaskLongPress?.(task)}
              >
                <TouchableOpacity
                  style={styles.checkbox}
                  onPress={(e) => { e.stopPropagation(); onToggleComplete?.(task.id); }}
                >
                  <Icon
                    name={task.completed ? 'checkbox-marked' : 'checkbox-blank-outline'}
                    size={18}
                    color={task.completed ? theme.colors.accentSuccess : theme.colors.textTertiary}
                  />
                </TouchableOpacity>
                <Text
                  style={[styles.untimedTitle, task.completed && styles.taskTitleCompleted]}
                  numberOfLines={1}
                >
                  {task.title}
                </Text>
                {multiUser && task.userId && (
                  <TouchableOpacity
                    style={[styles.ownerBadge, { backgroundColor: ownerColor(task.userId) }]}
                    onPress={() => onOwnerPress?.(task)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Owner: ${task.ownerName || 'Unknown'}. Open profile`}
                  >
                    <Text style={styles.ownerBadgeText}>{ownerInitial(task.ownerName)}</Text>
                  </TouchableOpacity>
                )}
                {task.priority && (
                  <View style={[styles.priorityDot, { backgroundColor: getPriorityColor(task.priority, theme) }]} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Schedule toolbar — count + total tracked time on the left, a toggle
            between the COMPACT stack (default) and the full hour GRID. */}
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
            accessibilityLabel={scheduleCollapsed ? 'Expand to hourly timeline' : 'Collapse to compact list'}
          >
            <Icon
              name={scheduleCollapsed ? 'arrow-expand-vertical' : 'arrow-collapse-vertical'}
              size={15}
              color={theme.colors.textSecondary}
            />
            <Text style={styles.scheduleToggleLabel}>{scheduleCollapsed ? 'Timeline' : 'Compact'}</Text>
          </TouchableOpacity>
        </View>

        {/* Smooth reveal between compact ⇄ timeline: the wrapper height-animates
            (LinearTransition) while the outgoing view fades out and the incoming
            one fades in — clipped by overflow:hidden so it reads as a wipe. */}
        <Reanimated.View layout={LinearTransition.duration(340)} style={styles.scheduleSwap}>
        {scheduleCollapsed ? (
          /* Compact view — only the timed tasks, stacked, with the empty time
             between consecutive tasks shown as a thin labelled gap line. */
          <Reanimated.View
            key="compact"
            entering={FadeIn.duration(240)}
            exiting={FadeOut.duration(160)}
            style={styles.collapsedSchedule}
          >
            {segments.length === 0 ? (
              <Text style={styles.collapsedEmpty}>
                No timed tasks yet. Tap + above, or expand to the timeline and long-press a slot.
              </Text>
            ) : segments.map((seg, idx) => {
              const task = seg.task;
              const projectColor = getProjectColor(task.project);
              const isLast = idx === segments.length - 1;
              return (
                <View key={task.id} style={styles.segRow}>
                  {/* Left rail: a node per task + a dashed connector to the next. */}
                  <View style={styles.segRail}>
                    <View style={[styles.segNode, task.completed && styles.segNodeDone]} />
                    {!isLast && <View style={styles.segRailLine} />}
                  </View>
                  <View style={styles.segBody}>
                    <View style={styles.segTimeRow}>
                      <Text style={styles.segTimeText}>
                        {fmtHM(seg.start, use24h)}
                        <Text style={styles.segTimeSep}> — </Text>
                        {fmtHM(seg.end, use24h)}
                      </Text>
                      <Text style={styles.segDurText}>{fmtDur(seg.duration)}</Text>
                    </View>
                    <TouchableOpacity
                      style={[
                        styles.segCard,
                        { borderLeftColor: projectColor },
                        task.completed && styles.taskItemCompleted,
                      ]}
                      onPress={() => (onTaskInspect || onTaskPress)?.(task)}
                      onLongPress={() => onTaskLongPress?.(task)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.segCardHeader}>
                        <Text
                          style={[styles.segCardTitle, task.completed && styles.taskTitleCompleted]}
                          numberOfLines={1}
                        >
                          {task.title}
                        </Text>
                        {multiUser && task.userId && (
                          <TouchableOpacity
                            style={[styles.ownerBadge, { backgroundColor: ownerColor(task.userId) }]}
                            onPress={() => onOwnerPress?.(task)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityRole="button"
                            accessibilityLabel={`Owner: ${task.ownerName || 'Unknown'}. Open profile`}
                          >
                            <Text style={styles.ownerBadgeText}>{ownerInitial(task.ownerName)}</Text>
                          </TouchableOpacity>
                        )}
                        {task.priority && (
                          <View style={[styles.priorityDot, { backgroundColor: getPriorityColor(task.priority, theme) }]} />
                        )}
                        <Icon name="pencil" size={14} color={theme.colors.textTertiary} style={styles.segCardEdit} />
                      </View>
                      {!!task.description && (
                        <Text style={styles.segCardDesc} numberOfLines={2}>{task.description}</Text>
                      )}
                    </TouchableOpacity>
                    {/* Empty time before the next task, as a thin labelled line. */}
                    {seg.gapAfter != null && seg.gapAfter > 0 && (
                      <View style={styles.segGap}>
                        <View style={styles.segGapLine} />
                        <Text style={styles.segGapText}>{fmtDur(seg.gapAfter)}</Text>
                        <View style={styles.segGapLine} />
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </Reanimated.View>
        ) : (
        /* Expanded view — full 24-row hour grid; timed blocks absolutely placed. */
        <Reanimated.View key="grid" entering={FadeIn.duration(240)} exiting={FadeOut.duration(160)}>
        <Pressable
          style={styles.hourGrid}
          onLongPress={handleLongPress}
          delayLongPress={350}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <View key={`hour-${h}`} style={[styles.hourRow, { top: h * HOUR_HEIGHT }]}>
              <Text style={styles.hourLabel}>{formatHourLabel(h, use24h)}</Text>
              <View style={styles.hourDivider} />
            </View>
          ))}

          {isViewingToday && (
            <View
              pointerEvents="none"
              style={[styles.nowLine, { top: (nowMinutes / 60) * HOUR_HEIGHT - 1 }]}
            >
              <View style={styles.nowDot} />
              <View style={styles.nowBar} />
            </View>
          )}

          {timedTasks.map(task => {
            const [h, m] = task.time.split(':').map(Number);
            const top = ((h * 60 + m) / 60) * HOUR_HEIGHT;
            const duration = Number(task.duration) > 0 ? Number(task.duration) : DEFAULT_TASK_DURATION_MIN;
            const height = Math.max((duration / 60) * HOUR_HEIGHT, MIN_TASK_BLOCK_HEIGHT);
            const projectColor = getProjectColor(task.project);
            return (
              <TouchableOpacity
                key={task.id}
                style={[
                  styles.taskBlock,
                  { top, height, borderLeftColor: projectColor, backgroundColor: theme.colors.surfaceElevated },
                  task.completed && styles.taskItemCompleted,
                ]}
                // Tap a timeline block → minimal quick inspector (rename +
                // time/date). Long-press still jumps straight to the full form.
                onPress={() => (onTaskInspect || onTaskPress)?.(task)}
                onLongPress={() => onTaskLongPress?.(task)}
              >
                <View style={styles.taskBlockHeader}>
                  <Text
                    style={[styles.taskBlockTitle, task.completed && styles.taskTitleCompleted]}
                    numberOfLines={height < 40 ? 1 : 2}
                  >
                    {task.title}
                  </Text>
                  {multiUser && task.userId && (
                    <TouchableOpacity
                      style={[styles.ownerBadge, { backgroundColor: ownerColor(task.userId) }]}
                      onPress={() => onOwnerPress?.(task)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Owner: ${task.ownerName || 'Unknown'}. Open profile`}
                    >
                      <Text style={styles.ownerBadgeText}>{ownerInitial(task.ownerName)}</Text>
                    </TouchableOpacity>
                  )}
                  {task.priority && (
                    <View style={[styles.priorityDot, { backgroundColor: getPriorityColor(task.priority, theme) }]} />
                  )}
                </View>
                {height >= 40 && (
                  <Text style={styles.taskBlockTime} numberOfLines={1}>
                    {formatTimeLabel(task.time, use24h)}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </Pressable>
        </Reanimated.View>
        )}
        </Reanimated.View>
      </ScrollView>
    </View>
  );
});

export const CalendarView = ({
  tasks,
  onTaskPress,
  onTaskLongPress,
  onToggleComplete,
  selectedProject,
  selectedTags,
  tagFilterMode,
  // Shared-calendar "whose tasks" filter (list of user ids to show; empty =
  // everyone) + multiUser flag (more than one person owns visible tasks) which
  // gates the per-owner colour badge so a solo calendar stays uncluttered.
  selectedOwners,
  multiUser,
  onAddTask,
  onUpdateTask,
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
  const { theme, timeFormat } = useTheme();
  const use24h = timeFormat === '24h';
  // currentMonthIndex is the source of truth for "which month is on
  // screen". currentDate is derived from it so all the existing
  // .getMonth()/.getFullYear() reads keep working unchanged.
  const [currentMonthIndex, setCurrentMonthIndex] = useState(TODAY_INDEX);
  const currentDate = MONTHS_LIST[currentMonthIndex];
  const [selectedDate, setSelectedDate] = useState(new Date());
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
  const [isExpanded, setIsExpanded] = useState(true);
  // Tell the parent when the planner opens/closes (raised = !isExpanded) so it
  // can lock the calendar⇄list pager while the day schedule is up.
  useEffect(() => {
    onPlannerOpenChange?.(!isExpanded);
  }, [isExpanded, onPlannerOpenChange]);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  // When the user long-presses an hour on the day calendar grid, we
  // pre-fill this with the snapped HH:MM time so the next save
  // creates a task at that exact slot. Null when the user is adding
  // an "untimed" task via the regular Add placeholder.
  const [pendingTime, setPendingTime] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // Whether the "All Day" / Open-tasks list strip is collapsed. Defaults
  // COLLAPSED so the day's tasks open tidy — you see the header + count and
  // tap to expand the list, rather than a long list unfurled on first open.
  // Tap the header to fold/unfold; the mode toggle also sets it per mode.
  const [untimedCollapsed, setUntimedCollapsed] = useState(true);

  // Quick inspector — opened by tapping a task block in the hour grid. Holds
  // the task id (not the object) so the sheet always reflects live edits.
  const [inspectorTaskId, setInspectorTaskId] = useState(null);
  const inspectorTask = useMemo(
    () => (inspectorTaskId ? tasks.find(t => t.id === inspectorTaskId) || null : null),
    [inspectorTaskId, tasks],
  );
  const openInspector = useCallback((task) => setInspectorTaskId(task.id), []);
  const closeInspector = useCallback(() => setInspectorTaskId(null), []);

  // Keyboard handling
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  
  useEffect(() => {
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
  // release it springs to the nearer snap (velocity-projected). The
  // existing `isExpanded` boolean is kept in lock-step at the snap
  // endpoints (isExpanded === true ⟺ docked ⟺ sheet 0) so all the
  // existing isExpanded-keyed UI (filter toggle, hint text, auto-scroll)
  // keeps working unchanged.
  const sheet = useSharedValue(0);          // starts docked (isExpanded=true)
  const sheetStart = useSharedValue(0);     // sheet value at gesture start
  // Seed containerH with the window height so the very first frame
  // computes a sensible (docked) translateY — otherwise travel=0 would
  // briefly render the sheet raised before onLayout corrects it.
  const containerH = useSharedValue(WINDOW_HEIGHT);
  const headerH = useSharedValue(84);       // measured via onLayout; est. default

  // translateY travel = how far the sheet slides between docked and
  // raised. At sheet=1 translateY=0 (full up); at sheet=0 translateY=travel
  // (pushed down so only the header strip shows).
  const sheetStyle = useAnimatedStyle(() => {
    const travel = Math.max(0, containerH.value - headerH.value);
    return { transform: [{ translateY: travel * (1 - sheet.value) }] };
  });
  // Calendar fades out as the sheet covers it, so it isn't visible through
  // the sheet's rounded top corners on the last few pixels of travel.
  const calendarStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheet.value, [0, 0.85], [1, 0], Extrapolation.CLAMP),
  }));

  const styles = createStyles(theme);

  // Snap the sheet to docked/raised and keep `isExpanded` in sync.
  // `raise=true` → panel up (isExpanded false); `raise=false` → docked.
  const snapSheet = useCallback((raise) => {
    setIsExpanded(!raise);
    sheet.value = withSpring(raise ? 1 : 0, SHEET_SPRING);
  }, [sheet]);

  // Called from the Pan gesture's onEnd via runOnJS to commit the
  // React-side boolean once the finger lifts (the spring itself is
  // already running on the UI thread by then).
  const commitSheet = useCallback((raise) => {
    setIsExpanded(!raise);
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
      const travel = Math.max(1, containerH.value - headerH.value);
      // Drag up (negative translationY) raises the sheet toward 1.
      const next = sheetStart.value - e.translationY / travel;
      sheet.value = Math.min(1, Math.max(0, next));
    })
    .onEnd((e) => {
      const travel = Math.max(1, containerH.value - headerH.value);
      // Project a little along the fling so a fast flick commits even
      // from past the midpoint.
      const projected = sheet.value + (-e.velocityY / travel) * 0.12;
      const raise = projected >= 0.5;
      sheet.value = withSpring(raise ? 1 : 0, SHEET_SPRING);
      runOnJS(commitSheet)(raise);
    }), [sheet, sheetStart, containerH, headerH, commitSheet]);

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
  const currentDayIndexRef = useRef(DAY_TODAY_INDEX);

  // Live horizontal scroll offset of the day pager, captured natively so the
  // week-strip highlight can track the swipe 1:1 (mirrors the photo-vault tab
  // indicator). Seeded at today's offset so the pill is correctly placed on
  // the very first frame, before any scroll event fires.
  const dayScrollX = useRef(new Animated.Value(DAY_TODAY_INDEX * SCREEN_W)).current;
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
  const [stripCenterIndex, setStripCenterIndex] = useState(DAY_TODAY_INDEX);
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

  // Handle date selection with double-tap or re-tap detection
  const handleDatePress = useCallback((date) => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300; // ms
    const isDoubleTap = now - lastTapRef.current < DOUBLE_TAP_DELAY;
    const isAlreadySelected = selectedDate.toDateString() === date.toDateString();
    
    // Select the date (jumpToDate also moves the day pager + fires
    // onDateChange). A double-tap / re-tap additionally raises the panel.
    jumpToDate(date, false);
    if (isDoubleTap || isAlreadySelected) {
      snapSheet(true);
    }

    lastTapRef.current = now;
  }, [snapSheet, selectedDate, jumpToDate]);

  // Header tap toggles the sheet between docked and raised. (Drags are
  // handled separately by the Pan gesture wrapping the header.)
  const toggleExpand = useCallback(() => {
    snapSheet(isExpanded); // isExpanded(docked) → raise; raised → dock
  }, [isExpanded, snapSheet]);

  // ── Day-pane control callbacks (passed to each DayPane) ───────────────
  // Opening the add-task / search inputs from a docked calendar first raises
  // the panel so the input isn't hidden behind it.
  const openAddTask = useCallback(() => {
    setIsAddingTask(true);
    if (isExpanded) toggleExpand();
  }, [isExpanded, toggleExpand]);
  const openSearch = useCallback(() => {
    setIsSearching(true);
    if (isExpanded) toggleExpand();
  }, [isExpanded, toggleExpand]);
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

  // Calendar-data builder — produces the cell array for ONE month.
  // Padded to CELLS_PER_MONTH (42 = 6 rows × 7 cols) regardless of the
  // month's actual length, so every page in the FlatList has the same
  // height and `snapToInterval` snaps cleanly to month boundaries.
  //
  // The cells ALWAYS render due-date-only dots, regardless of the
  // user's `dueDateOnly` toggle. Lighting up every day in a task's
  // created→due range produced a flood of dots that drowned out the
  // actual deadlines. The toggle's "Open Tasks" mode is still
  // honoured for the day's task LIST below the calendar — see
  // `selectedDateTasks`.
  const buildCalendarDataFor = useCallback((targetDate) => {
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startDayOfWeek = new Date(year, month, 1).getDay();
    const todayStr = toDateString(new Date());
    const selectedStr = toDateString(selectedDate);
    const keyPrefix = `${year}-${month}`;
    const filters = { selectedProject, selectedTags, tagFilterMode, selectedOwners };

    const days = new Array(CELLS_PER_MONTH);
    let idx = 0;

    // Leading empties — the cells before day 1 in the first row.
    for (let i = 0; i < startDayOfWeek; i++) {
      days[idx++] = { type: 'empty', key: `${keyPrefix}-lead-${i}` };
    }

    // The days themselves. Note the hard-coded `true` for the
    // dueDateOnly argument — dots on the calendar grid track real
    // deadlines, never the full open-range fanout.
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dateStr = toDateString(date);
      const dayTasks = tasks.filter(t =>
        taskPassesFilters(t, filters) && taskOccursOn(t, dateStr, true),
      );
      days[idx++] = {
        type: 'day',
        day,
        date,
        dateStr,
        tasks: dayTasks,
        isToday: dateStr === todayStr,
        isSelected: dateStr === selectedStr,
        key: `${keyPrefix}-day-${day}`,
      };
    }

    // Trailing empties — pad to a full 6-row grid for consistent height.
    while (idx < CELLS_PER_MONTH) {
      days[idx] = { type: 'empty', key: `${keyPrefix}-trail-${idx}` };
      idx++;
    }

    return days;
  }, [tasks, selectedProject, selectedTags, tagFilterMode, selectedOwners, selectedDate]);

  // Tasks for the selected date, ordered earliest-time-first.
  // Reuses the same predicates the calendar cells use, so what lights
  // up in the grid matches what shows in the list below.
  const selectedDateTasks = useMemo(() => {
    const dateStr = toDateString(selectedDate);
    const filters = { selectedProject, selectedTags, tagFilterMode, selectedOwners };
    return tasks
      .filter(t => taskPassesFilters(t, filters) && taskOccursOn(t, dateStr, true))
      .sort((a, b) => {
        if (a.time && b.time) return a.time.localeCompare(b.time);
        if (a.time) return -1;
        if (b.time) return 1;
        return 0;
      });
  }, [selectedDate, tasks, selectedProject, selectedTags, tagFilterMode, selectedOwners]);

  // PENDING tasks — incomplete, untimed tasks across ALL dates (not just the
  // selected day). Surfaced in the day planner's "Pending Tasks" strip so your
  // unscheduled backlog is reachable from EVERY day, not only its due date.
  const pendingTasks = useMemo(() => {
    const filters = { selectedProject, selectedTags, tagFilterMode, selectedOwners };
    return tasks
      .filter(t => !t.completed
        && itemTypeOf(t) === 'task' // events/birthdays show in their own strip
        && taskPassesFilters(t, filters)
        && !(t.time && /^\d{1,2}:\d{2}/.test(t.time)))
      .sort((a, b) => {
        // Soonest due first; undated pending tasks sink to the bottom.
        const ad = a.dueDate || '9999-12-31';
        const bd = b.dueDate || '9999-12-31';
        if (ad !== bd) return ad < bd ? -1 : 1;
        return (a.title || '').localeCompare(b.title || '');
      });
  }, [tasks, selectedProject, selectedTags, tagFilterMode, selectedOwners]);

  // True iff the selected date is "today" — drives the live red
  // now-line in the hour grid.
  const isViewingToday = useMemo(
    () => toDateString(selectedDate) === toDateString(new Date()),
    [selectedDate],
  );

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
    const idx = Math.round(e.nativeEvent.contentOffset.y / MONTH_HEIGHT);
    const clamped = Math.max(0, Math.min(MONTHS_LIST.length - 1, idx));
    if (clamped !== currentMonthIndex) {
      setCurrentMonthIndex(clamped);
    }
  }, [currentMonthIndex]);

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
    scrollToMonth(TODAY_INDEX);
  }, [scrollToMonth, jumpToDate]);

  // FlatList per-item layout. With every month at exactly MONTH_HEIGHT,
  // this lets initialScrollIndex jump straight to today without measuring.
  const getItemLayout = useCallback((_, index) => ({
    length: MONTH_HEIGHT,
    offset: MONTH_HEIGHT * index,
    index,
  }), []);
  const keyExtractor = useCallback((item) => `${item.getFullYear()}-${item.getMonth()}`, []);

  const handleAddTask = () => {
    if (!newTaskTitle.trim()) return;
    const dateStr = toDateString(selectedDate);
    onAddTask?.(
      newTaskTitle.trim(),
      selectedProject === 'All' ? '' : selectedProject,
      dateStr,
      pendingTime, // null for the regular "Add a new task" flow; HH:MM
                   // when the user reached the input via a long-press
                   // on the day calendar grid.
    );
    setNewTaskTitle('');
    setIsAddingTask(false);
    setPendingTime(null);
  };

  // Re-add a previously-existing task: create a fresh instance on the
  // selected day, copying the original's description + tags + subtasks
  // (reset to incomplete with new ids) and any pending time slot.
  const handlePickSuggestion = (task) => {
    const dateStr = toDateString(selectedDate);
    onAddTask?.(
      task.title,
      task.project || (selectedProject === 'All' ? '' : selectedProject),
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
  };

  // One month's worth of UI — title + grid. Called by the FlatList for
  // each item in MONTHS_LIST. The Date is the FlatList item; cells are
  // computed on-demand via buildCalendarDataFor.
  //
  // `data` lives inline (not memoized per-item) because:
  //   - FlatList virtualization keeps the live set tiny (3–5 months).
  //   - The cells depend on selectedDate / tasks / filters — memoising
  //     would just shift the work to extra cache invalidation.
  const renderMonth = useCallback(({ item: monthDate }) => {
    const data = buildCalendarDataFor(monthDate);
    const isCurrentMonth =
      monthDate.getFullYear() === MONTHS_LIST[TODAY_INDEX].getFullYear() &&
      monthDate.getMonth() === MONTHS_LIST[TODAY_INDEX].getMonth();
    return (
      <View style={styles.monthPage}>
        {/* Title row — month bold + year thin on a shared baseline,
            left-aligned with comfortable indent. Matches the web app's
            ScrollableCalendar header (fontWeight 500/100 at 28px). The
            Today shortcut sits on the right rail, visible only on
            non-current months so it never adds clutter when there's
            nothing to jump to. */}
        <View style={styles.monthYear}>
          <View style={styles.monthTitleRow}>
            <Text style={styles.monthText}>{MONTHS[monthDate.getMonth()]}</Text>
            <Text style={styles.yearText}>{monthDate.getFullYear()}</Text>
          </View>
          {!isCurrentMonth && (
            <TouchableOpacity
              onPress={goToToday}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.todayInline}
              accessibilityRole="button"
              accessibilityLabel="Go to today"
            >
              <Icon name="calendar-today" size={14} color={theme.colors.accentSuccess} />
              <Text style={styles.todayInlineText}>Today</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Day-of-week labels — moved INSIDE each month's page so they
            scroll with the month and so we can draw a hairline divider
            between the title and these labels (a "slick" iOS-like
            separator that wouldn't have a clean attachment point if the
            labels were static above the FlatList). */}
        <View style={styles.daysHeader}>
          {DAYS.map(day => (
            <View key={day} style={styles.dayHeaderCell}>
              <Text style={styles.dayHeaderText}>{day}</Text>
            </View>
          ))}
        </View>

        <View style={styles.calendarGrid}>
          {data.map((cell) => {
            if (cell.type === 'empty') {
              return <View key={cell.key} style={styles.emptyCell} />;
            }
            const projectCount = getProjectCount(cell.tasks);
            const heat = getContributionColor(cell.tasks.length);
            return (
              <TouchableOpacity
                key={cell.key}
                style={[
                  styles.dayCell,
                  cell.isToday && styles.todayCell,
                  cell.isSelected && styles.selectedCell,
                ]}
                onPress={() => handleDatePress(cell.date)}
              >
                <Text style={[
                  styles.dayText,
                  cell.isToday && styles.todayText,
                  cell.tasks.length > 0 && { color: heat },
                ]}>
                  {cell.day}
                </Text>

                {projectCount > 0 && (
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
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }, [buildCalendarDataFor, handleDatePress, goToToday, theme, styles]);

  // Helper to get task title and subtitle for selected date
  const getTaskListTitle = () => {
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
    
    if (isToday) return { title: "Today's Tasks", subtitle: dateStr };
    if (isTomorrow) return { title: "Tomorrow's Tasks", subtitle: dateStr };
    
    // For other dates, return date as subtitle
    return { title: "Tasks", subtitle: dateStr };
  };
  
  const { title: taskTitle, subtitle: taskSubtitle } = getTaskListTitle();

  const handleCancelAdd = () => {
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
  };

  // General task lookup. Matches title + description across the whole
  // library (respecting the active project/tag filters) so the user can
  // find any task and see when it's due. Sorted soonest-due first
  // (undated last); tapping a result opens the task.
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    const filters = { selectedProject, selectedTags, tagFilterMode, selectedOwners };

    return tasks
      .filter(task => {
        if (!taskPassesFilters(task, filters)) return false;
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
  }, [searchQuery, tasks, selectedProject, selectedTags, tagFilterMode, selectedOwners]);

  // Open a search result for viewing/editing (where the due date can
  // also be changed). Replaces the old tap-to-reassign behaviour so the
  // search reads as a lookup, not a scheduling shortcut.
  const handleOpenSearchResult = (task) => {
    onTaskPress?.(task);
    setIsSearching(false);
    setSearchQuery('');
  };

  // Render one day page of the horizontal pager. The active page (its date
  // === selectedDate) wires up the live add-task / search inputs; neighbours
  // render inert placeholders so we never mount duplicate auto-focused fields.
  const renderDayItem = useCallback(({ item: date }) => (
    <DayPane
      date={date}
      isActive={toDateString(date) === toDateString(selectedDate)}
      tasks={tasks}
      selectedProject={selectedProject}
      selectedTags={selectedTags}
      tagFilterMode={tagFilterMode}
      selectedOwners={selectedOwners}
      multiUser={multiUser}
      theme={theme}
      styles={styles}
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
    />
  ), [
    selectedDate, tasks, selectedProject, selectedTags, tagFilterMode, selectedOwners,
    multiUser, theme, styles, nowMinutes, pendingTasks, untimedCollapsed,
    toggleUntimedCollapsed, scheduleCollapsed, toggleScheduleCollapsed,
    onTaskPress, openInspector, onTaskLongPress, onToggleComplete, openAddTaskAt,
    isAddingTask, newTaskTitle, handleAddTask, handleCancelAdd, pendingTime, clearPendingTime,
    openTimeEditor,
    openAddTask, handlePickSuggestion, isSearching, searchQuery, openSearch, closeSearch, searchResults,
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
      <Reanimated.View style={[styles.calendarContent, calendarStyle]}>
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
            // selectedDate changes — otherwise the "selected" highlight
            // can lag behind taps until the user scrolls.
            extraData={selectedDate}
            snapToInterval={MONTH_HEIGHT}
            snapToAlignment="start"
            decelerationRate="fast"
            showsVerticalScrollIndicator={false}
            // 1 = prerender exactly one month above + below the visible
            // page. Cheap to render, makes the partial-month peek
            // during a swipe look populated immediately.
            windowSize={3}
            removeClippedSubviews
            style={{ height: MONTH_HEIGHT }}
          />
      </Reanimated.View>

      {/* Selected Date Tasks — a draggable bottom sheet. Always full
          height, absolutely positioned; sheetStyle slides it between
          docked (only the header peeks) and raised (covers the
          calendar). The header is wrapped in a Pan GestureDetector so
          it can be dragged up/down by the finger; a plain tap still
          toggles via the TouchableOpacity onPress. */}
      <Reanimated.View style={[styles.sheet, sheetStyle]}>
        {/* Only the header is the docked "peek" (its measured height drives the
            sheet travel). The week strip lives BELOW it, so it's off-screen
            when docked and slides into view only as the sheet is brought up. */}
        <GestureDetector gesture={headerPan}>
        <TouchableOpacity
          style={[styles.taskListHeader, isExpanded && styles.taskListHeaderCollapsed]}
          onPress={toggleExpand}
          activeOpacity={1}
          onLayout={(e) => { headerH.value = e.nativeEvent.layout.height; }}
        >
          {/* Grab handle — a little pill that reads as "drag me". Centered via a
              full-width wrapper (alignItems) so padding/layout can't offset it. */}
          <View style={styles.grabHandleWrap} pointerEvents="none">
            <View style={styles.grabHandle} />
          </View>
          <View style={styles.taskListHeaderContent}>
            <View style={styles.titleRow}>
              <Text style={styles.taskListTitle}>{taskTitle}</Text>
            </View>
            {/* Date subtitle - always show when calendar expanded */}
            {(taskSubtitle || isExpanded) && (
              <Text style={styles.dateSubtitle}>{taskSubtitle || selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
            )}
            <Text style={[styles.calendarHint, isExpanded && styles.calendarHintBlue]}>
              {isExpanded ? 'Tap to view tasklist' : 'Tap to open calendar'}
            </Text>
          </View>
          <View style={styles.taskListHeaderRight}>
            {/* Right rail: "{N} Tasks" (hairline-thin) + the white "+" add
                button (a rounded square). The count is plain info; the button
                opens the unified create form pre-dated to this day (type still
                switchable). The chevron + Due/Open toggle were removed. */}
            <Text style={styles.taskCount}>
              {selectedDateTasks.length} Tasks
            </Text>
            {onCreateForDate && (
              <TouchableOpacity
                style={styles.headerAddBtn}
                onPress={(e) => {
                  e.stopPropagation();
                  onCreateForDate(toDateString(selectedDate));
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Add a task on this day"
              >
                <Icon name="plus" size={27} color={theme.colors.background} />
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
        </GestureDetector>

        {/* Week strip — the 7 days of the selected day's week, active day
            highlighted. Sits ABOVE the sliding planner so it stays fixed while
            the hourly breakdown below slides day-to-day. Tap a day to jump
            (with the same slide as a swipe). */}
        <View
          style={styles.weekStrip}
          onLayout={(e) => setStripW(e.nativeEvent.layout.width)}
        >
          {/* Fixed centre highlight pill (painted first, BEHIND the cells). The
              cell row slides under it; each cell's text cross-fades to the
              on-pill ink as it passes under the pill, so it reads as one motion. */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.weekPill,
              { top: pillTop, height: pillH, width: PILL_W, left: pillLeft },
            ]}
          />
          {/* Horizontally-sliding TRACK of day cells. Each cell is absolutely
              positioned at its OWN day index, so only this track's native
              translateX moves; re-windowing never shifts a visible cell. The day
              pager drives the translate 1:1, so weeks flow past the fixed pill
              continuously. overflow:hidden on weekStrip clips the off-screen cells. */}
          <Animated.View
            style={[styles.weekTrack, { transform: [{ translateX: trackTranslateX }] }]}
          >
            {windowDays.map(({ idx, date: d }) => {
              const key = toDateString(d);
              const isActive = key === toDateString(selectedDate);
              const isToday = key === toDateString(new Date());
              const abbr = WEEKDAY_ABBR[d.getDay()];
              // On/off-pill cross-fade peaks when THIS cell's day page is centred
              // under the fixed pill: dayScrollX === idx * SCREEN_W.
              const onPillOpacity = dayScrollX.interpolate({
                inputRange: [(idx - 1) * SCREEN_W, idx * SCREEN_W, (idx + 1) * SCREEN_W],
                outputRange: [0, 1, 0],
                extrapolate: 'clamp',
              });
              const offPillOpacity = dayScrollX.interpolate({
                inputRange: [(idx - 1) * SCREEN_W, idx * SCREEN_W, (idx + 1) * SCREEN_W],
                outputRange: [1, 0, 1],
                extrapolate: 'clamp',
              });
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.weekDayCell, { position: 'absolute', left: (idx - DAY_TODAY_INDEX) * cellW, width: cellW }]}
                  onPress={() => goToDate(d)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                  accessibilityState={{ selected: isActive }}
                >
                  <View
                    style={[styles.weekPillSlot, { width: PILL_W }]}
                    onLayout={idx === stripCenterIndex ? (e) => {
                      setPillTop(6 + e.nativeEvent.layout.y);
                      setPillH(e.nativeEvent.layout.height);
                    } : undefined}
                  >
                    {/* Today (when not selected) = a soft filled pill; fades out
                        as the orange pill slides over it. */}
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
                      <Animated.Text style={[styles.weekDayNum, { opacity: offPillOpacity }]}>{d.getDate()}</Animated.Text>
                      <Animated.Text style={[styles.weekDayNum, styles.weekDayNumOnPill, { opacity: onPillOpacity }]}>{d.getDate()}</Animated.Text>
                    </View>
                  </View>
                </TouchableOpacity>
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
          initialScrollIndex={DAY_TODAY_INDEX}
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
          style={styles.taskList}
        />
        </ScrollView.Context.Provider>
        </VirtualizedListContextResetter>
      </Reanimated.View>

      {/* Minimal quick inspector — slides up when a task block in the hour grid
          is tapped. Rename + change time/date inline (autosaves); "Edit details"
          hands off to the full form. */}
      <TaskQuickInspector
        task={inspectorTask}
        visible={!!inspectorTaskId}
        onClose={closeInspector}
        onUpdateTask={onUpdateTask}
        onToggleComplete={onToggleComplete}
        // On a shared/multi-user calendar, surface the co-owner's name so the
        // reschedule flow can offer to notify them. onNotifyReschedule does the
        // actual send (wired by the parent); absent → the prompt's "Notify" is
        // a no-op until a delivery channel is wired.
        notifyTargetName={multiUser ? (inspectorTask?.ownerName || null) : null}
        onNotifyReschedule={onNotifyReschedule}
        onOpenFull={() => {
          const t = inspectorTask;
          setInspectorTaskId(null);
          if (t) onTaskLongPress?.(t);
        }}
      />

      {/* Wheel time picker — opened by tapping the time pill on the add-task
          row (the drop-to-create flow). Sets / clears the pending time slot. */}
      <WheelTimePicker
        visible={editingTime}
        initialTime={pendingTime}
        onSelect={setPendingTime}
        onClose={() => setEditingTime(false)}
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
  // positioned, when isExpanded) task panel header. justifyContent
  // 'center' vertically centres the title + days row + month grid as
  // a group — so on a tall phone the calendar sits nicely centred
  // with breathing room above and below instead of being top-piled.
  calendarContent: {
    flex: 1,
    justifyContent: 'center',
    // Reserve the task-panel-header strip at the bottom so the
    // calendar's centred content never lands behind it. The strip is
    // ~64px when collapsed (see taskListHeader paddingVertical: 12
    // plus its text content); 80 leaves a small visual buffer. The week
    // strip is hidden when docked (it lives below the header), so it
    // doesn't factor into this reservation.
    paddingBottom: 80,
    overflow: 'hidden',
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
  // The Today shortcut moved into the per-month title row. Only
  // rendered when the visible page isn't the current month.
  todayInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: `${theme.colors.accentSuccess}1A`, // ~10% success tint
  },
  todayInlineText: {
    fontSize: 12,
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
    paddingHorizontal: CALENDAR_HORIZONTAL_PADDING,
  },
  dayHeaderCell: {
    flex: 1,
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
    paddingHorizontal: CALENDAR_HORIZONTAL_PADDING,
    paddingTop: GRID_PADDING_TOP,
  },
  // Empty cells (leading + trailing pad) match the dayCell layout
  // footprint so rows stay aligned and every month occupies exactly
  // 6 rows of CELL_HEIGHT each. `width: 1/7 of the row` via flexBasis
  // so all 7 columns fill the available horizontal space evenly even
  // when CALENDAR_HORIZONTAL_PADDING changes.
  emptyCell: {
    width: `${100 / 7}%`,
    height: CELL_HEIGHT,
  },
  dayCell: {
    width: `${100 / 7}%`,
    height: CELL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    position: 'relative',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  todayCell: {
    backgroundColor: theme.colors.surfaceElevated,
    borderColor: theme.colors.accentSuccess,
  },
  selectedCell: {
    borderColor: theme.colors.textPrimary,
  },
  // Day numbers — hairthin weight matches the iOS Calendar /
  // reference-design aesthetic. RN's '100' renders inconsistently
  // across platforms ('100' often falls back to '400' on Android);
  // '200' is the reliably-thin weight that still feels delicate.
  // tabular-nums keeps "11" and "10" the same horizontal width as
  // "1" and "0" so columns stay aligned.
  dayText: {
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    fontWeight: '200',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.3,
  },
  // Today's number stays hairthin too — the visual distinction comes
  // from `todayCell` (the border + surface fill behind it), not from
  // a heavier glyph. Matches the reference where the selected "11"
  // sits in a colored pill but the number itself is the same delicate
  // weight as every other day.
  todayText: {
    fontWeight: '300',
    color: theme.colors.accentSuccess,
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
  // The day-tasks bottom sheet. Always full-height and absolutely
  // positioned over the calendar; `sheetStyle` translateY slides it
  // between docked (only the header strip visible at the bottom) and
  // raised (covering the calendar). overflow:hidden clips the body to
  // the rounded top corners.
  sheet: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.surface,
    // Match the add-task card's rounded top + top hairline.
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
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
  // Docked peek lift — matched to the add-task card's soft upward shadow so the
  // collapsed strip reads as the same floating card.
  taskListHeaderCollapsed: {
    borderBottomWidth: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 18,
  },
  taskListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    // Extra top padding leaves room for the grab-handle pill above the
    // title; bottom stays 12 for a balanced strip.
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
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
  taskListTitle: {
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  dateSubtitle: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: 2,
    fontWeight: '500',
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
  checkbox: {
    marginRight: 10,
  },

  // ── Hour-timetable view ─────────────────────────────────────
  // Untimed ("All Day") header strip — sits above the hour grid for
  // tasks that don't have a HH:MM start time.
  untimedSection: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: theme.colors.surface,
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
    backgroundColor: theme.colors.surface,
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
  untimedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  untimedTitle: {
    flex: 1,
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    fontWeight: '500',
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
    backgroundColor: theme.colors.surface,
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
  },
  scheduleToggleLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  // Wrapper around the compact ⇄ timeline swap. overflow:hidden clips the
  // outgoing/incoming view to the height-animating wrapper so the toggle reads
  // as a smooth wipe rather than a hard pop.
  scheduleSwap: {
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
  },
  collapsedSchedule: {
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 24,
  },
  collapsedEmpty: {
    fontSize: 13,
    color: theme.colors.textTertiary,
    textAlign: 'center',
    paddingVertical: 28,
    paddingHorizontal: 24,
    lineHeight: 19,
  },
  // One timed task: a left timeline rail (node + dashed connector) and the
  // body (time header + card + gap line).
  segRow: {
    flexDirection: 'row',
  },
  segRail: {
    width: 18,
    alignItems: 'center',
    paddingTop: 6,
  },
  segNode: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: theme.colors.textTertiary,
    backgroundColor: theme.colors.surface,
  },
  segNodeDone: {
    borderColor: theme.colors.accentSuccess,
    backgroundColor: theme.colors.accentSuccess,
  },
  // Dashed connector down to the next node; flex:1 stretches it across the
  // card + gap height.
  segRailLine: {
    flex: 1,
    width: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: theme.colors.border,
    borderStyle: 'dashed',
    marginTop: 4,
  },
  segBody: {
    flex: 1,
    paddingLeft: 10,
  },
  segTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  segTimeText: {
    fontSize: 15,
    fontWeight: '400',
    color: theme.colors.textPrimary,
    letterSpacing: 0.2,
  },
  segTimeSep: {
    fontSize: 13,
    fontWeight: '400',
    color: theme.colors.textTertiary,
  },
  segDurText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textTertiary,
  },
  segCard: {
    backgroundColor: theme.colors.surfaceElevated,
    // Right corners rounded, LEFT corners square so the coloured accent edge
    // runs straight down the left side instead of curving around the radius.
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    borderLeftWidth: 3,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  segCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  segCardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  segCardEdit: {
    marginLeft: 8,
  },
  segCardDesc: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: 4,
    lineHeight: 18,
  },
  // The empty time between two tasks: a thin line with the duration centred.
  segGap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 8,
  },
  segGapLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
  },
  segGapText: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.colors.textTertiary,
  },
  // The 24-row hour grid. Positioned-children layout — labels and
  // task blocks both place themselves with absolute `top` offsets.
  hourGrid: {
    position: 'relative',
    height: HOUR_GRID_HEIGHT,
    backgroundColor: theme.colors.surface,
  },
  // One hour row: label on the left, hairline divider across the rest.
  // Height matches HOUR_HEIGHT exactly so absolute task blocks land in
  // line with their declared start hour.
  hourRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: HOUR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  hourLabel: {
    width: HOUR_LABEL_WIDTH,
    paddingRight: 6,
    paddingTop: 2,
    textAlign: 'right',
    fontSize: 10,
    fontWeight: '600',
    color: theme.colors.textTertiary,
    fontVariantNumeric: 'tabular-nums',
  },
  hourDivider: {
    flex: 1,
    height: 0.5,
    backgroundColor: theme.colors.border,
    marginTop: 4,
  },
  // Now-line — red bar + dot at the live current-minute Y position.
  // pointerEvents:none on the wrapper so tap targets on tasks under
  // the line aren't blocked.
  nowLine: {
    position: 'absolute',
    left: HOUR_LABEL_WIDTH - 4,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    height: 2,
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
  // Task block — positioned absolutely on the hour grid. Left border
  // gets the project colour so events from a given project read at
  // a glance.
  taskBlock: {
    position: 'absolute',
    left: HOUR_LABEL_WIDTH,
    right: 8,
    // Right corners rounded, LEFT corners square so the coloured project edge
    // runs straight down the left side instead of curving around the radius.
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    borderLeftWidth: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  taskBlockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskBlockTitle: {
    flex: 1,
    fontSize: 13,
    color: theme.colors.textPrimary,
    fontWeight: '600',
  },
  taskBlockTime: {
    fontSize: 10,
    color: theme.colors.textTertiary,
    fontWeight: '500',
    marginTop: 1,
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
  searchResults: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 12,
  },
  searchResultsTitle: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginBottom: 8,
    fontStyle: 'italic',
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: 8,
    padding: 12,
    marginBottom: 6,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
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
