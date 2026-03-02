import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
} from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const { width } = Dimensions.get('window');

/**
 * PomodoroWidget - Displays active timer with animated progress
 * 
 * Props:
 * - timerState: { remainingTime, totalDuration, mode, isRunning, progress }
 * - onStop: () => void
 * - onComplete: () => void
 */
export default function PomodoroWidget({ timerState, onStop, onComplete }) {
  const { theme } = useTheme();
  const { remainingTime, totalDuration, mode, progress } = timerState;
  
  // Animation value for progress (0 to 1)
  const progressAnim = useRef(new Animated.Value(progress || 0)).current;
  const [displayTime, setDisplayTime] = useState(formatTime(remainingTime));
  
  // Update display time when remainingTime changes
  useEffect(() => {
    setDisplayTime(formatTime(remainingTime));
  }, [remainingTime]);
  
  // Animate progress bar
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress || 0,
      duration: 1000,
      useNativeDriver: false,
    }).start();
  }, [progress]);
  
  // Check for completion
  useEffect(() => {
    if (remainingTime <= 0) {
      onComplete?.();
    }
  }, [remainingTime]);
  
  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });
  
  const isFocus = mode === 'focus';
  const accentColor = isFocus ? '#FF6B6B' : '#4ECDC4'; // Red for focus, teal for break
  const modeLabel = isFocus ? 'FOCUS TIME' : 'BREAK TIME';
  
  const styles = createStyles(theme, accentColor);
  
  return (
    <View style={styles.container}>
      {/* Header with mode indicator */}
      <View style={styles.header}>
        <View style={styles.modeBadge}>
          <Icon 
            name={isFocus ? 'brain' : 'coffee'} 
            size={14} 
            color={accentColor} 
          />
          <Text style={styles.modeText}>{modeLabel}</Text>
        </View>
        <TouchableOpacity onPress={onStop} style={styles.stopButton}>
          <Icon name="stop-circle" size={24} color={theme.colors.accentError} />
        </TouchableOpacity>
      </View>
      
      {/* Timer display */}
      <View style={styles.timerContainer}>
        <Text style={styles.timerText}>{displayTime}</Text>
        <Text style={styles.durationText}>
          of {formatTime(totalDuration)}
        </Text>
      </View>
      
      {/* Progress bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBackground} />
        <Animated.View 
          style={[
            styles.progressFill,
            { width: progressWidth }
          ]} 
        />
      </View>
      
      {/* Remaining indicator */}
      <Text style={styles.remainingText}>
        {remainingTime > 0 
          ? `${Math.ceil(remainingTime / 60)} min remaining`
          : 'Completing...'
        }
      </Text>
    </View>
  );
}

/**
 * Format seconds to MM:SS
 */
function formatTime(seconds) {
  if (!seconds || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

const createStyles = (theme, accentColor) =>
  StyleSheet.create({
    container: {
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: 16,
      padding: 16,
      marginHorizontal: 12,
      marginVertical: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    modeBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: `${accentColor}20`,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
      gap: 6,
    },
    modeText: {
      fontSize: 12,
      fontWeight: '700',
      color: accentColor,
      letterSpacing: 0.5,
    },
    stopButton: {
      padding: 4,
    },
    timerContainer: {
      alignItems: 'center',
      marginBottom: 16,
    },
    timerText: {
      fontSize: 48,
      fontWeight: '200',
      color: theme.colors.textPrimary,
      fontVariant: ['tabular-nums'],
      letterSpacing: 2,
    },
    durationText: {
      fontSize: 13,
      color: theme.colors.textMuted,
      marginTop: 4,
    },
    progressContainer: {
      height: 8,
      backgroundColor: theme.colors.background,
      borderRadius: 4,
      overflow: 'hidden',
      marginBottom: 12,
    },
    progressBackground: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: theme.colors.border,
    },
    progressFill: {
      height: '100%',
      backgroundColor: accentColor,
      borderRadius: 4,
    },
    remainingText: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      textAlign: 'center',
    },
  });
