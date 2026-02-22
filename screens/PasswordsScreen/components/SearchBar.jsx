import React from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export const SearchBar = ({ 
  value, 
  onChangeText, 
  isRegex, 
  onToggleRegex, 
  onClear, 
  onLock 
}) => (
  <View style={styles.container}>
    <View style={styles.inputContainer}>
      <Icon name="magnify" size={20} color="#666" style={styles.icon} />
      <TextInput
        style={styles.input}
        placeholder={isRegex ? "Regex pattern (e.g. ^gmail)" : "Search passwords..."}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {value.length > 0 && (
        <TouchableOpacity onPress={onClear} style={styles.clearButton}>
          <Icon name="close-circle" size={20} color="#999" />
        </TouchableOpacity>
      )}
    </View>
    
    <TouchableOpacity 
      style={[styles.regexToggle, isRegex && styles.regexActive]} 
      onPress={onToggleRegex}
    >
      <Text style={[styles.regexText, isRegex && styles.regexTextActive]}>.*</Text>
    </TouchableOpacity>

    <TouchableOpacity style={styles.lockButton} onPress={onLock}>
      <Icon name="lock" size={20} color="#666" />
    </TouchableOpacity>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    padding: 15,
    paddingBottom: 5,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingHorizontal: 12,
    marginRight: 10,
  },
  icon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 16,
    color: '#333',
  },
  clearButton: {
    padding: 4,
  },
  regexToggle: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    marginRight: 10,
  },
  regexActive: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  regexText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#666',
  },
  regexTextActive: {
    color: '#fff',
  },
  lockButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
});