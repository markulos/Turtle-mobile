import React, { useState, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Platform,
  Keyboard,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';

export const ProjectManager = ({ 
  visible, 
  onClose, 
  projects, 
  tasks, 
  onAdd, 
  onDelete 
}) => {
  const { theme } = useTheme();
  const [newName, setNewName] = useState('');
  const inputRef = useRef(null);

  const handleAdd = () => {
    Keyboard.dismiss();
    if (onAdd(newName)) {
      setNewName('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const confirmDelete = (name) => {
    const count = tasks.filter(t => t.project === name).length;
    Alert.alert(
      'Delete Project',
      count > 0 
        ? `"${name}" has ${count} tasks. Are you sure you want to delete this project? The tasks will be moved to "No Project".`
        : `Delete "${name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDelete(name, { onMoveTasks: count > 0 })
        }
      ]
    );
  };

  const styles = createStyles(theme);

  return (
    <Modal 
      animationType="slide" 
      transparent 
      visible={visible} 
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Edit Projects</Text>
          </View>

          <View style={styles.addRow}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="New project name..."
              placeholderTextColor={theme.colors.textPlaceholder}
              value={newName}
              onChangeText={setNewName}
              onSubmitEditing={handleAdd}
              returnKeyType="done"
              blurOnSubmit={false}
            />
            <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
              <Icon name="plus" size={22} color={theme.colors.background} />
            </TouchableOpacity>
          </View>

          <KeyboardAwareScrollView
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={true}
          >
            {projects.map(item => (
              <View key={item} style={styles.listItem}>
                <Icon name="folder" size={20} color={theme.colors.textPrimary} style={styles.folderIcon} />
                <Text style={styles.name}>{item}</Text>
                <TouchableOpacity 
                  onPress={() => confirmDelete(item)} 
                  style={styles.deleteBtn}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Icon name="close-circle" size={22} color={theme.colors.accentError} />
                </TouchableOpacity>
              </View>
            ))}
            {projects.length === 0 && (
              <Text style={styles.empty}>No projects yet. Create one above!</Text>
            )}
            <View style={styles.bottomPadding} />
          </KeyboardAwareScrollView>

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Close Edit</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const createStyles = (theme) => StyleSheet.create({
  overlay: { 
    flex: 1, 
    backgroundColor: theme.colors.overlay, 
    justifyContent: 'flex-end' 
  },
  content: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20, // iPhone safe area
    maxHeight: '85%',
    minHeight: 400,
  },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginBottom: 16 
  },
  title: { 
    fontSize: 18, 
    fontWeight: '700', 
    color: theme.colors.textPrimary 
  },
  addRow: { 
    flexDirection: 'row', 
    marginBottom: 16 
  },
  input: { 
    flex: 1, 
    borderWidth: 0, 
    borderRadius: 10, 
    height: 44,
    paddingHorizontal: 14, 
    fontSize: 15, 
    marginRight: 10,
    backgroundColor: theme.colors.inputBackground,
    color: theme.colors.inputText,
  },
  addBtn: { 
    backgroundColor: theme.colors.surfaceElevated, 
    width: 44, 
    height: 44, 
    borderRadius: 10, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  list: {
    maxHeight: 350,
  },
  listItem: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingVertical: 12,
    paddingHorizontal: 12, 
    backgroundColor: theme.colors.surface, 
    borderRadius: 10, 
    marginBottom: 8,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  folderIcon: {
    marginRight: 12,
  },
  name: { 
    flex: 1, 
    fontSize: 15, 
    color: theme.colors.textPrimary,
  },
  deleteBtn: { 
    padding: 5,
  },
  empty: { 
    textAlign: 'center', 
    color: theme.colors.textTertiary, 
    marginTop: 20, 
    fontSize: 15 
  },
  closeBtn: {
    backgroundColor: theme.colors.surfaceElevated,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
    height: 44,
  },
  closeBtnText: {
    color: theme.colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  bottomPadding: {
    height: 20,
  },
});
