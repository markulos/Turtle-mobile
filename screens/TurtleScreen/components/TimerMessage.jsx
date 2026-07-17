import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { notifyHaptic } from '../../../utils/haptics';

/**
 * TimerMessage — driven by the server-as-source-of-truth pomodoro socket.
 *
 * Three states:
 *   active     — live mm:ss countdown + progress bar + Stop button
 *   completed  — "ended at HH:MM today" + Dismiss
 *   stopped    — same shape as completed, red accent
 *
 * Props:
 *   state: { status, mode, totalDuration, startedAt, endsAt?, endedAt? }
 *   onStop: () => void   (active only)
 *   onDismiss: () => void  (ended only)
 *   theme: object
 *   minimized: bool       (active only) — collapse to a thin "working" header
 *   onToggleMinimize: () => void  — flips minimized; tap the mini bar or the
 *                                   chevron on the full card to switch
 */
export default function TimerMessage({ state, onStop, onDismiss, theme, minimized, onToggleMinimize }) {
  const [now, setNow] = useState(() => Date.now());

  // Tick every second when active. We compute remaining from the absolute
  // endsAt, so re-renders / drift don't accumulate error.
  useEffect(() => {
    if (!state || state.status !== 'active') return undefined;
    if (Date.now() >= state.endsAt) return undefined;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= state.endsAt) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [state && state.status, state && state.status === 'active' ? state.endsAt : null]);

  if (!state) return null;

  const isFocus = state.mode === 'focus';
  const accentColor = isFocus ? '#FF6B6B' : '#4ECDC4';
  const modeLabel = isFocus ? 'FOCUS' : 'BREAK';
  const iconName = isFocus ? 'brain' : 'coffee';

  const styles = createStyles(theme, accentColor);

  if (state.status === 'active') {
    const remainingSec = Math.max(0, Math.ceil((state.endsAt - now) / 1000));
    const mins = Math.floor(remainingSec / 60);
    const secs = remainingSec % 60;
    const display = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    const progress = Math.min(1, Math.max(0, 1 - remainingSec / state.totalDuration));
    const totalMins = Math.round(state.totalDuration / 60);
    const endsAtFriendly = new Date(state.endsAt).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });

    // Minimized: a thin always-visible header (mirrors the Claude queue
    // banner) so the running session stays in view without taking the
    // full card's height. Tap anywhere to expand back to the full timer.
    if (minimized) {
      return (
        <TouchableOpacity
          onPress={onToggleMinimize}
          activeOpacity={0.8}
          style={styles.miniContainer}
          accessibilityLabel={`Pomodoro ${modeLabel} running, ${display} remaining — tap to expand`}
        >
          <Icon name={iconName} size={14} color={accentColor} />
          <Text style={[styles.miniLabel, { color: accentColor }]}>{modeLabel}</Text>
          <Text style={styles.miniTime}>{display}</Text>
          <View style={styles.miniProgressTrack}>
            <View
              style={[styles.miniProgressFill, { width: `${progress * 100}%`, backgroundColor: accentColor }]}
            />
          </View>
          <Icon name="chevron-up" size={18} color={theme.colors.textMuted} />
        </TouchableOpacity>
      );
    }

    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.badge}>
            <Icon name={iconName} size={12} color={accentColor} />
            <Text style={styles.badgeText}>{modeLabel}</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.metaText}>{totalMins} min</Text>
            {onToggleMinimize && (
              <TouchableOpacity
                onPress={onToggleMinimize}
                style={styles.minimizeButton}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Minimize timer"
              >
                <Icon name="chevron-down" size={18} color={theme.colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={styles.timerRow}>
          <Text style={styles.timerText}>{display}</Text>
          <TouchableOpacity onPressIn={() => notifyHaptic('warning')} onPress={onStop} style={styles.stopButton}>
            <Icon name="stop-circle-outline" size={26} color={theme.colors.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.progressContainer}>
          <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: accentColor }]} />
        </View>

        <Text style={styles.metaSmall}>ends ~{endsAtFriendly}</Text>
      </View>
    );
  }

  // ended (completed or stopped)
  const isCompleted = state.status === 'completed';
  const endedColor = isCompleted ? '#4ade80' : theme.colors.accentError || '#f87171';
  const friendly = formatRelativeEnded(state.endedAt, now);
  const totalMins = Math.round(state.totalDuration / 60);
  const startedAtTime = new Date(state.startedAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.badge}>
          <Icon name={iconName} size={12} color={accentColor} />
          <Text style={styles.badgeText}>{modeLabel}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: `${endedColor}1A`, borderColor: `${endedColor}55` }]}>
          <Text style={[styles.statusPillText, { color: endedColor }]}>
            {isCompleted ? 'Complete' : 'Stopped'}
          </Text>
        </View>
      </View>

      <Text style={styles.endedTitle}>
        {isFocus ? 'Focus session' : 'Break'} {isCompleted ? 'completed' : 'stopped'}{' '}
        <Text style={[styles.endedAt, { color: endedColor }]}>{friendly}</Text>.
      </Text>
      <Text style={styles.metaSmall}>
        Duration: {totalMins} min · started {startedAtTime}
      </Text>

      <TouchableOpacity onPress={onDismiss} style={styles.dismissButton}>
        <Text style={styles.dismissText}>Dismiss</Text>
      </TouchableOpacity>
    </View>
  );
}

function formatRelativeEnded(endedAt, now) {
  const ended = new Date(endedAt);
  const time = ended.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfEnded = new Date(endedAt);
  startOfEnded.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((startOfToday.getTime() - startOfEnded.getTime()) / 86400000);
  if (dayDiff === 0) return `today at ${time}`;
  if (dayDiff === 1) return `yesterday at ${time}`;
  return `${ended.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`;
}

const createStyles = (theme, accentColor) =>
  StyleSheet.create({
    container: {
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: 16,
      padding: 14,
      minWidth: 200,
      maxWidth: 280,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    minimizeButton: {
      padding: 2,
    },
    // Minimized "working" header — a thin pill that mirrors the Claude
    // queue banner so the two collapsed indicators read as a family.
    miniContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'stretch',
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 12,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      borderLeftWidth: 3,
      borderLeftColor: accentColor,
      gap: 8,
    },
    miniLabel: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    miniTime: {
      fontSize: 14,
      fontWeight: '700',
      color: theme.colors.textPrimary,
      fontVariant: ['tabular-nums'],
    },
    miniProgressTrack: {
      flex: 1,
      height: 4,
      borderRadius: 2,
      overflow: 'hidden',
      backgroundColor: theme.colors.border,
    },
    miniProgressFill: {
      height: '100%',
      borderRadius: 2,
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
    metaText: {
      fontSize: 11,
      color: theme.colors.textMuted,
    },
    metaSmall: {
      fontSize: 11,
      color: theme.colors.textMuted,
      marginTop: 6,
    },
    timerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
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
    progressFill: {
      height: '100%',
      borderRadius: 2,
    },
    statusPill: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
      borderWidth: 1,
    },
    statusPillText: {
      fontSize: 10,
      fontWeight: '600',
      letterSpacing: 0.4,
    },
    endedTitle: {
      fontSize: 14,
      color: theme.colors.textPrimary,
      lineHeight: 20,
    },
    endedAt: {
      fontWeight: '600',
    },
    dismissButton: {
      alignSelf: 'flex-end',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      marginTop: 10,
    },
    dismissText: {
      fontSize: 12,
      color: theme.colors.textSecondary,
    },
  });
