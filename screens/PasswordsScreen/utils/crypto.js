import CryptoJS from 'crypto-js';
import * as SecureStore from 'expo-secure-store';

const MASTER_KEY_STORE = 'vault_master_key';
const SALT_STORE = 'vault_salt';

// Generate random hex string
const generateRandomHex = (bytes) => {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < bytes * 2; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Generate salt for vault password hashing
const generateVaultSalt = () => {
  return generateRandomHex(16); // 32 hex chars
};

// Hash vault master password (for storing verification hash)
const hashVaultPassword = (password) => {
  const salt = generateVaultSalt();
  const hash = CryptoJS.SHA256(password + salt).toString();
  return { hash, salt };
};

// Verify vault password
const verifyVaultPassword = (password, storedHash, salt) => {
  const hash = CryptoJS.SHA256(password + salt).toString();
  return hash === storedHash;
};

// Generate encryption salt and IV
const generateEncryptionSalt = () => generateRandomHex(16); // 32 hex chars
const generateIV = () => generateRandomHex(16); // 32 hex chars = 16 bytes

// Derive encryption key from master password + salt
const deriveEncryptionKey = (masterPassword, salt) => {
  // Use PBKDF2 for strong key derivation
  return CryptoJS.PBKDF2(masterPassword, salt, {
    keySize: 256 / 32,  // 256 bit key
    iterations: 1000
  });
};

// VAULT OPERATIONS

export const setupVault = async (password) => {
  const { hash, salt } = hashVaultPassword(password);
  await SecureStore.setItemAsync(MASTER_KEY_STORE, hash);
  await SecureStore.setItemAsync(SALT_STORE, salt);
  return { success: true };
};

export const checkVaultSetup = async () => {
  const hash = await SecureStore.getItemAsync(MASTER_KEY_STORE);
  return !!hash;
};

export const unlockVault = async (password) => {
  const storedHash = await SecureStore.getItemAsync(MASTER_KEY_STORE);
  const salt = await SecureStore.getItemAsync(SALT_STORE);
  
  if (!storedHash || !salt) {
    throw new Error('Vault not set up');
  }
  
  const isValid = verifyVaultPassword(password, storedHash, salt);
  if (!isValid) {
    throw new Error('Invalid password');
  }
  
  return { success: true, masterPassword: password };
};

export const lockVault = async () => {
  return { success: true };
};

export const resetVault = async () => {
  await SecureStore.deleteItemAsync(MASTER_KEY_STORE);
  await SecureStore.deleteItemAsync(SALT_STORE);
};

// ENCRYPTION OPERATIONS

export const encryptEntry = (entry, masterPassword) => {
  console.log('\n=== ENCRYPT ===');
  console.log('ID:', entry.id);
  console.log('Title:', entry.title);
  
  // Generate unique salt and IV for this encryption
  const salt = generateEncryptionSalt();
  const iv = generateIV();
  
  console.log('Salt:', salt.substring(0, 16) + '...');
  console.log('IV:', iv.substring(0, 16) + '...');
  
  // Derive key
  const key = deriveEncryptionKey(masterPassword, salt);
  console.log('Key derived successfully');
  
  // Prepare data
  const data = JSON.stringify({ lines: entry.lines || [] });
  console.log('Data:', data);
  
  // Encrypt
  const encrypted = CryptoJS.AES.encrypt(data, key, {
    iv: CryptoJS.enc.Hex.parse(iv),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });
  
  const encryptedData = encrypted.toString();
  console.log('Encrypted length:', encryptedData.length);
  console.log('================\n');
  
  return {
    id: entry.id,
    title: entry.title,
    encryptedData,
    salt,
    iv,
    createdAt: entry.createdAt || Date.now(),
    updatedAt: Date.now()
  };
};

export const decryptEntry = (encryptedEntry, masterPassword) => {
  console.log('\n=== DECRYPT ===');
  console.log('ID:', encryptedEntry.id);
  console.log('Title:', encryptedEntry.title);
  
  try {
    // Validate
    if (!encryptedEntry.encryptedData || !encryptedEntry.salt || !encryptedEntry.iv) {
      throw new Error('Missing encryption data');
    }
    
    console.log('Salt:', encryptedEntry.salt.substring(0, 16) + '...');
    console.log('IV:', encryptedEntry.iv.substring(0, 16) + '...');
    console.log('Encrypted length:', encryptedEntry.encryptedData.length);
    
    // Derive key (must use same method as encryption)
    const key = deriveEncryptionKey(masterPassword, encryptedEntry.salt);
    console.log('Key derived');
    
    // Parse IV
    const iv = CryptoJS.enc.Hex.parse(encryptedEntry.iv);
    console.log('IV parsed');
    
    // Decrypt
    const decrypted = CryptoJS.AES.decrypt(encryptedEntry.encryptedData, key, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });
    
    console.log('Decryption executed, sigBytes:', decrypted.sigBytes);
    
    // Check if decryption returned valid data
    if (decrypted.sigBytes <= 0) {
      throw new Error('Decryption returned empty data - wrong password?');
    }
    
    // Convert to string
    const decryptedString = decrypted.toString(CryptoJS.enc.Utf8);
    console.log('String length:', decryptedString.length);
    
    if (!decryptedString) {
      throw new Error('Failed to convert to UTF-8 string');
    }
    
    console.log('String preview:', decryptedString.substring(0, 50));
    
    // Parse JSON
    const data = JSON.parse(decryptedString);
    
    console.log('=== SUCCESS ===\n');
    
    return {
      id: encryptedEntry.id,
      title: encryptedEntry.title,
      lines: data.lines || [],
      createdAt: encryptedEntry.createdAt,
      updatedAt: encryptedEntry.updatedAt
    };
  } catch (error) {
    console.error('=== FAILED ===');
    console.error('Error:', error.message);
    console.error('==============\n');
    throw new Error('Failed to decrypt - wrong master password?');
  }
};

export const encryptEntries = (entries, masterPassword) => {
  return entries.map(entry => encryptEntry(entry, masterPassword));
};

export const decryptEntries = (encryptedEntries, masterPassword) => {
  console.log('\n=== DECRYPT ALL ===');
  console.log('Count:', encryptedEntries.length);
  
  const results = [];
  for (let i = 0; i < encryptedEntries.length; i++) {
    console.log(`\n--- Entry ${i + 1}/${encryptedEntries.length} ---`);
    try {
      const decrypted = decryptEntry(encryptedEntries[i], masterPassword);
      results.push(decrypted);
    } catch (error) {
      console.error(`Failed to decrypt entry ${i + 1}:`, encryptedEntries[i].id);
      // Continue with other entries instead of failing completely
      results.push({
        id: encryptedEntries[i].id,
        title: encryptedEntries[i].title + ' (⚠️ Decryption failed)',
        lines: [],
        createdAt: encryptedEntries[i].createdAt,
        updatedAt: encryptedEntries[i].updatedAt
      });
    }
  }
  
  console.log('\n===================\n');
  return results;
};

// Test function to verify crypto works
export const testCrypto = (masterPassword) => {
  console.log('\n=== CRYPTO TEST ===');
  
  const testEntry = {
    id: 'test-' + Date.now(),
    title: 'Test Entry',
    lines: ['Username: test', 'Password: 123'],
    createdAt: Date.now()
  };
  
  console.log('Original:', JSON.stringify(testEntry));
  
  try {
    const encrypted = encryptEntry(testEntry, masterPassword);
    console.log('Encrypted successfully');
    console.log('Salt:', encrypted.salt);
    console.log('IV:', encrypted.iv);
    
    const decrypted = decryptEntry(encrypted, masterPassword);
    console.log('Decrypted:', JSON.stringify(decrypted));
    
    const success = JSON.stringify(testEntry.lines) === JSON.stringify(decrypted.lines);
    console.log('Test result:', success ? 'PASS' : 'FAIL');
    console.log('===================\n');
    return success;
  } catch (error) {
    console.error('Test failed:', error.message);
    console.log('===================\n');
    return false;
  }
};
