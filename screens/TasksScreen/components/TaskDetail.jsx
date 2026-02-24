import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Animated,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { normalizeTags, getPriorityColor, areAllSubtasksCompleted } from '../utils/taskHelpers';

export const TaskDetail = ({ 
  task, 
  visible, 
  onClose, 
  onEdit, 
  onToggleComplete, 
  onDelete,
  onTagPress,
  onToggleSubtask
}) => {
  const { theme } = useTheme();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [isClosing, setIsClosing] = useState(false);
  
  useEffect(() => {
    if (visible) {
      setIsClosing(false);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else if (isClosing) {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        setIsClosing(false);
      });
    }
  }, [visible, isClosing, fadeAnim]);
  
  const handleClose = () => {
    setIsClosing(true);
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };
  
  if (!task) return null;

  // Ensure subtasks exists
  const subtasks = task.subtasks || [];
  const tags = normalizeTags(task.tags);
  const allSubtasksDone = areAllSubtasksCompleted(subtasks);
  const completedSubtasks = subtasks.filter(st => st.completed).length;

  const styles = createStyles(theme);

  return (
    <Modal animationType="none" transparent visible={visible} onRequestClose={handleClose}>
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <View style={styles.content}>
            <View style={styles.header}>
              <View style={[styles.badge, { backgroundColor: getPriorityColor(task.priority, theme) }]}>
                <Text style={styles.badgeText}>{task.priority}</Text>
              </View>
              <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
                <Icon name="close" size={24} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.title}>{task.title}</Text>

            {/* Subtasks progress */}
            {subtasks.length > 0 && (
              <View style={styles.subtaskSection}>
                <View style={styles.subtaskHeader}>
                  <Text style={styles.subtaskTitle}>Subtasks</Text>
                  <Text style={styles.subtaskCount}>
                    {completedSubtasks}/{subtasks.length}
                  </Text>
                </View>
                <View style={styles.progressBar}>
                  <View 
                    style={[
                      styles.progressFill, 
                      { width: `${(completedSubtasks / subtasks.length) * 100}%` }
                    ]} 
                  />
                </View>
                {allSubtasksDone && (
                  <Text style={styles.allDoneText}>All subtasks completed!</Text>
                )}
              </View>
            )}

            <View style={styles.meta}>
              {task.project && (
                <View style={styles.metaItem}>
                  <Icon name="folder" size={16} color={theme.colors.textPrimary} />
                  <Text style={styles.metaText}>{task.project}</Text>
                </View>
              )}

              {tags.length > 0 && (
                <View style={styles.tagsRow}>
                  {tags.map((tag, idx) => (
                    <TouchableOpacity 
                      key={idx} 
                      style={styles.tagChip}
                      onPress={() => { onClose(); onTagPress(tag); }}
                    >
                      <Icon name="tag" size={12} color={theme.colors.textPrimary} />
                      <Text style={styles.tagText}>{tag}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {task.dueDate && (
                <View style={styles.metaItem}>
                  <Icon name="calendar" size={16} color={theme.colors.textSecondary} />
                  <Text style={styles.metaText}>Due: {task.dueDate}</Text>
                </View>
              )}

              <View style={styles.metaItem}>
                <Icon name="clock-outline" size={16} color={theme.colors.textSecondary} />
                <Text style={styles.metaText}>
                  Created: {new Date(task.createdAt).toLocaleDateString()}
                </Text>
              </View>

              {task.completed && task.completedTime && (
                <View style={[styles.metaItem, styles.completedItem]}>
                  <Icon name="check-circle" size={16} color={theme.colors.accentSuccess} />
                  <Text style={[styles.metaText, styles.completedText]}>
                    Done: {new Date(task.completedTime).toLocaleString()}
                  </Text>
                </View>
              )}
            </View>

            {task.description && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Description</Text>
                <Text style={styles.description}>{task.description}</Text>
              </View>
            )}

            {/* Subtasks list in detail */}
            {subtasks.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Subtasks</Text>
                {subtasks.map((subtask, idx) => (
                  <TouchableOpacity 
                    key={subtask.id} 
                    style={styles.subtaskRow}
                    onPress={() => onToggleSubtask?.(task.id, subtask.id)}
                    activeOpacity={0.7}
                  >
                    <Icon 
                      name={subtask.completed ? "checkbox-marked" : "checkbox-blank-outline"} 
                      size={18} 
                      color={subtask.completed ? theme.colors.accentSuccess : theme.colors.textSecondary} 
                    />
                    <Text style={[
                      styles.subtaskText,
                      subtask.completed && styles.subtaskCompleted
                    ]}>
                      {subtask.title}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={styles.actions}>
              <TouchableOpacity style={[styles.actionBtn, styles.editBtn]} onPress={onEdit}>
                <Icon name="pencil" size={20} color={theme.colors.textPrimary} />
                <Text style={styles.actionText}>Edit</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.actionBtn, styles.completeBtn, task.completed && styles.uncompleteBtn]}
                onPress={onToggleComplete}
              >
                <Icon 
                  name={task.completed ? "checkbox-blank-outline" : "checkbox-marked"} 
                  size={20} 
                  color={theme.colors.textPrimary} 
                />
                <Text style={styles.actionText}>
                  {task.completed ? 'Mark Incomplete' : 'Complete'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={onDelete}>
                <Icon name="delete" size={20} color={theme.colors.textPrimary} />
                <Text style={styles.actionText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
};

const createStyles = (theme) => StyleSheet.create({
  overlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0, 0, 0, 0.5)', 
    justifyContent: 'flex-end' 
  },
  scrollView: { 
    maxHeight: '80%' 
  },
  scrollContent: { 
    flexGrow: 1, 
    justifyContent: 'flex-end' 
  },
  content: { 
    backgroundColor: theme.colors.background, 
    borderTopLeftRadius: 20, 
    borderTopRightRadius: 20, 
    padding: 20 
  },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 15 
  },
  closeBtn: { 
    padding: 5 
  },
  title: { 
    fontSize: theme.typography.body, 
    fontWeight: 'bold', 
    color: theme.colors.textPrimary, 
    marginBottom: 15 
  },
  
  // Subtask section
  subtaskSection: {
    backgroundColor: theme.colors.surfaceElevated,
    padding: 12,
    borderRadius: 10,
    marginBottom: 15,
  },
  subtaskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  subtaskTitle: {
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  subtaskCount: {
    fontSize: theme.typography.body,
    color: theme.colors.textSecondary,
  },
  progressBar: {
    height: 4,
    backgroundColor: theme.colors.surfaceHighlight,
    borderRadius: 2,
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.textSecondary,
    borderRadius: 2,
  },
  allDoneText: {
    fontSize: theme.typography.body,
    color: theme.colors.accentSuccess,
    marginTop: 8,
    fontStyle: 'italic',
  },
  
  badge: { 
    paddingHorizontal: 12, 
    paddingVertical: 6, 
    borderRadius: 15 
  },
  badgeText: { 
    color: theme.colors.textPrimary, 
    fontWeight: '600', 
    textTransform: 'uppercase', 
    fontSize: theme.typography.body 
  },
  
  meta: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    marginBottom: 20 
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    marginRight: 10,
    marginBottom: 5,
  },
  metaText: { 
    fontSize: theme.typography.body, 
    color: theme.colors.textSecondary, 
    marginLeft: 6 
  },
  tagsRow: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    marginRight: 10, 
    marginBottom: 5 
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 6,
    marginBottom: 4,
  },
  tagText: { 
    fontSize: theme.typography.body, 
    color: theme.colors.textPrimary, 
    marginLeft: 4 
  },
  completedItem: { 
    backgroundColor: theme.colors.surfaceHighlight 
  },
  completedText: { 
    color: theme.colors.accentSuccess 
  },
  
  section: { 
    marginBottom: 20 
  },
  sectionTitle: { 
    fontSize: theme.typography.body, 
    fontWeight: '600', 
    color: theme.colors.textSecondary, 
    marginBottom: 8, 
    textTransform: 'uppercase' 
  },
  description: { 
    fontSize: theme.typography.body, 
    color: theme.colors.textPrimary, 
    lineHeight: 22 
  },
  
  // Subtasks in detail
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  subtaskText: {
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    marginLeft: 8,
  },
  subtaskCompleted: {
    textDecorationLine: 'line-through',
    color: theme.colors.textMuted,
  },
  
  actions: { 
    flexDirection: 'row', 
    marginTop: 20, 
    paddingTop: 20, 
    borderTopWidth: 1, 
    borderTopColor: theme.colors.border 
  },
  actionBtn: { 
    flex: 1, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    padding: 12, 
    borderRadius: 10, 
    marginHorizontal: 5,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  editBtn: { 
    backgroundColor: theme.colors.surfaceElevated 
  },
  completeBtn: { 
    backgroundColor: theme.colors.surfaceElevated 
  },
  uncompleteBtn: { 
    backgroundColor: theme.colors.surfaceHighlight 
  },
  deleteBtn: { 
    backgroundColor: theme.colors.surfaceElevated 
  },
  actionText: { 
    color: theme.colors.textPrimary, 
    fontWeight: '600', 
    marginLeft: 8 
  },
});
