import React, { useState } from 'react';
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

export const TaskItem = ({ 
  item, 
  onPress, 
  onToggleComplete, 
  onLongPress,
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
  onUpdateSubtask
}) => {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [showAddSubtask, setShowAddSubtask] = useState(false);
  const [editingSubtaskId, setEditingSubtaskId] = useState(null);
  const [editSubtaskTitle, setEditSubtaskTitle] = useState('');

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
    setShowAddSubtask(false);
  };

  const handleEditSubtask = (subtask) => {
    setEditingSubtaskId(subtask.id);
    setEditSubtaskTitle(subtask.title);
  };

  const saveEditSubtask = () => {
    if (!editSubtaskTitle.trim()) return;
    onUpdateSubtask(item.id, editingSubtaskId, { title: editSubtaskTitle.trim() });
    setEditingSubtaskId(null);
    setEditSubtaskTitle('');
  };

  const subtasks = item.subtasks || [];
  const completedSubtasks = subtasks.filter(st => st.completed).length;
  const allSubtasksDone = areAllSubtasksCompleted(subtasks);
  const progress = subtasks.length > 0 ? completedSubtasks / subtasks.length : 0;

  const styles = createStyles(theme);

  return (
    <View style={[styles.container, item.completed && styles.completed]}>
      {/* Main task row */}
      <TouchableOpacity 
        style={styles.mainRow}
        onPress={onPress}
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
          <Text style={[styles.title, item.completed && styles.completedText]}>
            {item.title}
          </Text>
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
                <View style={styles.editSubtaskRow}>
                  <TextInput
                    style={styles.editSubtaskInput}
                    value={editSubtaskTitle}
                    onChangeText={setEditSubtaskTitle}
                    onSubmitEditing={saveEditSubtask}
                    placeholderTextColor={theme.colors.textPlaceholder}
                  />
                  <TouchableOpacity onPress={saveEditSubtask}>
                    <Icon name="check" size={18} color={theme.colors.accentSuccess} />
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text style={[
                    styles.subtaskText,
                    subtask.completed && styles.subtaskCompleted
                  ]}>
                    {subtask.title}
                  </Text>
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

          {/* Add subtask input */}
          {showAddSubtask ? (
            <View style={styles.addSubtaskRow}>
              <TextInput
                style={styles.addSubtaskInput}
                placeholder="New subtask..."
                placeholderTextColor={theme.colors.textPlaceholder}
                value={newSubtaskTitle}
                onChangeText={setNewSubtaskTitle}
                onSubmitEditing={handleAddSubtask}
              />
              <TouchableOpacity style={styles.addSubtaskBtn} onPress={handleAddSubtask}>
                <Icon name="check" size={18} color={theme.colors.background} />
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.cancelSubtaskBtn}
                onPress={() => {
                  setShowAddSubtask(false);
                  setNewSubtaskTitle('');
                }}
              >
                <Icon name="close" size={18} color={theme.colors.textTertiary} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity 
              style={styles.addSubtaskTrigger}
              onPress={() => setShowAddSubtask(true)}
            >
              <Icon name="plus" size={16} color={theme.colors.textPrimary} />
              <Text style={styles.addSubtaskText}>Add subtask</Text>
            </TouchableOpacity>
          )}

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
        </View>
      )}
    </View>
  );
};

const createStyles = (theme) => StyleSheet.create({
  container: {
    backgroundColor: theme.colors.surfaceElevated,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  completed: {
    opacity: 0.6,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.sm,
    paddingLeft: theme.spacing.md,
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
  description: {
    fontSize: theme.typography.small,
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
    fontSize: theme.typography.small,
    color: theme.colors.textTertiary,
  },

  // Expanded section
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
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  subtaskLast: {
    borderBottomWidth: 0,
  },
  subtaskCheckbox: {
    marginRight: theme.spacing.sm,
  },
  subtaskText: {
    flex: 1,
    fontSize: theme.typography.small,
    color: theme.colors.textSecondary,
  },
  subtaskCompleted: {
    textDecorationLine: 'line-through',
    color: theme.colors.textTertiary,
  },
  subtaskActions: {
    flexDirection: 'row',
  },
  subtaskAction: {
    padding: theme.spacing.xs,
    marginLeft: theme.spacing.xs,
  },
  
  // Edit subtask
  editSubtaskRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  editSubtaskInput: {
    flex: 1,
    borderWidth: 0,
    borderRadius: 6,
    padding: 6,
    fontSize: theme.typography.small,
    color: theme.colors.inputText,
    marginRight: 8,
    backgroundColor: theme.colors.inputBackground,
  },

  // Add subtask
  addSubtaskTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    marginTop: 4,
  },
  addSubtaskText: {
    fontSize: theme.typography.small,
    color: theme.colors.textPrimary,
    marginLeft: 6,
  },
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
    fontSize: theme.typography.small,
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
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  completionText: {
    fontSize: theme.typography.small,
    color: theme.colors.textTertiary,
    marginLeft: 6,
    fontStyle: 'italic',
  },
  completionDone: {
    color: theme.colors.accentSuccess,
  },
});
