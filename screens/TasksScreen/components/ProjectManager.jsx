import React, { useState, useRef, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  Alert,
  StyleSheet,
  Platform,
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  Animated,
} from 'react-native';
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

  const handleAdd = () => {
    Keyboard.dismiss();
    if (onAdd(newName)) {
      setNewName('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const confirmDelete = (name) => {
    const projectTasks = tasks.filter(t => t.project === name);
    const taskCount = projectTasks.length;
    const subtaskCount = projectTasks.reduce(
      (sum, t) => sum + (t.subtasks ? t.subtasks.length : 0),
      0
    );

    let message;
    if (taskCount === 0) {
      message = `Delete "${name}"?`;
    } else {
      const taskWord = taskCount === 1 ? 'task' : 'tasks';
      const subtaskFragment = subtaskCount > 0
        ? ` and ${subtaskCount} subtask${subtaskCount === 1 ? '' : 's'}`
        : '';
      message = `"${name}" contains ${taskCount} ${taskWord}${subtaskFragment}. Deleting this project will permanently delete them. This cannot be undone.`;
    }

    Alert.alert(
      'Delete Project',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDelete(name, { onDeleteTasks: taskCount > 0 })
        }
      ]
    );
  };

  const styles = createStyles(theme);

  return (
    <Modal
      animationType="none"
      transparent
      visible={visible}
      onRequestClose={handleClose}
    >
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
        {/* Backdrop: sibling of the sheet, so its press handler can't steal
            touch events from the ScrollView inside the sheet. */}
        <Pressable style={styles.backdrop} onPress={handleClose} />

        <KeyboardAvoidingView
          style={styles.sheetWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          pointerEvents="box-none"
        >
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
                <Icon name="plus" size={22} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={true}
              nestedScrollEnabled
            >
              {projects.map(item => (
                <View key={item} style={styles.listItem}>
                  <Icon name="folder" size={20} color={theme.colors.textPrimary} style={styles.folderIcon} />
                  <Text style={styles.name} numberOfLines={1}>{item}</Text>
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
            </ScrollView>

            <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
              <Text style={styles.closeBtnText}>Close Edit</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
};

const createStyles = (theme) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  content: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
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
    fontSize: theme.typography.body, 
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
    paddingBottom: 10, 
    fontSize: theme.typography.body, 
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
    flexGrow: 0,
    flexShrink: 1,
    maxHeight: 350,
  },
  listContent: {
    paddingBottom: 12,
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
    fontSize: theme.typography.body, 
    color: theme.colors.textPrimary,
  },
  deleteBtn: { 
    padding: 5,
  },
  empty: { 
    textAlign: 'center', 
    color: theme.colors.textTertiary, 
    marginTop: 20, 
    fontSize: theme.typography.body 
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
    fontSize: theme.typography.body,
    fontWeight: '600',
  },
});
