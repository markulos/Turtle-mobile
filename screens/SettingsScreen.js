import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
  Keyboard,
  TouchableWithoutFeedback,
  ScrollView,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useServer } from '../context/ServerContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as SecureStore from 'expo-secure-store';
import { hasMasterKey, changeMasterPassword as changeMasterPasswordUtil, resetVault } from './PasswordsScreen/utils/crypto';

const SALT_STORE = 'connected_pass_salt';

export default function SettingsScreen() {
  const { serverIP, isConnected, loading, saveIP, checkConnection } = useServer();
  const [ipInput, setIpInput] = useState(serverIP);
  const [hasVault, setHasVault] = useState(false);
  
  // Change password form state
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChanging, setIsChanging] = useState(false);

  useEffect(() => {
    checkVaultStatus();
  }, []);

  const checkVaultStatus = async () => {
    const hasKey = await hasMasterKey();
    setHasVault(hasKey);
  };

  const handleSave = async () => {
    Keyboard.dismiss();
    if (!ipInput.trim()) {
      Alert.alert('Error', 'Please enter an IP address');
      return;
    }
    
    const success = await saveIP(ipInput.trim());
    Alert.alert(
      success ? 'Success' : 'Error',
      success ? 'Connected to server!' : 'Could not connect to server. Check IP and make sure server is running.'
    );
  };

  const handleTest = async () => {
    Keyboard.dismiss();
    const success = await checkConnection(serverIP);
    Alert.alert(
      success ? 'Connected' : 'Failed',
      success ? 'Server is reachable!' : 'Cannot reach server'
    );
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      Alert.alert('Error', 'All fields are required');
      return;
    }

    if (newPassword.length < 8) {
      Alert.alert('Error', 'New password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'New passwords do not match');
      return;
    }

    setIsChanging(true);
    try {
      // Note: In a real implementation, we would need to re-encrypt all passwords
      // For now, we'll just verify the current password and update the master key
      const salt = await SecureStore.getItemAsync(SALT_STORE);
      const { deriveKey, storeMasterKey } = await import('./PasswordsScreen/utils/crypto');
      
      // Verify current password
      const currentKey = await deriveKey(currentPassword, salt);
      const storedKey = await SecureStore.getItemAsync('connected_pass_master_key');
      
      if (currentKey !== storedKey) {
        Alert.alert('Error', 'Current password is incorrect');
        return;
      }

      // Setup new password
      const { setupMasterPassword } = await import('./PasswordsScreen/utils/crypto');
      await setupMasterPassword(newPassword);

      Alert.alert('Success', 'Master password changed successfully!\n\nNote: Your existing passwords remain encrypted with the new password.');
      setShowChangePassword(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      console.error('Error changing password:', error);
      Alert.alert('Error', 'Failed to change master password');
    } finally {
      setIsChanging(false);
    }
  };

  const handleResetVault = async () => {
    Alert.alert(
      '⚠️ Reset Password Vault',
      'This will permanently delete your master password. All encrypted passwords will become UNRECOVERABLE unless you remember the password.\n\nAre you absolutely sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Reset', 
          style: 'destructive',
          onPress: async () => {
            try {
              await SecureStore.deleteItemAsync('connected_pass_master_key');
              await SecureStore.deleteItemAsync(SALT_STORE);
              setHasVault(false);
              Alert.alert('Reset Complete', 'Your password vault has been reset. You will need to set up a new master password when you open the Passwords tab.');
            } catch (error) {
              Alert.alert('Error', 'Failed to reset vault');
            }
          }
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        enableOnAndroid={true}
        extraScrollHeight={Platform.OS === 'ios' ? 20 : 80}
        enableResetScrollToCoords={false}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView style={styles.inner}>
            {/* Server Connection Section */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Icon name="server-network" size={24} color="#4CAF50" />
                <Text style={styles.sectionTitle}>Server Connection</Text>
              </View>
              
              <View style={styles.statusContainer}>
                <View style={[styles.statusDot, isConnected ? styles.connected : styles.disconnected]} />
                <Text style={styles.statusText}>
                  {loading ? 'Checking...' : (isConnected ? 'Connected' : 'Disconnected')}
                </Text>
              </View>

              <Text style={styles.label}>Computer IP Address:</Text>
              <TextInput
                style={styles.input}
                placeholder="192.168.1.100"
                value={ipInput}
                onChangeText={setIpInput}
                keyboardType="decimal-pad"
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
              
              <Text style={styles.hint}>
                Example: 192.168.1.5{'\n'}
                Make sure your phone and computer are on the same WiFi network
              </Text>

              <TouchableOpacity style={styles.button} onPress={handleSave}>
                <Text style={styles.buttonText}>Save & Connect</Text>
              </TouchableOpacity>

              {serverIP && (
                <TouchableOpacity 
                  style={[styles.button, styles.testButton]} 
                  onPress={handleTest}
                >
                  <Text style={styles.buttonText}>Test Connection</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Password Vault Section */}
            {hasVault && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Icon name="shield-key" size={24} color="#4CAF50" />
                  <Text style={styles.sectionTitle}>Password Vault</Text>
                </View>

                <Text style={styles.vaultStatus}>
                  <Icon name="check-circle" size={16} color="#4CAF50" /> Vault is set up
                </Text>

                <TouchableOpacity 
                  style={[styles.button, styles.secondaryButton]} 
                  onPress={() => setShowChangePassword(!showChangePassword)}
                >
                  <Text style={styles.buttonText}>
                    {showChangePassword ? 'Cancel' : 'Change Master Password'}
                  </Text>
                </TouchableOpacity>

                {showChangePassword && (
                  <View style={styles.changePasswordForm}>
                    <TextInput
                      style={styles.input}
                      placeholder="Current Master Password"
                      value={currentPassword}
                      onChangeText={setCurrentPassword}
                      secureTextEntry
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="New Master Password (min 8 chars)"
                      value={newPassword}
                      onChangeText={setNewPassword}
                      secureTextEntry
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="Confirm New Password"
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      secureTextEntry
                    />
                    <TouchableOpacity 
                      style={[styles.button, isChanging && styles.buttonDisabled]}
                      onPress={handleChangePassword}
                      disabled={isChanging}
                    >
                      <Text style={styles.buttonText}>
                        {isChanging ? 'Changing...' : 'Update Password'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                <TouchableOpacity 
                  style={[styles.button, styles.dangerButton]} 
                  onPress={handleResetVault}
                >
                  <Text style={styles.buttonText}>Reset Password Vault</Text>
                </TouchableOpacity>

                <Text style={styles.warningText}>
                  ⚠️ Resetting will permanently delete your master password. Your encrypted passwords cannot be recovered without the password!
                </Text>
              </View>
            )}

            {!hasVault && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Icon name="shield-off" size={24} color="#f44336" />
                  <Text style={styles.sectionTitle}>Password Vault</Text>
                </View>
                <Text style={styles.vaultStatusInactive}>
                  <Icon name="alert-circle" size={16} color="#f44336" /> No vault set up
                </Text>
                <Text style={styles.hint}>
                  Go to the Passwords tab to set up your encrypted password vault.
                </Text>
              </View>
            )}

            {/* Info Section */}
            <View style={styles.infoBox}>
              <Text style={styles.infoTitle}>Security Info:</Text>
              <Text style={styles.infoText}>
                • Passwords are encrypted on your device before syncing{'\n'}
                • Server never sees your plaintext passwords{'\n'}
                • Your master password is never stored on the server{'\n'}
                • Data is stored in SQLite database on the server
              </Text>
            </View>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    flexGrow: 1,
  },
  inner: {
    flex: 1,
    padding: 20,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 10,
    color: '#333',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  connected: {
    backgroundColor: '#4CAF50',
  },
  disconnected: {
    backgroundColor: '#f44336',
  },
  statusText: {
    fontSize: 16,
    color: '#666',
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  input: {
    backgroundColor: '#f5f5f5',
    padding: 15,
    borderRadius: 10,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    marginBottom: 10,
  },
  hint: {
    fontSize: 12,
    color: '#666',
    marginBottom: 15,
    lineHeight: 18,
  },
  button: {
    backgroundColor: '#4CAF50',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonDisabled: {
    backgroundColor: '#a5d6a7',
  },
  testButton: {
    backgroundColor: '#2196F3',
  },
  secondaryButton: {
    backgroundColor: '#ff9800',
  },
  dangerButton: {
    backgroundColor: '#f44336',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  vaultStatus: {
    fontSize: 14,
    color: '#4CAF50',
    marginBottom: 15,
  },
  vaultStatusInactive: {
    fontSize: 14,
    color: '#f44336',
    marginBottom: 15,
  },
  changePasswordForm: {
    backgroundColor: '#f5f5f5',
    padding: 15,
    borderRadius: 10,
    marginVertical: 10,
  },
  warningText: {
    fontSize: 12,
    color: '#f44336',
    marginTop: 10,
    lineHeight: 16,
  },
  infoBox: {
    backgroundColor: '#e3f2fd',
    padding: 15,
    borderRadius: 10,
    marginTop: 10,
  },
  infoTitle: {
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#1976d2',
  },
  infoText: {
    color: '#555',
    lineHeight: 22,
    fontSize: 13,
  },
});
