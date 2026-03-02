/**
 * AI Command Interceptor - Usage Examples
 * 
 * This file demonstrates how to use the AI Command Interceptor service
 * to securely process AI-generated command intents with replay attack protection.
 */

import {
  generateEncryptionKey,
  interceptCommand,
  sendToServer,
  interceptAndSend,
  decryptPayload,
  SecurePayload
} from './AICommandInterceptor';

// ============================================================================
// EXAMPLE 1: Basic Usage with Replay Protection
// ============================================================================

export const exampleBasicUsage = async () => {
  // 1. AI generates a command intent
  const aiCommandIntent = {
    type: 'TASK_CREATE',
    version: '1.0',
    payload: {
      title: 'Review quarterly report',
      description: 'Complete financial review for Q4',
      priority: 'high',
      dueDate: '2026-03-15',
      assignee: 'user@example.com',
      // This will be automatically stripped
      rawCommand: 'CREATE TASK "Review quarterly report" PRIORITY HIGH'
    }
  };

  // 2. Generate or retrieve encryption key
  // In production, store this securely (expo-secure-store)
  const encryptionKey = generateEncryptionKey();

  // 3. Intercept and encrypt (now async with replay protection)
  try {
    // Debug logger to view plaintext before encryption
    const debugLog = (stage, data) => {
      console.log(`[${stage}]`, data);
    };
    
    const securePayload = await interceptCommand(aiCommandIntent, encryptionKey, debugLog);
    
    console.log('Secure payload created:');
    console.log('- Ciphertext length:', securePayload.ciphertext.length);
    console.log('- IV:', securePayload.iv);
    console.log('- Tag:', securePayload.tag.substring(0, 16) + '...');
    console.log('- Timestamp:', securePayload.timestamp);
    console.log('- Nonce:', securePayload.metadata.nonce); // UUIDv4 for replay protection
    console.log('- Metadata:', securePayload.metadata);
    
    // The plaintext before encryption looked like:
    // {
    //   command: 'TASK_CREATE',
    //   title: 'Review quarterly report',
    //   ...
    //   timestamp: 1715000000000,  // <- Added for replay protection
    //   nonce: 'uuid-v4-string'      // <- Added for replay protection
    // }

    return securePayload;
  } catch (error) {
    console.error('Failed:', error.message);
    throw error;
  }
};

// ============================================================================
// EXAMPLE 2: Send to Server with Debug Logging
// ============================================================================

export const exampleSendToServer = async (serverUrl) => {
  const aiCommandIntent = {
    type: 'PASSWORD_CREATE',
    payload: {
      title: 'Work Email',
      lines: [
        'Username: john@company.com',
        'Password: SuperSecret123!'
      ]
    }
  };

  const encryptionKey = generateEncryptionKey();

  try {
    // Collect debug logs
    const debugLogs = [];
    const debugLog = (stage, data) => {
      debugLogs.push({ stage, data, time: new Date().toISOString() });
      console.log(`[${stage}]`, data.substring(0, 100) + '...');
    };
    
    // Option A: Two-step process with debug logging
    const securePayload = await interceptCommand(aiCommandIntent, encryptionKey, debugLog);
    console.log('Plaintext logged - check debug output for timestamp and nonce');
    
    const result = await sendToServer(securePayload, serverUrl);
    
    console.log('Server response:', result);
    console.log('Debug logs:', debugLogs);

    // Option B: One-shot with debug logging
    const result2 = await interceptAndSend(aiCommandIntent, encryptionKey, serverUrl, debugLog);
    
    if (result2.success) {
      console.log('Command executed successfully!');
      console.log('Timestamp:', result2.timestamp);
      console.log('Nonce:', result2.metadata.nonce);
    } else {
      console.error('Failed:', result2.error);
    }

    return result2;
  } catch (error) {
    console.error('Transmission failed:', error.message);
    throw error;
  }
};

// ============================================================================
// EXAMPLE 3: Replay Attack Protection
// ============================================================================

export const exampleReplayProtection = async () => {
  const encryptionKey = generateEncryptionKey();

  const aiIntent = {
    type: 'DELETE_TASK',
    payload: {
      command: 'delete_task',
      taskId: '12345'
    }
  };

  console.log('=== Replay Protection Demo ===\n');

  // First encryption
  const payload1 = await interceptCommand(aiIntent, encryptionKey);
  console.log('Encryption 1:');
  console.log('  Timestamp:', payload1.timestamp);
  console.log('  Nonce:', payload1.metadata.nonce);
  
  // Second encryption of same command
  const payload2 = await interceptCommand(aiIntent, encryptionKey);
  console.log('\nEncryption 2 (same command):');
  console.log('  Timestamp:', payload2.timestamp);
  console.log('  Nonce:', payload2.metadata.nonce);
  
  // They should have different timestamps and nonces
  const sameTimestamp = payload1.timestamp === payload2.timestamp;
  const sameNonce = payload1.metadata.nonce === payload2.metadata.nonce;
  
  console.log('\nReplay Protection Check:');
  console.log('  Same timestamp?', sameTimestamp, '(should be false)');
  console.log('  Same nonce?', sameNonce, '(should be false)');
  console.log('  Protection working:', !sameTimestamp && !sameNonce ? '✓ YES' : '✗ NO');
};

// ============================================================================
// EXAMPLE 4: Debug Logging in UI
// ============================================================================

export const exampleDebugLogging = `
// In your React Native component:

import { useState } from 'react';
import { View, Text, ScrollView, Switch } from 'react-native';
import { interceptAndSend, generateEncryptionKey } from './services/AICommandInterceptor';

export const SecureChatComponent = () => {
  const [debugMode, setDebugMode] = useState(true);
  const [debugLogs, setDebugLogs] = useState([]);
  const [messages, setMessages] = useState([]);
  
  const encryptionKey = generateEncryptionKey();
  
  const addDebugLog = (stage, data) => {
    setDebugLogs(prev => [...prev, { 
      id: Date.now(), 
      stage, 
      data,
      timestamp: new Date().toLocaleTimeString()
    }]);
  };
  
  const sendSecureMessage = async (text) => {
    const commandIntent = {
      type: 'CHAT_MESSAGE',
      payload: { command: 'send_message', message: text }
    };
    
    const result = await interceptAndSend(
      commandIntent,
      encryptionKey,
      'http://localhost:3000',
      debugMode ? addDebugLog : null
    );
    
    if (result.success) {
      setMessages(prev => [...prev, { 
        text: result.serverResponse.data.reply,
        timestamp: result.timestamp,
        nonce: result.metadata.nonce // Show nonce for verification
      }]);
    }
  };
  
  return (
    <View>
      {/* Debug Toggle */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text>Debug Mode</Text>
        <Switch value={debugMode} onValueChange={setDebugMode} />
      </View>
      
      {/* Debug Logs Panel */}
      {debugMode && (
        <ScrollView style={{ maxHeight: 200, backgroundColor: '#1a1a2e' }}>
          {debugLogs.map(log => (
            <View key={log.id} style={{ padding: 8, borderBottomWidth: 1 }}>
              <Text style={{ color: '#4ADE80', fontWeight: 'bold' }}>
                {log.stage}
              </Text>
              <Text style={{ color: '#a0a0a0', fontSize: 11, fontFamily: 'monospace' }}>
                {log.data}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
      
      {/* Messages */}
      {/* ... */}
    </View>
  );
};
`;

// ============================================================================
// EXAMPLE 5: Verify Plaintext Structure
// ============================================================================

export const exampleVerifyPlaintext = async () => {
  const encryptionKey = generateEncryptionKey();
  
  const aiIntent = {
    type: 'UPDATE_PASSWORD',
    payload: {
      id: 'pass-123',
      title: 'Updated Title'
    }
  };
  
  let capturedPlaintext = null;
  
  const captureLog = (stage, data) => {
    if (stage === 'Plaintext (before encryption)') {
      capturedPlaintext = JSON.parse(data);
    }
  };
  
  await interceptCommand(aiIntent, encryptionKey, captureLog);
  
  console.log('=== Plaintext Structure Verification ===');
  console.log('Captured plaintext:', JSON.stringify(capturedPlaintext, null, 2));
  
  // Verify required fields
  const hasCommand = capturedPlaintext?.command !== undefined || capturedPlaintext?.type !== undefined;
  const hasTimestamp = typeof capturedPlaintext?.timestamp === 'number';
  const hasNonce = typeof capturedPlaintext?.nonce === 'string' && 
                   capturedPlaintext.nonce.includes('-'); // UUID format check
  
  console.log('\nField Verification:');
  console.log('  Has command/type?', hasCommand ? '✓' : '✗');
  console.log('  Has timestamp?', hasTimestamp ? '✓' : '✗', `(${capturedPlaintext?.timestamp})`);
  console.log('  Has nonce?', hasNonce ? '✓' : '✗', `(${capturedPlaintext?.nonce})`);
  
  const allValid = hasCommand && hasTimestamp && hasNonce;
  console.log('\nReplay Protection:', allValid ? '✓ ENABLED' : '✗ DISABLED');
  
  return {
    valid: allValid,
    plaintext: capturedPlaintext
  };
};

// ============================================================================
// RUN ALL EXAMPLES
// ============================================================================

export const runAllExamples = async () => {
  console.log('=== AI Command Interceptor Examples ===\n');

  console.log('--- Example 1: Basic Usage with Replay Protection ---');
  await exampleBasicUsage();
  console.log('');

  console.log('--- Example 3: Replay Protection ---');
  await exampleReplayProtection();
  console.log('');

  console.log('--- Example 5: Verify Plaintext Structure ---');
  await exampleVerifyPlaintext();
  console.log('');

  console.log('=== Examples Complete ===');
  console.log('Note: Example 2 and 4 require a running server');
  console.log('Note: Example 4 is a code snippet');
};

export default {
  exampleBasicUsage,
  exampleSendToServer,
  exampleReplayProtection,
  exampleDebugLogging,
  exampleVerifyPlaintext,
  runAllExamples,
};
