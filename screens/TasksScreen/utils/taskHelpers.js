export const normalizeTags = (tags) => {
  if (Array.isArray(tags)) return tags;
  if (!tags) return [];
  return tags.split(',').map(t => t.trim()).filter(Boolean);
};

export const parseTags = (input) => 
  input.split(/[,\s]+/).map(t => t.trim().toLowerCase()).filter(Boolean);

export const sortTasks = (a, b) => {
  // First sort by completion status (incomplete first)
  if (a.completed !== b.completed) {
    return a.completed ? 1 : -1;
  }
  
  // Then sort by time (earliest to latest) if both have time
  if (a.time && b.time) {
    return a.time.localeCompare(b.time);
  }
  
  // Tasks with time come before tasks without time
  if (a.time && !b.time) return -1;
  if (!a.time && b.time) return 1;
  
  // Finally sort by createdAt (newest first)
  return (b.createdAt || 0) - (a.createdAt || 0);
};

export const getPriorityColor = (priority, theme) => {
  if (theme) {
    // Use theme colors for dark mode
    const colors = { 
      high: theme.colors.accentError, 
      medium: theme.colors.accentWarning, 
      low: theme.colors.accentSuccess 
    };
    return colors[priority] || theme.colors.textTertiary;
  }
  // Fallback for non-theme usage
  const colors = { high: '#f44336', medium: '#ff9800', low: '#4caf50' };
  return colors[priority] || '#999';
};

// NEW: Subtask utilities
export const areAllSubtasksCompleted = (subtasks) => {
  if (!subtasks || subtasks.length === 0) return false;
  return subtasks.every(st => st.completed);
};

export const toggleSubtaskComplete = (subtasks, subtaskId) => {
  return subtasks.map(st => {
    if (st.id !== subtaskId) return st;
    const newCompleted = !st.completed;
    return {
      ...st,
      completed: newCompleted,
      completedAt: newCompleted ? Date.now() : null,
      completedTime: newCompleted ? new Date().toISOString() : null
    };
  });
};

export const addSubtask = (subtasks, title, time = null) => {
  return [...(subtasks || []), {
    id: Date.now().toString(),
    title: title.trim(),
    completed: false,
    createdAt: Date.now(),
    time: time
  }];
};

export const deleteSubtask = (subtasks, subtaskId) => {
  return subtasks.filter(st => st.id !== subtaskId);
};

export const updateSubtask = (subtasks, subtaskId, updates) => {
  return subtasks.map(st => 
    st.id === subtaskId ? { ...st, ...updates } : st
  );
};