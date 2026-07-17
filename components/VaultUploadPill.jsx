/**
 * VaultUploadPill
 *
 * The floating, app-wide status widget for photo-vault uploads. Mounted once at
 * the app root (next to ShareUploadToast), it renders whenever a vault batch
 * exists and CONSTANTLY shows the live percentage while the upload runs in the
 * background — whatever screen the user is on. Sits at the BOTTOM (just above
 * the tab bar) so it never collides with the share toast at the top.
 *
 * States, mirroring VaultUploadContext:
 *   uploading → spinner + "Uploading N of M" + live % + thin progress bar
 *               (+ a "duplicates skipped" line as they're found).
 *   paused    → server was unreachable; explains itself + a Resume button.
 *   done      → the batch stats (uploaded / duplicates / failed) and the
 *               delete-originals offer: everything now safe in the vault —
 *               including the skipped duplicates — can be removed from the
 *               phone in one tap (the OS shows its own confirm).
 */
import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import { useVaultUploadState, useVaultUploadActions } from '../context/VaultUploadContext';
import { tapHaptic, notifyHaptic } from '../utils/haptics';

// Height of the bottom tab bar's content (App.js uses 49 + bottom inset).
const TAB_BAR_H = 49;

export default function VaultUploadPill() {
  const { theme } = useTheme();
  const { state, hidden } = useVaultUploadState();
  const { hide, show, resume, deleteOriginals, dismiss } = useVaultUploadActions();
  const insets = useSafeAreaInsets();

  if (!state) return null;

  const c = theme.colors;
  const done = state.status === 'done';
  const paused = state.status === 'paused';

  // Hidden = COLLAPSED, not gone. During an active upload the full card shrinks
  // to a small app-root chip (still shows the %, taps to expand). Keeping it at
  // the ROOT — not returning null — means the escape hatch is global: on every
  // tab you can re-open it (critical for a PAUSED batch, whose Resume lives on
  // the expanded card). Same anchor as the full pill, so expand/collapse is an
  // in-place swap. The 'done' card always shows regardless (stats + delete
  // offer must never be missed).
  if (hidden && !done) {
    return (
      <View
        pointerEvents="box-none"
        style={[styles.container, { bottom: TAB_BAR_H + insets.bottom + 10, alignItems: 'flex-end' }]}
      >
        <TouchableOpacity
          onPressIn={() => tapHaptic()}
          onPress={show}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Show upload progress"
          style={[styles.chip, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}
        >
          {paused
            ? <Icon name="pause" size={15} color={c.textSecondary} />
            : <ActivityIndicator size="small" color={c.primary} />}
          <Text style={[styles.chipLabel, { color: paused ? c.textSecondary : c.primary }]}>
            {paused ? 'Paused' : `${state.pct}%`}
          </Text>
          <Icon name="chevron-up" size={16} color={c.textMuted} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View
      pointerEvents="box-none"
      style={[styles.container, { bottom: TAB_BAR_H + insets.bottom + 10 }]}
    >
      <View
        style={[styles.card, {
          backgroundColor: c.surfaceElevated,
          borderColor: c.border,
        }]}
      >
        {!done ? (
          <>
            <View style={styles.row}>
              {paused ? (
                <Icon name="pause-circle-outline" size={20} color={c.textSecondary} />
              ) : (
                <ActivityIndicator size="small" color={c.primary} />
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={1}>
                  {paused
                    ? 'Vault upload paused'
                    : `Uploading ${state.currentIndex} of ${state.total}`}
                </Text>
                <Text style={[styles.subtitle, { color: c.textSecondary }]} numberOfLines={1}>
                  {paused
                    ? "Couldn't reach the server — will retry when you return."
                    : (state.duplicates > 0
                      ? `${state.duplicates} duplicate${state.duplicates === 1 ? '' : 's'} skipped · resumes if interrupted`
                      : 'Runs in the background · resumes if interrupted')}
                </Text>
              </View>
              {paused ? (
                <TouchableOpacity
                  onPressIn={() => tapHaptic()}
                  onPress={resume}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={[styles.action, { color: c.primary }]}>Resume</Text>
                </TouchableOpacity>
              ) : (
                // The constant, always-visible LIVE percentage.
                <Text style={[styles.pct, { color: c.primary }]}>{state.pct}%</Text>
              )}
              {/* Hide the pill — the upload keeps running; progress stays
                  visible in the photo vault and (backgrounded) the OS notice. */}
              <TouchableOpacity
                onPressIn={() => tapHaptic()}
                onPress={hide}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Hide upload progress"
                style={{ marginLeft: 2 }}
              >
                <Icon name="chevron-down" size={20} color={c.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: c.border }]}>
              <View style={[styles.progressFill, { backgroundColor: c.primary, width: `${state.pct}%` }]} />
            </View>
          </>
        ) : (
          <>
            <View style={styles.row}>
              <Icon
                name={state.failed > 0 ? 'alert-circle' : 'check-circle'}
                size={20}
                color={state.failed > 0 ? (c.accentWarning || '#F59E0B') : (c.accentSuccess || c.primary)}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={1}>
                  Vault upload finished
                </Text>
                {/* The batch stats — duplicates found on upload are part of the
                    final log line, per the vault's dedup contract. */}
                <Text style={[styles.subtitle, { color: c.textSecondary }]} numberOfLines={2}>
                  {`${state.uploaded} uploaded · ${state.duplicates} duplicate${state.duplicates === 1 ? '' : 's'} skipped${state.failed > 0 ? ` · ${state.failed} failed` : ''}`}
                </Text>
              </View>
              <TouchableOpacity
                onPress={dismiss}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Dismiss"
              >
                <Icon name="close" size={18} color={c.textMuted} />
              </TouchableOpacity>
            </View>
            {state.deletableCount > 0 && (
              <View style={styles.buttons}>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: c.surface }]}
                  onPress={dismiss}
                >
                  <Text style={{ color: c.textPrimary, fontWeight: '600', fontSize: 13 }}>Keep</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: c.accentError || '#F87171' }]}
                  onPressIn={() => notifyHaptic('warning')}
                  onPress={deleteOriginals}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                    Delete {state.deletableCount} from phone
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9998,
    elevation: 9998,
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 14, fontWeight: '600' },
  subtitle: { fontSize: 12, marginTop: 2 },
  pct: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  action: { fontSize: 14, fontWeight: '700' },
  progressTrack: { height: 3, borderRadius: 2, marginTop: 10, overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 2 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  // Collapsed chip — a compact corner puck that still shows the live % and
  // taps to expand. Right-aligned via the container's alignItems override.
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  chipLabel: { fontSize: 13.5, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
