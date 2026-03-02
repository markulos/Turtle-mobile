import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Platform,
  StyleSheet,
  Alert,
  ScrollView,
  Keyboard,
  Animated,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../context/ThemeContext';
import { FormField } from './FormField';
import { DatePickerModal } from './DatePickerModal';
import { TimePicker } from './TimePicker';
import { normalizeTags, parseTags, getPriorityColor } from '../utils/taskHelpers';
import { PRIORITIES } from '../utils/constants';

export const TaskForm = ({ 
  visible, 
  onClose, 
  onSave, 
  onDelete,
  initialData, 
  projects, 
  allTags,
  onAddProject,
  onCollectTags,
}) => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const RECURRING_OPTIONS = [
    { value: 'none', label: 'No', icon: 'repeat-off' },
    { value: 'daily', label: 'Daily', icon: 'calendar-today' },
    { value: 'weekly', label: 'Weekly', icon: 'calendar-week' },
    { value: 'biweekly', label: 'Biweekly', icon: 'calendar-range' },
  ];

  const [formData, setFormData] = useState({
    title: '', description: '', priority: 'medium', completed: false,
    project: '', dueDate: '', time: '', tags: [], recurring: 'none'
  });
  const [tagInput, setTagInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  
  const titleInputRef = useRef(null);
  const descInputRef = useRef(null);
  const dueDateInputRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [isClosing, setIsClosing] = useState(false);
  
  const isEditing = !!initialData?.id;

  useEffect(() => {
    if (visible) {
      setIsClosing(false);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
      if (initialData) {
        // Check if task is an appointment (createdAt matches dueDate)
        const isAppointment = initialData.dueDate && initialData.createdAt && (() => {
          const [y, m, d] = initialData.dueDate.split('-').map(Number);
          const dueDateTime = new Date(y, m - 1, d).getTime();
          const createdDate = new Date(initialData.createdAt);
          const createdDateTime = new Date(
            createdDate.getFullYear(),
            createdDate.getMonth(),
            createdDate.getDate()
          ).getTime();
          return dueDateTime === createdDateTime;
        })();
        
        setFormData({
          ...initialData,
          tags: normalizeTags(initialData.tags),
          isAppointment: !!isAppointment,
          recurring: initialData.recurring || 'none'
        });
      } else {
        setFormData({
          title: '', description: '', priority: 'medium', completed: false,
          project: '', dueDate: '', time: '', tags: [], recurring: 'none'
        });
      }
      setTagInput('');
      setShowSuggestions(false);
    } else if (isClosing) {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        setIsClosing(false);
      });
    }
  }, [visible, isClosing, initialData, fadeAnim]);
  
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

  const suggestions = useMemo(() => {
    if (!tagInput.trim() || !showSuggestions) return [];
    
    const input = tagInput.toLowerCase().trim();
    const currentTags = formData.tags.map(t => t.toLowerCase());
    
    return allTags.filter(tag => 
      !currentTags.includes(tag.toLowerCase()) &&
      tag.toLowerCase().includes(input)
    ).slice(0, 5);
  }, [tagInput, allTags, formData.tags, showSuggestions]);

  const handleSave = async () => {
    Keyboard.dismiss();
    
    if (!formData.title.trim()) {
      Alert.alert('Error', 'Task title is required');
      return;
    }
    
    if (formData.project && !projects.includes(formData.project)) {
      await onAddProject(formData.project);
    }
    
    let finalTask = {
      ...formData,
      id: initialData?.id || Date.now().toString(),
      createdAt: initialData?.createdAt || Date.now(),
      title: formData.title.trim()
    };
    
    // If appointment mode is enabled, set createdAt to match dueDate
    if (formData.isAppointment && formData.dueDate) {
      const [y, m, d] = formData.dueDate.split('-').map(Number);
      const appointmentDate = new Date(y, m - 1, d);
      finalTask.createdAt = appointmentDate.getTime();
    }
    
    // Remove the isAppointment field before saving (it's just a UI helper)
    delete finalTask.isAppointment;
    
    // Show save confirmation with details
    const confirmationDetails = [
      `Title: ${finalTask.title}`,
      finalTask.time ? `Time: ${finalTask.time}` : null,
      finalTask.dueDate ? `Due: ${finalTask.dueDate}` : null,
      finalTask.recurring && finalTask.recurring !== 'none' ? `Repeats: ${finalTask.recurring}` : null
    ].filter(Boolean).join('\n');
    
    console.log('[TaskForm] Saving task:', finalTask);
    
    onSave(finalTask);
    
    // Show confirmation alert
    Alert.alert(
      'Task Saved',
      confirmationDetails,
      [{ text: 'OK', onPress: handleClose }]
    );
  };

  const addTag = (tag) => {
    const tagToAdd = tag || tagInput.trim();
    if (!tagToAdd) return;
    
    // Split by comma and process each tag separately
    const tagsToAdd = tagToAdd.split(',').map(t => t.trim()).filter(Boolean);
    
    const newTags = [];
    tagsToAdd.forEach(t => {
      if (!formData.tags.some(existing => existing.toLowerCase() === t.toLowerCase())) {
        newTags.push(t);
      }
    });
    
    if (newTags.length > 0) {
      setFormData(prev => ({ 
        ...prev, 
        tags: [...prev.tags, ...newTags] 
      }));
      
      // Immediately collect new tags to update the global tag list
      if (onCollectTags) {
        onCollectTags(newTags);
      }
    }
    
    setTagInput('');
    setShowSuggestions(false);
  };

  const removeTag = (tag) => {
    setFormData(prev => ({ 
      ...prev, 
      tags: prev.tags.filter(t => t !== tag) 
    }));
  };

  const selectProject = () => {
    Keyboard.dismiss();
    Alert.alert(
      'Select Project',
      '',
      [
        ...projects.map(p => ({ 
          text: p, 
          onPress: () => setFormData(prev => ({ ...prev, project: p })) 
        })),
        { text: 'No Project', onPress: () => setFormData(prev => ({ ...prev, project: '' })) },
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  };

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const selectSuggestion = (suggestion) => {
    addTag(suggestion);
  };

  const focusNext = (ref) => {
    ref?.current?.focus();
  };

  const styles = createStyles(theme, insets);

  return (
    <Modal 
      animationType="none" 
      transparent 
      visible={visible} 
      onRequestClose={handleClose}
    >
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
        <KeyboardAwareScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          enableOnAndroid={true}
          extraScrollHeight={Platform.OS === 'ios' ? 80 : 120}
          enableResetScrollToCoords={false}
          showsVerticalScrollIndicator={true}
        >
          <View style={styles.content}>
            <Text style={styles.title}>{isEditing ? 'Edit Task' : 'New Task'}</Text>
            
            <FormField label="Project *">
              <View style={styles.projectRow}>
                <TextInput
                  style={[styles.input, styles.projectInput]}
                  placeholder="Type new or select existing..."
                  placeholderTextColor={theme.colors.textPlaceholder}
                  value={formData.project}
                  onChangeText={text => updateField('project', text)}
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => focusNext(titleInputRef)}
                />
                <TouchableOpacity style={styles.projectBtn} onPress={selectProject}>
                  <Icon name="folder-open" size={20} color={theme.colors.textPrimary} />
                </TouchableOpacity>
              </View>
              {formData.project && !projects.includes(formData.project) && (
                <Text style={styles.hint}>Will create new project "{formData.project}"</Text>
              )}
            </FormField>

            <FormField label="Title *">
              <TextInput
                ref={titleInputRef}
                style={styles.input}
                placeholder="What needs to be done?"
                placeholderTextColor={theme.colors.textPlaceholder}
                value={formData.title}
                onChangeText={text => updateField('title', text)}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => focusNext(descInputRef)}
              />
            </FormField>

            <FormField label="Tags">
              <View style={styles.tagRow}>
                <TextInput
                  style={[styles.input, styles.tagInput]}
                  placeholder="Type to see suggestions..."
                  placeholderTextColor={theme.colors.textPlaceholder}
                  value={tagInput}
                  onChangeText={(text) => {
                    setTagInput(text);
                    setShowSuggestions(text.length > 0);
                  }}
                  onSubmitEditing={() => addTag()}
                  onFocus={() => setShowSuggestions(tagInput.length > 0)}
                  blurOnSubmit={false}
                  returnKeyType="done"
                />
                <TouchableOpacity style={styles.addTagBtn} onPress={() => addTag()}>
                  <Icon name="plus" size={20} color={theme.colors.textPrimary} />
                </TouchableOpacity>
              </View>
              
              {showSuggestions && suggestions.length > 0 && (
                <View style={styles.suggestionsContainer}>
                  <ScrollView 
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                  >
                    {suggestions.map((suggestion, index) => (
                      <TouchableOpacity
                        key={suggestion}
                        style={[
                          styles.suggestionItem,
                          index === suggestions.length - 1 && styles.suggestionLast
                        ]}
                        onPress={() => selectSuggestion(suggestion)}
                      >
                        <Icon name="tag" size={14} color={theme.colors.textPrimary} />
                        <Text style={styles.suggestionText}>{suggestion}</Text>
                        <Icon name="plus-circle" size={16} color={theme.colors.textPrimary} />
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
              
              {showSuggestions && tagInput.length === 0 && allTags.length > 0 && (
                <View style={styles.suggestionsContainer}>
                  <Text style={styles.suggestionsLabel}>All tags:</Text>
                  <ScrollView 
                    horizontal 
                    showsHorizontalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    style={styles.allTagsRow}
                  >
                    {allTags
                      .filter(tag => !formData.tags.includes(tag))
                      .map(tag => (
                        <TouchableOpacity
                          key={tag}
                          style={styles.allTagChip}
                          onPress={() => selectSuggestion(tag)}
                        >
                          <Text style={styles.allTagText}>{tag}</Text>
                        </TouchableOpacity>
                      ))}
                  </ScrollView>
                </View>
              )}
              
              {formData.tags.length > 0 && (
                <View style={styles.tagsContainer}>
                  {formData.tags.map((tag, idx) => (
                    <View key={idx} style={styles.selectedTagChip}>
                      <Text style={styles.selectedTagText}>{tag}</Text>
                      <TouchableOpacity onPress={() => removeTag(tag)}>
                        <Icon name="close-circle" size={16} color={theme.colors.accentError} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </FormField>

            <FormField label="Description">
              <TextInput
                ref={descInputRef}
                style={[styles.input, styles.descInput]}
                placeholder="Add details..."
                placeholderTextColor={theme.colors.textPlaceholder}
                value={formData.description}
                onChangeText={text => updateField('description', text)}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => focusNext(dueDateInputRef)}
              />
            </FormField>

            <FormField label="Due Date">
              <TouchableOpacity 
                style={styles.datePickerButton}
                onPress={() => setShowDatePicker(true)}
              >
                <Icon name="calendar" size={20} color={theme.colors.textSecondary} />
                <Text style={[
                  styles.datePickerText,
                  !formData.dueDate && styles.datePickerPlaceholder
                ]}>
                  {formData.dueDate 
                    ? (() => {
                        // Parse YYYY-MM-DD and create date in local timezone
                        const [y, m, d] = formData.dueDate.split('-').map(Number);
                        const date = new Date(y, m - 1, d);
                        return date.toLocaleDateString('en-US', { 
                          weekday: 'short', 
                          month: 'short', 
                          day: 'numeric',
                          year: 'numeric'
                        });
                      })()
                    : 'Select a date...'
                  }
                </Text>
                <Icon name="chevron-right" size={20} color={theme.colors.textTertiary} />
              </TouchableOpacity>
              
              {formData.dueDate && (
                <TouchableOpacity 
                  style={styles.clearDateBtn}
                  onPress={() => updateField('dueDate', '')}
                >
                  <Text style={styles.clearDateText}>Clear date</Text>
                </TouchableOpacity>
              )}
              
              {/* Appointment option - only when due date is set */}
              {formData.dueDate && (
                <TouchableOpacity 
                  style={styles.appointmentToggle}
                  onPress={() => updateField('isAppointment', !formData.isAppointment)}
                  activeOpacity={0.7}
                >
                  <View style={[
                    styles.checkbox,
                    formData.isAppointment && styles.checkboxChecked
                  ]}>
                    {formData.isAppointment && (
                      <Icon name="check" size={14} color="#fff" />
                    )}
                  </View>
                  <Text style={styles.appointmentText}>Single event (appointment)</Text>
                  <Icon 
                    name="calendar-clock" 
                    size={16} 
                    color={formData.isAppointment ? theme.colors.accentSuccess : theme.colors.textTertiary}
                    style={styles.appointmentIcon}
                  />
                </TouchableOpacity>
              )}
            </FormField>

            {/* Time Field */}
            <FormField label="Time (optional)">
              <TouchableOpacity 
                style={styles.datePickerButton}
                onPress={() => setShowTimePicker(true)}
              >
                <Icon name="clock-outline" size={20} color={formData.time ? theme.colors.accentPrimary : theme.colors.textSecondary} />
                <Text style={[
                  styles.datePickerText,
                  !formData.time && styles.datePickerPlaceholder
                ]}>
                  {formData.time 
                    ? (() => {
                        const [h, m] = formData.time.split(':').map(Number);
                        const isPM = h >= 12;
                        const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
                        return `${displayH}:${m.toString().padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;
                      })()
                    : 'Set a time...'
                  }
                </Text>
                <Icon name="chevron-right" size={20} color={theme.colors.textTertiary} />
              </TouchableOpacity>
              
              {formData.time && (
                <TouchableOpacity 
                  style={styles.clearDateBtn}
                  onPress={() => updateField('time', '')}
                >
                  <Text style={styles.clearDateText}>Clear time</Text>
                </TouchableOpacity>
              )}
            </FormField>
            
            {/* Time Picker Modal */}
            <TimePicker
              visible={showTimePicker}
              onClose={() => setShowTimePicker(false)}
              onSelect={(time) => {
                updateField('time', time);
                setShowTimePicker(false);
              }}
              initialTime={formData.time}
            />
            
            {/* Date Picker Modal */}
            <DatePickerModal
              visible={showDatePicker}
              onClose={() => setShowDatePicker(false)}
              onSelect={(date) => {
                updateField('dueDate', date);
                setShowDatePicker(false);
              }}
              selectedDate={formData.dueDate}
              theme={theme}
            />

            <FormField label="Priority">
              <View style={styles.priorityRow}>
                {PRIORITIES.map(p => (
                  <TouchableOpacity
                    key={p}
                    style={[
                      styles.priorityBtn,
                      formData.priority === p && { 
                        backgroundColor: getPriorityColor(p, theme),
                        borderColor: getPriorityColor(p, theme)
                      }
                    ]}
                    onPress={() => updateField('priority', p)}
                  >
                    <Text style={[
                      styles.priorityText,
                      formData.priority === p && styles.priorityTextActive
                    ]}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </FormField>

            <FormField label="Repeat">
              <View style={styles.recurringRow}>
                {RECURRING_OPTIONS.map(option => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.recurringBtn,
                      formData.recurring === option.value && styles.recurringBtnActive
                    ]}
                    onPress={() => updateField('recurring', option.value)}
                  >
                    <Icon 
                      name={option.icon} 
                      size={16} 
                      color={formData.recurring === option.value ? theme.colors.textPrimary : theme.colors.textTertiary} 
                    />
                    <Text style={[
                      styles.recurringText,
                      formData.recurring === option.value && styles.recurringTextActive
                    ]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </FormField>

            <View style={styles.buttons}>
              <TouchableOpacity style={[styles.btn, styles.cancelBtn]} onPress={handleClose}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.saveBtn]} onPress={handleSave}>
                <Text style={styles.saveText}>Save Task</Text>
              </TouchableOpacity>
            </View>

            {/* Delete Button - only show when editing */}
            {isEditing && onDelete && (
              <TouchableOpacity 
                style={styles.deleteBtn} 
                onPress={() => {
                  Alert.alert(
                    'Delete Task?',
                    `Are you sure you want to delete "${formData.title}"?`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { 
                        text: 'Delete', 
                        style: 'destructive',
                        onPress: () => {
                          onDelete(initialData.id);
                          handleClose();
                        }
                      }
                    ]
                  );
                }}
              >
                <Icon name="trash-can" size={20} color={theme.colors.accentError} />
                <Text style={styles.deleteText}>Delete Task</Text>
              </TouchableOpacity>
            )}

            <View style={styles.bottomPadding} />
          </View>
        </KeyboardAwareScrollView>
      </Animated.View>
    </Modal>
  );
};

const createStyles = (theme, insets) => StyleSheet.create({
  overlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0, 0, 0, 0.5)', 
    justifyContent: 'flex-end' 
  },
  scrollContent: { 
    flexGrow: 1, 
    justifyContent: 'flex-end' 
  },
  content: { 
    backgroundColor: theme.colors.background, 
    borderTopLeftRadius: 16, 
    borderTopRightRadius: 16, 
    padding: 16,
    paddingTop: 16 + insets.top, // Add safe area for notch
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  title: { 
    fontSize: theme.typography.body, 
    fontWeight: '700', 
    marginBottom: 16, 
    color: theme.colors.textPrimary 
  },
  input: { 
    height: 40, // Match "add a new task" height
    borderWidth: 0, 
    borderRadius: 10, 
    paddingHorizontal: 12, 
    fontSize: theme.typography.body,
    color: theme.colors.inputText,
    backgroundColor: theme.colors.inputBackground,
  },
  projectRow: { 
    flexDirection: 'row', 
    alignItems: 'center' 
  },
  projectInput: { 
    flex: 1, 
    marginRight: 10 
  },
  projectBtn: { 
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated, 
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  hint: { 
    fontSize: theme.typography.body, 
    color: theme.colors.textSecondary, 
    marginTop: 4, 
    fontStyle: 'italic' 
  },
  tagRow: { 
    flexDirection: 'row', 
    alignItems: 'center' 
  },
  tagInput: { 
    flex: 1, 
    marginRight: 10 
  },
  addTagBtn: { 
    backgroundColor: theme.colors.surfaceElevated, 
    width: 40, 
    height: 40, 
    borderRadius: 10, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  suggestionsContainer: {
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: 10,
    marginTop: 8,
    marginBottom: 10,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
    maxHeight: 150,
  },
  suggestionsLabel: {
    fontSize: theme.typography.body,
    color: theme.colors.textTertiary,
    padding: 8,
    paddingBottom: 4,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  suggestionLast: {
    borderBottomWidth: 0,
  },
  suggestionText: {
    flex: 1,
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    marginLeft: 8,
  },
  allTagsRow: {
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  allTagChip: {
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    marginRight: 8,
  },
  allTagText: {
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
  },
  tagsContainer: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    marginTop: 10 
  },
  selectedTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
  },
  selectedTagText: { 
    color: theme.colors.textPrimary, 
    marginRight: 6, 
    fontSize: theme.typography.body 
  },
  descInput: { 
    height: 80, 
    textAlignVertical: 'top',
    paddingTop: 10,
  },
  priorityRow: { 
    flexDirection: 'row', 
    marginBottom: 16 
  },
  priorityBtn: { 
    flex: 1, 
    paddingVertical: 10, 
    borderRadius: 8, 
    borderWidth: 0.5, 
    borderColor: theme.colors.border, 
    marginHorizontal: 5, 
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
  },
  priorityText: { 
    color: theme.colors.textTertiary, 
    fontWeight: '600',
    fontSize: theme.typography.body,
  },
  priorityTextActive: { 
    color: theme.colors.textPrimary 
  },
  recurringRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  recurringBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    gap: 6,
  },
  recurringBtnActive: {
    backgroundColor: theme.colors.surfaceElevated,
    borderColor: theme.colors.accentPrimary,
  },
  recurringText: {
    fontSize: 13,
    color: theme.colors.textTertiary,
    fontWeight: '500',
  },
  recurringTextActive: {
    color: theme.colors.textPrimary,
    fontWeight: '600',
  },
  buttons: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    marginTop: 16, 
    marginBottom: 16 
  },
  btn: { 
    flex: 1, 
    height: 44,
    borderRadius: 10, 
    alignItems: 'center', 
    justifyContent: 'center',
    marginHorizontal: 5 
  },
  cancelBtn: { 
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  cancelText: { 
    color: theme.colors.textSecondary, 
    fontWeight: '600',
    fontSize: theme.typography.body,
  },
  saveBtn: { 
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  saveText: { 
    color: theme.colors.textPrimary, 
    fontWeight: '700',
    fontSize: theme.typography.body,
  },
  bottomPadding: {
    height: 60,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 8,
    marginBottom: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.accentError,
    backgroundColor: 'transparent',
    gap: 8,
  },
  deleteText: {
    color: theme.colors.accentError,
    fontWeight: '600',
    fontSize: theme.typography.body,
  },
  datePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  datePickerText: {
    flex: 1,
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    marginLeft: 10,
  },
  datePickerPlaceholder: {
    color: theme.colors.textPlaceholder,
    fontStyle: 'italic',
  },
  clearDateBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  clearDateText: {
    fontSize: 12,
    color: theme.colors.accentError,
  },
  appointmentToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.surfaceHighlight,
    borderRadius: 8,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: theme.colors.textTertiary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  checkboxChecked: {
    backgroundColor: theme.colors.accentSuccess,
    borderColor: theme.colors.accentSuccess,
  },
  appointmentText: {
    flex: 1,
    fontSize: 14,
    color: theme.colors.textPrimary,
    fontWeight: '500',
  },
  appointmentIcon: {
    marginLeft: 8,
  },
});
