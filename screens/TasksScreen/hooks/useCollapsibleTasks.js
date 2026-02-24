import { useState, useCallback, useMemo, useEffect } from 'react';
import { normalizeTags, sortTasks } from '../utils/taskHelpers';

/**
 * Hook for managing collapsible task lists with lazy loading
 * Both projects and tag groups are collapsible
 */
export const useCollapsibleTasks = (tasks, projects = [], options = {}) => {
  const { showIncompleteOnly = true, selectedProject = 'All', selectedTags = [], tagFilterMode = 'any' } = options;
  
  // Expansion state - both projects and tag groups
  const [expandedProjects, setExpandedProjects] = useState({});
  const [expandedTagGroups, setExpandedTagGroups] = useState({});
  const [initialized, setInitialized] = useState(false);

  // Toggle project expansion
  const toggleProjectExpand = useCallback((projectName) => {
    const key = projectName || 'No Project';
    setExpandedProjects(prev => ({
      ...prev,
      [key]: !(prev[key] ?? false) // undefined = false (collapsed), toggle to true (expanded)
    }));
  }, []);

  // Toggle tag group expansion
  const toggleTagGroupExpand = useCallback((projectName, tagKey) => {
    const key = `${projectName || 'No Project'}::${tagKey}`;
    setExpandedTagGroups(prev => ({
      ...prev,
      [key]: !(prev[key] ?? false) // undefined = false (collapsed)
    }));
  }, []);

  // Filter tasks
  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (showIncompleteOnly) {
      result = result.filter(t => !t.completed);
    }
    if (selectedProject !== 'All') {
      result = result.filter(t => 
        selectedProject === 'No Project' ? !t.project : t.project === selectedProject
      );
    }
    if (selectedTags.length > 0) {
      result = result.filter(task => {
        const taskTags = normalizeTags(task.tags).map(t => t.toLowerCase());
        const selected = selectedTags.map(t => t.toLowerCase());
        return tagFilterMode === 'all' 
          ? selected.every(tag => taskTags.includes(tag))
          : selected.some(tag => taskTags.includes(tag));
      });
    }
    return result;
  }, [tasks, showIncompleteOnly, selectedProject, selectedTags, tagFilterMode]);

  // Group tasks by project and tags
  const groupedData = useMemo(() => {
    const byProject = {};
    
    // Count tasks per project
    const projectTaskCounts = {};
    tasks.forEach(task => {
      const proj = task.project || 'No Project';
      projectTaskCounts[proj] = (projectTaskCounts[proj] || 0) + 1;
    });
    
    // Initialize projects (all or just selected)
    const projectsToShow = selectedProject === 'All' 
      ? projects 
      : [selectedProject];
    
    projectsToShow.forEach(proj => {
      byProject[proj] = {};
    });
    
    // Fill with filtered tasks
    filteredTasks.forEach(task => {
      const proj = task.project || 'No Project';
      if (!byProject[proj]) byProject[proj] = {};
      
      const tags = Array.isArray(task.tags) && task.tags.length > 0 
        ? task.tags.join(', ') 
        : 'Untagged';
      
      if (!byProject[proj][tags]) byProject[proj][tags] = [];
      byProject[proj][tags].push(task);
    });
    
    // Build sections array
    const sections = [];
    
    Object.entries(byProject).forEach(([project, tags]) => {
      const visibleTasks = Object.values(tags).flat();
      const totalTaskCount = projectTaskCounts[project] || 0;
      const isProjectExpanded = expandedProjects[project] ?? false;
      
      // Project header section
      sections.push({
        title: project,
        type: 'project',
        data: [],
        project,
        isEmpty: totalTaskCount === 0,
        taskCount: totalTaskCount,
        visibleTaskCount: visibleTasks.length,
        isExpanded: isProjectExpanded,
        tagGroups: Object.keys(tags)
      });
      
      // Only add tag groups if project is expanded
      if (isProjectExpanded) {
        // Ensure 'Untagged' section exists even if empty
        if (!tags['Untagged']) {
          tags['Untagged'] = [];
        }
        
        Object.entries(tags).forEach(([tagKey, tagTasks]) => {
          const tagGroupKey = `${project}::${tagKey}`;
          const isTagGroupExpanded = expandedTagGroups[tagGroupKey] ?? false;
          
          sections.push({
            title: tagKey,
            type: 'tag',
            project,
            data: isTagGroupExpanded ? tagTasks.sort(sortTasks) : [], // Only include data if expanded
            completedCount: tagTasks.filter(t => t.completed).length,
            totalCount: tagTasks.length,
            tags: tagKey === 'Untagged' ? [] : tagKey.split(',').map(t => t.trim()).filter(Boolean),
            isExpanded: isTagGroupExpanded
          });
        });
      }
    });
    
    return sections;
  }, [filteredTasks, tasks, projects, expandedProjects, expandedTagGroups, selectedProject]);

  // Initialize all collapsed on first load
  useEffect(() => {
    if (!initialized && projects.length > 0) {
      // Start with all projects collapsed
      const initialProjects = {};
      projects.forEach(p => {
        initialProjects[p] = false; // collapsed
      });
      initialProjects['No Project'] = false;
      
      setExpandedProjects(initialProjects);
      setExpandedTagGroups({}); // all tag groups collapsed (undefined = false)
      setInitialized(true);
    }
  }, [projects, initialized]);

  // Reset when projects change
  useEffect(() => {
    if (initialized) {
      setInitialized(false);
      setExpandedProjects({});
      setExpandedTagGroups({});
    }
  }, [projects.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stats
  const stats = useMemo(() => ({
    completed: filteredTasks.filter(t => t.completed).length,
    total: filteredTasks.length
  }), [filteredTasks]);

  return {
    groupedData,
    expandedProjects,
    expandedTagGroups,
    toggleProjectExpand,
    toggleTagGroupExpand,
    stats,
    initialized
  };
};
