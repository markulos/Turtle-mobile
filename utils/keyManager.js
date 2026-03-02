/**
 * Secure Key Management Utility
 * 
 * Manages AES-256 encryption keys using secure enclave storage.
 * Uses expo-secure-store for key storage and expo-crypto for
 * cryptographically secure random key generation.
 */

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

// Key storage identifiers
const ENCRYPTION_KEY_STORE = 'app_encryption_master_key';
const KEY_VERSION_STORE = 'app_encryption_key_version';

// Current key version for future migrations
const CURRENT_KEY_VERSION = '1';

/**
 * Generate a cryptographically secure random 256-bit key
 * Uses expo-crypto for secure random generation
 * @returns {Promise<Uint8Array>} 32-byte random key
 */
export async function generateSecureKey() {
  try {
    // Generate 32 bytes (256 bits) of cryptographically secure random data
    const randomBytes = await Crypto.getRandomBytesAsync(32);
    
    // Verify we got the expected length
    if (randomBytes.length !== 32) {
      throw new Error(`Generated key has invalid length: ${randomBytes.length} bytes (expected 32)`);
    }
    
    return randomBytes;
  } catch (error) {
    console.error('[KeyManager] Failed to generate secure key:', error);
    throw new Error('KEY_GENERATION_FAILED: Unable to generate encryption key');
  }
}

/**
 * Convert Uint8Array to Base64 string
 * @param {Uint8Array} bytes - Byte array to convert
 * @returns {string} Base64 encoded string
 */
export function bytesToBase64(bytes) {
  const binary = Array.from(bytes)
    .map(b => String.fromCharCode(b))
    .join('');
  return btoa(binary);
}

/**
 * Convert Base64 string to Uint8Array
 * @param {string} base64 - Base64 encoded string
 * @returns {Uint8Array} Byte array
 */
export function base64ToBytes(base64) {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (error) {
    console.error('[KeyManager] Failed to decode Base64:', error);
    throw new Error('INVALID_KEY_FORMAT: Key is not valid Base64');
  }
}

/**
 * Convert Uint8Array to hex string
 * @param {Uint8Array} bytes - Byte array
 * @returns {string} Hex encoded string
 */
export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array
 * @param {string} hex - Hex encoded string
 * @returns {Uint8Array} Byte array
 */
export function hexToBytes(hex) {
  try {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  } catch (error) {
    console.error('[KeyManager] Failed to decode hex:', error);
    throw new Error('INVALID_KEY_FORMAT: Key is not valid hex');
  }
}

/**
 * Store key securely in device enclave
 * @param {Uint8Array} key - Key bytes to store
 * @returns {Promise<void>}
 */
async function storeKey(key) {
  try {
    // Convert to Base64 for storage
    const keyBase64 = bytesToBase64(key);
    
    // Store with SecureStore - uses device Keychain (iOS) or Keystore (Android)
    await SecureStore.setItemAsync(ENCRYPTION_KEY_STORE, keyBase64, {
      keychainAccessible: SecureStore.ALWAYS_THIS_DEVICE_ONLY, // Most secure option
    });
    
    // Store key version for future migrations
    await SecureStore.setItemAsync(KEY_VERSION_STORE, CURRENT_KEY_VERSION);
    
    console.log('[KeyManager] Key stored securely');
  } catch (error) {
    console.error('[KeyManager] Failed to store key:', error);
    
    // Handle specific error cases
    if (error.message?.includes('User canceled')) {
      throw new Error('STORAGE_CANCELLED: User cancelled the authentication');
    }
    if (error.message?.includes('not available')) {
      throw new Error('SECURE_STORAGE_UNAVAILABLE: Device secure storage not available');
    }
    
    throw new Error('STORAGE_FAILED: Unable to store encryption key securely');
  }
}

/**
 * Retrieve key from secure storage
 * @returns {Promise<Uint8Array|null>} Key bytes or null if not found
 */
async function retrieveKey() {
  try {
    const keyBase64 = await SecureStore.getItemAsync(ENCRYPTION_KEY_STORE);
    
    if (!keyBase64) {
      return null;
    }
    
    // Check key version for migrations
    const keyVersion = await SecureStore.getItemAsync(KEY_VERSION_STORE);
    if (keyVersion && keyVersion !== CURRENT_KEY_VERSION) {
      console.warn(`[KeyManager] Key version mismatch: ${keyVersion} vs ${CURRENT_KEY_VERSION}`);
      // Handle migration here if needed in future
    }
    
    // Convert back to bytes
    return base64ToBytes(keyBase64);
  } catch (error) {
    console.error('[KeyManager] Failed to retrieve key:', error);
    
    if (error.message?.includes('not available')) {
      throw new Error('SECURE_STORAGE_UNAVAILABLE: Device secure storage not available');
    }
    
    throw new Error('RETRIEVAL_FAILED: Unable to retrieve encryption key');
  }
}

/**
 * Check if a key exists in secure storage
 * @returns {Promise<boolean>}
 */
export async function hasKey() {
  try {
    const key = await SecureStore.getItemAsync(ENCRYPTION_KEY_STORE);
    return key !== null;
  } catch (error) {
    console.error('[KeyManager] Failed to check key existence:', error);
    return false;
  }
}

/**
 * Delete the stored key (for reset/lockout scenarios)
 * @returns {Promise<void>}
 */
export async function deleteKey() {
  try {
    await SecureStore.deleteItemAsync(ENCRYPTION_KEY_STORE);
    await SecureStore.deleteItemAsync(KEY_VERSION_STORE);
    console.log('[KeyManager] Key deleted from secure storage');
  } catch (error) {
    console.error('[KeyManager] Failed to delete key:', error);
    throw new Error('DELETE_FAILED: Unable to delete encryption key');
  }
}

/**
 * Get existing key or generate and store a new one
 * This is the main entry point for key management
 * 
 * @returns {Promise<Object>} Key object with bytes, base64, and hex representations
 * @throws {Error} If key generation or storage fails
 */
export async function getOrGenerateKey() {
  console.log('[KeyManager] Checking for existing key...');
  
  try {
    // First, try to retrieve existing key
    const existingKey = await retrieveKey();
    
    if (existingKey) {
      console.log('[KeyManager] Existing key found');
      return {
        bytes: existingKey,
        base64: bytesToBase64(existingKey),
        hex: bytesToHex(existingKey),
        isNew: false,
      };
    }
    
    // No key exists - generate a new one
    console.log('[KeyManager] No existing key, generating new...');
    const newKey = await generateSecureKey();
    
    // Store the new key securely
    await storeKey(newKey);
    
    console.log('[KeyManager] New key generated and stored');
    return {
      bytes: newKey,
      base64: bytesToBase64(newKey),
      hex: bytesToHex(newKey),
      isNew: true,
    };
    
  } catch (error) {
    console.error('[KeyManager] getOrGenerateKey failed:', error);
    
    // Re-throw with clear error message
    if (error.message?.startsWith('KEY_') || 
        error.message?.startsWith('STORAGE_') || 
        error.message?.startsWith('RETRIEVAL_')) {
      throw error;
    }
    
    throw new Error('KEY_MANAGEMENT_FAILED: ' + error.message);
  }
}

/**
 * Get key as a format suitable for AES-GCM encryption
 * Returns a CryptoJS-compatible WordArray
 * 
 * @returns {Promise<Object>} { key: WordArray, isNew: boolean }
 */
export async function getKeyForAESGCM() {
  const keyData = await getOrGenerateKey();
  
  // Convert to format usable by crypto libraries
  // Returns hex string which is commonly used
  return {
    key: keyData.hex,
    keyBytes: keyData.bytes,
    keyBase64: keyData.base64,
    isNew: keyData.isNew,
  };
}

/**
 * Validate that a key is properly formatted
 * @param {any} key - Key to validate
 * @returns {boolean}
 */
export function isValidKey(key) {
  if (!key) return false;
  
  // Check if it's a Uint8Array with correct length
  if (key instanceof Uint8Array) {
    return key.length === 32;
  }
  
  // Check if it's a hex string with correct length (64 chars = 32 bytes)
  if (typeof key === 'string') {
    const hexPattern = /^[0-9a-fA-F]{64}$/;
    return hexPattern.test(key);
  }
  
  return false;
}

/**
 * Debug function to check secure storage status
 * Only use in development!
 */
export async function debugKeyStatus() {
  try {
    const hasStoredKey = await hasKey();
    const version = await SecureStore.getItemAsync(KEY_VERSION_STORE);
    
    return {
      hasKey: hasStoredKey,
      version: version,
      platform: Platform.OS,
    };
  } catch (error) {
    return {
      error: error.message,
    };
  }
}

// Default export
export default {
  getOrGenerateKey,
  getKeyForAESGCM,
  hasKey,
  deleteKey,
  generateSecureKey,
  bytesToBase64,
  base64ToBytes,
  bytesToHex,
  hexToBytes,
  isValidKey,
  debugKeyStatus,
};
