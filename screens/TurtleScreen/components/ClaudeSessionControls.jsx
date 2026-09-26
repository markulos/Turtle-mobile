import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { depth } from '../../../utils/surfaceDepth';
import { notifyHaptic } from '../../../utils/haptics';

/**
 * ClaudeSessionControls — the live-session control cluster (status pill, live
 * toggle, Stop, expand, minimize).
 *
 * This used to be the ClaudeConsole card's own header row. It lives in the CHAT
 * HEADER now: the console overlay is pure log output, and the controls ride on
 * the top bar where the search button sits outside a session. Its own row under
 * the identity line, so nothing has to compete for width with the title — the
 * old single-row card header truncated "Claude x Turtle | Admin" to fit.
 *
 * Rendered as a plain row; the caller owns the surrounding padding.
 */
export default function ClaudeSessionControls({
  mode,
  active,
  busy,
  live = true,
  onToggleLive,
  onStop,
  expanded,
  onToggleExpanded,
  onClose,
  style,
}) {
  const { theme } = useTheme();
  const styles = createStyles(theme);

  const isLogin = mode === 'login';
  const paused = active && !isLogin && !live;
  const statusText = isLogin
    ? 'signing in…'
    : !active ? 'starting…' : paused ? 'paused' : busy ? 'working…' : 'live';
  const dotColor = paused
    ? theme.colors.accentWarning
    : (active || isLogin) ? theme.colors.accentSuccess : theme.colors.accentWarning;

  const HIT = { top: 8, bottom: 8, left: 8, right: 8 };

  return (
    <View style={[styles.row, style]}>
      <View style={styles.statusPill}>
        {busy && !isLogin && !paused
          ? <ActivityIndicator size="small" color={theme.colors.accentInfo} />
          : <View style={[styles.dot, { backgroundColor: dotColor }]} />}
        <Text style={styles.statusText}>{statusText}</Text>
      </View>

      {/* Live-view toggle. Pausing stops the per-chunk log stream (the session
          keeps running in the background, buffered server-side); going live
          replays the buffer to catch up. The off state is tinted so it's
          obvious the panel isn't updating. */}
      {active && !isLogin && onToggleLive && (
        <TouchableOpacity
          onPress={onToggleLive}
          hitSlop={HIT}
          style={[styles.liveBtn, !live && styles.liveBtnPaused]}
          accessibilityRole="button"
          accessibilityLabel={live ? 'Pause live log (Claude keeps working in the background)' : 'Resume live log and catch up'}
        >
          <Icon name={live ? 'pause' : 'play'} size={13} color={live ? theme.colors.accentSuccess : theme.colors.accentWarning} />
          <Text style={[styles.liveBtnText, { color: live ? theme.colors.accentSuccess : theme.colors.accentWarning }]}>
            {live ? 'Live' : 'Paused'}
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        onPressIn={() => notifyHaptic('warning')}
        onPress={onStop}
        hitSlop={HIT}
        style={styles.stopBtn}
        accessibilityRole="button"
        accessibilityLabel={isLogin ? 'Cancel sign-in' : 'Stop the Claude session'}
      >
        <Text style={styles.stopText}>{isLogin ? 'Cancel' : 'Stop'}</Text>
      </TouchableOpacity>

      {/* Pushes the two icon buttons to the trailing edge, so the labelled
          controls read as one left-aligned group. */}
      <View style={styles.spacer} />

      <TouchableOpacity
        onPress={onToggleExpanded}
        hitSlop={HIT}
        style={styles.iconBtn}
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Collapse Claude session' : 'Expand Claude session to full view'}
      >
        <Icon name={expanded ? 'arrow-collapse' : 'arrow-expand'} size={18} color={theme.colors.textTertiary} />
      </TouchableOpacity>

      <TouchableOpacity
        onPress={onClose}
        hitSlop={HIT}
        style={styles.iconBtn}
        accessibilityRole="button"
        accessibilityLabel="Hide the Claude console"
      >
        <Icon name="chevron-down" size={20} color={theme.colors.textTertiary} />
      </TouchableOpacity>
    </View>
  );
}

const createStyles = (theme) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  spacer: { flex: 1 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
    ...depth(theme, 'control'),
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: '600', color: theme.colors.textSecondary },
  liveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: `${theme.colors.accentSuccess}1A`,
  },
  liveBtnPaused: {
    backgroundColor: `${theme.colors.accentWarning}26`,
  },
  liveBtnText: { fontSize: 11, fontWeight: '700' },
  stopBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: `${theme.colors.accentError}22`,
  },
  stopText: { fontSize: 12, fontWeight: '700', color: theme.colors.accentError },
  iconBtn: { padding: 2 },
});
