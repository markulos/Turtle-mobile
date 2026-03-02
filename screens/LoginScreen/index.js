/**
 * LoginScreen - Secure authentication entry point
 * 
 * Dark-themed login screen matching the Turtle app aesthetic.
 * Uses AuthContext for authentication state management.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';

// Load the turtle SVG from assets (same as TurtleScreen)
const turtleIcon = require('../../assets/turtle-icon.svg');

export default function LoginScreen() {
  const { theme } = useTheme();
  const { login, loginError, isLoading } = useAuth();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState('');

  const handleLogin = async () => {
    setLocalError('');
    
    if (!password.trim()) {
      setLocalError('Please enter your password');
      return;
    }

    const result = await login(password);
    
    if (!result.success) {
      // Error is already set in loginError from context
      // But we can also handle it locally if needed
    }
  };

  const displayError = localError || loginError;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={styles.content}>
          {/* Logo / Icon */}
          <View style={styles.logoContainer}>
            <Image
              source={turtleIcon}
              style={styles.logoImage}
              contentFit="contain"
              tintColor={theme.colors.primary}
            />
            <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
              Turtle
            </Text>
            <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
              Secure Command Console
            </Text>
          </View>

          {/* Login Form */}
          <View style={styles.formContainer}>
            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
              Enter Master Password
            </Text>

            {/* Password Input */}
            <View style={[
              styles.inputContainer,
              { 
                backgroundColor: theme.colors.inputBackground,
                borderColor: displayError ? theme.colors.accentError : theme.colors.border,
              }
            ]}>
              <Icon 
                name="lock" 
                size={20} 
                color={theme.colors.textMuted}
                style={styles.inputIcon}
              />
              <TextInput
                style={[styles.input, { color: theme.colors.inputText }]}
                placeholder="Password"
                placeholderTextColor={theme.colors.textPlaceholder}
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isLoading}
                onSubmitEditing={handleLogin}
                returnKeyType="done"
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeButton}
                disabled={isLoading}
              >
                <Icon
                  name={showPassword ? 'eye-off' : 'eye'}
                  size={20}
                  color={theme.colors.textMuted}
                />
              </TouchableOpacity>
            </View>

            {/* Error Message */}
            {displayError ? (
              <View style={styles.errorContainer}>
                <Icon name="alert-circle" size={16} color={theme.colors.accentError} />
                <Text style={[styles.errorText, { color: theme.colors.accentError }]}>
                  {displayError}
                </Text>
              </View>
            ) : null}

            {/* Login Button */}
            <TouchableOpacity
              style={[
                styles.loginButton,
                { 
                  backgroundColor: isLoading ? theme.colors.primaryMuted : theme.colors.primary,
                  opacity: isLoading ? 0.7 : 1,
                },
              ]}
              onPress={handleLogin}
              disabled={isLoading}
              activeOpacity={0.8}
            >
              {isLoading ? (
                <ActivityIndicator color={theme.colors.background} />
              ) : (
                <Text style={[styles.loginButtonText, { color: theme.colors.background }]}>
                  Unlock
                </Text>
              )}
            </TouchableOpacity>

            {/* Hint */}
            <Text style={[styles.hint, { color: theme.colors.textMuted }]}>
              Connect to your local Turtle server
            </Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: theme.colors.textMuted }]}>
            Secure End-to-End Encrypted
          </Text>
          <Icon name="shield-check" size={14} color={theme.colors.textMuted} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logoImage: {
    width: 120,
    height: 120,
    marginBottom: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
    letterSpacing: 0.3,
  },
  formContainer: {
    width: '100%',
  },
  label: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 4,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 52,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    height: '100%',
  },
  eyeButton: {
    padding: 4,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginLeft: 4,
  },
  errorText: {
    fontSize: 13,
    marginLeft: 6,
  },
  loginButton: {
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
  },
  loginButtonText: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  hint: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 16,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 24,
    gap: 6,
  },
  footerText: {
    fontSize: 11,
    letterSpacing: 0.3,
  },
});
