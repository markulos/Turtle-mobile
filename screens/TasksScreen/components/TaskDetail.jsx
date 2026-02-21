import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { normalizeTags, getPriorityColor } from '../utils/taskHelpers';

export const TaskDetail = ({ 
  task, 
  visible, 
  onClose, 
  onEdit, 
  onToggleComplete, 
  onDelete,
  onTagPress 
}) => {
  if (!task) return null;

  const tags = normalizeTags(task.tags);

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <View style={styles.content}>
            <View style={styles.header}>
              <View style={[styles.badge, { backgroundColor: getPriorityColor(task.priority) }]}>
                <Text style={styles.badgeText}>{task.priority}</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Icon name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <Text style={styles.title}>{task.title}</Text>

            <View style={styles.meta}>
              {task.project && (
                <View style={styles.metaItem}>
                  <Icon name="folder" size={16} color="#4CAF50" />
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
                      <Icon name="tag" size={12} color="#2196F3" />
                      <Text style={styles.tagText}>{tag}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {task.dueDate && (
                <View style={styles.metaItem}>
                  <Icon name="calendar" size={16} color="#666" />
                  <Text style={styles.metaText}>Due: {task.dueDate}</Text>
                </View>
              )}

              <View style={styles.metaItem}>
                <Icon name="clock-outline" size={16} color="#666" />
                <Text style={styles.metaText}>
                  Created: {new Date(task.createdAt).toLocaleDateString()}
                </Text>
              </View>

              {task.completed && task.completedTime && (
                <View style={[styles.metaItem, styles.completedItem]}>
                  <Icon name="check-circle" size={16} color="#4CAF50" />
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

            <View style={styles.actions}>
              <TouchableOpacity style={[styles.actionBtn, styles.editBtn]} onPress={onEdit}>
                <Icon name="pencil" size={20} color="#fff" />
                <Text style={styles.actionText}>Edit</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.actionBtn, styles.completeBtn, task.completed && styles.uncompleteBtn]}
                onPress={onToggleComplete}
              >
                <Icon name={task.completed ? "checkbox-blank-outline" : "checkbox-marked"} size={20} color="#fff" />
                <Text style={styles.actionText}>
                  {task.completed ? 'Mark Incomplete' : 'Complete'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={onDelete}>
                <Icon name="delete" size={20} color="#fff" />
                <Text style={styles.actionText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  scrollView: { maxHeight: '80%' },
  scrollContent: { flexGrow: 1, justifyContent: 'flex-end' },
  content: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  closeBtn: { padding: 5 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#333', marginBottom: 15 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 20 },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    marginRight: 10,
    marginBottom: 5,
  },
  metaText: { fontSize: 13, color: '#666', marginLeft: 6 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', marginRight: 10, marginBottom: 5 },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 6,
    marginBottom: 4,
  },
  tagText: { fontSize: 12, color: '#2196F3', marginLeft: 4 },
  completedItem: { backgroundColor: '#e8f5e9' },
  completedText: { color: '#4CAF50' },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: '#999', marginBottom: 8, textTransform: 'uppercase' },
  description: { fontSize: 16, color: '#333', lineHeight: 22 },
  actions: { flexDirection: 'row', marginTop: 20, paddingTop: 20, borderTopWidth: 1, borderTopColor: '#eee' },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 10, marginHorizontal: 5 },
  editBtn: { backgroundColor: '#2196F3' },
  completeBtn: { backgroundColor: '#4CAF50' },
  uncompleteBtn: { backgroundColor: '#ff9800' },
  deleteBtn: { backgroundColor: '#f44336' },
  actionText: { color: '#fff', fontWeight: '600', marginLeft: 8 },
  badge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 15 },
  badgeText: { color: '#fff', fontWeight: '600', textTransform: 'uppercase', fontSize: 12 },
});