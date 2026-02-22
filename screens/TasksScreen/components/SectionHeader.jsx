import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export const SectionHeader = ({ section, expandedTags, onToggleExpand, onAddTask }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');

  if (section.type === 'project') {
    return (
      <View style={styles.projectHeader}>
        <Icon name="folder" size={20} color="#4CAF50" />
        <Text style={styles.projectText}>{section.title}</Text>
      </View>
    );
  }

  const tagKey = `${section.project}-${section.title}`;
  const isExpanded = expandedTags[tagKey] !== false;
  const allDone = section.completedCount === section.totalCount && section.totalCount > 0;

  const handleSubmit = () => {
    if (!newTaskTitle.trim()) return;
    onAddTask(section.project, section.tags, newTaskTitle.trim());
    setNewTaskTitle('');
    setIsAdding(false);
  };

  const handleCancel = () => {
    setNewTaskTitle('');
    setIsAdding(false);
  };

  // Inline input mode
  if (isAdding) {
    return (
      <View style={styles.inlineAddContainer}>
        <View style={styles.inlineInputRow}>
          <TextInput
            style={styles.inlineInput}
            placeholder="What needs to be done?"
            value={newTaskTitle}
            onChangeText={setNewTaskTitle}
            autoFocus
            onSubmitEditing={handleSubmit}
            blurOnSubmit={false}
          />
          <TouchableOpacity style={styles.inlineSubmitBtn} onPress={handleSubmit}>
            <Icon name="check" size={18} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.inlineCancelBtn} onPress={handleCancel}>
            <Icon name="close" size={18} color="#666" />
          </TouchableOpacity>
        </View>
        <View style={styles.inlineContext}>
          <Icon name="folder" size={12} color="#666" />
          <Text style={styles.inlineContextText}>{section.project}</Text>
          {section.tags?.length > 0 && (
            <>
              <Text style={styles.inlineSeparator}>•</Text>
              <Icon name="tag" size={12} color="#2196F3" />
              <Text style={styles.inlineContextText}>{section.tags.join(', ')}</Text>
            </>
          )}
        </View>
      </View>
    );
  }

  return (
    <View>
      <TouchableOpacity 
        style={[styles.tagHeader, allDone && styles.tagHeaderCompleted]}
        onPress={() => onToggleExpand(tagKey)}
      >
        <Icon 
          name={isExpanded ? "chevron-down" : "chevron-right"} 
          size={20} 
          color={allDone ? "#4CAF50" : "#666"} 
        />
        <Text style={[styles.tagText, allDone && styles.tagTextCompleted]}>{section.title}</Text>
        <Text style={styles.count}>{section.completedCount}/{section.totalCount}</Text>
        {allDone && <Icon name="check-circle" size={16} color="#4CAF50" style={styles.check} />}
      </TouchableOpacity>
      
      {/* Add task button - now just initiates inline input */}
      {isExpanded && (
        <TouchableOpacity 
          style={styles.addTaskRow}
          onPress={() => setIsAdding(true)}
        >
          <Icon name="plus-circle" size={18} color="#4CAF50" />
          <Text style={styles.addTaskText}>Add a new task</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  projectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e3f2fd',
    padding: 12,
    paddingLeft: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#bbdefb',
  },
  projectText: { 
    fontSize: 16, 
    fontWeight: 'bold', 
    color: '#1976d2', 
    marginLeft: 10 
  },
  tagHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    paddingLeft: 25,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  tagHeaderCompleted: { 
    backgroundColor: '#f1f8e9' 
  },
  tagText: { 
    flex: 1, 
    fontSize: 15, 
    fontWeight: '600', 
    color: '#333', 
    marginLeft: 8 
  },
  tagTextCompleted: { 
    color: '#4CAF50' 
  },
  count: { 
    fontSize: 12, 
    color: '#999', 
    marginRight: 8 
  },
  check: { 
    marginLeft: 5 
  },
  // Inline add styles
  inlineAddContainer: {
    backgroundColor: '#f9f9f9',
    padding: 12,
    paddingLeft: 50,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  inlineInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inlineInput: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#4CAF50',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    marginRight: 8,
  },
  inlineSubmitBtn: {
    backgroundColor: '#4CAF50',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  inlineCancelBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inlineContext: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginLeft: 2,
  },
  inlineContextText: {
    fontSize: 11,
    color: '#999',
    marginLeft: 4,
  },
  inlineSeparator: {
    fontSize: 11,
    color: '#999',
    marginHorizontal: 6,
  },
  // Regular add button
  addTaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9f9f9',
    paddingVertical: 10,
    paddingLeft: 50,
    paddingRight: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  addTaskText: {
    fontSize: 14,
    color: '#4CAF50',
    marginLeft: 8,
    fontWeight: '500',
  },
});