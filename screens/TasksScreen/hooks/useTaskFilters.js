import { useState, useCallback, useMemo } from 'react';
import { normalizeTags, sortTasks } from '../utils/taskHelpers';

export const useTaskFilters = (tasks) => {
  const [selectedProject, setSelectedProject] = useState('All');
  const [selectedTags, setSelectedTags] = useState([]);
  const [tagFilterMode, setTagFilterMode] = useState('any');
  const [viewMode, setViewMode] = useState('tree');
  const [expandedTags, setExpandedTags] = useState({});

  const toggleTagFilter = useCallback((tag) => {
    setSelectedTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedTags([]);
    setTagFilterMode('any');
    setSelectedProject('All');
  }, []);

  const toggleTagExpand = useCallback((tagKey) => {
    setExpandedTags(prev => ({ ...prev, [tagKey]: !prev[tagKey] }));
  }, []);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    
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
  }, [tasks, selectedProject, selectedTags, tagFilterMode]);

  const groupedTasks = useMemo(() => {
    const byProject = {};
    filteredTasks.forEach(task => {
      const proj = task.project || 'No Project';
      if (!byProject[proj]) byProject[proj] = {};
      
      const tagKey = Array.isArray(task.tags) && task.tags.length > 0 
        ? task.tags.join(', ') 
        : (task.tags || 'Untagged');
      
      if (!byProject[proj][tagKey]) byProject[proj][tagKey] = [];
      byProject[proj][tagKey].push(task);
    });

    const sections = [];
    Object.entries(byProject).forEach(([project, tags]) => {
      sections.push({ title: project, type: 'project', data: [] });
      
      Object.entries(tags).forEach(([tag, tagTasks]) => {
        sections.push({
          title: tag,
          type: 'tag',
          project,
          data: tagTasks.sort(sortTasks),
          completedCount: tagTasks.filter(t => t.completed).length,
          totalCount: tagTasks.length
        });
      });
    });
    
    return sections;
  }, [filteredTasks]);

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
    clearFilters,
    filteredTasks,
    groupedTasks,
    stats,
    hasActiveFilters: selectedTags.length > 0 || selectedProject !== 'All'
  };
};