import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Switch,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';

// Same stable per-owner colour as the calendar badges (hash userId → hue) so
// the filter swatch matches the badge a task carries on the grid.
const ownerColor = (userId) => {
  if (!userId) return '#888888';
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) % 360;
  return `hsl(${h}, 60%, 52%)`;
};

export const FilterMenu = ({
  visible,
  onClose,
  tasks,
  selectedProject,
  owners = [],
  filters,
  animation
}) => {
  const { theme } = useTheme();
  const translateY = animation.interpolate({ inputRange: [0, 1], outputRange: [100, 0] });
  const opacity = animation.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  const styles = createStyles(theme);
  
  // Overlay opacity for fade animation
  const overlayOpacity = animation.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] });
  
  // Get tags that exist in the selected project
  const relevantTags = React.useMemo(() => {
    // Filter tasks by selected project
    const projectTasks = selectedProject === 'All' 
      ? tasks 
      : tasks.filter(t => selectedProject === 'No Project' 
          ? !t.project 
          : t.project === selectedProject);
    
    // Extract unique tags from those tasks
    const tagSet = new Set();
    projectTasks.forEach(task => {
      if (task.tags && Array.isArray(task.tags)) {
        task.tags.forEach(tag => tagSet.add(tag));
      }
    });
    
    return Array.from(tagSet).sort();
  }, [tasks, selectedProject]);

  return (
    <Modal transparent visible={visible} onRequestClose={onClose} animationType="none">
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
      </Animated.View>
      <Animated.View 
        style={[styles.container, { transform: [{ translateY }], opacity }]}
        onStartShouldSetResponder={() => true}
        onTouchEnd={(e) => e.stopPropagation()}
      >
          
          {/* Incomplete Filter Toggle */}
          <View style={styles.section}>
            <View style={styles.toggleRow}>
              <Text style={styles.sectionTitle}>Show Incomplete Only</Text>
              <Switch
                value={filters.showIncompleteOnly}
                onValueChange={filters.setShowIncompleteOnly}
                trackColor={{ false: theme.colors.surfaceHighlight, true: '#CCFF00' }}
                thumbColor={filters.showIncompleteOnly ? '#FFFFFF' : theme.colors.textPrimary}
              />
            </View>
            <Text style={styles.hint}>
              {filters.showIncompleteOnly 
                ? 'Hiding completed tasks' 
                : 'Showing all tasks including completed'}
            </Text>
          </View>

          {/* Whose tasks — shared-calendar person filter. Only meaningful when
              more than one pond member has tasks on the calendar; with a single
              owner there's nothing to disambiguate, so the section hides. */}
          {owners.length > 1 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Whose tasks</Text>
                {filters.selectedOwners.length > 0 && (
                  <TouchableOpacity onPress={() => filters.setSelectedOwners([])}>
                    <Text style={styles.clear}>Everyone</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={styles.hint}>
                {filters.selectedOwners.length === 0
                  ? 'Showing everyone on the calendar'
                  : 'Showing only the selected people'}
              </Text>
              <View style={styles.tagsGrid}>
                {owners.map((o) => {
                  const isSelected = filters.selectedOwners.includes(o.userId);
                  return (
                    <TouchableOpacity
                      key={o.userId}
                      style={[styles.tagChip, isSelected && styles.tagChipActive]}
                      onPress={() => filters.toggleOwnerFilter(o.userId)}
                    >
                      <View style={[styles.ownerDot, { backgroundColor: ownerColor(o.userId) }]} />
                      <Text style={[styles.tagText, isSelected && styles.tagTextActive]}>{o.ownerName}</Text>
                      {isSelected && <Icon name="check" size={14} color={theme.colors.textPrimary} style={styles.check} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Tags */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Filter by Tags</Text>
              {filters.selectedTags.length > 0 && (
                <TouchableOpacity onPress={() => filters.setSelectedTags([])}>
                  <Text style={styles.clear}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>
            
            <View style={styles.modeRow}>
              {['any', 'all'].map(mode => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.modeBtn, filters.tagFilterMode === mode && styles.modeBtnActive]}
                  onPress={() => filters.setTagFilterMode(mode)}
                >
                  <Text style={[styles.modeText, filters.tagFilterMode === mode && styles.modeTextActive]}>
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.tagsGrid}>
              {relevantTags.length === 0 ? (
                <Text style={styles.noTags}>
                  {selectedProject === 'All' ? 'No tags yet' : 'No tags in this project'}
                </Text>
              ) : (
                relevantTags.map(tag => {
                  const isSelected = filters.selectedTags.includes(tag);
                  return (
                    <TouchableOpacity
                      key={tag}
                      style={[styles.tagChip, isSelected && styles.tagChipActive]}
                      onPress={() => filters.toggleTagFilter(tag)}
                    >
                      <Text style={[styles.tagText, isSelected && styles.tagTextActive]}>{tag}</Text>
                      {isSelected && <Icon name="check" size={14} color={theme.colors.textPrimary} style={styles.check} />}
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </View>

          {filters.hasActiveFilters && (
            <TouchableOpacity style={styles.clearAll} onPress={filters.clearFilters}>
              <Icon name="filter-remove" size={20} color={theme.colors.accentError} />
              <Text style={styles.clearAllText}>Clear All Filters</Text>
            </TouchableOpacity>
          )}
      </Animated.View>
    </Modal>
  );
};

const createStyles = (theme) => StyleSheet.create({
  overlay: { 
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
  },
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '70%',
  },
  section: { 
    marginBottom: 20 
  },
  sectionHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 10 
  },
  sectionTitle: { 
    fontSize: theme.typography.body, 
    fontWeight: '600', 
    color: theme.colors.textPrimary 
  },
  clear: { 
    color: theme.colors.accentError, 
    fontSize: theme.typography.body 
  },
  // Toggle styles
  toggleRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    marginBottom: 5
  },
  hint: { 
    fontSize: theme.typography.body, 
    color: theme.colors.textMuted,
    marginTop: 4
  },
  modeRow: { 
    flexDirection: 'row', 
    marginBottom: 15 
  },
  modeBtn: { 
    flex: 1, 
    paddingVertical: 8, 
    alignItems: 'center', 
    borderWidth: 0.5, 
    borderColor: theme.colors.border, 
    marginHorizontal: 5, 
    borderRadius: 8,
    backgroundColor: theme.colors.surfaceElevated,
  },
  modeBtnActive: { 
    backgroundColor: theme.colors.surfaceHighlight, 
    borderColor: theme.colors.border 
  },
  modeText: { 
    color: theme.colors.textSecondary,
    fontSize: theme.typography.body,
  },
  modeTextActive: { 
    color: theme.colors.textPrimary, 
    fontWeight: '600',
    fontSize: theme.typography.body,
  },
  tagsGrid: { 
    flexDirection: 'row', 
    flexWrap: 'wrap' 
  },
  noTags: { 
    color: theme.colors.textMuted, 
    fontSize: theme.typography.body, 
    textAlign: 'center', 
    width: '100%', 
    paddingVertical: 20 
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    margin: 4,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  tagChipActive: { 
    backgroundColor: theme.colors.surfaceHighlight, 
    borderColor: theme.colors.border 
  },
  tagText: { 
    color: theme.colors.textSecondary, 
    fontSize: theme.typography.body 
  },
  tagTextActive: { 
    color: theme.colors.textPrimary, 
    fontWeight: '600',
    fontSize: theme.typography.body,
  },
  check: {
    marginLeft: 4
  },
  ownerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  clearAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: 10,
    marginTop: 10,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  clearAllText: { 
    color: theme.colors.accentError, 
    marginLeft: 8, 
    fontWeight: '600',
    fontSize: theme.typography.body,
  },
});
