import React, { useState, useRef, useEffect } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  TextInput, 
  StyleSheet, 
  Keyboard,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';

export const SectionHeader = ({ section, expandedTags, onToggleExpand, onAddTask }) => {
  const { theme } = useTheme();
  const [isAdding, setIsAdding] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const inputRef = useRef(null);

  // Removed auto-focus behavior - user must tap "Add a new task" to add tasks
  // Empty projects now show the "Add a new task" button like non-empty ones

  const styles = createStyles(theme);

  if (section.type === 'project') {
    const handleSubmit = () => {
      Keyboard.dismiss();
      if (!newTaskTitle.trim()) return;
      onAddTask(section.project, [], newTaskTitle.trim());
      setNewTaskTitle('');
      if (!section.isEmpty) {
        setIsAdding(false);
      }
    };

    const handleCancel = () => {
      Keyboard.dismiss();
      setNewTaskTitle('');
      if (!section.isEmpty) {
        setIsAdding(false);
      }
    };

    if (isAdding) {
      return (
        <View style={styles.inlineAddContainer}>
          <View style={styles.projectHeader}>
            <Icon name="folder" size={20} color={theme.colors.textPrimary} />
            <Text style={styles.projectText}>{section.title}</Text>
            {section.isEmpty && (
              <View style={styles.emptyBadge}>
                <Text style={styles.emptyBadgeText}>Empty</Text>
              </View>
            )}
          </View>
          <View style={styles.inlineInputRow}>
            <TextInput
              ref={inputRef}
              style={styles.inlineInput}
              placeholder="What needs to be done?"
              placeholderTextColor={theme.colors.textPlaceholder}
              value={newTaskTitle}
              onChangeText={setNewTaskTitle}
              onSubmitEditing={handleSubmit}
              blurOnSubmit={false}
              returnKeyType="done"
              autoFocus={false}
            />
            <TouchableOpacity style={styles.inlineSubmitBtn} onPress={handleSubmit}>
              <Icon name="check" size={18} color={theme.colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.inlineCancelBtn} onPress={handleCancel}>
              <Icon name="close" size={18} color={theme.colors.textTertiary} />
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return (
      <View>
        <View style={styles.projectHeader}>
          <Icon name="folder" size={20} color={theme.colors.textPrimary} />
          <Text style={styles.projectText}>{section.title}</Text>
          <Text style={styles.taskCount}>{section.taskCount || 0} tasks</Text>
        </View>
        <TouchableOpacity
          style={styles.addTaskRow}
          onPress={() => setIsAdding(true)}
        >
          <Icon name="plus-circle" size={18} color={theme.colors.textPrimary} />
          <Text style={styles.addTaskText}>Add a new task</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const tagKey = `${section.project}-${section.title}`;
  const isExpanded = expandedTags[tagKey] !== false;
  const allDone = section.completedCount === section.totalCount && section.totalCount > 0;

  const handleSubmit = () => {
    Keyboard.dismiss();
    if (!newTaskTitle.trim()) return;
    onAddTask(section.project, section.tags, newTaskTitle.trim());
    setNewTaskTitle('');
    setIsAdding(false);
  };

  const handleCancel = () => {
    Keyboard.dismiss();
    setNewTaskTitle('');
    setIsAdding(false);
  };

  if (isAdding) {
    return (
      <View style={styles.inlineAddContainer}>
        <View style={styles.inlineInputRow}>
          <TextInput
            ref={inputRef}
            style={styles.inlineInput}
            placeholder="What needs to be done?"
            placeholderTextColor={theme.colors.textPlaceholder}
            value={newTaskTitle}
            onChangeText={setNewTaskTitle}
            onSubmitEditing={handleSubmit}
            blurOnSubmit={false}
            returnKeyType="done"
          />
          <TouchableOpacity style={styles.inlineSubmitBtn} onPress={handleSubmit}>
            <Icon name="check" size={18} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.inlineCancelBtn} onPress={handleCancel}>
            <Icon name="close" size={18} color={theme.colors.textTertiary} />
          </TouchableOpacity>
        </View>
        <View style={styles.inlineContext}>
          <Icon name="folder" size={12} color={theme.colors.textTertiary} />
          <Text style={styles.inlineContextText}>{section.project}</Text>
          {section.tags?.length > 0 && (
            <>
              <Text style={styles.inlineSeparator}>•</Text>
              <Icon name="tag" size={12} color={theme.colors.textSecondary} />
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
          color={allDone ? theme.colors.accentSuccess : theme.colors.textTertiary} 
        />
        <Text style={[styles.tagText, allDone && styles.tagTextCompleted]}>{section.title}</Text>
        <Text style={styles.count}>{section.completedCount}/{section.totalCount}</Text>
        {allDone && <Icon name="check-circle" size={16} color={theme.colors.accentSuccess} style={styles.check} />}
      </TouchableOpacity>
      
      {isExpanded && (
        <TouchableOpacity 
          style={styles.addTaskRow}
          onPress={() => setIsAdding(true)}
        >
          <Icon name="plus-circle" size={18} color={theme.colors.textPrimary} />
          <Text style={styles.addTaskText}>Add a new task</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const createStyles = (theme) => StyleSheet.create({
  projectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    paddingLeft: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  projectText: { 
    fontSize: theme.typography.body, 
    fontWeight: '700', 
    color: theme.colors.inputText, 
    marginLeft: theme.spacing.sm,
    flex: 1,
  },
  taskCount: {
    fontSize: theme.typography.small,
    color: theme.colors.textTertiary,
    backgroundColor: theme.colors.surfaceHighlight,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.pill,
  },
  emptyBadge: {
    backgroundColor: theme.colors.accentWarning,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.pill,
    marginLeft: theme.spacing.sm,
  },
  emptyBadgeText: {
    fontSize: theme.typography.small,
    color: '#000000',
    fontWeight: '600',
  },
  tagHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    padding: theme.spacing.sm,
    paddingLeft: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tagHeaderCompleted: { 
    backgroundColor: 'rgba(76, 175, 80, 0.1)' 
  },
  tagText: { 
    flex: 1, 
    fontSize: theme.typography.body, 
    fontWeight: '600', 
    color: theme.colors.textSecondary, 
    marginLeft: theme.spacing.sm 
  },
  tagTextCompleted: { 
    color: theme.colors.accentSuccess 
  },
  count: { 
    fontSize: theme.typography.small, 
    color: theme.colors.textTertiary, 
    marginRight: theme.spacing.sm 
  },
  check: { 
    marginLeft: theme.spacing.xs 
  },
  inlineAddContainer: {
    backgroundColor: theme.colors.surfaceElevated,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  inlineInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.md,
    paddingLeft: theme.spacing.md,
  },
  inlineInput: {
    flex: 1,
    backgroundColor: theme.colors.inputBackground,
    borderWidth: 0,
    borderRadius: 10,
    height: 40, // Match "add a new task" height
    paddingHorizontal: 12,
    fontSize: 15,
    color: theme.colors.textPrimary,
    marginRight: 10,
  },
  inlineSubmitBtn: {
    backgroundColor: theme.colors.surfaceElevated,
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: theme.spacing.sm,
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
    marginTop: -theme.spacing.xs,
    marginLeft: 2,
    paddingLeft: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  inlineContextText: {
    fontSize: theme.typography.small,
    color: theme.colors.textTertiary,
    marginLeft: 4,
  },
  inlineSeparator: {
    fontSize: theme.typography.small,
    color: theme.colors.textTertiary,
    marginHorizontal: 6,
  },
  addTaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    paddingVertical: theme.spacing.sm,
    paddingLeft: theme.spacing.md,
    paddingRight: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  addTaskText: {
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    marginLeft: theme.spacing.sm,
    fontWeight: '500',
  },
});
