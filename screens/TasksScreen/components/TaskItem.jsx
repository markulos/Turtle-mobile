import React, { useState, useRef, useEffect } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  TextInput,
  StyleSheet,
  Animated,
  Easing
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { getPriorityColor, areAllSubtasksCompleted, formatDueDate, isOverdue, formatTime12h } from '../utils/taskHelpers';
import { WheelTimePicker } from './WheelTimePicker';
import TaskCountdownBadge from './TaskCountdownBadge';

// Instant tactile confirmation on tap — fires immediately so the action feels
// done the moment you touch it (the actual save is optimistic + background).
// Defensive require: a silent no-op if expo-haptics isn't in the dev build.
let _Haptics = null;
try { _Haptics = require('expo-haptics'); } catch (e) { _Haptics = null; }
const tapHaptic = () => {
  try { _Haptics?.selectionAsync?.(); } catch (e) { /* haptics are garnish */ }
};

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
  keyboardVisible
}) => {
  const { theme, timeFormat } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [editingSubtaskId, setEditingSubtaskId] = useState(null);
  const [editSubtaskTitle, setEditSubtaskTitle] = useState('');
  const [editSubtaskTime, setEditSubtaskTime] = useState('');
  const [showSubtaskTimePicker, setShowSubtaskTimePicker] = useState(false);
  // Ref for scrolling a subtask edit row into view above the keyboard.
  const editSubtaskRef = useRef(null);

  const animation = useRef(new Animated.Value(0)).current;

  const toggleExpand = () => {
    const toValue = expanded ? 0 : 1;
    Animated.timing(animation, {
      toValue,
      duration: 200,
      easing: Easing.ease,
      useNativeDriver: false,
    }).start();
    setExpanded(!expanded);
  };

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

  // Overdue = a due date in the past on an incomplete task. Drives the
  // red tint on the due-date badge below.
  const dueOverdue = !item.completed && isOverdue(item.dueDate);

  const styles = createStyles(theme);

  return (
    <View style={[styles.container, item.completed && styles.completed]}>
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
            onPress={(e) => {
              e.stopPropagation();
              tapHaptic();
              onToggleComplete(item.id);
            }}
          >
            <Icon 
              name={item.completed ? "checkbox-marked" : "checkbox-blank-circle-outline"} 
              size={22} 
              color={item.completed ? theme.colors.accentSuccess : theme.colors.textTertiary} 
            />
          </TouchableOpacity>
          
          <View style={styles.content}>
            {/* Title on its own line for a consistent card layout. */}
            <Text style={[styles.title, item.completed && styles.completedText]}>
              {item.title}
            </Text>

            {/* Meta line: time → due → countdown → recurring, always on the
                row beneath the title so every card reads the same way. */}
            {(item.time || item.dueDate || !item.completed || (item.recurring && item.recurring !== 'none')) && (
              <View style={styles.metaRow}>
                {item.time && (
                  <View style={styles.timeBadge}>
                    <Icon name="clock" size={12} color={theme.colors.background} />
                    <Text style={styles.timeText}>
                      {formatTime12h(item.time, { timeFormat })}
                    </Text>
                  </View>
                )}
                {item.dueDate && (
                  <View style={[styles.dueBadge, dueOverdue && styles.dueBadgeOverdue]}>
                    <Icon name="calendar" size={11} color={dueOverdue ? theme.colors.accentError : theme.colors.accentInfo} />
                    <Text
                      style={[styles.dueText, dueOverdue && { color: theme.colors.accentError }]}
                      numberOfLines={1}
                    >
                      {formatDueDate(item.dueDate)}
                    </Text>
                  </View>
                )}
                <TaskCountdownBadge task={item} />
                {item.recurring && item.recurring !== 'none' && (
                  <View style={styles.recurringBadge}>
                    <Icon
                      name={
                        item.recurring === 'daily' ? 'calendar-today' :
                        item.recurring === 'weekly' ? 'calendar-week' :
                        'calendar-range'
                      }
                      size={10}
                      color={theme.colors.accentSuccess}
                    />
                    <Text style={styles.recurringText}>
                      {item.recurring === 'daily' ? 'Daily' :
                       item.recurring === 'weekly' ? 'Weekly' :
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
                color={theme.colors.textTertiary}
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
                onPress={() => onToggleSubtask(item.id, subtask.id)}
              >
                <Icon 
                  name={subtask.completed ? "checkbox-marked" : "checkbox-blank-outline"} 
                  size={18} 
                  color={subtask.completed ? theme.colors.accentSuccess : theme.colors.textTertiary} 
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
                      placeholderTextColor={theme.colors.textPlaceholder}
                    />
                    <TouchableOpacity onPress={saveEditSubtask}>
                      <Icon name="check" size={18} color={theme.colors.accentSuccess} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setShowSubtaskTimePicker(true)}>
                      <Icon name="clock" size={18} color={editSubtaskTime ? theme.colors.accentPrimary : theme.colors.textTertiary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { setEditingSubtaskId(null); setEditSubtaskTitle(''); setEditSubtaskTime(''); }}>
                      <Icon name="close" size={18} color={theme.colors.accentError} />
                    </TouchableOpacity>
                  </View>
                  {editSubtaskTime && (
                    <View style={styles.editSubtaskTimeBadge}>
                      <Icon name="clock" size={12} color={theme.colors.background} />
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
                          <Icon name="clock" size={8} color={theme.colors.accentPrimary} />
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
                      <Icon name="pencil" size={16} color={theme.colors.textTertiary} />
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={styles.subtaskAction}
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
            <TextInput
              style={styles.addSubtaskInput}
              placeholder="Add subtask..."
              placeholderTextColor={theme.colors.textPlaceholder}
              value={newSubtaskTitle}
              onChangeText={setNewSubtaskTitle}
              onSubmitEditing={handleAddSubtask}
            />
            <TouchableOpacity style={styles.addSubtaskBtn} onPress={handleAddSubtask}>
              <Icon name="check" size={18} color={theme.colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.cancelSubtaskBtn}
              onPress={() => setNewSubtaskTitle('')}
            >
              <Icon name="close" size={18} color={theme.colors.textTertiary} />
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
  prev.keyboardVisible === next.keyboardVisible &&
  prev.listRef === next.listRef &&
  prev.scrollY === next.scrollY,
);

const createStyles = (theme) => StyleSheet.create({
  container: {
    backgroundColor: theme.colors.surfaceElevated,
    marginBottom: 2,
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
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
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
    backgroundColor: theme.colors.textPrimary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  timeText: {
    fontSize: 13,
    color: theme.colors.background,
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
    backgroundColor: `${theme.colors.accentPrimary}20`,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    gap: 2,
  },
  subtaskTimeText: {
    fontSize: 9,
    color: theme.colors.accentPrimary,
    fontWeight: '600',
  },
  description: {
    fontSize: theme.typography.body,
    color: theme.colors.textTertiary,
    marginTop: 2,
  },
  completedText: {
    textDecorationLine: 'line-through',
    color: theme.colors.textTertiary,
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
    backgroundColor: theme.colors.surfaceHighlight,
    borderRadius: 2,
    marginRight: theme.spacing.sm,
    maxWidth: 60,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.textSecondary,
    borderRadius: 2,
  },
  subtaskCount: {
    fontSize: theme.typography.body,
    color: theme.colors.textTertiary,
  },

  // Expanded section - subtasks indented more than parent task
  expandedContent: {
    paddingLeft: theme.spacing.xxl,
    paddingRight: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
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
    color: theme.colors.textSecondary,
  },
  subtaskCompleted: {
    textDecorationLine: 'line-through',
    color: theme.colors.textTertiary,
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
    color: theme.colors.textPrimary,
    marginRight: 8,
  },
  editSubtaskTimeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${theme.colors.accentPrimary}20`,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  editSubtaskTimeText: {
    fontSize: 11,
    color: theme.colors.accentPrimary,
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
    color: theme.colors.inputText,
    marginRight: 8,
    backgroundColor: theme.colors.inputBackground,
  },
  addSubtaskBtn: {
    backgroundColor: theme.colors.surfaceElevated,
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
    color: theme.colors.textTertiary,
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
