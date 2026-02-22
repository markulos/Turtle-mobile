import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';

export const ProjectDropdown = ({ 
  visible, 
  onClose, 
  projects, 
  tasks, 
  selected, 
  onSelect, 
  onManage,
  onAddProject
}) => {
  const { theme } = useTheme();
  const [newProjectName, setNewProjectName] = useState('');
  const [showAddInput, setShowAddInput] = useState(false);

  if (!visible) return null;
  
  const getCount = (project) => {
    if (project === 'All') return tasks.length;
    if (project === 'No Project') return tasks.filter(t => !t.project).length;
    return tasks.filter(t => t.project === project).length;
  };

  const handleAddProject = () => {
    if (!newProjectName.trim()) return;
    onAddProject(newProjectName.trim());
    setNewProjectName('');
    setShowAddInput(false);
  };

  const items = [
    { key: 'All', icon: 'folder-open', label: 'All Projects' },
    { key: 'No Project', icon: 'folder-off', label: 'No Project' },
    ...projects.map(p => ({ key: p, icon: 'folder', label: p }))
  ];

  const styles = createStyles(theme);

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} onPress={onClose}>
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
        >
          <View style={styles.menu}>
            {items.map(({ key, icon, label }) => (
              <TouchableOpacity
                key={key}
                style={[styles.item, selected === key && styles.itemActive]}
                onPress={() => { onSelect(key); onClose(); }}
              >
                <Icon name={icon} size={20} color={selected === key ? theme.colors.textPrimary : theme.colors.textSecondary} />
                <Text style={[styles.text, selected === key && styles.textActive]} numberOfLines={1}>
                  {label}
                </Text>
                <Text style={styles.count}>{getCount(key)}</Text>
              </TouchableOpacity>
            ))}
            
            {/* Inline add project */}
            {showAddInput ? (
              <View style={styles.addInputRow}>
                <TextInput
                  style={styles.addInput}
                  placeholder="New project name..."
                  placeholderTextColor={theme.colors.textPlaceholder}
                  value={newProjectName}
                  onChangeText={setNewProjectName}
                  onSubmitEditing={handleAddProject}
                />
                <TouchableOpacity style={styles.addBtn} onPress={handleAddProject}>
                  <Icon name="check" size={20} color={theme.colors.textPrimary} />
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.cancelAddBtn} 
                  onPress={() => {
                    setShowAddInput(false);
                    setNewProjectName('');
                  }}
                >
                  <Icon name="close" size={20} color={theme.colors.textSecondary} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity 
                style={[styles.item, styles.addProjectItem]}
                onPress={() => setShowAddInput(true)}
              >
                <Icon name="plus-circle" size={20} color={theme.colors.textPrimary} />
                <Text style={[styles.text, styles.addProjectText]}>Add New Project</Text>
              </TouchableOpacity>
            )}
            
            <TouchableOpacity 
              style={[styles.item, styles.manageItem]}
              onPress={() => {
                onClose();
                onManage();
              }}
            >
              <Icon name="playlist-edit" size={20} color={theme.colors.textSecondary} />
              <Text style={[styles.text, styles.manageText]}>Edit Projects</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </TouchableOpacity>
    </Modal>
  );
};

const createStyles = (theme) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: theme.colors.overlay,
    justifyContent: 'flex-start',
    paddingTop: 70,
    paddingHorizontal: 15,
  },
  keyboardView: {
    width: '100%',
  },
  menu: {
    backgroundColor: theme.colors.background,
    borderRadius: 12,
    paddingVertical: 8,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  itemActive: { 
    backgroundColor: theme.colors.surfaceElevated 
  },
  text: { 
    flex: 1, 
    fontSize: 16, 
    marginLeft: 12, 
    color: theme.colors.textPrimary 
  },
  textActive: { 
    color: theme.colors.textPrimary, 
    fontWeight: '600' 
  },
  count: {
    fontSize: 14,
    color: theme.colors.textMuted,
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  // Add project styles
  addProjectItem: {
    borderTopWidth: 0.5,
    borderTopColor: theme.colors.border,
  },
  addProjectText: {
    color: theme.colors.textPrimary,
  },
  addInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderTopWidth: 0.5,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  addInput: {
    flex: 1,
    borderWidth: 0,
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
    backgroundColor: theme.colors.inputBackground,
    color: theme.colors.inputText,
    marginRight: 8,
  },
  addBtn: {
    backgroundColor: theme.colors.surfaceElevated,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  cancelAddBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  manageItem: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    marginTop: 5,
  },
  manageText: {
    color: theme.colors.textSecondary,
  },
});
