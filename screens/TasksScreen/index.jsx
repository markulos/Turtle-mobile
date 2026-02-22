import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServer } from '../../context/ServerContext';
import { useTheme } from '../../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTaskData } from './hooks/useTaskData';
import { useTaskFilters } from './hooks/useTaskFilters';
import {
  ProjectDropdown,
  FilterMenu,
  ProjectManager,
  TaskForm,
  TaskDetail,
  TaskItem,
  SectionHeader,
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

  const {
    tasks, setTasks, projects, allTags,
    loadData, saveTasks, collectTags, addProject, deleteProject,
    handleAddSubtask,
    handleToggleSubtask,
    handleDeleteSubtask,
    handleUpdateSubtask,
  } = useTaskData(api, isConnected);

  const filters = useTaskFilters(tasks, projects);

  useEffect(() => {
    if (showFilterMenu) {
      Animated.spring(menuAnimation, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
    } else {
      Animated.timing(menuAnimation, { toValue: 0, duration: 200, useNativeDriver: true }).start();
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

  const handleDelete = (id) => {
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

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Custom Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.projectSelector}
          onPress={() => setShowDropdown(true)}
        >
          <Icon name="folder" size={20} color={theme.colors.textPrimary} />
          <Text style={styles.projectSelectorText} numberOfLines={1}>{filters.selectedProject}</Text>
          <Icon name="chevron-down" size={18} color={theme.colors.textTertiary} />
        </TouchableOpacity>
        
        <View style={styles.statsContainer}>
          <Text style={styles.statsText}>{filters.stats.completed}/{filters.stats.total}</Text>
          <View style={styles.progressBar}>
            <View style={[
              styles.progressFill, 
              { width: filters.stats.total ? `${(filters.stats.completed/filters.stats.total)*100}%` : '0%' }
            ]} />
          </View>
        </View>
      </View>

      {/* Active Filters */}
      {filters.hasActiveFilters && (
        <View style={styles.activeFiltersBar}>
          <Animated.ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {!filters.showIncompleteOnly && (
              <View style={[styles.filterChip, styles.warningChip]}>
                <Icon name="eye-off" size={12} color={theme.colors.accentWarning} />
                <Text style={[styles.filterChipText, styles.warningChipText]}>Showing Completed</Text>
                <TouchableOpacity onPress={() => filters.setShowIncompleteOnly(true)}>
                  <Icon name="close" size={14} color={theme.colors.textTertiary} />
                </TouchableOpacity>
              </View>
            )}
            {filters.selectedProject !== 'All' && (
              <View style={styles.filterChip}>
                <Icon name="folder" size={12} color={theme.colors.textPrimary} />
                <Text style={styles.filterChipText}>{filters.selectedProject}</Text>
                <TouchableOpacity onPress={() => filters.setSelectedProject('All')}>
                  <Icon name="close" size={14} color={theme.colors.textTertiary} />
                </TouchableOpacity>
              </View>
            )}
            {filters.selectedTags.map(tag => (
              <View key={tag} style={[styles.filterChip, styles.tagFilterChip]}>
                <Icon name="tag" size={12} color={theme.colors.textPrimary} />
                <Text style={[styles.filterChipText, styles.tagFilterChipText]}>{tag}</Text>
                <TouchableOpacity onPress={() => filters.toggleTagFilter(tag)}>
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
        selected={filters.selectedProject}
        onSelect={filters.setSelectedProject}
        onManage={() => setShowProjectManager(true)}
        onAddProject={addProject}
      />

      <FilterMenu
        visible={showFilterMenu}
        onClose={() => setShowFilterMenu(false)}
        allTags={allTags}
        filters={filters}
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
        initialData={editingTask}
        projects={projects}
        allTags={allTags}
        onAddProject={addProject}
      />

      <TaskDetail
        task={selectedTask}
        visible={showDetail}
        onClose={() => setShowDetail(false)}
        onEdit={() => { setShowDetail(false); openEditForm(selectedTask); }}
        onToggleComplete={() => handleToggleComplete(selectedTask.id)}
        onDelete={() => { handleDelete(selectedTask.id); setShowDetail(false); }}
        onTagPress={filters.toggleTagFilter}
      />

      {/* Task List */}
      <SectionList
        sections={filters.groupedTasks}
        keyExtractor={(item) => item.id}
        renderItem={({ item, section }) => {
          if (section.type === 'project') return null;
          const tagKey = `${section.project}-${section.title}`;
          if (filters.expandedTags[tagKey] === false) return null;
          
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
            />
          );
        }}
        renderSectionHeader={({ section }) => (
          <SectionHeader
            section={section}
            expandedTags={filters.expandedTags}
            onToggleExpand={filters.toggleTagExpand}
            onAddTask={handleInlineAdd}
          />
        )}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Icon name="folder-open" size={64} color={theme.colors.textMuted} />
            <Text style={styles.emptyText}>
              {filters.showIncompleteOnly && tasks.some(t => t.completed)
                ? 'No incomplete tasks match filters'
                : 'No tasks match filters'}
            </Text>
            <TouchableOpacity onPress={filters.clearFilters} style={styles.clearFiltersBtn}>
              <Text style={styles.clearFiltersText}>Clear filters</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setEditingTask(null);
                setShowTaskForm(true);
              }}
              style={styles.addNewTaskBtn}
            >
              <Icon name="plus" size={20} color={theme.colors.background} />
              <Text style={styles.addNewTaskText}>Add new task</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* FABs */}
      <View style={styles.fabContainer}>
        <TouchableOpacity 
          style={[styles.filterFab, filters.hasActiveFilters && styles.filterFabActive]}
          onPress={() => setShowFilterMenu(true)}
        >
          <Icon name="filter-variant" size={22} color={theme.colors.background} />
          {filters.hasActiveFilters && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>
                {filters.selectedTags.length + 
                 (filters.selectedProject !== 'All' ? 1 : 0) +
                 (!filters.showIncompleteOnly ? 1 : 0)}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.addFab} 
          onPress={() => {
            const targetProject = filters.selectedProject !== 'All' 
              ? filters.selectedProject 
              : (projects[0] || '');
            handleInlineAdd(targetProject, [], 'New Task');
          }}
          onLongPress={() => {
            setEditingTask(null);
            setShowTaskForm(true);
          }}
          delayLongPress={500}
        >
          <Icon name="plus" size={28} color={theme.colors.background} />
        </TouchableOpacity>
      </View>
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
    fontSize: 17, 
    color: theme.colors.textSecondary, 
    marginTop: 16,
    fontWeight: '600',
  },
  offlineSubtext: { 
    fontSize: 15, 
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
    fontSize: 15, 
    fontWeight: '600', 
    marginLeft: 8, 
    marginRight: 8,
    color: theme.colors.textPrimary 
  },
  statsContainer: { 
    alignItems: 'flex-end' 
  },
  statsText: { 
    fontSize: 13, 
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
  tagFilterChip: { 
    backgroundColor: theme.colors.surface 
  },
  warningChip: { 
    backgroundColor: 'rgba(255, 193, 7, 0.15)' 
  },
  filterChipText: { 
    fontSize: 12, 
    color: theme.colors.textPrimary, 
    marginHorizontal: 4 
  },
  tagFilterChipText: { 
    color: theme.colors.textSecondary 
  },
  warningChipText: { 
    color: theme.colors.accentWarning 
  },
  
  list: { 
    paddingBottom: 100 
  },
  emptyState: { 
    alignItems: 'center', 
    marginTop: 80 
  },
  emptyText: { 
    marginTop: 16, 
    color: theme.colors.textSecondary, 
    fontSize: 16 
  },
  clearFiltersBtn: { 
    marginTop: 16, 
    backgroundColor: theme.colors.surfaceElevated, 
    paddingHorizontal: 20, 
    paddingVertical: 10, 
    borderRadius: 20 
  },
  clearFiltersText: { 
    color: theme.colors.textPrimary, 
    fontWeight: '600' 
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
    fontSize: 16 
  },

  fabContainer: { 
    position: 'absolute', 
    right: 16, 
    bottom: 16, 
    flexDirection: 'row', 
    alignItems: 'flex-end' 
  },
  filterFab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
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
    color: theme.colors.textPrimary, 
    fontSize: 12, 
    fontWeight: 'bold', 
    paddingHorizontal: 4 
  },
  addFab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: theme.colors.border,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
});
