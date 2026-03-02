import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateKey, encryptIntent, createIntent } from '../utils/crypto';
import { useServer } from './ServerContext';

const VaultContext = createContext();

export const VaultProvider = ({ children }) => {
  const { api, isConnected } = useServer();
  const [vaultKey, setVaultKey] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [cryptoReady, setCryptoReady] = useState(false);

  // Initialize vault on mount
  useEffect(() => {
    const init = async () => {
      try {
        // react-native-libsodium is ready immediately
        setCryptoReady(true);
        await loadVaultKey();
      } catch (error) {
        console.error('[Vault] Initialization error:', error);
      } finally {
        setIsInitializing(false);
      }
    };
    init();
  }, []);

  // Load vault key from secure storage
  const loadVaultKey = async () => {
    try {
      const storedKey = await AsyncStorage.getItem('vaultSessionKey');
      if (storedKey) {
        setVaultKey(storedKey);
        console.log('[Vault] Session key loaded');
      }
    } catch (error) {
      console.error('[Vault] Failed to load key:', error);
    }
  };

  // Generate and store a new vault key
  const setupVaultKey = useCallback(async () => {
    try {
      const newKey = await generateKey();
      await AsyncStorage.setItem('vaultSessionKey', newKey);
      setVaultKey(newKey);
      console.log('[Vault] New session key generated');
      return newKey;
    } catch (error) {
      console.error('[Vault] Failed to setup key:', error);
      throw error;
    }
  }, []);

  // Clear vault key (logout)
  const clearVaultKey = useCallback(async () => {
    try {
      await AsyncStorage.removeItem('vaultSessionKey');
      setVaultKey(null);
      console.log('[Vault] Session key cleared');
    } catch (error) {
      console.error('[Vault] Failed to clear key:', error);
    }
  }, []);

  // Execute a secure command
  const executeCommand = useCallback(async (command, params = {}) => {
    if (!cryptoReady) {
      throw new Error('Crypto module not ready');
    }
    
    if (!vaultKey) {
      throw new Error('Vault key not set. Call setupVaultKey() first.');
    }
    
    if (!isConnected) {
      throw new Error('Server not connected');
    }

    try {
      // Create intent
      const intent = createIntent(command, params);
      
      // Encrypt intent
      const encryptedPayload = await encryptIntent(intent, vaultKey);
      
      // Send to server
      const response = await api.post('/vault/execute', {
        encryptedPayload,
        key: vaultKey
      });
      
      return response;
    } catch (error) {
      console.error('[Vault] Command execution error:', error);
      throw error;
    }
  }, [api, isConnected, vaultKey, cryptoReady]);

  // Get available commands from server
  const getAvailableCommands = useCallback(async () => {
    if (!isConnected) return null;
    try {
      return await api.get('/vault/commands');
    } catch (error) {
      console.error('[Vault] Failed to get commands:', error);
      return null;
    }
  }, [api, isConnected]);

  // Check vault health
  const checkHealth = useCallback(async () => {
    if (!isConnected) return { status: 'offline' };
    try {
      return await api.get('/vault/health');
    } catch (error) {
      return { status: 'error', error: error.message };
    }
  }, [api, isConnected]);

  const value = {
    vaultKey,
    hasVaultKey: !!vaultKey,
    isInitializing,
    cryptoReady,
    setupVaultKey,
    clearVaultKey,
    executeCommand,
    getAvailableCommands,
    checkHealth
  };

  return (
    <VaultContext.Provider value={value}>
      {children}
    </VaultContext.Provider>
  );
};

export const useVault = () => {
  const context = useContext(VaultContext);
  if (!context) {
    throw new Error('useVault must be used within a VaultProvider');
  }
  return context;
};
