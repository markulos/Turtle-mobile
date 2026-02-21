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

export const getPriorityColor = (priority) => {
  const colors = { high: '#f44336', medium: '#ff9800', low: '#4caf50' };
  return colors[priority] || '#999';
};