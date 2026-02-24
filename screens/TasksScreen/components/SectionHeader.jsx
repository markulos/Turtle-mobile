import React, { useState, useRef } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  TextInput,
  StyleSheet,
  Keyboard,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';

// Pastel colors for tags
const tagColors = [
  { bg: '#E3F2FD', text: '#1565C0' }, // Blue
  { bg: '#F3E5F5', text: '#7B1FA2' }, // Purple
  { bg: '#E8F5E9', text: '#2E7D32' }, // Green
  { bg: '#FFF3E0', text: '#E65100' }, // Orange
  { bg: '#FCE4EC', text: '#C2185B' }, // Pink
  { bg: '#E0F2F1', text: '#00695C' }, // Teal
  { bg: '#FFF8E1', text: '#F57F17' }, // Yellow
  { bg: '#F3E5F5', text: '#6A1B9A' }, // Deep Purple
  { bg: '#ECEFF1', text: '#455A64' }, // Blue Grey
  { bg: '#E8EAF6', text: '#303F9F' }, // Indigo
];

const getTagColor = (tag, index) => {
  const colorIndex = index % tagColors.length;
  return tagColors[colorIndex];
};

/**
 * SectionHeader for Tag Groups (nested under collapsible projects)
 * Projects are handled directly in TasksScreen
 */
export const SectionHeader = ({ section, expanded, onToggleExpand, onAddTask, onRenameTag, onAddTagToSection, projectColor }) => {
  const { theme } = useTheme();
  const [isAdding, setIsAdding] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [editingTag, setEditingTag] = useState(null);
  const [editTagValue, setEditTagValue] = useState('');
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagValue, setNewTagValue] = useState('');
  const inputRef = useRef(null);
  const tagInputRef = useRef(null);
  const newTagInputRef = useRef(null);
  
  const styles = createStyles(theme);
  const allDone = section.completedCount === section.totalCount && section.totalCount > 0;

  const handleSubmit = () => {
    Keyboard.dismiss();
    if (!newTaskTitle.trim()) return;
    // Automatically include the tag(s) from this section
    onAddTask(section.project, section.tags, newTaskTitle.trim());
    setNewTaskTitle('');
    setIsAdding(false);
  };

  const handleCancel = () => {
    Keyboard.dismiss();
    setNewTaskTitle('');
    setIsAdding(false);
  };
  
  // Handle blur with delay to allow button presses first
  const handleBlur = () => {
    setTimeout(() => {
      setNewTaskTitle('');
      setIsAdding(false);
    }, 200);
  };

  const handleStartEditTag = (tag) => {
    setEditingTag(tag);
    setEditTagValue(tag);
  };

  const handleSaveTag = () => {
    if (!editTagValue.trim() || editTagValue.trim() === editingTag) {
      setEditingTag(null);
      setEditTagValue('');
      return;
    }
    onRenameTag?.(section.project, editingTag, editTagValue.trim());
    setEditingTag(null);
    setEditTagValue('');
  };

  const handleCancelEditTag = () => {
    setEditingTag(null);
    setEditTagValue('');
  };

  const handleStartAddTag = () => {
    setIsAddingTag(true);
    setNewTagValue('');
  };

  const handleSaveNewTag = () => {
    if (!newTagValue.trim()) {
      setIsAddingTag(false);
      return;
    }
    onAddTagToSection?.(section.project, section.tags, newTagValue.trim());
    setIsAddingTag(false);
    setNewTagValue('');
  };

  const handleCancelAddTag = () => {
    setIsAddingTag(false);
    setNewTagValue('');
  };

  return (
    <View>
      <TouchableOpacity 
        style={[styles.tagHeader, allDone && styles.tagHeaderCompleted]}
        onPress={onToggleExpand}
      >
        <Icon 
          name={expanded ? "chevron-down" : "chevron-right"} 
          size={20} 
          color={projectColor || (allDone ? theme.colors.accentSuccess : theme.colors.textTertiary)} 
        />
        
        {/* Tag chips */}
        <View style={styles.tagsContainer}>
          {section.tags && section.tags.length > 0 ? (
            section.tags.map((tag, index) => {
              const colors = getTagColor(tag, index);
              const isEditing = editingTag === tag;
              
              if (isEditing) {
                return (
                  <View key={tag} style={[styles.tagChipEdit, { backgroundColor: colors.bg }]}>
                    <TextInput
                      ref={tagInputRef}
                      style={[styles.tagChipInput, { color: colors.text }]}
                      value={editTagValue}
                      onChangeText={setEditTagValue}
                      onSubmitEditing={handleSaveTag}
                      onBlur={() => {
                        setTimeout(() => {
                          handleCancelEditTag();
                        }, 200);
                      }}
                      autoFocus
                      selectTextOnFocus
                    />
                    <TouchableOpacity 
                      style={styles.tagChipBtn}
                      onPress={handleSaveTag}
                      hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
                    >
                      <Icon name="check" size={14} color={colors.text} />
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={styles.tagChipBtn}
                      onPress={handleCancelEditTag}
                      hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
                    >
                      <Icon name="close" size={14} color={colors.text} />
                    </TouchableOpacity>
                  </View>
                );
              }
              
              return (
                <TouchableOpacity 
                  key={tag} 
                  style={[styles.tagChip, { backgroundColor: colors.bg }]}
                  onPress={() => handleStartEditTag(tag)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.tagChipText, { color: colors.text }]}>
                    {tag}
                  </Text>
                  <Icon name="pencil" size={12} color={colors.text} style={styles.tagEditIcon} />
                </TouchableOpacity>
              );
            })
          ) : section.title === 'Untagged' ? (
            isAddingTag ? (
              <View style={styles.untaggedEditContainer}>
                <TextInput
                  ref={newTagInputRef}
                  style={styles.untaggedInput}
                  placeholder="New tag"
                  placeholderTextColor={theme.colors.textPlaceholder}
                  value={newTagValue}
                  onChangeText={setNewTagValue}
                  onSubmitEditing={handleSaveNewTag}
                  onBlur={() => {
                    setTimeout(() => {
                      handleCancelAddTag();
                    }, 200);
                  }}
                  autoFocus
                />
                <TouchableOpacity 
                  style={styles.untaggedBtn}
                  onPress={handleSaveNewTag}
                  hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
                >
                  <Icon name="check" size={14} color={theme.colors.accentSuccess} />
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.untaggedBtn}
                  onPress={handleCancelAddTag}
                  hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
                >
                  <Icon name="close" size={14} color={theme.colors.textTertiary} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity 
                style={styles.untaggedContainer}
                onPress={handleStartAddTag}
                activeOpacity={0.7}
              >
                <Text style={styles.untaggedText}>Untagged</Text>
                <Icon name="plus" size={12} color={theme.colors.textPlaceholder} style={styles.untaggedIcon} />
              </TouchableOpacity>
            )
          ) : (
            <Text style={styles.tagText}>{section.title}</Text>
          )}
        </View>
        
        <Text style={styles.count}>{section.completedCount}/{section.totalCount}</Text>
        {allDone && (
          <Icon name="check-circle" size={16} color={theme.colors.accentSuccess} style={styles.check} />
        )}
      </TouchableOpacity>
      
      {/* Add task input - shown when tag group is expanded */}
      {expanded && (
        isAdding ? (
          // Inline input mode
          <View style={styles.addTaskContainer}>
            <TextInput
              ref={inputRef}
              style={styles.addTaskInput}
              placeholder="Add a new task"
              placeholderTextColor={theme.colors.textPlaceholder}
              value={newTaskTitle}
              onChangeText={setNewTaskTitle}
              onSubmitEditing={handleSubmit}
              autoFocus
              blurOnSubmit={false}
              returnKeyType="done"
              onBlur={handleBlur}
            />
            <TouchableOpacity 
              style={styles.addTaskClose}
              onPress={handleCancel}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon name="close" size={18} color={theme.colors.textTertiary} />
            </TouchableOpacity>
          </View>
        ) : (
          // Placeholder mode
          <TouchableOpacity 
            style={styles.addTaskPlaceholder}
            onPress={() => setIsAdding(true)}
            activeOpacity={0.7}
          >
            <View style={styles.addTaskInputBox} pointerEvents="none">
              <Text style={styles.addTaskPlaceholderText}>Add a new task</Text>
            </View>
          </TouchableOpacity>
        )
      )}
    </View>
  );
};

const createStyles = (theme) => StyleSheet.create({
  tagHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    padding: theme.spacing.sm,
    paddingLeft: theme.spacing.xl, // Indented under project
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  tagHeaderCompleted: { 
    backgroundColor: 'rgba(76, 175, 80, 0.1)' 
  },
  tagsContainer: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginLeft: theme.spacing.sm,
    gap: 6,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  tagChipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  tagEditIcon: {
    marginLeft: 4,
    opacity: 0.6,
  },
  tagChipEdit: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
  },
  tagChipInput: {
    fontSize: 13,
    fontWeight: '500',
    padding: 0,
    minWidth: 60,
    maxWidth: 120,
  },
  tagChipBtn: {
    padding: 2,
    marginLeft: 2,
  },
  untaggedText: {
    fontSize: 13,
    fontWeight: '400',
    color: theme.colors.textPlaceholder,
    fontStyle: 'italic',
  },
  untaggedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: 'dashed',
  },
  untaggedIcon: {
    marginLeft: 4,
  },
  untaggedEditContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 10,
  },
  untaggedInput: {
    fontSize: 13,
    color: theme.colors.textPrimary,
    padding: 0,
    minWidth: 60,
    maxWidth: 100,
  },
  untaggedBtn: {
    padding: 2,
    marginLeft: 4,
  },
  tagText: { 
    fontSize: theme.typography.body, 
    fontWeight: '600', 
    color: theme.colors.textSecondary, 
  },
  tagTextCompleted: { 
    color: theme.colors.accentSuccess 
  },
  count: { 
    fontSize: theme.typography.body, 
    color: theme.colors.textTertiary, 
    marginRight: theme.spacing.sm 
  },
  check: { 
    marginLeft: theme.spacing.xs 
  },
  
  // Add task styles
  addTaskContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  addTaskInput: {
    flex: 1,
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 6,
    padding: 8,
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    marginRight: 8,
  },
  addTaskClose: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addTaskPlaceholder: {
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  addTaskInputBox: {
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 6,
    padding: 8,
  },
  addTaskPlaceholderText: {
    fontSize: theme.typography.body,
    color: theme.colors.textPlaceholder,
  },
});
