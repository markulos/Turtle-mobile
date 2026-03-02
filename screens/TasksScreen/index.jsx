import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
  Alert,
  Keyboard,
  findNodeHandle,
  Platform,
  KeyboardAvoidingView,
  TextInput,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServer } from '../../context/ServerContext';
import { useTheme } from '../../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTaskData } from './hooks/useTaskData';
import { useCollapsibleTasks } from './hooks/useCollapsibleTasks';
import {
  ProjectDropdown,
  FilterMenu,
  ProjectManager,
  TaskForm,
  TaskDetail,
  TaskItem,
  SectionHeader,
  CalendarView,
} from './components';

export default function TasksScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { isConnected, api } = useServer();
  const [menuAnimation] = useState(new Animated.Value(0));
  const [showDropdown, setShowDropdown] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(true);
  const [selectedProject, setSelectedProject] = useState('All');
  const [selectedTags, setSelectedTags] = useState([]);
  const [tagFilterMode, setTagFilterMode] = useState('any');
  const [viewMode, setViewMode] = useState('calendar'); // 'list' or 'calendar'
  
  // Inline add task state per project
  const [inlineAddingProject, setInlineAddingProject] = useState(null);
  const [inlineTaskTitle, setInlineTaskTitle] = useState('');
  const inlineInputRef = useRef(null);
  
  // Ref for scrolling to items when keyboard appears
  const listRef = useRef(null);
  const scrollY = useRef(0);
  
  // Keyboard handling
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  
  useEffect(() => {
    const showListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        setKeyboardHeight(e.endCoordinates.height);
        setKeyboardVisible(true);
      }
    );
    const hideListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
        setKeyboardVisible(false);
      }
    );
    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, []);
  
  const {
    tasks, setTasks, projects, allTags,
    loadData, saveTasks, collectTags, addProject, deleteProject,
    handleAddSubtask,
    handleToggleSubtask,
    handleDeleteSubtask,
    handleUpdateSubtask,
    deleteTask,
    loading,
    refreshing,
    onRefresh,
    lazyRefresh,
  } = useTaskData(api, isConnected);
  
  // Project colors - distinct colors that work well with green/yellow palette
  const projectColors = [
    '#4CAF50', // Green
    '#2196F3', // Blue
    '#9C27B0', // Purple
    '#FF5722', // Deep Orange
    '#00BCD4', // Cyan
    '#795548', // Brown
    '#E91E63', // Pink
    '#3F51B5', // Indigo
    '#009688', // Teal
    '#FF9800', // Orange
    '#607D8B', // Blue Grey
    '#8BC34A', // Light Green
    '#00E676', // Bright Green
    '#2979FF', // Bright Blue
    '#D500F9', // Bright Purple
    '#FF3D00', // Bright Orange
    '#00B0FF', // Light Blue
    '#76FF03', // Lime
    '#FFEA00', // Yellow
    '#FF9100', // Amber
  ];

  // Create a memoized mapping of project names to colors
  const projectColorMap = useMemo(() => {
    const map = {};
    projects.forEach((project, index) => {
      map[project] = projectColors[index % projectColors.length];
    });
    return map;
  }, [projects]);

  // Get color for a project
  const getProjectColor = (projectName) => {
    if (!projectName || projectName === 'All') return theme.colors.textSecondary;
    return projectColorMap[projectName] || theme.colors.textSecondary;
  };
  
  // Use collapsible tasks hook - ALL collapsed by default
  const collapsible = useCollapsibleTasks(tasks, projects, { 
    showIncompleteOnly, 
    selectedProject,
    selectedTags,
    tagFilterMode
  });
  
  // Function to scroll to a specific item
  const scrollToItem = useCallback((itemId) => {
    if (!collapsible?.groupedData) return;
    
    // Find the section and index of the item
    let itemIndex = -1;
    let sectionIndex = -1;
    
    for (let i = 0; i < collapsible.groupedData.length; i++) {
      const section = collapsible.groupedData[i];
      if (section.type === 'tag' && section.data) {
        const idx = section.data.findIndex(item => item.id === itemId);
        if (idx !== -1) {
          sectionIndex = i;
          itemIndex = idx;
          break;
        }
      }
    }
    
    if (sectionIndex !== -1 && itemIndex !== -1 && listRef.current) {
      listRef.current.scrollToLocation({
        sectionIndex,
        itemIndex,
        viewOffset: 100, // Scroll so item is not at the very bottom
        animated: true,
      });
    }
  }, [collapsible?.groupedData]);
  
  // Project chevron rotation animations
  const projectRotations = useRef({}).current;
  
  // Initialize rotation animations for projects
  useEffect(() => {
    projects.forEach(project => {
      if (!projectRotations[project]) {
        projectRotations[project] = new Animated.Value(0);
      }
    });
  }, [projects]);
  
  // Animate project chevron when expanded state changes
  useEffect(() => {
    Object.entries(collapsible.expandedProjects).forEach(([project, isExpanded]) => {
      if (projectRotations[project]) {
        Animated.timing(projectRotations[project], {
          toValue: isExpanded ? 1 : 0,
          duration: 200,
          useNativeDriver: true,
        }).start();
      }
    });
  }, [collapsible.expandedProjects]);

  useEffect(() => {
    if (showFilterMenu) {
      Animated.spring(menuAnimation, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
    } else {
      Animated.timing(menuAnimation, { 
        toValue: 0, 
        duration: 200, 
        useNativeDriver: true,
        easing: Easing.out(Easing.ease)
      }).start();
    }
  }, [showFilterMenu, menuAnimation]);

  const handleSaveTask = async (taskData) => {
    if (taskData.tags?.length > 0) await collectTags(taskData.tags);
    
    const newTasks = taskData.id && tasks.find(t => t.id === taskData.id)
      ? tasks.map(t => t.id === taskData.id ? taskData : t)
      : [...tasks, { ...taskData, subtasks: [] }];
    
    await saveTasks(newTasks);
  };

  const handleToggleComplete = async (id) => {
    const now = Date.now();
    const newTasks = tasks.map(t => {
      if (t.id !== id) return t;
      const completed = !t.completed;
      return {
        ...t,
        completed,
        completedAt: completed ? now : null,
        completedTime: completed ? new Date(now).toISOString() : null
      };
    });
    await saveTasks(newTasks);
  };
  
  const handleUpdateTask = async (taskId, updates) => {
    const newTasks = tasks.map(t => {
      if (t.id !== taskId) return t;
      return { ...t, ...updates };
    });
    await saveTasks(newTasks);
  };

  const handleDelete = (id) => {
    const task = tasks.find(t => t.id === id);
    const hasSubtasks = task?.subtasks && task.subtasks.length > 0;
    
    // Skip confirmation if no subtasks
    if (!hasSubtasks) {
      saveTasks(tasks.filter(t => t.id !== id));
      return;
    }
    
    Alert.alert('Delete Task', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Delete', 
        style: 'destructive',
        onPress: () => saveTasks(tasks.filter(t => t.id !== id))
      }
    ]);
  };

  const handleInlineAdd = (project, tags, title) => {
    const actualProject = project === 'No Project' ? '' : project;
    
    const newTask = {
      title: title,
      description: '',
      priority: 'medium',
      completed: false,
      project: actualProject,
      dueDate: '',
      tags: tags || [],
      subtasks: [],
      id: Date.now().toString(),
      createdAt: Date.now()
    };
    
    handleSaveTask(newTask);
  };

  const handleRenameTag = async (project, oldTag, newTag) => {
    // Update all tasks that have the old tag
    const updatedTasks = tasks.map(task => {
      if (!task.tags || task.tags.length === 0) return task;
      
      // Check if task has the old tag
      const tagIndex = task.tags.indexOf(oldTag);
      if (tagIndex === -1) return task;
      
      // Replace old tag with new tag
      const newTags = [...task.tags];
      newTags[tagIndex] = newTag;
      
      return { ...task, tags: newTags };
    });
    
    await saveTasks(updatedTasks);
  };

  const handleAddTagToSection = async (project, existingTags, newTag) => {
    // Find all tasks in this section (matching project and existing tags)
    const updatedTasks = tasks.map(task => {
      // Check if task matches this section
      const taskProject = task.project || 'No Project';
      const sectionProject = project || 'No Project';
      
      if (taskProject !== sectionProject) return task;
      
      // For Untagged section, we want tasks with no tags
      // For tagged sections, we want tasks with the existing tags
      const taskTags = task.tags || [];
      const isUntaggedSection = !existingTags || existingTags.length === 0;
      const isTaskUntagged = !taskTags || taskTags.length === 0;
      
      if (isUntaggedSection && !isTaskUntagged) return task;
      if (!isUntaggedSection) {
        // Check if task has any of the section's tags
        const hasMatchingTag = existingTags.some(tag => taskTags.includes(tag));
        if (!hasMatchingTag) return task;
      }
      
      // Add the new tag to the task
      return { ...task, tags: [...taskTags, newTag] };
    });
    
    await saveTasks(updatedTasks);
    await collectTags([newTag]);
  };

  const openEditForm = (task) => {
    setEditingTask(task);
    setShowTaskForm(true);
  };

  const openDetail = (task) => {
    setSelectedTask(task);
    setShowDetail(true);
  };

  const closeTaskForm = () => {
    setShowTaskForm(false);
    setEditingTask(null);
  };

  const styles = createStyles(theme);

  if (!isConnected) {
    return (
      <View style={[styles.centerContainer, { paddingTop: insets.top }]}>
        <Icon name="lan-disconnect" size={64} color={theme.colors.textMuted} />
        <Text style={styles.offlineText}>Not connected to server</Text>
        <Text style={styles.offlineSubtext}>Go to Settings to configure connection</Text>
      </View>
    );
  }

  // Check if any filters active
  const hasActiveFilters = !showIncompleteOnly || selectedTags.length > 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Custom Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.projectSelector}
          onPress={() => setShowDropdown(true)}
        >
          <View style={[styles.projectSelectorSquare, { backgroundColor: getProjectColor(selectedProject) }]} />
          <Text style={styles.projectSelectorText} numberOfLines={1}>
            {selectedProject === 'All' ? 'All' : selectedProject}
          </Text>
          <Icon name="chevron-down" size={18} color={theme.colors.textTertiary} />
        </TouchableOpacity>
        
        <View style={styles.headerRight}>
          {/* View Mode Toggle */}
          <View style={styles.viewToggle}>
            <TouchableOpacity
              style={[styles.viewBtn, viewMode === 'list' && styles.viewBtnActive]}
              onPress={() => setViewMode('list')}
            >
              <Icon name="format-list-bulleted" size={20} color={viewMode === 'list' ? theme.colors.textPrimary : theme.colors.textTertiary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.viewBtn, viewMode === 'calendar' && styles.viewBtnActive]}
              onPress={() => setViewMode('calendar')}
            >
              <Icon name="calendar-month" size={20} color={viewMode === 'calendar' ? theme.colors.textPrimary : theme.colors.textTertiary} />
            </TouchableOpacity>
          </View>
          
          <View style={styles.statsContainer}>
            <Text style={styles.statsText}>{collapsible.stats.completed}/{collapsible.stats.total}</Text>
            <View style={styles.progressBar}>
              <View style={[
                styles.progressFill, 
                { width: collapsible.stats.total ? `${(collapsible.stats.completed/collapsible.stats.total)*100}%` : '0%' }
              ]} />
            </View>
          </View>
        </View>
      </View>

      {/* Active Filters */}
      {hasActiveFilters && (
        <View style={styles.activeFiltersBar}>
          <Animated.ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {!showIncompleteOnly && (
              <View style={[styles.filterChip, styles.warningChip]}>
                <Icon name="eye-off" size={12} color={theme.colors.accentWarning} />
                <Text style={[styles.filterChipText, styles.warningChipText]}>Showing Completed</Text>
                <TouchableOpacity onPress={() => setShowIncompleteOnly(true)}>
                  <Icon name="close" size={14} color={theme.colors.textTertiary} />
                </TouchableOpacity>
              </View>
            )}
            {selectedTags.map(tag => (
              <View key={tag} style={[styles.filterChip, styles.tagFilterChip]}>
                <Icon name="tag" size={12} color={theme.colors.textPrimary} />
                <Text style={[styles.filterChipText, styles.tagFilterChipText]}>{tag}</Text>
                <TouchableOpacity onPress={() => 
                  setSelectedTags(prev => prev.filter(t => t !== tag))
                }>
                  <Icon name="close" size={14} color={theme.colors.textTertiary} />
                </TouchableOpacity>
              </View>
            ))}
          </Animated.ScrollView>
        </View>
      )}

      {/* Modals */}
      <ProjectDropdown
        visible={showDropdown}
        onClose={() => setShowDropdown(false)}
        projects={projects}
        tasks={tasks}
        selected={selectedProject}
        onSelect={(project) => {
          setSelectedProject(project);
          setShowDropdown(false);
        }}
        onManage={() => setShowProjectManager(true)}
        onAddProject={addProject}
      />

      <FilterMenu
        visible={showFilterMenu}
        onClose={() => setShowFilterMenu(false)}
        tasks={tasks}
        selectedProject={selectedProject}
        filters={{
          showIncompleteOnly,
          setShowIncompleteOnly,
          selectedTags,
          setSelectedTags,
          toggleTagFilter: (tag) => {
            setSelectedTags(prev => 
              prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
            );
          },
          tagFilterMode,
          setTagFilterMode,
          clearFilters: () => {
            setShowIncompleteOnly(true);
            setSelectedTags([]);
            setTagFilterMode('any');
          },
          hasActiveFilters: selectedTags.length > 0 || !showIncompleteOnly
        }}
        animation={menuAnimation}
      />

      <ProjectManager
        visible={showProjectManager}
        onClose={() => setShowProjectManager(false)}
        projects={projects}
        tasks={tasks}
        onAdd={addProject}
        onDelete={deleteProject}
      />

      <TaskForm
        visible={showTaskForm}
        onClose={closeTaskForm}
        onSave={handleSaveTask}
        onDelete={deleteTask}
        initialData={editingTask}
        projects={projects}
        allTags={allTags}
        onAddProject={addProject}
        onCollectTags={collectTags}
      />

      <TaskDetail
        task={selectedTask}
        visible={showDetail}
        onClose={() => setShowDetail(false)}
        onEdit={() => { setShowDetail(false); openEditForm(selectedTask); }}
        onToggleComplete={() => handleToggleComplete(selectedTask.id)}
        onDelete={() => { handleDelete(selectedTask.id); setShowDetail(false); }}
        onTagPress={() => {}}
        onToggleSubtask={handleToggleSubtask}
      />

      {/* Task List or Calendar View */}
      {viewMode === 'calendar' ? (
        <CalendarView
          tasks={tasks}
          selectedProject={selectedProject}
          selectedTags={selectedTags}
          tagFilterMode={tagFilterMode}
          onTaskPress={openDetail}
          onTaskLongPress={openEditForm}
          onToggleComplete={handleToggleComplete}
          onUpdateTask={handleUpdateTask}
          onAddTask={(title, project, dueDate) => {
            const newTask = {
              title: title,
              description: '',
              priority: 'medium',
              completed: false,
              project: project,
              dueDate: dueDate,
              tags: [],
              subtasks: [],
              id: Date.now().toString(),
              createdAt: Date.now()
            };
            handleSaveTask(newTask);
          }}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onDateChange={lazyRefresh}
        />
      ) : (
        <View style={{ flex: 1 }}>
          <SectionList
            ref={listRef}
            sections={collapsible.groupedData}
            keyExtractor={(item, index) => item?.id || `section-${index}`}
            onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={16}
            renderItem={({ item, section }) => {
              if (!item) return null;
              // Only render tasks if tag group is expanded
              if (section.type !== 'tag') return null;
              if (!section.isExpanded) return null;
              
              return (
                <TaskItem 
                  item={item} 
                  onPress={() => openDetail(item)}
                  onToggleComplete={handleToggleComplete}
                  onLongPress={openEditForm}
                  onAddSubtask={handleAddSubtask}
                  onToggleSubtask={handleToggleSubtask}
                  onDeleteSubtask={handleDeleteSubtask}
                  onUpdateSubtask={handleUpdateSubtask}
                  onUpdateTask={handleUpdateTask}
                  onDeleteTask={handleDelete}
                  listRef={listRef}
                  scrollY={scrollY}
                  scrollToItem={() => scrollToItem(item.id)}
                  keyboardVisible={keyboardVisible}
                />
              );
            }}
            renderSectionHeader={({ section }) => {
              if (section.type === 'project') {
                // Project header with collapse toggle
                return (
                  <View>
                    <TouchableOpacity
                      style={styles.projectHeader}
                      onPress={() => collapsible.toggleProjectExpand(section.project)}
                      activeOpacity={0.7}
                    >
                      <Animated.View style={{
                        transform: [{
                          rotate: (projectRotations[section.project] || new Animated.Value(0)).interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0deg', '90deg']
                          })
                        }]
                      }}>
                        <Icon name="chevron-right" size={24} color={getProjectColor(section.project)} />
                      </Animated.View>
                      <Text style={styles.projectHeaderText}>{section.title}</Text>
                    </TouchableOpacity>
                    
                    {/* Add task input - shown when project is expanded */}
                    {section.isExpanded && (
                      inlineAddingProject === section.project ? (
                        // Inline input mode
                        <View style={styles.projectAddTaskContainer}>
                          <TextInput
                            ref={inlineInputRef}
                            style={styles.projectAddTaskInputField}
                            placeholder="Add a new task"
                            placeholderTextColor={theme.colors.textPlaceholder}
                            value={inlineTaskTitle}
                            onChangeText={setInlineTaskTitle}
                            onSubmitEditing={() => {
                              if (inlineTaskTitle.trim()) {
                                handleInlineAdd(section.project, [], inlineTaskTitle.trim());
                                setInlineTaskTitle('');
                                setInlineAddingProject(null);
                              }
                            }}
                            autoFocus
                            blurOnSubmit={false}
                            returnKeyType="done"
                            onBlur={() => {
                              // Delay to allow button press first
                              setTimeout(() => {
                                setInlineTaskTitle('');
                                setInlineAddingProject(null);
                              }, 200);
                            }}
                          />
                          <TouchableOpacity 
                            style={styles.projectAddTaskClose}
                            onPress={() => {
                              setInlineTaskTitle('');
                            setInlineAddingProject(null);
                            }}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          >
                            <Icon name="close" size={18} color={theme.colors.textTertiary} />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        // Placeholder mode
                        <TouchableOpacity
                          style={styles.projectAddTaskPlaceholder}
                          onPress={() => setInlineAddingProject(section.project)}
                          activeOpacity={0.7}
                        >
                          <View style={styles.projectAddTaskInput} pointerEvents="none">
                            <Text style={styles.projectAddTaskText}>Add a new task</Text>
                          </View>
                        </TouchableOpacity>
                      )
                    )}
                  </View>
                );
              }
              
              // Tag group header - only shown if parent project is expanded
              return (
                <SectionHeader
                  section={section}
                  expanded={section.isExpanded}
                  onToggleExpand={() => collapsible.toggleTagGroupExpand(section.project, section.title)}
                  onAddTask={handleInlineAdd}
                  onRenameTag={handleRenameTag}
                  onAddTagToSection={handleAddTagToSection}
                  projectColor={getProjectColor(section.project)}
                />
              );
            }}
            contentContainerStyle={[
              styles.list,
              { paddingBottom: Math.max(100, keyboardHeight + 20) }
            ]}
            stickySectionHeadersEnabled={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.colors.accentPrimary}
                colors={[theme.colors.accentPrimary]}
              />
            }
            ListEmptyComponent={(
              <View style={styles.emptyState}>
                <Icon name="folder-open" size={64} color={theme.colors.textMuted} />
                <Text style={styles.emptyText}>
                  {showIncompleteOnly && tasks.some(t => t.completed)
                    ? 'No incomplete tasks'
                    : 'No tasks yet'}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setEditingTask(null);
                    setShowTaskForm(true);
                  }}
                  style={styles.addNewTaskBtn}
                >
                  <Icon name="plus" size={20} color={theme.colors.textPrimary} />
                  <Text style={styles.addNewTaskText}>Add new task</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        </View>
      )}

      {/* Filter FAB */}
      <TouchableOpacity 
        style={[styles.filterFab, hasActiveFilters && styles.filterFabActive]}
        onPress={() => setShowFilterMenu(true)}
      >
        <Icon name="filter-variant" size={22} color={theme.colors.textPrimary} />
        {hasActiveFilters && (
          <View style={styles.filterBadge}>
            <Text style={styles.filterBadgeText}>
              {selectedTags.length + (!showIncompleteOnly ? 1 : 0)}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

const createStyles = (theme) => StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: theme.colors.background 
  },
  centerContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: theme.colors.background 
  },
  offlineText: { 
    fontSize: theme.typography.body, 
    color: theme.colors.textSecondary, 
    marginTop: 16,
    fontWeight: '600',
  },
  offlineSubtext: { 
    fontSize: theme.typography.body, 
    color: theme.colors.textTertiary, 
    marginTop: 8 
  },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  projectSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  projectSelectorText: { 
    fontSize: theme.typography.body, 
    fontWeight: '600', 
    marginLeft: 8, 
    marginRight: 8,
    color: theme.colors.textPrimary 
  },
  projectSelectorSquare: {
    width: 16,
    height: 16,
    borderRadius: 3,
  },
  statsContainer: { 
    alignItems: 'flex-end' 
  },
  statsText: { 
    fontSize: theme.typography.body, 
    color: theme.colors.textTertiary, 
    marginBottom: 4 
  },
  progressBar: { 
    width: 60, 
    height: 4, 
    backgroundColor: theme.colors.surface, 
    borderRadius: 2, 
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  progressFill: { 
    height: '100%', 
    backgroundColor: theme.colors.surfaceElevated, 
    borderRadius: 2 
  },
  
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewToggle: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    padding: 2,
    marginRight: 12,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  viewBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  viewBtnActive: {
    backgroundColor: theme.colors.surfaceElevated,
  },
  
  projectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  projectHeaderText: {
    fontSize: theme.typography.body,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    marginLeft: theme.spacing.sm,
    flex: 1,
  },
  projectTaskCount: {
    fontSize: theme.typography.body,
    color: theme.colors.textTertiary,
    backgroundColor: theme.colors.surfaceHighlight,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.pill,
    marginRight: theme.spacing.sm,
  },

  projectAddTaskPlaceholder: {
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  projectAddTaskInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 6,
    padding: 8,
    paddingLeft: theme.spacing.xl,
  },
  projectAddTaskText: {
    fontSize: theme.typography.body,
    color: theme.colors.textPlaceholder,
  },
  projectAddTaskContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  projectAddTaskInputField: {
    flex: 1,
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 6,
    padding: 8,
    paddingLeft: theme.spacing.xl,
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    marginRight: 8,
  },
  projectAddTaskClose: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  activeFiltersBar: {
    backgroundColor: theme.colors.background,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    marginRight: 8,
  },
  warningChip: { 
    backgroundColor: 'rgba(255, 193, 7, 0.15)' 
  },
  tagFilterChip: { 
    backgroundColor: theme.colors.surface 
  },
  filterChipText: { 
    fontSize: theme.typography.body, 
    color: theme.colors.textPrimary, 
    marginHorizontal: 4 
  },
  warningChipText: { 
    color: theme.colors.accentWarning 
  },
  tagFilterChipText: { 
    color: theme.colors.textSecondary 
  },
  
  list: { 
    paddingBottom: 100 
  },
  emptyState: { 
    alignItems: 'flex-start',
    marginTop: 80,
    paddingLeft: theme.spacing.xl,
    paddingRight: theme.spacing.md,
  },
  emptyText: { 
    marginTop: 16, 
    color: theme.colors.textSecondary, 
    fontSize: theme.typography.body 
  },
  addNewTaskBtn: { 
    marginTop: 20, 
    backgroundColor: theme.colors.surfaceElevated, 
    paddingHorizontal: 24, 
    paddingVertical: 12, 
    borderRadius: 24, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  addNewTaskText: { 
    color: theme.colors.textPrimary, 
    fontWeight: '600', 
    marginLeft: 8, 
    fontSize: theme.typography.body 
  },

  filterFab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: theme.colors.border,
    shadowColor: theme.colors.border,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  filterFabActive: { 
    backgroundColor: theme.colors.surfaceElevated 
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: theme.colors.accentError,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterBadgeText: { 
    color: '#FFFFFF', 
    fontSize: theme.typography.body, 
    fontWeight: 'bold', 
    paddingHorizontal: 4 
  },
});
