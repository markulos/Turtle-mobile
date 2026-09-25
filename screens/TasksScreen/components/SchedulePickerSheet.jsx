import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { useSheetDismiss } from '../../../utils/useSheetDismiss';
import { formatDueDate } from '../utils/taskHelpers';
import {
  HOURS,
  MINUTES,
  PERIODS,
  PAD_ROWS,
  ITEM_HEIGHT,
  WHEEL_HEIGHT,
  WheelColumn,
} from './WheelTimePicker';

/**
 * SchedulePickerSheet — reschedule a row from the agenda's time bubble.
 *
 * TWO PANELS, side by side on one sliding track: the month on the left, the
 * time wheels on the right. Which one you land on depends on what the row
 * already has:
 *
 *   • It has a date → open on TIME. Tapping the bubble of a dated row means
 *     "move this to another hour", and making that a two-step wizard would tax
 *     the common case for nothing. The date panel is still one tap away.
 *   • It has NO date → open on DATE, and picking a day slides straight on to
 *     the time. An undated row needs both, in that order — a time without a
 *     day doesn't put it anywhere on the timeline.
 *
 * Nothing is written until "Set": the panels edit a draft, so backing out of
 * the sheet leaves the task exactly as it was.
 *
 * Props:
 *   visible   — show/hide
 *   task      — the row being rescheduled ({ dueDate, time, title })
 *   onSubmit  — ({ dueDate, time }) => void. `time` is '' when cleared
 *   onClose   — () => void
 */

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Local YYYY-MM-DD. `toISOString` is UTC and picks the WRONG day for most of
// the evening west of Greenwich, which is exactly when someone reschedules.
export const toDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const parseDateKey = (key) => {
  const parts = String(key || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * The cells of one month: leading blanks so day 1 lands under its weekday,
 * then every day. Pure, and exported, because off-by-one month arithmetic is
 * the classic silent bug in a hand-rolled calendar.
 */
export const buildMonthGrid = (year, month) => {
  const lead = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push({ key: `pad-${i}`, blank: true });
  for (let day = 1; day <= days; day += 1) {
    cells.push({ key: `d-${day}`, day, dateKey: toDateKey(new Date(year, month, day)) });
  }
  return cells;
};

// The quick row under the month — the three answers that cover most reschedules.
const QUICK_PICKS = [
  { label: 'Today', days: 0 },
  { label: 'Tomorrow', days: 1 },
  { label: 'Next week', days: 7 },
];

export const SchedulePickerSheet = ({ visible, task, onSubmit, onClose }) => {
  const { theme, timeFormat } = useTheme();
  const use24h = timeFormat === '24h';
  const { width: winW, height: winH } = useWindowDimensions();
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Draft state — committed only by "Set".
  const [step, setStep] = useState('date');
  const [dateKey, setDateKey] = useState('');
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [hourIdx, setHourIdx] = useState(0);
  const [minIdx, setMinIdx] = useState(0);
  const [periodIdx, setPeriodIdx] = useState(0);
  // Whether the row had a time when we opened — drives the "No time" affordance
  // and the Set button's meaning on the date panel.
  const [hadTime, setHadTime] = useState(false);
  // Bumped on each open so the wheels remount onto the new value (they seed
  // their scroll offset once, on mount).
  const [seed, setSeed] = useState(0);

  const backdrop = useRef(new Animated.Value(0)).current;
  const sheetY = useRef(new Animated.Value(winH)).current;
  const trackX = useRef(new Animated.Value(0)).current;

  // ── Open: seed both panels from the task, then slide the sheet up ──────────
  useEffect(() => {
    if (!visible) return;
    const existingDate = task?.dueDate || '';
    const parsed = parseDateKey(existingDate);
    setDateKey(existingDate);
    setMonthAnchor(parsed || new Date());

    const raw = task?.time;
    const hasTime = !!raw && /^\d{1,2}:\d{2}/.test(raw);
    setHadTime(hasTime);
    let h24;
    let m;
    if (hasTime) {
      [h24, m] = raw.split(':').map(Number);
    } else {
      // No time yet → the wheels open on the next round half-hour rather than
      // on "now", which nobody ever means when scheduling something.
      const now = new Date();
      const rounded = new Date(now.getTime() + (30 - (now.getMinutes() % 30)) * 60000);
      h24 = rounded.getHours();
      m = rounded.getMinutes();
    }
    setHourIdx((h24 % 12 === 0 ? 12 : h24 % 12) - 1);
    setMinIdx(Math.max(0, Math.min(59, m)));
    setPeriodIdx(h24 >= 12 ? 1 : 0);
    setSeed((s) => s + 1);

    // A dated row opens straight on the time; an undated one starts at the
    // month, because it needs a day before a time means anything.
    const firstStep = existingDate ? 'time' : 'date';
    setStep(firstStep);
    trackX.setValue(firstStep === 'date' ? 0 : -winW);

    backdrop.setValue(0);
    sheetY.setValue(winH);
    Animated.parallel([
      Animated.timing(backdrop, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(sheetY, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 240, mass: 0.9 }),
    ]).start();
    // Seeding is an OPEN event: re-running it on every winW change would snap a
    // half-made edit back to the task's stored values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, task?.id]);

  // A rotation changes the panel width, and the track's resting offset is
  // measured in it — without this the time panel would sit half off the card
  // after turning the phone.
  useEffect(() => {
    trackX.setValue(step === 'date' ? 0 : -winW);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winW]);

  const goToStep = useCallback((next) => {
    setStep(next);
    Animated.spring(trackX, {
      toValue: next === 'date' ? 0 : -winW,
      useNativeDriver: true,
      damping: 26,
      stiffness: 260,
      mass: 0.9,
    }).start();
  }, [trackX, winW]);

  const animateOut = useCallback((after) => {
    Animated.parallel([
      Animated.timing(backdrop, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(sheetY, { toValue: winH, duration: 220, useNativeDriver: true }),
    ]).start(() => after && after());
  }, [backdrop, sheetY, winH]);

  const handleCancel = useCallback(() => animateOut(() => onClose?.()), [animateOut, onClose]);

  const buildTime = useCallback(() => {
    const h12 = hourIdx + 1;
    const pm = periodIdx === 1;
    let h24;
    if (pm) h24 = h12 === 12 ? 12 : h12 + 12;
    else h24 = h12 === 12 ? 0 : h12;
    return `${String(h24).padStart(2, '0')}:${String(minIdx).padStart(2, '0')}`;
  }, [hourIdx, minIdx, periodIdx]);

  const commit = useCallback((time) => {
    if (!dateKey) return; // Set is disabled without one; belt and braces
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    animateOut(() => {
      onSubmit?.({ dueDate: dateKey, time });
      onClose?.();
    });
  }, [dateKey, animateOut, onSubmit, onClose]);

  const handleDayPress = useCallback((key) => {
    Haptics.selectionAsync().catch(() => {});
    setDateKey(key);
    // Picking the day is the first half of the answer — slide to the second.
    goToStep('time');
  }, [goToStep]);

  const handleQuickPick = useCallback((days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setMonthAnchor(d);
    handleDayPress(toDateKey(d));
  }, [handleDayPress]);

  const { panHandlers, noDragProps, sheetDragStyle } = useSheetDismiss(handleCancel, visible);

  const grid = useMemo(
    () => buildMonthGrid(monthAnchor.getFullYear(), monthAnchor.getMonth()),
    [monthAnchor],
  );
  const todayKey = useMemo(() => toDateKey(new Date()), [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // The header preview — the whole draft in one line, so both panels always
  // show what "Set" would write.
  const timeLabel = useMemo(() => {
    const h = hourIdx + 1;
    if (use24h) {
      const h24 = periodIdx === 1 ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h);
      return `${String(h24).padStart(2, '0')}:${String(minIdx).padStart(2, '0')}`;
    }
    return `${h}:${String(minIdx).padStart(2, '0')} ${PERIODS[periodIdx]}`;
  }, [hourIdx, minIdx, periodIdx, use24h]);
  const previewLabel = dateKey ? `${formatDueDate(dateKey)} · ${timeLabel}` : 'Pick a day';

  const cell = Math.floor((winW - 2 * 18) / 7);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={handleCancel} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={handleCancel} />
        </Animated.View>

        <Animated.View
          {...panHandlers}
          style={[styles.sheet, { transform: [{ translateY: sheetY }, ...sheetDragStyle.transform] }]}
        >
          <View style={styles.grabber} />

          {/* Header: cancel · the whole draft · commit */}
          <View style={styles.header}>
            <TouchableOpacity onPress={handleCancel} hitSlop={HIT} style={styles.headerSide}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <View style={styles.headerCentre}>
              <Text style={styles.preview} numberOfLines={1}>{previewLabel}</Text>
              {!!task?.title && <Text style={styles.headerTitle} numberOfLines={1}>{task.title}</Text>}
            </View>
            <TouchableOpacity
              onPress={() => (step === 'date' ? goToStep('time') : commit(buildTime()))}
              disabled={!dateKey}
              hitSlop={HIT}
              style={[styles.headerSide, styles.headerSideRight]}
              accessibilityRole="button"
              accessibilityLabel={step === 'date' ? 'Next, choose a time' : 'Set date and time'}
            >
              <Text style={[styles.setText, !dateKey && styles.setTextDisabled]}>
                {step === 'date' ? 'Next' : 'Set'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* The two panels' tabs — the flow is a wizard by default, but either
              half stays reachable so changing your mind costs one tap. */}
          <View style={styles.tabs}>
            {[
              { key: 'date', label: dateKey ? formatDueDate(dateKey) : 'Date', icon: 'calendar-blank' },
              { key: 'time', label: hadTime || step === 'time' ? timeLabel : 'Time', icon: 'clock-outline' },
            ].map((t) => {
              const active = step === t.key;
              return (
                <TouchableOpacity
                  key={t.key}
                  onPress={() => goToStep(t.key)}
                  disabled={t.key === 'time' && !dateKey}
                  style={[styles.tab, active && styles.tabActive]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={t.key === 'date' ? 'Date panel' : 'Time panel'}
                >
                  <Icon
                    name={t.icon}
                    size={14}
                    color={active ? theme.colors.textPrimary : theme.colors.textTertiary}
                  />
                  <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* The sliding track. Both panels are mounted and exactly one window
              wide, so the move between them is one native transform. */}
          <View style={styles.viewport}>
            <Animated.View
              style={{ flexDirection: 'row', width: winW * 2, transform: [{ translateX: trackX }] }}
            >
              {/* ── Panel 1: the month ─────────────────────────────────── */}
              <View style={{ width: winW, paddingHorizontal: 18 }}>
                <View style={styles.monthBar}>
                  <TouchableOpacity
                    onPress={() => setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() - 1, 1))}
                    hitSlop={HIT}
                    accessibilityRole="button"
                    accessibilityLabel="Previous month"
                  >
                    <Icon name="chevron-left" size={26} color={theme.colors.textSecondary} />
                  </TouchableOpacity>
                  <Text style={styles.monthText}>
                    {MONTHS[monthAnchor.getMonth()]} {monthAnchor.getFullYear()}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1))}
                    hitSlop={HIT}
                    accessibilityRole="button"
                    accessibilityLabel="Next month"
                  >
                    <Icon name="chevron-right" size={26} color={theme.colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <View style={styles.weekdays}>
                  {WEEKDAYS.map((d, i) => (
                    <Text key={`wd-${i}`} style={[styles.weekdayText, { width: cell }]}>{d}</Text>
                  ))}
                </View>

                <View style={styles.grid}>
                  {grid.map((c) => {
                    if (c.blank) return <View key={c.key} style={{ width: cell, height: cell * 0.92 }} />;
                    const selected = c.dateKey === dateKey;
                    const isToday = c.dateKey === todayKey;
                    return (
                      <TouchableOpacity
                        key={c.key}
                        onPress={() => handleDayPress(c.dateKey)}
                        style={{ width: cell, height: cell * 0.92, alignItems: 'center', justifyContent: 'center' }}
                        accessibilityRole="button"
                        accessibilityLabel={c.dateKey}
                        accessibilityState={{ selected }}
                      >
                        <View
                          style={[
                            styles.dayCell,
                            { width: cell - 8, height: cell - 8, borderRadius: (cell - 8) / 2 },
                            isToday && styles.dayToday,
                            selected && styles.daySelected,
                          ]}
                        >
                          <Text style={[styles.dayText, selected && styles.dayTextSelected]}>{c.day}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.quickRow}>
                  {QUICK_PICKS.map((q) => (
                    <TouchableOpacity
                      key={q.label}
                      onPress={() => handleQuickPick(q.days)}
                      style={styles.quickBtn}
                      accessibilityRole="button"
                    >
                      <Text style={styles.quickText}>{q.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* ── Panel 2: the time ───────────────────────────────────
                  Both panels are stretched to the taller one (the month), so
                  the wheels centre in that height instead of hanging from its
                  top with a pool of dead space underneath. */}
              <View style={{ width: winW, justifyContent: 'center' }}>
                {/* noDragProps: the wheels are vertical scrollers, and the
                    card's pull-down would make them unusable if it claimed
                    their gesture. */}
                <View {...noDragProps} style={styles.wheels}>
                  <View pointerEvents="none" style={styles.selectionBand} />
                  <WheelColumn
                    key={`h-${seed}`}
                    data={HOURS}
                    initialIndex={hourIdx}
                    onIndexChange={setHourIdx}
                    renderLabel={(h) => String(h)}
                    theme={theme}
                    width={62}
                    align="right"
                  />
                  <Text style={styles.colon}>:</Text>
                  <WheelColumn
                    key={`m-${seed}`}
                    data={MINUTES}
                    initialIndex={minIdx}
                    onIndexChange={setMinIdx}
                    renderLabel={(m) => String(m).padStart(2, '0')}
                    theme={theme}
                    width={62}
                    align="left"
                  />
                  <WheelColumn
                    key={`p-${seed}`}
                    data={PERIODS}
                    initialIndex={periodIdx}
                    onIndexChange={setPeriodIdx}
                    renderLabel={(p) => p}
                    theme={theme}
                    width={70}
                    align="center"
                  />
                </View>

                {/* An all-day row is a legitimate answer: keep the date, drop
                    the clock. */}
                <TouchableOpacity
                  onPress={() => commit('')}
                  disabled={!dateKey}
                  style={styles.clearBtn}
                  hitSlop={HIT}
                  accessibilityRole="button"
                  accessibilityLabel="Save without a time"
                >
                  <Text style={styles.clearText}>{hadTime ? 'Remove time' : 'No time'}</Text>
                </TouchableOpacity>
              </View>
            </Animated.View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const HIT = { top: 10, bottom: 10, left: 12, right: 12 };

const createStyles = (theme) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
    sheet: {
      backgroundColor: theme.colors.surfaceElevated,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingBottom: 30, // home-indicator safe space
      paddingTop: 10,
      // The track is exactly one window wide per panel; the off-screen one must
      // not paint outside the card.
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -6 },
      shadowOpacity: 0.4,
      shadowRadius: 24,
      elevation: 24,
    },
    grabber: {
      alignSelf: 'center',
      width: 38,
      height: 5,
      borderRadius: 3,
      backgroundColor: theme.colors.textMuted,
      marginBottom: 6,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingVertical: 8,
    },
    headerSide: { minWidth: 58 },
    headerSideRight: { alignItems: 'flex-end' },
    headerCentre: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
    cancelText: { fontSize: 16, color: theme.colors.textSecondary, fontWeight: '500' },
    setText: { fontSize: 16, color: theme.colors.accentInfo, fontWeight: '700' },
    setTextDisabled: { color: theme.colors.textMuted },
    preview: {
      fontSize: 16,
      color: theme.colors.textPrimary,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    headerTitle: { fontSize: 11, color: theme.colors.textTertiary, marginTop: 1 },
    tabs: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 18,
      paddingTop: 6,
      paddingBottom: 10,
    },
    tab: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    tabActive: {
      backgroundColor: theme.colors.surfaceHighlight,
      borderColor: theme.colors.textTertiary,
    },
    tabText: { fontSize: 12, fontWeight: '600', color: theme.colors.textTertiary, flexShrink: 1 },
    tabTextActive: { color: theme.colors.textPrimary },
    viewport: { overflow: 'hidden' },
    monthBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: 6,
    },
    monthText: { fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary },
    weekdays: { flexDirection: 'row', marginBottom: 2 },
    weekdayText: {
      fontSize: 11,
      fontWeight: '600',
      color: theme.colors.textTertiary,
      textAlign: 'center',
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    dayCell: { alignItems: 'center', justifyContent: 'center' },
    dayToday: { borderWidth: 1, borderColor: theme.colors.accentInfo },
    daySelected: { backgroundColor: theme.colors.textPrimary },
    dayText: { fontSize: 14, fontWeight: '500', color: theme.colors.textPrimary },
    // On the filled pill the day number takes the PAGE colour, like the
    // agenda's own filled time bubble.
    dayTextSelected: { color: theme.colors.background, fontWeight: '700' },
    quickRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
    quickBtn: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 9,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    quickText: { fontSize: 12, fontWeight: '600', color: theme.colors.textPrimary },
    wheels: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      height: WHEEL_HEIGHT,
      position: 'relative',
    },
    selectionBand: {
      position: 'absolute',
      left: 24,
      right: 24,
      top: PAD_ROWS * ITEM_HEIGHT,
      height: ITEM_HEIGHT,
      borderRadius: 12,
      backgroundColor: theme.colors.surfaceHighlight,
    },
    colon: {
      fontSize: 26,
      fontWeight: '600',
      color: theme.colors.textPrimary,
      marginHorizontal: 2,
      marginBottom: 2,
    },
    clearBtn: { alignSelf: 'center', marginTop: 12, paddingVertical: 8, paddingHorizontal: 18 },
    clearText: { fontSize: 14, color: theme.colors.textTertiary, fontWeight: '500' },
  });

export default SchedulePickerSheet;
