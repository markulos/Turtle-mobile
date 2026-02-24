import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Keyboard,
  Animated,
  PanResponder,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const PULL_THRESHOLD = 80;
const MAX_PULL = 120;

export const UnlockScreen = ({ onUnlock, isProcessing }) => {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  
  const pullY = useRef(new Animated.Value(0)).current;
  const barWidth = useRef(new Animated.Value(0)).current;
  const styles = createStyles(theme, insets, isDark);

  const handleSubmit = () => {
    onUnlock(password);
  };

  const triggerRefresh = useCallback(() => {
    setRefreshing(true);
    Keyboard.dismiss();
    
    // Animate bar to full width
    Animated.timing(barWidth, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    
    // Reset after delay
    setTimeout(() => {
      Animated.timing(barWidth, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        setRefreshing(false);
      });
    }, 800);
  }, [barWidth]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only respond to downward pulls at the top of scroll
        return gestureState.dy > 0;
      },
      onPanResponderMove: (_, gestureState) => {
        const pullDistance = Math.min(gestureState.dy, MAX_PULL);
        pullY.setValue(pullDistance);
        
        // Animate bar width based on pull progress
        const progress = Math.min(pullDistance / PULL_THRESHOLD, 1);
        barWidth.setValue(progress);
        
        // Dismiss keyboard if pulled far enough
        if (pullDistance > PULL_THRESHOLD * 0.5) {
          Keyboard.dismiss();
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > PULL_THRESHOLD && !refreshing) {
          triggerRefresh();
        }
        
        // Reset pull position
        Animated.spring(pullY, {
          toValue: 0,
          useNativeDriver: true,
          friction: 8,
        }).start();
      },
    })
  ).current;

  const barColor = isDark ? '#FFFFFF' : '#000000';
  const barScaleX = barWidth.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      {/* Pull to refresh bar - fixed at bottom above nav */}
      <View style={styles.refreshBarContainer}>
        <Animated.View
          style={[
            styles.refreshBar,
            { backgroundColor: barColor },
            { transform: [{ scaleX: barScaleX }] },
          ]}
        />
      </View>
      
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!refreshing}
        {...panResponder.panHandlers}
      >
        <Animated.View 
          style={[
            styles.content,
            {
              transform: [{
                translateY: pullY.interpolate({
                  inputRange: [0, MAX_PULL],
                  outputRange: [0, MAX_PULL * 0.3],
                  extrapolate: 'clamp',
                })
              }]
            }
          ]}
        >
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
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const createStyles = (theme, insets, isDark) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    refreshBarContainer: {
      position: 'absolute',
      top: insets.top,
      left: 0,
      right: 0,
      height: 2,
      zIndex: 100,
      justifyContent: 'center',
    },
    refreshBar: {
      height: 1.5,
      width: '100%',
    },
    scrollContent: {
      flexGrow: 1,
    },
    content: {
      flex: 1,
      justifyContent: 'center',
      padding: 24,
      minHeight: 400,
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
