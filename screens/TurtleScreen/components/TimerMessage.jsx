import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

/**
 * TimerMessage - Renders a live countdown timer within a chat message
 * 
 * Props:
 * - displayTime: string (MM:SS format)
 * - progress: number (0-1)
 * - mode: 'focus' | 'break'
 * - totalDuration: number (seconds)
 * - onStop: () => void
 * - theme: object
 */
export default function TimerMessage({ 
  displayTime, 
  progress, 
  mode, 
  totalDuration,
  onStop,
  theme 
}) {
  const isFocus = mode === 'focus';
  const accentColor = isFocus ? '#FF6B6B' : '#4ECDC4';
  const modeLabel = isFocus ? 'FOCUS' : 'BREAK';
  const iconName = isFocus ? 'brain' : 'coffee';
  
  // Calculate progress percentage for bar
  const progressPercent = Math.max(0, Math.min(100, progress * 100));
  
  // Format total duration
  const totalMins = Math.floor(totalDuration / 60);
  
  const styles = createStyles(theme, accentColor);
  
  return (
    <View style={styles.container}>
      {/* Header with mode badge and stop button */}
      <View style={styles.header}>
        <View style={styles.badge}>
          <Icon name={iconName} size={12} color={accentColor} />
          <Text style={styles.badgeText}>{modeLabel}</Text>
        </View>
        <Text style={styles.durationText}>{totalMins} min</Text>
      </View>
      
      {/* Timer display */}
      <View style={styles.timerRow}>
        <Text style={styles.timerText}>{displayTime}</Text>
        <TouchableOpacity onPress={onStop} style={styles.stopButton}>
          <Icon name="stop-circle" size={24} color={theme.colors.textMuted} />
        </TouchableOpacity>
      </View>
      
      {/* Progress bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBackground} />
        <View 
          style={[
            styles.progressFill, 
            { width: `${progressPercent}%`, backgroundColor: accentColor }
          ]} 
        />
      </View>
    </View>
  );
}

const createStyles = (theme, accentColor) =>
  StyleSheet.create({
    container: {
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: 16,
      padding: 14,
      minWidth: 180,
      maxWidth: 260,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
    },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: `${accentColor}20`,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 10,
      gap: 4,
    },
    badgeText: {
      fontSize: 10,
      fontWeight: '700',
      color: accentColor,
      letterSpacing: 0.5,
    },
    durationText: {
      fontSize: 11,
      color: theme.colors.textMuted,
    },
    timerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
    },
    timerText: {
      fontSize: 32,
      fontWeight: '300',
      color: theme.colors.textPrimary,
      fontVariant: ['tabular-nums'],
      letterSpacing: 1,
    },
    stopButton: {
      padding: 4,
    },
    progressContainer: {
      height: 4,
      backgroundColor: theme.colors.border,
      borderRadius: 2,
      overflow: 'hidden',
    },
    progressBackground: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: theme.colors.border,
    },
    progressFill: {
      height: '100%',
      borderRadius: 2,
    },
  });
