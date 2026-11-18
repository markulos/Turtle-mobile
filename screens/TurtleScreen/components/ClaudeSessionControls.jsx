import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { depth } from '../../../utils/surfaceDepth';
import { notifyHaptic } from '../../../utils/haptics';

/**
 * ClaudeSessionControls — the live-session control cluster (status pill, Stop,
 * expand, minimize).
 *
 * THE PILL IS THE TOGGLE. It used to be two controls side by side and they
 * said the same word: a pill reading "live" and, next to it, a button reading
 * "Live". Mark, 2026-11-15: "combine the two live buttons in the orchestrator
 * corner." One of them was the readout and the other was the switch, which is
 * a distinction that only exists in the code — on screen it was the state
 * printed twice, in a corner that has four other controls in it.
 *
 * So the readout IS the switch now: the dot, the word, and a pause/play glyph
 * that says what tapping does. The glyph appears only while there is something
 * to toggle, so "starting…" and "signing in…" stay plain readouts rather than
 * offering a switch that would do nothing.
 *
 * This used to be the ClaudeConsole card's own header row. It lives in the CHAT
 * HEADER now: the console overlay is pure log output, and the controls ride on
 * the top bar where the search button sits outside a session. Its own row under
 * the identity line, so nothing has to compete for width with the title — the
 * old single-row card header truncated "Claude x Turtle | Admin" to fit.
 *
 * Rendered as a plain row; the caller owns the surrounding padding.
 *
 * `compact` is the form it takes in the COMPOSER's top-right corner (Mark,
 * 2026-11-15: the controls belong with the thing you type into, not on the
 * header). There the row is packed to the trailing edge, there is no spacer
 * splitting it in two, and the status pill is the part that gives way when
 * the panel is narrow — the buttons never do.
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
  compact = false,
  style,
  /**
   * The colours of the surface these keys are ON.
   *
   * Mark, 2026-11-18: in light mode the composer wears the nav bar's
   * backdrop, and these keys live in its top-right corner. They were drawn
   * for the page — on a dark band that is invisible (§1). Given a palette,
   * they use it; given none, nothing changes anywhere else that mounts this.
   */
  ink = null,
}) {
  const { theme: pageTheme } = useTheme();
  const theme = ink ? { ...pageTheme, colors: { ...pageTheme.colors, ...ink } } : pageTheme;
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

  // Pausing stops the per-chunk log stream — the session keeps running in the
  // background, buffered server-side — and going live replays the buffer to
  // catch up. Only offered once there IS a stream: before the session is up,
  // the pill is a readout and nothing more.
  const canToggle = !!(active && !isLogin && onToggleLive);
  const pill = (
    <>
      {busy && !isLogin && !paused
        ? <ActivityIndicator size="small" color={theme.colors.accentInk} />
        : <View style={[styles.dot, { backgroundColor: dotColor }]} />}
      <Text
        style={[
          styles.statusText,
          compact && styles.statusTextCompact,
          paused && { color: theme.colors.accentWarning },
        ]}
        numberOfLines={1}
      >{statusText}</Text>
      {/* What tapping does, not what the state is — the word beside it already
          says the state. */}
      {canToggle && (
        <Icon
          name={live ? 'pause' : 'play'}
          size={12}
          color={paused ? theme.colors.accentWarning : theme.colors.textTertiary}
        />
      )}
    </>
  );

  return (
    <View style={[styles.row, compact && styles.rowCompact, style]}>
      {canToggle ? (
        <TouchableOpacity
          onPress={onToggleLive}
          hitSlop={HIT}
          // Tinted while paused, which is the one state worth noticing from
          // across the room: the panel has stopped updating and the work has
          // not.
          style={[styles.statusPill, compact && styles.statusPillCompact, paused && styles.statusPillPaused]}
          accessibilityRole="button"
          accessibilityState={{ selected: live }}
          accessibilityLabel={live ? 'Pause live log (Claude keeps working in the background)' : 'Resume live log and catch up'}
          testID="claude-live-pill"
        >
          {pill}
        </TouchableOpacity>
      ) : (
        <View style={[styles.statusPill, compact && styles.statusPillCompact]} testID="claude-live-pill">
          {pill}
        </View>
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
      {!compact && <View style={styles.spacer} />}

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
  // In the composer: packed to the trailing edge, a little tighter, and the
  // status pill is what shrinks (down to its dot) on a narrow phone.
  rowCompact: { justifyContent: 'flex-end', gap: 6 },
  statusPillCompact: { flexShrink: 1, minWidth: 0 },
  statusTextCompact: { flexShrink: 1 },
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
  statusPillPaused: { backgroundColor: `${theme.colors.accentWarning}26` },
  stopBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: `${theme.colors.accentError}22`,
  },
  stopText: { fontSize: 12, fontWeight: '700', color: theme.colors.accentError },
  iconBtn: { padding: 2 },
});
