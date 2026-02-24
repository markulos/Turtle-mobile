import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Keyboard,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();
  const [newProjectName, setNewProjectName] = useState('');
  const [showAddInput, setShowAddInput] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setKeyboardHeight(e.endCoordinates.height)
    );
    const hideListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardHeight(0)
    );
    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, []);

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

  const handleSelect = (key) => {
    onSelect(key);
    onClose();
  };

  const items = [
    { key: 'All', icon: 'folder-open', label: 'All' },
    { key: 'No Project', icon: 'folder-off', label: 'No Project' },
    ...projects.map(p => ({ key: p, icon: 'folder', label: p }))
  ];

  const styles = createStyles(theme, insets);

  return (
    <View style={styles.container}>
      {/* Header with X button */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Select Project</Text>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Icon name="close" size={28} color={theme.colors.textPrimary} />
        </TouchableOpacity>
      </View>

        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        >
          {/* Project List */}
          {items.map(({ key, icon, label }) => (
            <TouchableOpacity
              key={key}
              style={[styles.item, selected === key && styles.itemActive]}
              onPress={() => handleSelect(key)}
            >
              <Icon name={icon} size={22} color={selected === key ? theme.colors.textPrimary : theme.colors.textSecondary} />
              <Text style={[styles.text, selected === key && styles.textActive]} numberOfLines={1}>
                {label}
              </Text>
              <Text style={styles.count}>{getCount(key)}</Text>
            </TouchableOpacity>
          ))}
          
          {/* Add Project Section */}
          {showAddInput ? (
            <View style={[styles.addInputRow, keyboardHeight > 0 && styles.addInputRowWithKeyboard]}>
              <TextInput
                style={styles.addInput}
                placeholder="New project name..."
                placeholderTextColor={theme.colors.textPlaceholder}
                value={newProjectName}
                onChangeText={setNewProjectName}
                onSubmitEditing={handleAddProject}
                autoFocus
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
              <Icon name="plus-circle" size={22} color={theme.colors.textPrimary} />
              <Text style={[styles.text, styles.addProjectText]}>Add New Project</Text>
            </TouchableOpacity>
          )}
          
          {/* Manage Projects */}
          <TouchableOpacity 
            style={[styles.item, styles.manageItem]}
            onPress={() => {
              onClose();
              onManage();
            }}
          >
            <Icon name="playlist-edit" size={22} color={theme.colors.textSecondary} />
            <Text style={[styles.text, styles.manageText]}>Edit Projects</Text>
          </TouchableOpacity>

          {/* Bottom padding for keyboard */}
          <View style={[styles.bottomPadding, { height: Math.max(20, keyboardHeight) }]} />
        </ScrollView>
    </View>
  );
};

const createStyles = (theme, insets) => StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.background,
    zIndex: 1000,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: insets.top + 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  closeBtn: {
    padding: 8,
    marginRight: -8,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  itemActive: { 
    backgroundColor: theme.colors.surfaceElevated,
  },
  text: { 
    flex: 1, 
    fontSize: theme.typography.body, 
    marginLeft: 12, 
    color: theme.colors.textPrimary,
  },
  textActive: { 
    color: theme.colors.textPrimary, 
    fontWeight: '600',
  },
  count: {
    fontSize: theme.typography.body,
    color: theme.colors.textMuted,
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    minWidth: 32,
    textAlign: 'center',
  },
  // Add project styles
  addProjectItem: {
    borderTopWidth: 8,
    borderTopColor: theme.colors.surface,
    backgroundColor: theme.colors.background,
  },
  addProjectText: {
    color: theme.colors.textPrimary,
    fontWeight: '500',
  },
  addInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderTopWidth: 8,
    borderTopColor: theme.colors.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  addInputRowWithKeyboard: {
    marginBottom: 20, // Extra breathing space when keyboard is active
  },
  addInput: {
    flex: 1,
    borderWidth: 0,
    borderRadius: 8,
    padding: 12,
    fontSize: theme.typography.body,
    backgroundColor: theme.colors.inputBackground,
    color: theme.colors.inputText,
    marginRight: 8,
  },
  addBtn: {
    backgroundColor: theme.colors.surfaceElevated,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  cancelAddBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  manageItem: {
    borderTopWidth: 8,
    borderTopColor: theme.colors.surface,
    backgroundColor: theme.colors.background,
  },
  manageText: {
    color: theme.colors.textSecondary,
  },
  bottomPadding: {
    // Height is set dynamically based on keyboard
  },
});
