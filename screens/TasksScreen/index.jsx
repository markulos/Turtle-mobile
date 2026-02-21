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
import { useServer } from '../../context/ServerContext';
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
    loadData, saveTasks, collectTags, addProject, deleteProject
  } = useTaskData(api, isConnected);

  const filters = useTaskFilters(tasks);

  useEffect(() => {
    if (showFilterMenu) {
      Animated.spring(menuAnimation, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
    } else {
      Animated.timing(menuAnimation, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }
  }, [showFilterMenu, menuAnimation]);

  const handleSaveTask = async (taskData) => {
    if (taskData.tags.length > 0) await collectTags(taskData.tags);
    
    const newTasks = taskData.id && tasks.find(t => t.id === taskData.id)
      ? tasks.map(t => t.id === taskData.id ? taskData : t)
      : [...tasks, taskData];
    
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

  const openTaskForm = (task = null) => {
    setEditingTask(task);
    setShowTaskForm(true);
  };

  const openDetail = (task) => {
    setSelectedTask(task);
    setShowDetail(true);
  };

  if (!isConnected) {
    return (
      <View style={styles.centerContainer}>
        <Icon name="lan-disconnect" size={60} color="#999" />
        <Text style={styles.offlineText}>Not connected to server</Text>
        <Text style={styles.offlineSubtext}>Go to Settings to configure connection</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.projectSelector}
          onPress={() => setShowDropdown(true)}
        >
          <Icon name="folder" size={24} color="#4CAF50" />
          <Text style={styles.projectSelectorText} numberOfLines={1}>{filters.selectedProject}</Text>
          <Icon name="chevron-down" size={20} color="#666" />
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
            {filters.selectedProject !== 'All' && (
              <View style={styles.filterChip}>
                <Icon name="folder" size={12} color="#4CAF50" />
                <Text style={styles.filterChipText}>{filters.selectedProject}</Text>
                <TouchableOpacity onPress={() => filters.setSelectedProject('All')}>
                  <Icon name="close" size={14} color="#666" />
                </TouchableOpacity>
              </View>
            )}
            {filters.selectedTags.map(tag => (
              <View key={tag} style={[styles.filterChip, styles.tagFilterChip]}>
                <Icon name="tag" size={12} color="#2196F3" />
                <Text style={[styles.filterChipText, styles.tagFilterChipText]}>{tag}</Text>
                <TouchableOpacity onPress={() => filters.toggleTagFilter(tag)}>
                  <Icon name="close" size={14} color="#666" />
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
        onClose={() => setShowTaskForm(false)}
        onSave={handleSaveTask}
        initialData={editingTask}
        projects={projects}
        onAddProject={addProject}
      />

      <TaskDetail
        task={selectedTask}
        visible={showDetail}
        onClose={() => setShowDetail(false)}
        onEdit={() => { setShowDetail(false); openTaskForm(selectedTask); }}
        onToggleComplete={() => handleToggleComplete(selectedTask.id)}
        onDelete={() => { handleDelete(selectedTask.id); setShowDetail(false); }}
        onTagPress={filters.toggleTagFilter}
      />

      {/* Task List */}
      <SectionList
        sections={filters.groupedTasks}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TaskItem 
            item={item} 
            onPress={openDetail}
            onToggleComplete={handleToggleComplete}
          />
        )}
        renderSectionHeader={({ section }) => (
          <SectionHeader 
            section={section} 
            expandedTags={filters.expandedTags}
            onToggleExpand={filters.toggleTagExpand}
          />
        )}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Icon name="folder-open" size={60} color="#ccc" />
            <Text style={styles.emptyText}>No tasks match filters</Text>
            <TouchableOpacity onPress={filters.clearFilters} style={styles.clearFiltersBtn}>
              <Text style={styles.clearFiltersText}>Clear filters</Text>
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
          <Icon name="filter-variant" size={24} color="#fff" />
          {filters.hasActiveFilters && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>
                {filters.selectedTags.length + (filters.selectedProject !== 'All' ? 1 : 0)}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.addFab} onPress={() => openTaskForm()}>
          <Icon name="plus" size={30} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' },
  offlineText: { fontSize: 18, color: '#666', marginTop: 10 },
  offlineSubtext: { fontSize: 14, color: '#999', marginTop: 5 },
  
  header: {
    backgroundColor: '#fff',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  projectSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 10,
    flex: 1,
    marginRight: 15,
  },
  projectSelectorText: { fontSize: 16, fontWeight: '600', marginLeft: 10, flex: 1, color: '#333' },
  statsContainer: { alignItems: 'flex-end' },
  statsText: { fontSize: 14, color: '#666', marginBottom: 4 },
  progressBar: { width: 60, height: 4, backgroundColor: '#e0e0e0', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#4CAF50', borderRadius: 2 },
  
  activeFiltersBar: {
    backgroundColor: '#fff',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 15,
    marginRight: 8,
  },
  tagFilterChip: { backgroundColor: '#e3f2fd' },
  filterChipText: { fontSize: 12, color: '#4CAF50', marginHorizontal: 4 },
  tagFilterChipText: { color: '#2196F3' },
  
  list: { paddingBottom: 100 },
  emptyState: { alignItems: 'center', marginTop: 100 },
  emptyText: { marginTop: 10, color: '#999', fontSize: 16 },
  clearFiltersBtn: { marginTop: 15, backgroundColor: '#4CAF50', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  clearFiltersText: { color: '#fff', fontWeight: '600' },
  
  fabContainer: { position: 'absolute', right: 20, bottom: 20, flexDirection: 'row', alignItems: 'flex-end' },
  filterFab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#2196F3',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  filterFabActive: { backgroundColor: '#1976d2' },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#f44336',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterBadgeText: { color: '#fff', fontSize: 12, fontWeight: 'bold', paddingHorizontal: 4 },
  addFab: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
});