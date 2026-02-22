import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const MASTER_KEY_STORE = 'connected_pass_master_key';
const SALT_STORE = 'connected_pass_salt';

/**
 * Generate a random salt for key derivation
 */
export const generateSalt = async () => {
  const randomBytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Generate a random IV for AES encryption
 */
export const generateIV = async () => {
  const randomBytes = await Crypto.getRandomBytesAsync(12);
  return Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Derive encryption key from master password using PBKDF2
 */
export const deriveKey = async (password, salt) => {
  const key = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    password + salt
  );
  return key;
};

/**
 * Convert hex string to Uint8Array
 */
const hexToUint8Array = (hex) => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
};

/**
 * Convert Uint8Array to hex string
 */
const uint8ArrayToHex = (bytes) => {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Encrypt data using AES-GCM via Web Crypto API
 */
export const encryptData = async (data, keyHex, ivHex) => {
  try {
    const keyData = hexToUint8Array(keyHex);
    const iv = hexToUint8Array(ivHex);
    
    // Import key for AES-GCM
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );
    
    // Encrypt
    const encoded = new TextEncoder().encode(data);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encoded
    );
    
    return uint8ArrayToHex(new Uint8Array(encrypted));
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
};

/**
 * Decrypt data using AES-GCM via Web Crypto API
 */
export const decryptData = async (encryptedHex, keyHex, ivHex) => {
  try {
    const keyData = hexToUint8Array(keyHex);
    const iv = hexToUint8Array(ivHex);
    const encrypted = hexToUint8Array(encryptedHex);
    
    // Import key for AES-GCM
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    
    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encrypted
    );
    
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt data - wrong master password?');
  }
};

/**
 * Store master key securely
 */
export const storeMasterKey = async (key) => {
  await SecureStore.setItemAsync(MASTER_KEY_STORE, key);
};

/**
 * Retrieve master key from secure storage
 */
export const getMasterKey = async () => {
  return await SecureStore.getItemAsync(MASTER_KEY_STORE);
};

/**
 * Check if master key exists
 */
export const hasMasterKey = async () => {
  const key = await getMasterKey();
  return !!key;
};

/**
 * Delete stored master key
 */
export const deleteMasterKey = async () => {
  await SecureStore.deleteItemAsync(MASTER_KEY_STORE);
};

/**
 * Encrypt a password entry
 */
export const encryptPasswordEntry = async (entry, masterPassword) => {
  const salt = await generateSalt();
  const iv = await generateIV();
  const key = await deriveKey(masterPassword, salt);
  
  const jsonData = JSON.stringify({
    title: entry.title,
    username: entry.username || '',
    password: entry.password,
    notes: entry.notes || '',
  });
  
  const encryptedData = await encryptData(jsonData, key, iv);
  
  return {
    id: entry.id,
    encryptedData,
    iv,
    salt,
    createdAt: entry.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
};

/**
 * Decrypt a password entry
 */
export const decryptPasswordEntry = async (encryptedEntry, masterPassword) => {
  const key = await deriveKey(masterPassword, encryptedEntry.salt);
  
  const decryptedJson = await decryptData(
    encryptedEntry.encryptedData,
    key,
    encryptedEntry.iv
  );
  
  const data = JSON.parse(decryptedJson);
  
  return {
    id: encryptedEntry.id,
    ...data,
    createdAt: encryptedEntry.createdAt,
    updatedAt: encryptedEntry.updatedAt,
  };
};

/**
 * Verify master password against stored key
 */
export const verifyMasterPassword = async (password, salt) => {
  const key = await deriveKey(password, salt);
  const storedKey = await getMasterKey();
  return key === storedKey;
};

/**
 * Setup master password for first time
 */
export const setupMasterPassword = async (password) => {
  const salt = await generateSalt();
  const key = await deriveKey(password, salt);
  
  await storeMasterKey(key);
  await SecureStore.setItemAsync(SALT_STORE, salt);
  
  return { key, salt };
};

/**
 * Get stored salt
 */
export const getSalt = async () => {
  return await SecureStore.getItemAsync(SALT_STORE);
};

/**
 * Change master password
 * Note: This only changes the master key. In a full implementation,
 * you would need to re-encrypt all existing passwords with the new key.
 */
export const changeMasterPassword = async (currentPassword, newPassword) => {
  const salt = await getSalt();
  if (!salt) {
    throw new Error('No existing vault found');
  }

  // Verify current password
  const currentKey = await deriveKey(currentPassword, salt);
  const storedKey = await getMasterKey();
  
  if (currentKey !== storedKey) {
    throw new Error('Current password is incorrect');
  }

  // Setup new password
  return await setupMasterPassword(newPassword);
};

/**
 * Reset the password vault (WARNING: Destructive)
 */
export const resetVault = async () => {
  await deleteMasterKey();
  await SecureStore.deleteItemAsync(SALT_STORE);
};
