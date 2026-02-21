import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { getPriorityColor } from '../utils/taskHelpers';

export const TaskItem = ({ item, onPress, onToggleComplete }) => (
  <TouchableOpacity 
    style={[styles.container, item.completed && styles.completed]}
    onPress={() => onPress(item)}
  >
    <TouchableOpacity 
      style={styles.checkbox}
      onPress={(e) => { e.stopPropagation(); onToggleComplete(item.id); }}
    >
      <Icon 
        name={item.completed ? "checkbox-marked" : "checkbox-blank-circle-outline"} 
        size={20} 
        color={item.completed ? "#4CAF50" : "#ccc"} 
      />
    </TouchableOpacity>
    
    <View style={styles.content}>
      <Text style={[styles.title, item.completed && styles.completedText]}>{item.title}</Text>
      {item.description && (
        <Text style={styles.description} numberOfLines={1}>{item.description.split('\n')[0]}</Text>
      )}
    </View>
    
    <View style={[styles.priorityDot, { backgroundColor: getPriorityColor(item.priority) }]} />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fafafa',
    padding: 10,
    paddingLeft: 45,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  completed: { opacity: 0.7 },
  checkbox: { marginRight: 10 },
  content: { flex: 1 },
  title: { fontSize: 14, color: '#333' },
  description: { fontSize: 12, color: '#999', marginTop: 2 },
  priorityDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 8 },
  completedText: { textDecorationLine: 'line-through', color: '#999' },
});