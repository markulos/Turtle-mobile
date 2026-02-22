export const normalizeTags = (tags) => {
  if (Array.isArray(tags)) return tags;
  if (!tags) return [];
  return tags.split(',').map(t => t.trim()).filter(Boolean);
};

export const parseTags = (input) => 
  input.split(/[,\s]+/).map(t => t.trim().toLowerCase()).filter(Boolean);

export const sortTasks = (a, b) => {
  if (a.completed === b.completed) return (b.createdAt || 0) - (a.createdAt || 0);
  return a.completed ? 1 : -1;
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
  return subtasks.map(st => 
    st.id === subtaskId ? { ...st, completed: !st.completed } : st
  );
};

export const addSubtask = (subtasks, title) => {
  return [...(subtasks || []), {
    id: Date.now().toString(),
    title: title.trim(),
    completed: false,
    createdAt: Date.now()
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