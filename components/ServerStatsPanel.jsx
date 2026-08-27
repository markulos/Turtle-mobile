/**
 * ServerStatsPanel — "More info" under Server Connection.
 *
 * Settings could tell you the app was CONNECTED to a database and nothing else
 * about it. This is the rest of the sentence: how big that database is, what is
 * inside it, what it is a catalogue of, and how much room is left.
 *
 * Collapsed by default. Nothing is fetched until it is opened, so the common
 * case — someone editing the server IP — costs a 500 ms query on the server
 * exactly never.
 *
 * ─── Why it is shaped the way it is ─────────────────────────────────────────
 *
 * The size breakdown is a TABLE WITH AN INLINE BAR, not a pie or a stacked bar.
 * There are a dozen B-trees with no natural order and names only SQLite loves;
 * part-to-whole at a glance is not the job — "which one is enormous, and by how
 * much" is, and that is magnitude, which is a bar.
 *
 * Every bar is the SAME colour. Shading them darker-where-bigger would encode
 * length twice and spend the one free channel on information the bar already
 * carries. The single exception is the unused-pages row, which is drawn in the
 * de-emphasis grey because it is the one row that is not data — that contrast
 * IS the point of showing it.
 *
 * Numbers wear text colours, never the bar's colour. Identity comes from the
 * mark beside the text.
 *
 * Owner-only on the server, and a 403 collapses the whole panel rather than
 * showing an error — a pond member is not missing a feature, this simply isn't
 * theirs, the same way the invite desk hides itself.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import { useServer } from '../context/ServerContext';
import { tapHaptic } from '../utils/haptics';
import {
  formatAgo,
  formatBytes,
  formatCount,
  formatDuration,
  formatMonthYear,
  percentOf,
  precisePercentOf,
  btreeKindLabel,
} from '../utils/statsFormat';

// Bar geometry. Thin — the data is the loud thing, not the chrome — with the
// growing end rounded and the baseline end square, so the bar visibly starts
// from a common origin rather than floating.
const BAR_H = 8;
const BAR_RADIUS = 4;
// Below this a fill is a sliver that reads as a rendering artefact; it gets a
// visible stub instead so a tiny-but-present value never looks like zero.
const MIN_FILL_PCT = 1.5;

// Disk pressure. A meter's fill carries severity; these are where it turns.
const DISK_WARN_PCT = 80;
const DISK_CRITICAL_PCT = 92;

/** #RRGGBB → rgba at an alpha. Anything else (already-rgba theme tokens) comes
 *  back untouched, so this can never produce an invalid colour string. */
const withAlpha = (color, alpha) => {
  const hex = /^#([0-9a-f]{6})$/i.exec(String(color || ''));
  if (!hex) return color;
  const int = parseInt(hex[1], 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
};

/** One figure and its name. The form for a headline number is a number. */
function Stat({ label, value, sub, styles }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>{label}</Text>
      {!!sub && <Text style={styles.statSub} numberOfLines={1}>{sub}</Text>}
    </View>
  );
}

/** A row of the size table: name, magnitude bar, value. */
function BarRow({ label, kind, bytes, max, tint, track, muted, styles }) {
  const pct = max > 0 ? Math.max(MIN_FILL_PCT, (bytes / max) * 100) : 0;
  return (
    <View style={styles.barRow}>
      <View style={styles.barLabelCol}>
        <Text style={styles.barLabel} numberOfLines={1}>{label}</Text>
        {!!kind && <Text style={styles.barKind}>{kind}</Text>}
      </View>
      <View style={[styles.barTrack, { backgroundColor: track }]}>
        <View style={[styles.barFill, { width: `${Math.min(100, pct)}%`, backgroundColor: muted ? track : tint }]} />
      </View>
      <Text style={styles.barValue} numberOfLines={1}>{formatBytes(bytes)}</Text>
    </View>
  );
}

/** A single ratio against a limit. The track is a wash of the fill's own colour
 *  so the state reads across the whole bar, not just the filled part. */
function Meter({ caption, detail, pct, color, styles }) {
  return (
    <View style={styles.meterBlock}>
      <View style={styles.meterHead}>
        <Text style={styles.meterCaption} numberOfLines={1}>{caption}</Text>
        {!!detail && <Text style={styles.meterDetail} numberOfLines={1}>{detail}</Text>}
      </View>
      <View style={[styles.barTrack, { backgroundColor: withAlpha(color, 0.18) }]}>
        <View style={[styles.barFill, { width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function Row({ label, value, styles, warn }) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel} numberOfLines={1}>{label}</Text>
      <Text style={[styles.kvValue, warn && styles.kvValueWarn]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

export default function ServerStatsPanel() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { api, isConnected } = useServer();

  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  // Two of the three outcomes here are not errors:
  //   'forbidden' — this pond member simply isn't the owner;
  //   'absent'    — the server predates this endpoint (a phone updates from the
  //                 App Store, a pond updates when someone deploys it, and the
  //                 two are never in step).
  // Both remove the panel outright. Only a real failure gets a Retry.
  const [status, setStatus] = useState(null);

  const load = useCallback(async ({ fresh } = {}) => {
    setLoading(true);
    try {
      const r = await api.get(`/server-stats${fresh ? '?fresh=1' : ''}`);
      if (r?.success) { setStats(r); setStatus(null); }
      else setStatus('error');
    } catch (e) {
      const message = String(e?.message);
      if (/403|forbidden|owner/i.test(message)) setStatus('forbidden');
      else if (/404|not found/i.test(message)) setStatus('absent');
      else setStatus('error');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { if (open && !stats && isConnected) load(); }, [open, stats, isConnected, load]);

  const styles = makeStyles(theme);
  const tint = c.accent || c.accentInfo;

  if (status === 'forbidden' || status === 'absent') return null;
  if (!isConnected) return null;

  const db = stats?.database;
  const lib = stats?.library;
  const disk = stats?.disk;
  const backups = stats?.backups;

  // Every B-tree the server named, plus the two rows that make the parts add up
  // to the whole: what the top-N didn't name, and the pages that hold nothing.
  const breakdown = db?.breakdown?.available ? db.breakdown.entries : [];
  const barMax = breakdown.reduce((m, e) => Math.max(m, e.bytes), db?.reclaimableBytes || 0);

  const diskUsedPct = disk ? percentOf(disk.usedBytes, disk.totalBytes) : null;
  const diskColor = diskUsedPct == null ? tint
    : diskUsedPct >= DISK_CRITICAL_PCT ? (c.accentError || '#F87171')
      : diskUsedPct >= DISK_WARN_PCT ? (c.accentWarning || '#FBBF24')
        : tint;

  const understoodPct = lib && lib.understood != null
    ? precisePercentOf(lib.understood, lib.items)
    : null;

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        onPress={() => { tapHaptic(); setOpen((v) => !v); }}
        style={styles.discloseRow}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="More info about the database"
      >
        <Icon name="database-outline" size={18} color={tint} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.discloseTitle}>More info</Text>
          <Text style={styles.discloseSub} numberOfLines={1}>
            {db ? `${formatBytes(db.totalBytes)} database · ${formatCount(lib?.items)} items indexed`
              : 'Database size, contents and disk space'}
          </Text>
        </View>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={22} color={c.textTertiary} />
      </TouchableOpacity>

      {open && (
        <View style={styles.body}>
          {loading && !stats && (
            <View style={styles.centre}><ActivityIndicator color={c.textSecondary} /></View>
          )}

          {status === 'error' && !stats && (
            <View style={styles.centre}>
              <Text style={styles.dim}>Couldn’t read the server’s stats.</Text>
              <TouchableOpacity onPress={() => { tapHaptic(); load({ fresh: true }); }} style={styles.retry}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {!!db && (
            <>
              {/* ── The headline: what the database occupies, all files ── */}
              <View style={styles.heroBlock}>
                <Text style={styles.hero}>{formatBytes(db.totalBytes)}</Text>
                <Text style={styles.heroSub} numberOfLines={1}>
                  on disk · {db.name}
                </Text>
              </View>

              <View style={styles.statRow}>
                <Stat styles={styles} label="Database file" value={formatBytes(db.fileBytes)} />
                {/* The WAL is not a detail. In this journal mode it is a second
                    file of comparable size holding pages not yet folded back
                    in, and a size that omitted it would be wrong by half. */}
                <Stat styles={styles} label="Write-ahead log" value={formatBytes(db.walBytes)} />
                <Stat
                  styles={styles}
                  label="Reclaimable"
                  value={formatBytes(db.reclaimableBytes)}
                  sub={`${formatCount(db.freePages)} free pages`}
                />
              </View>

              {breakdown.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>What’s inside</Text>
                  {breakdown.map((entry) => (
                    <BarRow
                      key={entry.name}
                      styles={styles}
                      label={entry.name}
                      kind={entry.rows != null
                        ? `${btreeKindLabel(entry.name, entry.kind)} · ${formatCount(entry.rows)} rows`
                        : btreeKindLabel(entry.name, entry.kind)}
                      bytes={entry.bytes}
                      max={barMax}
                      tint={tint}
                      track={c.surfaceHighlight || c.border}
                    />
                  ))}
                  {db.breakdown.otherBytes > 0 && (
                    <BarRow
                      styles={styles}
                      label="Everything else"
                      kind={`${formatCount(Math.max(0, db.tableCount + db.indexCount - breakdown.length))} smaller tables and indexes`}
                      bytes={db.breakdown.otherBytes}
                      max={barMax}
                      tint={tint}
                      track={c.surfaceHighlight || c.border}
                    />
                  )}
                  {db.reclaimableBytes > 0 && (
                    <BarRow
                      styles={styles}
                      label="Unused"
                      kind="freed rows a VACUUM would return"
                      bytes={db.reclaimableBytes}
                      max={barMax}
                      tint={tint}
                      track={c.surfaceHighlight || c.border}
                      muted
                    />
                  )}
                  <Text style={styles.footnote}>
                    These add up to the {formatBytes(db.fileBytes)} database file. The
                    write-ahead log is separate.
                  </Text>
                </>
              )}

              <Text style={styles.sectionLabel}>Engine</Text>
              <Row styles={styles} label="Pages" value={`${formatCount(db.pageCount)} × ${formatBytes(db.pageSize)}`} />
              <Row styles={styles} label="Schema" value={`${formatCount(db.tableCount)} tables · ${formatCount(db.indexCount)} indexes`} />
              <Row styles={styles} label="Journal mode" value={String(db.journalMode || '—').toUpperCase()} />
              <Row styles={styles} label="SQLite" value={db.sqliteVersion || '—'} />
              <Row styles={styles} label="File" value={db.path} />
            </>
          )}

          {!!lib && (
            <>
              <Text style={styles.sectionLabel}>The library it indexes</Text>
              <View style={styles.statRow}>
                <Stat styles={styles} label="Items catalogued" value={formatCount(lib.items)} />
                <Stat styles={styles} label="Originals on disk" value={formatBytes(lib.originalBytes)} />
                <Stat
                  styles={styles}
                  label="Index overhead"
                  value={db && lib.originalBytes > 0
                    ? `${(db.totalBytes / lib.originalBytes * 100).toFixed(2)}%`
                    : '—'}
                  sub="database ÷ library"
                />
              </View>
              {understoodPct != null && (
                <Meter
                  styles={styles}
                  color={tint}
                  pct={understoodPct}
                  caption={`${formatCount(lib.understood)} of ${formatCount(lib.items)} understood`}
                  detail={`${understoodPct}%`}
                />
              )}
              {lib.embeddingBytes != null && lib.embeddingBytes > 0 && (
                <Text style={styles.footnote}>
                  {formatBytes(lib.embeddingBytes)} of that database is AI embedding
                  vectors{db && db.fileBytes > 0 ? ` — ${percentOf(lib.embeddingBytes, db.fileBytes)}% of the file` : ''}
                  {lib.ocrBytes ? `, plus ${formatBytes(lib.ocrBytes)} of scanned text` : ''}.
                </Text>
              )}
              {!!(lib.oldest && lib.newest) && (
                <Row
                  styles={styles}
                  label="Spans"
                  value={`${formatMonthYear(lib.oldest)} → ${formatMonthYear(lib.newest)}`}
                />
              )}
            </>
          )}

          {!!stats?.records?.length && (
            <>
              <Text style={styles.sectionLabel}>Records</Text>
              <View style={styles.chipWrap}>
                {stats.records.map((r) => (
                  <View key={r.table} style={styles.chip}>
                    <Text style={styles.chipValue}>{formatCount(r.rows)}</Text>
                    <Text style={styles.chipLabel} numberOfLines={1}>{r.label}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {!!backups && (
            <>
              <Text style={styles.sectionLabel}>Backups</Text>
              {backups.exists && backups.count > 0 ? (
                <>
                  <Row styles={styles} label="Snapshots" value={`${formatCount(backups.count)} · ${formatBytes(backups.totalBytes)}`} />
                  <Row styles={styles} label="Newest" value={formatAgo(backups.newestAt) || '—'} />
                  {backups.onSameVolumeAsDatabase && (
                    <View style={styles.warnRow}>
                      <Icon name="alert-outline" size={15} color={c.accentWarning || '#FBBF24'} />
                      <Text style={styles.warnText}>
                        On the same drive as the database — a disk failure takes both.
                      </Text>
                    </View>
                  )}
                </>
              ) : (
                <Text style={styles.dim}>No backups on this server yet.</Text>
              )}
            </>
          )}

          {!!disk && diskUsedPct != null && (
            <>
              <Text style={styles.sectionLabel}>Disk</Text>
              <Meter
                styles={styles}
                color={diskColor}
                pct={diskUsedPct}
                caption={`${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)}`}
                detail={`${diskUsedPct}% used`}
              />
            </>
          )}

          {!!stats?.process && (
            <>
              <Text style={styles.sectionLabel}>Server</Text>
              <Row styles={styles} label="Uptime" value={formatDuration(stats.process.uptimeSec)} />
              <Row styles={styles} label="Memory" value={formatBytes(stats.process.rssBytes)} />
              <Row styles={styles} label="Runtime" value={`Node ${stats.process.nodeVersion} · ${stats.process.platform}`} />
            </>
          )}

          {!!stats && (
            <TouchableOpacity
              onPress={() => { tapHaptic(); load({ fresh: true }); }}
              style={styles.refresh}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Refresh server stats"
            >
              {loading
                ? <ActivityIndicator size="small" color={c.textSecondary} />
                : <Icon name="refresh" size={15} color={c.textSecondary} />}
              <Text style={styles.refreshText}>
                {loading ? 'Reading…' : `Measured ${formatAgo(stats.generatedAt) || 'just now'}`}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const makeStyles = (theme) => {
  const c = theme.colors;
  return StyleSheet.create({
    wrap: {
      marginTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    discloseRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingVertical: 14,
    },
    discloseTitle: { fontSize: 15, fontWeight: '600', color: c.textPrimary },
    discloseSub: { fontSize: 12, color: c.textTertiary, marginTop: 1 },
    body: { paddingBottom: 8 },
    centre: { alignItems: 'center', paddingVertical: 24, gap: 12 },
    dim: { fontSize: 13, color: c.textTertiary, textAlign: 'center' },
    retry: {
      paddingHorizontal: 16, paddingVertical: 7, borderRadius: 9,
      backgroundColor: c.surfaceElevated, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    },
    retryText: { color: c.textPrimary, fontWeight: '600', fontSize: 13 },

    // Proportional figures, not tabular: at this size tabular digits make a
    // number look loose. The COLUMNS below get tabular instead.
    heroBlock: { alignItems: 'center', paddingTop: 4, paddingBottom: 16 },
    hero: { fontSize: 34, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.8 },
    heroSub: { fontSize: 12, color: c.textTertiary, marginTop: 2 },

    statRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
    stat: {
      flex: 1, minWidth: 0,
      paddingVertical: 10, paddingHorizontal: 10,
      borderRadius: 12,
      backgroundColor: c.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    },
    statValue: { fontSize: 15, fontWeight: '700', color: c.textPrimary },
    statLabel: { fontSize: 10.5, color: c.textTertiary, marginTop: 2 },
    statSub: { fontSize: 9.5, color: c.textMuted, marginTop: 1 },

    sectionLabel: {
      fontSize: 11, fontWeight: '700', letterSpacing: 0.5,
      color: c.textTertiary, textTransform: 'uppercase',
      marginTop: 18, marginBottom: 8,
    },

    barRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 9 },
    barLabelCol: { width: '34%', minWidth: 0 },
    barLabel: { fontSize: 12, fontWeight: '600', color: c.textPrimary },
    barKind: { fontSize: 9.5, color: c.textMuted, marginTop: 1 },
    barTrack: { flex: 1, height: BAR_H, borderRadius: BAR_RADIUS, overflow: 'hidden' },
    // Square at the baseline, rounded at the growing end — the bar reads as
    // coming FROM somewhere rather than floating.
    barFill: {
      height: '100%',
      borderTopRightRadius: BAR_RADIUS,
      borderBottomRightRadius: BAR_RADIUS,
    },
    barValue: {
      width: 62, textAlign: 'right',
      fontSize: 11.5, fontWeight: '600', color: c.textSecondary,
      fontVariant: ['tabular-nums'],
    },

    meterBlock: { marginBottom: 10, gap: 6 },
    meterHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
    meterCaption: { fontSize: 12.5, color: c.textSecondary, flexShrink: 1 },
    meterDetail: { fontSize: 12.5, fontWeight: '700', color: c.textPrimary, fontVariant: ['tabular-nums'] },

    kvRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      gap: 14, paddingVertical: 6,
    },
    kvLabel: { fontSize: 12.5, color: c.textTertiary },
    kvValue: {
      flexShrink: 1, textAlign: 'right',
      fontSize: 12.5, fontWeight: '600', color: c.textSecondary,
    },
    kvValueWarn: { color: c.accentWarning || '#FBBF24' },

    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingVertical: 8, paddingHorizontal: 11, borderRadius: 11,
      backgroundColor: c.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
      minWidth: 92, flexGrow: 1,
    },
    chipValue: { fontSize: 14, fontWeight: '700', color: c.textPrimary },
    chipLabel: { fontSize: 10.5, color: c.textTertiary, marginTop: 1 },

    warnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingVertical: 6 },
    warnText: { flex: 1, fontSize: 11.5, color: c.textTertiary, lineHeight: 16 },

    footnote: { fontSize: 11, color: c.textMuted, lineHeight: 16, marginTop: 4 },

    refresh: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
      marginTop: 18, paddingVertical: 9,
    },
    refreshText: { fontSize: 11.5, color: c.textSecondary },
  });
};
