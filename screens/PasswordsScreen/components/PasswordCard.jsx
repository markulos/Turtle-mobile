import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';

export const PasswordCard = ({ 
  item, 
  showPassword, 
  onTogglePassword, 
  onEdit, 
  onDelete,
  isEncrypted,
}) => {
  const [isDecrypted, setIsDecrypted] = useState(false);
  const [decryptedData, setDecryptedData] = useState(null);

  const copyToClipboard = async (text, label) => {
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', `${label} copied to clipboard`);
  };

  // Show encrypted state - user needs to tap to decrypt
  if (isEncrypted && !decryptedData) {
    return (
      <View style={[styles.card, styles.encryptedCard]}>
        <View style={styles.header}>
          <View style={styles.titleSection}>
            <Icon name="lock" size={24} color="#4CAF50" />
            <View style={styles.encryptedInfo}>
              <Text style={styles.encryptedTitle}>🔒 Encrypted Password</Text>
              <Text style={styles.encryptedId}>ID: {item.id?.slice(-8)}</Text>
            </View>
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
        <Text style={styles.encryptedHint}>
          Tap edit (✏️) to decrypt and view this password
        </Text>
      </View>
    );
  }

  // Use decrypted data if available, otherwise use item directly
  const data = decryptedData || item;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleSection}>
          <Icon name="key-variant" size={24} color="#4CAF50" />
          <Text style={styles.title}>{data.title}</Text>
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
      
      {data.username && (
        <TouchableOpacity 
          style={styles.row} 
          onPress={() => copyToClipboard(data.username, 'Username')}
        >
          <Text style={styles.label}>Username:</Text>
          <Text style={styles.value}>{data.username}</Text>
          <Icon name="content-copy" size={16} color="#666" />
        </TouchableOpacity>
      )}
      
      <TouchableOpacity style={styles.row} onPress={() => onTogglePassword(item.id)}>
        <Text style={styles.label}>Password:</Text>
        <Text style={styles.value}>
          {showPassword ? data.password : '••••••••'}
        </Text>
        <Icon name={showPassword ? "eye-off" : "eye"} size={16} color="#666" />
      </TouchableOpacity>
      
      {showPassword && (
        <TouchableOpacity 
          style={styles.copyBtn}
          onPress={() => copyToClipboard(data.password, 'Password')}
        >
          <Text style={styles.copyText}>Copy Password</Text>
        </TouchableOpacity>
      )}
      
      {data.notes && (
        <Text style={styles.notes}>{data.notes}</Text>
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
  encryptedCard: {
    backgroundColor: '#e8f5e9',
    borderWidth: 1,
    borderColor: '#4CAF50',
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
  // Encrypted state styles
  encryptedInfo: {
    marginLeft: 10,
  },
  encryptedTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2e7d32',
  },
  encryptedId: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  encryptedHint: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 5,
  },
});
