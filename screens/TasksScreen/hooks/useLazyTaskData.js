import { useState, useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';

/**
 * Hook for lazy loading task data
 * Only fetches tasks when a project or tag group is expanded
 */
export const useLazyTaskData = (api, isConnected) => {
  // Core data
  const [projects, setProjects] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [projectCounts, setProjectCounts] = useState({}); // { projectName: { total, completed } }
  const [loading, setLoading] = useState(false);
  
  // Lazy loaded task cache: { 'projectName': { tasks, loadedAt, tagGroups: { 'tagKey': tasks } } }
  const [taskCache, setTaskCache] = useState({});
  
  // Track which sections are expanded
  const [expandedProjects, setExpandedProjects] = useState({});
  const [expandedTagGroups, setExpandedTagGroups] = useState({});
  
  // Load initial data (projects, tags, counts only - not all tasks)
  const loadInitialData = useCallback(async () => {
    if (!isConnected) return;
    setLoading(true);
    try {
      const [projectsData, tagsData, countsData] = await Promise.all([
        api.get('/projects'),
        api.get('/tags'),
        api.get('/tasks/counts?incomplete=true')
      ]);
      
      setProjects(projectsData);
      setAllTags(tagsData || []);
      
      // Convert counts array to object
      const countsMap = {};
      countsData.forEach(c => {
        countsMap[c.project] = { total: c.total, completed: c.completed };
      });
      setProjectCounts(countsMap);
      
    } catch (error) {
      console.error('Load initial data error:', error);
    } finally {
      setLoading(false);
    }
  }, [api, isConnected]);

  // Load tasks for a specific project
  const loadProjectTasks = useCallback(async (projectName, options = {}) => {
    if (!isConnected) return;
    const { showIncompleteOnly = true, force = false } = options;
    
    const cacheKey = projectName || 'No Project';
    const cached = taskCache[cacheKey];
    
    // Return cached data if available and not forced
    if (!force && cached?.tasks && Date.now() - cached.loadedAt < 60000) {
      return cached.tasks;
    }
    
    try {
      const encodedProject = encodeURIComponent(cacheKey);
      const tasks = await api.get(`/tasks/project/${encodedProject}?incomplete=${showIncompleteOnly}`);
      
      setTaskCache(prev => ({
        ...prev,
        [cacheKey]: {
          ...prev[cacheKey],
          tasks,
          loadedAt: Date.now()
        }
      }));
      
      return tasks;
    } catch (error) {
      console.error(`Error loading tasks for ${projectName}:`, error);
      return [];
    }
  }, [api, isConnected, taskCache]);

  // Load tasks for a specific tag group within a project
  const loadTagGroupTasks = useCallback(async (projectName, tagKey, options = {}) => {
    if (!isConnected) return;
    const { showIncompleteOnly = true, force = false } = options;
    
    const projectKey = projectName || 'No Project';
    const tagCacheKey = `${projectKey}::${tagKey}`;
    const cached = taskCache[projectKey]?.tagGroups?.[tagKey];
    
    // Return cached data if available and not forced
    if (!force && cached?.tasks && Date.now() - cached.loadedAt < 60000) {
      return cached.tasks;
    }
    
    try {
      const encodedProject = encodeURIComponent(projectKey);
      const encodedTags = encodeURIComponent(tagKey);
      const tasks = await api.get(`/tasks/project/${encodedProject}/tags/${encodedTags}?incomplete=${showIncompleteOnly}`);
      
      setTaskCache(prev => ({
        ...prev,
        [projectKey]: {
          ...prev[projectKey],
          tagGroups: {
            ...prev[projectKey]?.tagGroups,
            [tagKey]: {
              tasks,
              loadedAt: Date.now()
            }
          }
        }
      }));
      
      return tasks;
    } catch (error) {
      console.error(`Error loading tasks for ${projectName}/${tagKey}:`, error);
      return [];
    }
  }, [api, isConnected, taskCache]);

  // Toggle project expansion (triggers lazy load)
  const toggleProjectExpand = useCallback(async (projectName, options = {}) => {
    const key = projectName || 'No Project';
    const isExpanding = !expandedProjects[key];
    
    setExpandedProjects(prev => ({
      ...prev,
      [key]: isExpanding
    }));
    
    // Load tasks when expanding
    if (isExpanding) {
      await loadProjectTasks(projectName, options);
    }
  }, [expandedProjects, loadProjectTasks]);

  // Toggle tag group expansion (triggers lazy load)
  const toggleTagGroupExpand = useCallback(async (projectName, tagKey, options = {}) => {
    const key = `${projectName || 'No Project'}::${tagKey}`;
    const isExpanding = !expandedTagGroups[key];
    
    setExpandedTagGroups(prev => ({
      ...prev,
      [key]: isExpanding
    }));
    
    // Load tasks when expanding
    if (isExpanding) {
      await loadTagGroupTasks(projectName, tagKey, options);
    }
  }, [expandedTagGroups, loadTagGroupTasks]);

  // Get all loaded tasks flattened
  const getAllLoadedTasks = useCallback(() => {
    const allTasks = [];
    Object.values(taskCache).forEach(project => {
      if (project.tasks) {
        allTasks.push(...project.tasks);
      }
      if (project.tagGroups) {
        Object.values(project.tagGroups).forEach(group => {
          if (group.tasks) {
            allTasks.push(...group.tasks);
          }
        });
      }
    });
    // Remove duplicates
    const seen = new Set();
    return allTasks.filter(t => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }, [taskCache]);

  // Collapse all on mount/reset
  const resetExpansion = useCallback(() => {
    setExpandedProjects({});
    setExpandedTagGroups({});
    setTaskCache({});
  }, []);

  // Load initial data on mount
  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  return {
    // Data
    projects,
    allTags,
    projectCounts,
    taskCache,
    loading,
    
    // Expansion state
    expandedProjects,
    expandedTagGroups,
    
    // Actions
    loadInitialData,
    loadProjectTasks,
    loadTagGroupTasks,
    toggleProjectExpand,
    toggleTagGroupExpand,
    getAllLoadedTasks,
    resetExpansion,
    
    // Setters for mutations
    setProjects,
    setAllTags,
  };
};
