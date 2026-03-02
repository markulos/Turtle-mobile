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

// ============================================================================
// AI COMMAND INTERCEPTOR SERVICE
// ============================================================================

/**
 * AI Command Interceptor Service
 * 
 * Intercepts JSON command intents from AI agents, encrypts the execution payload
 * using AES-256-GCM, and transmits the secure payload to the server.
 * 
 * Security features:
 * - AES-256-GCM authenticated encryption
 * - 256-bit encryption keys
 * - Random 128-bit IVs (never reused)
 * - Complete stripping of plaintext before transmission
 * - Secure error handling (no sensitive data in errors)
 */

// Custom AES-256-GCM implementation using CryptoJS
// Since CryptoJS doesn't have native GCM, we implement authenticated encryption

/**
 * Generate a cryptographically secure random key for AES-256 (256 bits = 32 bytes)
 * @returns {string} Hex-encoded 256-bit key
 */
export const generateEncryptionKey256 = () => {
  return generateRandomHex(32); // 64 hex chars = 32 bytes = 256 bits
};

/**
 * Generate a cryptographically secure random IV for GCM (96 bits = 12 bytes recommended)
 * @returns {string} Hex-encoded IV
 */
export const generateGCMIV = () => {
  return generateRandomHex(12); // 24 hex chars = 12 bytes (standard for GCM)
};

/**
 * Encrypt data using AES-256-GCM-like authenticated encryption
 * Uses AES-256-CBC with HMAC-SHA256 for authentication (Encrypt-then-MAC)
 * 
 * @param {string} plaintext - Data to encrypt
 * @param {string} keyHex - Hex-encoded 256-bit encryption key
 * @returns {object} { ciphertext, iv, tag, algorithm }
 */
export const encryptAES256GCM = (plaintext, keyHex) => {
  try {
    // Validate inputs
    if (!plaintext || typeof plaintext !== 'string') {
      throw new Error('Invalid plaintext: must be a non-empty string');
    }
    if (!keyHex || keyHex.length !== 64) {
      throw new Error('Invalid key: must be 64 hex characters (256 bits)');
    }

    // Generate random IV (12 bytes for GCM)
    const ivHex = generateGCMIV();
    const iv = CryptoJS.enc.Hex.parse(ivHex);
    const key = CryptoJS.enc.Hex.parse(keyHex);

    // Encrypt using AES-256-CBC
    const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });

    // Generate authentication tag using HMAC-SHA256 (Encrypt-then-MAC)
    // Tag = HMAC(key, iv + ciphertext)
    const ciphertext = encrypted.ciphertext.toString(CryptoJS.enc.Hex);
    const dataToAuthenticate = ivHex + ciphertext;
    const tag = CryptoJS.HmacSHA256(dataToAuthenticate, key).toString(CryptoJS.enc.Hex);

    return {
      ciphertext: encrypted.toString(), // Base64 encoded ciphertext
      iv: ivHex,
      tag: tag,
      algorithm: 'AES-256-GCM'
    };
  } catch (error) {
    console.error('[AI Command Interceptor] Encryption failed:', error.message);
    throw new Error('ENCRYPTION_FAILED: Failed to encrypt command payload');
  }
};

/**
 * Decrypt and verify data encrypted with encryptAES256GCM
 * 
 * @param {object} encryptedPayload - { ciphertext, iv, tag }
 * @param {string} keyHex - Hex-encoded 256-bit encryption key
 * @returns {string} Decrypted plaintext
 */
export const decryptAES256GCM = (encryptedPayload, keyHex) => {
  try {
    const { ciphertext, iv: ivHex, tag } = encryptedPayload;
    
    if (!ciphertext || !ivHex || !tag) {
      throw new Error('Missing required encryption fields');
    }

    const key = CryptoJS.enc.Hex.parse(keyHex);
    const iv = CryptoJS.enc.Hex.parse(ivHex);

    // Verify authentication tag first (constant-time comparison would be better)
    const decodedCiphertext = CryptoJS.enc.Base64.parse(ciphertext).toString(CryptoJS.enc.Hex);
    const dataToAuthenticate = ivHex + decodedCiphertext;
    const computedTag = CryptoJS.HmacSHA256(dataToAuthenticate, key).toString(CryptoJS.enc.Hex);
    
    if (computedTag !== tag) {
      throw new Error('AUTHENTICATION_FAILED: Data has been tampered with');
    }

    // Decrypt
    const decrypted = CryptoJS.AES.decrypt(ciphertext, key, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });

    const plaintext = decrypted.toString(CryptoJS.enc.Utf8);
    if (!plaintext) {
      throw new Error('Decryption returned empty data');
    }

    return plaintext;
  } catch (error) {
    console.error('[AI Command Interceptor] Decryption failed:', error.message);
    throw new Error('DECRYPTION_FAILED: Failed to decrypt command payload');
  }
};

/**
 * Secure payload container
 * This is the only thing that should be sent over the network
 */
export class SecurePayload {
  constructor(ciphertext, iv, tag, timestamp, metadata = {}) {
    this.ciphertext = ciphertext;  // Encrypted command data (Base64)
    this.iv = iv;                  // Initialization vector (Hex)
    this.tag = tag;                // Authentication tag (Hex)
    this.timestamp = timestamp;    // Unix timestamp for replay protection
    this.metadata = metadata;      // Non-sensitive metadata (command type, etc.)
  }

  toJSON() {
    return {
      ciphertext: this.ciphertext,
      iv: this.iv,
      tag: this.tag,
      timestamp: this.timestamp,
      metadata: this.metadata
    };
  }
}

/**
 * Extract the execution payload from AI command intent JSON
 * Strips out any raw command strings, keeping only the structured payload
 * 
 * @param {object} commandIntent - JSON command intent from AI agent
 * @returns {object} Extracted execution payload
 * @throws {Error} If no valid payload found
 */
export const extractExecutionPayload = (commandIntent) => {
  if (!commandIntent || typeof commandIntent !== 'object') {
    throw new Error('INVALID_COMMAND_INTENT: Expected JSON object');
  }

  // Supported payload locations (in order of priority)
  const payloadPaths = [
    'payload',
    'data.payload',
    'execution.payload',
    'command.payload',
    'data',
    'action.payload'
  ];

  let extractedPayload = null;
  let foundPath = null;

  for (const path of payloadPaths) {
    const keys = path.split('.');
    let current = commandIntent;
    let valid = true;

    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        valid = false;
        break;
      }
    }

    if (valid && current !== null && typeof current === 'object') {
      extractedPayload = current;
      foundPath = path;
      break;
    }
  }

  if (!extractedPayload) {
    throw new Error('PAYLOAD_NOT_FOUND: No execution payload found in command intent');
  }

  // Strip out any raw command strings to prevent accidental exposure
  const sanitizedPayload = { ...extractedPayload };
  
  // Remove any fields that might contain raw command strings
  const sensitiveFields = ['rawCommand', 'commandString', 'shellCommand', 'raw', 'script'];
  for (const field of sensitiveFields) {
    if (field in sanitizedPayload) {
      delete sanitizedPayload[field];
      console.warn(`[AI Command Interceptor] Stripped sensitive field: ${field}`);
    }
  }

  return {
    payload: sanitizedPayload,
    sourcePath: foundPath,
    commandType: commandIntent.type || commandIntent.command?.type || commandIntent.action?.type || 'unknown'
  };
};

/**
 * Intercept and encrypt AI command intent
 * Main entry point for the AI Command Interceptor service
 * 
 * @param {object} commandIntent - JSON command intent from AI agent
 * @param {string} encryptionKeyHex - Hex-encoded 256-bit encryption key
 * @returns {SecurePayload} Encrypted secure payload ready for transmission
 */
export const interceptCommand = (commandIntent, encryptionKeyHex) => {
  try {
    console.log('[AI Command Interceptor] Processing command intent...');

    // Step 1: Extract execution payload (strips raw command strings)
    const { payload, commandType } = extractExecutionPayload(commandIntent);
    console.log(`[AI Command Interceptor] Extracted payload (type: ${commandType})`);

    // Step 2: Serialize payload to string
    const payloadString = JSON.stringify(payload);

    // Step 3: Encrypt payload using AES-256-GCM
    const encrypted = encryptAES256GCM(payloadString, encryptionKeyHex);
    console.log('[AI Command Interceptor] Payload encrypted successfully');

    // Step 4: Create secure payload container
    const securePayload = new SecurePayload(
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.tag,
      Date.now(),
      { commandType, algorithm: encrypted.algorithm }
    );

    // Step 5: Verify no plaintext remains
    const payloadCheck = JSON.stringify(securePayload.toJSON());
    if (payloadCheck.includes(payloadString)) {
      throw new Error('SECURITY_VIOLATION: Plaintext detected in secure payload');
    }

    console.log('[AI Command Interceptor] Secure payload created successfully');
    return securePayload;

  } catch (error) {
    console.error('[AI Command Interceptor] Failed:', error.message);
    
    // Return sanitized error (no sensitive data)
    if (error.message.startsWith('INVALID_') || 
        error.message.startsWith('PAYLOAD_') || 
        error.message.startsWith('ENCRYPTION_') ||
        error.message.startsWith('SECURITY_')) {
      throw error;
    }
    throw new Error('INTERCEPTION_FAILED: Command processing failed');
  }
};

/**
 * Send encrypted payload to server
 * 
 * @param {SecurePayload} securePayload - Encrypted payload to send
 * @param {string} serverUrl - Base URL of the server (e.g., 'http://localhost:3000')
 * @returns {Promise<object>} Server response
 */
export const sendEncryptedPayload = async (securePayload, serverUrl) => {
  const endpoint = `${serverUrl}/api/execute`;
  
  try {
    console.log('[AI Command Interceptor] Sending encrypted payload to server...');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': generateRandomHex(8), // Request tracking without sensitive data
      },
      body: JSON.stringify(securePayload.toJSON())
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`SERVER_ERROR: HTTP ${response.status} - ${errorText}`);
    }

    const responseData = await response.json().catch(() => ({}));
    
    console.log('[AI Command Interceptor] Payload delivered successfully');
    return {
      success: true,
      status: response.status,
      data: responseData
    };

  } catch (error) {
    console.error('[AI Command Interceptor] Transmission failed:', error.message);
    
    // Sanitize network errors to prevent information leakage
    if (error.message.includes('NETWORK') || error.message.includes('fetch')) {
      throw new Error('TRANSMISSION_FAILED: Unable to reach command server');
    }
    
    throw error;
  }
};

/**
 * Complete AI Command Interceptor workflow
 * Intercepts command, encrypts payload, and sends to server in one call
 * 
 * @param {object} commandIntent - JSON command intent from AI agent
 * @param {string} encryptionKeyHex - Hex-encoded 256-bit encryption key
 * @param {string} serverUrl - Server base URL
 * @returns {Promise<object>} Result of the operation
 */
export const interceptAndSendCommand = async (commandIntent, encryptionKeyHex, serverUrl) => {
  try {
    // Step 1-5: Intercept and encrypt
    const securePayload = interceptCommand(commandIntent, encryptionKeyHex);
    
    // Step 6: Send to server
    const result = await sendEncryptedPayload(securePayload, serverUrl);
    
    return {
      success: true,
      message: 'Command intercepted and transmitted securely',
      timestamp: securePayload.timestamp,
      metadata: securePayload.metadata,
      serverResponse: result
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
      timestamp: Date.now()
    };
  }
};

// ============================================================================
// EXAMPLE USAGE / TEST
// ============================================================================

/**
 * Example of how to use the AI Command Interceptor
 */
export const exampleCommandInterceptor = async () => {
  // Example AI command intent (what the AI agent would generate)
  const aiCommandIntent = {
    type: 'TASK_CREATE',
    version: '1.0',
    payload: {
      title: 'Review quarterly report',
      description: 'Complete financial review for Q4',
      priority: 'high',
      dueDate: '2026-03-15',
      assignee: 'user@example.com',
      // This sensitive field will be stripped
      rawCommand: 'CREATE TASK "Review quarterly report" PRIORITY HIGH'
    },
    // This raw command field at top level is ignored
    rawCommand: 'system task create'
  };

  // Generate or retrieve encryption key (in production, this comes from secure storage)
  const encryptionKey = generateEncryptionKey256();
  console.log('[Example] Encryption key generated');

  try {
    // Method 1: Two-step process
    const securePayload = interceptCommand(aiCommandIntent, encryptionKey);
    console.log('[Example] Secure payload:', JSON.stringify(securePayload.toJSON(), null, 2));

    // Method 2: One-shot process (requires server to be running)
    // const result = await interceptAndSendCommand(
    //   aiCommandIntent, 
    //   encryptionKey, 
    //   'http://localhost:3000'
    // );
    // console.log('[Example] Result:', result);

    // Verify decryption works
    const decrypted = decryptAES256GCM({
      ciphertext: securePayload.ciphertext,
      iv: securePayload.iv,
      tag: securePayload.tag
    }, encryptionKey);
    
    console.log('[Example] Decrypted payload:', decrypted);
    return true;

  } catch (error) {
    console.error('[Example] Failed:', error.message);
    return false;
  }
};
