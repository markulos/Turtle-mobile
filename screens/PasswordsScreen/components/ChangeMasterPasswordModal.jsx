import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as LocalAuthentication from 'expo-local-authentication';
import { useTheme } from '../../../context/ThemeContext';
import { unlockVault } from '../utils/crypto';
import { impactHaptic } from '../../../utils/haptics';

/**
 * Change Master Password.
 *
 * Authorizes the change PRIMARILY with biometrics (Face ID / Touch ID / device
 * passcode); if biometrics are unavailable or not confirmed, it falls back to
 * re-typing the current master password. The vault is already unlocked, so the
 * in-memory master password drives the actual re-encryption (onChangePassword);
 * this screen only confirms identity, then collects the new password.
 */
export const ChangeMasterPasswordModal = ({ visible, onClose, onChangePassword, isProcessing }) => {
  const { theme } = useTheme();
  const styles = createStyles(theme);

  const [phase, setPhase] = useState('auth'); // 'auth' | 'enter'
  const [authBusy, setAuthBusy] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');

  const runBiometric = useCallback(async () => {
    setAuthError('');
    setAuthBusy(true);
    try {
      const hasHw = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      const available = hasHw && enrolled;
      setBiometricAvailable(available);
      if (available) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Confirm it’s you to change the master password',
          fallbackLabel: 'Use password',
          cancelLabel: 'Cancel',
        });
        if (result.success) {
          setPhase('enter');
          return;
        }
      }
      // Unavailable, not enrolled, cancelled, or failed → password fallback.
      setShowFallback(true);
    } catch (e) {
      setShowFallback(true);
    } finally {
      setAuthBusy(false);
    }
  }, []);

  // On open: reset state, then immediately attempt biometric authorization.
  useEffect(() => {
    if (!visible) return;
    setPhase('auth');
    setShowFallback(false);
    setCurrentPassword('');
    setAuthError('');
    setNewPassword('');
    setConfirmPassword('');
    setFormError('');
    runBiometric();
  }, [visible, runBiometric]);

  const verifyFallback = useCallback(async () => {
    setAuthError('');
    if (!currentPassword) {
      setAuthError('Enter your current password');
      return;
    }
    try {
      await unlockVault(currentPassword); // throws if the password is wrong
      setPhase('enter');
    } catch (e) {
      setAuthError('Incorrect password');
    }
  }, [currentPassword]);

  const submitNew = useCallback(async () => {
    setFormError('');
    if (newPassword.length < 8) {
      setFormError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError('Passwords do not match');
      return;
    }
    const res = await onChangePassword(newPassword);
    if (res?.success) {
      Alert.alert('Done', 'Your master password has been changed.');
      onClose();
    } else {
      setFormError(res?.error || 'Could not change the master password');
    }
  }, [newPassword, confirmPassword, onChangePassword, onClose]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Icon name="shield-key" size={22} color={theme.colors.textPrimary} />
            <Text style={styles.title}>Change Master Password</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon name="close" size={22} color={theme.colors.textTertiary} />
            </TouchableOpacity>
          </View>

          {phase === 'auth' ? (
            <View style={styles.section}>
              {authBusy ? (
                <View style={styles.center}>
                  <ActivityIndicator color={theme.colors.textPrimary} />
                  <Text style={styles.hint}>Waiting for biometric confirmation…</Text>
                </View>
              ) : showFallback ? (
                <>
                  <Text style={styles.hint}>
                    {biometricAvailable
                      ? 'Biometric not confirmed. Enter your current master password to continue.'
                      : 'Enter your current master password to continue.'}
                  </Text>
                  <View style={styles.inputContainer}>
                    <Icon name="lock" size={20} color={theme.colors.textTertiary} />
                    <TextInput
                      style={styles.input}
                      placeholder="Current master password"
                      placeholderTextColor={theme.colors.textPlaceholder}
                      value={currentPassword}
                      onChangeText={setCurrentPassword}
                      secureTextEntry
                      autoFocus
                      onSubmitEditing={verifyFallback}
                    />
                  </View>
                  {!!authError && <Text style={styles.error}>{authError}</Text>}
                  <TouchableOpacity style={styles.button} onPressIn={() => impactHaptic('medium')} onPress={verifyFallback}>
                    <Text style={styles.buttonText}>Continue</Text>
                  </TouchableOpacity>
                  {biometricAvailable && (
                    <TouchableOpacity style={styles.linkBtn} onPressIn={() => impactHaptic('medium')} onPress={runBiometric}>
                      <Icon name="face-recognition" size={18} color={theme.colors.accentInfo} />
                      <Text style={styles.linkText}>Use biometrics instead</Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                <View style={styles.center}>
                  <ActivityIndicator color={theme.colors.textPrimary} />
                </View>
              )}
            </View>
          ) : (
            <View style={styles.section}>
              <Text style={styles.hint}>Choose a new master password (at least 8 characters).</Text>
              <View style={styles.inputContainer}>
                <Icon name="lock-plus" size={20} color={theme.colors.textTertiary} />
                <TextInput
                  style={styles.input}
                  placeholder="New password"
                  placeholderTextColor={theme.colors.textPlaceholder}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry
                  autoFocus
                />
              </View>
              <View style={styles.inputContainer}>
                <Icon name="lock-check" size={20} color={theme.colors.textTertiary} />
                <TextInput
                  style={styles.input}
                  placeholder="Confirm new password"
                  placeholderTextColor={theme.colors.textPlaceholder}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  onSubmitEditing={submitNew}
                />
              </View>
              {!!formError && <Text style={styles.error}>{formError}</Text>}
              <TouchableOpacity
                style={[styles.button, isProcessing && styles.buttonDisabled]}
                onPressIn={() => impactHaptic('medium')}
                onPress={submitNew}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <ActivityIndicator color={theme.colors.textPrimary} />
                ) : (
                  <Text style={styles.buttonText}>Re-encrypt & Change</Text>
                )}
              </TouchableOpacity>
              <Text style={styles.note}>
                Every entry is re-encrypted with the new password. Keep the app open until it finishes.
              </Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const createStyles = (theme) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'center',
      padding: 20,
    },
    card: {
      backgroundColor: theme.colors.surfaceElevated || theme.colors.surface,
      borderRadius: 18,
      padding: 18,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 14,
    },
    title: {
      flex: 1,
      fontSize: 16,
      fontWeight: '700',
      color: theme.colors.textPrimary,
    },
    section: {
      gap: 12,
    },
    center: {
      alignItems: 'center',
      paddingVertical: 18,
      gap: 12,
    },
    hint: {
      fontSize: 13,
      color: theme.colors.textSecondary,
      lineHeight: 18,
    },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.inputBackground,
      borderRadius: 8,
      paddingHorizontal: 14,
      gap: 10,
    },
    input: {
      flex: 1,
      height: 46,
      fontSize: 15,
      color: theme.colors.inputText,
    },
    error: {
      fontSize: 13,
      color: theme.colors.accentError,
    },
    button: {
      backgroundColor: theme.colors.surface,
      height: 46,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    buttonText: {
      color: theme.colors.textPrimary,
      fontSize: 15,
      fontWeight: '600',
    },
    linkBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 6,
    },
    linkText: {
      color: theme.colors.accentInfo,
      fontSize: 14,
      fontWeight: '500',
    },
    note: {
      fontSize: 11,
      color: theme.colors.textTertiary,
      lineHeight: 15,
    },
  });
