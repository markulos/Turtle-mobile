import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
  Alert,
  Keyboard,
  findNodeHandle,
  Platform,
  KeyboardAvoidingView,
  TextInput,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing as ReEasing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useServer } from '../../context/ServerContext';
import { useTheme } from '../../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTaskData } from './hooks/useTaskData';
import { useCollapsibleTasks } from './hooks/useCollapsibleTasks';
import { advanceDueDate, itemTypeOf } from './utils/taskHelpers';

// An event is "over" once its end is in the past — start time + duration (a
// default hour when unset), or the end of its day for an all-day event. Used to
// auto-tick events off the calendar; birthdays and recurring items are exempt
// (they're not one-shot, so "done forever" would be wrong).
const EVENT_DEFAULT_DURATION_MIN = 60;
const eventIsOver = (item, nowMs) => {
  if (!item || itemTypeOf(item) !== 'event') return false;
  if (item.recurring && item.recurring !== 'none') return false;
  if (!item.dueDate || typeof item.dueDate !== 'string') return false;
  const [y, m, d] = item.dueDate.split('-').map(Number);
  if (!y || !m || !d) return false;
  if (item.time && /^\d{1,2}:\d{2}/.test(item.time)) {
    const [hh, mm] = item.time.split(':').map(Number);
    const dur = Number(item.duration) > 0 ? Number(item.duration) : EVENT_DEFAULT_DURATION_MIN;
    return new Date(y, m - 1, d, hh, mm + dur, 0, 0).getTime() <= nowMs;
  }
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime() <= nowMs;
};
import {
  ProjectDropdown,
  configureProjectDropdownAnimation,
  FilterMenu,
  TaskStatsModal,
  ProjectManager,
  TaskForm,
  TaskDetail,
  TaskItem,
  SectionHeader,
  CalendarView,
} from './components';
import FriendCard from '../TurtleScreen/components/FriendCard';

// Must match MAX_HEIGHT in ProjectDropdown.jsx — the page below the picker
// is translated down by exactly this much as the picker reveals, so the two
// stay seamlessly joined.
const PROJECT_DROPDOWN_HEIGHT = 360;
// Same duration + easing the ProjectDropdown uses for its own height reveal,
// so the page-shift below tracks the picker's bottom edge frame-for-frame.
const DROPDOWN_OPEN_MS = 280;
const DROPDOWN_CLOSE_MS = 240;
const DROPDOWN_EASE = ReEasing.bezier(0.4, 0, 0.2, 1);

export default function TasksScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { isConnected, api } = useServer();
  const menuAnimation = useRef(new Animated.Value(0)).current;
  const [showDropdown, setShowDropdown] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showStats, setShowStats] = useState(false);
  // Mirror of the calendar's selected day (CalendarView owns it; it reports
  // up via onSelectedDateChange) so the stats panel can show that day's
  // scheduled/completed counts.
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  // Whose-profile-is-open: { userId, ownerName } set when a task's owner badge
  // is tapped on the shared calendar; drives the FriendCard popup below.
  const [profileOwner, setProfileOwner] = useState(null);
  // Item type to pre-select when CREATING via the calendar "+" menu
  // ('task' | 'event' | 'birthday'). Ignored when editing an existing item.
  const [newItemType, setNewItemType] = useState('task');
  // Date (YYYY-MM-DD) to pre-fill when creating from a tapped calendar day's
  // "+" button. Null for the FAB create menu (no specific day chosen).
  const [newItemDate, setNewItemDate] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(true);
  const [selectedProject, setSelectedProject] = useState('All');
  const [selectedTags, setSelectedTags] = useState([]);
  const [tagFilterMode, setTagFilterMode] = useState('any');
  // Shared-calendar "whose tasks" filter. Empty = show everyone's; otherwise a
  // list of user ids to show. The owner identity rides on each task DTO
  // (userId/ownerName) from the server, so the option list is derived straight
  // from the loaded tasks — no extra fetch needed.
  const [selectedOwners, setSelectedOwners] = useState([]);
  const [viewMode, setViewMode] = useState('calendar'); // 'list' or 'calendar'
  // Edit vs View mode for the LIST view. Default VIEW: a clean list with no
  // add-task inputs or tag-edit affordances cluttering it — just the projects,
  // tag groups, and tasks. Edit mode reveals the inline "add task", tag
  // rename/add, etc. (gated throughout on `editMode`).
  const [editMode, setEditMode] = useState(false);
  // True while the calendar's day-schedule planner (bottom sheet) is raised.
  // When open, the calendar⇄list pager is locked so horizontal swipes page
  // between DAYS inside the planner instead of switching to the list view.
  const [dayPlannerOpen, setDayPlannerOpen] = useState(false);

  // ── List ⇄ Calendar horizontal pager ─────────────────────────────────
  // The two views sit side by side in a paging ScrollView so the user can
  // swipe left/right between them (like the photos viewer), in addition to the
  // header toggle. Page order = calendar (left, the default) | list (right).
  // The calendar's own gestures are vertical (month FlatList + the bottom-sheet
  // drag), so a horizontal page-swipe never fights them.
  const { width: windowWidth } = useWindowDimensions();
  const pagerRef = useRef(null);
  // Live horizontal offset of the calendar⇄list pager, tracked on the native
  // thread so the header segmented-control slider tracks the swipe 1:1 — the
  // same interface the Photos tab bar uses (MediaGallery `pageScrollX`).
  const pagerScrollX = useRef(new Animated.Value(0)).current;
  // Measured page box. Width is seeded from the window so the initial
  // contentOffset lands on the right page before onLayout fires; height is
  // measured (a ScrollView's children need a bounded height for the nested
  // SectionList / calendar FlatList to scroll).
  const [pagerSize, setPagerSize] = useState({ width: windowWidth, height: 0 });
  const VIEW_PAGES = ['calendar', 'list'];
  const viewIndex = (m) => (m === 'calendar' ? 0 : 1);
  // Tap the header toggle → set the mode AND glide the pager to that page.
  const goToView = useCallback((mode) => {
    setViewMode(mode);
    pagerRef.current?.scrollTo({ x: viewIndex(mode) * pagerSize.width, y: 0, animated: true });
  }, [pagerSize.width]);
  // Settle after a swipe → adopt whichever page we landed on (no re-scroll, so
  // this can't fight goToView's programmatic scroll).
  const onPagerSettle = useCallback((e) => {
    const w = pagerSize.width || windowWidth;
    const idx = Math.round(e.nativeEvent.contentOffset.x / w);
    const mode = VIEW_PAGES[idx] || 'calendar';
    setViewMode((prev) => (prev === mode ? prev : mode));
  }, [pagerSize.width, windowWidth]);

  // NOTE: the selected-day completion stats (dayStats / dayPct) live AFTER the
  // useTaskData() call below — they read `tasks`, and declaring them up here
  // (above the hook) left `tasks` undefined on first render, throwing
  // "cannot read property 'filter' of undefined".

  // ── Project-picker reveal (smooth) ───────────────────────────────────
  // The picker itself is an absolute overlay (see ProjectDropdown). To keep
  // the original "the page slides down as the picker opens" look WITHOUT
  // relayouting the heavy list/calendar every frame, we push the page with a
  // compositor-only transform: translateY = progress * height. progress runs
  // on the UI thread with the exact same timing/easing as the picker's own
  // height animation, so the page's top edge stays glued to the picker's
  // bottom edge throughout the open/close.
  const dropdownProgress = useSharedValue(showDropdown ? 1 : 0);
  useEffect(() => {
    dropdownProgress.value = withTiming(showDropdown ? 1 : 0, {
      duration: showDropdown ? DROPDOWN_OPEN_MS : DROPDOWN_CLOSE_MS,
      easing: DROPDOWN_EASE,
    });
  }, [showDropdown, dropdownProgress]);
  const contentShiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dropdownProgress.value * PROJECT_DROPDOWN_HEIGHT }],
  }));

  // Inline add task state per project
  const [inlineAddingProject, setInlineAddingProject] = useState(null);
  const [inlineTaskTitle, setInlineTaskTitle] = useState('');
  const inlineInputRef = useRef(null);

  // Pull-down search state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchAnim = useRef(new Animated.Value(0)).current;
  const searchInputRef = useRef(null);
  const SEARCH_BAR_HEIGHT = 52;
  const OVERSCROLL_REVEAL_THRESHOLD = -56;

  // Ref for scrolling to items when keyboard appears
  const listRef = useRef(null);
  const scrollY = useRef(0);
  
  // Keyboard handling
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  
  useEffect(() => {
    const showListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        setKeyboardHeight(e.endCoordinates.height);
        setKeyboardVisible(true);
      }
    );
    const hideListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
        setKeyboardVisible(false);
      }
    );
    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, []);
  
  const {
    tasks, setTasks, projects, allTags,
    loadData, saveTasks, collectTags, addProject, deleteProject,
    handleAddSubtask,
    handleToggleSubtask,
    handleDeleteSubtask,
    handleUpdateSubtask,
    deleteTask,
    loading,
    refreshing,
    onRefresh,
    lazyRefresh,
  } = useTaskData(api, isConnected);

  // Always-current snapshot of `tasks` so the row handlers below (held by
  // memoized TaskItem rows) read the LATEST array, never a stale closure.
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  // Distinct task owners present on the shared calendar, derived from the task
  // DTOs (each carries userId + ownerName). Drives the "whose tasks" filter
  // option list and the per-owner colour badges. `multiUser` gates both: a
  // solo pond shows no person-filter and no badges (nothing to disambiguate).
  const owners = useMemo(() => {
    const seen = new Map();
    for (const t of tasks) {
      if (t.userId && !seen.has(t.userId)) {
        seen.set(t.userId, { userId: t.userId, ownerName: t.ownerName || 'Unknown' });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.ownerName.localeCompare(b.ownerName));
  }, [tasks]);
  const multiUser = owners.length > 1;

  // Keep the owner filter honest if the underlying set shrinks (e.g. a member's
  // tasks disappear): drop any selected id that no longer exists.
  useEffect(() => {
    setSelectedOwners((prev) => {
      if (prev.length === 0) return prev;
      const valid = prev.filter((id) => owners.some((o) => o.userId === id));
      return valid.length === prev.length ? prev : valid;
    });
  }, [owners]);

  // ── Selected-day completion (drives the header count + full-width bar) ──
  // The header now reflects just the tasks SCHEDULED for the selected calendar
  // day (under the active project/tag filter), completed vs total — tap it to
  // open the stats panel for all-time / per-project breakdowns. Mirrors the
  // modal's `day` logic so the two always agree.
  const dayStats = useMemo(() => {
    const d = calendarDate instanceof Date ? calendarDate : new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const passesFilter = (t) => {
      if (selectedProject !== 'All') {
        const matches = selectedProject === 'No Project' ? !t.project : (t.project || 'No Project') === selectedProject;
        if (!matches) return false;
      }
      if (selectedTags.length > 0) {
        const tt = t.tags || [];
        if (tagFilterMode === 'all') { if (!selectedTags.every((x) => tt.includes(x))) return false; }
        else if (!selectedTags.some((x) => tt.includes(x))) return false;
      }
      return true;
    };
    const scheduled = tasks.filter((t) => t.dueDate === dateStr && passesFilter(t));
    const completed = scheduled.filter((t) => t.completed).length;
    return { total: scheduled.length, completed };
  }, [tasks, calendarDate, selectedProject, selectedTags, tagFilterMode]);
  const dayPct = dayStats.total ? Math.round((dayStats.completed / dayStats.total) * 100) : 0;

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
    '#607D8B', // Blue Grey
    '#8BC34A', // Light Green
    '#00E676', // Bright Green
    '#2979FF', // Bright Blue
    '#D500F9', // Bright Purple
    '#FF3D00', // Bright Orange
    '#00B0FF', // Light Blue
    '#76FF03', // Lime
    '#FFEA00', // Yellow
    '#FF9100', // Amber
  ];

  // Create a memoized mapping of project names to colors
  const projectColorMap = useMemo(() => {
    const map = {};
    projects.forEach((project, index) => {
      map[project] = projectColors[index % projectColors.length];
    });
    return map;
  }, [projects]);

  // Get color for a project
  const getProjectColor = (projectName) => {
    if (!projectName || projectName === 'All') return theme.colors.textSecondary;
    return projectColorMap[projectName] || theme.colors.textSecondary;
  };
  
  // Use collapsible tasks hook - ALL collapsed by default
  const collapsible = useCollapsibleTasks(tasks, projects, {
    showIncompleteOnly,
    selectedProject,
    selectedTags,
    tagFilterMode,
    searchQuery,
  });

  // "Upcoming" agenda shown ABOVE the by-topic project tree in the list view.
  // A global summary (independent of the project/tag filter below) so "what's
  // next" is always one glance away. Two bands, in this order:
  //   1. TIMED tasks dated today or later — the actually-scheduled stuff,
  //      soonest first (by date then time).
  //   2. UNTIMED open tasks ("pending" — added to a day without confirming a
  //      time, or no date at all). NOT limited to today; just open tasks,
  //      newest-created first.
  // Items here also appear in their project/topic group below — that
  // duplication is intentional (quick agenda + organised tree).
  const upcomingTasks = useMemo(() => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const open = (tasks || []).filter((t) => t && !t.completed);
    const timed = open
      .filter((t) => t.time && typeof t.dueDate === 'string' && t.dueDate >= todayStr)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || String(a.time).localeCompare(String(b.time)));
    const untimed = open
      .filter((t) => !t.time)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return [...timed, ...untimed];
  }, [tasks]);

  // Prepend the upcoming section to the grouped tree (only when it has items);
  // a section footer renders the gap before the project tree.
  const listSections = useMemo(() => {
    if (!upcomingTasks.length) return collapsible.groupedData;
    return [
      // Tag the copies so their list keys don't collide with the SAME task shown
      // again in its project/topic group below (duplicate keys break SectionList
      // reconciliation — wrong rows update).
      { type: 'upcoming', title: 'Upcoming', isExpanded: true, data: upcomingTasks.map((t) => ({ ...t, __upcoming: true })) },
      ...collapsible.groupedData,
    ];
  }, [upcomingTasks, collapsible.groupedData]);

  // Animate the search bar in/out on the UI thread (transform + opacity).
  useEffect(() => {
    Animated.timing(searchAnim, {
      toValue: showSearch ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [showSearch, searchAnim]);

  // Focus the input the moment the bar finishes opening; if dismissed, drop the query.
  useEffect(() => {
    if (showSearch) {
      const id = setTimeout(() => searchInputRef.current?.focus(), 240);
      return () => clearTimeout(id);
    }
    if (searchQuery) setSearchQuery('');
    Keyboard.dismiss();
  }, [showSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const dismissSearch = useCallback(() => {
    setShowSearch(false);
  }, []);
  
  // Function to scroll to a specific item
  const scrollToItem = useCallback((itemId) => {
    if (!collapsible?.groupedData) return;
    
    // Find the section and index of the item
    let itemIndex = -1;
    let sectionIndex = -1;
    
    for (let i = 0; i < collapsible.groupedData.length; i++) {
      const section = collapsible.groupedData[i];
      if (section.type === 'tag' && section.data) {
        const idx = section.data.findIndex(item => item.id === itemId);
        if (idx !== -1) {
          sectionIndex = i;
          itemIndex = idx;
          break;
        }
      }
    }
    
    if (sectionIndex !== -1 && itemIndex !== -1 && listRef.current) {
      listRef.current.scrollToLocation({
        sectionIndex,
        itemIndex,
        viewOffset: 100, // Scroll so item is not at the very bottom
        animated: true,
      });
    }
  }, [collapsible?.groupedData]);
  
  // Project chevron rotation animations
  const projectRotations = useRef({}).current;
  
  // Initialize rotation animations for projects
  useEffect(() => {
    projects.forEach(project => {
      if (!projectRotations[project]) {
        projectRotations[project] = new Animated.Value(0);
      }
    });
  }, [projects]);
  
  // Animate project chevron when expanded state changes
  useEffect(() => {
    Object.entries(collapsible.expandedProjects).forEach(([project, isExpanded]) => {
      if (projectRotations[project]) {
        Animated.timing(projectRotations[project], {
          toValue: isExpanded ? 1 : 0,
          duration: 200,
          useNativeDriver: true,
        }).start();
      }
    });
  }, [collapsible.expandedProjects]);

  useEffect(() => {
    if (showFilterMenu) {
      Animated.spring(menuAnimation, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
    } else {
      Animated.timing(menuAnimation, { 
        toValue: 0, 
        duration: 200, 
        useNativeDriver: true,
        easing: Easing.out(Easing.ease)
      }).start();
    }
  }, [showFilterMenu, menuAnimation]);

  const handleSaveTask = async (taskData) => {
    if (taskData.tags?.length > 0) await collectTags(taskData.tags);
    
    const newTasks = taskData.id && tasks.find(t => t.id === taskData.id)
      ? tasks.map(t => t.id === taskData.id ? taskData : t)
      // Preserve any subtasks the caller provided (e.g. re-adding a previous
      // task copies its subtasks); default to [] only when none were given.
      : [...tasks, { ...taskData, subtasks: taskData.subtasks || [] }];
    
    await saveTasks(newTasks);
  };

  // Toggling a task card's checkbox. Mirrors the web app's revised
  // recurring-completion logic (web TasksScreen.handleToggleComplete):
  // completing a RECURRING task doesn't mark it done forever — it advances
  // the dueDate to the next occurrence and leaves the task active, so it
  // reappears on its next scheduled day. We still stamp completedAt /
  // completedTime so callers know when the last occurrence was checked off,
  // even though `completed` stays false. Non-recurring tasks (and
  // un-completing anything) fall through to the plain boolean toggle.
  const handleToggleComplete = async (id) => {
    const now = Date.now();
    const task = tasksRef.current.find(t => t.id === id);
    if (!task) return;

    const isCompleting = !task.completed;

    if (isCompleting && task.recurring && task.recurring !== 'none') {
      const nextDueDate = advanceDueDate(task.dueDate, task.recurring);
      const newTasks = tasksRef.current.map(t =>
        t.id === id
          ? {
              ...t,
              dueDate: nextDueDate,
              completedAt: now,
              completedTime: new Date(now).toISOString(),
            }
          : t
      );
      await saveTasks(newTasks);
      return;
    }

    const newTasks = tasksRef.current.map(t => {
      if (t.id !== id) return t;
      const completed = !t.completed;
      return {
        ...t,
        completed,
        completedAt: completed ? now : null,
        completedTime: completed ? new Date(now).toISOString() : null
      };
    });
    await saveTasks(newTasks);
  };
  
  const handleUpdateTask = async (taskId, updates) => {
    const newTasks = tasksRef.current.map(t => {
      if (t.id !== taskId) return t;
      return { ...t, ...updates };
    });
    await saveTasks(newTasks);
  };

  // Auto-complete events once they're over — an event in the past is, by
  // definition, done, so its checkbox ticks itself off in the calendar without
  // anyone tapping it. Sweeps on task changes and once a minute (to catch an
  // event ending while the app is open). One batched save; idempotent — after a
  // sweep there's nothing left to flip, so it doesn't loop.
  useEffect(() => {
    const sweep = () => {
      const now = Date.now();
      const list = tasksRef.current || [];
      const due = list.filter((t) => !t.completed && eventIsOver(t, now));
      if (due.length === 0) return;
      const ids = new Set(due.map((t) => t.id));
      const iso = new Date(now).toISOString();
      saveTasks(list.map((t) =>
        ids.has(t.id) ? { ...t, completed: true, completedAt: now, completedTime: iso } : t
      ));
    };
    sweep();
    const id = setInterval(sweep, 60000);
    return () => clearInterval(id);
    // saveTasks/tasksRef are stable refs; re-sweep whenever the task set changes.
  }, [tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = (id) => {
    const task = tasksRef.current.find(t => t.id === id);
    const hasSubtasks = task?.subtasks && task.subtasks.length > 0;
    
    // Skip confirmation if no subtasks
    if (!hasSubtasks) {
      saveTasks(tasksRef.current.filter(t => t.id !== id));
      return;
    }
    
    Alert.alert('Delete Task', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Delete', 
        style: 'destructive',
        onPress: () => saveTasks(tasksRef.current.filter(t => t.id !== id))
      }
    ]);
  };

  const handleInlineAdd = (project, tags, title) => {
    const actualProject = project === 'No Project' ? '' : project;
    
    const newTask = {
      title: title,
      description: '',
      priority: 'medium',
      completed: false,
      project: actualProject,
      dueDate: '',
      tags: tags || [],
      subtasks: [],
      id: Date.now().toString(),
      createdAt: Date.now()
    };
    
    handleSaveTask(newTask);
  };

  const handleRenameTag = async (project, oldTag, newTag) => {
    // Update all tasks that have the old tag
    const updatedTasks = tasks.map(task => {
      if (!task.tags || task.tags.length === 0) return task;
      
      // Check if task has the old tag
      const tagIndex = task.tags.indexOf(oldTag);
      if (tagIndex === -1) return task;
      
      // Replace old tag with new tag
      const newTags = [...task.tags];
      newTags[tagIndex] = newTag;
      
      return { ...task, tags: newTags };
    });
    
    await saveTasks(updatedTasks);
  };

  const handleAddTagToSection = async (project, existingTags, newTag) => {
    // Find all tasks in this section (matching project and existing tags)
    const updatedTasks = tasks.map(task => {
      // Check if task matches this section
      const taskProject = task.project || 'No Project';
      const sectionProject = project || 'No Project';
      
      if (taskProject !== sectionProject) return task;
      
      // For Untagged section, we want tasks with no tags
      // For tagged sections, we want tasks with the existing tags
      const taskTags = task.tags || [];
      const isUntaggedSection = !existingTags || existingTags.length === 0;
      const isTaskUntagged = !taskTags || taskTags.length === 0;
      
      if (isUntaggedSection && !isTaskUntagged) return task;
      if (!isUntaggedSection) {
        // Check if task has any of the section's tags
        const hasMatchingTag = existingTags.some(tag => taskTags.includes(tag));
        if (!hasMatchingTag) return task;
      }
      
      // Add the new tag to the task
      return { ...task, tags: [...taskTags, newTag] };
    });
    
    await saveTasks(updatedTasks);
    await collectTags([newTag]);
  };

  const openEditForm = (task) => {
    setEditingTask(task);
    setShowTaskForm(true);
  };

  // Open the unified create form pre-set to a kind chosen from the calendar
  // "+" menu (birthday / task / event). The type stays switchable inside the form.
  // `date` (YYYY-MM-DD, optional) pre-fills the due/occasion date when creating
  // from a specific tapped calendar day.
  const openCreateForm = useCallback((type, date) => {
    setEditingTask(null);
    setNewItemType(type || 'task');
    setNewItemDate(date || null);
    setShowTaskForm(true);
  }, []);

  const openDetail = (task) => {
    setSelectedTask(task);
    setShowDetail(true);
  };

  const closeTaskForm = () => {
    setShowTaskForm(false);
    setEditingTask(null);
  };

  const styles = createStyles(theme);

  // ── Photos-style sliding segmented control ──────────────────────────
  // The active pill + the two icons' opacities are driven by the pager's
  // scroll offset (1:1, native thread), so the toggle slides smoothly with the
  // swipe AND on tap — exactly like the Photos tab bar's bezier indicator,
  // instead of the old discrete active-background snap. Calendar = left page
  // (index 0), list = right page (index 1).
  const TOGGLE_SEG_WIDTH = 40;
  const pagerWidth = pagerSize.width || windowWidth;
  const toggleIndicatorX = pagerScrollX.interpolate({
    inputRange: [0, pagerWidth],
    outputRange: [0, TOGGLE_SEG_WIDTH],
    extrapolate: 'clamp',
  });
  const calActiveOp = pagerScrollX.interpolate({ inputRange: [0, pagerWidth], outputRange: [1, 0], extrapolate: 'clamp' });
  const listActiveOp = pagerScrollX.interpolate({ inputRange: [0, pagerWidth], outputRange: [0, 1], extrapolate: 'clamp' });

  if (!isConnected) {
    return (
      <View style={[styles.centerContainer, { paddingTop: insets.top }]}>
        <Image
          source={require('../../assets/pond-offline.png')}
          style={[styles.offlineImage, { tintColor: theme.colors.textTertiary }]}
          resizeMode="contain"
        />
        <Text style={styles.offlineText}>Unable to reach pond</Text>
        <Text style={styles.offlineSubtext}>Check your connection, or set your pond in Settings.</Text>
      </View>
    );
  }

  // Check if any filters active
  const hasActiveFilters = !showIncompleteOnly || selectedTags.length > 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Whisper-faint gradient wash — barely-there white with a
          breath of cool blue at the top, fading to nothing. Reads as
          a soft halo / atmospheric depth cue rather than a visible
          gradient. Alpha values are intentionally tiny (0.06 → 0)
          so the underlying theme background stays dominant; the
          gradient is just the lightest hint of warmth over the dark. */}
      <LinearGradient
        colors={[
          'rgba(205, 220, 255, 0.07)',  // top-left: faint blue-tinted white
          'rgba(235, 240, 255, 0.025)', // middle: even fainter
          'rgba(255, 255, 255, 0)',     // bottom-right: dissolved out
        ]}
        locations={[0, 0.55, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={styles.backgroundGradient}
        pointerEvents="none"
      />

      {/* Custom Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.projectSelector}
          // Toggle the inline picker. configureNext fires BEFORE the
          // state change so the native UIManager registers the layout
          // animation against the same commit that adds/removes the
          // dropdown. Running it inside the dropdown's own useEffect
          // (which is post-commit) was the cause of the previous
          // "doesn't animate" bug — the animation queued but the
          // layout had already settled.
          onPress={() => {
            configureProjectDropdownAnimation();
            setShowDropdown(v => !v);
          }}
        >
          <View style={[styles.projectSelectorSquare, { backgroundColor: getProjectColor(selectedProject) }]} />
          <Text style={styles.projectSelectorText} numberOfLines={1}>
            {selectedProject === 'All' ? 'All' : selectedProject}
          </Text>
          {/* Chevron flips 180° while the picker is open. The
              transform sits on a small wrapper because Icon doesn't
              accept transform directly. */}
          <View style={{ transform: [{ rotate: showDropdown ? '180deg' : '0deg' }] }}>
            <Icon name="chevron-down" size={18} color={theme.colors.textTertiary} />
          </View>
        </TouchableOpacity>
        
        <View style={styles.headerRight}>
          {/* Filter button — lives in the header (was a floating FAB at the
              bottom-right that overlapped the calendar/list content). Opens
              the same FilterMenu bottom-sheet; shows a count badge when any
              filter is active. */}
          <TouchableOpacity
            style={[styles.headerFilterBtn, hasActiveFilters && styles.headerFilterBtnActive]}
            onPress={() => setShowFilterMenu(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon
              name="filter-variant"
              size={20}
              color={hasActiveFilters ? theme.colors.textPrimary : theme.colors.textTertiary}
            />
            {hasActiveFilters && (
              <View style={styles.headerFilterBadge}>
                <Text style={styles.headerFilterBadgeText}>
                  {selectedTags.length + (!showIncompleteOnly ? 1 : 0)}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {/* View Mode Toggle — a sliding segmented control modelled on the
              Photos tab bar: the active pill + the icon cross-fades track the
              pager's scroll offset 1:1, so it glides with the swipe (and on
              tap) instead of snapping. Calendar = left page, list = right. */}
          <View style={styles.viewToggle}>
            {/* Sliding active pill (bound to the pager scroll). */}
            <Animated.View
              pointerEvents="none"
              style={[styles.viewToggleIndicator, { transform: [{ translateX: toggleIndicatorX }] }]}
            />
            <TouchableOpacity
              style={styles.viewBtn}
              onPress={() => goToView('calendar')}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Calendar view"
            >
              {/* Active (bright) icon fades in as this page becomes current;
                  the inactive (dim) icon underneath fades out. */}
              <Animated.View style={[styles.viewBtnIconLayer, { opacity: calActiveOp }]}>
                <Icon name="calendar-month" size={20} color={theme.colors.textPrimary} />
              </Animated.View>
              <Animated.View style={{ opacity: listActiveOp }}>
                <Icon name="calendar-month" size={20} color={theme.colors.textTertiary} />
              </Animated.View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.viewBtn}
              onPress={() => goToView('list')}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="List view"
            >
              <Animated.View style={[styles.viewBtnIconLayer, { opacity: listActiveOp }]}>
                <Icon name="format-list-bulleted" size={20} color={theme.colors.textPrimary} />
              </Animated.View>
              <Animated.View style={{ opacity: calActiveOp }}>
                <Icon name="format-list-bulleted" size={20} color={theme.colors.textTertiary} />
              </Animated.View>
            </TouchableOpacity>
          </View>
          
          {/* The header count now reflects just the SELECTED DAY's tasks
              (completed / scheduled). Tap to open the stats panel where the
              metric can switch to all-time + per-project breakdowns. */}
          <TouchableOpacity
            style={styles.statsContainer}
            onPress={() => setShowStats(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <Text style={styles.statsText}>{dayStats.completed}/{dayStats.total}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Full-bleed day-completion bar, directly under the header — a 3px
          solid-white fill on a faint track, matching the photos loading bar.
          Spans the whole screen width; reflects the selected day's ratio. */}
      <View style={styles.dayProgressTrack}>
        <View style={[styles.dayProgressFill, { width: `${dayPct}%` }]} />
      </View>

      {/* Project-picker overlay host. The picker (rendered at the bottom of
          this host) is an absolute overlay pinned just below the header.
          Everything else lives in the sibling "shift layer" below, which the
          reveal translates DOWN by the picker's height — a compositor-only
          transform, so the heavy list/calendar never relayouts (that was the
          stutter). overflow:hidden clips the shifted layer's bottom so it
          can't spill over the tab bar / FAB. Modals inside render via RN
          portals, so the transform doesn't touch them. */}
      <View style={styles.dropdownHost}>
      <Reanimated.View style={[styles.dropdownShiftLayer, contentShiftStyle]}>

      {/* Active Filters */}
      {hasActiveFilters && (
        <View style={styles.activeFiltersBar}>
          <Animated.ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {!showIncompleteOnly && (
              <View style={[styles.filterChip, styles.warningChip]}>
                <Icon name="eye-off" size={12} color={theme.colors.accentWarning} />
                <Text style={[styles.filterChipText, styles.warningChipText]}>Showing Completed</Text>
                <TouchableOpacity onPress={() => setShowIncompleteOnly(true)}>
                  <Icon name="close" size={14} color={theme.colors.textTertiary} />
                </TouchableOpacity>
              </View>
            )}
            {selectedTags.map(tag => (
              <View key={tag} style={[styles.filterChip, styles.tagFilterChip]}>
                <Icon name="tag" size={12} color={theme.colors.textPrimary} />
                <Text style={[styles.filterChipText, styles.tagFilterChipText]}>{tag}</Text>
                <TouchableOpacity onPress={() => 
                  setSelectedTags(prev => prev.filter(t => t !== tag))
                }>
                  <Icon name="close" size={14} color={theme.colors.textTertiary} />
                </TouchableOpacity>
              </View>
            ))}
          </Animated.ScrollView>
        </View>
      )}

      {/* Modals — ProjectDropdown is no longer here; it lives inline
          below the header so it reveals as part of the page flow. */}
      <FilterMenu
        visible={showFilterMenu}
        onClose={() => setShowFilterMenu(false)}
        tasks={tasks}
        selectedProject={selectedProject}
        owners={owners}
        filters={{
          showIncompleteOnly,
          setShowIncompleteOnly,
          selectedTags,
          setSelectedTags,
          toggleTagFilter: (tag) => {
            setSelectedTags(prev =>
              prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
            );
          },
          tagFilterMode,
          setTagFilterMode,
          selectedOwners,
          setSelectedOwners,
          toggleOwnerFilter: (userId) => {
            setSelectedOwners(prev =>
              prev.includes(userId) ? prev.filter(u => u !== userId) : [...prev, userId]
            );
          },
          clearFilters: () => {
            setShowIncompleteOnly(true);
            setSelectedTags([]);
            setTagFilterMode('any');
            setSelectedOwners([]);
          },
          hasActiveFilters: selectedTags.length > 0 || !showIncompleteOnly || selectedOwners.length > 0
        }}
        animation={menuAnimation}
      />

      <TaskStatsModal
        visible={showStats}
        onClose={() => setShowStats(false)}
        tasks={tasks}
        selectedProject={selectedProject}
        selectedTags={selectedTags}
        tagFilterMode={tagFilterMode}
        selectedDate={calendarDate}
      />

      <ProjectManager
        visible={showProjectManager}
        onClose={() => setShowProjectManager(false)}
        projects={projects}
        tasks={tasks}
        onAdd={addProject}
        onDelete={deleteProject}
      />

      <TaskForm
        visible={showTaskForm}
        onClose={closeTaskForm}
        onSave={handleSaveTask}
        onDelete={deleteTask}
        initialData={editingTask}
        initialType={newItemType}
        initialDate={newItemDate}
        projects={projects}
        allTags={allTags}
        onAddProject={addProject}
        onCollectTags={collectTags}
      />

      <TaskDetail
        // Derive the detail task LIVE from `tasks` (not the snapshot captured
        // at openDetail) so toggling a subtask checkbox — which updates the
        // `tasks` array — re-renders the popup with the new state. Without this
        // the checkbox never visually flips ("can't cross off subtasks").
        task={selectedTask ? (tasks.find(t => t.id === selectedTask.id) || selectedTask) : null}
        visible={showDetail}
        onClose={() => setShowDetail(false)}
        onEdit={() => { setShowDetail(false); openEditForm(selectedTask); }}
        onToggleComplete={() => handleToggleComplete(selectedTask.id)}
        onDelete={() => { handleDelete(selectedTask.id); setShowDetail(false); }}
        onTagPress={() => {}}
        onToggleSubtask={handleToggleSubtask}
      />

      {/* Owner profile — opened by tapping a task's owner badge on the shared
          calendar. Built from what the task list carries (name + that person's
          tasks); phone/role/avatar light up once a members feed is wired in. */}
      <FriendCard
        friend={profileOwner ? { id: profileOwner.userId, displayName: profileOwner.ownerName } : null}
        tasks={profileOwner ? tasks.filter((t) => t.userId === profileOwner.userId) : []}
        onClose={() => setProfileOwner(null)}
      />

      {/* Swipeable Calendar ⇄ List pager. Both views are mounted side by side
          so the user can swipe between them; the header toggle scrolls it too.
          NOTE: we deliberately do NOT pass `contentOffset` (the Photos pager
          doesn't either). Rebuilding a fresh contentOffset object each render
          makes RN re-apply it to the native ScrollView — on Android that yanks
          the scroll back mid-swipe whenever an unrelated re-render lands (the
          "stuck half-way" glitch). Calendar is index 0 = the natural start
          offset, so no seeding is needed; the header toggle uses scrollTo. The
          measured size gives the nested lists a bounded height. */}
      <Animated.ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        // Lock the calendar⇄list pager while the day-schedule planner is open,
        // so a horizontal swipe pages between DAYS inside the planner instead
        // of switching to the list view (see CalendarView's dayPan).
        scrollEnabled={!dayPlannerOpen}
        // Match the Photos pager: no edge rubber-banding, so the clamped pill
        // never sits still while the content bounces — the slide stays 1:1.
        bounces={false}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onMomentumScrollEnd={onPagerSettle}
        // Feed the live page offset to the header segmented control (native
        // thread) so its slider tracks the swipe frame-for-frame.
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: pagerScrollX } } }],
          { useNativeDriver: true }
        )}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setPagerSize((p) => (p.width === width && p.height === height ? p : { width, height }));
        }}
        style={styles.viewPager}
      >
        {/* Page 0 — Calendar */}
        <View style={{ width: pagerSize.width, height: pagerSize.height }}>
        <CalendarView
          tasks={tasks}
          selectedProject={selectedProject}
          selectedTags={selectedTags}
          tagFilterMode={tagFilterMode}
          selectedOwners={selectedOwners}
          multiUser={multiUser}
          onTaskPress={openDetail}
          onTaskLongPress={openEditForm}
          onToggleComplete={handleToggleComplete}
          onUpdateTask={handleUpdateTask}
          onAddTask={(title, project, dueDate, time, extras) => {
            // `time` is the fourth argument — set when the user
            // long-pressed a slot on the day calendar grid. Null for
            // the regular "Add a new task" placeholder flow, in which
            // case the task is created untimed (omit the field rather
            // than store an empty string the server would interpret
            // as "set to 00:00").
            // `extras` (fifth arg) carries description/tags/subtasks when the
            // user re-adds a previously-existing task from the title
            // suggestions — copied onto this fresh instance with the new date.
            const newTask = {
              title,
              description: extras?.description || '',
              priority: extras?.priority || 'medium',
              completed: false,
              project,
              dueDate,
              tags: extras?.tags || [],
              subtasks: extras?.subtasks || [],
              id: Date.now().toString(),
              createdAt: Date.now(),
              ...(time ? { time } : {}),
            };
            handleSaveTask(newTask);
          }}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onDateChange={lazyRefresh}
          onSelectedDateChange={setCalendarDate}
          onPlannerOpenChange={setDayPlannerOpen}
          // The day-planner's "+" creates a task pre-dated to the tapped day;
          // the type is still switchable inside the form.
          onCreateForDate={(dateStr) => openCreateForm('task', dateStr)}
          // Tap a task's owner badge → open that person's profile card.
          onOwnerPress={(t) => { if (t?.userId) setProfileOwner({ userId: t.userId, ownerName: t.ownerName }); }}
        />
        </View>
        {/* Page 1 — List */}
        <View style={{ width: pagerSize.width, height: pagerSize.height }}>
        {/* List toolbar: current scope label + View/Edit mode toggle. View mode
            (default) keeps the list clean for reading; Edit mode reveals the
            add-task / tag-edit controls. */}
        <View style={styles.listToolbar}>
          <Text style={styles.listToolbarTitle} numberOfLines={1}>
            {selectedProject === 'All' ? 'All projects' : selectedProject}
          </Text>
          <View style={styles.modeToggle}>
            <TouchableOpacity
              style={[styles.modeBtn, !editMode && styles.modeBtnActive]}
              onPress={() => setEditMode(false)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="View mode"
            >
              <Icon name="eye-outline" size={15} color={!editMode ? theme.colors.textPrimary : theme.colors.textTertiary} />
              <Text style={[styles.modeBtnText, !editMode && styles.modeBtnTextActive]}>View</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, editMode && styles.modeBtnActive]}
              onPress={() => setEditMode(true)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Edit mode"
            >
              <Icon name="pencil-outline" size={15} color={editMode ? theme.colors.textPrimary : theme.colors.textTertiary} />
              <Text style={[styles.modeBtnText, editMode && styles.modeBtnTextActive]}>Edit</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.listClip}>
          {/* Pull-down search bar — overlays the top of the list. Animated on the
              UI thread (transform + opacity only) so the gesture stays smooth.
              The list below shares the same Animated value, so the two move as a unit. */}
          <Animated.View
            style={[
              styles.searchBarWrap,
              {
                transform: [{
                  translateY: searchAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-SEARCH_BAR_HEIGHT, 0],
                  }),
                }],
                opacity: searchAnim,
              },
            ]}
            pointerEvents={showSearch ? 'auto' : 'none'}
          >
            <View style={styles.searchInputRow}>
              <Icon name="magnify" size={18} color={theme.colors.textTertiary} style={styles.searchIcon} />
              <TextInput
                ref={searchInputRef}
                style={styles.searchInput}
                placeholder="Search tasks and subtasks..."
                placeholderTextColor={theme.colors.textPlaceholder}
                value={searchQuery}
                onChangeText={setSearchQuery}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="while-editing"
              />
              {searchQuery.length > 0 && Platform.OS !== 'ios' && (
                <TouchableOpacity
                  onPress={() => setSearchQuery('')}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={styles.searchClearBtn}
                >
                  <Icon name="close-circle" size={16} color={theme.colors.textTertiary} />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity style={styles.searchCancelBtn} onPress={dismissSearch}>
              <Text style={styles.searchCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Animated.View>

          <Animated.View
            style={[
              styles.listShift,
              {
                transform: [{
                  translateY: searchAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, SEARCH_BAR_HEIGHT],
                  }),
                }],
              },
            ]}
          >
          <SectionList
            ref={listRef}
            sections={listSections}
            keyExtractor={(item, index) => (item ? `${item.__upcoming ? 'upcoming-' : ''}${item.id || index}` : `section-${index}`)}
            // Drag-to-dismiss the keyboard (iMessage-style) when the
            // user scrolls a task list with the search keyboard up.
            // Without these props the keyboard sticks and the user has
            // no obvious gesture to close it.
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            onScroll={(e) => {
              const y = e.nativeEvent.contentOffset.y;
              scrollY.current = y;
              // Reveal the search bar when the user overscrolls past the threshold.
              if (!showSearch && y <= OVERSCROLL_REVEAL_THRESHOLD) {
                setShowSearch(true);
              }
            }}
            scrollEventThrottle={16}
            renderItem={({ item, section }) => {
              if (!item) return null;
              // Render tasks for the synthetic "upcoming" agenda and for expanded
              // tag groups; everything else (collapsed groups, project rows) skips.
              if (section.type !== 'tag' && section.type !== 'upcoming') return null;
              if (!section.isExpanded) return null;

              return (
                <TaskItem 
                  item={item} 
                  onPress={() => openDetail(item)}
                  onToggleComplete={handleToggleComplete}
                  onLongPress={openEditForm}
                  onAddSubtask={handleAddSubtask}
                  onToggleSubtask={handleToggleSubtask}
                  onDeleteSubtask={handleDeleteSubtask}
                  onUpdateSubtask={handleUpdateSubtask}
                  onUpdateTask={handleUpdateTask}
                  onDeleteTask={handleDelete}
                  listRef={listRef}
                  scrollY={scrollY}
                  scrollToItem={() => scrollToItem(item.id)}
                  keyboardVisible={keyboardVisible}
                />
              );
            }}
            renderSectionHeader={({ section }) => {
              if (section.type === 'upcoming') {
                return (
                  <View style={styles.upcomingHeader}>
                    <Icon name="clock-fast" size={16} color={theme.colors.accentInfo} />
                    <Text style={styles.upcomingHeaderText}>Upcoming</Text>
                    <View style={styles.upcomingCountBadge}>
                      <Text style={styles.upcomingCountText}>{section.data.length}</Text>
                    </View>
                  </View>
                );
              }
              if (section.type === 'project') {
                // Project header with collapse toggle. A coloured left border +
                // count badge (in the project's colour) make each project
                // visually distinct at a glance.
                const projColor = getProjectColor(section.project);
                return (
                  <View style={styles.projectSection}>
                    <TouchableOpacity
                      style={[styles.projectHeader, { borderLeftColor: projColor }]}
                      onPress={() => collapsible.toggleProjectExpand(section.project)}
                      activeOpacity={0.7}
                    >
                      <Animated.View style={{
                        transform: [{
                          rotate: (projectRotations[section.project] || new Animated.Value(0)).interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0deg', '90deg']
                          })
                        }]
                      }}>
                        <Icon name="chevron-right" size={22} color={projColor} />
                      </Animated.View>
                      <Text style={styles.projectHeaderText} numberOfLines={1}>{section.title}</Text>
                      {section.visibleTaskCount > 0 && (
                        <View style={styles.projectCountBadge}>
                          <Text style={[styles.projectCountText, { color: projColor }]}>{section.visibleTaskCount}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                    
                    {/* Add task input — shown only in EDIT mode, so View mode
                        stays clean. */}
                    {section.isExpanded && editMode && (
                      inlineAddingProject === section.project ? (
                        // Inline input mode
                        <View style={styles.projectAddTaskContainer}>
                          <TextInput
                            ref={inlineInputRef}
                            style={styles.projectAddTaskInputField}
                            placeholder="Add a new task"
                            placeholderTextColor={theme.colors.textPlaceholder}
                            value={inlineTaskTitle}
                            onChangeText={setInlineTaskTitle}
                            onSubmitEditing={() => {
                              if (inlineTaskTitle.trim()) {
                                handleInlineAdd(section.project, [], inlineTaskTitle.trim());
                                setInlineTaskTitle('');
                                setInlineAddingProject(null);
                              }
                            }}
                            autoFocus
                            blurOnSubmit={false}
                            returnKeyType="done"
                            onBlur={() => {
                              // Delay to allow button press first
                              setTimeout(() => {
                                setInlineTaskTitle('');
                                setInlineAddingProject(null);
                              }, 200);
                            }}
                          />
                          <TouchableOpacity 
                            style={styles.projectAddTaskClose}
                            onPress={() => {
                              setInlineTaskTitle('');
                            setInlineAddingProject(null);
                            }}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          >
                            <Icon name="close" size={18} color={theme.colors.textTertiary} />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        // Placeholder mode
                        <TouchableOpacity
                          style={styles.projectAddTaskPlaceholder}
                          onPress={() => setInlineAddingProject(section.project)}
                          activeOpacity={0.7}
                        >
                          <View style={styles.projectAddTaskInput} pointerEvents="none">
                            <Text style={styles.projectAddTaskText}>Add a new task</Text>
                          </View>
                        </TouchableOpacity>
                      )
                    )}
                  </View>
                );
              }
              
              // Tag group header - only shown if parent project is expanded
              return (
                <SectionHeader
                  section={section}
                  expanded={section.isExpanded}
                  editMode={editMode}
                  onToggleExpand={() => collapsible.toggleTagGroupExpand(section.project, section.title)}
                  onAddTask={handleInlineAdd}
                  onRenameTag={handleRenameTag}
                  onAddTagToSection={handleAddTagToSection}
                  projectColor={getProjectColor(section.project)}
                />
              );
            }}
            renderSectionFooter={({ section }) => (
              section.type === 'upcoming' ? <View style={styles.upcomingGap} /> : null
            )}
            contentContainerStyle={[
              styles.list,
              { paddingBottom: Math.max(100, keyboardHeight + 20) },
            ]}
            stickySectionHeadersEnabled={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.colors.accentPrimary}
                colors={[theme.colors.accentPrimary]}
              />
            }
            ListEmptyComponent={(
              <View style={styles.emptyState}>
                <Icon
                  name={searchQuery ? 'magnify-close' : 'folder-open'}
                  size={64}
                  color={theme.colors.textMuted}
                />
                <Text style={styles.emptyText}>
                  {searchQuery
                    ? `No matches for "${searchQuery}"`
                    : (showIncompleteOnly && tasks.some(t => t.completed)
                      ? 'No incomplete tasks'
                      : 'No tasks yet')}
                </Text>
                {!searchQuery && (
                  <TouchableOpacity
                    onPress={() => {
                      setEditingTask(null);
                      setShowTaskForm(true);
                    }}
                    style={styles.addNewTaskBtn}
                  >
                    <Icon name="plus" size={20} color={theme.colors.textPrimary} />
                    <Text style={styles.addNewTaskText}>Add new task</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          />
          </Animated.View>
        </View>
        </View>
      </Animated.ScrollView>
      </Reanimated.View>

      {/* Project picker — absolute overlay on top of the shift layer. Its
          own height/opacity reveal (ProjectDropdown.jsx) is byte-for-byte
          unchanged; it just no longer sits in flow, so it pushes nothing.
          The shift layer above moves with the same progress, so the page
          stays glued to the picker's bottom edge through the open/close. */}
      <ProjectDropdown
        visible={showDropdown}
        onClose={() => {
          configureProjectDropdownAnimation();
          setShowDropdown(false);
        }}
        projects={projects}
        tasks={tasks}
        selected={selectedProject}
        onSelect={(project) => {
          configureProjectDropdownAnimation();
          setSelectedProject(project);
          setShowDropdown(false);
        }}
        onManage={() => setShowProjectManager(true)}
        onAddProject={addProject}
      />
      </View>

      {/* The "+" create button now lives in the day-planner header's right
          corner (CalendarView's headerAddBtn) — a single white add button with
          the task count to its left. The old floating bottom-right FAB was
          removed to de-clutter the calendar page (smart minimalism). */}
    </View>
  );
}

const createStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  // Positioned host for the project-picker overlay. flex:1 so it fills the
  // space below the header; overflow:hidden clips the shift layer's bottom
  // (translated down by the picker height) so it never draws over the tab
  // bar / FAB. Absolute children (the picker) anchor to this host's top.
  dropdownHost: {
    flex: 1,
    overflow: 'hidden',
  },
  // The page content (filters bar + list/calendar) that slides down as the
  // picker reveals. flex:1 so the list/calendar keep their full height; the
  // translateY is applied via the animated contentShiftStyle.
  dropdownShiftLayer: {
    flex: 1,
  },
  // Horizontal paging ScrollView holding the calendar + list pages.
  viewPager: {
    flex: 1,
  },
  // Full-screen gradient layer — sits behind the entire screen via
  // absoluteFillObject. zIndex 0 keeps it under regular flex children
  // (which default to elevation 0 but render in DOM order, on top).
  backgroundGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  centerContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: theme.colors.background 
  },
  offlineImage: {
    width: 54,
    height: 45,
  },
  offlineText: {
    fontSize: 13,
    color: theme.colors.textTertiary,
    marginTop: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  offlineSubtext: {
    fontSize: 11,
    color: theme.colors.textMuted,
    marginTop: 5,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  projectSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  projectSelectorText: { 
    fontSize: theme.typography.body, 
    fontWeight: '600', 
    marginLeft: 8, 
    marginRight: 8,
    color: theme.colors.textPrimary 
  },
  projectSelectorSquare: {
    width: 16,
    height: 16,
    borderRadius: 3,
  },
  statsContainer: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  statsText: {
    fontSize: theme.typography.body,
    color: theme.colors.textTertiary,
  },
  // Full-width day-completion bar under the header — photos-loading style:
  // a 3px solid-white fill on a faint white track, edge to edge.
  dayProgressTrack: {
    width: '100%',
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
  },
  dayProgressFill: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Header filter button — replaces the old bottom-right floating FAB so the
  // filter control sits in the header and no longer overlaps screen content.
  // Sized + bordered to match the viewToggle sitting next to it.
  headerFilterBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: theme.colors.surface,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerFilterBtnActive: {
    backgroundColor: theme.colors.surfaceElevated,
  },
  headerFilterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: theme.colors.accentError,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  headerFilterBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  viewToggle: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    padding: 2,
    marginRight: 12,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
    position: 'relative', // anchors the absolute sliding pill
  },
  // The sliding active pill — its translateX is bound to the pager scroll so it
  // glides between the two segments 1:1 with the swipe (Photos-tab style).
  viewToggleIndicator: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 2,
    width: 40, // = TOGGLE_SEG_WIDTH; matches a segment's width
    borderRadius: 6,
    // Match the Photos tab bar's pill exactly: a light fill (white on light,
    // near-grey on dark) with a soft drop shadow, so it reads as a lifted
    // iOS-style segmented-control thumb gliding over the track.
    backgroundColor: theme.mode === 'dark' ? '#333333' : '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  viewBtn: {
    width: 40, // fixed so the sliding pill aligns with each segment 1:1
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Active (bright) icon layer, stacked over the inactive (dim) one; their
  // opacities cross-fade as the pager scrolls.
  viewBtnIconLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  // List-page toolbar with the View/Edit toggle.
  listToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  listToolbarTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    marginRight: 12,
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    padding: 2,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  modeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  modeBtnActive: {
    backgroundColor: theme.colors.surfaceElevated,
  },
  modeBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textTertiary,
  },
  modeBtnTextActive: {
    color: theme.colors.textPrimary,
  },
  // Spacing between consecutive project groups, so projects read as distinct
  // blocks rather than one undivided list.
  // "Upcoming" agenda header (synthetic section at the top of the list view).
  upcomingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  upcomingHeaderText: {
    fontSize: theme.typography.body,
    fontWeight: '800',
    color: theme.colors.textPrimary,
    letterSpacing: 0.3,
    flex: 1,
  },
  upcomingCountBadge: {
    minWidth: 22,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upcomingCountText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.accentInfo,
    fontVariant: ['tabular-nums'],
  },
  // The breathing room between the upcoming agenda and the project tree below.
  upcomingGap: {
    height: 14,
    marginTop: 4,
    marginBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  projectSection: {
    marginTop: 8,
  },
  projectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
    // Coloured accent edge (colour set inline per project) — the quickest
    // visual cue for which project a block belongs to.
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  projectHeaderText: {
    fontSize: theme.typography.body,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    marginLeft: theme.spacing.sm,
    flex: 1,
  },
  // Count of the project's currently-visible tasks, tinted in the project colour.
  projectCountBadge: {
    minWidth: 22,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  projectCountText: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  projectTaskCount: {
    fontSize: theme.typography.body,
    color: theme.colors.textTertiary,
    backgroundColor: theme.colors.surfaceHighlight,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.pill,
    marginRight: theme.spacing.sm,
  },

  projectAddTaskPlaceholder: {
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  projectAddTaskInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 6,
    padding: 8,
    paddingLeft: theme.spacing.xl,
  },
  projectAddTaskText: {
    fontSize: theme.typography.body,
    color: theme.colors.textPlaceholder,
  },
  projectAddTaskContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  projectAddTaskInputField: {
    flex: 1,
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 6,
    padding: 8,
    paddingLeft: theme.spacing.xl,
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    marginRight: 8,
  },
  projectAddTaskClose: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },

  listClip: {
    flex: 1,
    overflow: 'hidden',
  },
  listShift: {
    flex: 1,
  },
  searchBarWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 52,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    backgroundColor: theme.colors.background,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  searchInputRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 36,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: theme.typography.body,
    color: theme.colors.inputText,
    padding: 0,
  },
  searchClearBtn: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  searchCancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchCancelText: {
    color: theme.colors.accentPrimary || theme.colors.textPrimary,
    fontSize: theme.typography.body,
    fontWeight: '600',
  },

  activeFiltersBar: {
    backgroundColor: theme.colors.background,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    marginRight: 8,
  },
  warningChip: { 
    backgroundColor: 'rgba(255, 193, 7, 0.15)' 
  },
  tagFilterChip: { 
    backgroundColor: theme.colors.surface 
  },
  filterChipText: { 
    fontSize: theme.typography.body, 
    color: theme.colors.textPrimary, 
    marginHorizontal: 4 
  },
  warningChipText: { 
    color: theme.colors.accentWarning 
  },
  tagFilterChipText: { 
    color: theme.colors.textSecondary 
  },
  
  list: { 
    paddingBottom: 100 
  },
  emptyState: { 
    alignItems: 'flex-start',
    marginTop: 80,
    paddingLeft: theme.spacing.xl,
    paddingRight: theme.spacing.md,
  },
  emptyText: { 
    marginTop: 16, 
    color: theme.colors.textSecondary, 
    fontSize: theme.typography.body 
  },
  addNewTaskBtn: { 
    marginTop: 20, 
    backgroundColor: theme.colors.surfaceElevated, 
    paddingHorizontal: 24, 
    paddingVertical: 12, 
    borderRadius: 24, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  addNewTaskText: { 
    color: theme.colors.textPrimary, 
    fontWeight: '600', 
    marginLeft: 8, 
    fontSize: theme.typography.body 
  },

});
