import { useState, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import { filterPasswords, createPassword, updatePassword } from '../utils/passwordHelpers';

export const usePasswords = (getBaseUrl, isConnected, isLocked) => {
  const [passwords, setPasswords] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [filteredPasswords, setFilteredPasswords] = useState([]);
  const [showPassword, setShowPassword] = useState({});

  const loadPasswords = useCallback(async () => {
    if (!isConnected || isLocked) return;
    try {
      const response = await fetch(`${getBaseUrl()}/passwords`);
      const data = await response.json();
      setPasswords(data);
    } catch (error) {
      Alert.alert('Error', 'Failed to load passwords');
    }
  }, [getBaseUrl, isConnected, isLocked]);

  useEffect(() => {
    loadPasswords();
  }, [loadPasswords]);

  useEffect(() => {
    setFilteredPasswords(filterPasswords(passwords, searchQuery, isRegex));
  }, [searchQuery, isRegex, passwords]);

  const savePasswords = async (newPasswords) => {
    try {
      await fetch(`${getBaseUrl()}/passwords`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPasswords),
      });
      setPasswords(newPasswords);
    } catch (error) {
      Alert.alert('Error', 'Failed to save passwords');
    }
  };

  const handleSave = (formData, editingId) => {
    if (!formData.title || !formData.password) {
      Alert.alert('Error', 'Title and password are required');
      return false;
    }

    const newPasswords = editingId 
      ? updatePassword(passwords, editingId, formData)
      : [...passwords, createPassword(formData)];

    savePasswords(newPasswords);
    return true;
  };

  const handleDelete = (id) => {
    Alert.alert('Delete Password', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Delete', 
        style: 'destructive',
        onPress: () => savePasswords(passwords.filter(p => p.id !== id))
      },
    ]);
  };

  const toggleShowPassword = (id) => {
    setShowPassword(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const clearSearch = () => setSearchQuery('');

  return {
    passwords,
    filteredPasswords,
    searchQuery,
    setSearchQuery,
    isRegex,
    setIsRegex,
    showPassword,
    handleSave,
    handleDelete,
    toggleShowPassword,
    clearSearch,
  };
};