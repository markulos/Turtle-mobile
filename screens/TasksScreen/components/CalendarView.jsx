import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Dimensions,
  Animated,
  LayoutAnimation,
  Platform,
  UIManager,
  TextInput,
  Keyboard,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width } = Dimensions.get('window');
const DAY_WIDTH = (width - 40) / 7;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export const CalendarView = ({ 
  tasks, 
  onTaskPress, 
  onTaskLongPress,
  onToggleComplete,
  selectedProject,
  selectedTags,
  tagFilterMode,
  onAddTask,
  onUpdateTask
}) => {
  const { theme } = useTheme();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isExpanded, setIsExpanded] = useState(true);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dueDateOnly, setDueDateOnly] = useState(false);
  
  // Keyboard handling
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  
  useEffect(() => {
    const showListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setKeyboardHeight(e.endCoordinates.height)
    );
    const hideListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardHeight(0)
    );
    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, []);
  
  // Track last tap for double-tap detection
  const lastTapRef = useRef(0);
  
  // Animation values
  const rotateAnim = useRef(new Animated.Value(1)).current;
  const heightAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  const styles = createStyles(theme);
  
  // Helper to create YYYY-MM-DD string in local timezone
  const toDateString = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  
  // Helper to parse date string to Date object in local timezone
  const parseDateString = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  
  // Handle date selection with double-tap or re-tap detection
  const handleDatePress = useCallback((date) => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300; // ms
    const isDoubleTap = now - lastTapRef.current < DOUBLE_TAP_DELAY;
    const isAlreadySelected = selectedDate.toDateString() === date.toDateString();
    
    if (isDoubleTap || isAlreadySelected) {
      // Double tap OR tap on already selected date - close calendar
      setSelectedDate(date);
      setIsExpanded(false);
      
      // Animate chevron rotation
      Animated.timing(rotateAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
      
      // Animate opacity
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
      
      // Configure layout animation
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    } else {
      // Single tap on new date - just select the date
      setSelectedDate(date);
    }
    
    lastTapRef.current = now;
  }, [rotateAnim, opacityAnim, selectedDate]);
  
  const toggleExpand = useCallback(() => {
    const newValue = !isExpanded;
    setIsExpanded(newValue);
    
    // Configure smooth layout animation
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    
    // Animate the chevron rotation
    Animated.timing(rotateAnim, {
      toValue: newValue ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
    
    // Animate height
    Animated.timing(heightAnim, {
      toValue: newValue ? 1 : 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
    
    // Animate opacity
    Animated.timing(opacityAnim, {
      toValue: newValue ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isExpanded, rotateAnim, heightAnim, opacityAnim]);
  
  // Chevron rotation interpolation
  const rotateInterpolate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  // Get heatmap color based on task count (green → yellow → orange → red)
  const getContributionColor = (count) => {
    const levels = [
      '#9e9e9e', // Level 0 (no tasks) - gray
      '#81c784', // Level 1 (1-2 tasks) - light green
      '#ffca28', // Level 2 (3-5 tasks) - amber/yellow (more visible)
      '#ff9800', // Level 3 (6-9 tasks) - orange
      '#e57373', // Level 4 (10+ tasks) - red
    ];
    
    if (count === 0) return levels[0];
    if (count <= 2) return levels[1];
    if (count <= 5) return levels[2];
    if (count <= 9) return levels[3];
    return levels[4];
  };

  // Get unique projects count for a day's tasks
  const getProjectCount = (dayTasks) => {
    const projects = new Set(dayTasks.map(t => t.project || 'No Project'));
    return projects.size;
  };

  // Project colors - distinct colors that work well with green/yellow palette
  const projectColors = [
    '#4CAF50', // Green
    '#2196F3', // Blue
    '#9C27B0', // Purple
    '#FF5722', // Deep Orange
    '#00BCD4', // Cyan
    '#795548', // Brown
    '#E91E63', // Pink
    '#3F51B5', // Indigo
    '#009688', // Teal
    '#FF9800', // Orange
  ];

  // Get color for a project (consistent based on project name)
  const getProjectColor = (projectName) => {
    if (!projectName) return projectColors[0];
    // Simple hash to get consistent color for same project name
    let hash = 0;
    for (let i = 0; i < projectName.length; i++) {
      hash = projectName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % projectColors.length;
    return projectColors[index];
  };

  // Get calendar data for current month
  const calendarData = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();
    
    const days = [];
    
    // Empty cells for days before month starts
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push({ type: 'empty', key: `empty-${i}` });
    }
    
    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dateStr = toDateString(date);
      
      // Find tasks for this date
      const dayTasks = tasks.filter(task => {
        // Filter by project if selected
        if (selectedProject !== 'All') {
          const taskProject = task.project || 'No Project';
          if (taskProject !== selectedProject) return false;
        }
        
        // Filter by tags if selected
        if (selectedTags && selectedTags.length > 0) {
          const taskTags = task.tags || [];
          const taskTagSet = new Set(taskTags.map(t => t.toLowerCase()));
          const selectedTagSet = new Set(selectedTags.map(t => t.toLowerCase()));
          
          if (tagFilterMode === 'all') {
            // Must have ALL selected tags
            const hasAllTags = selectedTags.every(tag => 
              taskTagSet.has(tag.toLowerCase())
            );
            if (!hasAllTags) return false;
          } else {
            // Must have ANY of the selected tags (default)
            const hasAnyTag = selectedTags.some(tag => 
              taskTagSet.has(tag.toLowerCase())
            );
            if (!hasAnyTag) return false;
          }
        }
        
        if (dueDateOnly) {
          // Due date only mode: only show on due date
          if (task.dueDate) {
            return task.dueDate === dateStr;
          }
          return false;
        }
        
        // Default mode: show on all dates from created to due date
        const taskCreated = task.createdAt ? new Date(task.createdAt) : null;
        const taskDue = task.dueDate ? parseDateString(task.dueDate) : null;
        
        if (taskCreated && taskDue) {
          // Show on every date from created to due (inclusive)
          const currentDateObj = parseDateString(dateStr);
          const createdDay = new Date(taskCreated.getFullYear(), taskCreated.getMonth(), taskCreated.getDate());
          const dueDay = new Date(taskDue.getFullYear(), taskDue.getMonth(), taskDue.getDate());
          return currentDateObj >= createdDay && currentDateObj <= dueDay;
        } else if (task.dueDate) {
          // Only due date set
          return task.dueDate === dateStr;
        } else if (task.createdAt) {
          // Only created date set
          const createdDate = toDateString(new Date(task.createdAt));
          return createdDate === dateStr;
        }
        return false;
      });
      
      const isToday = new Date().toDateString() === date.toDateString();
      const isSelected = selectedDate.toDateString() === date.toDateString();
      
      days.push({
        type: 'day',
        day,
        date,
        dateStr,
        tasks: dayTasks,
        isToday,
        isSelected,
        key: `day-${day}`
      });
    }
    
    return days;
  }, [currentDate, tasks, selectedProject, selectedTags, tagFilterMode, selectedDate, dueDateOnly]);

  // Tasks for selected date
  const selectedDateTasks = useMemo(() => {
    const dateStr = toDateString(selectedDate);
    const filtered = tasks.filter(task => {
      // Filter by project
      if (selectedProject !== 'All') {
        const taskProject = task.project || 'No Project';
        if (taskProject !== selectedProject) return false;
      }
      
      // Filter by tags if selected
      if (selectedTags && selectedTags.length > 0) {
        const taskTags = task.tags || [];
        const taskTagSet = new Set(taskTags.map(t => t.toLowerCase()));
        
        if (tagFilterMode === 'all') {
          // Must have ALL selected tags
          const hasAllTags = selectedTags.every(tag => 
            taskTagSet.has(tag.toLowerCase())
          );
          if (!hasAllTags) return false;
        } else {
          // Must have ANY of the selected tags (default)
          const hasAnyTag = selectedTags.some(tag => 
            taskTagSet.has(tag.toLowerCase())
          );
          if (!hasAnyTag) return false;
        }
      }
      
      if (dueDateOnly) {
        // Due date only mode
        if (task.dueDate) return task.dueDate === dateStr;
        return false;
      }
      
      // Default mode: show on all dates from created to due
      const taskCreated = task.createdAt ? new Date(task.createdAt) : null;
      const taskDue = task.dueDate ? parseDateString(task.dueDate) : null;
      
      if (taskCreated && taskDue) {
        const currentDateObj = parseDateString(dateStr);
        const createdDay = new Date(taskCreated.getFullYear(), taskCreated.getMonth(), taskCreated.getDate());
        const dueDay = new Date(taskDue.getFullYear(), taskDue.getMonth(), taskDue.getDate());
        return currentDateObj >= createdDay && currentDateObj <= dueDay;
      } else if (task.dueDate) {
        return task.dueDate === dateStr;
      } else if (task.createdAt) {
        return toDateString(new Date(task.createdAt)) === dateStr;
      }
      return false;
    });
    
    // Sort by time (earliest to latest), tasks without time go to the end
    return filtered.sort((a, b) => {
      if (a.time && b.time) return a.time.localeCompare(b.time);
      if (a.time) return -1;
      if (b.time) return 1;
      return 0;
    });
  }, [selectedDate, tasks, selectedProject, selectedTags, tagFilterMode, dueDateOnly]);

  const goToPrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const goToToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setSelectedDate(today);
  };

  const handleAddTask = () => {
    if (!newTaskTitle.trim()) return;
    const dateStr = toDateString(selectedDate);
    onAddTask?.(newTaskTitle.trim(), selectedProject === 'All' ? '' : selectedProject, dateStr);
    setNewTaskTitle('');
    setIsAddingTask(false);
  };

  // Helper to get task title and subtitle for selected date
  const getTaskListTitle = () => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const isToday = selectedDate.toDateString() === today.toDateString();
    const isTomorrow = selectedDate.toDateString() === tomorrow.toDateString();
    
    // Format date for subtitle
    const dateStr = selectedDate.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric' 
    });
    
    if (isToday) return { title: "Today's Tasks", subtitle: dateStr };
    if (isTomorrow) return { title: "Tomorrow's Tasks", subtitle: dateStr };
    
    // For other dates, return date as subtitle
    return { title: "Tasks", subtitle: dateStr };
  };
  
  const { title: taskTitle, subtitle: taskSubtitle } = getTaskListTitle();

  const handleCancelAdd = () => {
    setNewTaskTitle('');
    setIsAddingTask(false);
  };

  // Search tasks (exclude tasks already on selected date)
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    const selectedDateStr = toDateString(selectedDate);
    
    const filtered = tasks.filter(task => {
      // Exclude tasks already on this date
      const taskDate = task.dueDate || (task.createdAt ? toDateString(new Date(task.createdAt)) : '');
      if (taskDate === selectedDateStr) return false;
      
      // Filter by project if selected
      if (selectedProject !== 'All') {
        const taskProject = task.project || 'No Project';
        if (taskProject !== selectedProject) return false;
      }
      
      // Filter by tags if selected
      if (selectedTags && selectedTags.length > 0) {
        const taskTags = task.tags || [];
        const taskTagSet = new Set(taskTags.map(t => t.toLowerCase()));
        
        if (tagFilterMode === 'all') {
          const hasAllTags = selectedTags.every(tag => 
            taskTagSet.has(tag.toLowerCase())
          );
          if (!hasAllTags) return false;
        } else {
          const hasAnyTag = selectedTags.some(tag => 
            taskTagSet.has(tag.toLowerCase())
          );
          if (!hasAnyTag) return false;
        }
      }
      
      // Search in title and description
      return task.title.toLowerCase().includes(query) || 
             (task.description && task.description.toLowerCase().includes(query));
    });
    
    // Sort by time (earliest to latest), tasks without time go to the end
    filtered.sort((a, b) => {
      if (a.time && b.time) return a.time.localeCompare(b.time);
      if (a.time) return -1;
      if (b.time) return 1;
      return 0;
    });
    
    return filtered.slice(0, 10); // Limit to 10 results
  }, [searchQuery, tasks, selectedDate, selectedProject, selectedTags, tagFilterMode]);

  const handleSelectExistingTask = (task) => {
    const newDueDate = toDateString(selectedDate);
    onUpdateTask?.(task.id, { dueDate: newDueDate });
    setIsSearching(false);
    setSearchQuery('');
  };

  return (
    <View style={styles.container}>
      {/* Collapsible Calendar Header with Arrow */}
      <TouchableOpacity 
        style={styles.collapseHeader} 
        onPress={toggleExpand}
        activeOpacity={0.7}
      >
        <View style={styles.collapseHeaderLeft}>
          <View style={styles.collapseHeaderIcon}>
            <Icon name="calendar" size={20} color={theme.colors.textPrimary} />
          </View>
          <Text style={styles.collapseHeaderText}>
            {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
          </Text>
        </View>
        
        <View style={styles.chevronContainer}>
          <Animated.View style={{ transform: [{ rotate: rotateInterpolate }] }}>
            <Icon name="chevron-down" size={24} color={theme.colors.textPrimary} />
          </Animated.View>
        </View>
      </TouchableOpacity>

      {/* Collapsible Calendar Content */}
      {isExpanded && (
        <Animated.View 
          style={[
            styles.calendarContent,
            { opacity: opacityAnim }
          ]}
        >
          {/* Calendar Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={goToPrevMonth} style={styles.navButton}>
              <Icon name="chevron-left" size={28} color={theme.colors.textPrimary} />
            </TouchableOpacity>
            
            <View style={styles.monthYear}>
              <Text style={styles.monthText}>
                {MONTHS[currentDate.getMonth()]}
              </Text>
              <Text style={styles.yearText}>
                {currentDate.getFullYear()}
              </Text>
            </View>
            
            <TouchableOpacity onPress={goToNextMonth} style={styles.navButton}>
              <Icon name="chevron-right" size={28} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Today Button */}
          <TouchableOpacity style={styles.todayButton} onPress={goToToday}>
            <Icon name="calendar-today" size={16} color={theme.colors.accentSuccess} />
            <Text style={styles.todayText}>Today</Text>
          </TouchableOpacity>

          {/* Days of Week Header */}
          <View style={styles.daysHeader}>
            {DAYS.map(day => (
              <View key={day} style={styles.dayHeaderCell}>
                <Text style={styles.dayHeaderText}>{day}</Text>
              </View>
            ))}
          </View>

          {/* Calendar Grid */}
          <View style={styles.calendarGrid}>
        {calendarData.map((item) => {
          if (item.type === 'empty') {
            return <View key={item.key} style={styles.emptyCell} />;
          }
          
          const hasTasks = item.tasks.length > 0;
          
          // Get contribution color based on task count
          const contributionColor = getContributionColor(item.tasks.length);
          
          // Get unique projects for dots
          const projectCount = getProjectCount(item.tasks);
          
          return (
            <TouchableOpacity
              key={item.key}
              style={[
                styles.dayCell,
                item.isToday && styles.todayCell,
                item.isSelected && styles.selectedCell
              ]}
              onPress={() => handleDatePress(item.date)}
            >
              <Text style={[
                styles.dayText,
                item.isToday && styles.todayText,
                item.tasks.length > 0 && { color: contributionColor }
              ]}>
                {item.day}
              </Text>
              
              {/* Project dots - show number of projects with tasks */}
              {projectCount > 0 && (
                <View style={styles.projectDots}>
                  {Array.from({ length: Math.min(projectCount, 3) }).map((_, idx) => (
                    <View
                      key={idx}
                      style={[
                        styles.projectDot,
                        { backgroundColor: contributionColor }
                      ]}
                    />
                  ))}
                  {projectCount > 3 && (
                    <Text style={[styles.moreProjects, { color: contributionColor }]}>+</Text>
                  )}
                </View>
              )}
            </TouchableOpacity>
          );
        })}
          </View>
        </Animated.View>
      )}

      {/* Selected Date Tasks */}
      <View style={[styles.taskListContainer, isExpanded && styles.taskListContainerCollapsed]}>
        <TouchableOpacity 
          style={[styles.taskListHeader, isExpanded && styles.taskListHeaderCollapsed]}
          onPress={toggleExpand}
          activeOpacity={1}
        >
          <View style={styles.taskListHeaderContent}>
            <View style={styles.titleRow}>
              <Text style={styles.taskListTitle}>{taskTitle}</Text>
              {/* Due Date Filter Toggle - inline with title */}
              <TouchableOpacity 
                style={[styles.filterButtonInline, dueDateOnly && styles.filterButtonActive]}
                onPress={(e) => {
                  e.stopPropagation();
                  setDueDateOnly(!dueDateOnly);
                }}
                activeOpacity={0.7}
              >
                <Icon 
                  name={dueDateOnly ? "calendar-check" : "calendar-range"} 
                  size={14} 
                  color={dueDateOnly ? theme.colors.textPrimary : theme.colors.textSecondary} 
                />
                <Text style={[styles.filterTextInline, dueDateOnly && styles.filterTextActive]}>
                  {dueDateOnly ? 'Due' : 'Created → Due'}
                </Text>
              </TouchableOpacity>
            </View>
            {/* Date subtitle - always show when calendar expanded */}
            {(taskSubtitle || isExpanded) && (
              <Text style={styles.dateSubtitle}>{taskSubtitle || selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
            )}
            <Text style={[styles.calendarHint, isExpanded && styles.calendarHintBlue]}>
              {isExpanded ? 'Tap to view tasklist' : 'Tap to open calendar'}
            </Text>
          </View>
          <View style={styles.taskListHeaderRight}>
            <Text style={styles.taskCount}>
              {selectedDateTasks.length} task{selectedDateTasks.length !== 1 ? 's' : ''}
            </Text>
            <Animated.View style={{ 
              marginLeft: 8,
              transform: [{ 
                rotate: rotateAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['180deg', '0deg']
                })
              }]
            }}>
              <Icon name="chevron-up" size={20} color={theme.colors.textTertiary} />
            </Animated.View>
          </View>
        </TouchableOpacity>
        
        {!isExpanded && (
        <ScrollView 
          style={styles.taskList}
          contentContainerStyle={{ paddingBottom: Math.max(100, keyboardHeight + 20) }}
          scrollEventThrottle={16}
        >
          {/* Add Task Input */}
          {isAddingTask ? (
            <View style={styles.addTaskContainer}>
              <TextInput
                style={styles.addTaskInput}
                placeholder="Add a new task"
                placeholderTextColor={theme.colors.textPlaceholder}
                value={newTaskTitle}
                onChangeText={setNewTaskTitle}
                onSubmitEditing={handleAddTask}
                autoFocus
                blurOnSubmit={false}
                returnKeyType="done"
                onBlur={() => {
                  setTimeout(() => {
                    setNewTaskTitle('');
                    setIsAddingTask(false);
                  }, 200);
                }}
              />
              <TouchableOpacity 
                style={styles.addTaskClose}
                onPress={handleCancelAdd}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="close" size={18} color={theme.colors.textTertiary} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity 
              style={styles.addTaskPlaceholder}
              onPress={() => {
                setIsAddingTask(true);
                if (isExpanded) toggleExpand();
              }}
              activeOpacity={0.7}
            >
              <View style={styles.addTaskInputBox} pointerEvents="none">
                <Text style={styles.addTaskPlaceholderText}>Add a new task</Text>
              </View>
            </TouchableOpacity>
          )}

          {/* Search Existing Tasks */}
          {isSearching ? (
            <View style={styles.searchContainer}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search tasks..."
                placeholderTextColor={theme.colors.textPlaceholder}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
              />
              <TouchableOpacity 
                style={styles.searchClose}
                onPress={() => {
                  setIsSearching(false);
                  setSearchQuery('');
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="close" size={18} color={theme.colors.textTertiary} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity 
              style={styles.searchPlaceholder}
              onPress={() => {
                setIsSearching(true);
                if (isExpanded) toggleExpand();
              }}
              activeOpacity={0.7}
            >
              <View style={styles.searchInputBox} pointerEvents="none">
                <Icon name="magnify" size={16} color={theme.colors.textPlaceholder} style={styles.searchIcon} />
                <Text style={styles.searchPlaceholderText}>Search existing tasks</Text>
              </View>
            </TouchableOpacity>
          )}

          {/* Search Results */}
          {isSearching && searchQuery.trim() && (
            <View style={styles.searchResults}>
              {searchResults.length > 0 ? (
                <>
                  <Text style={styles.searchResultsTitle}>Tap to assign to this date:</Text>
                  {searchResults.map(task => (
                    <TouchableOpacity
                      key={task.id}
                      style={styles.searchResultItem}
                      onPress={() => handleSelectExistingTask(task)}
                    >
                      <Icon name="calendar-clock" size={16} color={theme.colors.accentSuccess} style={styles.resultIcon} />
                      <View style={styles.resultContent}>
                        <Text style={styles.resultTitle} numberOfLines={1}>{task.title}</Text>
                        {task.dueDate ? (
                          <Text style={styles.resultMeta}>Current: {task.dueDate}</Text>
                        ) : (
                          <Text style={styles.resultMeta}>No due date</Text>
                        )}
                      </View>
                      <Icon name="chevron-right" size={18} color={theme.colors.textTertiary} />
                    </TouchableOpacity>
                  ))}
                </>
              ) : (
                <Text style={styles.noResultsText}>No tasks found</Text>
              )}
            </View>
          )}

          {selectedDateTasks.length === 0 ? (
            <View style={styles.emptyState}>
              <Icon name="calendar-blank" size={48} color={theme.colors.textMuted} />
              <Text style={styles.emptyText}>No tasks for this date</Text>
            </View>
          ) : (
            selectedDateTasks.map(task => (
              <TouchableOpacity
                key={task.id}
                style={[
                  styles.taskItem,
                  task.completed && styles.taskItemCompleted
                ]}
                onPress={() => onTaskPress?.(task)}
                onLongPress={() => onTaskLongPress?.(task)}
              >
                <TouchableOpacity
                  style={styles.checkbox}
                  onPress={(e) => {
                    e.stopPropagation();
                    onToggleComplete?.(task.id);
                  }}
                >
                  <Icon
                    name={task.completed ? "checkbox-marked" : "checkbox-blank-outline"}
                    size={20}
                    color={task.completed ? theme.colors.accentSuccess : theme.colors.textTertiary}
                  />
                </TouchableOpacity>
                
                <View style={styles.taskContent}>
                  <Text style={[
                    styles.taskTitle,
                    task.completed && styles.taskTitleCompleted
                  ]}>
                    {task.title}
                  </Text>
                  {task.project && selectedProject === 'All' && (
                    <View style={styles.projectTag}>
                      <View style={[styles.projectColorCircle, { backgroundColor: getProjectColor(task.project) }]} />
                      <Text style={styles.projectText}>{task.project}</Text>
                    </View>
                  )}
                </View>
                
                {task.priority && (
                  <View style={[
                    styles.priorityIndicator,
                    { backgroundColor: getPriorityColor(task.priority, theme) }
                  ]} />
                )}
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
        )}
      </View>
    </View>
  );
};

const getPriorityColor = (priority, theme) => {
  switch (priority) {
    case 'high': return theme.colors.accentError || '#FF4444';
    case 'medium': return theme.colors.accentWarning || '#FFAA00';
    case 'low': return theme.colors.accentSuccess || '#44AA44';
    default: return theme.colors.textTertiary;
  }
};

const createStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    position: 'relative',
  },
  
  // Collapsible Header
  collapseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
    minHeight: 56, // Fixed minimum height
  },
  collapseHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  collapseHeaderIcon: {
    justifyContent: 'center',
    alignItems: 'center',
    height: 24,
    width: 24,
  },
  chevronContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    height: 24,
    width: 24,
  },
  collapseHeaderText: {
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginLeft: 10,
  },
  badge: {
    backgroundColor: theme.colors.accentError,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
    paddingHorizontal: 4,
  },
  calendarContent: {
    overflow: 'hidden',
    flex: 1,
  },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  navButton: {
    padding: 8,
  },
  monthYear: {
    alignItems: 'center',
  },
  monthText: {
    fontSize: theme.typography.subtitle || 20,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
  },
  yearText: {
    fontSize: theme.typography.body,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  todayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: 20,
  },
  todayText: {
    fontSize: theme.typography.body,
    color: theme.colors.accentSuccess,
    marginLeft: 6,
    fontWeight: '600',
  },
  daysHeader: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  dayHeaderCell: {
    width: DAY_WIDTH,
    alignItems: 'center',
  },
  dayHeaderText: {
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  emptyCell: {
    width: DAY_WIDTH,
    height: DAY_WIDTH * 0.9,
  },
  dayCell: {
    width: DAY_WIDTH - 6,
    height: DAY_WIDTH - 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    margin: 3,
    position: 'relative',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  todayCell: {
    backgroundColor: theme.colors.surfaceElevated,
    borderColor: theme.colors.accentSuccess,
  },
  selectedCell: {
    borderColor: theme.colors.textPrimary,
  },
  hasTasksCell: {
    // Removed background color - now using text color instead
  },
  dayText: {
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
  },
  todayText: {
    fontWeight: 'bold',
    color: theme.colors.accentSuccess,
  },

  taskDots: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 2,
  },
  taskDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  incompleteDot: {
    backgroundColor: theme.colors.accentError,
  },
  completedDot: {
    backgroundColor: theme.colors.accentSuccess,
  },
  moreTasks: {
    fontSize: 8,
    color: theme.colors.textTertiary,
    marginLeft: 1,
  },
  projectDots: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 2,
    position: 'absolute',
    bottom: 6,
  },
  projectDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  moreProjects: {
    fontSize: 8,
    fontWeight: 'bold',
    marginLeft: 1,
  },
  taskListContainer: {
    flex: 1,
    marginTop: 8,
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  taskListContainerCollapsed: {
    flex: 0,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    marginTop: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  taskListHeaderCollapsed: {
    borderBottomWidth: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  filterContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  filterButtonActive: {
    backgroundColor: theme.colors.surfaceHighlight,
    borderColor: theme.colors.accentSuccess,
  },
  filterText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginLeft: 6,
    fontWeight: '500',
  },
  filterTextActive: {
    color: theme.colors.textPrimary,
    fontWeight: '600',
  },
  taskListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  taskListHeaderContent: {
    flex: 1,
  },
  taskListHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  calendarHint: {
    fontSize: 11,
    color: theme.colors.accentSuccess,
    marginTop: 2,
    fontStyle: 'italic',
  },
  calendarHintBlue: {
    color: '#64B5F6', // Light blue
  },
  taskListTitle: {
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  dateSubtitle: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: 2,
    fontWeight: '500',
  },
  filterButtonInline: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
    marginLeft: 10,
  },
  filterTextInline: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    marginLeft: 4,
    fontWeight: '500',
  },
  taskCount: {
    fontSize: theme.typography.body,
    color: theme.colors.textSecondary,
  },
  taskList: {
    flex: 1,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: theme.typography.body,
    color: theme.colors.textMuted,
    marginTop: 12,
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
  },
  taskItemCompleted: {
    opacity: 0.6,
  },
  checkbox: {
    marginRight: 12,
  },
  taskContent: {
    flex: 1,
  },
  taskTitle: {
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    fontWeight: '500',
  },
  taskTitleCompleted: {
    textDecorationLine: 'line-through',
    color: theme.colors.textTertiary,
  },
  projectTag: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  projectText: {
    fontSize: theme.typography.body,
    color: theme.colors.textSecondary,
    marginLeft: 6,
    fontWeight: '500',
  },
  projectColorCircle: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  priorityIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 8,
  },
  
  // Add Task
  addTaskContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 8,
  },
  addTaskInput: {
    flex: 1,
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 6,
    padding: 10,
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    marginRight: 8,
  },
  addTaskClose: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addTaskPlaceholder: {
    marginHorizontal: 16,
    marginVertical: 8,
  },
  addTaskInputBox: {
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 6,
    padding: 10,
  },
  addTaskPlaceholderText: {
    fontSize: theme.typography.body,
    color: theme.colors.textPlaceholder,
  },
  
  // Search styles
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 8,
  },
  searchInput: {
    flex: 1,
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 6,
    padding: 10,
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    marginRight: 8,
  },
  searchClose: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchPlaceholder: {
    marginHorizontal: 16,
    marginVertical: 8,
  },
  searchInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 6,
    padding: 10,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchPlaceholderText: {
    fontSize: theme.typography.body,
    color: theme.colors.textPlaceholder,
  },
  searchResults: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 12,
  },
  searchResultsTitle: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginBottom: 8,
    fontStyle: 'italic',
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: 8,
    padding: 12,
    marginBottom: 6,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  resultIcon: {
    marginRight: 10,
  },
  resultContent: {
    flex: 1,
  },
  resultTitle: {
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    fontWeight: '500',
  },
  resultMeta: {
    fontSize: 11,
    color: theme.colors.textTertiary,
    marginTop: 2,
  },
  noResultsText: {
    fontSize: theme.typography.body,
    color: theme.colors.textMuted,
    textAlign: 'center',
    paddingVertical: 12,
    fontStyle: 'italic',
  },
});
