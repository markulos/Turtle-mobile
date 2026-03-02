import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { 
  toggleSubtaskComplete, 
  addSubtask, 
  deleteSubtask, 
  updateSubtask,
  areAllSubtasksCompleted 
} from '../utils/taskHelpers';

export const useTaskData = (api, isConnected) => {
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  
  // Track last refresh time for lazy loading (min interval between refreshes)
  const lastRefreshRef = useRef(0);
  const MIN_REFRESH_INTERVAL = 2000; // 2 seconds minimum between manual refreshes

  const loadData = useCallback(async (opts = {}) => {
    const { silent = false, force = false } = opts;
    if (!isConnected) return;
    
    // Lazy loading: prevent rapid successive refreshes unless forced
    const now = Date.now();
    if (!force && !silent && now - lastRefreshRef.current < MIN_REFRESH_INTERVAL) {
      console.log('[useTaskData] Skipping refresh - too soon');
      return;
    }
    
    if (!silent) setLoading(true);
    try {
      const [tasksData, projectsData, tagsData] = await Promise.all([
        api.get('/tasks'),
        api.get('/projects'),
        api.get('/tags')
      ]);
      // Ensure subtasks array exists on each task
      setTasks(tasksData.map(t => ({ ...t, subtasks: t.subtasks || [] })));
      setProjects(projectsData);
      setAllTags(tagsData || []);
      lastRefreshRef.current = now;
    } catch (error) {
      console.error('Load data error:', error);
      if (!silent) Alert.alert('Error', 'Failed to load data');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [api, isConnected]);
  
  // Pull-to-refresh handler
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData({ silent: true, force: true });
    setRefreshing(false);
  }, [loadData]);
  
  // Lazy refresh - only refreshes if enough time has passed
  const lazyRefresh = useCallback(async () => {
    await loadData({ silent: true });
  }, [loadData]);

  const saveTasks = async (newTasks) => {
    try {
      await api.post('/tasks', newTasks);
      setTasks(newTasks);
    } catch (error) {
      console.error('Save tasks error:', error);
      Alert.alert('Error', 'Failed to save tasks');
      throw error; // Re-throw so caller knows it failed
    }
  };

  // Subtask handlers
  const handleAddSubtask = async (taskId, title) => {
    try {
      const newTasks = tasks.map(t => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          subtasks: addSubtask(t.subtasks, title)
        };
      });
      await saveTasks(newTasks);
    } catch (error) {
      console.error('Add subtask error:', error);
    }
  };

  const handleToggleSubtask = async (taskId, subtaskId) => {
    try {
      const newTasks = tasks.map(t => {
        if (t.id !== taskId) return t;
        
        const updatedSubtasks = toggleSubtaskComplete(t.subtasks, subtaskId);
        const allDone = areAllSubtasksCompleted(updatedSubtasks);
        
        return {
          ...t,
          subtasks: updatedSubtasks,
          completed: allDone,
          completedAt: allDone ? Date.now() : null,
          completedTime: allDone ? new Date().toISOString() : null
        };
      });
      await saveTasks(newTasks);
    } catch (error) {
      console.error('Toggle subtask error:', error);
    }
  };

  const handleDeleteSubtask = async (taskId, subtaskId) => {
    try {
      const newTasks = tasks.map(t => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          subtasks: deleteSubtask(t.subtasks, subtaskId)
        };
      });
      await saveTasks(newTasks);
    } catch (error) {
      console.error('Delete subtask error:', error);
    }
  };

  const handleUpdateSubtask = async (taskId, subtaskId, updates) => {
    try {
      const newTasks = tasks.map(t => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          subtasks: updateSubtask(t.subtasks, subtaskId, updates)
        };
      });
      await saveTasks(newTasks);
    } catch (error) {
      console.error('Update subtask error:', error);
    }
  };

  const collectTags = async (tagsArray) => {
    const newTags = tagsArray.filter(tag => !allTags.includes(tag));
    if (newTags.length === 0) return;
    try {
      await api.post('/tags/collect', { tags: newTags });
      setAllTags([...allTags, ...newTags].sort());
    } catch (error) {
      console.error('Failed to collect tags', error);
    }
  };

  const addProject = async (name) => {
    if (!name.trim()) return false;
    try {
      await api.post('/projects/add', { name: name.trim() });
      await loadData();
      return true;
    } catch (error) {
      console.error('Add project error:', error);
      Alert.alert('Error', 'Failed to add project');
      return false;
    }
  };

  const deleteTask = async (taskId) => {
    try {
      const newTasks = tasks.filter(t => t.id !== taskId);
      await saveTasks(newTasks);
      return true;
    } catch (error) {
      console.error('Delete task error:', error);
      Alert.alert('Error', 'Failed to delete task');
      return false;
    }
  };

  const deleteProject = async (name, options = {}) => {
    const { onDeleteTasks } = options;
    try {
      // First update tasks if needed
      if (onDeleteTasks) {
        const newTasks = tasks.filter(t => t.project !== name);
        await api.post('/tasks', newTasks);
      }
      // Then delete project - FIXED: use correct endpoint format
      await api.delete(`/projects/${encodeURIComponent(name)}`);
      await loadData();
      return true;
    } catch (error) {
      console.error('Delete project error:', error);
      Alert.alert('Error', 'Failed to delete project');
      return false;
    }
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  return {
    tasks, setTasks, projects, setProjects, allTags, setAllTags, loading,
    loadData, saveTasks, collectTags, addProject, deleteProject, deleteTask,
    handleAddSubtask,
    handleToggleSubtask,
    handleDeleteSubtask,
    handleUpdateSubtask,
    refreshing,
    onRefresh,
    lazyRefresh,
  };
};