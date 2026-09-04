/**
 * PerfFindingsPanel — "Performance findings" under Server Connection.
 *
 * The app has been quietly measuring itself for a while now
 * (`services/perfTelemetry.js`: per-route API latency, blocked-JS-thread
 * stalls, cold starts) and posting the numbers to the pond. Until this panel
 * the only way to read any of it was to curl `/api/perf/summary` by hand. This
 * is the log those measurements were collected FOR: what has actually been
 * slow, over a window, worst first.
 *
 * Collapsed by default and fetched only when opened — the same bargain the
 * stats panel strikes, for the same reason: someone editing the server IP
 * should never pay for an aggregate query they didn't ask for.
 *
 * ─── Why the ranking looks "wrong" and is right ─────────────────────────────
 *
 * Rows are ordered by TOTAL TIME BURNED, not by how slow any single sample was,
 * so a 300 ms call made four hundred times sits above a 3 s call made twice.
 * That ordering is the server's (see routes/perf.js) and is preserved
 * deliberately: it is the order in which fixing things actually removes waiting
 * from the user's day. The dramatic-but-rare row is still visible — it just
 * isn't top of the list, and its p95 is right there saying so.
 *
 * ─── Colour ─────────────────────────────────────────────────────────────────
 *
 * Bars are all one colour and encode magnitude only, exactly as in
 * ServerStatsPanel — length is already carrying that information and shading
 * it too would spend the one free channel saying the same thing twice. Colour
 * appears in one place: a severity dot beside the title, and the p95 figure it
 * is derived from. That is a judgement the bar cannot make, since "slow"
 * depends on whether the row is a network round trip, a frozen gesture or a
 * cold launch — three different scales, all in the same list.
 *
 * Owner-only on the server, and a 403 removes the panel rather than showing an
 * error: a pond member is not missing a feature, this simply isn't theirs.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import { useServer } from '../context/ServerContext';
import { tapHaptic } from '../utils/haptics';
import { formatCount, formatMs, percentOf } from '../utils/statsFormat';
import { buildFailures, buildFindings } from '../utils/perfFindings';

// Matches the stats panel's bar geometry — the two sit in the same section and
// a second bar height would read as a second kind of thing.
const BAR_H = 8;
const BAR_RADIUS = 4;
const MIN_FILL_PCT = 1.5;

/**
 * The windows worth offering.
 *
 * A day answers "is it bad right now", a week is the default because it
 * survives one unlucky afternoon, and a month is where a slow regression shows
 * up as a shape rather than as noise. The server clamps to 60 days and prunes
 * at 60, so nothing longer would be honest.
 */
const WINDOWS = [
  { days: 1, label: '24h' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
];

const ICONS = {
  api: 'swap-vertical',
  stall: 'snowflake',
  launch: 'rocket-launch-outline',
  other: 'chart-line-variant',
};

/** One measured thing: what it is, how much of the waiting it accounts for,
 *  and the two percentiles that say whether it is slow or merely frequent. */
function FindingRow({ finding, max, tint, track, icon, colorFor, styles }) {
  const pct = max > 0 ? Math.max(MIN_FILL_PCT, (finding.totalMs / max) * 100) : 0;
  const severityColor = colorFor(finding.severity);
  return (
    <View style={styles.finding}>
      <View style={styles.findingHead}>
        {/* A muted TEXT colour, not the bar's track tone — the track is a
            background wash and an icon drawn in it disappears. */}
        <Icon name={ICONS[finding.kind] || ICONS.other} size={14} color={icon} />
        <Text style={styles.findingTitle} numberOfLines={1}>{finding.title}</Text>
        {finding.severity !== 'ok' && (
          <View style={[styles.severityDot, { backgroundColor: severityColor }]} />
        )}
        <Text style={styles.findingTotal} numberOfLines={1}>{formatMs(finding.totalMs)}</Text>
      </View>

      <View style={[styles.barTrack, { backgroundColor: track }]}>
        <View style={[styles.barFill, { width: `${Math.min(100, pct)}%`, backgroundColor: tint }]} />
      </View>

      {/* "typical" and "worst" rather than p50 and p95: the percentile names are
          precise and mean nothing to most people reading their own phone. */}
      <Text style={styles.findingMeta} numberOfLines={1}>
        {formatCount(finding.count)} × · typical {formatMs(finding.p50)} · worst{' '}
        <Text style={{ color: severityColor, fontWeight: '700' }}>{formatMs(finding.p95)}</Text>
        {/* Slow AND broken. The failures list above ranks these properly, but
            without a mark here the row reads as merely sluggish to anyone who
            didn't scroll back up. */}
        {finding.failed > 0 && (
          <Text style={{ color: colorFor('bad'), fontWeight: '700' }}>
            {' '}· {formatCount(finding.failed)} failed
          </Text>
        )}
      </Text>
    </View>
  );
}

/**
 * One route that is not working.
 *
 * No bar: a bar would encode failure COUNT as length, and length next to the
 * magnitude bars below would invite reading the two lists on one scale, which
 * they are not on. The two numbers that matter here are how many times it broke
 * and what fraction of its attempts that was — "18 failed / 100% of 18" is a
 * route that is simply down, "18 failed / 4% of 430" is one that is flaky, and
 * the fix is different in each case.
 */
function FailureRow({ failure, color, styles }) {
  return (
    <View style={styles.failure}>
      <View style={styles.findingHead}>
        <View style={[styles.severityDot, { backgroundColor: color }]} />
        <Text style={styles.findingTitle} numberOfLines={1}>{failure.title}</Text>
        <Text style={[styles.findingTotal, { color }]} numberOfLines={1}>
          {formatCount(failure.failed)} failed
        </Text>
      </View>
      <Text style={styles.findingMeta} numberOfLines={2}>
        {percentOf(failure.failed, failure.count) ?? 0}% of {formatCount(failure.count)}
        {failure.reasons.map((r) => ` · ${r.label} ×${formatCount(r.count)}`).join('')}
      </Text>
    </View>
  );
}

export default function PerfFindingsPanel() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { api, isConnected } = useServer();

  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  // Same three outcomes as the stats panel, two of which are not errors:
  // 'forbidden' (not the owner) and 'absent' (a pond deployed before telemetry
  // existed — a phone updates from the store, a pond when someone deploys it).
  const [status, setStatus] = useState(null);

  const load = useCallback(async (window) => {
    setLoading(true);
    try {
      const r = await api.get(`/perf/summary?days=${window}`);
      if (r?.success) { setData(r); setStatus(null); }
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

  // Opening loads the current window, and changing the window reloads — one
  // effect, because "which window is showing while open" is the whole input.
  //
  // Deliberately re-fetches on every open rather than keeping the first answer
  // the way the stats panel does: a database's size is the same number a minute
  // later, but this is a log of what just happened, and a stale one is worse
  // than a spinner. The query is a single indexed range scan, so it is cheap
  // enough to mean it.
  useEffect(() => { if (open && isConnected) load(days); }, [open, days, isConnected, load]);

  const styles = makeStyles(theme);
  const tint = c.accent || c.accentInfo;
  const track = c.surfaceHighlight || c.border;

  const colorFor = useCallback((severity) => (
    severity === 'bad' ? (c.accentError || '#F87171')
      : severity === 'warn' ? (c.accentWarning || '#FBBF24')
        : c.textSecondary
  ), [c]);

  if (status === 'forbidden' || status === 'absent') return null;
  if (!isConnected) return null;

  const { findings, totalMs, hiddenCount } = buildFindings(data?.pitfalls);
  const { failures, totalFailed, hiddenCount: hiddenFailures } = buildFailures(data?.pitfalls);
  const barMax = findings.reduce((m, f) => Math.max(m, f.totalMs), 0);
  const worst = findings.find((f) => f.severity === 'bad') || findings.find((f) => f.severity === 'warn');
  const badColor = colorFor('bad');

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        onPress={() => { tapHaptic(); setOpen((v) => !v); }}
        style={styles.discloseRow}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Performance findings from the app's own measurements"
      >
        <Icon name="speedometer" size={18} color={tint} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.discloseTitle}>Performance findings</Text>
          <Text
            style={[styles.discloseSub, failures.length > 0 && { color: badColor }]}
            numberOfLines={1}
          >
            {/* Before it is opened this is the only summary there is, so it
                names the worst single thing rather than a count of things —
                and a request that FAILED outranks one that was merely slow,
                which is the whole reason failures are surfaced separately. */}
            {failures.length > 0
              ? `${formatCount(totalFailed)} failed · ${failures[0].title}`
              : worst ? `Worst: ${worst.title} · ${formatMs(worst.p95)}`
                : 'What the app has measured as slow'}
          </Text>
        </View>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={22} color={c.textTertiary} />
      </TouchableOpacity>

      {open && (
        <View style={styles.body}>
          <View style={styles.windowRow}>
            {WINDOWS.map((w) => {
              const selected = w.days === days;
              return (
                <TouchableOpacity
                  key={w.days}
                  onPress={() => { tapHaptic(); setDays(w.days); }}
                  style={[styles.windowChip, selected && { backgroundColor: track, borderColor: track }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Show the last ${w.label}`}
                >
                  <Text style={[styles.windowChipText, selected && styles.windowChipTextOn]}>{w.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {loading && !data && (
            <View style={styles.centre}><ActivityIndicator color={c.textSecondary} /></View>
          )}

          {status === 'error' && !data && (
            <View style={styles.centre}>
              <Text style={styles.dim}>Couldn’t read the performance log.</Text>
              <TouchableOpacity onPress={() => { tapHaptic(); load(days); }} style={styles.retry}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Not working ──
              First, above the hero, and in the error colour: this is the only
              part of the log that says something is BROKEN rather than slow,
              and a broken route buried under a latency table is a broken route
              nobody finds. It is also the one section that ranks by failure
              count, because time burned is meaningless for a request that
              fails instantly. */}
          {failures.length > 0 && (
            <>
              <View style={styles.failureHead}>
                <Icon name="alert-circle-outline" size={15} color={badColor} />
                <Text style={[styles.sectionLabel, styles.failureLabel, { color: badColor }]}>
                  Not working
                </Text>
              </View>
              <Text style={styles.failureSummary}>
                {formatCount(totalFailed)} of {formatCount(data.samples)} requests
                failed{failures.length > 1 ? ` across ${formatCount(failures.length)} routes` : ''}.
              </Text>
              {failures.map((f) => (
                <FailureRow key={f.key} failure={f} color={badColor} styles={styles} />
              ))}
              {hiddenFailures > 0 && (
                <Text style={styles.footnote}>
                  {formatCount(hiddenFailures)} more failing{' '}
                  {hiddenFailures === 1 ? 'route is' : 'routes are'} not shown.
                </Text>
              )}
            </>
          )}

          {!!data && findings.length === 0 && (
            <View style={styles.centre}>
              <Text style={styles.dim}>
                Nothing measured in this window yet. The app reports in the
                background about once a minute, and only while you’re using it.
              </Text>
            </View>
          )}

          {findings.length > 0 && (
            <>
              {/* The headline is total WAITING, not the sample count: it is the
                  figure that shrinks when something here gets fixed. */}
              <View style={styles.heroBlock}>
                <Text style={styles.hero}>{formatMs(totalMs)}</Text>
                <Text style={styles.heroSub} numberOfLines={1}>
                  spent waiting · {formatCount(data.samples)} measurements
                </Text>
              </View>

              {/* Named explicitly once there is a section above it, so the two
                  lists cannot be read as one continuous ranking — they are
                  ordered by different things on purpose. */}
              {failures.length > 0 && (
                <Text style={styles.sectionLabel}>Where the time goes</Text>
              )}

              {findings.map((f) => (
                <FindingRow
                  key={f.key}
                  finding={f}
                  max={barMax}
                  tint={tint}
                  track={track}
                  icon={c.textTertiary}
                  colorFor={colorFor}
                  styles={styles}
                />
              ))}

              <Text style={styles.footnote}>
                Ranked by total time burned, so something quick that happens
                constantly outranks something slow that hardly ever does.
                {hiddenCount > 0 ? ` ${formatCount(hiddenCount)} smaller ${hiddenCount === 1 ? 'entry is' : 'entries are'} not shown.` : ''}
                {data.capped ? ' The window held more samples than the server aggregates at once, so this covers the most recent of them.' : ''}
              </Text>

              {/* Where the numbers came from. Without this the panel looks like
                  the server's opinion of itself rather than this phone's
                  measurements of using it. */}
              <Text style={styles.footnote}>
                Measured on the phone, not the server: API rows are full round
                trips including the network, and everything is discarded after 60
                days.
              </Text>
            </>
          )}

          {!!data && (
            <TouchableOpacity
              onPress={() => { tapHaptic(); load(days); }}
              style={styles.refresh}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Refresh performance findings"
            >
              {loading
                ? <ActivityIndicator size="small" color={c.textSecondary} />
                : <Icon name="refresh" size={15} color={c.textSecondary} />}
              <Text style={styles.refreshText}>
                {loading ? 'Reading…' : `Last ${data.days === 1 ? '24 hours' : `${data.days} days`}`}
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
    centre: { alignItems: 'center', paddingVertical: 24, gap: 12, paddingHorizontal: 12 },
    dim: { fontSize: 13, color: c.textTertiary, textAlign: 'center', lineHeight: 19 },
    retry: {
      paddingHorizontal: 16, paddingVertical: 7, borderRadius: 9,
      backgroundColor: c.surfaceElevated, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    },
    retryText: { color: c.textPrimary, fontWeight: '600', fontSize: 13 },

    windowRow: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
    windowChip: {
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    },
    windowChipText: { fontSize: 12, fontWeight: '600', color: c.textTertiary },
    windowChipTextOn: { color: c.textPrimary },

    // Same type treatment as the stats panel's section labels — these two
    // panels stack in one Settings section and must read as one surface.
    sectionLabel: {
      fontSize: 11, fontWeight: '700', letterSpacing: 0.5,
      color: c.textTertiary, textTransform: 'uppercase',
      marginTop: 18, marginBottom: 8,
    },

    // Carries the top margin the label gave up when it moved into this row.
    failureHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
    // The label's own margins already space the block; inside a row they would
    // push the icon out of alignment with it.
    failureLabel: { marginTop: 0, marginBottom: 0 },
    failureSummary: { fontSize: 12, color: c.textSecondary, marginTop: 6, marginBottom: 12, lineHeight: 17 },
    failure: { marginBottom: 12, gap: 5 },

    heroBlock: { alignItems: 'center', paddingTop: 12, paddingBottom: 16 },
    hero: { fontSize: 34, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.8 },
    heroSub: { fontSize: 12, color: c.textTertiary, marginTop: 2 },

    finding: { marginBottom: 14, gap: 6 },
    findingHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    findingTitle: { flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: '600', color: c.textPrimary },
    severityDot: { width: 6, height: 6, borderRadius: 3 },
    findingTotal: {
      fontSize: 12, fontWeight: '700', color: c.textSecondary,
      fontVariant: ['tabular-nums'],
    },
    findingMeta: { fontSize: 10.5, color: c.textMuted, fontVariant: ['tabular-nums'] },

    barTrack: { height: BAR_H, borderRadius: BAR_RADIUS, overflow: 'hidden' },
    barFill: {
      height: '100%',
      borderTopRightRadius: BAR_RADIUS,
      borderBottomRightRadius: BAR_RADIUS,
    },

    footnote: { fontSize: 11, color: c.textMuted, lineHeight: 16, marginTop: 8 },

    refresh: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
      marginTop: 18, paddingVertical: 9,
    },
    refreshText: { fontSize: 11.5, color: c.textSecondary },
  });
};
