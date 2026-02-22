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

  const height = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 'auto']
  });

  const opacity = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1]
  });

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
            // Only toggle if no subtasks or all subtasks done manually
            onToggleComplete(item.id); 
          }}
        >
          <Icon 
            name={item.completed ? "checkbox-marked" : "checkbox-blank-circle-outline"} 
            size={20} 
            color={item.completed ? "#4CAF50" : "#ccc"} 
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
          <View style={[styles.priorityDot, { backgroundColor: getPriorityColor(item.priority) }]} />
          
          {/* Expand/chevron for subtasks */}
          {subtasks.length > 0 && (
            <TouchableOpacity 
              style={styles.expandBtn}
              onPress={(e) => { e.stopPropagation(); toggleExpand(); }}
            >
              <Icon 
                name={expanded ? "chevron-up" : "chevron-down"} 
                size={20} 
                color="#666" 
              />
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>

      {/* Expanded subtasks section */}
      {expanded && (
        <View style={styles.expandedContent}>
          {/* Subtasks list */}
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
                  color={subtask.completed ? "#4CAF50" : "#ccc"} 
                />
              </TouchableOpacity>
              
              {editingSubtaskId === subtask.id ? (
                <View style={styles.editSubtaskRow}>
                  <TextInput
                    style={styles.editSubtaskInput}
                    value={editSubtaskTitle}
                    onChangeText={setEditSubtaskTitle}
                    autoFocus
                    onSubmitEditing={saveEditSubtask}
                  />
                  <TouchableOpacity onPress={saveEditSubtask}>
                    <Icon name="check" size={18} color="#4CAF50" />
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
                      <Icon name="pencil" size={16} color="#666" />
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={styles.subtaskAction}
                      onPress={() => onDeleteSubtask(item.id, subtask.id)}
                    >
                      <Icon name="delete" size={16} color="#f44336" />
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
                value={newSubtaskTitle}
                onChangeText={setNewSubtaskTitle}
                autoFocus
                onSubmitEditing={handleAddSubtask}
              />
              <TouchableOpacity style={styles.addSubtaskBtn} onPress={handleAddSubtask}>
                <Icon name="check" size={18} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.cancelSubtaskBtn}
                onPress={() => {
                  setShowAddSubtask(false);
                  setNewSubtaskTitle('');
                }}
              >
                <Icon name="close" size={18} color="#666" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity 
              style={styles.addSubtaskTrigger}
              onPress={() => setShowAddSubtask(true)}
            >
              <Icon name="plus" size={16} color="#4CAF50" />
              <Text style={styles.addSubtaskText}>Add subtask</Text>
            </TouchableOpacity>
          )}

          {/* Completion status */}
          {subtasks.length > 0 && (
            <View style={styles.completionStatus}>
              <Icon 
                name={allSubtasksDone ? "check-circle" : "progress-clock"} 
                size={14} 
                color={allSubtasksDone ? "#4CAF50" : "#ff9800"} 
              />
              <Text style={[
                styles.completionText,
                allSubtasksDone && styles.completionDone
              ]}>
                {allSubtasksDone 
                  ? 'All subtasks completed - task will auto-complete' 
                  : `${completedSubtasks} of ${subtasks.length} subtasks done`}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fafafa',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  completed: {
    opacity: 0.7,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    paddingLeft: 45,
  },
  checkbox: {
    marginRight: 10,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    color: '#333',
  },
  description: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  completedText: {
    textDecorationLine: 'line-through',
    color: '#999',
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  expandBtn: {
    padding: 4,
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
    backgroundColor: '#e0e0e0',
    borderRadius: 2,
    marginRight: 8,
    maxWidth: 60,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
    borderRadius: 2,
  },
  subtaskCount: {
    fontSize: 11,
    color: '#999',
  },

  // Expanded section
  expandedContent: {
    paddingLeft: 75,
    paddingRight: 15,
    paddingBottom: 10,
    backgroundColor: '#f5f5f5',
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  subtaskLast: {
    borderBottomWidth: 0,
  },
  subtaskCheckbox: {
    marginRight: 10,
  },
  subtaskText: {
    flex: 1,
    fontSize: 13,
    color: '#333',
  },
  subtaskCompleted: {
    textDecorationLine: 'line-through',
    color: '#999',
  },
  subtaskActions: {
    flexDirection: 'row',
  },
  subtaskAction: {
    padding: 4,
    marginLeft: 8,
  },
  
  // Edit subtask
  editSubtaskRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  editSubtaskInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    padding: 6,
    fontSize: 13,
    marginRight: 8,
    backgroundColor: '#fff',
  },

  // Add subtask
  addSubtaskTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 5,
  },
  addSubtaskText: {
    fontSize: 13,
    color: '#4CAF50',
    marginLeft: 6,
  },
  addSubtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    marginTop: 5,
  },
  addSubtaskInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#4CAF50',
    borderRadius: 6,
    padding: 8,
    fontSize: 13,
    marginRight: 8,
    backgroundColor: '#fff',
  },
  addSubtaskBtn: {
    backgroundColor: '#4CAF50',
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
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  completionText: {
    fontSize: 11,
    color: '#666',
    marginLeft: 6,
    fontStyle: 'italic',
  },
  completionDone: {
    color: '#4CAF50',
  },
});