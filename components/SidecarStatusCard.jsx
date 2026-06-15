/**
 * SidecarStatusCard — live status + stats for the local AI inference
 * sidecar, surfaced in the phone app's Settings screen.
 *
 * The sidecar (inference-service/, a Python/Uvicorn process the Node
 * server auto-spawns) runs CLIP zero-shot labelling + OCR over every
 * image in the library. This card is the phone-side mirror of the web
 * app's UnderstandDatabasePanel — it polls GET /api/inference/status
 * and renders:
 *
 *   • a reachability dot (ready / loading models / offline),
 *   • library progress ("X / Y images understood"),
 *   • the live queue stats (in-flight + queued infer calls — the "log"),
 *   • the model / pipeline footer, and
 *   • Pause/Resume + "Run understanding" controls.
 *
 * Polling is gated on `active` (the Settings sheet being open) and on
 * the app being foregrounded, so we don't hammer the server's /status
 * endpoint — which logs a line per poll — for the whole app lifetime.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  AppState,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import { useServer } from '../context/ServerContext';

// Match the web panel's cadence. The server probes the sidecar's
// /health with a 2 s timeout on each call, so worst-case staleness is
// POLL_MS + 2 s.
const POLL_MS = 10_000;

// Thousand-separators without leaning on Intl — Hermes ships a trimmed
// Intl that doesn't reliably group digits in Number.toLocaleString.
const fmt = (n) => String(n ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export default function SidecarStatusCard({ active = true }) {
  const { theme } = useTheme();
  const { api, isConnected } = useServer();

  const [status, setStatus] = useState(null);
  const [settings, setSettings] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [appActive, setAppActive] = useState(true);

  const fetchStatus = useCallback(async () => {
    if (!isConnected) return;
    try {
      const data = await api.get('/inference/status');
      setStatus(data);
    } catch (e) {
      // Keep the last good snapshot — a transient miss shouldn't blank
      // the card. The dot only shows "checking…" until the first load.
    }
  }, [api, isConnected]);

  const fetchSettings = useCallback(async () => {
    if (!isConnected) return;
    try {
      const data = await api.get('/settings');
      setSettings(data.settings);
    } catch (e) {
      /* non-fatal — the Pause/Resume control just stays disabled */
    }
  }, [api, isConnected]);

  // Foreground/background tracking so polling pauses when the user
  // leaves the app.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub?.remove();
  }, []);

  const polling = active && isConnected && appActive;

  useEffect(() => {
    if (!polling) return;
    let alive = true;
    fetchStatus();
    fetchSettings();
    const id = setInterval(() => { if (alive) fetchStatus(); }, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [polling, fetchStatus, fetchSettings]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setErr(null);
    await Promise.all([fetchStatus(), fetchSettings()]);
    setRefreshing(false);
  }, [fetchStatus, fetchSettings]);

  // In-flight guard: `busy` is only set by runUnderstanding, so it can't gate
  // this toggle — without this ref a double-tap fires two racing PATCHes.
  const togglingRef = useRef(false);
  const toggleEnabled = useCallback(async () => {
    if (!settings || busy || togglingRef.current) return;
    togglingRef.current = true;
    const next = !settings.ai_inference_enabled;
    setSettings((s) => ({ ...s, ai_inference_enabled: next })); // optimistic
    setErr(null);
    try {
      await api.patch('/settings', { ai_inference_enabled: next });
      // Resuming with a backlog + a ready sidecar → kick the sweep too,
      // mirroring the web panel (flipping the flag alone doesn't start
      // a job — currentJob lives only in server memory).
      if (next && status?.sidecar?.ready && !status?.job && (status?.pending ?? 0) > 0) {
        try { await api.post('/inference/reprocess', {}); } catch (_) { /* poll recovers */ }
      }
      fetchStatus();
    } catch (e) {
      setSettings((s) => ({ ...s, ai_inference_enabled: !next })); // rollback
      setErr('Could not change the inference setting.');
    } finally {
      togglingRef.current = false;
    }
  }, [api, settings, busy, status, fetchStatus]);

  const runUnderstanding = useCallback(async () => {
    if (busy) return;
    if (!settings?.ai_inference_enabled) { setErr('Resume inference first.'); return; }
    if (!status?.sidecar?.ready) { setErr('Sidecar is not ready yet.'); return; }
    setBusy(true);
    setErr(null);
    try {
      const data = await api.post('/inference/reprocess', {});
      if (data && data.success === false) setErr(data.error || 'Could not start the run.');
      else if (data && data.total === 0) setErr(data.message || 'Everything is already up to date.');
      await fetchStatus();
    } catch (e) {
      setErr(String(e?.message || 'Run failed.'));
    } finally {
      setBusy(false);
    }
  }, [api, busy, settings, status, fetchStatus]);

  const styles = createStyles(theme);

  // ── Derived view-state ──────────────────────────────────────────
  const sidecar = status?.sidecar;
  const ready = !!sidecar?.ready;
  const reachable = !!sidecar?.reachable;
  const info = sidecar?.info;
  const queue = status?.queue;
  const job = status?.job;

  const dotColor = !isConnected
    ? theme.colors.textMuted
    : !status
      ? theme.colors.textTertiary
      : ready
        ? theme.colors.accentSuccess
        : reachable
          ? theme.colors.accentWarning
          : theme.colors.accentError;
  const dotLabel = !isConnected
    ? 'offline'
    : !status
      ? 'checking…'
      : ready
        ? 'ready'
        : reachable
          ? 'loading'
          : 'offline';

  const understood = status?.understoodCount ?? 0;
  const totalImages = status?.totalImages ?? 0;
  const pending = status?.pending ?? 0;
  const pct = totalImages > 0 ? Math.min(100, Math.round((understood / totalImages) * 100)) : 0;
  const enabled = !!settings?.ai_inference_enabled;
  const pipelineVersion = info?.pipeline_version || status?.pipelineVersion;
  const jobPct = job ? Math.round((job.processed / Math.max(1, job.total)) * 100) : 0;
  const runDisabled = busy || !ready || !enabled || pending === 0;

  const statCells = [
    { label: 'In-flight', value: fmt(queue?.inflightCount ?? 0) },
    { label: 'Queued', value: fmt(queue?.waitingCount ?? 0) },
    { label: 'Pending', value: fmt(pending) },
    { label: 'Pipeline', value: pipelineVersion ? `v${pipelineVersion}` : '—' },
  ];

  return (
    <View style={styles.section}>
      {/* Header: icon · title · status pill · refresh */}
      <View style={styles.headerRow}>
        <View style={styles.iconContainer}>
          <Icon name="brain" size={20} color={theme.colors.textPrimary} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.sectionTitle}>AI Sidecar</Text>
          <Text style={styles.subtitle}>Local image understanding</Text>
        </View>
        <View style={styles.statusPill}>
          <View style={[styles.dot, { backgroundColor: dotColor }]} />
          <Text style={styles.statusPillText}>{dotLabel}</Text>
        </View>
        <TouchableOpacity
          onPress={onRefresh}
          style={styles.refreshBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          disabled={refreshing}
          accessibilityLabel="Refresh sidecar status"
        >
          {refreshing
            ? <ActivityIndicator size="small" color={theme.colors.textTertiary} />
            : <Icon name="refresh" size={18} color={theme.colors.textTertiary} />}
        </TouchableOpacity>
      </View>

      {!isConnected ? (
        <Text style={styles.muted}>Connect to your server to view sidecar stats.</Text>
      ) : !status ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={theme.colors.textTertiary} />
          <Text style={styles.muted}>Fetching status…</Text>
        </View>
      ) : (
        <>
          {/* Library-wide progress: "X of Y images understood" */}
          {totalImages > 0 && (
            <View style={styles.block}>
              <View style={styles.blockHeaderRow}>
                <Icon name="star-four-points" size={14} color="#a777f5" />
                <Text style={styles.blockTitle}>
                  {fmt(understood)} / {fmt(totalImages)} understood
                  <Text style={styles.blockTitleMuted}>{`  (${pct}%)`}</Text>
                </Text>
              </View>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: '#a777f5' }]} />
              </View>
            </View>
          )}

          {/* Pause / Resume — the dominant control */}
          {settings && (
            <View
              style={[
                styles.stateRow,
                {
                  backgroundColor: enabled ? 'rgba(74,222,128,0.10)' : 'rgba(251,191,36,0.12)',
                  borderColor: (enabled ? theme.colors.accentSuccess : theme.colors.accentWarning) + '55',
                },
              ]}
            >
              <View style={styles.stateText}>
                <Text style={[styles.stateLabel, { color: enabled ? theme.colors.accentSuccess : theme.colors.accentWarning }]}>
                  {enabled ? '● Active' : '⏸ Paused'}
                </Text>
                <Text style={styles.stateDesc}>
                  {enabled
                    ? 'Labelling new files and sweeping the backlog while idle.'
                    : 'No new files are being labelled. Resume to start.'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={toggleEnabled}
                disabled={!settings || busy}
                style={[
                  styles.toggleBtn,
                  {
                    backgroundColor: enabled ? theme.colors.accentSuccess : theme.colors.accentWarning,
                    opacity: (!settings || busy) ? 0.5 : 1,
                  },
                ]}
              >
                <Icon name={enabled ? 'pause' : 'play'} size={14} color="#fff" />
                <Text style={styles.toggleBtnText}>{enabled ? 'Pause' : 'Resume'}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Pending + run, or live job progress */}
          <View style={styles.block}>
            <Text style={styles.blockTitle}>
              {job
                ? job.paused
                  ? `Paused · ${fmt(job.processed)} / ${fmt(job.total)}`
                  : `Understanding · ${fmt(job.processed)} / ${fmt(job.total)}`
                : pending > 0
                  ? `${fmt(pending)} image${pending === 1 ? '' : 's'} waiting to be understood`
                  : 'Everything is up to date'}
            </Text>
            {job ? (
              <>
                <View style={[styles.barTrack, { marginTop: 8 }]}>
                  <View
                    style={[
                      styles.barFill,
                      { width: `${jobPct}%`, backgroundColor: job.paused ? theme.colors.accentWarning : theme.colors.accentInfo },
                    ]}
                  />
                </View>
                {job.paused && (
                  <Text style={styles.pausedNote}>
                    Parked while the app is open — resumes once you step away.
                  </Text>
                )}
              </>
            ) : (
              <TouchableOpacity
                onPress={runUnderstanding}
                disabled={runDisabled}
                style={[styles.runBtn, { opacity: runDisabled ? 0.5 : 1 }]}
              >
                {busy
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Icon name="book-open-variant" size={14} color="#fff" />}
                <Text style={styles.runBtnText}>Run understanding</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Live stats grid — the at-a-glance "log" of sidecar activity */}
          <View style={styles.statsGrid}>
            {statCells.map((cell, i) => (
              <View key={cell.label} style={[styles.statCell, i > 0 && styles.statCellDivider]}>
                <Text style={styles.statValue} numberOfLines={1}>{cell.value}</Text>
                <Text style={styles.statLabel}>{cell.label}</Text>
              </View>
            ))}
          </View>

          {/* Endpoint */}
          {queue?.url ? (
            <Text style={styles.endpoint} numberOfLines={1}>{queue.url}</Text>
          ) : null}

          {/* Model + pipeline footer — confidence info when ready */}
          {ready && info && (
            <View style={styles.footerRow}>
              <Icon name="check-circle" size={12} color={theme.colors.accentSuccess} />
              <Text style={styles.footerText} numberOfLines={2}>
                {info.clip_model}
                {typeof info.label_count === 'number' ? ` · ${fmt(info.label_count)} labels` : ''}
                {Array.isArray(info.ocr_languages) && info.ocr_languages.length
                  ? ` · OCR ${info.ocr_languages.join(', ')}`
                  : ''}
                {typeof info.load_time_seconds === 'number' ? ` · loaded in ${info.load_time_seconds}s` : ''}
              </Text>
            </View>
          )}

          {err ? (
            <View style={styles.errBox}>
              <Icon name="alert-circle" size={13} color={theme.colors.accentError} />
              <Text style={styles.errText}>{err}</Text>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const createStyles = (theme) => StyleSheet.create({
  section: {
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: theme.colors.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: theme.colors.textTertiary,
    marginTop: 1,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginLeft: 8,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  refreshBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  muted: {
    fontSize: 13,
    color: theme.colors.textTertiary,
    marginTop: 12,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  block: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  blockHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  blockTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  blockTitleMuted: {
    fontSize: 12,
    fontWeight: '400',
    color: theme.colors.textTertiary,
  },
  barTrack: {
    marginTop: 8,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.colors.border,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  stateText: {
    flex: 1,
    minWidth: 0,
  },
  stateLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  stateDesc: {
    fontSize: 11.5,
    color: theme.colors.textSecondary,
    marginTop: 3,
    lineHeight: 16,
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  toggleBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  pausedNote: {
    fontSize: 11,
    color: theme.colors.accentWarning,
    marginTop: 6,
  },
  runBtn: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: theme.colors.accentInfo,
  },
  runBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  statsGrid: {
    flexDirection: 'row',
    marginTop: 12,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  statCell: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
  },
  statCellDivider: {
    borderLeftWidth: 0.5,
    borderLeftColor: theme.colors.border,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  statLabel: {
    fontSize: 10.5,
    color: theme.colors.textTertiary,
    marginTop: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  endpoint: {
    fontSize: 11,
    color: theme.colors.textMuted,
    marginTop: 8,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 8,
  },
  footerText: {
    flex: 1,
    fontSize: 11,
    color: theme.colors.textTertiary,
    lineHeight: 15,
  },
  errBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(248,113,113,0.12)',
  },
  errText: {
    flex: 1,
    fontSize: 12,
    color: theme.colors.accentError,
  },
});
