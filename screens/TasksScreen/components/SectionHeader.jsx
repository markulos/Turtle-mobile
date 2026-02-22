import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export const SectionHeader = ({ section, expandedTags, onToggleExpand, onAddTask }) => {
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

  return (
    <View>
      <TouchableOpacity 
        style={[styles.tagHeader, allDone && styles.tagHeaderCompleted]}
        onPress={() => onToggleExpand(tagKey)}
      >
        <Icon name={isExpanded ? "chevron-down" : "chevron-right"} size={20} color={allDone ? "#4CAF50" : "#666"} />
        <Text style={[styles.tagText, allDone && styles.tagTextCompleted]}>{section.title}</Text>
        <Text style={styles.count}>{section.completedCount}/{section.totalCount}</Text>
        {allDone && <Icon name="check-circle" size={16} color="#4CAF50" style={styles.check} />}
      </TouchableOpacity>
      
      {isExpanded && (
        <TouchableOpacity 
          style={styles.addTaskRow}
          onPress={() => {
            console.log('Adding task with:', { project: section.project, tags: section.tags });
            onAddTask(section.project, section.tags);
          }}
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
  projectText: { fontSize: 16, fontWeight: 'bold', color: '#1976d2', marginLeft: 10 },
  tagHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    paddingLeft: 25,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  tagHeaderCompleted: { backgroundColor: '#f1f8e9' },
  tagText: { flex: 1, fontSize: 15, fontWeight: '600', color: '#333', marginLeft: 8 },
  tagTextCompleted: { color: '#4CAF50' },
  count: { fontSize: 12, color: '#999', marginRight: 8 },
  check: { marginLeft: 5 },
  // NEW: Add task button styles
  addTaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9f9f9',
    paddingVertical: 8,
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