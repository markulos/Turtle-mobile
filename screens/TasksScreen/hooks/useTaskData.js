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
  // Always-current snapshot of `tasks` so the mutation handlers below read the
  // LATEST array even when an old handler instance is held by a memoized
  // TaskItem row — otherwise toggling a second task with a stale closure would
  // silently revert the first. Updated synchronously every render.
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
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
      // Guard against a non-array server payload — otherwise projects.forEach/.map
      // elsewhere throws "undefined is not a function" outside any try/catch.
      setTasks(Array.isArray(tasksData) ? tasksData.map(t => ({ ...t, subtasks: t.subtasks || [] })) : []);
      setProjects(Array.isArray(projectsData) ? projectsData : []);
      setAllTags(Array.isArray(tagsData) ? tagsData : []);
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

  // Optimistic-first: paint the new state immediately so the UI feels instant,
  // then persist in the background. If the server rejects, roll back to the
  // exact pre-mutation snapshot and tell the user. Every task mutation (toggle,
  // recurring-advance, edit, subtask add/toggle/delete, delete task) funnels
  // through here, so this single change makes the whole task screen snappy.
  // Mirrors the photo-vault commitTags pattern.
  const saveTasks = async (newTasks) => {
    const prevTasks = tasksRef.current; // snapshot for rollback
    setTasks(newTasks);                 // 1. instant UI update
    try {
      await api.post('/tasks', newTasks); // 2. confirm with backend
    } catch (error) {
      console.error('Save tasks error:', error);
      setTasks(prevTasks);             // 3. revert on failure
      Alert.alert('Error', 'Failed to save — that change was undone');
      throw error; // Re-throw so caller knows it failed
    }
  };

  // Subtask handlers
  const handleAddSubtask = async (taskId, title) => {
    try {
      const newTasks = tasksRef.current.map(t => {
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
      const newTasks = tasksRef.current.map(t => {
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
      const newTasks = tasksRef.current.map(t => {
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
      const newTasks = tasksRef.current.map(t => {
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

  // Optimistic-first (like saveTasks): show the project immediately, persist in
  // the background, sync to the server's authoritative list on success, revert
  // on failure.
  const addProject = async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const alreadyExists = projects.includes(trimmed);
    if (!alreadyExists) {
      setProjects(prev =>
        prev.includes(trimmed) ? prev : [...prev, trimmed].sort((a, b) => a.localeCompare(b)),
      );
    }
    try {
      const res = await api.post('/projects/add', { name: trimmed });
      if (res && Array.isArray(res.projects)) setProjects(res.projects); // server truth
      return true;
    } catch (error) {
      console.error('Add project error:', error);
      if (!alreadyExists) setProjects(prev => prev.filter(p => p !== trimmed)); // rollback
      Alert.alert('Error', 'Failed to add project');
      return false;
    }
  };

  const deleteTask = async (taskId) => {
    try {
      const newTasks = tasksRef.current.filter(t => t.id !== taskId);
      await saveTasks(newTasks);
      return true;
    } catch (error) {
      console.error('Delete task error:', error);
      Alert.alert('Error', 'Failed to delete task');
      return false;
    }
  };

  // Optimistic-first. Preserves existing semantics: when onDeleteTasks is set
  // (the project has tasks), those tasks are DELETED along with the project, not
  // just un-assigned. Snapshot both lists for rollback.
  const deleteProject = async (name, options = {}) => {
    const { onDeleteTasks } = options;
    const prevProjects = projects;
    const prevTasks = tasksRef.current;
    const newTasks = onDeleteTasks ? prevTasks.filter(t => t.project !== name) : prevTasks;

    // 1. Instant UI: drop the project (and its tasks, if any) now.
    setProjects(prev => prev.filter(p => p !== name));
    if (onDeleteTasks) setTasks(newTasks);

    try {
      // 2. Persist in the background — tasks first (so the deletes land), then
      //    remove the project itself.
      if (onDeleteTasks) await api.post('/tasks', newTasks);
      await api.delete(`/projects/${encodeURIComponent(name)}`);
      return true;
    } catch (error) {
      console.error('Delete project error:', error);
      setProjects(prevProjects);            // 3. revert both on failure
      if (onDeleteTasks) setTasks(prevTasks);
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