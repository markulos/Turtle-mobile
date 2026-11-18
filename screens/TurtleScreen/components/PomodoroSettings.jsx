import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
} from 'react-native';
import { depth } from '../../../utils/surfaceDepth';
import { DEFAULT_PLAN, normalisePlan, untilLongBreak } from '../../../utils/focusPlan';
import AppTextInput from '../../../components/AppTextInput';
import { useTheme } from '../../../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { tapHaptic, impactHaptic } from '../../../utils/haptics';

/**
 * PomodoroSettings - Modal to adjust focus and break durations
 * 
 * Props:
 * - visible: boolean
 * - onClose: () => void
 * - onSave: ({ focusMinutes, breakMinutes, longBreakMinutes, longBreakEvery }) => void
 * - initialFocusMinutes / initialBreakMinutes / initialLongBreakMinutes
 * - initialLongBreakEvery: every Nth break is the long one; 0 turns them off
 * - finishedToday: focus sessions done today, for the line at the bottom
 *
 * The lengths are the ACCOUNT's, not this phone's — the desktop reads and
 * writes the same two keys (see utils/focusPlan), so what is set here is
 * what starts there. Clamping is that module's too, for the same reason: a
 * limit the two apps disagree about is a timer whose length depends on
 * which device you started it from.
 */
export default function PomodoroSettings({
  visible,
  onClose,
  onSave,
  initialFocusMinutes = DEFAULT_PLAN.focus,
  initialBreakMinutes = DEFAULT_PLAN.break,
  initialLongBreakMinutes = DEFAULT_PLAN.longBreak,
  initialLongBreakEvery = DEFAULT_PLAN.longBreakEvery,
  finishedToday = 0,
}) {
  const { theme } = useTheme();
  const [focusMinutes, setFocusMinutes] = useState(String(initialFocusMinutes));
  const [breakMinutes, setBreakMinutes] = useState(String(initialBreakMinutes));
  const [longBreakMinutes, setLongBreakMinutes] = useState(String(initialLongBreakMinutes));
  const [longBreakEvery, setLongBreakEvery] = useState(String(initialLongBreakEvery));
  
  useEffect(() => {
    if (visible) {
      setFocusMinutes(String(initialFocusMinutes));
      setBreakMinutes(String(initialBreakMinutes));
      setLongBreakMinutes(String(initialLongBreakMinutes));
      setLongBreakEvery(String(initialLongBreakEvery));
    }
  }, [visible, initialFocusMinutes, initialBreakMinutes, initialLongBreakMinutes, initialLongBreakEvery]);
  
  if (!visible) return null;
  
  const handleSave = () => {
    // One clamp, shared with the desktop. The old pair here capped focus at
    // 60 and a break at 30, which silently refused lengths the server runs
    // happily and the other app allows.
    const safe = normalisePlan({
      focus: parseInt(focusMinutes, 10),
      break: parseInt(breakMinutes, 10),
      longBreak: parseInt(longBreakMinutes, 10),
      longBreakEvery: parseInt(longBreakEvery, 10),
    });
    onSave({
      focusMinutes: safe.focus,
      breakMinutes: safe.break,
      longBreakMinutes: safe.longBreak,
      longBreakEvery: safe.longBreakEvery,
    });
    onClose();
  };
  
  const styles = createStyles(theme);
  
  return (
    <View style={styles.overlay}>
      {/* Tap anywhere outside the card to close — this was the app's only
          surface with a single close affordance (the X). */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
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
            <AppTextInput
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
            <AppTextInput
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

        {/* Long break. Every Nth break is this one instead of the short one;
            0 turns them off, which the hint says rather than leaving someone
            to discover that a blank means "never". */}
        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <Icon name="sleep" size={20} color="#4ECDC4" />
            <Text style={styles.label}>Long Break</Text>
          </View>
          <View style={styles.inputRow}>
            <AppTextInput
              style={styles.input}
              value={longBreakMinutes}
              onChangeText={setLongBreakMinutes}
              keyboardType="number-pad"
              maxLength={3}
              placeholder={String(DEFAULT_PLAN.longBreak)}
              placeholderTextColor={theme.colors.textMuted}
            />
            <Text style={styles.unit}>minutes</Text>
          </View>
        </View>

        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <Icon name="repeat" size={20} color="#4ECDC4" />
            <Text style={styles.label}>Long Break Every</Text>
          </View>
          <View style={styles.inputRow}>
            <AppTextInput
              style={styles.input}
              value={longBreakEvery}
              onChangeText={setLongBreakEvery}
              keyboardType="number-pad"
              maxLength={2}
              placeholder={String(DEFAULT_PLAN.longBreakEvery)}
              placeholderTextColor={theme.colors.textMuted}
            />
            <Text style={styles.unit}>sessions · 0 = off</Text>
          </View>
        </View>

        {/* Where today actually stands, so the number above is not abstract. */}
        <Text style={styles.cycleNote}>
          {(() => {
            const every = parseInt(longBreakEvery, 10) || 0;
            if (every <= 0) return `${finishedToday} finished today · every break is short.`;
            const toGo = untilLongBreak(finishedToday, { ...DEFAULT_PLAN, longBreakEvery: every });
            if (toGo === 0 && finishedToday > 0) return `${finishedToday} finished today · the next break is the long one.`;
            return `${finishedToday} finished today · ${toGo} to go until a long break.`;
          })()}
        </Text>
        
        {/* Presets */}
        <View style={styles.presetsContainer}>
          <Text style={styles.presetsLabel}>Quick Presets</Text>
          <View style={styles.presetButtons}>
            <TouchableOpacity
              style={styles.presetButton}
              onPressIn={() => tapHaptic()}
              onPress={() => {
                setFocusMinutes('25');
                setBreakMinutes('5');
              }}
            >
              <Text style={styles.presetText}>Classic (25/5)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.presetButton}
              onPressIn={() => tapHaptic()}
              onPress={() => {
                setFocusMinutes('50');
                setBreakMinutes('10');
              }}
            >
              <Text style={styles.presetText}>Long (50/10)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.presetButton}
              onPressIn={() => tapHaptic()}
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
        <TouchableOpacity style={styles.saveButton} onPressIn={() => impactHaptic('medium')} onPress={handleSave}>
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
      ...depth(theme, 'card'),
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
      ...depth(theme, 'control'),
    },
    unit: {
      fontSize: 15,
      color: theme.colors.textSecondary,
      // Wide enough for "sessions · 0 = off" without pushing the field in.
      width: 128,
    },
    cycleNote: {
      fontSize: 12.5,
      lineHeight: 17,
      color: theme.colors.textMuted,
      marginTop: -4,
      marginBottom: 16,
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
      ...depth(theme, 'control'),
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
      ...depth(theme, 'control'),
    },
    saveButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.textPrimary,
    },
  });
