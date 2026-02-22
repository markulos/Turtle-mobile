import { useState, useCallback, useEffect } from 'react';
import { Alert, Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

export const useAuth = () => {
  const [isLocked, setIsLocked] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [biometricType, setBiometricType] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [useFallback, setUseFallback] = useState(false); // NEW: Fallback mode

  const checkBiometricSupport = useCallback(async () => {
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      if (!compatible) {
        return { supported: false, error: 'Hardware not compatible', needsFallback: true };
      }

      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!enrolled) {
        return { supported: false, error: 'No biometrics enrolled', needsFallback: true };
      }

      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      const hasFaceID = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      const hasTouchID = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
      
      let type = 'biometric';
      if (hasFaceID) type = 'Face ID';
      else if (hasTouchID) type = 'Touch ID';
      
      setBiometricType(type);
      
      return { supported: true, type, hasFaceID, hasTouchID };
    } catch (error) {
      return { supported: false, error: error.message, needsFallback: true };
    }
  }, []);

  useEffect(() => {
    checkBiometricSupport();
  }, [checkBiometricSupport]);

  const authenticate = useCallback(async () => {
    if (isAuthenticating) return;
    
    setIsAuthenticating(true);
    setAuthError(null);
    
    try {
      const check = await checkBiometricSupport();
      
      if (!check.supported) {
        // NEW: Auto-enable fallback if biometrics aren't available
        if (check.needsFallback) {
          console.log('Biometrics not available, enabling fallback');
          setUseFallback(true);
          setIsAuthenticating(false);
          return;
        }
        
        Alert.alert('Biometric Error', check.error);
        setIsAuthenticating(false);
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: `Use ${check.type} to unlock your passwords`,
        cancelLabel: 'Cancel',
        disableDeviceFallback: true,
        requireConfirmation: false,
      });

      console.log('Auth result:', result);

      if (result.success) {
        setIsLocked(false);
      } else if (result.error === 'missing_usage_description') {
        // NEW: Handle missing permission specifically
        console.log('Face ID permission missing, enabling fallback');
        setUseFallback(true);
        setAuthError('Face ID not configured. Using PIN fallback.');
      } else if (result.error !== 'user_cancel') {
        setAuthError(result.error);
        // After 3 failures, offer fallback
        setUseFallback(true);
      }
    } catch (error) {
      console.error('Auth exception:', error);
      setUseFallback(true);
    } finally {
      setIsAuthenticating(false);
    }
  }, [isAuthenticating, checkBiometricSupport]);

  // NEW: Simple PIN fallback
  const authenticateWithPin = useCallback((pin) => {
    // Simple hardcoded PIN for development - change this!
    const DEV_PIN = '1234';
    
    if (pin === DEV_PIN) {
      setIsLocked(false);
      setUseFallback(false);
      setAuthError(null);
      return true;
    }
    setAuthError('Incorrect PIN');
    return false;
  }, []);

  const lock = useCallback(() => {
    setIsLocked(true);
    setUseFallback(false);
    setAuthError(null);
  }, []);

  return {
    isLocked,
    isAuthenticating,
    biometricType,
    authError,
    useFallback, // NEW: Expose fallback state
    authenticate,
    authenticateWithPin, // NEW: Fallback method
    lock,
    setIsLocked,
    setUseFallback, // Allow manual enable
  };
};