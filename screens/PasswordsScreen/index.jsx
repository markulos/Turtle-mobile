import React, { useState, useEffect } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  AppState,
  Text,
  Alert,
} from 'react-native';
import { useServer } from '../../context/ServerContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useMasterPassword } from './hooks/useMasterPassword';
import { usePasswords } from './hooks/usePasswords';
import { 
  SearchBar, 
  PasswordCard, 
  PasswordForm, 
  MasterPasswordSetup, 
  UnlockVault 
} from './components';

export default function PasswordsScreen() {
  const { isConnected, getBaseUrl } = useServer();
  
  const { 
    isSetup, 
    isVerified, 
    isLoading: isMasterLoading, 
    masterKey,
    setupPassword, 
    verifyPassword,
    lock: lockVault,
  } = useMasterPassword();

  const {
    passwords,
    filteredPasswords,
    searchQuery,
    setSearchQuery,
    isRegex,
    setIsRegex,
    showPassword,
    isLoading: isPasswordsLoading,
    handleSave: handlePasswordSave,
    handleDelete,
    toggleShowPassword,
    clearSearch,
    decryptPassword,
  } = usePasswords(getBaseUrl, isConnected, !isVerified, masterKey);
  
  const [modalVisible, setModalVisible] = useState(false);
  const [editingData, setEditingData] = useState(null);
  const [tempMasterPassword, setTempMasterPassword] = useState(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [biometricType, setBiometricType] = useState(null);

  // Auto-lock when app goes to background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'background') {
        lockVault();
        setTempMasterPassword(null);
      }
    });
    return () => subscription?.remove();
  }, [lockVault]);

  // Check for biometric availability (simplified - you may want to use expo-local-authentication)
  useEffect(() => {
    // In a full implementation, you'd check if biometric auth is available
    // and set the biometricType accordingly
    setBiometricType(null); // Set to 'FaceID' or 'TouchID' if available
  }, []);

  const openModal = (password = null) => {
    // If editing, we need to decrypt first
    if (password && password.isEncrypted) {
      // Prompt for master password to decrypt
      Alert.prompt(
        'Enter Master Password',
        'Required to edit this password',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Decrypt',
            onPress: async (masterPassword) => {
              if (!masterPassword) return;
              const decrypted = await decryptPassword(password, masterPassword);
              if (decrypted) {
                setTempMasterPassword(masterPassword);
                setEditingData(decrypted);
                setModalVisible(true);
              }
            },
          },
        ],
        'secure-text'
      );
    } else {
      setEditingData(password);
      setModalVisible(true);
    }
  };

  const closeModal = () => {
    setModalVisible(false);
    setEditingData(null);
  };

  const onSave = async (formData, editingId) => {
    // Use the temp password from editing, or prompt for one
    const masterPassword = tempMasterPassword || await promptForMasterPassword();
    if (!masterPassword) return false;

    const result = await handlePasswordSave(formData, editingId, masterPassword);
    if (result) {
      setTempMasterPassword(null);
    }
    return result;
  };

  const promptForMasterPassword = () => {
    return new Promise((resolve) => {
      Alert.prompt(
        'Master Password Required',
        'Enter your master password to encrypt this entry',
        [
          { text: 'Cancel', onPress: () => resolve(null), style: 'cancel' },
          {
            text: 'OK',
            onPress: (password) => resolve(password),
          },
        ],
        'secure-text'
      );
    });
  };

  const handleBiometricAuth = async () => {
    // This would integrate with expo-local-authentication
    // For now, we'll skip this implementation
    Alert.alert('Info', 'Biometric authentication not yet implemented');
  };

  const handleUnlock = async (password) => {
    setIsAuthenticating(true);
    const result = await verifyPassword(password);
    if (result) {
      setTempMasterPassword(password);
    }
    setIsAuthenticating(false);
    return result;
  };

  const handleLock = () => {
    lockVault();
    setTempMasterPassword(null);
  };

  // Show setup screen if master password not set up
  if (!isSetup) {
    return (
      <MasterPasswordSetup 
        onSetup={setupPassword} 
        isLoading={isMasterLoading} 
      />
    );
  }

  // Show unlock screen if not verified
  if (!isVerified) {
    return (
      <UnlockVault 
        onUnlock={handleUnlock}
        isLoading={isAuthenticating || isMasterLoading}
        biometricType={biometricType}
        onBiometricAuth={handleBiometricAuth}
        isAuthenticating={isAuthenticating}
      />
    );
  }

  const isLoading = isPasswordsLoading || isMasterLoading;

  return (
    <View style={styles.container}>
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        isRegex={isRegex}
        onToggleRegex={() => setIsRegex(!isRegex)}
        onClear={clearSearch}
        onLock={handleLock}
      />

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <Icon name="loading" size={40} color="#4CAF50" />
          <Text style={styles.loadingText}>Loading passwords...</Text>
        </View>
      ) : (
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
              isEncrypted={item.isEncrypted}
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
      )}

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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
    fontSize: 16,
  },
});
