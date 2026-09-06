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
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Switch, Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useTheme } from '../context/ThemeContext';
import { useServer } from '../context/ServerContext';
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

  // ── Owner-only release steering ──────────────────────────────────────────
  // The pond keeps two channels: preview (the owner proves a publish on their
  // own phone) and production (everyone else). Promote and roll back are pointer
  // moves on the pond among updates it has already built and signed — no build,
  // no key, so a stolen owner token could only shuffle released artifacts.
  const { api, isConnected } = useServer();
  const [releases, setReleases] = useState(null);           // GET /mobile-updates/status
  const [releasesState, setReleasesState] = useState(null); // 'forbidden' | 'absent' | 'error' | null
  const [following, setFollowing] = useState(null);         // channel THIS phone asks for
  const [releaseBusy, setReleaseBusy] = useState(false);

  const loadReleases = useCallback(async () => {
    if (!isConnected || !canUpdate) return;
    try {
      const r = await api.get('/mobile-updates/status');
      if (r?.success) { setReleases(r); setReleasesState(null); } else setReleasesState('error');
    } catch (e) {
      const m = String(e?.message);
      // 403 = not the owner; 404 = a pond that predates this. Both simply hide it.
      if (/403|forbidden|owner/i.test(m)) setReleasesState('forbidden');
      else if (/404|not found/i.test(m)) setReleasesState('absent');
      else setReleasesState('error');
    }
  }, [api, isConnected, canUpdate]);

  const loadFollowing = useCallback(async () => {
    if (!canUpdate) { setFollowing(null); return; }
    try {
      const params = await Updates.getExtraParamsAsync();
      setFollowing(params?.['turtle-channel'] || Updates.channel || 'production');
    } catch { setFollowing(Updates.channel || 'production'); }
  }, [canUpdate]);

  useEffect(() => { loadReleases(); loadFollowing(); }, [loadReleases, loadFollowing]);

  const setPreview = useCallback(async (on) => {
    try {
      // Runtime state, outside the native fingerprint — the whole reason ONE
      // build can serve both channels. Sent with the next check.
      await Updates.setExtraParamAsync('turtle-channel', on ? 'preview' : null);
      setFollowing(on ? 'preview' : (Updates.channel || 'production'));
      check();
    } catch (e) { setError(describeUpdateError(e)); setPhase('error'); }
  }, [check]);

  const promote = useCallback(() => {
    const head = releases?.channels?.preview?.current;
    if (!head) return;
    Alert.alert('Promote to production?', `Everyone on production gets update ${shortId(head)} on their next check.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Promote', style: 'destructive', onPress: async () => {
        setReleaseBusy(true);
        try { await api.post('/mobile-updates/promote', { updateId: head, channel: 'production' }); }
        catch (e) { Alert.alert('Promote failed', describeUpdateError(e)); }
        finally { setReleaseBusy(false); loadReleases(); }
      } },
    ]);
  }, [releases, api, loadReleases]);

  const rollback = useCallback(() => {
    Alert.alert('Roll production back?', 'Production returns to the update it served before this one.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Roll back', style: 'destructive', onPress: async () => {
        setReleaseBusy(true);
        try { await api.post('/mobile-updates/rollback', { channel: 'production' }); }
        catch (e) { Alert.alert('Rollback failed', describeUpdateError(e)); }
        finally { setReleaseBusy(false); loadReleases(); }
      } },
    ]);
  }, [api, loadReleases]);

  const styles = makeStyles(theme);
  const appVersion = Constants.expoConfig?.version || '—';
  const buildNumber = Constants.expoConfig?.ios?.buildNumber || Constants.nativeBuildVersion || null;
  const runtime = Updates.runtimeVersion ? shortId(Updates.runtimeVersion) : '—';
  const channel = following || Updates.channel || (canUpdate ? 'production' : 'metro');
  const previewHead = releases?.channels?.preview?.current || null;
  const prodHead = releases?.channels?.production?.current || null;
  const canPromote = !!previewHead && previewHead !== '__embedded__' && previewHead !== prodHead;
  const canRollback = (releases?.channels?.production?.history?.length || 0) > 1;
  const showReleases = canUpdate && !!releases && releasesState === null;

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

      {showReleases ? (
        <View style={styles.releases}>
          <Text style={styles.colLabelStrong}>RELEASES · OWNER</Text>
          {['preview', 'production'].map((name) => {
            const ch = releases.channels?.[name];
            const head = ch?.head;
            return (
              <View key={name} style={styles.releaseRow}>
                <Text style={[styles.fact, styles.releaseName]}>{name}</Text>
                <Text style={styles.releaseHead} numberOfLines={1}>
                  {ch?.current === '__embedded__'
                    ? 'factory JavaScript (rolled back to embedded)'
                    : head
                      ? `${shortId(head.id)} · ${formatWhen(head.createdAt)}${head.provenance?.message ? ` · ${head.provenance.message}` : ''}`
                      : '— nothing published'}
                </Text>
              </View>
            );
          })}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: c.accentInfo, opacity: canPromote && !releaseBusy ? 1 : 0.5 }]}
              disabled={!canPromote || releaseBusy}
              onPress={() => { tapHaptic(); promote(); }}
              accessibilityRole="button"
              accessibilityLabel="Promote the preview update to production"
            >
              {releaseBusy ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="rocket-launch-outline" size={14} color="#fff" />}
              <Text style={styles.primaryBtnText}>Promote preview → production</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryBtn, { opacity: canRollback && !releaseBusy ? 1 : 0.5 }]}
              disabled={!canRollback || releaseBusy}
              onPress={() => { tapHaptic(); rollback(); }}
              accessibilityRole="button"
              accessibilityLabel="Roll production back one release"
            >
              <Icon name="undo-variant" size={14} color={c.textSecondary} />
              <Text style={styles.secondaryBtnText}>Roll back</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchLabel}>This phone follows preview</Text>
              <Text style={styles.buildDetail}>Prove a publish here first. Everyone else stays on production until you promote.</Text>
            </View>
            <Switch
              value={following === 'preview'}
              onValueChange={(v) => { tapHaptic(); setPreview(v); }}
              accessibilityLabel="Follow the preview channel on this phone"
            />
          </View>
          {!releases.signing ? (
            <Text style={styles.error}>The pond has no signing key — this build will refuse every update until KEYS_DIR has one.</Text>
          ) : null}
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
    releases: {
      marginTop: 12, paddingTop: 12, gap: 6,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
    },
    colLabelStrong: { fontSize: 10, letterSpacing: 0.6, color: c.textSecondary, fontWeight: '700', marginBottom: 2 },
    releaseRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    releaseName: { width: 78, color: c.textSecondary },
    releaseHead: { flex: 1, fontSize: 12, color: c.textPrimary },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
    switchLabel: { fontSize: 13, fontWeight: '600', color: c.textPrimary },
  });
};
