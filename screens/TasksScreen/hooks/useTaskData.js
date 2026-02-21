import { useState, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';

export const useTaskData = (api, isConnected) => {
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!isConnected) return;
    setLoading(true);
    try {
      const [tasksData, projectsData, tagsData] = await Promise.all([
        api.get('/tasks'),
        api.get('/projects'),
        api.get('/tags')
      ]);
      setTasks(tasksData);
      setProjects(projectsData);
      setAllTags(tagsData || []);
    } catch (error) {
      Alert.alert('Error', 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [api, isConnected]);

  const saveTasks = async (newTasks) => {
    try {
      await api.post('/tasks', newTasks);
      setTasks(newTasks);
    } catch (error) {
      Alert.alert('Error', 'Failed to save tasks');
    }
  };

  const collectTags = async (tagsArray) => {
    const newTags = tagsArray.filter(tag => !allTags.includes(tag));
    if (newTags.length === 0) return;
    try {
      await api.post('/tags/collect', { tags: newTags });
      setAllTags(prev => [...prev, ...newTags].sort());
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
      Alert.alert('Error', 'Failed to add project');
      return false;
    }
  };

  const deleteProject = async (name, options = {}) => {
    const { onDeleteTasks } = options;
    try {
      if (onDeleteTasks) {
        const newTasks = tasks.filter(t => t.project !== name);
        await api.post('/tasks', newTasks);
      }
      await api.delete(`/projects/${encodeURIComponent(name)}`);
      await loadData();
      return true;
    } catch (error) {
      Alert.alert('Error', 'Failed to delete project');
      return false;
    }
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  return {
    tasks, setTasks, projects, setProjects, allTags, setAllTags, loading,
    loadData, saveTasks, collectTags, addProject, deleteProject
  };
};