import React, { useState, useRef, useMemo } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  TextInput,
  StyleSheet,
  Animated,
  Easing
} from 'react-native';
import AppTextInput from '../../../components/AppTextInput';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { getPriorityColor, areAllSubtasksCompleted, formatDueDate, isOverdue, formatTime12h, isTaskDoneNow, lastCompletedDate } from '../utils/taskHelpers';
import { WheelTimePicker } from './WheelTimePicker';
import TaskCountdownBadge from './TaskCountdownBadge';

// Instant tactile confirmation on tap — fires immediately so the action feels
// done the moment you touch it (the actual save is optimistic + background).
// Now sourced from the shared util so every screen buzzes identically.
import { tapHaptic, impactHaptic, notifyHaptic } from '../../../utils/haptics';
import { insetCardPalette } from '../utils/cardPalette';

const TaskItemImpl = ({
  item,
  onPress, 
  onToggleComplete, 
  onLongPress,
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
  onUpdateSubtask,
  onUpdateTask,
  onDeleteTask,
  listRef,
  scrollY,
  scrollToItem,
  keyboardVisible,
  // Accordion: expansion is OWNED BY THE PARENT so only ONE task row is open at
  // a time. `expanded` arrives as a prop; tapping the chevron asks the parent to
  // toggle THIS id, which collapses whatever other row was open.
  expanded = false,
  onToggleExpand,
}) => {
  const { theme, timeFormat } = useTheme();
  // Inverted card (black on light / white on dark) — see utils/cardPalette.
  const inv = insetCardPalette(theme);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [editingSubtaskId, setEditingSubtaskId] = useState(null);
  const [editSubtaskTitle, setEditSubtaskTitle] = useState('');
  const [editSubtaskTime, setEditSubtaskTime] = useState('');
  const [showSubtaskTimePicker, setShowSubtaskTimePicker] = useState(false);
  // Ref for scrolling a subtask edit row into view above the keyboard.
  const editSubtaskRef = useRef(null);

  // Expansion is parent-owned (accordion — one row open at a time): ask the
  // parent to toggle this id; it collapses whatever else was open.
  const toggleExpand = () => onToggleExpand?.(item.id);

  const handleAddSubtask = () => {
    if (!newSubtaskTitle.trim()) return;
    onAddSubtask(item.id, newSubtaskTitle.trim());
    setNewSubtaskTitle('');
  };

  const handleEditSubtask = (subtask) => {
    setEditingSubtaskId(subtask.id);
    setEditSubtaskTitle(subtask.title);
    setEditSubtaskTime(subtask.time || '');
    // Scroll into view after state update
    setTimeout(() => scrollToItem?.(), 150);
  };

  const saveEditSubtask = () => {
    if (!editSubtaskTitle.trim()) return;
    onUpdateSubtask(item.id, editingSubtaskId, {
      title: editSubtaskTitle.trim(),
      time: editSubtaskTime || null
    });
    setEditingSubtaskId(null);
    setEditSubtaskTitle('');
    setEditSubtaskTime('');
  };

  const subtasks = item.subtasks || [];
  const completedSubtasks = subtasks.filter(st => st.completed).length;
  const allSubtasksDone = areAllSubtasksCompleted(subtasks);
  const progress = subtasks.length > 0 ? completedSubtasks / subtasks.length : 0;

  // Single-row view: a recurring task reads ✓ while its latest ticked
  // occurrence is still current (done-now) — the global `completed` bool never
  // flips for a live series. Tapping a checked row unticks that occurrence.
  const done = isTaskDoneNow(item);
  // While checked, show the TICKED date ("Today"), not the already-advanced
  // next dueDate — otherwise completing reads as "now due tomorrow?!".
  const shownDue = (done && !item.completed && lastCompletedDate(item)) || item.dueDate;

  // Overdue = a due date in the past on an incomplete task. Drives the
  // red tint on the due-date badge below.
  const dueOverdue = !done && isOverdue(item.dueDate);

  // Memoized: this is the hot list row — unmemoized StyleSheet.create ran on
  // every render and re-registered a large style object per keystroke/scroll.
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={[styles.container, done && styles.completed]}>
      {/* Main task row — tap opens the detail; long-press opens the edit form */}
      <TouchableOpacity
          style={styles.mainRow}
          onPress={() => onPress?.(item)}
          onLongPress={() => onLongPress?.(item)}
          delayLongPress={500}
        >
          <TouchableOpacity
            style={styles.checkbox}
            activeOpacity={0.6}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPressIn={() => tapHaptic()}
            onPress={(e) => {
              e.stopPropagation();
              onToggleComplete(item.id);
            }}
          >
            <Icon
              name={done ? "checkbox-marked" : "checkbox-blank-circle-outline"}
              size={22}
              // The empty ring at full contrast against the card, never grey.
              color={done ? theme.colors.accentSuccess : inv.text}
            />
            {/* Small white connector: drops from under the checkbox circle and
                angles over the card toward the time/date badge, overlapping it
                by a hair. Anchored to the checkbox (not the row) so it stays
                put whatever the row height. Only drawn when there's a
                time/date to point at. pointerEvents off so it never eats taps. */}
            {(item.time || shownDue) && (
              <View pointerEvents="none" style={styles.checkConnector} />
            )}
          </TouchableOpacity>

          <View style={styles.content}>
            {/* Title on its own line for a consistent card layout. */}
            <Text style={[styles.title, done && styles.completedText]}>
              {item.title}
            </Text>

            {/* Meta line: time → due → countdown → recurring, always on the
                row beneath the title so every card reads the same way. */}
            {(item.time || item.dueDate || !item.completed || (item.recurring && item.recurring !== 'none')) && (
              <View style={styles.metaRow}>
                {item.time && (
                  <View style={styles.timeBadge}>
                    <Icon name="clock" size={12} color={inv.onText} />
                    <Text style={styles.timeText}>
                      {formatTime12h(item.time, { timeFormat })}
                    </Text>
                  </View>
                )}
                {shownDue && (
                  <View style={[styles.dueBadge, dueOverdue && styles.dueBadgeOverdue]}>
                    <Icon name="calendar" size={11} color={dueOverdue ? theme.colors.accentError : theme.colors.accentInfo} />
                    <Text
                      style={[styles.dueText, dueOverdue && { color: theme.colors.accentError }]}
                      numberOfLines={1}
                    >
                      {formatDueDate(shownDue)}
                    </Text>
                  </View>
                )}
                {/* Countdown hidden while checked — post-tick it would count to
                    the NEXT occurrence, reading as "it didn't complete". */}
                {!done && <TaskCountdownBadge task={item} />}
                {item.recurring && item.recurring !== 'none' && (
                  <View style={styles.recurringBadge}>
                    <Icon
                      name={
                        item.recurring === 'daily' ? 'calendar-today' :
                        item.recurring === 'weekly' ? 'calendar-week' :
                        item.recurring === 'monthly' ? 'calendar-month' :
                        'calendar-range'
                      }
                      size={10}
                      color={theme.colors.accentSuccess}
                    />
                    <Text style={styles.recurringText}>
                      {item.recurring === 'daily' ? 'Daily' :
                       item.recurring === 'weekly' ? 'Weekly' :
                       item.recurring === 'monthly' ? 'Monthly' :
                       'Biweekly'}
                    </Text>
                  </View>
                )}
              </View>
            )}
            {item.description && !expanded && (
              <Text style={styles.description} numberOfLines={1}>
                {item.description.split('\n')[0]}
              </Text>
            )}
            
            {/* Subtasks summary */}
            {subtasks.length > 0 && !expanded && (
              <View style={styles.subtaskSummary}>
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
                </View>
                <Text style={styles.subtaskCount}>
                  {completedSubtasks}/{subtasks.length}
                </Text>
              </View>
            )}
          </View>
          
          <View style={styles.rightSection}>
            <View style={[styles.priorityDot, { backgroundColor: getPriorityColor(item.priority, theme) }]} />
            
            <TouchableOpacity
              style={styles.expandBtn}
              onPress={(e) => { e.stopPropagation(); toggleExpand(); }}
            >
              <Icon
                name={expanded ? "chevron-up" : "chevron-down"}
                size={20}
                color={inv.muted}
              />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>

      {/* Expanded subtasks section */}
      {expanded && (
        <View style={styles.expandedContent}>
          {subtasks.map((subtask, index) => (
            <View 
              key={subtask.id} 
              style={[
                styles.subtaskRow,
                index === subtasks.length - 1 && styles.subtaskLast
              ]}
            >
              <TouchableOpacity
                style={styles.subtaskCheckbox}
                onPressIn={() => tapHaptic()}
                onPress={() => onToggleSubtask(item.id, subtask.id)}
              >
                <Icon 
                  name={subtask.completed ? "checkbox-marked" : "checkbox-blank-outline"} 
                  size={18} 
                  color={subtask.completed ? theme.colors.accentSuccess : inv.text} 
                />
              </TouchableOpacity>
              
              {editingSubtaskId === subtask.id ? (
                <View style={styles.editSubtaskContainer} ref={editingSubtaskId === subtask.id ? editSubtaskRef : null}>
                  <View style={styles.editSubtaskRow}>
                    <TextInput
                      style={styles.editSubtaskInput}
                      value={editSubtaskTitle}
                      onChangeText={setEditSubtaskTitle}
                      onSubmitEditing={saveEditSubtask}
                      autoFocus
                      placeholderTextColor={inv.muted}
                    />
                    <TouchableOpacity onPressIn={() => impactHaptic('medium')} onPress={saveEditSubtask}>
                      <Icon name="check" size={18} color={theme.colors.accentSuccess} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setShowSubtaskTimePicker(true)}>
                      <Icon name="clock" size={18} color={editSubtaskTime ? theme.colors.accentInfo : inv.muted} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { setEditingSubtaskId(null); setEditSubtaskTitle(''); setEditSubtaskTime(''); }}>
                      <Icon name="close" size={18} color={theme.colors.accentError} />
                    </TouchableOpacity>
                  </View>
                  {editSubtaskTime && (
                    <View style={styles.editSubtaskTimeBadge}>
                      <Icon name="clock" size={12} color={inv.onText} />
                      <Text style={styles.editSubtaskTimeText}>
                        {formatTime12h(editSubtaskTime, { timeFormat })}
                      </Text>
                    </View>
                  )}
                </View>
              ) : (
                <>
                  <View style={styles.subtaskContent}>
                    <View style={styles.subtaskTitleRow}>
                      <Text style={[
                        styles.subtaskText,
                        subtask.completed && styles.subtaskCompleted
                      ]}>
                        {subtask.title}
                      </Text>
                      {subtask.time && (
                        <View style={styles.subtaskTimeBadge}>
                          <Icon name="clock" size={8} color={theme.colors.accentInfo} />
                          <Text style={styles.subtaskTimeText}>
                            {formatTime12h(subtask.time, { meridiem: false, timeFormat })}
                          </Text>
                        </View>
                      )}
                    </View>
                    {subtask.completed && subtask.completedTime && (
                      <Text style={styles.completionTime}>
                        Done: {new Date(subtask.completedTime).toLocaleString()}
                      </Text>
                    )}
                  </View>
                  <View style={styles.subtaskActions}>
                    <TouchableOpacity 
                      style={styles.subtaskAction}
                      onPress={() => handleEditSubtask(subtask)}
                    >
                      <Icon name="pencil" size={16} color={inv.muted} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.subtaskAction}
                      onPressIn={() => notifyHaptic('warning')}
                      onPress={() => onDeleteSubtask(item.id, subtask.id)}
                    >
                      <Icon name="delete" size={16} color={theme.colors.accentError} />
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          ))}

          {/* Time Picker for subtask */}
          <WheelTimePicker
            visible={showSubtaskTimePicker}
            onClose={() => setShowSubtaskTimePicker(false)}
            onSelect={(time) => {
              setEditSubtaskTime(time);
              setShowSubtaskTimePicker(false);
            }}
            initialTime={editSubtaskTime}
          />

          {/* Add subtask input - always visible */}
          <View style={styles.addSubtaskRow}>
            <AppTextInput
              style={styles.addSubtaskInput}
              placeholder="Add subtask..."
              placeholderTextColor={inv.muted}
              value={newSubtaskTitle}
              onChangeText={setNewSubtaskTitle}
              onSubmitEditing={handleAddSubtask}
            />
            <TouchableOpacity style={styles.addSubtaskBtn} onPressIn={() => impactHaptic('medium')} onPress={handleAddSubtask}>
              <Icon name="check" size={18} color={inv.text} />
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.cancelSubtaskBtn}
              onPress={() => setNewSubtaskTitle('')}
            >
              <Icon name="close" size={18} color={inv.muted} />
            </TouchableOpacity>
          </View>

          {/* Completion status */}
          {subtasks.length > 0 && (
            <View style={styles.completionStatus}>
              <Icon 
                name={allSubtasksDone ? "check-circle" : "progress-clock"} 
                size={14} 
                color={allSubtasksDone ? theme.colors.accentSuccess : theme.colors.accentWarning} 
              />
              <Text style={[
                styles.completionText,
                allSubtasksDone && styles.completionDone
              ]}>
                {allSubtasksDone 
                  ? 'All subtasks completed' 
                  : `${completedSubtasks} of ${subtasks.length} subtasks done`}
              </Text>
            </View>
          )}
          
          {/* Task completion time */}
          {item.completed && item.completedTime && (
            <View style={styles.taskCompletionTime}>
              <Icon name="clock-check" size={12} color={theme.colors.accentSuccess} />
              <Text style={styles.taskCompletionTimeText}>
                Completed: {new Date(item.completedTime).toLocaleString()}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

// Memoized so a row only re-renders when its own data (`item`), the keyboard
// state, or the list refs change — NOT on every parent re-render (search typing,
// section toggles, etc.). Callback props are intentionally NOT compared: they're
// recreated each render but behaviorally identical, and the data-mutation
// handlers read the latest tasks via a ref (so an "old" handler is still correct).
export const TaskItem = React.memo(TaskItemImpl, (prev, next) =>
  prev.item === next.item &&
  prev.expanded === next.expanded &&
  prev.keyboardVisible === next.keyboardVisible &&
  prev.listRef === next.listRef &&
  prev.scrollY === next.scrollY,
);

const createStyles = (theme) => {
  const inv = insetCardPalette(theme);
  return StyleSheet.create({
  container: {
    backgroundColor: inv.card,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: inv.edge,
    borderTopColor: inv.edgeTop, // the recess catches light along its top edge
    // Depth: shadow + elevation + the lit edge above. No overflow:hidden
    // (iOS would mask the shadow); the expanded section keeps the card colour
    // so nothing needs clipping.
    ...inv.shadow,
  },
  completed: {
    opacity: 0.6,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.sm,
    paddingLeft: theme.spacing.xl,
  },
  checkbox: {
    marginRight: theme.spacing.sm,
    position: 'relative',
    // Let the connector line spill out of the 22px box (Android clips by
    // default) and stack above the sibling content column.
    overflow: 'visible',
    zIndex: 5,
  },
  // Decorative connector line: starts at the CENTRE of the checkbox circle
  // (icon is 22px, so top:11 / left:11 is dead centre) and runs horizontally
  // right to the time/date badge in the meta row, lapping over its left edge
  // by 5px. width = centre-to-badge (~24px) + 5px overlap.
  checkConnector: {
    position: 'absolute',
    top: 11,
    left: 11,
    width: 29,
    height: 1.5,
    backgroundColor: inv.text,
    borderRadius: 1,
    zIndex: 5,
    elevation: 5, // Android paint-order: keep it above the content column
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: theme.typography.body,
    color: inv.text,
    fontWeight: '500',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 5,
  },
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: inv.text,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  timeText: {
    fontSize: 13,
    color: inv.onText,
    fontWeight: '700',
  },
  recurringBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${theme.colors.accentSuccess}20`,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 3,
  },
  recurringText: {
    fontSize: 11,
    color: theme.colors.accentSuccess,
    fontWeight: '600',
  },
  dueBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${theme.colors.accentInfo}1A`, // ~10% info tint
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  dueBadgeOverdue: {
    backgroundColor: `${theme.colors.accentError}1A`,
  },
  dueText: {
    fontSize: 11,
    color: theme.colors.accentInfo,
    fontWeight: '700',
  },
  subtaskTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  subtaskTimeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${theme.colors.accentInfo}20`,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    gap: 2,
  },
  subtaskTimeText: {
    fontSize: 9,
    color: theme.colors.accentInfo,
    fontWeight: '600',
  },
  description: {
    fontSize: theme.typography.body,
    color: inv.muted,
    marginTop: 2,
  },
  completedText: {
    textDecorationLine: 'line-through',
    color: inv.muted,
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: theme.spacing.sm,
  },
  expandBtn: {
    padding: theme.spacing.xs,
  },
  
  // Subtask summary
  subtaskSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  progressBar: {
    flex: 1,
    height: 3,
    backgroundColor: inv.track,
    borderRadius: 2,
    marginRight: theme.spacing.sm,
    maxWidth: 60,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: inv.sub,
    borderRadius: 2,
  },
  subtaskCount: {
    fontSize: theme.typography.body,
    color: inv.muted,
  },

  // Expanded section - subtasks indented more than parent task
  expandedContent: {
    paddingLeft: theme.spacing.xxl,
    paddingRight: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    backgroundColor: inv.card,
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
  },
  subtaskLast: {
    borderBottomWidth: 0,
  },
  subtaskCheckbox: {
    marginRight: theme.spacing.sm,
  },
  subtaskContent: {
    flex: 1,
  },
  subtaskText: {
    fontSize: theme.typography.body,
    color: inv.sub,
  },
  subtaskCompleted: {
    textDecorationLine: 'line-through',
    color: inv.muted,
  },
  completionTime: {
    fontSize: 10,
    color: theme.colors.accentSuccess,
    marginTop: 2,
    fontStyle: 'italic',
  },
  subtaskActions: {
    flexDirection: 'row',
  },
  subtaskAction: {
    padding: theme.spacing.xs,
    marginLeft: theme.spacing.xs,
  },

  // Edit subtask
  editSubtaskContainer: {
    flex: 1,
  },
  editSubtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  editSubtaskInput: {
    flex: 1,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    padding: 4,
    fontSize: theme.typography.body,
    color: inv.text,
    marginRight: 8,
  },
  editSubtaskTimeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${theme.colors.accentInfo}20`,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  editSubtaskTimeText: {
    fontSize: 11,
    color: theme.colors.accentInfo,
    fontWeight: '600',
  },

  // Add subtask
  addSubtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
    marginTop: 4,
  },
  addSubtaskInput: {
    flex: 1,
    borderWidth: 0,
    borderRadius: 6,
    padding: 8,
    fontSize: theme.typography.body,
    color: inv.text,
    marginRight: 8,
    backgroundColor: inv.field,
  },
  addSubtaskBtn: {
    backgroundColor: inv.field,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  cancelSubtaskBtn: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Completion status
  completionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
  },
  completionText: {
    fontSize: theme.typography.body,
    color: inv.muted,
    marginLeft: 6,
    fontStyle: 'italic',
  },
  completionDone: {
    color: theme.colors.accentSuccess,
  },
  
  // Task completion time
  taskCompletionTime: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 0.5,
    borderTopColor: theme.colors.border,
  },
  taskCompletionTimeText: {
    fontSize: theme.typography.caption || 10,
    color: theme.colors.accentSuccess,
    marginLeft: 6,
    fontStyle: 'italic',
  },
});
};
