import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  Alert,
  Clipboard,
  AppState,
} from 'react-native';
import { useServer } from '../context/ServerContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as LocalAuthentication from 'expo-local-authentication';

export default function PasswordsScreen() {
  const { isConnected, getBaseUrl } = useServer();
  const [passwords, setPasswords] = useState([]);
  const [filteredPasswords, setFilteredPasswords] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [isLocked, setIsLocked] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    title: '',
    username: '',
    password: '',
    notes: '',
  });
  const [showPassword, setShowPassword] = useState({});

  useEffect(() => {
    if (isConnected && !isLocked) {
      loadPasswords();
    }
  }, [isConnected, isLocked]);

  useEffect(() => {
    filterPasswords();
  }, [searchQuery, isRegex, passwords]);

  // Auto-lock when app goes to background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'background') {
        setIsLocked(true);
        setPasswords([]);
        setFilteredPasswords([]);
      }
    });

    return () => {
      subscription?.remove();
    };
  }, []);

  const authenticate = async () => {
    if (isAuthenticating) return;
    
    setIsAuthenticating(true);
    
    try {
      // Check if hardware supports biometrics
      const compatible = await LocalAuthentication.hasHardwareAsync();
      if (!compatible) {
        Alert.alert(
          'Not Supported',
          'Your device does not support biometric authentication.',
          [{ text: 'OK', onPress: () => setIsAuthenticating(false) }]
        );
        return;
      }

      // Check what biometrics are available
      const biometricTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();
      const hasFaceID = biometricTypes.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      const hasTouchID = biometricTypes.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);

      // Check if biometrics are enrolled
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!enrolled) {
        Alert.alert(
          'No Biometrics',
          'Please set up Face ID/Touch ID in your device settings.',
          [{ text: 'OK', onPress: () => setIsAuthenticating(false) }]
        );
        return;
      }

      // Determine prompt message based on available biometrics
      let promptMessage = 'Authenticate to access passwords';
      if (hasFaceID) {
        promptMessage = 'Use Face ID to unlock your passwords';
      } else if (hasTouchID) {
        promptMessage = 'Use Touch ID to unlock your passwords';
      }

      // Authenticate with biometrics only (no device fallback)
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: promptMessage,
        cancelLabel: 'Cancel',
        disableDeviceFallback: true, // This prevents passcode fallback
        requireConfirmation: false,
      });

      if (result.success) {
        setIsLocked(false);
      } else if (result.error === 'user_cancel') {
        // User cancelled, do nothing
      } else {
        // If biometrics fail, show alert that they need to use biometrics
        Alert.alert(
          'Authentication Required',
          'Please use Face ID to access your passwords. If Face ID is not working, please check your device settings.',
          [
            { text: 'Try Again', onPress: () => authenticate() },
            { text: 'Cancel', style: 'cancel', onPress: () => setIsAuthenticating(false) }
          ]
        );
      }
    } catch (error) {
      Alert.alert('Error', 'Authentication failed: ' + error.message);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const loadPasswords = async () => {
    try {
      const response = await fetch(`${getBaseUrl()}/passwords`);
      const data = await response.json();
      setPasswords(data);
    } catch (error) {
      Alert.alert('Error', 'Failed to load passwords');
    }
  };

  const filterPasswords = () => {
    if (!searchQuery.trim()) {
      setFilteredPasswords(passwords);
      return;
    }

    try {
      let regex;
      if (isRegex) {
        regex = new RegExp(searchQuery, 'i');
      } else {
        const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        regex = new RegExp(escaped, 'i');
      }

      const filtered = passwords.filter(item => 
        regex.test(item.title) ||
        regex.test(item.username || '') ||
        regex.test(item.notes || '')
      );
      setFilteredPasswords(filtered);
    } catch (e) {
      const lowerQuery = searchQuery.toLowerCase();
      const filtered = passwords.filter(item =>
        item.title.toLowerCase().includes(lowerQuery) ||
        (item.username || '').toLowerCase().includes(lowerQuery) ||
        (item.notes || '').toLowerCase().includes(lowerQuery)
      );
      setFilteredPasswords(filtered);
    }
  };

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

  const handleSave = () => {
    if (!formData.title || !formData.password) {
      Alert.alert('Error', 'Title and password are required');
      return;
    }

    let newPasswords;
    if (editingId) {
      newPasswords = passwords.map(p => 
        p.id === editingId ? { ...formData, id: editingId } : p
      );
    } else {
      newPasswords = [...passwords, { ...formData, id: Date.now().toString() }];
    }

    savePasswords(newPasswords);
    closeModal();
  };

  const handleDelete = (id) => {
    Alert.alert(
      'Delete Password',
      'Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: () => savePasswords(passwords.filter(p => p.id !== id))
        },
      ]
    );
  };

  const openModal = (password = null) => {
    if (password) {
      setFormData(password);
      setEditingId(password.id);
    } else {
      setFormData({ title: '', username: '', password: '', notes: '' });
      setEditingId(null);
    }
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setEditingId(null);
    setFormData({ title: '', username: '', password: '', notes: '' });
  };

  const copyToClipboard = (text, label) => {
    Clipboard.setString(text);
    Alert.alert('Copied', `${label} copied to clipboard`);
  };

  const toggleShowPassword = (id) => {
    setShowPassword(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const clearSearch = () => {
    setSearchQuery('');
  };

  // Locked Screen
  if (isLocked) {
    return (
      <View style={styles.lockedContainer}>
        <View style={styles.lockContent}>
          <Icon name="shield-lock" size={100} color="#4CAF50" />
          <Text style={styles.lockedTitle}>Password Vault</Text>
          <Text style={styles.lockedSubtitle}>
            Authentication required to access your passwords
          </Text>
          
          <TouchableOpacity 
            style={styles.unlockButton}
            onPress={authenticate}
            disabled={isAuthenticating}
          >
            {isAuthenticating ? (
              <Text style={styles.unlockButtonText}>Authenticating...</Text>
            ) : (
              <>
                <Icon name="fingerprint" size={24} color="#fff" style={styles.unlockIcon} />
                <Text style={styles.unlockButtonText}>Unlock with Face ID</Text>
              </>
            )}
          </TouchableOpacity>

          {!isConnected && (
            <View style={styles.offlineWarning}>
              <Icon name="wifi-off" size={20} color="#f44336" />
              <Text style={styles.offlineText}>Not connected to server</Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  // Main Passwords Screen
  return (
    <View style={styles.container}>
      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputContainer}>
          <Icon name="magnify" size={20} color="#666" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder={isRegex ? "Regex pattern (e.g. ^gmail)" : "Search passwords..."}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={clearSearch} style={styles.clearButton}>
              <Icon name="close-circle" size={20} color="#999" />
            </TouchableOpacity>
          )}
        </View>
        
        <TouchableOpacity 
          style={[styles.regexToggle, isRegex && styles.regexToggleActive]} 
          onPress={() => setIsRegex(!isRegex)}
        >
          <Text style={[styles.regexToggleText, isRegex && styles.regexToggleTextActive]}>.*</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.lockButton}
          onPress={() => setIsLocked(true)}
        >
          <Icon name="lock" size={20} color="#666" />
        </TouchableOpacity>
      </View>

      {isRegex && (
        <View style={styles.regexHint}>
          <Icon name="information-outline" size={14} color="#666" />
          <Text style={styles.regexHintText}>Regex mode enabled</Text>
        </View>
      )}

      <FlatList
        data={filteredPasswords}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleSection}>
                <Icon name="key-variant" size={24} color="#4CAF50" />
                <Text style={styles.cardTitle}>{item.title}</Text>
              </View>
              <View style={styles.cardActions}>
                <TouchableOpacity onPress={() => openModal(item)} style={styles.actionBtn}>
                  <Icon name="pencil" size={20} color="#2196F3" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDelete(item.id)} style={styles.actionBtn}>
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
            
            <TouchableOpacity style={styles.row} onPress={() => toggleShowPassword(item.id)}>
              <Text style={styles.label}>Password:</Text>
              <Text style={styles.value}>
                {showPassword[item.id] ? item.password : '••••••••'}
              </Text>
              <Icon name={showPassword[item.id] ? "eye-off" : "eye"} size={16} color="#666" />
            </TouchableOpacity>
            
            {showPassword[item.id] && (
              <TouchableOpacity 
                style={styles.copyBtn}
                onPress={() => copyToClipboard(item.password, 'Password')}
              >
                <Text style={styles.copyBtnText}>Copy Password</Text>
              </TouchableOpacity>
            )}
            
            {item.notes && (
              <Text style={styles.notes}>{item.notes}</Text>
            )}
          </View>
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

      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={closeModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {editingId ? 'Edit Password' : 'Add Password'}
            </Text>
            
            <TextInput
              style={styles.input}
              placeholder="Title (e.g., Gmail, Netflix)"
              value={formData.title}
              onChangeText={(text) => setFormData({...formData, title: text})}
            />
            
            <TextInput
              style={styles.input}
              placeholder="Username / Email"
              value={formData.username}
              onChangeText={(text) => setFormData({...formData, username: text})}
              autoCapitalize="none"
            />
            
            <TextInput
              style={styles.input}
              placeholder="Password"
              value={formData.password}
              onChangeText={(text) => setFormData({...formData, password: text})}
              secureTextEntry
            />
            
            <TextInput
              style={[styles.input, styles.notesInput]}
              placeholder="Notes (optional)"
              value={formData.notes}
              onChangeText={(text) => setFormData({...formData, notes: text})}
              multiline
              numberOfLines={3}
            />
            
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalBtn, styles.cancelBtn]} onPress={closeModal}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.saveBtn]} onPress={handleSave}>
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // Locked Screen Styles
  lockedContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lockContent: {
    alignItems: 'center',
    padding: 40,
  },
  lockedTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 20,
    marginBottom: 10,
  },
  lockedSubtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 40,
    paddingHorizontal: 20,
  },
  unlockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4CAF50',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 30,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  unlockIcon: {
    marginRight: 10,
  },
  unlockButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  offlineWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 30,
    padding: 10,
    backgroundColor: '#ffebee',
    borderRadius: 8,
  },
  offlineText: {
    color: '#f44336',
    marginLeft: 8,
    fontSize: 14,
  },
  // Main Screen Styles
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  searchContainer: {
    flexDirection: 'row',
    padding: 15,
    paddingBottom: 5,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingHorizontal: 12,
    marginRight: 10,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
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
  regexToggleActive: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  regexToggleText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#666',
  },
  regexToggleTextActive: {
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
  regexHint: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 5,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  regexHintText: {
    marginLeft: 5,
    fontSize: 12,
    color: '#666',
  },
  list: {
    padding: 15,
    paddingBottom: 80,
  },
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  cardTitleSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 10,
    color: '#333',
  },
  cardActions: {
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
  copyBtnText: {
    color: '#1976d2',
    fontSize: 12,
  },
  notes: {
    marginTop: 10,
    color: '#666',
    fontSize: 12,
    fontStyle: 'italic',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    minHeight: 400,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    marginBottom: 15,
    fontSize: 16,
  },
  notesInput: {
    height: 80,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
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
});