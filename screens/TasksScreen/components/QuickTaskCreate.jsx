import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import EdgeSwipePage from '../../TurtleScreen/components/EdgeSwipePage';
import { DatePickerModal } from './DatePickerModal';
import { WheelTimePicker } from './WheelTimePicker';
import { getPriorityColor } from '../utils/taskHelpers';
import { tapHaptic, impactHaptic, notifyHaptic } from '../../../utils/haptics';

/**
 * QuickTaskCreate — the app's fast, one-page task creator (Instagram-profile
 * style: slides in as a full page, edge-swipe back to close). Deliberately
 * minimal: a big title field plus a row of one-tap attribute chips (date /
 * time / priority / board / reminder) and a single primary "Add task" button.
 *
 * Everything the full editor can do still lives one tap away: "More details"
 * hands the current draft to the full TaskForm (via onMore), so nothing is
 * lost — the quick page just skips straight to a saved task for the common case.
 *
 * Fully controlled at the edges:
 *   • onSubmit(finalTask) — persist a plain task (parent owns how: optimistic
 *     whole-list on the Tasks screen, POST /tasks/single from a board chat).
 *   • onMore(draft)       — optional; open the full editor prefilled. Hidden
 *     when not provided.
 */

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const tomorrowStr = () => { const d = new Date(); d.setDate(d.getDate() + 1); return ymd(d); };

const dateLabel = (s) => {
  if (!s) return 'Date';
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (s === todayStr()) return 'Today';
  if (s === tomorrowStr()) return 'Tomorrow';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const timeLabel = (t) => {
  if (!t) return 'Time';
  const [h, m] = t.split(':').map(Number);
  const pm = h >= 12; const hh = h % 12 || 12;
  return `${hh}:${pad(m)} ${pm ? 'PM' : 'AM'}`;
};

export default function QuickTaskCreate({
  visible,
  onClose,
  onSubmit,
  onMore,
  boards = [],
  initialBoard = '',
  initialDate = '',
  involvedUsers = [],
}) {
  const insets = useSafeAreaInsets();
  const { theme } = require('../../../context/ThemeContext').useTheme();
  const c = theme.colors;
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [time, setTime] = useState('');
  const [priority, setPriority] = useState('medium');
  const [board, setBoard] = useState('');
  const [remindAtTime, setRemindAtTime] = useState(true);
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const titleRef = useRef(null);
  const savingRef = useRef(false);

  // Fresh open — reset to the passed defaults and focus the title.
  useEffect(() => {
    if (!visible) return;
    setTitle('');
    setDueDate(initialDate || '');
    setTime('');
    setPriority('medium');
    setBoard(initialBoard || '');
    setRemindAtTime(true);
    setShowDate(false); setShowTime(false); setBoardOpen(false);
    setSaving(false);
    savingRef.current = false;
    const t = setTimeout(() => titleRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [visible, initialBoard, initialDate]);

  const armed = title.trim().length > 0;

  // Assemble the plain-task fields both paths share. reminders is the OBJECT
  // shape the tasks column stores ({ leads, sms, involved }) and the full
  // TaskForm hydrates from.
  const draftFields = () => ({
    title: title.trim(),
    description: '',
    priority,
    completed: false,
    project: board || '',
    dueDate: dueDate || '',
    // Keep the picked time as-is; a time with no date is rescued by the caller
    // (handleAdd/handleMore pin the date to today) so it's never silently lost.
    time: time || '',
    duration: null,
    tags: [],
    involvedUsers: Array.isArray(involvedUsers) ? involvedUsers : [],
    reminders: { leads: remindAtTime ? [0] : [], sms: false, involved: false },
    recurring: 'none',
    itemType: 'task',
    meta: {},
  });

  const handleAdd = () => {
    if (savingRef.current || !armed) return;
    savingRef.current = true;
    setSaving(true);
    const finalTask = {
      ...draftFields(),
      id: Date.now().toString(),
      createdAt: Date.now(),
    };
    // If a time was picked but no date, default the date to today so it isn't
    // silently dropped.
    if (finalTask.time && !finalTask.dueDate) finalTask.dueDate = todayStr();
    notifyHaptic('success');
    Promise.resolve(onSubmit?.(finalTask)).catch(() => {}).finally(() => {
      savingRef.current = false;
      setSaving(false);
    });
    onClose?.();
  };

  const handleMore = () => {
    if (!onMore) return;
    tapHaptic();
    const draft = draftFields();
    if (draft.time && !draft.dueDate) draft.dueDate = todayStr();
    onMore(draft);
    onClose?.();
  };

  const cyclePriority = () => {
    tapHaptic();
    setPriority((p) => (p === 'low' ? 'medium' : p === 'medium' ? 'high' : 'low'));
  };

  const pickDate = (d) => { impactHaptic('light'); setDueDate(d); };

  const prioColor = getPriorityColor(priority, theme);

  return (
    <EdgeSwipePage overlay visible={visible} onClose={onClose} swipeEnabled={!showDate && !showTime}>
      <View style={[styles.page, { paddingTop: insets.top }]}>
        {/* Header — close on the left, title, primary Add on the right. */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.headerIcon} accessibilityLabel="Close">
            <Icon name="chevron-down" size={28} color={c.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Task</Text>
          <TouchableOpacity
            style={[styles.addBtn, armed && styles.addBtnArmed]}
            onPressIn={() => armed && impactHaptic('medium')}
            onPress={handleAdd}
            disabled={!armed || saving}
            accessibilityRole="button"
            accessibilityLabel="Add task"
          >
            {saving
              ? <ActivityIndicator size="small" color={theme.mode === 'dark' ? '#111' : '#fff'} />
              : <Text style={[styles.addText, armed && styles.addTextArmed]}>Add</Text>}
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
          keyboardVerticalOffset={insets.top + 8}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <TextInput
              ref={titleRef}
              style={styles.titleInput}
              value={title}
              onChangeText={setTitle}
              placeholder="What needs to be done?"
              placeholderTextColor={c.textMuted}
              multiline
              maxLength={200}
              returnKeyType="done"
              blurOnSubmit
              onSubmitEditing={handleAdd}
            />

            {/* One-tap attribute chips. */}
            <View style={styles.chipRow}>
              <Chip
                theme={theme} icon="calendar-blank-outline"
                label={dateLabel(dueDate)} active={!!dueDate}
                onPress={() => { tapHaptic(); setShowDate(true); }}
                onClear={dueDate ? () => { tapHaptic(); setDueDate(''); setTime(''); } : null}
              />
              <Chip
                theme={theme} icon="clock-outline"
                label={timeLabel(time)} active={!!time}
                onPress={() => { tapHaptic(); setShowTime(true); }}
                onClear={time ? () => { tapHaptic(); setTime(''); } : null}
              />
              <Chip
                theme={theme} icon="flag-variant-outline"
                label={priority[0].toUpperCase() + priority.slice(1)}
                active tint={prioColor}
                onPress={cyclePriority}
              />
              {boards.length > 0 && (
                <Chip
                  theme={theme} icon="folder-outline"
                  label={board || 'Board'} active={!!board}
                  onPress={() => { tapHaptic(); setBoardOpen((v) => !v); }}
                  onClear={board ? () => { tapHaptic(); setBoard(''); } : null}
                />
              )}
            </View>

            {/* Inline board picker (only when the chip is toggled open). */}
            {boardOpen && boards.length > 0 && (
              <View style={styles.boardList}>
                {boards.map((b) => (
                  <TouchableOpacity
                    key={b}
                    style={[styles.boardItem, board === b && styles.boardItemActive]}
                    onPress={() => { tapHaptic(); setBoard(board === b ? '' : b); setBoardOpen(false); }}
                  >
                    <Icon
                      name={board === b ? 'checkbox-marked-circle' : 'circle-outline'}
                      size={18} color={board === b ? (c.accentInfo || '#4ADE80') : c.textMuted}
                    />
                    <Text style={styles.boardItemText} numberOfLines={1}>{b}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Reminder — a single subtle toggle; defaults on so a due date
                notifies without a trip to the full editor. */}
            <TouchableOpacity
              style={styles.reminderRow}
              activeOpacity={0.7}
              onPress={() => { tapHaptic(); setRemindAtTime((v) => !v); }}
            >
              <Icon name={remindAtTime ? 'bell-ring-outline' : 'bell-off-outline'} size={18} color={remindAtTime ? (c.accentInfo || '#4ADE80') : c.textMuted} />
              <Text style={styles.reminderText}>Remind me at the due time</Text>
              <View style={{ flex: 1 }} />
              <View style={[styles.switch, remindAtTime && styles.switchOn]}>
                <View style={[styles.knob, remindAtTime && styles.knobOn]} />
              </View>
            </TouchableOpacity>

            {onMore && (
              <TouchableOpacity style={styles.moreBtn} onPress={handleMore} activeOpacity={0.7}>
                <Icon name="tune-variant" size={16} color={c.textSecondary} />
                <Text style={styles.moreText}>More details</Text>
                <Icon name="chevron-right" size={18} color={c.textMuted} />
              </TouchableOpacity>
            )}
          </ScrollView>
        </KeyboardAvoidingView>

        <DatePickerModal
          visible={showDate}
          onClose={() => setShowDate(false)}
          onSelect={(d) => { pickDate(d); setShowDate(false); }}
          selectedDate={dueDate}
          theme={theme}
        />
        <WheelTimePicker
          visible={showTime}
          initialTime={time || '09:00'}
          onSelect={(t) => { impactHaptic('light'); setTime(t); setShowTime(false); }}
          onClose={() => setShowTime(false)}
        />
      </View>
    </EdgeSwipePage>
  );
}

function Chip({ theme, icon, label, active, tint, onPress, onClear }) {
  const c = theme.colors;
  const color = tint || (active ? (c.accentInfo || '#4ADE80') : c.textSecondary);
  const styles = makeStyles(theme);
  return (
    <TouchableOpacity
      style={[styles.chip, active && { borderColor: color }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Icon name={icon} size={15} color={color} />
      <Text style={[styles.chipText, active && { color: c.textPrimary }]} numberOfLines={1}>{label}</Text>
      {onClear && (
        <TouchableOpacity onPress={onClear} hitSlop={8} style={styles.chipClear}>
          <Icon name="close" size={13} color={c.textMuted} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (theme) => {
  const c = theme.colors;
  const dark = theme.mode === 'dark';
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    },
    headerIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: c.textPrimary },
    addBtn: {
      minWidth: 64, height: 36, paddingHorizontal: 16, borderRadius: 18,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
    },
    addBtnArmed: { backgroundColor: dark ? '#FFFFFF' : '#111111' },
    addText: { fontSize: 15, fontWeight: '700', color: c.textMuted },
    addTextArmed: { color: dark ? '#111111' : '#FFFFFF' },
    body: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },
    titleInput: {
      fontSize: 26, fontWeight: '700', lineHeight: 32, color: c.textPrimary,
      paddingVertical: 8, minHeight: 44,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18 },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 12, height: 38, borderRadius: 19,
      borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
      backgroundColor: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
    },
    chipText: { fontSize: 14, fontWeight: '600', color: c.textSecondary, maxWidth: 140 },
    chipClear: { marginLeft: 2 },
    boardList: {
      marginTop: 12, borderRadius: 14, overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
      backgroundColor: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
    },
    boardItem: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingHorizontal: 14, paddingVertical: 12,
    },
    boardItemActive: { backgroundColor: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' },
    boardItemText: { fontSize: 15, fontWeight: '600', color: c.textPrimary, flex: 1 },
    reminderRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      marginTop: 22, paddingVertical: 6,
    },
    reminderText: { fontSize: 15, fontWeight: '500', color: c.textSecondary },
    switch: {
      width: 44, height: 26, borderRadius: 13, padding: 3,
      backgroundColor: dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)',
      justifyContent: 'center',
    },
    switchOn: { backgroundColor: c.accentInfo || '#4ADE80' },
    knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
    knobOn: { alignSelf: 'flex-end' },
    moreBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      marginTop: 30, paddingVertical: 14, paddingHorizontal: 4,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
    },
    moreText: { flex: 1, fontSize: 15, fontWeight: '600', color: c.textSecondary },
  });
};
