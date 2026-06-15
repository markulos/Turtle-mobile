export const COLORS = {
  primary: '#4CAF50',
  primaryDark: '#1976d2',
  secondary: '#2196F3',
  danger: '#f44336',
  warning: '#ff9800',
  success: '#4caf50',
  background: '#f5f5f5',
  surface: '#fff',
  border: '#eee',
  text: '#333',
  textSecondary: '#666',
  textMuted: '#999',
};

export const PRIORITIES = ['low', 'medium', 'high'];

// ── Calendar item types ───────────────────────────────────────────────
// The calendar "+" button creates one of three kinds of item. They all live
// in the same tasks pipeline (so they render on the calendar/day planner for
// free) but carry an `itemType` + a `meta` blob with type-specific extras.
//   • task      — unchanged; the existing to-do with priority/subtasks/etc.
//   • event     — an appointment with a description + a guest list.
//   • birthday  — a yearly all-day occasion with a colour + reminder lead-times.
export const ITEM_TYPES = [
  { value: 'task',     label: 'Task',     icon: 'check-circle-outline', accent: '#4CAF50' },
  { value: 'event',    label: 'Event',    icon: 'calendar-star',        accent: '#2196F3' },
  { value: 'birthday', label: 'Birthday', icon: 'cake-variant',         accent: '#E91E63' },
];

// Default colour used to render an item when its meta carries no explicit one.
export const ITEM_TYPE_DEFAULT_COLOR = {
  task: null,        // tasks keep their project/priority colouring
  event: '#2196F3',
  birthday: '#E91E63',
};

// Colour swatches offered when creating a birthday (also reusable for events).
export const OCCASION_COLORS = [
  '#E91E63', '#F44336', '#FF9800', '#FFC107', '#4CAF50',
  '#009688', '#2196F3', '#3F51B5', '#9C27B0', '#795548',
];

// Reminder lead-times offered for birthdays. Stored in meta.reminders as the
// `value` strings; delivery (a push notification) is a separate concern — these
// are persisted as the user's reminder preferences.
export const REMINDER_OPTIONS = [
  { value: 'same-day', label: 'On the day' },
  { value: '1-day',    label: '1 day before' },
  { value: '3-days',   label: '3 days before' },
  { value: '1-week',   label: '1 week before' },
];