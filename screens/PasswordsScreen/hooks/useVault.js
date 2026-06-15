import { useState, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import {
  checkVaultSetup,
  setupVault,
  unlockVault,
  lockVault,
  resetVault,
  encryptEntry,
  decryptEntry,
  decryptEntries,
} from '../utils/crypto';

export const useVault = (getBaseUrl, isConnected) => {
  const [isSetup, setIsSetup] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [masterPassword, setMasterPassword] = useState(null);
  const [entries, setEntries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  // Check vault setup status - can be called to refresh
  const checkSetup = useCallback(async () => {
    console.log('Checking vault setup...');
    setIsLoading(true);
    try {
      const setup = await checkVaultSetup();
      console.log('Vault setup status:', setup);
      setIsSetup(setup);
      if (!setup) {
        // Ensure clean state if not setup
        setIsUnlocked(false);
        setMasterPassword(null);
        setEntries([]);
      }
    } catch (error) {
      console.error('Error checking vault setup:', error);
      setIsSetup(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Check on mount
  useEffect(() => {
    checkSetup();
  }, [checkSetup]);

  const createVault = useCallback(async (password, confirmPassword) => {
    if (!password || password.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters');
      return false;
    }
    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return false;
    }

    setIsProcessing(true);
    try {
      await setupVault(password);
      console.log('Vault created successfully');
      await checkSetup(); // Recheck to update state
      setIsUnlocked(true);
      setMasterPassword(password);
      return true;
    } catch (error) {
      console.error('Error creating vault:', error);
      Alert.alert('Error', 'Failed to create vault');
      return false;
    } finally {
      setIsProcessing(false);
    }
  }, [checkSetup]);

  const unlock = useCallback(async (password) => {
    console.log('=== UNLOCK ===');
    console.log('Password entered (first 4 chars):', password?.substring(0, 4) + '...');
    
    if (!password) {
      Alert.alert('Error', 'Please enter your password');
      return false;
    }

    setIsProcessing(true);
    try {
      // First verify vault is still setup (in case it was reset)
      const isStillSetup = await checkVaultSetup();
      console.log('Vault setup status:', isStillSetup);
      
      if (!isStillSetup) {
        await checkSetup(); // Update state to reflect reality
        Alert.alert('Error', 'Vault has been reset. Please set up a new vault.');
        return false;
      }
      
      const result = await unlockVault(password);
      console.log('Vault unlocked successfully');
      console.log('Master password from unlock (first 4 chars):', result.masterPassword.substring(0, 4) + '...');
      
      setIsUnlocked(true);
      setMasterPassword(result.masterPassword);
      
      console.log('Calling loadEntries with master password...');
      await loadEntries(result.masterPassword);
      console.log('Entries loaded successfully');
      return true;
    } catch (error) {
      console.error('Unlock error:', error.message);
      Alert.alert('Error', error.message || 'Invalid password');
      return false;
    } finally {
      setIsProcessing(false);
      console.log('================\n');
    }
  }, [getBaseUrl, isConnected]);

  const lock = useCallback(async () => {
    console.log('=== LOCK ===');
    console.log('Current master password (first 4 chars):', masterPassword?.substring(0, 4) + '...');
    await lockVault();
    setIsUnlocked(false);
    setMasterPassword(null);
    setEntries([]);
    console.log('Vault locked, master password cleared');
    console.log('============\n');
  }, [masterPassword]);

  const loadEntries = useCallback(async (password) => {
    console.log('=== LOAD ENTRIES ===');
    console.log('Password provided (first 4 chars):', password?.substring(0, 4) + '...');
    console.log('Is connected:', isConnected);
    
    if (!isConnected) {
      console.log('Not connected, skipping load');
      return;
    }
    
    try {
      const response = await fetch(`${getBaseUrl()}/passwords`);
      if (!response.ok) throw new Error('Failed to fetch');
      
      const encryptedData = await response.json();
      console.log('Server returned', encryptedData.length, 'entries');
      
      if (encryptedData.length > 0 && password) {
        console.log('Decrypting', encryptedData.length, 'entries...');
        const decrypted = decryptEntries(encryptedData, password);
        console.log('Decrypted successfully, setting entries');
        setEntries(decrypted);
      } else {
        console.log('No entries to decrypt or no password');
        setEntries([]);
      }
    } catch (error) {
      console.error('Error loading entries:', error);
      Alert.alert('Error', 'Failed to load entries');
    }
    console.log('===================\n');
  }, [getBaseUrl, isConnected]);

  const saveEntry = useCallback(async (entry) => {
    console.log('=== SAVE ENTRY ===');
    console.log('Master password (first 4 chars):', masterPassword?.substring(0, 4) + '...');
    
    if (!masterPassword) {
      console.log('ERROR: Vault is locked');
      Alert.alert('Error', 'Vault is locked');
      return false;
    }
    if (!isConnected) {
      console.log('ERROR: Not connected to server');
      Alert.alert('Error', 'Not connected to server');
      return false;
    }

    setIsProcessing(true);
    try {
      const response = await fetch(`${getBaseUrl()}/passwords`);
      const currentData = await response.json();
      console.log('Current server data:', currentData.length, 'entries');
      
      console.log('Encrypting entry:', entry.title);
      const encryptedEntry = encryptEntry(entry, masterPassword);
      console.log('Entry encrypted successfully');
      
      const isUpdate = currentData.some(p => p.id === entry.id);
      const newData = isUpdate
        ? currentData.map(p => p.id === entry.id ? encryptedEntry : p)
        : [...currentData, encryptedEntry];
      
      console.log('Saving', newData.length, 'entries to server...');
      const saveResponse = await fetch(`${getBaseUrl()}/passwords`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newData),
      });
      
      if (!saveResponse.ok) throw new Error('Save failed');
      console.log('Save successful');
      
      setEntries(prev => {
        const exists = prev.some(p => p.id === entry.id);
        if (exists) {
          return prev.map(p => p.id === entry.id ? entry : p);
        }
        return [...prev, entry];
      });
      
      console.log('==================\n');
      return true;
    } catch (error) {
      console.error('Error saving entry:', error);
      Alert.alert('Error', 'Failed to save entry');
      return false;
    } finally {
      setIsProcessing(false);
    }
  }, [masterPassword, getBaseUrl, isConnected]);

  const deleteEntry = useCallback(async (id) => {
    if (!isConnected) {
      Alert.alert('Error', 'Not connected to server');
      return;
    }

    try {
      const response = await fetch(`${getBaseUrl()}/passwords`);
      const currentData = await response.json();
      
      const newData = currentData.filter(p => p.id !== id);
      
      await fetch(`${getBaseUrl()}/passwords`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newData),
      });
      
      setEntries(prev => prev.filter(p => p.id !== id));
    } catch (error) {
      console.error('Error deleting entry:', error);
      Alert.alert('Error', 'Failed to delete entry');
    }
  }, [getBaseUrl, isConnected]);

  // Change the master password. Each entry is encrypted directly with the
  // master password (per-entry PBKDF2 salt), so this must decrypt every entry
  // with the CURRENT in-memory password and re-encrypt with the new one. Order
  // is chosen so the vault is never left half-migrated:
  //   1. snapshot the old server array (rollback)   2. strictly decrypt all
  //   (abort on ANY failure → never clobber a corrupt entry)   3. re-encrypt
  //   4. verify round-trip BEFORE committing   5. POST new array   6. update the
  //   local verification hash (retry; roll the server back if it can't finalize).
  const changeMasterPassword = useCallback(async (newPassword) => {
    if (!masterPassword) return { success: false, error: 'Vault is locked' };
    if (!isConnected) return { success: false, error: 'Not connected to server' };
    if (!newPassword || newPassword.length < 8) {
      return { success: false, error: 'New password must be at least 8 characters' };
    }
    if (newPassword === masterPassword) {
      return { success: false, error: 'New password must be different from the current one' };
    }

    setIsProcessing(true);
    try {
      // 1. Fetch the current (old-password) encrypted array — also our rollback snapshot.
      const resp = await fetch(`${getBaseUrl()}/passwords`);
      if (!resp.ok) throw new Error('Could not load the vault from the server');
      const oldServer = await resp.json();
      if (!Array.isArray(oldServer)) throw new Error('Unexpected vault data from the server');

      // 2. Strictly decrypt every entry with the OLD password. Abort on ANY
      //    failure so a corrupt/placeholder entry is never re-encrypted (data loss).
      const plain = [];
      for (const enc of oldServer) {
        plain.push(decryptEntry(enc, masterPassword)); // throws on failure
      }

      // 3. Re-encrypt everything with the NEW password (fresh per-entry salt/IV).
      const newServer = plain.map((e) => encryptEntry(e, newPassword));

      // 4. Verify the re-encrypted set round-trips BEFORE committing anything.
      for (let i = 0; i < newServer.length; i++) {
        const back = decryptEntry(newServer[i], newPassword);
        if (JSON.stringify(back.lines) !== JSON.stringify(plain[i].lines)) {
          throw new Error('Verification failed — nothing was changed');
        }
      }

      // 5. Commit the re-encrypted array to the server (replaces all entries).
      const saveResp = await fetch(`${getBaseUrl()}/passwords`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newServer),
      });
      if (!saveResp.ok) throw new Error('Failed to save the re-encrypted vault');

      // 6. Update the local verification hash. Retry; if it can't be written,
      //    roll the server back to the old array so the OLD password still works.
      let hashOk = false;
      for (let attempt = 0; attempt < 3 && !hashOk; attempt++) {
        try {
          await setupVault(newPassword);
          hashOk = true;
        } catch (e) {
          console.warn('setupVault attempt failed:', e.message);
        }
      }
      if (!hashOk) {
        try {
          await fetch(`${getBaseUrl()}/passwords`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(oldServer),
          });
        } catch (e) {
          console.error('Rollback failed:', e.message);
        }
        throw new Error('Could not finalize — rolled back; your old password still works');
      }

      // 7. Adopt the new password in memory (decrypted entries are unchanged).
      setMasterPassword(newPassword);
      return { success: true };
    } catch (error) {
      console.error('Change master password error:', error.message);
      return { success: false, error: error.message || 'Could not change the master password' };
    } finally {
      setIsProcessing(false);
    }
  }, [masterPassword, getBaseUrl, isConnected]);

  const clearAll = useCallback(() => {
    Alert.alert(
      'Reset Vault',
      'This will delete ALL entries and the master password. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            console.log('Starting vault reset...');
            try {
              // Clear server data first
              console.log('Clearing server data...');
              const response = await fetch(`${getBaseUrl()}/passwords`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([]),
              });
              
              if (!response.ok) {
                throw new Error('Failed to clear server data');
              }
              
              // Clear secure store
              console.log('Clearing secure store...');
              await resetVault();
              
              // Clear all state
              console.log('Clearing React state...');
              setIsSetup(false);
              setIsUnlocked(false);
              setMasterPassword(null);
              setEntries([]);
              
              // Force recheck
              console.log('Rechecking setup status...');
              await checkSetup();
              
              console.log('Vault reset complete');
              Alert.alert('Success', 'Vault has been reset. Please set up a new vault.');
            } catch (error) {
              console.error('Reset error:', error);
              Alert.alert('Error', 'Failed to reset vault: ' + error.message);
            }
          }
        }
      ]
    );
  }, [getBaseUrl, checkSetup]);

  return {
    isSetup,
    isUnlocked,
    isLoading,
    isProcessing,
    entries,
    createVault,
    unlock,
    lock,
    saveEntry,
    deleteEntry,
    clearAll,
    changeMasterPassword,
    checkSetup, // Expose this so component can force recheck
  };
};
