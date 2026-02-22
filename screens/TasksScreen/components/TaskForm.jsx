import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { FormField } from './FormField';
import { normalizeTags, parseTags, getPriorityColor } from '../utils/taskHelpers';
import { PRIORITIES } from '../utils/constants';

export const TaskForm = ({ 
  visible, 
  onClose, 
  onSave, 
  initialData, 
  projects, 
  allTags, // NEW: Pass existing tags for suggestions
  onAddProject,
}) => {
  const [formData, setFormData] = useState({
    title: '', description: '', priority: 'medium', completed: false,
    project: '', dueDate: '', tags: []
  });
  const [tagInput, setTagInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false); // NEW
  const isEditing = !!initialData?.id;

  useEffect(() => {
    if (visible) {
      if (initialData) {
        setFormData({
          ...initialData,
          tags: normalizeTags(initialData.tags)
        });
      }
      setTagInput('');
      setShowSuggestions(false);
    }
  }, [visible, initialData]);

  // NEW: Filter suggestions based on input
  const suggestions = useMemo(() => {
    if (!tagInput.trim() || !showSuggestions) return [];
    
    const input = tagInput.toLowerCase().trim();
    const currentTags = formData.tags.map(t => t.toLowerCase());
    
    // Filter out already selected tags and match input
    return allTags.filter(tag => 
      !currentTags.includes(tag.toLowerCase()) &&
      tag.toLowerCase().includes(input)
    ).slice(0, 5); // Limit to 5 suggestions
  }, [tagInput, allTags, formData.tags, showSuggestions]);

  const handleSave = async () => {
    if (!formData.title.trim()) {
      Alert.alert('Error', 'Task title is required');
      return;
    }
    
    if (formData.project && !projects.includes(formData.project)) {
      await onAddProject(formData.project);
    }
    
    const finalTask = {
      ...formData,
      id: initialData?.id || Date.now().toString(),
      createdAt: initialData?.createdAt || Date.now(),
      title: formData.title.trim()
    };
    
    onSave(finalTask);
    onClose();
  };

  const addTag = (tag) => {
    const tagToAdd = tag || tagInput.trim();
    if (!tagToAdd) return;
    
    // Prevent duplicates
    if (formData.tags.some(t => t.toLowerCase() === tagToAdd.toLowerCase())) {
      setTagInput('');
      setShowSuggestions(false);
      return;
    }
    
    setFormData(prev => ({ 
      ...prev, 
      tags: [...prev.tags, tagToAdd] 
    }));
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

  // NEW: Handle suggestion selection
  const selectSuggestion = (suggestion) => {
    addTag(suggestion);
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <KeyboardAwareScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          enableOnAndroid
          extraScrollHeight={Platform.OS === 'ios' ? 20 : 100}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.content}>
              <Text style={styles.title}>{isEditing ? 'Edit Task' : 'New Task'}</Text>
              
              <FormField label="Project *">
                <View style={styles.projectRow}>
                  <TextInput
                    style={[styles.input, styles.projectInput]}
                    placeholder="Type new or select existing..."
                    value={formData.project}
                    onChangeText={text => updateField('project', text)}
                  />
                  <TouchableOpacity style={styles.projectBtn} onPress={selectProject}>
                    <Icon name="folder-open" size={20} color="#4CAF50" />
                  </TouchableOpacity>
                </View>
                {formData.project && !projects.includes(formData.project) && (
                  <Text style={styles.hint}>Will create new project "{formData.project}"</Text>
                )}
              </FormField>

              <FormField label="Title *">
                <TextInput
                  style={styles.input}
                  placeholder="What needs to be done?"
                  value={formData.title}
                  onChangeText={text => updateField('title', text)}
                  autoFocus={!isEditing}
                />
              </FormField>

              {/* UPDATED: Tags with suggestions */}
              <FormField label="Tags">
                <View style={styles.tagRow}>
                  <TextInput
                    style={[styles.input, styles.tagInput]}
                    placeholder="Type to see suggestions..."
                    value={tagInput}
                    onChangeText={(text) => {
                      setTagInput(text);
                      setShowSuggestions(text.length > 0);
                    }}
                    onSubmitEditing={() => addTag()}
                    onFocus={() => setShowSuggestions(tagInput.length > 0)}
                  />
                  <TouchableOpacity style={styles.addTagBtn} onPress={() => addTag()}>
                    <Icon name="plus" size={20} color="#fff" />
                  </TouchableOpacity>
                </View>
                
                {/* NEW: Suggestions dropdown */}
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
                          <Icon name="tag" size={14} color="#2196F3" />
                          <Text style={styles.suggestionText}>{suggestion}</Text>
                          <Icon name="plus-circle" size={16} color="#4CAF50" />
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
                
                {/* Show all available tags if no input and focused */}
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
                
                {/* Selected tags */}
                {formData.tags.length > 0 && (
                  <View style={styles.tagsContainer}>
                    {formData.tags.map((tag, idx) => (
                      <View key={idx} style={styles.selectedTagChip}>
                        <Text style={styles.selectedTagText}>{tag}</Text>
                        <TouchableOpacity onPress={() => removeTag(tag)}>
                          <Icon name="close-circle" size={16} color="#f44336" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
              </FormField>

              <FormField label="Description">
                <TextInput
                  style={[styles.input, styles.descInput]}
                  placeholder="Add details..."
                  value={formData.description}
                  onChangeText={text => updateField('description', text)}
                  multiline
                  numberOfLines={3}
                />
              </FormField>

              <FormField label="Due Date">
                <TextInput
                  style={styles.input}
                  placeholder="YYYY-MM-DD"
                  value={formData.dueDate}
                  onChangeText={text => updateField('dueDate', text)}
                />
              </FormField>

              <FormField label="Priority">
                <View style={styles.priorityRow}>
                  {PRIORITIES.map(p => (
                    <TouchableOpacity
                      key={p}
                      style={[
                        styles.priorityBtn,
                        formData.priority === p && { 
                          backgroundColor: getPriorityColor(p),
                          borderColor: getPriorityColor(p)
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

              <View style={styles.buttons}>
                <TouchableOpacity style={[styles.btn, styles.cancelBtn]} onPress={onClose}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, styles.saveBtn]} onPress={handleSave}>
                  <Text style={styles.saveText}>Save Task</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAwareScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  scrollContent: { flexGrow: 1, justifyContent: 'flex-end' },
  content: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 20, color: '#333' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, fontSize: 16 },
  projectRow: { flexDirection: 'row', alignItems: 'center' },
  projectInput: { flex: 1, marginRight: 10 },
  projectBtn: { padding: 12, backgroundColor: '#f5f5f5', borderRadius: 10 },
  hint: { fontSize: 12, color: '#4CAF50', marginTop: 4, fontStyle: 'italic' },
  tagRow: { flexDirection: 'row', alignItems: 'center' },
  tagInput: { flex: 1, marginRight: 10 },
  addTagBtn: { backgroundColor: '#4CAF50', width: 46, height: 46, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  
  // NEW: Suggestions styles
  suggestionsContainer: {
    backgroundColor: '#f9f9f9',
    borderRadius: 10,
    marginTop: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#eee',
    maxHeight: 150,
  },
  suggestionsLabel: {
    fontSize: 12,
    color: '#999',
    padding: 8,
    paddingBottom: 4,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    backgroundColor: '#fff',
  },
  suggestionLast: {
    borderBottomWidth: 0,
  },
  suggestionText: {
    flex: 1,
    fontSize: 14,
    color: '#333',
    marginLeft: 8,
  },
  allTagsRow: {
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  allTagChip: {
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    marginRight: 8,
  },
  allTagText: {
    fontSize: 12,
    color: '#2196F3',
  },
  
  // Selected tags
  tagsContainer: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    marginTop: 10 
  },
  selectedTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
  },
  selectedTagText: { color: '#4CAF50', marginRight: 6, fontSize: 14 },
  descInput: { height: 80, textAlignVertical: 'top' },
  priorityRow: { flexDirection: 'row', marginBottom: 20 },
  priorityBtn: { flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', marginHorizontal: 5, alignItems: 'center' },
  priorityText: { color: '#666', fontWeight: '600' },
  priorityTextActive: { color: '#fff' },
  buttons: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20, marginBottom: 30 },
  btn: { flex: 1, padding: 15, borderRadius: 10, alignItems: 'center', marginHorizontal: 5 },
  cancelBtn: { backgroundColor: '#f5f5f5' },
  saveBtn: { backgroundColor: '#4CAF50' },
  cancelText: { color: '#666', fontWeight: '600' },
  saveText: { color: '#fff', fontWeight: '600' },
});