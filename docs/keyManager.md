# keyManager — secure key storage (mobile)

> Moved out of the root AGENTS.md on 2026-09-23, which is now the repo map.
> STATUS: `mobile-app/utils/keyManager.js` exists but NOTHING IMPORTS IT — the
> 2026-07-11 mobile audit flagged it as orphaned. Kept because the API below is
> the only written record of how the enclave key was meant to work.

---

## Secure Key Management Utility

Client-side secure key storage using device enclave (iOS Keychain / Android Keystore).

**Location:** `mobile-app/utils/keyManager.js`

### Overview

Manages AES-256 encryption keys securely using:
- **Storage**: `expo-secure-store` (Keychain/Keystore)
- **Key Generation**: `expo-crypto.getRandomBytesAsync()` (CSPRNG)
- **Key Format**: 256-bit (32 bytes), returned as Uint8Array/Base64/Hex

### API Reference

#### Core Functions

```javascript
import {
  getOrGenerateKey,  // Main function - get or create key
  getKeyForAESGCM,   // Get key in AES-GCM format
  hasKey,            // Check if key exists
  deleteKey,         // Delete stored key
  isValidKey,        // Validate key format
} from './utils/keyManager';
```

#### `getOrGenerateKey()`

Main entry point. Retrieves existing key or generates and stores a new one.

```javascript
const keyData = await getOrGenerateKey();

// Returns:
{
  bytes: Uint8Array(32),      // Raw bytes for crypto operations
  base64: 'base64_string',     // Base64 encoded
  hex: '64_char_hex_string',   // Hex encoded
  isNew: false,                // true if newly generated
}
```

**Usage:**
```javascript
import { getOrGenerateKey } from './utils/keyManager';

async function encryptData(plaintext) {
  try {
    const { bytes, hex, isNew } = await getOrGenerateKey();
    
    if (isNew) {
      console.log('New encryption key generated');
    }
    
    // Use hex string with AES-GCM
    // const encrypted = await aesEncrypt(plaintext, hex);
    
    return encrypted;
  } catch (error) {
    console.error('Key error:', error.message);
  }
}
```

#### `getKeyForAESGCM()`

Returns key formatted for AES-GCM operations.

```javascript
const { key, keyBytes, keyBase64, isNew } = await getKeyForAESGCM();

// key: Hex string (64 chars) - commonly used for AES-GCM
// keyBytes: Uint8Array(32) - raw bytes
// keyBase64: Base64 string - for storage/transmission
```

#### `hasKey()`

Check if a key exists in secure storage.

```javascript
const exists = await hasKey();
if (!exists) {
  console.log('First launch - will generate key');
}
```

#### `deleteKey()`

Delete the stored key (for reset scenarios).

```javascript
await deleteKey();
console.log('Key deleted - will regenerate on next use');
```

### Security Features

1. **Hardware-backed Storage**: Uses iOS Keychain / Android Keystore
2. **Accessible Level**: `ALWAYS_THIS_DEVICE_ONLY` - most secure option
3. **CSPRNG**: `expo-crypto.getRandomBytesAsync()` for key generation
4. **Key Validation**: Built-in format checking
5. **Version Tracking**: Supports future key migrations

### Error Handling

| Error | Cause | Action |
|-------|-------|--------|
| `KEY_GENERATION_FAILED` | Crypto error | App restart needed |
| `STORAGE_FAILED` | Secure storage error | Check device security |
| `STORAGE_CANCELLED` | User cancelled auth | Retry operation |
| `SECURE_STORAGE_UNAVAILABLE` | Device doesn't support | Use fallback or warn user |
| `INVALID_KEY_FORMAT` | Corrupted key data | Regenerate key |

### React Hook Example

```javascript
import { useState, useEffect } from 'react';
import { getOrGenerateKey } from './utils/keyManager';

function useEncryptionKey() {
  const [key, setKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    getOrGenerateKey()
      .then(setKey)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  return { key, loading, error };
}

// Usage in component
function MyComponent() {
  const { key, loading, error } = useEncryptionKey();
  
  if (loading) return <Text>Initializing...</Text>;
  if (error) return <Text>Error: {error.message}</Text>;
  
  // Use key.hex for encryption
  return <SecureData keyData={key} />;
}
```

### Utility Functions

```javascript
import {
  bytesToBase64,
  base64ToBytes,
  bytesToHex,
  hexToBytes,
  isValidKey,
  debugKeyStatus,
} from './utils/keyManager';

// Convert between formats
const base64 = bytesToBase64(uint8Array);
const hex = bytesToHex(uint8Array);
const bytes = base64ToBytes(base64String);

// Validate key
const isValid = isValidKey(keyBytes); // true/false

// Debug (development only)
const status = await debugKeyStatus();
// { hasKey: true, version: '1', platform: 'ios' }
```

### Files

| File | Description |
|------|-------------|
| `mobile-app/utils/keyManager.js` | Core key management utility |
| `mobile-app/utils/keyManager.example.js` | Usage examples |

### Dependencies

Already included in project:
- `expo-secure-store` ~14.2.0
- `expo-crypto` ~14.1.0
