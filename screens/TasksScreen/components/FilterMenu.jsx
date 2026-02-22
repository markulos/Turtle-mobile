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

export const FilterMenu = ({ 
  visible, 
  onClose, 
  allTags, 
  filters,
  animation 
}) => {
  const translateY = animation.interpolate({ inputRange: [0, 1], outputRange: [100, 0] });
  const opacity = animation.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <Modal transparent visible={visible} onRequestClose={onClose} animationType="none">
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <Animated.View style={[styles.container, { transform: [{ translateY }], opacity }]}>
          
          {/* View Mode */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>View Mode</Text>
            <View style={styles.viewModeRow}>
              {['tree', 'flat'].map(mode => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.viewOption, filters.viewMode === mode && styles.viewActive]}
                  onPress={() => filters.setViewMode(mode)}
                >
                  <Icon 
                    name={mode === 'tree' ? 'file-tree' : 'format-list-bulleted'} 
                    size={24} 
                    color={filters.viewMode === mode ? '#4CAF50' : '#666'} 
                  />
                  <Text style={[styles.viewText, filters.viewMode === mode && styles.viewTextActive]}>
                    {mode === 'tree' ? 'Tree' : 'List'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* NEW: Incomplete Filter Toggle */}
          <View style={styles.section}>
            <View style={styles.toggleRow}>
              <Text style={styles.sectionTitle}>Show Incomplete Only</Text>
              <Switch
                value={filters.showIncompleteOnly}
                onValueChange={filters.setShowIncompleteOnly}
                trackColor={{ false: '#ddd', true: '#4CAF50' }}
                thumbColor="#fff"
              />
            </View>
            <Text style={styles.hint}>
              {filters.showIncompleteOnly 
                ? 'Hiding completed tasks' 
                : 'Showing all tasks including completed'}
            </Text>
          </View>

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
              {allTags.length === 0 ? (
                <Text style={styles.noTags}>No tags yet</Text>
              ) : (
                allTags.map(tag => {
                  const isSelected = filters.selectedTags.includes(tag);
                  return (
                    <TouchableOpacity
                      key={tag}
                      style={[styles.tagChip, isSelected && styles.tagChipActive]}
                      onPress={() => filters.toggleTagFilter(tag)}
                    >
                      <Text style={[styles.tagText, isSelected && styles.tagTextActive]}>{tag}</Text>
                      {isSelected && <Icon name="check" size={14} color="#fff" style={styles.check} />}
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </View>

          {filters.hasActiveFilters && (
            <TouchableOpacity style={styles.clearAll} onPress={filters.clearFilters}>
              <Icon name="filter-remove" size={20} color="#f44336" />
              <Text style={styles.clearAllText}>Clear All Filters</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  container: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '70%',
  },
  section: { marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#333' },
  clear: { color: '#f44336', fontSize: 14 },
  viewModeRow: { flexDirection: 'row', justifyContent: 'space-around' },
  viewOption: { alignItems: 'center', padding: 15, borderRadius: 12, backgroundColor: '#f5f5f5', width: 100 },
  viewActive: { backgroundColor: '#e8f5e9' },
  viewText: { marginTop: 5, color: '#666' },
  viewTextActive: { color: '#4CAF50', fontWeight: '600' },
  // NEW: Toggle styles
  toggleRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    marginBottom: 5
  },
  hint: { 
    fontSize: 12, 
    color: '#999',
    marginTop: 4
  },
  modeRow: { flexDirection: 'row', marginBottom: 15 },
  modeBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: '#ddd', marginHorizontal: 5, borderRadius: 8 },
  modeBtnActive: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  modeText: { color: '#666' },
  modeTextActive: { color: '#fff', fontWeight: '600' },
  tagsGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  noTags: { color: '#999', fontSize: 14, textAlign: 'center', width: '100%', paddingVertical: 20 },
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
  tagChipActive: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  tagText: { color: '#666', fontSize: 14 },
  tagTextActive: { color: '#fff', fontWeight: '600' },
  check: { marginLeft: 4 },
  clearAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    backgroundColor: '#ffebee',
    borderRadius: 10,
    marginTop: 10,
  },
  clearAllText: { color: '#f44336', marginLeft: 8, fontWeight: '600' },
});