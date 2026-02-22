import React, { useState, useEffect } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  AppState,
  Text,
} from 'react-native';
import { useServer } from '../../context/ServerContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAuth } from './hooks/useAuth';
import { usePasswords } from './hooks/usePasswords';
import { LockedScreen, SearchBar, PasswordCard, PasswordForm } from './components';

export default function PasswordsScreen() {
  const { isConnected, getBaseUrl } = useServer();
  
  // UPDATED: Destructure new fallback-related values
  const { 
    isLocked, 
    isAuthenticating, 
    biometricType, 
    authError, 
    useFallback,
    authenticate, 
    authenticateWithPin,
    lock, 
    setIsLocked 
  } = useAuth();

  const {
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
  } = usePasswords(getBaseUrl, isConnected, isLocked);
  
  const [modalVisible, setModalVisible] = useState(false);
  const [editingData, setEditingData] = useState(null);

  // Auto-lock when app goes to background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'background') {
        setIsLocked(true);
      }
    });
    return () => subscription?.remove();
  }, [setIsLocked]);

  const openModal = (password = null) => {
    setEditingData(password);
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setEditingData(null);
  };

  const onSave = (formData, editingId) => {
    return handleSave(formData, editingId);
  };

  if (isLocked) {
    return (
      <LockedScreen 
        onUnlock={authenticate} 
        isAuthenticating={isAuthenticating}
        isConnected={isConnected}
        biometricType={biometricType}
        authError={authError}
        useFallback={useFallback} // NEW
        onPinSubmit={authenticateWithPin} // NEW
      />
    );
  }

  return (
    <View style={styles.container}>
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        isRegex={isRegex}
        onToggleRegex={() => setIsRegex(!isRegex)}
        onClear={clearSearch}
        onLock={lock}
      />

      <FlatList
        data={filteredPasswords}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <PasswordCard
            item={item}
            showPassword={showPassword[item.id]}
            onTogglePassword={toggleShowPassword}
            onEdit={openModal}
            onDelete={handleDelete}
          />
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Icon name="key-variant" size={60} color="#ccc" />
            <Text style={styles.emptyText}>
              {searchQuery ? 'No matches found' : 'No passwords saved'}
            </Text>
          </View>
        }
      />

      <TouchableOpacity style={styles.fab} onPress={() => openModal()}>
        <Icon name="plus" size={30} color="#fff" />
      </TouchableOpacity>

      <PasswordForm
        visible={modalVisible}
        onClose={closeModal}
        onSave={onSave}
        initialData={editingData}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  list: {
    padding: 15,
    paddingBottom: 80,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
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
  emptyState: {
    alignItems: 'center',
    marginTop: 100,
  },
  emptyText: {
    marginTop: 10,
    color: '#999',
    fontSize: 16,
  },
});