/**
 * Key Manager Usage Examples
 * 
 * This file demonstrates how to use the secure key management utility.
 */

import {
  getOrGenerateKey,
  getKeyForAESGCM,
  hasKey,
  deleteKey,
  bytesToHex,
  bytesToBase64,
  isValidKey,
  debugKeyStatus,
} from './keyManager';

// Example 1: Basic usage - get or create key
export async function exampleBasicUsage() {
  try {
    const keyData = await getOrGenerateKey();
    
    console.log('Key retrieved successfully:');
    console.log('  Is new key:', keyData.isNew);
    console.log('  Key (hex):', keyData.hex.substring(0, 16) + '...');
    console.log('  Key length:', keyData.bytes.length, 'bytes');
    
    // Use the key for encryption
    return keyData;
  } catch (error) {
    console.error('Failed to get key:', error.message);
    throw error;
  }
}

// Example 2: Get key specifically for AES-GCM
export async function exampleAESGCMUsage() {
  try {
    const { key, keyBytes, keyBase64, isNew } = await getKeyForAESGCM();
    
    // 'key' is a hex string suitable for AES-GCM
    console.log('AES-GCM Key (hex):', key.substring(0, 16) + '...');
    
    // You can also access the raw bytes
    console.log('Key bytes:', keyBytes);
    
    // Or Base64 for storage/transmission
    console.log('Key (Base64):', keyBase64.substring(0, 16) + '...');
    
    return { key, keyBytes, keyBase64 };
  } catch (error) {
    console.error('Failed to get AES key:', error.message);
    throw error;
  }
}

// Example 3: Check if key exists before operation
export async function exampleCheckKeyExists() {
  const keyExists = await hasKey();
  
  if (keyExists) {
    console.log('Key already exists, using existing key');
  } else {
    console.log('No key found, will generate new key');
  }
  
  return keyExists;
}

// Example 4: Integration with encryption
export async function exampleEncryptWithKey(plaintext) {
  try {
    // Get the key
    const { key, keyBytes } = await getKeyForAESGCM();
    
    // Validate key before use
    if (!isValidKey(keyBytes)) {
      throw new Error('Invalid encryption key');
    }
    
    // Now use with your AES-GCM implementation
    // This is a placeholder - use your actual encryption function
    console.log('Encrypting with key:', key.substring(0, 16) + '...');
    
    // Example with crypto-js (you would use expo-crypto or similar)
    // const encrypted = await encryptWithAESGCM(plaintext, keyBytes);
    
    return {
      success: true,
      // encryptedData: encrypted,
    };
  } catch (error) {
    console.error('Encryption failed:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Example 5: Reset/rotate key (delete and regenerate)
export async function exampleRotateKey() {
  try {
    console.log('Rotating encryption key...');
    
    // Delete old key
    await deleteKey();
    console.log('Old key deleted');
    
    // Generate new key
    const newKey = await getOrGenerateKey();
    console.log('New key generated:', newKey.isNew);
    
    // You would now need to re-encrypt all data with the new key
    
    return newKey;
  } catch (error) {
    console.error('Key rotation failed:', error.message);
    throw error;
  }
}

// Example 6: Error handling
export async function exampleErrorHandling() {
  try {
    const keyData = await getOrGenerateKey();
    return keyData;
  } catch (error) {
    // Handle specific error types
    if (error.message.includes('SECURE_STORAGE_UNAVAILABLE')) {
      console.error('Device does not support secure storage');
      // Fallback to less secure storage or warn user
    } else if (error.message.includes('STORAGE_CANCELLED')) {
      console.error('User cancelled authentication');
      // Prompt user to try again
    } else if (error.message.includes('KEY_GENERATION_FAILED')) {
      console.error('Cryptographic error - key generation failed');
      // Serious error - may need app restart
    } else {
      console.error('Unexpected error:', error.message);
    }
    
    throw error;
  }
}

// Example 7: Debug status (development only)
export async function exampleDebugStatus() {
  if (__DEV__) { // Only in development
    const status = await debugKeyStatus();
    console.log('Key Status:', status);
    return status;
  }
}

// Example 8: React Hook for using key in components
import { useState, useEffect } from 'react';

export function useEncryptionKey() {
  const [key, setKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function loadKey() {
      try {
        setLoading(true);
        const keyData = await getOrGenerateKey();
        
        if (mounted) {
          setKey(keyData);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err.message);
          setKey(null);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadKey();

    return () => {
      mounted = false;
    };
  }, []);

  return { key, loading, error };
}

// Run all examples (for testing)
export async function runAllExamples() {
  console.log('=== Key Manager Examples ===\n');

  console.log('1. Basic Usage:');
  await exampleBasicUsage();

  console.log('\n2. AES-GCM Usage:');
  await exampleAESGCMUsage();

  console.log('\n3. Check Key Exists:');
  await exampleCheckKeyExists();

  console.log('\n4. Debug Status:');
  await exampleDebugStatus();

  console.log('\n=== Examples Complete ===');
}

export default {
  exampleBasicUsage,
  exampleAESGCMUsage,
  exampleCheckKeyExists,
  exampleEncryptWithKey,
  exampleRotateKey,
  exampleErrorHandling,
  exampleDebugStatus,
  useEncryptionKey,
  runAllExamples,
};
