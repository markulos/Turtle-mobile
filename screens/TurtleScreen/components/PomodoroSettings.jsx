import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

/**
 * PomodoroSettings - Modal to adjust focus and break durations
 * 
 * Props:
 * - visible: boolean
 * - onClose: () => void
 * - onSave: ({ focusMinutes, breakMinutes }) => void
 * - initialFocusMinutes: number (default 25)
 * - initialBreakMinutes: number (default 5)
 */
export default function PomodoroSettings({
  visible,
  onClose,
  onSave,
  initialFocusMinutes = 25,
  initialBreakMinutes = 5,
}) {
  const { theme } = useTheme();
  const [focusMinutes, setFocusMinutes] = useState(String(initialFocusMinutes));
  const [breakMinutes, setBreakMinutes] = useState(String(initialBreakMinutes));
  
  useEffect(() => {
    if (visible) {
      setFocusMinutes(String(initialFocusMinutes));
      setBreakMinutes(String(initialBreakMinutes));
    }
  }, [visible, initialFocusMinutes, initialBreakMinutes]);
  
  if (!visible) return null;
  
  const handleSave = () => {
    const focus = parseInt(focusMinutes, 10) || 25;
    const breakTime = parseInt(breakMinutes, 10) || 5;
    onSave({
      focusMinutes: Math.max(1, Math.min(60, focus)),
      breakMinutes: Math.max(1, Math.min(30, breakTime)),
    });
    onClose();
  };
  
  const styles = createStyles(theme);
  
  return (
    <View style={styles.overlay}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Pomodoro Settings</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Icon name="close" size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
        </View>
        
        {/* Focus Duration */}
        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <Icon name="brain" size={20} color="#FF6B6B" />
            <Text style={styles.label}>Focus Duration</Text>
          </View>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={focusMinutes}
              onChangeText={setFocusMinutes}
              keyboardType="number-pad"
              maxLength={2}
              placeholder="25"
              placeholderTextColor={theme.colors.textMuted}
            />
            <Text style={styles.unit}>minutes</Text>
          </View>
        </View>
        
        {/* Break Duration */}
        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <Icon name="coffee" size={20} color="#4ECDC4" />
            <Text style={styles.label}>Break Duration</Text>
          </View>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={breakMinutes}
              onChangeText={setBreakMinutes}
              keyboardType="number-pad"
              maxLength={2}
              placeholder="5"
              placeholderTextColor={theme.colors.textMuted}
            />
            <Text style={styles.unit}>minutes</Text>
          </View>
        </View>
        
        {/* Presets */}
        <View style={styles.presetsContainer}>
          <Text style={styles.presetsLabel}>Quick Presets</Text>
          <View style={styles.presetButtons}>
            <TouchableOpacity
              style={styles.presetButton}
              onPress={() => {
                setFocusMinutes('25');
                setBreakMinutes('5');
              }}
            >
              <Text style={styles.presetText}>Classic (25/5)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.presetButton}
              onPress={() => {
                setFocusMinutes('50');
                setBreakMinutes('10');
              }}
            >
              <Text style={styles.presetText}>Long (50/10)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.presetButton}
              onPress={() => {
                setFocusMinutes('15');
                setBreakMinutes('3');
              }}
            >
              <Text style={styles.presetText}>Short (15/3)</Text>
            </TouchableOpacity>
          </View>
        </View>
        
        {/* Save Button */}
        <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveButtonText}>Save Settings</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const createStyles = (theme) =>
  StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
      zIndex: 200,
    },
    container: {
      backgroundColor: theme.colors.background,
      borderRadius: 20,
      padding: 24,
      width: '100%',
      maxWidth: 400,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 24,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.colors.textPrimary,
    },
    closeButton: {
      padding: 4,
    },
    inputGroup: {
      marginBottom: 20,
    },
    labelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
    },
    label: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.colors.textPrimary,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    input: {
      flex: 1,
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      fontSize: 18,
      color: theme.colors.textPrimary,
      textAlign: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    unit: {
      fontSize: 15,
      color: theme.colors.textSecondary,
      width: 70,
    },
    presetsContainer: {
      marginTop: 8,
      marginBottom: 24,
    },
    presetsLabel: {
      fontSize: 13,
      color: theme.colors.textMuted,
      marginBottom: 10,
    },
    presetButtons: {
      flexDirection: 'row',
      gap: 8,
    },
    presetButton: {
      flex: 1,
      backgroundColor: theme.colors.surfaceElevated,
      paddingVertical: 10,
      paddingHorizontal: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: 'center',
    },
    presetText: {
      fontSize: 12,
      color: theme.colors.textSecondary,
    },
    saveButton: {
      backgroundColor: theme.colors.surfaceElevated,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    saveButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.textPrimary,
    },
  });
