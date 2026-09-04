import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  Animated,
  PanResponder,
  Dimensions,
  Keyboard,
  Alert,
  Platform,
  FlatList,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { WheelTimePicker } from './WheelTimePicker';
import { DatePickerModal } from './DatePickerModal';
import { isOccurrenceCompleted, isTaskDoneNow } from '../utils/taskHelpers';
import { tapHaptic, impactHaptic } from '../../../utils/haptics';
import { EASE } from '../../../utils/motion';

// Minimal, web-inspector-style quick editor that slides up when a task block in
// the day's hour grid is tapped. Deliberately small: it only does the two
// things you reach for on a timeline — rename the task and change its time
// (plus its day) — and autosaves each field on commit. "Edit details" opens the
// full TaskForm for everything else. Mirrors the web TaskInspectorPanel's
// commit-on-edit feel (title on blur/Enter, time/date on pick) in a phone sheet.

const SCREEN_H = Dimensions.get('window').height || 900;
const SCREEN_W = Dimensions.get('window').width || 390;
// Width of one week page in the reschedule pager: screen width minus the sheet's
// horizontal padding (18) and the reschedule panel's padding (12), both sides.
// pagingEnabled snaps on the list's own width, so each page must match this.
const RESCHEDULE_PAGE_W = SCREEN_W - (18 + 12) * 2;
// iOS keyboard ease (Animated has no built-in "keyboard" curve); the synced
// speed comes from the OS-reported duration, this just matches the shape.
// Shared from utils/motion — the consoles use the same one.
const KB_EASING = EASE.keyboard;

const formatTime12 = (t) => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  const isPM = h >= 12;
  const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${dh}:${String(m).padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;
};

const formatDateShort = (dateStr) => {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
};

// ── Local-date helpers for the Reschedule week pager ──────────────────────
const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');
const toDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseDateStr = (s) => {
  if (!s) return new Date();
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
// The Sunday that starts the week containing `refStr`.
const weekStartOf = (refStr) => {
  const ref = parseDateStr(refStr);
  const start = new Date(ref);
  start.setDate(ref.getDate() - ref.getDay()); // back up to Sunday
  start.setHours(0, 0, 0, 0);
  return start;
};
// Weeks the pager spans on each side of the anchor week (~half a year either
// way) — enough swipe range without an unbounded list.
const WEEK_WINDOW = 26;
// Build the swipeable list of weeks centred on `anchorStr`'s week. Each entry is
// one week (Sun→Sat) of day cells carrying their YYYY-MM-DD key, weekday abbr,
// number, and a today flag. The anchor week sits at index WEEK_WINDOW.
const buildWeeks = (anchorStr) => {
  const anchor = weekStartOf(anchorStr);
  const todayStr = toDateStr(new Date());
  return Array.from({ length: WEEK_WINDOW * 2 + 1 }, (_, wi) => {
    const ws = new Date(anchor);
    ws.setDate(anchor.getDate() + (wi - WEEK_WINDOW) * 7);
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(ws);
      d.setDate(ws.getDate() + i);
      const dateStr = toDateStr(d);
      return { dateStr, dow: WEEKDAY_ABBR[d.getDay()], dayNum: d.getDate(), isToday: dateStr === todayStr };
    });
    return { key: toDateStr(ws), days };
  });
};
// "June 2026", or "Jun – Jul 2026" when a week straddles two months/years.
const weekLabel = (days) => {
  if (!days || !days.length) return '';
  const a = parseDateStr(days[0].dateStr);
  const b = parseDateStr(days[6].dateStr);
  if (a.getMonth() === b.getMonth()) return `${MONTHS_LONG[a.getMonth()]} ${a.getFullYear()}`;
  if (a.getFullYear() === b.getFullYear()) return `${MONTHS_SHORT[a.getMonth()]} – ${MONTHS_SHORT[b.getMonth()]} ${b.getFullYear()}`;
  return `${MONTHS_SHORT[a.getMonth()]} ${a.getFullYear()} – ${MONTHS_SHORT[b.getMonth()]} ${b.getFullYear()}`;
};

export const TaskQuickInspector = ({
  task,
  visible,
  onClose,
  onUpdateTask,
  onToggleComplete,
  onOpenFull,
  // When the task involves someone else (shared/multi-user calendar), the parent
  // passes that person's name here; after a reschedule we offer to notify them.
  // Null/absent → no notify prompt (e.g. it's only your own task).
  notifyTargetName = null,
  // (task, { dueDate, time }) => void — fired only if the user taps "Notify".
  onNotifyReschedule,
  // YYYY-MM-DD of the day PANE this inspector was opened from. Recurring tasks
  // complete per-occurrence, so the toggle must tick THIS day (not the handler's
  // date-less default = today/anchor) and the circle must reflect THIS day.
  contextDate = null,
}) => {
  const { theme } = useTheme();
  const styles = createStyles(theme);
  // Per-occurrence checked state for the circle: day context when provided,
  // else the single-row done-now rule. Falls back to the plain bool inside.
  const done = !!task && (task.completed || (contextDate
    ? isOccurrenceCompleted(task, contextDate)
    : isTaskDoneNow(task)));

  // Slide = the open/close transform (off-screen bottom → 0). Drag = the live
  // finger offset while swiping the handle down. The sheet's translateY is
  // their sum so the two never fight.
  const slide = useRef(new Animated.Value(SCREEN_H)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  // Lifts the whole sheet above the keyboard while the title field is focused.
  // This sheet is a <Modal> (own native window), so useAnimatedKeyboard can't
  // track it — we drive the lift from the keyboard's own show/hide events and
  // match the duration the OS reports, so the sheet rises in lockstep with the
  // keyboard and the title never ends up hidden behind it.
  const kbLift = useRef(new Animated.Value(0)).current;

  const [titleDraft, setTitleDraft] = useState('');
  const [showTime, setShowTime] = useState(false);
  const [showDate, setShowDate] = useState(false);
  const titleRef = useRef(null);

  // ── Reschedule panel ──────────────────────────────────────────────────────
  // A deliberate "move this to another day + time" flow (vs. the loose time/date
  // pills above): tap Reschedule → pick a day in the task's week + a time →
  // confirm. Persists both at once, then offers to notify a co-owner.
  const [showReschedule, setShowReschedule] = useState(false);
  const [showRescheduleTime, setShowRescheduleTime] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState(null); // YYYY-MM-DD
  const [rescheduleTime, setRescheduleTime] = useState('');    // HH:MM (24h) or ''
  // Week pager: the week list is centred on `rescheduleAnchor` (fixed when the
  // panel opens, so picking a day in another week never re-windows the strip);
  // `visibleWeekIdx` tracks the week currently in view for the month label.
  const [rescheduleAnchor, setRescheduleAnchor] = useState(null);
  const [visibleWeekIdx, setVisibleWeekIdx] = useState(WEEK_WINDOW);
  const weekPagerRef = useRef(null);
  const weeks = useMemo(
    () => buildWeeks(rescheduleAnchor || toDateStr(new Date())),
    [rescheduleAnchor],
  );

  // Slide up + fade in on open.
  useEffect(() => {
    if (visible) {
      drag.setValue(0);
      slide.setValue(SCREEN_H);
      Animated.parallel([
        Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 4, speed: 14 }),
        Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, slide, drag, fade]);

  // Keep the sheet clear of the keyboard while the title is being edited.
  useEffect(() => {
    if (!visible) { kbLift.setValue(0); return undefined; }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e) => {
      Animated.timing(kbLift, {
        toValue: -(e?.endCoordinates?.height ?? 0),
        duration: e?.duration || 250,
        easing: KB_EASING,
        useNativeDriver: true,
      }).start();
    };
    const onHide = (e) => {
      Animated.timing(kbLift, {
        toValue: 0,
        duration: e?.duration || 220,
        easing: KB_EASING,
        useNativeDriver: true,
      }).start();
    };
    const s1 = Keyboard.addListener(showEvt, onShow);
    const s2 = Keyboard.addListener(hideEvt, onHide);
    return () => { s1.remove(); s2.remove(); };
  }, [visible, kbLift]);

  // Reseed the title field whenever a different task is opened; collapse the
  // reschedule panel so it never carries over to the next task.
  useEffect(() => {
    if (task) setTitleDraft(task.title || '');
    setShowReschedule(false);
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open the reschedule panel, seeded from the task's current day + time. The
  // pager's week list is anchored on that day and scrolled to its (centre) week.
  const openReschedule = () => {
    const seed = task?.dueDate || toDateStr(new Date());
    setRescheduleDate(seed);
    setRescheduleTime(task?.time || '');
    setRescheduleAnchor(seed);
    setVisibleWeekIdx(WEEK_WINDOW);
    setShowReschedule(true);
  };

  // Step the week pager by ±1 week via the chevrons (swiping does the same).
  const goWeek = (delta) => {
    const next = Math.max(0, Math.min(weeks.length - 1, visibleWeekIdx + delta));
    if (next === visibleWeekIdx) return;
    setVisibleWeekIdx(next);
    weekPagerRef.current?.scrollToIndex({ index: next, animated: true });
  };

  // Commit the new day + time in one update, then — if a co-owner is on the
  // task — ask whether to notify them.
  const confirmReschedule = () => {
    if (!task) return;
    const updates = { time: rescheduleTime || '' };
    if (rescheduleDate) updates.dueDate = rescheduleDate;
    onUpdateTask?.(task.id, updates);
    setShowReschedule(false);
    // If someone else is on the task, offer to let them know about the new slot.
    if (notifyTargetName) {
      const when = `${formatDateShort(rescheduleDate)}${rescheduleTime ? ` at ${formatTime12(rescheduleTime)}` : ''}`;
      Alert.alert(
        `Notify ${notifyTargetName}?`,
        `Let ${notifyTargetName} know "${task.title}" moved to ${when}?`,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Notify', onPress: () => onNotifyReschedule?.(task, { dueDate: rescheduleDate, time: rescheduleTime }) },
        ],
      );
    }
  };

  const commitTitle = () => {
    if (!task) return;
    const trimmed = (titleDraft || '').trim();
    if (trimmed && trimmed !== task.title) onUpdateTask?.(task.id, { title: trimmed });
  };

  const handleClose = () => {
    Keyboard.dismiss();
    commitTitle();
    Animated.parallel([
      Animated.timing(slide, { toValue: SCREEN_H, duration: 200, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => onClose?.());
  };
  // The PanResponder is created once, so dereference the latest close through a ref.
  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;
  // Commit the title, then hand off to the full TaskForm — the same action the
  // "Edit details" button runs. Held in a ref so the once-built PanResponder
  // always calls the current closure.
  const openFullRef = useRef(() => {});
  openFullRef.current = () => { commitTitle(); onOpenFull?.(); };

  // Drag anywhere on the card to act on the sheet: DOWN dismisses it, UP opens
  // the full task editor (so a single flick straight off the block reaches the
  // create/edit card without aiming for the small "Edit details" link).
  // Upward pull rubber-bands (it's a hint, not a free drag); the open fires on
  // release once it clears the threshold.
  //
  // This is the one sheet that does NOT use utils/useSheetDismiss: the hook only
  // models downward dismissal, and this responder is a superset of it. It
  // already runs in the capture phase with the same slop and thresholds. The
  // only scrollable inside is a HORIZONTAL week pager, which the
  // vertical-dominance test excludes, so there is nothing to gate on.
  const UP_LIFT_MAX = 64;   // furthest the sheet peeks up while pulling
  const UP_OPEN_DY = -48;   // pull this far up (or flick up) to open the editor
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        // Down tracks the finger 1:1 (toward dismiss); up rubber-bands to a
        // small peek so the sheet doesn't tear away from the screen bottom.
        drag.setValue(g.dy >= 0 ? g.dy : Math.max(g.dy * 0.4, -UP_LIFT_MAX));
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy < UP_OPEN_DY || g.vy < -0.6) {
          // Settle the peek back home, then open the full editor.
          Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 2 }).start();
          openFullRef.current();
        } else if (g.dy > 90 || g.vy > 0.6) {
          Animated.timing(drag, { toValue: SCREEN_H, duration: 180, useNativeDriver: true })
            .start(() => { drag.setValue(0); handleCloseRef.current(); });
        } else {
          Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 2 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 2 }).start();
      },
    })
  ).current;

  if (!task) return null;

  const translateY = Animated.add(Animated.add(slide, drag), kbLift);
  const timeLabel = formatTime12(task.time);
  const dateLabel = formatDateShort(task.dueDate);

  return (
    <Modal animationType="none" transparent visible={visible} onRequestClose={handleClose}>
      <View style={styles.root}>
        {/* Dim backdrop — tap to dismiss. */}
        <TouchableWithoutFeedback onPress={handleClose}>
          <Animated.View style={[styles.backdrop, { opacity: fade }]} />
        </TouchableWithoutFeedback>

        <Animated.View
          {...pan.panHandlers}
          style={[styles.sheet, { transform: [{ translateY }] }]}
        >
          {/* Drag DOWN anywhere to close, UP to open the full editor. */}
          <View style={styles.header}>
            <View style={styles.grabHandle} pointerEvents="none" />
          </View>

          {/* Title row: complete circle + inline rename + expand-to-full. */}
          <View style={styles.titleRow}>
            <TouchableOpacity
              onPressIn={() => tapHaptic()}
              onPress={() => onToggleComplete?.(task.id, contextDate || undefined)}
              activeOpacity={0.7}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={[styles.circle, done && styles.circleDone]}
              accessibilityLabel={done ? 'Mark incomplete' : 'Mark complete'}
            >
              {done && <Icon name="check" size={15} color={theme.colors.background} />}
            </TouchableOpacity>

            <TextInput
              ref={titleRef}
              style={[styles.titleInput, done && styles.titleDone]}
              value={titleDraft}
              onChangeText={setTitleDraft}
              onBlur={commitTitle}
              onSubmitEditing={commitTitle}
              placeholder="Task name"
              placeholderTextColor={theme.colors.textPlaceholder}
              returnKeyType="done"
              blurOnSubmit
            />

            <TouchableOpacity
              onPress={() => { commitTitle(); onOpenFull?.(); }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.expandBtn}
              accessibilityLabel="Edit details"
            >
              <Icon name="arrow-expand" size={18} color={theme.colors.textTertiary} />
            </TouchableOpacity>
          </View>

          {/* Time + Date pills — tap to change, each clearable when set. */}
          <View style={styles.pillRow}>
            <TouchableOpacity style={styles.pill} onPress={() => setShowTime(true)} activeOpacity={0.8}>
              <Icon name="clock-outline" size={16} color={timeLabel ? theme.colors.textPrimary : theme.colors.textTertiary} />
              <Text style={[styles.pillText, !timeLabel && styles.pillPlaceholder]}>
                {timeLabel || 'Set time'}
              </Text>
              {timeLabel && (
                <TouchableOpacity
                  onPress={() => onUpdateTask?.(task.id, { time: '' })}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon name="close-circle" size={15} color={theme.colors.textTertiary} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.pill} onPress={() => setShowDate(true)} activeOpacity={0.8}>
              <Icon name="calendar" size={16} color={dateLabel ? theme.colors.textPrimary : theme.colors.textTertiary} />
              <Text style={[styles.pillText, !dateLabel && styles.pillPlaceholder]}>
                {dateLabel || 'Set date'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Reschedule — a deliberate move-to-another-day+time flow. Collapsed by
              default; expands an inline week strip + time row below. */}
          {!showReschedule ? (
            <TouchableOpacity
              style={styles.rescheduleBtn}
              onPress={openReschedule}
              activeOpacity={0.8}
            >
              <Icon name="calendar-sync" size={16} color={theme.colors.accentInfo} />
              <Text style={styles.rescheduleBtnText}>Reschedule</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.reschedulePanel}>
              <Text style={styles.rescheduleHeading}>Move to another day</Text>

              {/* Week navigator: swipe the strip left/right across weeks (or tap
                  the chevrons), then tap a day to pick the new date. */}
              <View style={styles.weekNavRow}>
                <TouchableOpacity
                  onPress={() => goWeek(-1)}
                  disabled={visibleWeekIdx <= 0}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.weekNavBtn}
                >
                  <Icon name="chevron-left" size={20} color={visibleWeekIdx <= 0 ? theme.colors.textTertiary : theme.colors.textSecondary} />
                </TouchableOpacity>
                <Text style={styles.weekNavLabel}>{weekLabel(weeks[visibleWeekIdx]?.days)}</Text>
                <TouchableOpacity
                  onPress={() => goWeek(1)}
                  disabled={visibleWeekIdx >= weeks.length - 1}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.weekNavBtn}
                >
                  <Icon name="chevron-right" size={20} color={visibleWeekIdx >= weeks.length - 1 ? theme.colors.textTertiary : theme.colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <FlatList
                ref={weekPagerRef}
                data={weeks}
                keyExtractor={(w) => w.key}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                initialScrollIndex={WEEK_WINDOW}
                getItemLayout={(_, index) => ({ length: RESCHEDULE_PAGE_W, offset: RESCHEDULE_PAGE_W * index, index })}
                onMomentumScrollEnd={(e) => {
                  const idx = Math.round(e.nativeEvent.contentOffset.x / RESCHEDULE_PAGE_W);
                  if (idx !== visibleWeekIdx) setVisibleWeekIdx(idx);
                }}
                renderItem={({ item }) => (
                  <View style={[styles.weekRow, { width: RESCHEDULE_PAGE_W }]}>
                    {item.days.map((d) => {
                      const active = d.dateStr === rescheduleDate;
                      return (
                        <TouchableOpacity
                          key={d.dateStr}
                          style={[styles.weekCell, active && styles.weekCellActive]}
                          onPress={() => setRescheduleDate(d.dateStr)}
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.weekDow, active && styles.weekTextActive]}>{d.dow}</Text>
                          <Text style={[styles.weekNum, active && styles.weekTextActive, d.isToday && !active && styles.weekNumToday]}>
                            {d.dayNum}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              />

              {/* Time row + confirm/cancel */}
              <View style={styles.rescheduleActions}>
                <TouchableOpacity
                  style={styles.rescheduleTimePill}
                  onPress={() => setShowRescheduleTime(true)}
                  activeOpacity={0.8}
                >
                  <Icon name="clock-outline" size={16} color={rescheduleTime ? theme.colors.textPrimary : theme.colors.textTertiary} />
                  <Text style={[styles.pillText, !rescheduleTime && styles.pillPlaceholder]}>
                    {formatTime12(rescheduleTime) || 'Set time'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.rescheduleCancel} onPress={() => setShowReschedule(false)} activeOpacity={0.7}>
                  <Text style={styles.rescheduleCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.rescheduleConfirm} onPressIn={() => impactHaptic('medium')} onPress={confirmReschedule} activeOpacity={0.85}>
                  <Text style={styles.rescheduleConfirmText}>Reschedule</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Edit-details — the prominent way into the full editor. The same
              card simply grows into the full form (matching radius / handle /
              dim / shadow), so it reads as one continuous sheet. Also reachable
              by dragging this sheet up by its handle — the chevron advertises
              that gesture. */}
          <TouchableOpacity
            style={styles.editDetails}
            onPress={() => { commitTitle(); onOpenFull?.(); }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Edit details — open the full editor"
          >
            <Icon name="pencil-outline" size={18} color={theme.colors.accentInfo} />
            <Text style={styles.editDetailsText}>Edit details</Text>
            <Icon name="chevron-up" size={20} color={theme.colors.textTertiary} />
          </TouchableOpacity>

          <WheelTimePicker
            visible={showTime}
            onClose={() => setShowTime(false)}
            onSelect={(time) => { onUpdateTask?.(task.id, { time }); setShowTime(false); }}
            initialTime={task.time}
          />
          <DatePickerModal
            visible={showDate}
            onClose={() => setShowDate(false)}
            onSelect={(date) => { onUpdateTask?.(task.id, { dueDate: date }); setShowDate(false); }}
            selectedDate={task.dueDate}
            theme={theme}
          />
          {/* Dedicated time wheel for the reschedule flow — stages the time
              locally (only persisted when you tap "Reschedule"). */}
          <WheelTimePicker
            visible={showRescheduleTime}
            onClose={() => setShowRescheduleTime(false)}
            onSelect={(time) => { setRescheduleTime(time || ''); setShowRescheduleTime(false); }}
            initialTime={rescheduleTime || task.time}
          />
        </Animated.View>
      </View>
    </Modal>
  );
};

const createStyles = (theme) => StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  // Matches the full TaskForm's backdrop dim so the hand-off between the two
  // sheets is seamless — same darkness behind both.
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  // Same radius / border / shadow as the full TaskForm's `content` sheet, so the
  // quick card reads as the first chapter of the same sheet — dragging up (or
  // tapping "Edit details") just continues it into the full editor.
  sheet: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingBottom: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    // Soft lift off the dimmed backdrop (mirrors TaskForm).
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 18,
  },
  header: {
    paddingTop: 10,
    paddingBottom: 10,
    alignItems: 'center',
  },
  grabHandle: {
    width: 44,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: theme.colors.borderStrong || theme.colors.border,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  circle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: theme.colors.borderStrong || theme.colors.textTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  circleDone: {
    borderColor: theme.colors.accentSuccess,
    backgroundColor: theme.colors.accentSuccess,
  },
  titleInput: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    paddingVertical: 4,
  },
  titleDone: {
    textDecorationLine: 'line-through',
    color: theme.colors.textMuted || theme.colors.textTertiary,
  },
  expandBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  pillText: {
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    fontWeight: '500',
  },
  pillPlaceholder: {
    color: theme.colors.textTertiary,
    fontWeight: '400',
  },
  editDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  editDetailsText: {
    flex: 1,
    fontSize: 15,
    color: theme.colors.textPrimary,
    fontWeight: '600',
  },
  // ── Reschedule ──
  rescheduleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  rescheduleBtnText: {
    fontSize: theme.typography.body,
    color: theme.colors.accentInfo,
    fontWeight: '600',
  },
  reschedulePanel: {
    marginTop: 16,
    padding: 12,
    borderRadius: 14,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  rescheduleHeading: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginBottom: 10,
  },
  weekNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  weekNavBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekNavLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
  },
  weekCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'transparent',
  },
  weekCellActive: {
    backgroundColor: theme.colors.accentInfo,
  },
  weekDow: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.colors.textTertiary,
    marginBottom: 2,
  },
  weekNum: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  weekNumToday: {
    color: theme.colors.accentInfo,
  },
  weekTextActive: {
    color: theme.colors.background,
  },
  rescheduleActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  rescheduleTimePill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: theme.colors.surfaceHighlight || theme.colors.surface,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  rescheduleCancel: {
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  rescheduleCancelText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    fontWeight: '500',
  },
  rescheduleConfirm: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: theme.colors.accentInfo,
  },
  rescheduleConfirmText: {
    fontSize: 14,
    color: theme.colors.background,
    fontWeight: '700',
  },
});
