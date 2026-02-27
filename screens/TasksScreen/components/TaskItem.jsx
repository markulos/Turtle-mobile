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
import { getPriorityColor, areAllSubtasksCompleted } from '../utils/taskHelpers';
import { TimePicker } from './TimePicker';

export const TaskItem = ({ 
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
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [editingSubtaskId, setEditingSubtaskId] = useState(null);
  const [editSubtaskTitle, setEditSubtaskTitle] = useState('');
  const [editSubtaskTime, setEditSubtaskTime] = useState('');
  const [showSubtaskTimePicker, setShowSubtaskTimePicker] = useState(false);
  
  // Inline editing for main task
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title);
  
  // Refs for scrolling into view
  const editSubtaskRef = useRef(null);
  const editTaskRef = useRef(null);

  const animation = useState(new Animated.Value(0))[0];

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
  
  // Main task inline editing
  const handleStartEditingTitle = () => {
    setEditTitle(item.title);
    setIsEditingTitle(true);
    // Scroll item into view after keyboard appears
    setTimeout(() => {
      scrollToItem?.();
    }, 150);
  };
  
  const handleSaveTitle = () => {
    if (!editTitle.trim()) {
      setIsEditingTitle(false);
      setEditTitle(item.title);
      return;
    }
    onUpdateTask?.(item.id, { title: editTitle.trim() });
    setIsEditingTitle(false);
  };
  
  const handleCancelEditTitle = () => {
    setIsEditingTitle(false);
    setEditTitle(item.title);
  };
  
  // Open task detail modal (for edit button)
  const handleOpenEditModal = () => {
    setIsEditingTitle(false);
    onLongPress?.(item);
  };
  
  // Handle blur with delay to allow button presses first
  const handleBlur = () => {
    // Small delay to let button onPress fire first
    setTimeout(() => {
      setEditTitle(item.title);
      setIsEditingTitle(false);
    }, 150);
  };
  
  // Effect to scroll into view when keyboard becomes visible and we're editing
  useEffect(() => {
    if (isEditingTitle && keyboardVisible) {
      scrollToItem?.();
    }
  }, [isEditingTitle, keyboardVisible]);

  const subtasks = item.subtasks || [];
  const completedSubtasks = subtasks.filter(st => st.completed).length;
  const allSubtasksDone = areAllSubtasksCompleted(subtasks);
  const progress = subtasks.length > 0 ? completedSubtasks / subtasks.length : 0;

  const styles = createStyles(theme);

  return (
    <View style={[styles.container, item.completed && styles.completed]}>
      {/* Main task row */}
      {isEditingTitle ? (
        <View style={styles.mainRow} ref={editTaskRef}>
          {/* Delete button on left margin */}
          <TouchableOpacity 
            style={styles.deleteBtn}
            onPress={() => {
              setIsEditingTitle(false);
              onDeleteTask?.(item.id);
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon name="minus-circle" size={24} color={theme.colors.accentError} />
          </TouchableOpacity>
          
          <View style={styles.editTitleRow}>
            <TextInput
              style={styles.editTitleInput}
              value={editTitle}
              onChangeText={setEditTitle}
              onSubmitEditing={handleSaveTitle}
              autoFocus
              placeholderTextColor={theme.colors.textPlaceholder}
            />
            <TouchableOpacity 
              onPress={handleSaveTitle} 
              style={styles.editActionBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon name="check" size={20} color={theme.colors.accentSuccess} />
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={handleOpenEditModal} 
              style={styles.editActionBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon name="pencil" size={18} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity 
          style={styles.mainRow}
          onPress={handleStartEditingTitle}
          onLongPress={() => onLongPress?.(item)}
          delayLongPress={500}
        >
          <TouchableOpacity 
            style={styles.checkbox}
            onPress={(e) => { 
              e.stopPropagation(); 
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
            <View style={styles.titleRow}>
              <Text style={[styles.title, item.completed && styles.completedText]}>
                {item.title}
              </Text>
              {item.time && (
                <View style={styles.timeBadge}>
                  <Icon name="clock" size={10} color={theme.colors.accentPrimary} />
                  <Text style={styles.timeText}>
                    {(() => {
                      const [h, m] = item.time.split(':').map(Number);
                      const isPM = h >= 12;
                      const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
                      return `${displayH}:${m.toString().padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;
                    })()}
                  </Text>
                </View>
              )}
            </View>
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
      )}

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
                      <Icon name="clock" size={10} color={theme.colors.accentPrimary} />
                      <Text style={styles.editSubtaskTimeText}>
                        {(() => {
                          const [h, m] = editSubtaskTime.split(':').map(Number);
                          const isPM = h >= 12;
                          const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
                          return `${displayH}:${m.toString().padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;
                        })()}
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
                            {(() => {
                              const [h, m] = subtask.time.split(':').map(Number);
                              const isPM = h >= 12;
                              const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
                              return `${displayH}:${m.toString().padStart(2, '0')}`;
                            })()}
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
          <TimePicker
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${theme.colors.accentPrimary}20`,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 3,
  },
  timeText: {
    fontSize: 11,
    color: theme.colors.accentPrimary,
    fontWeight: '600',
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
  
  // Edit main task title
  deleteBtn: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  editTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: theme.spacing.sm,
  },
  editTitleInput: {
    flex: 1,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    padding: 4,
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    marginRight: 8,
  },
  editActionBtn: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
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
