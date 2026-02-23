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
} from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export const UnlockScreen = ({ onUnlock, isProcessing }) => {
  const { theme } = useTheme();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const styles = createStyles(theme);

  const handleSubmit = () => {
    onUnlock(password);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Icon name="shield-lock" size={60} color={theme.colors.textPrimary} />
        </View>

        <Text style={styles.title}>Unlock Vault</Text>
        <Text style={styles.subtitle}>
          Enter your master password to view your passwords
        </Text>

        <View style={styles.inputContainer}>
          <Icon name="lock" size={20} color={theme.colors.textTertiary} />
          <TextInput
            style={styles.input}
            placeholder="Master Password"
            placeholderTextColor={theme.colors.textPlaceholder}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoFocus
            onSubmitEditing={handleSubmit}
          />
          <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
            <Icon
              name={showPassword ? 'eye-off' : 'eye'}
              size={20}
              color={theme.colors.textTertiary}
            />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.button, (!password || isProcessing) && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={!password || isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator color={theme.colors.textPrimary} />
          ) : (
            <Text style={styles.buttonText}>Unlock</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const createStyles = (theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      flex: 1,
      justifyContent: 'center',
      padding: 24,
    },
    iconContainer: {
      alignSelf: 'center',
      marginBottom: 32,
    },
    title: {
      fontSize: 24,
      fontWeight: '700',
      color: theme.colors.textPrimary,
      textAlign: 'center',
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      marginBottom: 32,
    },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.inputBackground,
      borderRadius: 8,
      paddingHorizontal: 16,
      marginBottom: 16,
    },
    input: {
      flex: 1,
      height: 48,
      marginLeft: 12,
      fontSize: 16,
      color: theme.colors.inputText,
    },
    button: {
      backgroundColor: theme.colors.surfaceElevated,
      height: 48,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    buttonText: {
      color: theme.colors.textPrimary,
      fontSize: 16,
      fontWeight: '600',
    },
  });
