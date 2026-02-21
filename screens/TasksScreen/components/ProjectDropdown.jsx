import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export const ProjectDropdown = ({ 
  visible, 
  onClose, 
  projects, 
  tasks, 
  selected, 
  onSelect, 
  onManage 
}) => {
  if (!visible) return null;
  
  const getCount = (project) => {
    if (project === 'All') return tasks.length;
    if (project === 'No Project') return tasks.filter(t => !t.project).length;
    return tasks.filter(t => t.project === project).length;
  };

  const items = [
    { key: 'All', icon: 'folder-open', label: 'All Projects' },
    { key: 'No Project', icon: 'folder-off', label: 'No Project' },
    ...projects.map(p => ({ key: p, icon: 'folder', label: p }))
  ];

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} onPress={onClose}>
        <View style={styles.menu}>
          {items.map(({ key, icon, label }) => (
            <TouchableOpacity
              key={key}
              style={[styles.item, selected === key && styles.itemActive]}
              onPress={() => { onSelect(key); onClose(); }}
            >
              <Icon name={icon} size={20} color={selected === key ? '#4CAF50' : '#666'} />
              <Text style={[styles.text, selected === key && styles.textActive]} numberOfLines={1}>
                {label}
              </Text>
              <Text style={styles.count}>{getCount(key)}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity 
            style={[styles.item, styles.manageItem]}
            onPress={() => { onClose(); onManage(); }}
          >
            <Icon name="cog" size={20} color="#2196F3" />
            <Text style={[styles.text, { color: '#2196F3' }]}>Manage Projects</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-start',
    paddingTop: 70,
    paddingHorizontal: 15,
  },
  menu: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 8,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  itemActive: { backgroundColor: '#e8f5e9' },
  manageItem: { borderTopWidth: 2, borderTopColor: '#eee', marginTop: 5 },
  text: { flex: 1, fontSize: 16, marginLeft: 12, color: '#333' },
  textActive: { color: '#4CAF50', fontWeight: '600' },
  count: {
    fontSize: 14,
    color: '#999',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
});