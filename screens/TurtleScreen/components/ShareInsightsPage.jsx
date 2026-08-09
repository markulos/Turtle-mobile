/**
 * ShareInsightsPage — "who has opened this board?"
 *
 * The full read-out behind a board card's SHARED badge: every public link on
 * the board, how much traffic each has pulled, a 30-day opens chart, where the
 * visitors came from, what they used, and the raw event log.
 *
 * Honest by construction: public links are anonymous capabilities, so there is
 * no identity to report and the copy never implies one. What the server can
 * truthfully say is when, from what kind of address (or a city, only when the
 * operator has turned geo lookups on), which client, and whether the hit
 * looked like a link-preview bot rather than a person. Bots are counted apart
 * from people everywhere on this page — an unfurler fetching the link is not a
 * visit, and mixing them would inflate every number here.
 *
 * Rendered as an EdgeSwipePage in OVERLAY mode: the vault already lives inside
 * a Modal and iOS will not present a second sibling Modal over an open one
 * (see memory: ios-nested-pagesheet-modal-gotcha).
 *
 * CHROME RULE: the floating tab dock paints over this in-tree page, so the
 * scroll content ends with `bottomInset` of clearance and no pinned control
 * sits under the dock.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, Share,
  StyleSheet, Text, View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import EdgeSwipePage from './EdgeSwipePage';
import { notifyHaptic, tapHaptic } from '../../../utils/haptics';

const DAY_MS = 86400000;
const CHART_DAYS = 30;
// One request per link. 500 is the server's ceiling; the chart and the
// breakdowns are computed from whatever comes back, and the page says so when
// the log is truncated rather than silently drawing a partial history.
const VISIT_LIMIT = 500;

const EVENT_LABEL = {
  view: 'Opened',
  unlock_ok: 'Unlocked',
  unlock_fail: 'Wrong password',
  download: 'Downloaded',
};
const EVENT_ICON = {
  view: 'eye-outline',
  unlock_ok: 'lock-open-variant-outline',
  unlock_fail: 'lock-alert-outline',
  download: 'tray-arrow-down',
};

const isDead = (s) => !!s.revokedAt || !!(s.expiresAt && s.expiresAt < Date.now());

const withAlpha = (color, hexAlpha) => (
  typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color + hexAlpha : undefined
);

/** "just now" / "14m ago" / "3h ago" / "Aug 6" — a glanceable age, not a date. */
export function whenLabel(ts, now = Date.now()) {
  if (!ts) return 'never';
  const mins = Math.floor((now - ts) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h ago`;
  if (mins < 60 * 24 * 7) return `${Math.floor(mins / 1440)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Roll the raw event log up into everything the page draws.
 *
 * Exported and pure so the arithmetic is testable without a server: the counts
 * shown here are the whole point of the page, and a quietly wrong denominator
 * (bots folded into "people", say) would be invisible in a screenshot.
 */
export function summarizeVisits(visits = [], now = Date.now()) {
  const people = visits.filter((v) => !v.isBot);
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const days = Array.from({ length: CHART_DAYS }, (_, i) => ({
    ts: startOfToday - (CHART_DAYS - 1 - i) * DAY_MS,
    opens: 0,
  }));

  const places = new Map();
  const clients = new Map();
  const visitorIps = new Set();
  let opens = 0;
  let downloads = 0;
  let failedUnlocks = 0;
  let last7 = 0;
  let prev7 = 0;

  for (const v of people) {
    if (v.event === 'view') {
      opens += 1;
      const idx = Math.floor((v.ts - startOfToday) / DAY_MS) + CHART_DAYS - 1;
      if (idx >= 0 && idx < CHART_DAYS) days[idx].opens += 1;
      if (v.ts >= now - 7 * DAY_MS) last7 += 1;
      else if (v.ts >= now - 14 * DAY_MS) prev7 += 1;
    }
    if (v.event === 'download') downloads += 1;
    if (v.event === 'unlock_fail') failedUnlocks += 1;
    if (v.ip) visitorIps.add(v.ip);
    const place = v.place || v.origin || 'unknown';
    places.set(place, (places.get(place) || 0) + 1);
    if (v.client) clients.set(v.client, (clients.get(v.client) || 0) + 1);
  }

  const rank = (map) => Array.from(map, ([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);

  return {
    opens,
    downloads,
    failedUnlocks,
    visitors: visitorIps.size,
    botHits: visits.length - people.length,
    lastSeen: people.length ? Math.max(...people.map((v) => v.ts)) : null,
    last7,
    prev7,
    days,
    peakDay: days.reduce((max, d) => Math.max(max, d.opens), 0),
    places: rank(places),
    clients: rank(clients),
    events: visits,
  };
}

function Stat({ value, label, tint, styles }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tint ? { color: tint } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** 30 bars, one per day. No chart library — this is a row of rectangles. */
function OpensChart({ days, peak, tint, styles }) {
  const firstLabel = new Date(days[0].ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <View>
      <View style={styles.chart} testID="share-opens-chart">
        {days.map((d) => (
          <View key={d.ts} style={styles.chartSlot}>
            <View
              style={[
                styles.chartBar,
                {
                  // Zero days keep a 2pt stub so the axis reads as a timeline
                  // with gaps rather than as a shorter chart.
                  height: d.opens ? Math.max(4, Math.round((d.opens / peak) * 56)) : 2,
                  backgroundColor: d.opens ? tint : withAlpha(tint, '33') || tint,
                },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.chartAxis}>
        <Text style={styles.chartAxisText}>{firstLabel}</Text>
        <Text style={styles.chartAxisText}>today</Text>
      </View>
    </View>
  );
}

function Breakdown({ title, rows, total, tint, icon, styles, emptyText }) {
  if (!rows.length) return emptyText ? <Text style={styles.sectionEmpty}>{emptyText}</Text> : null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {rows.slice(0, 6).map((row) => (
        <View key={row.label} style={styles.barRow}>
          <MaterialCommunityIcons name={icon} size={13} style={styles.barIcon} />
          <Text style={styles.barLabel} numberOfLines={1}>{row.label}</Text>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                { width: `${Math.max(6, Math.round((row.n / Math.max(1, total)) * 100))}%`, backgroundColor: tint },
              ]}
            />
          </View>
          <Text style={styles.barCount}>{row.n}</Text>
        </View>
      ))}
    </View>
  );
}

export default function ShareInsightsPage({
  visible,
  albumName,
  api,
  theme,
  onClose,
  onManageLinks,
  topInset = 0,
  bottomInset = 0,
}) {
  const c = theme.colors;
  const tint = c.accentInfo || c.primary;
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [state, setState] = useState({ loading: true, error: null, shares: [], visits: [], geoEnabled: false, truncated: false });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!albumName || !api?.get) return;
    try {
      const res = await api.get(`/album-shares?album=${encodeURIComponent(albumName)}`);
      const shares = (res?.shares || []).filter((s) => !isDead(s));
      // One visits request per link, in parallel — a board can carry more than
      // one link (a locked one for family, an open one for everyone else) and
      // the page reports the board, not a single link.
      const perShare = await Promise.all(shares.map(async (s) => {
        try {
          const v = await api.get(`/album-shares/${s.id}/visits?limit=${VISIT_LIMIT}`);
          return {
            shareId: s.id,
            geoEnabled: !!v?.geoEnabled,
            visits: (v?.visits || []).map((row) => ({ ...row, shareId: s.id })),
          };
        } catch {
          // One unreadable link must not blank the whole page.
          return { shareId: s.id, geoEnabled: false, visits: [] };
        }
      }));
      const visits = perShare.flatMap((p) => p.visits).sort((a, b) => b.ts - a.ts);
      setState({
        loading: false,
        error: null,
        shares,
        visits,
        geoEnabled: perShare.some((p) => p.geoEnabled),
        truncated: perShare.some((p) => p.visits.length >= VISIT_LIMIT),
      });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e?.message || 'Could not load share activity' }));
    }
  }, [albumName, api]);

  // Re-read on every open: a link can be created, revoked or opened by someone
  // between two visits to this page.
  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    load().catch(() => {});
    return () => { cancelled = true; void cancelled; };
  }, [visible, load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const roll = useMemo(() => summarizeVisits(state.visits), [state.visits]);
  const perShareOpens = useMemo(() => {
    const byShare = new Map();
    for (const v of state.visits) {
      if (v.isBot || v.event !== 'view') continue;
      byShare.set(v.shareId, (byShare.get(v.shareId) || 0) + 1);
    }
    return byShare;
  }, [state.visits]);

  const copyLink = useCallback(async (url) => {
    await Clipboard.setStringAsync(url);
    notifyHaptic('success');
  }, []);

  const trend = roll.last7 - roll.prev7;

  return (
    <EdgeSwipePage overlay visible={visible} onClose={onClose}>
      <View style={[styles.page, { paddingTop: topInset }]}>
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back to boards"
            style={styles.headerBack}
          >
            <MaterialCommunityIcons name="chevron-left" size={28} color={c.textPrimary} />
          </Pressable>
          <View style={styles.headerTitleSlot}>
            <Text style={styles.headerTitle} numberOfLines={1}>{albumName}</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {state.shares.length === 1
                ? 'Shared on the web · 1 link'
                : `Shared on the web · ${state.shares.length} links`}
            </Text>
          </View>
          <Pressable
            onPress={() => { tapHaptic(); onManageLinks?.(albumName); }}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Manage links for this board"
            style={styles.headerAction}
          >
            <MaterialCommunityIcons name="cog-outline" size={20} color={c.textSecondary} />
          </Pressable>
        </View>

        {state.loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={c.textSecondary} />
        ) : (
          <ScrollView
            contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset + 32 }]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.textSecondary} />}
            showsVerticalScrollIndicator
            // iOS otherwise floats the vertical indicator mid-page instead of on
            // the right edge (it inherits a stale inset from the pushed-page /
            // overlay it is presented inside). Pinning a 1px right inset forces
            // it to the true right edge; indicatorStyle keeps it legible in both
            // themes. Same fix as TaskForm and ConversationsOverlay.
            scrollIndicatorInsets={{ right: 1 }}
            indicatorStyle={theme.mode === 'dark' ? 'white' : 'black'}
          >
            {state.error && <Text style={styles.error}>{state.error}</Text>}

            {/* Headline counts. People only — bots are reported separately
                below, never folded into these. */}
            <View style={styles.statRow}>
              <Stat value={roll.opens} label="opens" tint={tint} styles={styles} />
              <Stat value={roll.visitors} label="visitors" styles={styles} />
              <Stat value={roll.downloads} label="downloads" styles={styles} />
              <Stat value={whenLabel(roll.lastSeen)} label="last open" styles={styles} />
            </View>

            {roll.opens > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionTitle}>Opens · last 30 days</Text>
                  <Text style={[styles.trend, { color: trend > 0 ? (c.accentSuccess || tint) : c.textTertiary }]}>
                    {trend > 0 ? `+${trend}` : trend < 0 ? `${trend}` : '—'} vs prior week
                  </Text>
                </View>
                <OpensChart days={roll.days} peak={roll.peakDay} tint={tint} styles={styles} />
              </View>
            ) : (
              <View style={styles.emptyBlock}>
                <MaterialCommunityIcons name="radar" size={26} color={c.textMuted} />
                <Text style={styles.emptyTitle}>Nobody has opened it yet</Text>
                <Text style={styles.emptyBody}>
                  The link works — it just has not been visited. Send it to someone and their
                  opens will show up here.
                </Text>
              </View>
            )}

            {/* Per-link ledger: which link is actually carrying the traffic,
                and whether it is gated. */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Links</Text>
              {state.shares.map((s) => (
                <View key={s.id} style={styles.linkCard}>
                  <View style={styles.linkTop}>
                    <MaterialCommunityIcons
                      name={s.hasPassword ? 'lock' : 'web'}
                      size={14}
                      color={s.hasPassword ? (c.accentWarning || c.textSecondary) : tint}
                    />
                    <Text style={styles.linkUrl} numberOfLines={1}>{s.url}</Text>
                  </View>
                  <Text style={styles.linkMeta} numberOfLines={2}>
                    {[
                      `${perShareOpens.get(s.id) || 0} opens`,
                      s.hasPassword ? 'password' : 'open link',
                      s.allowDownload ? 'downloads on' : 'downloads off',
                      s.expiresAt ? `expires ${whenLabel(s.expiresAt)}` : 'no expiry',
                      `created ${whenLabel(s.createdAt)}`,
                    ].join(' · ')}
                  </Text>
                  <View style={styles.linkActions}>
                    <Pressable
                      onPress={() => { tapHaptic(); copyLink(s.url); }}
                      style={styles.linkAction}
                      accessibilityRole="button"
                      accessibilityLabel="Copy link"
                    >
                      <MaterialCommunityIcons name="content-copy" size={14} color={c.textSecondary} />
                      <Text style={styles.linkActionText}>Copy</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => { tapHaptic(); Share.share({ message: s.url }); }}
                      style={styles.linkAction}
                      accessibilityRole="button"
                      accessibilityLabel="Send link"
                    >
                      <MaterialCommunityIcons name="export-variant" size={14} color={c.textSecondary} />
                      <Text style={styles.linkActionText}>Send</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => { tapHaptic(); onManageLinks?.(albumName); }}
                      style={styles.linkAction}
                      accessibilityRole="button"
                      accessibilityLabel="Manage or turn off this link"
                    >
                      <MaterialCommunityIcons name="tune-variant" size={14} color={c.textSecondary} />
                      <Text style={styles.linkActionText}>Manage</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>

            <Breakdown
              title={state.geoEnabled ? 'Where from' : 'Where from · network origin'}
              rows={roll.places}
              total={roll.places.reduce((n, p) => n + p.n, 0)}
              tint={tint}
              icon="map-marker-outline"
              styles={styles}
            />

            <Breakdown
              title="Opened with"
              rows={roll.clients}
              total={roll.clients.reduce((n, p) => n + p.n, 0)}
              tint={c.accentSuccess || tint}
              icon="cellphone-link"
              styles={styles}
            />

            {(roll.failedUnlocks > 0 || roll.botHits > 0) && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Not counted above</Text>
                {roll.botHits > 0 && (
                  <Text style={styles.noteRow}>
                    <Text style={styles.noteStrong}>{roll.botHits}</Text>
                    {' bot fetches — link-preview crawlers (WhatsApp, Slack, Discord) really do open shared links.'}
                  </Text>
                )}
                {roll.failedUnlocks > 0 && (
                  <Text style={[styles.noteRow, { color: c.accentError || c.textSecondary }]}>
                    <Text style={styles.noteStrong}>{roll.failedUnlocks}</Text>
                    {' wrong-password attempts.'}
                  </Text>
                )}
              </View>
            )}

            {roll.events.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Activity</Text>
                {roll.events.slice(0, 60).map((v, i) => (
                  <View key={`${v.ts}-${i}`} style={[styles.visitRow, v.isBot && { opacity: 0.55 }]}>
                    <MaterialCommunityIcons
                      name={v.isBot ? 'robot-outline' : (EVENT_ICON[v.event] || 'earth')}
                      size={13}
                      color={v.isBot ? c.textMuted : c.textSecondary}
                    />
                    <Text style={styles.visitEvent}>{EVENT_LABEL[v.event] || v.event}</Text>
                    <Text style={styles.visitMeta} numberOfLines={1}>
                      {[v.place || v.origin, v.client].filter(Boolean).join(' · ')}
                    </Text>
                    <Text style={styles.visitTime}>{whenLabel(v.ts)}</Text>
                  </View>
                ))}
                {state.truncated && (
                  <Text style={styles.footnote}>
                    Showing the most recent {VISIT_LIMIT} events per link — older ones are not in
                    these totals.
                  </Text>
                )}
              </View>
            )}

            <Text style={styles.footnote}>
              Public links are anonymous, so there is no “who” — only when, from where, and with
              what.
              {!state.geoEnabled
                ? ' Cities need SHARE_GEO_LOOKUP=1 on the server, which sends each visitor’s IP to a third-party lookup.'
                : ''}
            </Text>
          </ScrollView>
        )}
      </View>
    </EdgeSwipePage>
  );
}

const makeStyles = (theme) => {
  const c = theme.colors;
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 10, gap: 4 },
    headerBack: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
    headerTitleSlot: { flex: 1, minWidth: 0 },
    headerTitle: { fontSize: 19, fontWeight: '700', color: c.textPrimary },
    headerSubtitle: { fontSize: 12, color: c.textTertiary || c.textSecondary, marginTop: 1 },
    headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    scroll: { paddingHorizontal: 16 },
    error: { fontSize: 13, color: c.accentError || c.textSecondary, marginBottom: 12 },

    statRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
    stat: { flex: 1, backgroundColor: c.surfaceElevated, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center' },
    statValue: { fontSize: 17, fontWeight: '800', color: c.textPrimary },
    statLabel: { fontSize: 10.5, color: c.textTertiary || c.textSecondary, marginTop: 2 },

    section: { marginBottom: 22 },
    sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    sectionTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', color: c.textTertiary || c.textSecondary, marginBottom: 10 },
    sectionEmpty: { fontSize: 13, color: c.textTertiary || c.textSecondary, marginBottom: 18 },
    trend: { fontSize: 11, fontWeight: '700' },

    chart: { flexDirection: 'row', alignItems: 'flex-end', height: 60, gap: 2 },
    chartSlot: { flex: 1, justifyContent: 'flex-end' },
    chartBar: { width: '100%', borderRadius: 2 },
    chartAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
    chartAxisText: { fontSize: 10, color: c.textMuted },

    emptyBlock: { alignItems: 'center', gap: 6, paddingVertical: 26, paddingHorizontal: 12, marginBottom: 18, backgroundColor: c.surfaceElevated, borderRadius: 14 },
    emptyTitle: { fontSize: 15, fontWeight: '700', color: c.textPrimary },
    emptyBody: { fontSize: 12.5, lineHeight: 18, color: c.textSecondary, textAlign: 'center' },

    linkCard: { backgroundColor: c.surfaceElevated, borderRadius: 12, padding: 12, marginBottom: 10 },
    linkTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    linkUrl: { flex: 1, fontSize: 12.5, fontWeight: '600', color: c.textPrimary },
    linkMeta: { fontSize: 11.5, lineHeight: 16, color: c.textTertiary || c.textSecondary, marginTop: 4 },
    linkActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
    linkAction: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 32, paddingHorizontal: 10, borderRadius: 8, backgroundColor: c.surfaceHighlight || c.surface },
    linkActionText: { fontSize: 12, fontWeight: '600', color: c.textSecondary },

    barRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    barIcon: { color: c.textMuted },
    barLabel: { width: 96, fontSize: 12, color: c.textSecondary },
    barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: c.surfaceElevated, overflow: 'hidden' },
    barFill: { height: 6, borderRadius: 3 },
    barCount: { width: 28, textAlign: 'right', fontSize: 11.5, fontWeight: '700', color: c.textTertiary || c.textSecondary },

    noteRow: { fontSize: 12.5, lineHeight: 18, color: c.textSecondary, marginBottom: 4 },
    noteStrong: { fontWeight: '800', color: c.textPrimary },

    visitRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 5 },
    visitEvent: { fontSize: 12, fontWeight: '700', color: c.textPrimary, width: 96 },
    visitMeta: { flex: 1, fontSize: 11.5, color: c.textTertiary || c.textSecondary },
    visitTime: { fontSize: 11, color: c.textMuted },

    footnote: { fontSize: 11, lineHeight: 16, color: c.textMuted, marginTop: 4 },
  });
};
