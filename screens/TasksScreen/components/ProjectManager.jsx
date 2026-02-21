import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export const ProjectManager = ({ 
  visible, 
  onClose, 
  projects, 
  tasks, 
  onAdd, 
  onDelete 
}) => {
  const [newName, setNewName] = useState('');

  const handleAdd = () => {
    if (onAdd(newName)) setNewName('');
  };

  const confirmDelete = (name) => {
    const count = tasks.filter(t => t.project === name).length;
    Alert.alert(
      'Delete Project',
      count > 0 ? `"${name}" has ${count} tasks. What should happen to them?` : `Delete "${name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        ...(count > 0 ? [{
          text: 'Move to "No Project"',
          onPress: () => onDelete(name, { onMoveTasks: true })
        }] : []),
        {
          text: count > 0 ? 'Delete All' : 'Delete',
          style: 'destructive',
          onPress: () => onDelete(name, { onDeleteTasks: true })
        }
      ]
    );
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Manage Projects</Text>
            <TouchableOpacity onPress={onClose}>
              <Icon name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          <View style={styles.addRow}>
            <TextInput
              style={styles.input}
              placeholder="New project name..."
              value={newName}
              onChangeText={setNewName}
              onSubmitEditing={handleAdd}
            />
            <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
              <Icon name="plus" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          <ScrollView>
            {projects.map(item => (
              <View key={item} style={styles.listItem}>
                <View style={styles.info}>
                  <Icon name="folder" size={20} color="#4CAF50" />
                  <Text style={styles.name}>{item}</Text>
                  <Text style={styles.count}>
                    {tasks.filter(t => t.project === item).length} tasks
                  </Text>
                </View>
                <TouchableOpacity onPress={() => confirmDelete(item)} style={styles.deleteBtn}>
                  <Icon name="delete" size={20} color="#f44336" />
                </TouchableOpacity>
              </View>
            ))}
            {projects.length === 0 && (
              <Text style={styles.empty}>No projects yet. Create one above!</Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  content: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
    minHeight: 400,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#333' },
  addRow: { flexDirection: 'row', marginBottom: 20 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, fontSize: 16, marginRight: 10 },
  addBtn: { backgroundColor: '#4CAF50', width: 50, height: 50, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  listItem: { flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: '#f9f9f9', borderRadius: 10, marginBottom: 10 },
  info: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  name: { flex: 1, fontSize: 16, marginLeft: 10, color: '#333' },
  count: { fontSize: 12, color: '#999', backgroundColor: '#fff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  deleteBtn: { padding: 5 },
  empty: { textAlign: 'center', color: '#999', marginTop: 20, fontSize: 16 },
});