/**
 * UpdatesPanel — which code this phone is running, and the one button that
 * changes it.
 *
 * ─── Why it exists ──────────────────────────────────────────────────────────
 *
 * For months the installed app was a development client: a native shell with
 * no JavaScript of its own, fetching the bundle from Metro on every launch. So
 * "the app always downloads the latest" was literally true, and a sleeping
 * server meant a red screen. The fix is a real build that runs the code it
 * shipped with and takes over-the-air updates only when asked. That fix is
 * invisible unless something on screen says which world the phone is in — and
 * lets the owner move it forward on purpose. This is that something.
 *
 * ─── Behaviour, deliberately ────────────────────────────────────────────────
 *
 * The app itself never downloads an update on its own (app.json sets
 * checkAutomatically to ON_ERROR_RECOVERY — it will only self-heal after a
 * crash). This panel CHECKS on open, which costs one small manifest request and
 * downloads nothing, so the pill can honestly say "up to date" or "update
 * available". Downloading and restarting happens only on the tap. That is the
 * whole point: run the version you have, update when you choose.
 *
 * In a development client the native module reports isEnabled=false and every
 * API throws; rather than let the owner tap "check" forever, the panel names
 * the situation and offers nothing.
 *
 * Always visible (not collapsed): the answer to "what am I running?" is the
 * reason to open Settings, so it should never be one more tap away.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useTheme } from '../context/ThemeContext';
import { tapHaptic } from '../utils/haptics';
import { describeBuild, describeUpdateError, formatWhen, shortId } from '../utils/updatesSummary';

/** What the native module says about THIS launch, gathered once. */
function readBuild() {
  return describeBuild({
    isEnabled: Updates.isEnabled,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    updateId: Updates.updateId,
    createdAt: Updates.createdAt,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  });
}

export default function UpdatesPanel() {
  const { theme } = useTheme();
  const c = theme.colors;
  const build = readBuild();
  const canUpdate = build.mode !== 'dev-client';

  // idle | checking | current | available | downloading | restarting | error
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState(null);
  const [available, setAvailable] = useState(null); // { id, createdAt }

  const check = useCallback(async () => {
    if (!canUpdate) return;
    setPhase('checking');
    setError(null);
    try {
      // Metadata only. Nothing is downloaded here — see the header comment.
      const r = await Updates.checkForUpdateAsync();
      if (r.isAvailable) {
        setAvailable({ id: r.manifest?.id || null, createdAt: r.manifest?.createdAt || null });
        setPhase('available');
      } else {
        setAvailable(null);
        setPhase('current');
      }
    } catch (e) {
      setError(describeUpdateError(e));
      setPhase('error');
    }
  }, [canUpdate]);

  const apply = useCallback(async () => {
    setPhase('downloading');
    setError(null);
    try {
      await Updates.fetchUpdateAsync();
      setPhase('restarting');
      // The app relaunches here with the new bundle. Nothing after this runs.
      await Updates.reloadAsync();
    } catch (e) {
      setError(describeUpdateError(e));
      setPhase('error');
    }
  }, []);

  // One quiet check when Settings opens — so the pill is true, not stale.
  useEffect(() => { check(); }, [check]);

  const styles = makeStyles(theme);
  const appVersion = Constants.expoConfig?.version || '—';
  const buildNumber = Constants.expoConfig?.ios?.buildNumber || Constants.nativeBuildVersion || null;
  const runtime = Updates.runtimeVersion ? shortId(Updates.runtimeVersion) : '—';
  const channel = Updates.channel || (canUpdate ? '—' : 'metro');

  const pill = (() => {
    if (!canUpdate) return { text: 'DEV BUILD', color: c.textSecondary };
    switch (phase) {
      case 'checking': return { text: 'CHECKING…', color: c.textSecondary };
      case 'current': return { text: 'UP TO DATE', color: c.accentSuccess };
      case 'available': return { text: 'UPDATE AVAILABLE', color: c.accentInfo };
      case 'downloading': return { text: 'DOWNLOADING…', color: c.accentInfo };
      case 'restarting': return { text: 'RESTARTING…', color: c.accentInfo };
      case 'error': return { text: 'CHECK FAILED', color: c.accentWarning };
      default: return { text: '', color: c.textSecondary };
    }
  })();
  const busy = phase === 'checking' || phase === 'downloading' || phase === 'restarting';

  return (
    <View style={styles.wrap} accessibilityLabel="App version and updates">
      <View style={styles.header}>
        <Icon name="update" size={18} color={c.accentInfo} />
        <Text style={styles.title}>App version & updates</Text>
        <View style={{ flex: 1 }} />
        {pill.text ? (
          <View style={[styles.pill, { borderColor: pill.color }]}>
            <Text style={[styles.pillText, { color: pill.color }]}>{pill.text}</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.buildTitle}>{build.title}</Text>
      <Text style={styles.buildDetail}>{build.detail}</Text>

      <View style={styles.facts}>
        <Text style={styles.fact}>app {appVersion}{buildNumber ? ` (${buildNumber})` : ''}</Text>
        <Text style={styles.fact}>runtime {runtime}</Text>
        <Text style={styles.fact}>channel {channel}</Text>
      </View>

      {phase === 'available' && available ? (
        <Text style={styles.availableLine}>
          New: update {shortId(available.id) || '—'}
          {available.createdAt ? `, published ${formatWhen(available.createdAt)}` : ''}
        </Text>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {canUpdate ? (
        <View style={styles.actions}>
          {phase === 'available' ? (
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: c.accentInfo }]}
              onPress={() => { tapHaptic(); apply(); }}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Download the update and restart"
            >
              {busy ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="download" size={14} color="#fff" />}
              <Text style={styles.primaryBtnText}>{busy ? 'Working…' : 'Download & restart'}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => { tapHaptic(); check(); }}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Check for updates"
          >
            {phase === 'checking'
              ? <ActivityIndicator size="small" color={c.textSecondary} />
              : <Icon name="refresh" size={14} color={c.textSecondary} />}
            <Text style={styles.secondaryBtnText}>{phase === 'checking' ? 'Checking…' : 'Check for updates'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (theme) => {
  const c = theme.colors;
  return StyleSheet.create({
    wrap: {
      backgroundColor: c.surface,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: 14,
      marginBottom: 12,
      gap: 6,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
    title: { fontSize: 15, fontWeight: '600', color: c.textPrimary },
    pill: {
      borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2,
    },
    pillText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
    buildTitle: { fontSize: 14, fontWeight: '600', color: c.textPrimary },
    buildDetail: { fontSize: 12, color: c.textSecondary, lineHeight: 17 },
    facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 },
    fact: { fontSize: 12, color: c.textTertiary || c.textSecondary, fontVariant: ['tabular-nums'] },
    availableLine: { fontSize: 12, color: c.accentInfo, marginTop: 4 },
    error: { fontSize: 12, color: c.accentWarning, marginTop: 4, lineHeight: 17 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 14, height: 36, borderRadius: 8,
    },
    primaryBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
    secondaryBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 12, height: 36, borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    },
    secondaryBtnText: { color: c.textSecondary, fontSize: 12 },
  });
};
