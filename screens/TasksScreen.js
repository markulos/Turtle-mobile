import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  Alert,
  ScrollView,
  Platform,
  Keyboard,
  TouchableWithoutFeedback,
  Animated,
} from 'react-native';
import { useServer } from '../context/ServerContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

export default function TasksScreen() {
  const { isConnected, api } = useServer();
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [selectedProject, setSelectedProject] = useState('All');
  const [selectedTags, setSelectedTags] = useState([]);
  const [tagFilterMode, setTagFilterMode] = useState('any');
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [expandedTags, setExpandedTags] = useState({});
  const [viewMode, setViewMode] = useState('tree');
  const [tagInput, setTagInput] = useState('');
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium',
    completed: false,
    project: '',
    dueDate: '',
    tags: [],
  });

  // Animation for filter menu
  const [menuAnimation] = useState(new Animated.Value(0));

  useEffect(() => {
    if (isConnected) {
      loadData();
    }
  }, [isConnected]);

  useEffect(() => {
    if (showFilterMenu) {
      Animated.spring(menuAnimation, {
        toValue: 1,
        useNativeDriver: true,
        friction: 8,
      }).start();
    } else {
      Animated.timing(menuAnimation, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [showFilterMenu]);

  const loadData = async () => {
    try {
      const [tasksData, projectsData, tagsData] = await Promise.all([
        api.get('/tasks'),
        api.get('/projects'),
        api.get('/tags')
      ]);
      setTasks(tasksData);
      setProjects(projectsData);
      setAllTags(tagsData || []);
      
      if (!formData.project && projectsData.length > 0) {
        setFormData(prev => ({ ...prev, project: projectsData[0] }));
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to load data');
    }
  };

  const collectTags = async (tagsArray) => {
    try {
      const newTags = tagsArray.filter(tag => !allTags.includes(tag));
      if (newTags.length > 0) {
        await api.post('/tags/collect', { tags: newTags });
        setAllTags([...allTags, ...newTags].sort());
      }
    } catch (error) {
      console.error('Failed to collect tags', error);
    }
  };

  const saveProjects = async (newProjects) => {
    try {
      await api.post('/projects', newProjects);
      setProjects(newProjects);
    } catch (error) {
      Alert.alert('Error', 'Failed to save projects');
    }
  };

  const addProject = async (name) => {
    if (!name.trim()) return;
    try {
      await api.post('/projects/add', { name: name.trim() });
      await loadData();
    } catch (error) {
      Alert.alert('Error', 'Failed to add project');
      console.log(error)
    }
  };

  const deleteProject = async (name) => {
    const tasksInProject = tasks.filter(t => t.project === name).length;
    
    Alert.alert(
      'Delete Project',
      tasksInProject > 0 
        ? `"${name}" has ${tasksInProject} tasks. What should happen to them?`
        : `Delete "${name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        ...(tasksInProject > 0 ? [
          { 
            text: 'Move to "No Project"', 
            onPress: async () => {
              try {
                await api.delete(`/projects/${encodeURIComponent(name)}`);
                await loadData();
              } catch (error) {
                Alert.alert('Error', 'Failed to delete project');
              }
            }
          }
        ] : []),
        { 
          text: tasksInProject > 0 ? 'Delete All' : 'Delete', 
          style: 'destructive',
          onPress: async () => {
            try {
              const newTasks = tasks.filter(t => t.project !== name);
              await api.post('/tasks', newTasks);
              await api.delete(`/projects/${encodeURIComponent(name)}`);
              await loadData();
              if (selectedProject === name) setSelectedProject('All');
            } catch (error) {
              Alert.alert('Error', 'Failed to delete project');
            }
          }
        },
      ]
    );
  };

  const toggleTagExpand = (tagKey) => {
    setExpandedTags(prev => ({
      ...prev,
      [tagKey]: !prev[tagKey]
    }));
  };

  const saveTasks = async (newTasks) => {
    try {
      await api.post('/tasks', newTasks);
      setTasks(newTasks);
    } catch (error) {
      Alert.alert('Error', 'Failed to save tasks');
    }
  };

  const toggleComplete = async (id) => {
    const now = Date.now();
    const newTasks = tasks.map(t => {
      if (t.id === id) {
        const newCompleted = !t.completed;
        return { 
          ...t, 
          completed: newCompleted,
          completedAt: newCompleted ? now : null,
          completedTime: newCompleted ? new Date(now).toISOString() : null
        };
      }
      return t;
    });
    await saveTasks(newTasks);
  };

  const parseTags = (input) => {
    return input
      .split(/[,\s]+/)
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 0);
  };

  const handleSave = async () => {
    if (!formData.title.trim()) {
      Alert.alert('Error', 'Task title is required');
      return;
    }

    if (formData.project && !projects.includes(formData.project)) {
      await addProject(formData.project);
    }

    if (formData.tags.length > 0) {
      await collectTags(formData.tags);
    }

    let newTasks;
    if (editingId) {
      newTasks = tasks.map(t => 
        t.id === editingId ? { ...formData, id: editingId } : t
      );
    } else {
      newTasks = [...tasks, { 
        ...formData, 
        id: Date.now().toString(),
        createdAt: Date.now()
      }];
    }

    await saveTasks(newTasks);
    closeModal();
  };

  const handleDelete = (id) => {
    Alert.alert(
      'Delete Task',
      'Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: () => saveTasks(tasks.filter(t => t.id !== id))
        },
      ]
    );
  };

  const openModal = (task = null) => {
    if (task) {
      setFormData({
        ...task,
        tags: Array.isArray(task.tags) ? task.tags : 
              (task.tags ? task.tags.split(',').map(t => t.trim()).filter(t => t) : [])
      });
      setEditingId(task.id);
    } else {
      setFormData({ 
        title: '', 
        description: '', 
        priority: 'medium', 
        completed: false,
        project: selectedProject === 'All' ? (projects[0] || '') : selectedProject,
        dueDate: '',
        tags: []
      });
      setEditingId(null);
    }
    setTagInput('');
    setModalVisible(true);
  };

  const openDetailModal = (task) => {
    setSelectedTask({
      ...task,
      tags: Array.isArray(task.tags) ? task.tags : 
            (task.tags ? task.tags.split(',').map(t => t.trim()).filter(t => t) : [])
    });
    setDetailModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setEditingId(null);
    setTagInput('');
  };

  const closeDetailModal = () => {
    setDetailModalVisible(false);
    setSelectedTask(null);
  };

  const addTagToTask = () => {
    const newTags = parseTags(tagInput);
    const uniqueTags = [...new Set([...formData.tags, ...newTags])];
    setFormData({...formData, tags: uniqueTags});
    setTagInput('');
  };

  const removeTagFromTask = (tagToRemove) => {
    setFormData({
      ...formData, 
      tags: formData.tags.filter(t => t !== tagToRemove)
    });
  };

  const toggleTagFilter = (tag) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter(t => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const clearFilters = () => {
    setSelectedTags([]);
    setTagFilterMode('any');
    setSelectedProject('All');
  };

  const getPriorityColor = (priority) => {
    switch(priority) {
      case 'high': return '#f44336';
      case 'medium': return '#ff9800';
      case 'low': return '#4caf50';
      default: return '#999';
    }
  };

  // Filter and group tasks
  let filteredTasks = tasks;
  
  if (selectedProject !== 'All') {
    if (selectedProject === 'No Project') {
      filteredTasks = filteredTasks.filter(t => !t.project);
    } else {
      filteredTasks = filteredTasks.filter(t => t.project === selectedProject);
    }
  }
  
  if (selectedTags.length > 0) {
    filteredTasks = filteredTasks.filter(task => {
      const taskTags = Array.isArray(task.tags) ? task.tags : 
                      (task.tags ? task.tags.split(',').map(t => t.trim()) : []);
      const taskTagLower = taskTags.map(t => t.toLowerCase());
      
      if (tagFilterMode === 'all') {
        return selectedTags.every(tag => taskTagLower.includes(tag.toLowerCase()));
      } else {
        return selectedTags.some(tag => taskTagLower.includes(tag.toLowerCase()));
      }
    });
  }

  const getGroupedTasks = () => {
    const byProject = {};
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
    Object.entries(byProject).forEach(([project, tags]) => {
      sections.push({
        title: project,
        type: 'project',
        data: []
      });
      
      Object.entries(tags).forEach(([tag, tagTasks]) => {
        sections.push({
          title: tag,
          type: 'tag',
          project: project,
          data: tagTasks.sort((a, b) => {
            if (a.completed === b.completed) return (b.createdAt || 0) - (a.createdAt || 0);
            return a.completed ? 1 : -1;
          }),
          completedCount: tagTasks.filter(t => t.completed).length,
          totalCount: tagTasks.length
        });
      });
    });
    
    return sections;
  };

  const completedCount = filteredTasks.filter(t => t.completed).length;
  const totalCount = filteredTasks.length;

  const renderTreeItem = ({ item, section }) => {
    if (section.type === 'project') return null;
    
    const tagKey = `${section.project}-${section.title}`;
    const isExpanded = expandedTags[tagKey] !== false;
    
    if (!isExpanded) return null;

    return (
      <TouchableOpacity 
        style={[styles.treeTaskItem, item.completed && styles.completedTaskItem]}
        onPress={() => openDetailModal(item)}
      >
        <TouchableOpacity 
          style={styles.treeCheckbox}
          onPress={(e) => {
            e.stopPropagation();
            toggleComplete(item.id);
          }}
        >
          <Icon 
            name={item.completed ? "checkbox-marked" : "checkbox-blank-circle-outline"} 
            size={20} 
            color={item.completed ? "#4CAF50" : "#ccc"} 
          />
        </TouchableOpacity>
        
        <View style={styles.treeTaskContent}>
          <Text style={[styles.treeTaskTitle, item.completed && styles.completedText]}>
            {item.title}
          </Text>
          {item.description ? (
            <Text style={styles.treeTaskDesc} numberOfLines={1}>
              {item.description.split('\n')[0]}
            </Text>
          ) : null}
        </View>
        
        <View style={[styles.priorityDot, { backgroundColor: getPriorityColor(item.priority) }]} />
      </TouchableOpacity>
    );
  };

  const renderTreeSectionHeader = ({ section }) => {
    if (section.type === 'project') {
      return (
        <View style={styles.projectHeader}>
          <Icon name="folder" size={20} color="#4CAF50" />
          <Text style={styles.projectHeaderText}>{section.title}</Text>
        </View>
      );
    }

    const tagKey = `${section.project}-${section.title}`;
    const isExpanded = expandedTags[tagKey] !== false;
    const allCompleted = section.completedCount === section.totalCount && section.totalCount > 0;

    return (
      <TouchableOpacity 
        style={[styles.tagHeader, allCompleted && styles.tagHeaderCompleted]}
        onPress={() => toggleTagExpand(tagKey)}
      >
        <Icon 
          name={isExpanded ? "chevron-down" : "chevron-right"} 
          size={20} 
          color={allCompleted ? "#4CAF50" : "#666"} 
        />
        <Text style={[styles.tagHeaderText, allCompleted && styles.tagHeaderTextCompleted]}>
          {section.title}
        </Text>
        <Text style={styles.tagCount}>
          {section.completedCount}/{section.totalCount}
        </Text>
        {allCompleted && <Icon name="check-circle" size={16} color="#4CAF50" style={styles.allDoneIcon} />}
      </TouchableOpacity>
    );
  };

  const renderProjectDropdown = () => (
    <Modal
      animationType="fade"
      transparent={true}
      visible={showProjectDropdown}
      onRequestClose={() => setShowProjectDropdown(false)}
    >
      <TouchableOpacity 
        style={styles.dropdownOverlay} 
        onPress={() => setShowProjectDropdown(false)}
      >
        <View style={styles.dropdownMenu}>
          <TouchableOpacity 
            style={[styles.dropdownItem, selectedProject === 'All' && styles.dropdownItemActive]}
            onPress={() => { setSelectedProject('All'); setShowProjectDropdown(false); }}
          >
            <Icon name="folder-open" size={20} color={selectedProject === 'All' ? '#4CAF50' : '#666'} />
            <Text style={[styles.dropdownText, selectedProject === 'All' && styles.dropdownTextActive]}>All Projects</Text>
            <Text style={styles.dropdownCount}>{tasks.length}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.dropdownItem, selectedProject === 'No Project' && styles.dropdownItemActive]}
            onPress={() => { setSelectedProject('No Project'); setShowProjectDropdown(false); }}
          >
            <Icon name="folder-off" size={20} color={selectedProject === 'No Project' ? '#4CAF50' : '#666'} />
            <Text style={[styles.dropdownText, selectedProject === 'No Project' && styles.dropdownTextActive]}>No Project</Text>
            <Text style={styles.dropdownCount}>{tasks.filter(t => !t.project).length}</Text>
          </TouchableOpacity>

          {projects.map(project => {
            const count = tasks.filter(t => t.project === project).length;
            return (
              <TouchableOpacity 
                key={project}
                style={[styles.dropdownItem, selectedProject === project && styles.dropdownItemActive]}
                onPress={() => { setSelectedProject(project); setShowProjectDropdown(false); }}
              >
                <Icon name="folder" size={20} color={selectedProject === project ? '#4CAF50' : '#666'} />
                <Text style={[styles.dropdownText, selectedProject === project && styles.dropdownTextActive]} numberOfLines={1}>{project}</Text>
                <Text style={styles.dropdownCount}>{count}</Text>
              </TouchableOpacity>
            );
          })}
          
          <TouchableOpacity 
            style={[styles.dropdownItem, styles.manageProjectsItem]}
            onPress={() => {
              setShowProjectDropdown(false);
              setShowProjectManager(true);
            }}
          >
            <Icon name="cog" size={20} color="#2196F3" />
            <Text style={[styles.dropdownText, { color: '#2196F3' }]}>Manage Projects</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );

  const renderFilterMenu = () => {
    const translateY = menuAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: [100, 0],
    });

    const opacity = menuAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
    });

    return (
      <Modal
        transparent={true}
        visible={showFilterMenu}
        onRequestClose={() => setShowFilterMenu(false)}
        animationType="none"
      >
        <TouchableOpacity 
          style={styles.filterMenuOverlay} 
          activeOpacity={1}
          onPress={() => setShowFilterMenu(false)}
        >
          <Animated.View style={[
            styles.filterMenuContainer,
            { transform: [{ translateY }], opacity }
          ]}>
            {/* View Mode Toggle */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>View Mode</Text>
              <View style={styles.viewModeRow}>
                <TouchableOpacity 
                  style={[styles.viewModeOption, viewMode === 'tree' && styles.viewModeActive]}
                  onPress={() => setViewMode('tree')}
                >
                  <Icon name="file-tree" size={24} color={viewMode === 'tree' ? '#4CAF50' : '#666'} />
                  <Text style={[styles.viewModeText, viewMode === 'tree' && styles.viewModeTextActive]}>Tree</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.viewModeOption, viewMode === 'flat' && styles.viewModeActive]}
                  onPress={() => setViewMode('flat')}
                >
                  <Icon name="format-list-bulleted" size={24} color={viewMode === 'flat' ? '#4CAF50' : '#666'} />
                  <Text style={[styles.viewModeText, viewMode === 'flat' && styles.viewModeTextActive]}>List</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Tag Filters */}
            <View style={styles.filterSection}>
              <View style={styles.filterSectionHeader}>
                <Text style={styles.filterSectionTitle}>Filter by Tags</Text>
                {selectedTags.length > 0 && (
                  <TouchableOpacity onPress={() => setSelectedTags([])}>
                    <Text style={styles.clearText}>Clear</Text>
                  </TouchableOpacity>
                )}
              </View>
              
              <View style={styles.filterModeRow}>
                <TouchableOpacity 
                  style={[styles.filterModeBtn, tagFilterMode === 'any' && styles.filterModeBtnActive]}
                  onPress={() => setTagFilterMode('any')}
                >
                  <Text style={[styles.filterModeBtnText, tagFilterMode === 'any' && styles.filterModeBtnTextActive]}>Any</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.filterModeBtn, tagFilterMode === 'all' && styles.filterModeBtnActive]}
                  onPress={() => setTagFilterMode('all')}
                >
                  <Text style={[styles.filterModeBtnText, tagFilterMode === 'all' && styles.filterModeBtnTextActive]}>All</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.tagsGrid}>
                {allTags.length === 0 ? (
                  <Text style={styles.noTagsText}>No tags yet</Text>
                ) : (
                  allTags.map(tag => (
                    <TouchableOpacity
                      key={tag}
                      style={[
                        styles.tagChip,
                        selectedTags.includes(tag) && styles.tagChipActive
                      ]}
                      onPress={() => toggleTagFilter(tag)}
                    >
                      <Text style={[
                        styles.tagChipText,
                        selectedTags.includes(tag) && styles.tagChipTextActive
                      ]}>
                        {tag}
                      </Text>
                      {selectedTags.includes(tag) && (
                        <Icon name="check" size={14} color="#fff" style={styles.tagCheck} />
                      )}
                    </TouchableOpacity>
                  ))
                )}
              </View>
            </View>

            {/* Clear All Filters */}
            {(selectedTags.length > 0 || selectedProject !== 'All') && (
              <TouchableOpacity style={styles.clearAllBtn} onPress={clearFilters}>
                <Icon name="filter-remove" size={20} color="#f44336" />
                <Text style={styles.clearAllText}>Clear All Filters</Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        </TouchableOpacity>
      </Modal>
    );
  };

  const renderProjectManager = () => (
    <Modal
      animationType="slide"
      transparent={true}
      visible={showProjectManager}
      onRequestClose={() => setShowProjectManager(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.managerContent}>
          <View style={styles.managerHeader}>
            <Text style={styles.managerTitle}>Manage Projects</Text>
            <TouchableOpacity onPress={() => setShowProjectManager(false)}>
              <Icon name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          <View style={styles.addProjectRow}>
            <TextInput
              style={styles.addProjectInput}
              placeholder="New project name..."
              value={newProjectName}
              onChangeText={setNewProjectName}
              onSubmitEditing={() => {
                addProject(newProjectName);
                setNewProjectName('');
              }}
            />
            <TouchableOpacity 
              style={styles.addProjectBtn}
              onPress={() => {
                addProject(newProjectName);
                setNewProjectName('');
              }}
            >
              <Icon name="plus" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          <ScrollView>
            {projects.map(item => (
              <View key={item} style={styles.projectListItem}>
                <View style={styles.projectInfo}>
                  <Icon name="folder" size={20} color="#4CAF50" />
                  <Text style={styles.projectListText}>{item}</Text>
                  <Text style={styles.projectTaskCount}>
                    {tasks.filter(t => t.project === item).length} tasks
                  </Text>
                </View>
                <TouchableOpacity 
                  onPress={() => deleteProject(item)}
                  style={styles.deleteProjectBtn}
                >
                  <Icon name="delete" size={20} color="#f44336" />
                </TouchableOpacity>
              </View>
            ))}
            {projects.length === 0 && (
              <Text style={styles.emptyProjectsText}>No projects yet. Create one above!</Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  if (!isConnected) {
    return (
      <View style={styles.centerContainer}>
        <Icon name="lan-disconnect" size={60} color="#999" />
        <Text style={styles.offlineText}>Not connected to server</Text>
        <Text style={styles.offlineSubtext}>Go to Settings to configure connection</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header with Project Dropdown */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.projectSelector}
          onPress={() => setShowProjectDropdown(true)}
        >
          <Icon name="folder" size={24} color="#4CAF50" />
          <Text style={styles.projectSelectorText} numberOfLines={1}>{selectedProject}</Text>
          <Icon name="chevron-down" size={20} color="#666" />
        </TouchableOpacity>
        
        <View style={styles.statsContainer}>
          <Text style={styles.statsText}>{completedCount}/{totalCount}</Text>
          <View style={styles.progressBar}>
            <View 
              style={[
                styles.progressFill, 
                { width: totalCount ? `${(completedCount/totalCount)*100}%` : '0%' }
              ]} 
            />
          </View>
        </View>
      </View>

      {/* Active Filters Bar */}
      {(selectedTags.length > 0 || selectedProject !== 'All') && (
        <View style={styles.activeFiltersBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {selectedProject !== 'All' && (
              <View style={styles.filterChip}>
                <Icon name="folder" size={12} color="#4CAF50" />
                <Text style={styles.filterChipText}>{selectedProject}</Text>
                <TouchableOpacity onPress={() => setSelectedProject('All')}>
                  <Icon name="close" size={14} color="#666" />
                </TouchableOpacity>
              </View>
            )}
            {selectedTags.map(tag => (
              <View key={tag} style={[styles.filterChip, styles.tagFilterChip]}>
                <Icon name="tag" size={12} color="#2196F3" />
                <Text style={[styles.filterChipText, styles.tagFilterChipText]}>{tag}</Text>
                <TouchableOpacity onPress={() => toggleTagFilter(tag)}>
                  <Icon name="close" size={14} color="#666" />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {renderProjectDropdown()}
      {renderFilterMenu()}
      {renderProjectManager()}

      {/* Task List */}
      {viewMode === 'tree' ? (
        <SectionList
          sections={getGroupedTasks()}
          keyExtractor={(item) => item.id}
          renderItem={renderTreeItem}
          renderSectionHeader={renderTreeSectionHeader}
          contentContainerStyle={styles.treeList}
          stickySectionHeadersEnabled={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Icon name="folder-open" size={60} color="#ccc" />
              <Text style={styles.emptyText}>No tasks match filters</Text>
              <TouchableOpacity onPress={clearFilters} style={styles.clearFiltersBtn}>
                <Text style={styles.clearFiltersText}>Clear filters</Text>
              </TouchableOpacity>
            </View>
          }
        />
      ) : (
        <SectionList
          sections={getGroupedTasks()}
          keyExtractor={(item) => item.id}
          renderItem={renderTreeItem}
          renderSectionHeader={renderTreeSectionHeader}
          contentContainerStyle={styles.treeList}
          stickySectionHeadersEnabled={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Icon name="folder-open" size={60} color="#ccc" />
              <Text style={styles.emptyText}>No tasks match filters</Text>
              <TouchableOpacity onPress={clearFilters} style={styles.clearFiltersBtn}>
                <Text style={styles.clearFiltersText}>Clear filters</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      {/* Floating Action Buttons */}
      <View style={styles.fabContainer}>
        {/* Filter Button */}
        <TouchableOpacity 
          style={[styles.filterFab, (selectedTags.length > 0 || selectedProject !== 'All') && styles.filterFabActive]}
          onPress={() => setShowFilterMenu(true)}
        >
          <Icon name="filter-variant" size={24} color="#fff" />
          {(selectedTags.length > 0 || selectedProject !== 'All') && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>
                {selectedTags.length + (selectedProject !== 'All' ? 1 : 0)}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Add Button */}
        <TouchableOpacity style={styles.addFab} onPress={() => openModal()}>
          <Icon name="plus" size={30} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Add/Edit Task Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={closeModal}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAwareScrollView
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
            enableOnAndroid={true}
            extraScrollHeight={Platform.OS === 'ios' ? 20 : 100}
          >
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>
                  {editingId ? 'Edit Task' : 'New Task'}
                </Text>
                
                <Text style={styles.inputLabel}>Project *</Text>
                <View style={styles.projectSelectRow}>
                  <TextInput
                    style={[styles.input, styles.projectInput]}
                    placeholder="Type new or select existing..."
                    value={formData.project}
                    onChangeText={(text) => setFormData({...formData, project: text})}
                  />
                  <TouchableOpacity 
                    style={styles.projectPickerBtn}
                    onPress={() => {
                      Alert.alert(
                        'Select Project',
                        '',
                        [
                          ...projects.map(p => ({
                            text: p,
                            onPress: () => setFormData({...formData, project: p})
                          })),
                          { text: 'No Project', onPress: () => setFormData({...formData, project: ''}) },
                          { text: 'Cancel', style: 'cancel' }
                        ]
                      );
                    }}
                  >
                    <Icon name="folder-open" size={20} color="#4CAF50" />
                  </TouchableOpacity>
                </View>
                {formData.project && !projects.includes(formData.project) && (
                  <Text style={styles.newProjectHint}>Will create new project "{formData.project}"</Text>
                )}
                
                <Text style={styles.inputLabel}>Title *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="What needs to be done?"
                  value={formData.title}
                  onChangeText={(text) => setFormData({...formData, title: text})}
                />
                
                <Text style={styles.inputLabel}>Tags (comma separated)</Text>
                <View style={styles.tagInputRow}>
                  <TextInput
                    style={[styles.input, styles.tagInput]}
                    placeholder="work, urgent, meeting..."
                    value={tagInput}
                    onChangeText={setTagInput}
                    onSubmitEditing={addTagToTask}
                  />
                  <TouchableOpacity style={styles.addTagBtn} onPress={addTagToTask}>
                    <Icon name="plus" size={20} color="#fff" />
                  </TouchableOpacity>
                </View>
                
                {formData.tags.length > 0 && (
                  <View style={styles.selectedTagsContainer}>
                    {formData.tags.map((tag, idx) => (
                      <View key={idx} style={styles.selectedTagChip}>
                        <Text style={styles.selectedTagText}>{tag}</Text>
                        <TouchableOpacity onPress={() => removeTagFromTask(tag)}>
                          <Icon name="close-circle" size={16} color="#f44336" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
                
                <Text style={styles.inputLabel}>Description</Text>
                <TextInput
                  style={[styles.input, styles.descInput]}
                  placeholder="Add details..."
                  value={formData.description}
                  onChangeText={(text) => setFormData({...formData, description: text})}
                  multiline
                  numberOfLines={3}
                />
                
                <Text style={styles.inputLabel}>Due Date</Text>
                <TextInput
                  style={styles.input}
                  placeholder="YYYY-MM-DD"
                  value={formData.dueDate}
                  onChangeText={(text) => setFormData({...formData, dueDate: text})}
                />
                
                <Text style={styles.inputLabel}>Priority</Text>
                <View style={styles.priorityContainer}>
                  {['low', 'medium', 'high'].map((p) => (
                    <TouchableOpacity
                      key={p}
                      style={[
                        styles.priorityBtn,
                        formData.priority === p && { 
                          backgroundColor: getPriorityColor(p),
                          borderColor: getPriorityColor(p)
                        }
                      ]}
                      onPress={() => setFormData({...formData, priority: p})}
                    >
                      <Text style={[
                        styles.priorityBtnText,
                        formData.priority === p && styles.priorityBtnTextActive
                      ]}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                
                <View style={styles.modalButtons}>
                  <TouchableOpacity style={[styles.modalBtn, styles.cancelBtn]} onPress={closeModal}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.modalBtn, styles.saveBtn]} onPress={handleSave}>
                    <Text style={styles.saveBtnText}>Save Task</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </KeyboardAwareScrollView>
        </View>
      </Modal>

      {/* Detail Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={detailModalVisible}
        onRequestClose={closeDetailModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.detailModalContent}>
            {selectedTask && (
              <>
                <View style={styles.detailHeader}>
                  <View style={[styles.priorityBadge, { backgroundColor: getPriorityColor(selectedTask.priority) }]}>
                    <Text style={styles.priorityText}>{selectedTask.priority}</Text>
                  </View>
                  <TouchableOpacity onPress={closeDetailModal} style={styles.closeBtn}>
                    <Icon name="close" size={24} color="#666" />
                  </TouchableOpacity>
                </View>
                
                <Text style={styles.detailTitle}>{selectedTask.title}</Text>
                
                <View style={styles.detailMeta}>
                  {selectedTask.project ? (
                    <View style={styles.detailMetaItem}>
                      <Icon name="folder" size={16} color="#4CAF50" />
                      <Text style={styles.detailMetaText}>{selectedTask.project}</Text>
                    </View>
                  ) : null}
                  
                  {selectedTask.tags && selectedTask.tags.length > 0 && (
                    <View style={styles.detailTagsContainer}>
                      {selectedTask.tags.map((tag, idx) => (
                        <TouchableOpacity 
                          key={idx} 
                          style={styles.detailTagChip}
                          onPress={() => {
                            closeDetailModal();
                            toggleTagFilter(tag);
                          }}
                        >
                          <Icon name="tag" size={12} color="#2196F3" />
                          <Text style={styles.detailTagText}>{tag}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                  
                  {selectedTask.dueDate && (
                    <View style={styles.detailMetaItem}>
                      <Icon name="calendar" size={16} color="#666" />
                      <Text style={styles.detailMetaText}>Due: {selectedTask.dueDate}</Text>
                    </View>
                  )}
                  
                  <View style={styles.detailMetaItem}>
                    <Icon name="clock-outline" size={16} color="#666" />
                    <Text style={styles.detailMetaText}>
                      Created: {new Date(selectedTask.createdAt).toLocaleDateString()}
                    </Text>
                  </View>

                  {selectedTask.completed && selectedTask.completedTime && (
                    <View style={[styles.detailMetaItem, { backgroundColor: '#e8f5e9' }]}>
                      <Icon name="check-circle" size={16} color="#4CAF50" />
                      <Text style={[styles.detailMetaText, { color: '#4CAF50' }]}>
                        Done: {new Date(selectedTask.completedTime).toLocaleString()}
                      </Text>
                    </View>
                  )}
                </View>
                
                {selectedTask.description ? (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>Description</Text>
                    <Text style={styles.detailDescription}>{selectedTask.description}</Text>
                  </View>
                ) : null}
                
                <View style={styles.detailActions}>
                  <TouchableOpacity 
                    style={[styles.detailActionBtn, styles.editBtn]}
                    onPress={() => {
                      closeDetailModal();
                      openModal(selectedTask);
                    }}
                  >
                    <Icon name="pencil" size={20} color="#fff" />
                    <Text style={styles.detailActionText}>Edit</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={[styles.detailActionBtn, styles.completeBtn, selectedTask.completed && styles.uncompleteBtn]}
                    onPress={() => {
                      toggleComplete(selectedTask.id);
                      closeDetailModal();
                    }}
                  >
                    <Icon 
                      name={selectedTask.completed ? "checkbox-blank-outline" : "checkbox-marked"} 
                      size={20} 
                      color="#fff" 
                    />
                    <Text style={styles.detailActionText}>
                      {selectedTask.completed ? 'Mark Incomplete' : 'Complete'}
                    </Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={[styles.detailActionBtn, styles.deleteBtn]}
                    onPress={() => {
                      handleDelete(selectedTask.id);
                      closeDetailModal();
                    }}
                  >
                    <Icon name="delete" size={20} color="#fff" />
                    <Text style={styles.detailActionText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  offlineText: {
    fontSize: 18,
    color: '#666',
    marginTop: 10,
  },
  offlineSubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 5,
  },
  header: {
    backgroundColor: '#fff',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  projectSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 10,
    flex: 1,
    marginRight: 15,
  },
  projectSelectorText: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 10,
    flex: 1,
    color: '#333',
  },
  statsContainer: {
    alignItems: 'flex-end',
  },
  statsText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  progressBar: {
    width: 60,
    height: 4,
    backgroundColor: '#e0e0e0',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
    borderRadius: 2,
  },
  activeFiltersBar: {
    backgroundColor: '#fff',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 15,
    marginRight: 8,
  },
  tagFilterChip: {
    backgroundColor: '#e3f2fd',
  },
  filterChipText: {
    fontSize: 12,
    color: '#4CAF50',
    marginHorizontal: 4,
  },
  tagFilterChipText: {
    color: '#2196F3',
  },
  dropdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-start',
    paddingTop: 70,
    paddingHorizontal: 15,
  },
  dropdownMenu: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 8,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  dropdownItemActive: {
    backgroundColor: '#e8f5e9',
  },
  manageProjectsItem: {
    borderTopWidth: 2,
    borderTopColor: '#eee',
    marginTop: 5,
  },
  dropdownText: {
    flex: 1,
    fontSize: 16,
    marginLeft: 12,
    color: '#333',
  },
  dropdownTextActive: {
    color: '#4CAF50',
    fontWeight: '600',
  },
  dropdownCount: {
    fontSize: 14,
    color: '#999',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  // Filter Menu Styles
  filterMenuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  filterMenuContainer: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '70%',
  },
  filterSection: {
    marginBottom: 20,
  },
  filterSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  filterSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  clearText: {
    color: '#f44336',
    fontSize: 14,
  },
  viewModeRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  viewModeOption: {
    alignItems: 'center',
    padding: 15,
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
    width: 100,
  },
  viewModeActive: {
    backgroundColor: '#e8f5e9',
  },
  viewModeText: {
    marginTop: 5,
    color: '#666',
  },
  viewModeTextActive: {
    color: '#4CAF50',
    fontWeight: '600',
  },
  filterModeRow: {
    flexDirection: 'row',
    marginBottom: 15,
  },
  filterModeBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    marginHorizontal: 5,
    borderRadius: 8,
  },
  filterModeBtnActive: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  filterModeBtnText: {
    color: '#666',
  },
  filterModeBtnTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  tagsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  noTagsText: {
    color: '#999',
    fontSize: 14,
    textAlign: 'center',
    width: '100%',
    paddingVertical: 20,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    margin: 4,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  tagChipActive: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  tagChipText: {
    color: '#666',
    fontSize: 14,
  },
  tagChipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  tagCheck: {
    marginLeft: 4,
  },
  clearAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    backgroundColor: '#ffebee',
    borderRadius: 10,
    marginTop: 10,
  },
  clearAllText: {
    color: '#f44336',
    marginLeft: 8,
    fontWeight: '600',
  },
  // Tree View Styles
  treeList: {
    paddingBottom: 100,
  },
  projectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e3f2fd',
    padding: 12,
    paddingLeft: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#bbdefb',
  },
  projectHeaderText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1976d2',
    marginLeft: 10,
  },
  tagHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    paddingLeft: 25,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  tagHeaderCompleted: {
    backgroundColor: '#f1f8e9',
  },
  tagHeaderText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginLeft: 8,
  },
  tagHeaderTextCompleted: {
    color: '#4CAF50',
  },
  tagCount: {
    fontSize: 12,
    color: '#999',
    marginRight: 8,
  },
  allDoneIcon: {
    marginLeft: 5,
  },
  treeTaskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fafafa',
    padding: 10,
    paddingLeft: 45,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  completedTaskItem: {
    opacity: 0.7,
  },
  treeCheckbox: {
    marginRight: 10,
  },
  treeTaskContent: {
    flex: 1,
  },
  treeTaskTitle: {
    fontSize: 14,
    color: '#333',
  },
  treeTaskDesc: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 8,
  },
  completedText: {
    textDecorationLine: 'line-through',
    color: '#999',
  },
  emptyState: {
    alignItems: 'center',
    marginTop: 100,
  },
  emptyText: {
    marginTop: 10,
    color: '#999',
    fontSize: 16,
  },
  clearFiltersBtn: {
    marginTop: 15,
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  clearFiltersText: {
    color: '#fff',
    fontWeight: '600',
  },
  // FAB Styles
  fabContainer: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  filterFab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#2196F3',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  filterFabActive: {
    backgroundColor: '#1976d2',
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#f44336',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    paddingHorizontal: 4,
  },
  addFab: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  // Project Manager
  managerContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
    minHeight: 400,
  },
  managerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  managerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  addProjectRow: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  addProjectInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    marginRight: 10,
  },
  addProjectBtn: {
    backgroundColor: '#4CAF50',
    width: 50,
    height: 50,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  projectListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#f9f9f9',
    borderRadius: 10,
    marginBottom: 10,
  },
  projectInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  projectListText: {
    flex: 1,
    fontSize: 16,
    marginLeft: 10,
    color: '#333',
  },
  projectTaskCount: {
    fontSize: 12,
    color: '#999',
    backgroundColor: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  deleteProjectBtn: {
    padding: 5,
  },
  emptyProjectsText: {
    textAlign: 'center',
    color: '#999',
    marginTop: 20,
    fontSize: 16,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalScrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
    marginTop: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
  },
  projectSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  projectInput: {
    flex: 1,
    marginRight: 10,
  },
  projectPickerBtn: {
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
  },
  newProjectHint: {
    fontSize: 12,
    color: '#4CAF50',
    marginTop: 4,
    fontStyle: 'italic',
  },
  tagInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tagInput: {
    flex: 1,
    marginRight: 10,
  },
  addTagBtn: {
    backgroundColor: '#4CAF50',
    width: 46,
    height: 46,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedTagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
    marginBottom: 10,
  },
  selectedTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
  },
  selectedTagText: {
    color: '#4CAF50',
    marginRight: 6,
    fontSize: 14,
  },
  descInput: {
    height: 80,
    textAlignVertical: 'top',
  },
  priorityContainer: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  priorityBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    marginHorizontal: 5,
    alignItems: 'center',
  },
  priorityBtnText: {
    color: '#666',
    fontWeight: '600',
  },
  priorityBtnTextActive: {
    color: '#fff',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 30,
  },
  modalBtn: {
    flex: 1,
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  cancelBtn: {
    backgroundColor: '#f5f5f5',
  },
  saveBtn: {
    backgroundColor: '#4CAF50',
  },
  cancelBtnText: {
    color: '#666',
    fontWeight: '600',
  },
  saveBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  // Detail Modal
  detailModalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  closeBtn: {
    padding: 5,
  },
  detailTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  detailMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 20,
  },
  detailMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    marginRight: 10,
    marginBottom: 5,
  },
  detailMetaText: {
    fontSize: 13,
    color: '#666',
    marginLeft: 6,
  },
  detailTagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginRight: 10,
    marginBottom: 5,
  },
  detailTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 6,
    marginBottom: 4,
  },
  detailTagText: {
    fontSize: 12,
    color: '#2196F3',
    marginLeft: 4,
  },
  detailSection: {
    marginBottom: 20,
  },
  detailSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#999',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  detailDescription: {
    fontSize: 16,
    color: '#333',
    lineHeight: 22,
  },
  detailActions: {
    flexDirection: 'row',
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  detailActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 10,
    marginHorizontal: 5,
  },
  editBtn: {
    backgroundColor: '#2196F3',
  },
  completeBtn: {
    backgroundColor: '#4CAF50',
  },
  uncompleteBtn: {
    backgroundColor: '#ff9800',
  },
  deleteBtn: {
    backgroundColor: '#f44336',
  },
  detailActionText: {
    color: '#fff',
    fontWeight: '600',
    marginLeft: 8,
  },
});