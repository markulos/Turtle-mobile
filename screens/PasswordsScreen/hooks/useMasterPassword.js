import { useState, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { 
  hasMasterKey, 
  setupMasterPassword, 
  verifyMasterPassword, 
  getMasterKey,
  getSalt,
  deleteMasterKey,
  storeMasterKey,
  deriveKey,
} from '../utils/crypto';

const SALT_STORE = 'connected_pass_salt';

export const useMasterPassword = () => {
  const [isSetup, setIsSetup] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [masterKey, setMasterKey] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check if master password is already set up
  useEffect(() => {
    checkSetup();
  }, []);

  const checkSetup = async () => {
    try {
      const hasKey = await hasMasterKey();
      setIsSetup(hasKey);
      if (hasKey) {
        const key = await getMasterKey();
        setMasterKey(key);
      }
    } catch (error) {
      console.error('Error checking master password setup:', error);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Setup master password for the first time
   */
  const setupPassword = useCallback(async (password, confirmPassword) => {
    if (!password || password.length < 8) {
      Alert.alert('Error', 'Master password must be at least 8 characters long');
      return false;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return false;
    }

    try {
      setIsLoading(true);
      const { key, salt } = await setupMasterPassword(password);
      setMasterKey(key);
      setIsSetup(true);
      setIsVerified(true);
      Alert.alert(
        'Success', 
        'Master password set up successfully.\n\n⚠️ Important: If you forget this password, your data cannot be recovered!'
      );
      return true;
    } catch (error) {
      console.error('Error setting up master password:', error);
      Alert.alert('Error', 'Failed to set up master password');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Verify master password on app unlock
   */
  const verifyPassword = useCallback(async (password) => {
    if (!password) {
      Alert.alert('Error', 'Please enter your master password');
      return false;
    }

    try {
      setIsLoading(true);
      const salt = await getSalt();
      const key = await deriveKey(password, salt);
      const storedKey = await getMasterKey();

      if (key === storedKey) {
        setMasterKey(key);
        setIsVerified(true);
        return true;
      } else {
        Alert.alert('Error', 'Incorrect master password');
        return false;
      }
    } catch (error) {
      console.error('Error verifying master password:', error);
      Alert.alert('Error', 'Failed to verify password');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Change master password (re-encrypts all data)
   */
  const changePassword = useCallback(async (currentPassword, newPassword, confirmPassword) => {
    if (!newPassword || newPassword.length < 8) {
      Alert.alert('Error', 'New password must be at least 8 characters long');
      return false;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'New passwords do not match');
      return false;
    }

    // Verify current password first
    const isValid = await verifyPassword(currentPassword);
    if (!isValid) {
      return false;
    }

    try {
      setIsLoading(true);
      // Setup new password
      const { key: newKey } = await setupMasterPassword(newPassword);
      setMasterKey(newKey);
      Alert.alert('Success', 'Master password changed successfully');
      return true;
    } catch (error) {
      console.error('Error changing master password:', error);
      Alert.alert('Error', 'Failed to change master password');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [verifyPassword]);

  /**
   * Lock the password vault
   */
  const lock = useCallback(() => {
    setIsVerified(false);
    setMasterKey(null);
  }, []);

  /**
   * Reset everything (WARNING: This will make all encrypted data unrecoverable)
   */
  const resetVault = useCallback(async () => {
    return new Promise((resolve) => {
      Alert.alert(
        '⚠️ Reset Password Vault',
        'This will delete your master password. All existing encrypted passwords will become UNRECOVERABLE.\n\nAre you sure?',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { 
            text: 'Reset Everything', 
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteMasterKey();
                await SecureStore.deleteItemAsync(SALT_STORE);
                setIsSetup(false);
                setIsVerified(false);
                setMasterKey(null);
                Alert.alert('Reset Complete', 'Master password removed. You can now set up a new one.');
                resolve(true);
              } catch (error) {
                console.error('Error resetting vault:', error);
                Alert.alert('Error', 'Failed to reset vault');
                resolve(false);
              }
            }
          },
        ]
      );
    });
  }, []);

  return {
    isSetup,
    isVerified,
    isLoading,
    masterKey,
    setupPassword,
    verifyPassword,
    changePassword,
    lock,
    resetVault,
  };
};
