/**
 * ShareUploadToast
 *
 * The floating, non-blocking surface for "Send to Turtle" uploads owned by
 * ShareUploadContext. Mounted at the app root (see App.js) so it persists after
 * the share sheet dismisses and overlays whatever screen the user landed back
 * on. Renders nothing when there are no active jobs.
 *
 * Per job:
 *   uploading → spinner + "Sending to {board}…" (+ "3/8" for multi-photo)
 *   success   → check + "Sent 8 photos to {board}", then auto-dismisses
 *   error     → alert + reason + Retry / Dismiss (Retry resumes the upload
 *               without re-opening the OS share sheet)
 */
import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import { useShareUpload } from '../context/ShareUploadContext';
import { impactHaptic, tapHaptic } from '../utils/haptics';

const photoWord = (n) => (n === 1 ? 'photo' : 'photos');

function JobCard({ job, theme, onRetry, onDismiss }) {
  const { board, status, total, done, error, message, kind } = job;
  const isAudioJob = kind === 'audio-files' || kind === 'audio-url';
  // Null board = the default "save as-is" share straight into the photo vault.
  const boardName = isAudioJob ? 'Music Vault' : (board?.name || 'Photo vault');

  let icon, iconColor, title, subtitle;
  if (status === 'queued') {
    icon = 'check-circle';
    iconColor = theme.colors.accentSuccess;
    title = message || 'Queued for Music Vault';
  } else if (status === 'success') {
    icon = 'check-circle';
    iconColor = theme.colors.accentSuccess;
    title = total > 0 ? `Sent ${total} ${photoWord(total)} to ${boardName}` : `Sent to ${boardName}`;
  } else if (status === 'error') {
    // Partial batch (some landed, some didn't) reads as progress, not a flat
    // failure — Retry re-sends only the stragglers into the same content.
    const partial = done > 0 && done < total;
    icon = partial ? 'alert' : 'alert-circle-outline';
    iconColor = theme.colors.accentError;
    title = partial ? `Sent ${done} of ${total} to ${boardName}` : `Couldn't send to ${boardName}`;
    subtitle = error || 'Send failed.';
  } else {
    // uploading
    title = `Sending to ${boardName}…`;
    if (total > 1) subtitle = `${done}/${total} ${isAudioJob ? 'files' : photoWord(total)}`;
  }

  const progress = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.colors.surfaceElevated || theme.colors.surface, borderColor: theme.colors.border },
      ]}
    >
      <View style={styles.row}>
        <View style={styles.leading}>
          {status === 'uploading' ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
          ) : (
            <Icon name={icon} size={22} color={iconColor} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: theme.colors.textPrimary }]} numberOfLines={1}>
            {title}
          </Text>
          {!!subtitle && (
            <Text
              style={[styles.subtitle, { color: status === 'error' ? theme.colors.accentError : theme.colors.textMuted }]}
              numberOfLines={2}
            >
              {subtitle}
            </Text>
          )}
        </View>
        {status === 'error' ? (
          <View style={styles.actions}>
            <TouchableOpacity
              onPressIn={() => impactHaptic('medium')}
              onPress={() => onRetry(job.id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.retryBtn}
            >
              <Text style={[styles.retryText, { color: theme.colors.primary }]}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPressIn={() => tapHaptic()}
              onPress={() => onDismiss(job.id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="close" size={18} color={theme.colors.textMuted} />
            </TouchableOpacity>
          </View>
        ) : status === 'success' || status === 'queued' ? (
          <TouchableOpacity
            onPressIn={() => tapHaptic()}
            onPress={() => onDismiss(job.id)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="close" size={18} color={theme.colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Thin progress bar while uploading a multi-photo share. */}
      {status === 'uploading' && total > 1 && (
        <View style={[styles.progressTrack, { backgroundColor: theme.colors.border }]}>
          <View style={[styles.progressFill, { backgroundColor: theme.colors.primary, width: `${Math.round(progress * 100)}%` }]} />
        </View>
      )}
    </View>
  );
}

export default function ShareUploadToast() {
  const { theme } = useTheme();
  const { jobs, retryJob, dismissJob } = useShareUpload();
  const insets = useSafeAreaInsets();

  if (!jobs || jobs.length === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.container, { top: insets.top + 8 }]}
    >
      {jobs.map((job) => (
        <JobCard key={job.id} job={job} theme={theme} onRetry={retryJob} onDismiss={dismissJob} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    gap: 8,
    zIndex: 9999,
    elevation: 9999,
  },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    // Float above the content it overlays.
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  leading: { width: 24, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: '600' },
  subtitle: { fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  retryBtn: { paddingHorizontal: 4 },
  retryText: { fontSize: 14, fontWeight: '600' },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    marginTop: 10,
    overflow: 'hidden',
  },
  progressFill: { height: 3, borderRadius: 2 },
});
