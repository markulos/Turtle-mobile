import { useState, useCallback, useMemo } from 'react';
import { normalizeTags, sortTasks } from '../utils/taskHelpers';

export const useTaskFilters = (tasks, projects = []) => {
  const [selectedProject, setSelectedProject] = useState('All');
  const [selectedTags, setSelectedTags] = useState([]);
  const [tagFilterMode, setTagFilterMode] = useState('any');
  const [viewMode, setViewMode] = useState('tree');
  const [expandedTags, setExpandedTags] = useState({});
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(true);

  const toggleTagFilter = useCallback((tag) => {
    setSelectedTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedTags([]);
    setTagFilterMode('any');
    setSelectedProject('All');
    setShowIncompleteOnly(true);
  }, []);

  const toggleTagExpand = useCallback((tagKey) => {
    setExpandedTags(prev => ({ ...prev, [tagKey]: !prev[tagKey] }));
  }, []);

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
  }, [tasks, selectedProject, selectedTags, tagFilterMode, showIncompleteOnly]);

  const groupedTasks = useMemo(() => {
    const byProject = {};
    
    // Count TOTAL tasks per project (not just filtered) to determine truly empty
    const projectTaskCounts = {};
    tasks.forEach(task => {
      const proj = task.project || 'No Project';
      projectTaskCounts[proj] = (projectTaskCounts[proj] || 0) + 1;
    });
    
    // Initialize with all projects to include empty ones
    const projectsToShow = selectedProject === 'All' 
      ? projects 
      : selectedProject === 'No Project'
        ? ['No Project']
        : [selectedProject];
    
    projectsToShow.forEach(proj => {
      byProject[proj] = {};
    });
    
    // Add 'No Project' if showing all projects
    if (selectedProject === 'All' && !projects.includes('No Project')) {
      byProject['No Project'] = {};
    }
    
    // Fill with FILTERED tasks
    filteredTasks.forEach(task => {
      const proj = task.project || 'No Project';
      if (!byProject[proj]) byProject[proj] = {};
      
      const tags = Array.isArray(task.tags) && task.tags.length > 0 
        ? task.tags.join(', ') 
        : (task.tags || 'Untagged');
      
      if (!byProject[proj][tags]) byProject[proj][tags] = [];
      byProject[proj][tags].push(task);
    });

    const sections = [];
    
    // Build sections from byProject
    Object.entries(byProject).forEach(([project, tags]) => {
      const visibleTasks = Object.values(tags).flat();
      const totalTaskCount = projectTaskCounts[project] || 0;
      const isTrulyEmpty = totalTaskCount === 0; // Only truly empty if no tasks at all
      
      sections.push({ 
        title: project, 
        type: 'project', 
        data: [], 
        project,
        isEmpty: isTrulyEmpty, // Only true if project has NO tasks (not just filtered out)
        taskCount: totalTaskCount
      });
      
      // Only show tag groups if project has VISIBLE tasks
      if (visibleTasks.length > 0) {
        Object.entries(tags).forEach(([tagKey, tagTasks]) => {
          const tagArray = tagKey === 'Untagged' 
            ? [] 
            : tagKey.split(',').map(t => t.trim()).filter(Boolean);
          
          sections.push({
            title: tagKey,
            type: 'tag',
            project,
            data: tagTasks.sort(sortTasks),
            completedCount: tagTasks.filter(t => t.completed).length,
            totalCount: tagTasks.length,
            tags: tagArray
          });
        });
      }
    });
    
    return sections;
  }, [filteredTasks, tasks, projects, selectedProject]);

  const stats = useMemo(() => ({
    completed: filteredTasks.filter(t => t.completed).length,
    total: filteredTasks.length
  }), [filteredTasks]);

  return {
    selectedProject, setSelectedProject,
    selectedTags, setSelectedTags, toggleTagFilter,
    tagFilterMode, setTagFilterMode,
    viewMode, setViewMode,
    expandedTags, toggleTagExpand,
    showIncompleteOnly, setShowIncompleteOnly,
    clearFilters,
    filteredTasks,
    groupedTasks,
    stats,
    hasActiveFilters: selectedTags.length > 0 || selectedProject !== 'All' || !showIncompleteOnly
  };
};
