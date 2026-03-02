import React, { useState, useEffect, useCallback } from 'react';
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
  Switch,
  AppState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { KeyboardSafeScreen } from '../components/KeyboardSafeView';
import { useServer } from '../context/ServerContext';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import * as SecureStore from 'expo-secure-store';

const MASTER_KEY_STORE = 'vault_master_key';
const SALT_STORE = 'vault_salt';

export default function SettingsScreen() {
  const { theme, isDark, toggleTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { serverIP, isConnected, loading, saveIP, checkConnection } = useServer();
  const { logout } = useAuth();
  const [ipInput, setIpInput] = useState(serverIP);
  const [hasVault, setHasVault] = useState(false);
  
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChanging, setIsChanging] = useState(false);

  useEffect(() => {
    checkVaultStatus();
  }, []);

  // Recheck when app comes to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        checkVaultStatus();
      }
    });
    return () => subscription?.remove();
  }, []);

  const checkVaultStatus = useCallback(async () => {
    console.log('Settings: Checking vault status...');
    const hasKey = await SecureStore.getItemAsync(MASTER_KEY_STORE);
    console.log('Settings: Has vault:', !!hasKey);
    setHasVault(!!hasKey);
  }, []);

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
      const salt = await SecureStore.getItemAsync(SALT_STORE);
      const { deriveKey, storeMasterKey } = await import('./PasswordsScreen/utils/crypto');
      
      const currentKey = await deriveKey(currentPassword, salt);
      const storedKey = await SecureStore.getItemAsync(MASTER_KEY_STORE);
      
      if (currentKey !== storedKey) {
        Alert.alert('Error', 'Current password is incorrect');
        return;
      }

      const { setupMasterPassword } = await import('./PasswordsScreen/utils/crypto');
      await setupMasterPassword(newPassword);

      Alert.alert('Success', 'Master password changed successfully!');
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
      'This will permanently delete your master password and all stored passwords.\n\nAre you absolutely sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Reset', 
          style: 'destructive',
          onPress: async () => {
            try {
              // Clear server data first
              if (isConnected) {
                await fetch(`${getBaseUrl()}/passwords`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify([]),
                });
              }
              
              // Clear secure store
              await SecureStore.deleteItemAsync(MASTER_KEY_STORE);
              await SecureStore.deleteItemAsync(SALT_STORE);
              
              // Update state
              setHasVault(false);
              setShowChangePassword(false);
              setCurrentPassword('');
              setNewPassword('');
              setConfirmPassword('');
              
              Alert.alert('Reset Complete', 'Your password vault has been reset. Please restart the app or go to the Passwords tab to set up a new vault.');
            } catch (error) {
              console.error('Reset error:', error);
              Alert.alert('Error', 'Failed to reset vault: ' + error.message);
            }
          }
        },
      ]
    );
  };

  const styles = createStyles(theme);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Custom Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <KeyboardSafeScreen>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.inner}>
            {/* Appearance Section */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.iconContainer, { backgroundColor: theme.colors.surfaceElevated }]}>
                  <Icon name="palette" size={20} color={theme.colors.textPrimary} />
                </View>
                <Text style={styles.sectionTitle}>Appearance</Text>
              </View>
              
              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>Dark Mode</Text>
                  <Text style={styles.settingDescription}>Use dark theme throughout the app</Text>
                </View>
                <Switch
                  value={isDark}
                  onValueChange={toggleTheme}
                  trackColor={{ false: theme.colors.surfaceElevated, true: theme.colors.surfaceHighlight }}
                  thumbColor={isDark ? theme.colors.textPrimary : theme.colors.textTertiary}
                />
              </View>
            </View>

            {/* Server Connection Section */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.iconContainer, { backgroundColor: theme.colors.surfaceElevated }]}>
                  <Icon name="server-network" size={20} color={theme.colors.textPrimary} />
                </View>
                <Text style={styles.sectionTitle}>Server Connection</Text>
              </View>
              
              <View style={styles.statusContainer}>
                <View style={[styles.statusDot, isConnected ? styles.connected : styles.disconnected]} />
                <Text style={styles.statusText}>
                  {loading ? 'Checking...' : (isConnected ? 'Connected' : 'Disconnected')}
                </Text>
              </View>

              <Text style={styles.label}>Computer IP Address</Text>
              <View style={styles.inputContainer}>
                <Icon name="ip-network" size={18} color={theme.colors.textTertiary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="192.168.1.100"
                  placeholderTextColor={theme.colors.textPlaceholder}
                  value={ipInput}
                  onChangeText={setIpInput}
                  keyboardType="decimal-pad"
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                  blurOnSubmit={true}
                />
              </View>
              
              <Text style={styles.hint}>
                Your phone and computer must be on the same WiFi network
              </Text>

              <TouchableOpacity style={styles.primaryButton} onPress={handleSave}>
                <Icon name="content-save" size={16} color={theme.colors.textPrimary} style={styles.buttonIcon} />
                <Text style={styles.primaryButtonText}>Save & Connect</Text>
              </TouchableOpacity>

              {serverIP && (
                <TouchableOpacity 
                  style={styles.secondaryButton} 
                  onPress={handleTest}
                >
                  <Icon name="connection" size={16} color={theme.colors.textPrimary} style={styles.buttonIcon} />
                  <Text style={styles.secondaryButtonText}>Test Connection</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Password Vault Section */}
            {hasVault && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={[styles.iconContainer, { backgroundColor: theme.colors.surfaceElevated }]}>
                    <Icon name="shield-key" size={20} color={theme.colors.textPrimary} />
                  </View>
                  <Text style={styles.sectionTitle}>Password Vault</Text>
                </View>

                <View style={styles.vaultStatus}>
                  <Icon name="check-circle" size={14} color={theme.colors.accentSuccess} />
                  <Text style={styles.vaultStatusText}>Vault is set up and secure</Text>
                </View>

                <TouchableOpacity 
                  style={styles.secondaryButton} 
                  onPress={() => setShowChangePassword(!showChangePassword)}
                >
                  <Icon name="lock-reset" size={16} color={theme.colors.textPrimary} style={styles.buttonIcon} />
                  <Text style={styles.secondaryButtonText}>
                    {showChangePassword ? 'Cancel' : 'Change Master Password'}
                  </Text>
                </TouchableOpacity>

                {showChangePassword && (
                  <View style={styles.changePasswordForm}>
                    <TextInput
                      style={styles.passwordInput}
                      placeholder="Current Master Password"
                      placeholderTextColor={theme.colors.textPlaceholder}
                      value={currentPassword}
                      onChangeText={setCurrentPassword}
                      secureTextEntry
                      returnKeyType="next"
                      blurOnSubmit={false}
                    />
                    <TextInput
                      style={styles.passwordInput}
                      placeholder="New Master Password (min 8 chars)"
                      placeholderTextColor={theme.colors.textPlaceholder}
                      value={newPassword}
                      onChangeText={setNewPassword}
                      secureTextEntry
                      returnKeyType="next"
                      blurOnSubmit={false}
                    />
                    <TextInput
                      style={styles.passwordInput}
                      placeholder="Confirm New Password"
                      placeholderTextColor={theme.colors.textPlaceholder}
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      secureTextEntry
                      returnKeyType="done"
                      onSubmitEditing={handleChangePassword}
                      blurOnSubmit={true}
                    />
                    <TouchableOpacity 
                      style={[styles.primaryButton, isChanging && styles.buttonDisabled]}
                      onPress={handleChangePassword}
                      disabled={isChanging}
                    >
                      <Text style={styles.primaryButtonText}>
                        {isChanging ? 'Changing...' : 'Update Password'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                <TouchableOpacity 
                  style={styles.dangerButton} 
                  onPress={handleResetVault}
                >
                  <Icon name="delete-forever" size={16} color={theme.colors.accentError} style={styles.buttonIcon} />
                  <Text style={styles.dangerButtonText}>Reset Password Vault</Text>
                </TouchableOpacity>
              </View>
            )}

            {!hasVault && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={[styles.iconContainer, { backgroundColor: 'rgba(244, 67, 54, 0.15)' }]}>
                    <Icon name="shield-off" size={20} color={theme.colors.accentError} />
                  </View>
                  <Text style={styles.sectionTitle}>Password Vault</Text>
                </View>
                <View style={styles.vaultStatus}>
                  <Icon name="alert-circle" size={14} color={theme.colors.accentError} />
                  <Text style={[styles.vaultStatusText, { color: theme.colors.accentError }]}>No vault set up</Text>
                </View>
                <Text style={styles.hint}>
                  Go to the Passwords tab to set up your encrypted password vault.
                </Text>
              </View>
            )}

            {/* Account Section */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.iconContainer, { backgroundColor: theme.colors.surfaceElevated }]}>
                  <Icon name="account-circle" size={20} color={theme.colors.textPrimary} />
                </View>
                <Text style={styles.sectionTitle}>Account</Text>
              </View>
              
              <TouchableOpacity 
                style={styles.dangerButton} 
                onPress={() => {
                  Alert.alert(
                    'Sign Out',
                    'Are you sure you want to sign out?',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { 
                        text: 'Sign Out', 
                        style: 'destructive',
                        onPress: async () => {
                          await logout();
                        }
                      },
                    ]
                  );
                }}
              >
                <Icon name="logout" size={16} color={theme.colors.accentError} style={styles.buttonIcon} />
                <Text style={styles.dangerButtonText}>Sign Out</Text>
              </TouchableOpacity>
            </View>

            {/* Info Section */}
            <View style={styles.infoBox}>
              <Icon name="information" size={18} color={theme.colors.textPrimary} style={styles.infoIcon} />
              <View style={styles.infoContent}>
                <Text style={styles.infoTitle}>Security Info</Text>
                <Text style={styles.infoText}>
                  Passwords are encrypted on your device before syncing. The server never sees your plaintext passwords.
                </Text>
              </View>
            </View>

            <View style={styles.bottomPadding} />
          </View>
        </TouchableWithoutFeedback>
      </KeyboardSafeScreen>
    </View>
  );
}

const createStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  inner: {
    padding: 16,
  },
  section: {
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  settingInfo: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 13,
    color: theme.colors.textTertiary,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  connected: {
    backgroundColor: theme.colors.accentSuccess,
  },
  disconnected: {
    backgroundColor: theme.colors.accentError,
  },
  statusText: {
    fontSize: 15,
    color: theme.colors.textSecondary,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    color: theme.colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 10,
    borderWidth: 0,
    height: 44,
  },
  inputIcon: {
    marginLeft: 12,
    marginRight: 8,
  },
  input: {
    flex: 1,
    height: 44,
    paddingRight: 12,
    fontSize: 15,
    color: theme.colors.inputText,
  },
  hint: {
    fontSize: 13,
    color: theme.colors.textTertiary,
    marginTop: 6,
    marginBottom: 16,
  },
  primaryButton: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surfaceElevated,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  primaryButtonText: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surfaceHighlight,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: theme.colors.border,
    marginBottom: 10,
  },
  secondaryButtonText: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  dangerButton: {
    flexDirection: 'row',
    backgroundColor: 'rgba(244, 67, 54, 0.1)',
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: theme.colors.accentError,
  },
  dangerButtonText: {
    color: theme.colors.accentError,
    fontSize: 15,
    fontWeight: '600',
  },
  buttonIcon: {
    marginRight: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  vaultStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    padding: 10,
    borderRadius: 8,
  },
  vaultStatusText: {
    marginLeft: 8,
    color: theme.colors.accentSuccess,
    fontWeight: '500',
    fontSize: 14,
  },
  changePasswordForm: {
    backgroundColor: theme.colors.surface,
    padding: 12,
    borderRadius: 10,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  passwordInput: {
    backgroundColor: theme.colors.inputBackground,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 10,
    fontSize: 15,
    color: theme.colors.inputText,
    marginBottom: 10,
    borderWidth: 0,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surfaceElevated,
    padding: 14,
    borderRadius: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  infoIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontWeight: '700',
    marginBottom: 4,
    color: theme.colors.textPrimary,
    fontSize: 14,
  },
  infoText: {
    color: theme.colors.textSecondary,
    lineHeight: 18,
    fontSize: 13,
  },
  bottomPadding: {
    height: 100,
  },
});
