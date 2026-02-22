import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Clipboard, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export const PasswordCard = ({ 
  item, 
  showPassword, 
  onTogglePassword, 
  onEdit, 
  onDelete 
}) => {
  const copyToClipboard = (text, label) => {
    Clipboard.setString(text);
    Alert.alert('Copied', `${label} copied to clipboard`);
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleSection}>
          <Icon name="key-variant" size={24} color="#4CAF50" />
          <Text style={styles.title}>{item.title}</Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity onPress={() => onEdit(item)} style={styles.actionBtn}>
            <Icon name="pencil" size={20} color="#2196F3" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onDelete(item.id)} style={styles.actionBtn}>
            <Icon name="delete" size={20} color="#f44336" />
          </TouchableOpacity>
        </View>
      </View>
      
      {item.username && (
        <TouchableOpacity 
          style={styles.row} 
          onPress={() => copyToClipboard(item.username, 'Username')}
        >
          <Text style={styles.label}>Username:</Text>
          <Text style={styles.value}>{item.username}</Text>
          <Icon name="content-copy" size={16} color="#666" />
        </TouchableOpacity>
      )}
      
      <TouchableOpacity style={styles.row} onPress={() => onTogglePassword(item.id)}>
        <Text style={styles.label}>Password:</Text>
        <Text style={styles.value}>
          {showPassword ? item.password : '••••••••'}
        </Text>
        <Icon name={showPassword ? "eye-off" : "eye"} size={16} color="#666" />
      </TouchableOpacity>
      
      {showPassword && (
        <TouchableOpacity 
          style={styles.copyBtn}
          onPress={() => copyToClipboard(item.password, 'Password')}
        >
          <Text style={styles.copyText}>Copy Password</Text>
        </TouchableOpacity>
      )}
      
      {item.notes && (
        <Text style={styles.notes}>{item.notes}</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 15,
    marginBottom: 15,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  titleSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 10,
    color: '#333',
  },
  actions: {
    flexDirection: 'row',
  },
  actionBtn: {
    padding: 5,
    marginLeft: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  label: {
    width: 80,
    color: '#666',
    fontSize: 14,
  },
  value: {
    flex: 1,
    fontSize: 14,
    color: '#333',
  },
  copyBtn: {
    backgroundColor: '#e3f2fd',
    padding: 8,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 5,
  },
  copyText: {
    color: '#1976d2',
    fontSize: 12,
  },
  notes: {
    marginTop: 10,
    color: '#666',
    fontSize: 12,
    fontStyle: 'italic',
  },
});