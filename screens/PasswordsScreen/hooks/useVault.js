import { useState, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
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

// SecureStore key holding the master password for biometric unlock. Written only
// AFTER a successful master-password unlock (with the user's opt-in); read only
// behind a fresh device biometric prompt. SecureStore is the OS keychain/keystore
// (hardware-encrypted at rest); the biometric is the gate to retrieving it.
const BIO_PW_KEY = 'turtleVaultMasterPwBio';

// Persisted record of whether the vault was OPEN the last time the app was alive.
// Set 'true' on a successful unlock, 'false' on a manual lock. On a cold start
// (app was closed while the vault was open), this is still 'true' — which is the
// ONLY case where we auto-trigger the biometric prompt. A deliberate manual lock
// clears it, so the next unlock screen waits for the user instead.
const VAULT_WAS_OPEN_KEY = 'turtleVaultWasOpen';

export const useVault = (getBaseUrl, isConnected) => {
  const [isSetup, setIsSetup] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [masterPassword, setMasterPassword] = useState(null);
  const [entries, setEntries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  // True while entries are being fetched/decrypted after an unlock. Lets the UI
  // show a "Fetching vaults…" loader instead of flashing the empty state before
  // the server responds.
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false); // device has enrolled biometrics
  const [bioHasSaved, setBioHasSaved] = useState(false);   // a master pw is saved for biometric unlock
  // Whether the unlock screen should AUTO-trigger the biometric prompt. Armed
  // only on a cold start where the vault was previously open (see
  // VAULT_WAS_OPEN_KEY); a manual lock leaves it false.
  const [autoBioArmed, setAutoBioArmed] = useState(false);

  // Cold-start arming: if the app was closed while the vault was open, offer
  // biometrics automatically when the unlock screen appears.
  useEffect(() => {
    let alive = true;
    (async () => {
      const wasOpen = await AsyncStorage.getItem(VAULT_WAS_OPEN_KEY).catch(() => null);
      if (alive && wasOpen === 'true') setAutoBioArmed(true);
    })();
    return () => { alive = false; };
  }, []);

  // Detect biometric hardware + enrollment, and whether a master password is saved.
  const refreshBiometricState = useCallback(async () => {
    try {
      const hasHw = await LocalAuthentication.hasHardwareAsync();
      const enrolled = hasHw && (await LocalAuthentication.isEnrolledAsync());
      setBioAvailable(!!enrolled);
      const saved = await SecureStore.getItemAsync(BIO_PW_KEY).catch(() => null);
      setBioHasSaved(!!saved);
    } catch (e) {
      setBioAvailable(false);
      setBioHasSaved(false);
    }
  }, []);
  useEffect(() => { refreshBiometricState(); }, [refreshBiometricState]);

  // Check vault setup status — SERVER is source of truth (see comment below).
  const checkSetup = useCallback(async () => {
    setIsLoading(true);
    try {
      // If my account has any encrypted rows, the vault IS set up (and decryptable
      // with my master password on ANY device). The local SecureStore verifier is
      // only a secondary signal (a brand-new vault created locally before its first
      // save). This is what lets the owner reach an EXISTING vault on a fresh phone
      // — a missing local verifier used to make the screen offer "create vault"
      // instead of "unlock".
      let serverHasEntries = false;
      if (isConnected) {
        try {
          const r = await fetch(`${getBaseUrl()}/passwords`); // authed via ServerContext interceptor
          if (r.ok) {
            const rows = await r.json();
            serverHasEntries = Array.isArray(rows) && rows.length > 0;
          }
        } catch (e) { /* offline / transient — fall back to the local verifier */ }
      }
      const localVerifier = await checkVaultSetup().catch(() => false);
      const setup = serverHasEntries || localVerifier;
      setIsSetup(setup);
      if (!setup) {
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
  }, [getBaseUrl, isConnected]);

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

  // Verify a master password WITHOUT finalizing the unlock: fetch the vault and
  // try to decrypt one entry. Zero-knowledge — the server never sees the password.
  // Falls back to the local verifier for a brand-new vault that has no entries yet.
  const tryPassword = useCallback(async (password) => {
    if (!password) return false;
    try {
      if (isConnected) {
        const r = await fetch(`${getBaseUrl()}/passwords`); // authed via ServerContext interceptor
        if (r.ok) {
          const rows = await r.json();
          if (Array.isArray(rows) && rows.length > 0) {
            decryptEntry(rows[0], password); // throws if the password is wrong
            return true;
          }
        }
      }
      await unlockVault(password); // no server entries → fall back to the local verifier; throws if wrong
      return true;
    } catch (e) {
      return false;
    }
  }, [getBaseUrl, isConnected]);

  // Finalize an unlock once the password (and any 2FA) has been confirmed: adopt
  // the password in memory, load + decrypt all entries, and refresh the local
  // verifier so the next checkSetup is instant.
  const finishUnlock = useCallback(async (password) => {
    setIsProcessing(true);
    try {
      setMasterPassword(password);
      setIsUnlocked(true);
      // Remember that the vault is open, so a later cold start (app closed while
      // open) re-arms the automatic biometric prompt.
      try { await AsyncStorage.setItem(VAULT_WAS_OPEN_KEY, 'true'); } catch (e) { /* non-fatal */ }
      await loadEntries(password);
      try { await setupVault(password); } catch (e) { /* local verifier is non-fatal */ }
      return true;
    } finally {
      setIsProcessing(false);
    }
  }, [getBaseUrl, isConnected]);

  // ── 2FA step-up (SMS) — only on the master-password FALLBACK path ──────────
  const requestOtp = useCallback(async () => {
    try {
      const r = await fetch(`${getBaseUrl()}/vault/otp/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.success === false) return { ok: false, error: data.message || 'Could not send the code' };
      return { ok: true, dev: !!data.dev, devCode: data.devCode };
    } catch (e) {
      return { ok: false, error: 'Could not reach the server' };
    }
  }, [getBaseUrl]);

  const verifyOtp = useCallback(async (code) => {
    try {
      const r = await fetch(`${getBaseUrl()}/vault/otp/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok && data.success !== false, error: data.message };
    } catch (e) {
      return { ok: false, error: 'Could not reach the server' };
    }
  }, [getBaseUrl]);

  // ── Biometrics ────────────────────────────────────────────────────────────
  const saveBiometric = useCallback(async (password) => {
    try { await SecureStore.setItemAsync(BIO_PW_KEY, password); setBioHasSaved(true); return true; }
    catch (e) { return false; }
  }, []);

  const disableBiometric = useCallback(async () => {
    try { await SecureStore.deleteItemAsync(BIO_PW_KEY); } catch (e) { /* ignore */ }
    setBioHasSaved(false);
  }, []);

  // Biometric unlock: prompt Face/Touch ID, retrieve the stored master password,
  // confirm it still decrypts the vault, and finalize. NO 2FA on this path — the
  // biometric IS the second factor. If the saved password is stale (changed
  // elsewhere), drop it and ask for the master password instead.
  const biometricUnlock = useCallback(async () => {
    try {
      const saved = await SecureStore.getItemAsync(BIO_PW_KEY).catch(() => null);
      if (!saved) return { ok: false, error: 'No biometric login saved yet' };
      const auth = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock your vault',
        fallbackLabel: 'Use master password',
        cancelLabel: 'Cancel',
      });
      if (!auth.success) return { ok: false, error: 'cancelled' };
      const ok = await tryPassword(saved);
      if (!ok) { await disableBiometric(); return { ok: false, error: 'Saved login is out of date — enter your master password.' }; }
      await finishUnlock(saved);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'Biometric unlock failed' };
    }
  }, [tryPassword, finishUnlock, disableBiometric]);

  const lock = useCallback(async () => {
    console.log('=== LOCK ===');
    console.log('Current master password (first 4 chars):', masterPassword?.substring(0, 4) + '...');
    await lockVault();
    setIsUnlocked(false);
    setMasterPassword(null);
    setEntries([]);
    // Manual lock: do NOT auto-prompt biometrics on the unlock screen that
    // follows. Disarm in-session and clear the persisted "was open" flag so a
    // later cold start won't auto-prompt either.
    setAutoBioArmed(false);
    try { await AsyncStorage.setItem(VAULT_WAS_OPEN_KEY, 'false'); } catch (e) { /* non-fatal */ }
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

    setIsLoadingEntries(true);
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
    } finally {
      setIsLoadingEntries(false);
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
    isLoadingEntries,
    entries,
    createVault,
    tryPassword,      // verify master password (try-decrypt), no finalize
    finishUnlock,     // finalize after password (+ any 2FA) confirmed
    requestOtp,       // send the SMS step-up code (fallback path)
    verifyOtp,        // verify the SMS step-up code
    biometricUnlock,  // Face/Touch ID → retrieve + finalize (no 2FA)
    saveBiometric,    // opt-in: store master pw behind biometric
    disableBiometric,
    bioAvailable,
    bioHasSaved,
    autoBioArmed,
    lock,
    saveEntry,
    deleteEntry,
    clearAll,
    changeMasterPassword,
    checkSetup, // Expose this so component can force recheck
  };
};
