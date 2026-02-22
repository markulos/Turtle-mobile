import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export const LockedScreen = ({ 
  onUnlock, 
  isAuthenticating, 
  isConnected, 
  biometricType,
  authError,
  useFallback, // NEW
  onPinSubmit, // NEW
  onEnableFallback // NEW
}) => {
  const [pin, setPin] = useState('');
  const [showPinInput, setShowPinInput] = useState(false);

  const getBiometricInfo = () => {
    switch (biometricType) {
      case 'Face ID':
        return { icon: 'face-recognition', text: 'Unlock with Face ID' };
      case 'Touch ID':
        return { icon: 'fingerprint', text: 'Unlock with Touch ID' };
      default:
        return { icon: 'fingerprint', text: 'Unlock with Biometrics' };
    }
  };

  const { icon, text } = getBiometricInfo();

  const handlePinSubmit = () => {
    if (onPinSubmit(pin)) {
      setPin('');
    }
  };

  // Show PIN input if fallback is enabled or user chooses it
  if (useFallback || showPinInput) {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <Icon name="lock-pattern" size={80} color="#4CAF50" />
          <Text style={styles.title}>Enter PIN</Text>
          <Text style={styles.subtitle}>
            {useFallback 
              ? 'Biometrics unavailable. Use PIN to unlock.' 
              : 'Enter your 4-digit PIN'}
          </Text>
          
          <TextInput
            style={styles.pinInput}
            value={pin}
            onChangeText={setPin}
            keyboardType="number-pad"
            maxLength={4}
            secureTextEntry
            placeholder="••••"
            textAlign="center"
          />
          
          <TouchableOpacity 
            style={styles.unlockButton}
            onPress={handlePinSubmit}
          >
            <Text style={styles.buttonText}>Unlock</Text>
          </TouchableOpacity>

          {authError && (
            <Text style={styles.errorText}>{authError}</Text>
          )}

          {!useFallback && (
            <TouchableOpacity onPress={() => setShowPinInput(false)}>
              <Text style={styles.linkText}>Try Biometrics Again</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Icon name="shield-lock" size={100} color="#4CAF50" />
        <Text style={styles.title}>Password Vault</Text>
        <Text style={styles.subtitle}>
          Authentication required to access your passwords
        </Text>
        
        {authError && (
          <View style={styles.errorBox}>
            <Icon name="alert-circle" size={20} color="#f44336" />
            <Text style={styles.errorText}>{authError}</Text>
          </View>
        )}
        
        <TouchableOpacity 
          style={[styles.unlockButton, isAuthenticating && styles.buttonDisabled]}
          onPress={onUnlock}
          disabled={isAuthenticating}
        >
          {isAuthenticating ? (
            <Text style={styles.buttonText}>Authenticating...</Text>
          ) : (
            <>
              <Icon name={icon} size={24} color="#fff" style={styles.unlockIcon} />
              <Text style={styles.buttonText}>{text}</Text>
            </>
          )}
        </TouchableOpacity>

        {/* NEW: Fallback option */}
        <TouchableOpacity 
          style={styles.fallbackButton}
          onPress={() => setShowPinInput(true)}
        >
          <Text style={styles.fallbackText}>Use PIN Instead</Text>
        </TouchableOpacity>

        {!isConnected && (
          <View style={styles.offlineWarning}>
            <Icon name="wifi-off" size={20} color="#f44336" />
            <Text style={styles.offlineText}>Not connected to server</Text>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    padding: 40,
    width: '100%',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 20,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 30,
    paddingHorizontal: 20,
  },
  pinInput: {
    width: 150,
    height: 60,
    borderWidth: 2,
    borderColor: '#4CAF50',
    borderRadius: 12,
    fontSize: 24,
    letterSpacing: 8,
    marginBottom: 20,
    backgroundColor: '#fff',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffebee',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    maxWidth: 300,
  },
  errorText: {
    color: '#f44336',
    marginLeft: 8,
    fontSize: 14,
  },
  unlockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4CAF50',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 30,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  buttonDisabled: {
    backgroundColor: '#a5d6a7',
  },
  unlockIcon: {
    marginRight: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  // NEW: Fallback styles
  fallbackButton: {
    marginTop: 20,
    padding: 10,
  },
  fallbackText: {
    color: '#2196F3',
    fontSize: 14,
  },
  linkText: {
    color: '#4CAF50',
    fontSize: 14,
    marginTop: 15,
  },
  offlineWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 30,
    padding: 10,
    backgroundColor: '#ffebee',
    borderRadius: 8,
  },
  offlineText: {
    color: '#f44336',
    marginLeft: 8,
    fontSize: 14,
  },
});