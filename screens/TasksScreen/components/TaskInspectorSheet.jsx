/**
 * TaskInspectorSheet — view + edit a task from the day panel, on the app's
 * sheet shell (PhotoViewer/ViewerSheet: in-tree overlay, frosted dark, two
 * detents, grab-bar header, keyboard measure-then-lift).
 *
 * Replaces the old TaskQuickInspector (a bespoke Modal + PanResponder that
 * only renamed and re-timed). Everything a task carries is here, each field
 * committing on its own:
 *   • the title as the sheet's top field (Return / blur saves) + Done ring;
 *   • priority keys;
 *   • When: date chip (picker) with Today / Tomorrow / Next week keys, time
 *     chip (wheel), clear keys; a reschedule offers to notify a co-owner;
 *   • Board: one key per board, "No board";
 *   • Notes (multiline, saves on blur);
 *   • Subtasks: tick, add, remove;
 *   • Tags (read here, edited in the full editor);
 *   • Full editor · Delete.
 */
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ViewerSheet, { sheetColors } from '../../TurtleScreen/components/PhotoViewer/ViewerSheet';
import { DatePickerModal } from './DatePickerModal';
import { WheelTimePicker } from './WheelTimePicker';
import { impactHaptic, notifyHaptic, tapHaptic } from '../../../utils/haptics';
import { boardLabel, formatDueDate, isOccurrenceCompleted, isTaskDoneNow } from '../utils/taskHelpers';
import { PRIORITIES } from '../utils/constants';
import { clockLabel } from './ScheduleCard';

const localDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseHM = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

function Key({ label, icon, on, onPress, colors, danger, testID }) {
  const ink = on ? colors.chipText : (danger ? '#F87171' : colors.textPrimary);
  return (
    <Pressable
      onPressIn={() => tapHaptic()}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [
        styles.key,
        { borderColor: danger ? '#F87171' : colors.chipGhostBorder },
        on && { backgroundColor: colors.chip, borderColor: colors.chip },
        pressed && styles.pressed,
      ]}
    >
      {!!icon && <Icon name={icon} size={14} color={ink} />}
      <Text style={[styles.keyText, { color: ink }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function Section({ label, colors, children, right }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{label}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

function TaskInspectorSheet({
  task, onClose, onUpdateTask, onToggleComplete, onOpenFull, onDeleteTask,
  notifyTargetName = null, onNotifyReschedule, contextDate = null,
  boards = [], colorOf, use24h = false, bottomInset = 0, theme,
}) {
  const colors = useMemo(() => sheetColors(theme, true), [theme]);
  const [title, setTitle] = useState(task?.title || '');
  const [notes, setNotes] = useState(task?.description || '');
  const [subDraft, setSubDraft] = useState('');
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const taskId = task?.id;
  useEffect(() => { setTitle(task?.title || ''); setNotes(task?.description || ''); }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = !!task && (task.completed || (contextDate ? isOccurrenceCompleted(task, contextDate) : isTaskDoneNow(task)));
  const update = useCallback((patch) => { if (task) onUpdateTask?.(task.id, patch); }, [task, onUpdateTask]);

  const commitTitle = useCallback(() => {
    const t = title.trim();
    if (task && t && t !== task.title) update({ title: t });
  }, [title, task, update]);
  const commitNotes = useCallback(() => {
    if (task && (notes || '') !== (task.description || '')) update({ description: notes });
  }, [notes, task, update]);

  // A move offers to tell the co-owner, as the old inspector did.
  const reschedule = useCallback((patch) => {
    update(patch);
    if (!notifyTargetName || !task) return;
    const dueDate = patch.dueDate !== undefined ? patch.dueDate : task.dueDate;
    const time = patch.time !== undefined ? patch.time : task.time;
    const when = `${dueDate ? formatDueDate(dueDate) : 'no date'}${time ? ` at ${clockLabel(parseHM(time), use24h)}` : ''}`;
    Alert.alert(`Notify ${notifyTargetName}?`, `Let ${notifyTargetName} know "${task.title}" moved to ${when}?`, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Notify', onPress: () => onNotifyReschedule?.(task, { dueDate, time }) },
    ]);
  }, [update, notifyTargetName, task, use24h, onNotifyReschedule]);

  const quickDates = useMemo(() => {
    const today = new Date();
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const nextWeek = new Date(today); nextWeek.setDate(today.getDate() + 7);
    return [
      { label: 'Today', value: localDateStr(today) },
      { label: 'Tomorrow', value: localDateStr(tomorrow) },
      { label: 'Next week', value: localDateStr(nextWeek) },
    ];
  }, []);

  const subtasks = Array.isArray(task?.subtasks) ? task.subtasks : [];
  const toggleSub = (id) => update({ subtasks: subtasks.map((s) => (s.id === id ? { ...s, completed: !s.completed } : s)) });
  const removeSub = (id) => update({ subtasks: subtasks.filter((s) => s.id !== id) });
  const addSub = () => {
    const t = subDraft.trim();
    if (!t) return;
    impactHaptic('light');
    update({ subtasks: [...subtasks, { id: `${Date.now()}`, title: t, completed: false }] });
    setSubDraft('');
  };

  const confirmDelete = () => {
    if (!task) return;
    Alert.alert('Delete task', `Delete "${task.title}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { onDeleteTask?.(task.id); onClose?.(); } },
    ]);
  };

  const close = useCallback(() => { Keyboard.dismiss(); commitTitle(); commitNotes(); onClose?.(); }, [commitTitle, commitNotes, onClose]);
  const openFull = useCallback(() => { commitTitle(); commitNotes(); onOpenFull?.(); }, [commitTitle, commitNotes, onOpenFull]);

  if (!task) return null;
  const tags = Array.isArray(task.tags) ? task.tags : [];
  const boardColor = task.project && colorOf ? colorOf(task.project) : null;

  const titleField = (
    <View style={styles.titleRow}>
      <Pressable
        onPressIn={() => impactHaptic('light')}
        onPress={() => onToggleComplete?.(task.id, contextDate || undefined)}
        hitSlop={10}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={done ? 'Mark not done' : 'Mark done'}
        testID="inspector-done"
        style={[styles.ring, { borderColor: colors.textPrimary }, done && { backgroundColor: colors.textPrimary }]}
      >
        {done && <Icon name="check" size={16} color={colors.background} />}
      </Pressable>
      <TextInput
        style={[styles.titleInput, { color: colors.textPrimary }, done && styles.struck]}
        value={title}
        onChangeText={setTitle}
        onBlur={commitTitle}
        onSubmitEditing={commitTitle}
        returnKeyType="done"
        placeholder="Task title"
        placeholderTextColor={colors.textMuted}
        multiline
        blurOnSubmit
        accessibilityLabel="Task title"
        testID="inspector-title"
      />
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      <Pressable
        onPressIn={() => tapHaptic()}
        onPress={openFull}
        accessibilityRole="button"
        accessibilityLabel="Open the full editor"
        testID="inspector-open-full"
        style={({ pressed }) => [styles.primary, { backgroundColor: colors.chip }, pressed && styles.pressed]}
      >
        <Icon name="square-edit-outline" size={16} color={colors.chipText} />
        <Text style={[styles.primaryText, { color: colors.chipText }]}>Full editor</Text>
      </Pressable>
      <Pressable
        onPressIn={() => notifyHaptic('warning')}
        onPress={confirmDelete}
        accessibilityRole="button"
        accessibilityLabel="Delete task"
        testID="inspector-delete"
        style={({ pressed }) => [styles.secondary, { borderColor: 'rgba(248,113,113,0.6)' }, pressed && styles.pressed]}
      >
        <Icon name="trash-can-outline" size={16} color="#F87171" />
        <Text style={[styles.secondaryText, { color: '#F87171' }]}>Delete</Text>
      </Pressable>
    </View>
  );

  return (
    <>
      <ViewerSheet
        title={task.project ? boardLabel(task.project) : 'Task'}
        subtitle={done ? 'Done' : (task.dueDate ? `${formatDueDate(task.dueDate)}${task.time ? ` · ${clockLabel(parseHM(task.time), use24h)}` : ''}` : 'No date')}
        bottomInset={bottomInset}
        onClose={close}
        theme={theme}
        dark
        keyboard
        topBar={titleField}
        footer={footer}
        testID="task-inspector-sheet"
      >
        <Section label="Priority" colors={colors}>
          <View style={styles.wrap}>
            {PRIORITIES.map((p) => (
              <Key key={p} label={p.charAt(0).toUpperCase() + p.slice(1)} on={(task.priority || 'medium') === p} onPress={() => update({ priority: p })} colors={colors} testID={`inspector-priority-${p}`} />
            ))}
          </View>
        </Section>

        <Section label="When" colors={colors}>
          <View style={styles.wrap}>
            <Key icon="calendar-blank-outline" label={task.dueDate ? formatDueDate(task.dueDate) : 'Pick a date'} on={!!task.dueDate} onPress={() => setShowDate(true)} colors={colors} testID="inspector-date" />
            <Key icon="clock-outline" label={task.time ? clockLabel(parseHM(task.time), use24h) : 'Add a time'} on={!!task.time} onPress={() => setShowTime(true)} colors={colors} testID="inspector-time" />
          </View>
          <View style={[styles.wrap, { marginTop: 8 }]}>
            {quickDates.map((q) => (
              <Key key={q.label} label={q.label} on={task.dueDate === q.value} onPress={() => reschedule({ dueDate: q.value })} colors={colors} />
            ))}
            {!!task.dueDate && <Key label="Clear date" onPress={() => reschedule({ dueDate: '', time: '' })} colors={colors} />}
            {!!task.time && <Key label="Clear time" onPress={() => reschedule({ time: '' })} colors={colors} />}
          </View>
        </Section>

        <Section label="Board" colors={colors}>
          <View style={styles.wrap}>
            <Key label="No board" on={!task.project} onPress={() => update({ project: '' })} colors={colors} />
            {boards.map((b) => (
              <Key key={b} label={boardLabel(b)} on={task.project === b} onPress={() => update({ project: b })} colors={colors} />
            ))}
          </View>
          {!!boardColor && <View style={[styles.boardLine, { backgroundColor: boardColor }]} />}
        </Section>

        <Section label="Notes" colors={colors}>
          <TextInput
            style={[styles.notes, { color: colors.textPrimary, backgroundColor: colors.surface }]}
            value={notes}
            onChangeText={setNotes}
            onBlur={commitNotes}
            placeholder="Add a note…"
            placeholderTextColor={colors.textMuted}
            multiline
            scrollEnabled={false}
            accessibilityLabel="Notes"
            testID="inspector-notes"
          />
        </Section>

        <Section label={`Subtasks${subtasks.length ? ` · ${subtasks.filter((s) => s.completed).length}/${subtasks.length}` : ''}`} colors={colors}>
          {subtasks.map((s) => (
            <View key={s.id} style={[styles.subRow, { borderBottomColor: colors.border }]}>
              <Pressable
                onPressIn={() => impactHaptic('light')}
                onPress={() => toggleSub(s.id)}
                hitSlop={8}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !!s.completed }}
                accessibilityLabel={s.completed ? `Mark ${s.title} not done` : `Mark ${s.title} done`}
                style={[styles.subRing, { borderColor: colors.textPrimary }, s.completed && { backgroundColor: colors.textPrimary }]}
              >
                {s.completed && <Icon name="check" size={12} color={colors.background} />}
              </Pressable>
              <Text style={[styles.subTitle, { color: s.completed ? colors.textMuted : colors.textPrimary }, s.completed && styles.struck]} numberOfLines={2}>{s.title}</Text>
              <Pressable onPress={() => removeSub(s.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${s.title}`} style={({ pressed }) => [styles.subRemove, pressed && styles.pressed]}>
                <Icon name="close" size={16} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
          <View style={styles.subAdd}>
            <View style={[styles.subAddWrap, { backgroundColor: colors.surface }]}>
              <TextInput
                style={[styles.subAddInput, { color: colors.textPrimary }]}
                value={subDraft}
                onChangeText={setSubDraft}
                onSubmitEditing={addSub}
                placeholder="Add a subtask…"
                placeholderTextColor={colors.textMuted}
                returnKeyType="done"
                blurOnSubmit={false}
                accessibilityLabel="New subtask"
                testID="inspector-subtask-input"
              />
            </View>
            <Pressable onPress={addSub} disabled={!subDraft.trim()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add subtask" style={({ pressed }) => [styles.subAddKey, pressed && styles.pressed]}>
              <Icon name="plus-circle" size={28} color={subDraft.trim() ? colors.primary : colors.textMuted} />
            </Pressable>
          </View>
        </Section>

        {tags.length > 0 && (
          <Section label="Tags" colors={colors} right={<Text style={[styles.hint, { color: colors.textMuted }]}>edit in the full editor</Text>}>
            <View style={styles.wrap}>
              {tags.map((t) => (
                <View key={t} style={[styles.tag, { borderColor: colors.chipGhostBorder }]}>
                  <Text style={[styles.tagText, { color: colors.textPrimary }]} numberOfLines={1}>{t}</Text>
                </View>
              ))}
            </View>
          </Section>
        )}
      </ViewerSheet>

      <DatePickerModal
        theme={theme}
        visible={showDate}
        selectedDate={task.dueDate || null}
        onSelect={(d) => { reschedule({ dueDate: d }); setShowDate(false); }}
        onClose={() => setShowDate(false)}
      />
      <WheelTimePicker
        visible={showTime}
        initialTime={task.time || null}
        onSelect={(t) => reschedule({ time: t || '' })}
        onClose={() => setShowTime(false)}
      />
    </>
  );
}

export default memo(TaskInspectorSheet);

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingBottom: 12 },
  ring: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  titleInput: { flex: 1, fontSize: 20, fontWeight: '600', lineHeight: 26, paddingVertical: 0, paddingTop: 0, paddingBottom: 0, includeFontPadding: false },
  struck: { textDecorationLine: 'line-through', opacity: 0.6 },
  section: { marginTop: 4, marginBottom: 14 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 },
  sectionLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase' },
  hint: { fontSize: 11, fontWeight: '500' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  key: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, maxWidth: '100%' },
  keyText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, flexShrink: 1 },
  boardLine: { height: 3, borderRadius: 2, marginTop: 10, width: 56 },
  notes: { minHeight: 72, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, lineHeight: 20, textAlignVertical: 'top' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  subRing: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  subTitle: { flex: 1, fontSize: 15 },
  subRemove: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  subAdd: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  subAddWrap: { flex: 1, height: 40, borderRadius: 20, paddingHorizontal: 14, justifyContent: 'center' },
  subAddInput: { paddingVertical: 0, paddingTop: 0, paddingBottom: 0, fontSize: 15, includeFontPadding: false, textAlignVertical: 'center' },
  subAddKey: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  tag: { height: 30, paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tagText: { fontSize: 13, fontWeight: '600' },
  footer: { flexDirection: 'row', gap: 10, paddingTop: 8, paddingBottom: 8 },
  primary: { flex: 1, height: 46, borderRadius: 23, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { fontSize: 15, fontWeight: '700' },
  secondary: { height: 46, paddingHorizontal: 18, borderRadius: 23, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondaryText: { fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.6 },
});
