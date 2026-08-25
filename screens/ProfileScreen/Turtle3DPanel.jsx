import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';
import { useServer } from '../../context/ServerContext';
import { dockOccupied } from '../../components/tabBarLayout';
import { tapHaptic } from '../../utils/haptics';
import { probeCollab, resolveCollabBase } from '../../services/collabHealth';

/**
 * Turtle3DPanel — a read-only status page for the TURTLE-3D collab side of this
 * server, reached from a Profile card.
 *
 * ★ WHAT THIS SERVER ACTUALLY KNOWS ★
 * The bridge INVENTORY here is derived from exactly one thing: this server
 * mints credentials that TURTLE-3D bridges use to check whether a sign-in
 * token is valid (RFC 7662 introspection). This server has NO socket to a
 * bridge and gets NO heartbeat from one. `lastUsedAt` moves only when a
 * bridge successfully introspects a token — i.e. when somebody signs in to
 * it — never on a ping.
 *
 * The one exception, added deliberately and kept separate: the Collab bridge
 * card at the bottom asks the BRIDGE ITSELF (`GET <collab base>/health`) and
 * reports what it answers. That request never touches this app server —
 * pointing it here would re-report this server's liveness under a collab
 * label, which is precisely the confusion the rest of this page avoids. See
 * services/collabHealth.js.
 *
 * So this page never claims a bridge is "online", "connected" or "running".
 * Per bridge, state is derived strictly from the payload:
 *     revokedAt != null  → Revoked
 *     lastUsedAt == null → Never used
 *     otherwise          → Last seen <relative>
 * The one genuine liveness signal on this page is THIS APP SERVER's own
 * reachability (isConnected), which the app really does poll — it is labelled
 * as the app server's, never as a bridge's.
 *
 * Bridge inventory is OWNER-ONLY on the server (requireOwner). Rather than
 * guessing the role client-side — the server also accepts a legacy
 * master-password token that carries no role — this probes the endpoint and
 * shows an "owner only" note on 403. The account/server sections above it work
 * for everyone.
 *
 * Minting and revoking deliberately live on the WEB panel only: the credential
 * is shown exactly once and is pasted into a bridge's config on the machine
 * running it, so a phone is the wrong place to hand it out.
 */

const relativeTime = (ms) => {
  const diff = Date.now() - ms;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const absoluteTime = (ms) => new Date(ms).toLocaleString(undefined, {
  month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export default function Turtle3DPanel({ onClose }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { api, serverIP, isConnected } = useServer();

  const [me, setMe] = useState(null);
  const [servers, setServers] = useState([]);
  // null = not asked yet, false = 403 (not the owner), true = allowed
  const [ownerAllowed, setOwnerAllowed] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  // The bridge's OWN liveness, asked of the bridge. null = not probed yet.
  const [collab, setCollab] = useState(null);
  const [probing, setProbing] = useState(false);
  // Who has actually been let into a bridge. Owner-only, so it stays null for
  // everyone else and the section simply doesn't render.
  const [activity, setActivity] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    // Identity is available to everyone; bridge inventory is owner-gated. They
    // are fetched independently so a 403 on one doesn't blank the other.
    try {
      const r = await api.get('/me');
      if (r?.user) setMe(r.user);
    } catch { /* offline — the section renders what it has */ }

    try {
      const r = await api.get('/collab/servers');
      setServers(Array.isArray(r?.servers) ? r.servers : []);
      setOwnerAllowed(true);
    } catch (e) {
      // ServerContext's apiGet throws `API <status> on GET <path> — <body>`,
      // so a non-owner's 403 is identifiable by either the status or the
      // envelope's code. Match both rather than depending on one shape.
      const msg = String(e?.message || '');
      if (msg.includes('403') || msg.includes('FORBIDDEN')) setOwnerAllowed(false);
      else { setOwnerAllowed(true); setError('Could not load collab servers.'); }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }

    // Who has been on. Same owner gate as the inventory above, so a non-owner
    // simply never populates it.
    try {
      const r = await api.get('/collab/activity');
      setActivity(r && r.success ? r : null);
    } catch { /* non-owner or offline — the section stays hidden */ }

    // The bridge is a DIFFERENT server. This app mints its credentials and
    // has no socket to it, so the only way to learn whether collab is up is
    // to ask the bridge itself — at its own address, never at this one.
    setProbing(true);
    let settings = null;
    try { settings = await api.get('/settings'); } catch { /* fall back to the default address */ }
    try {
      const base = resolveCollabBase(settings?.settings || settings);
      setCollab(await probeCollab(base));
    } finally {
      setProbing(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => { setRefreshing(true); tapHaptic(); load(); }, [load]);

  const styles = makeStyles(theme);

  // Inventory counts — plain arithmetic over the payload, no inference.
  const active = servers.filter((s) => s.revokedAt == null);
  const revoked = servers.filter((s) => s.revokedAt != null);
  const neverUsed = active.filter((s) => s.lastUsedAt == null);
  const lastCheck = servers.reduce(
    (max, s) => (s.lastUsedAt && s.lastUsedAt > max ? s.lastUsedAt : max),
    0,
  );

  const TILES = [
    { key: 'total', icon: 'server', label: 'Bridges', value: String(servers.length) },
    { key: 'active', icon: 'key-variant', label: 'Active', value: String(active.length) },
    { key: 'revoked', icon: 'key-remove', label: 'Revoked', value: String(revoked.length) },
    {
      key: 'last', icon: 'login-variant', label: 'Last check',
      value: lastCheck ? relativeTime(lastCheck) : '—',
    },
  ];

  return (
    <View style={styles.page}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={onClose} hitSlop={HIT} accessibilityLabel="Back" accessibilityRole="button">
          <Icon name="chevron-left" size={28} color={c.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Turtle 3D</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: dockOccupied(insets.bottom) + 24, paddingHorizontal: 16 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.textSecondary} />
        }
      >
        {/* What this is */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={styles.cardIcon}><Icon name="cube-outline" size={18} color={c.accent || c.accentInfo} /></View>
            <Text style={styles.cardTitle}>Collab bridges</Text>
          </View>
          <Text style={styles.body}>
            A TURTLE-3D bridge hosts a shared 3D session. It holds a credential from this
            server and uses it to check that whoever joins is signed in to your Turtle
            account — so the 3D side never needs its own passwords.
          </Text>
        </View>

        {/* Inventory */}
        {loading ? (
          <View style={styles.loadingBox}><ActivityIndicator color={c.textSecondary} /></View>
        ) : ownerAllowed === false ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <View style={styles.cardIcon}><Icon name="lock-outline" size={18} color={c.textMuted} /></View>
              <Text style={styles.cardTitle}>Bridges are owner-only</Text>
            </View>
            <Text style={styles.body}>
              Only the pond's owner can see or manage collab credentials. Your account and
              server details are below.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.tiles}>
              {TILES.map((t) => (
                <View key={t.key} style={styles.tile}>
                  <Icon name={t.icon} size={16} color={c.textTertiary} />
                  <Text style={styles.tileValue} numberOfLines={1}>{t.value}</Text>
                  <Text style={styles.tileLabel}>{t.label}</Text>
                </View>
              ))}
            </View>

            {!!error && (
              <View style={styles.errorBox}>
                <Icon name="alert-circle-outline" size={16} color={c.accentError} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.card}>
              <View style={styles.cardHead}>
                <View style={styles.cardIcon}><Icon name="server" size={18} color={c.accent || c.accentInfo} /></View>
                <Text style={styles.cardTitle}>Registered bridges</Text>
              </View>

              {servers.length === 0 ? (
                <Text style={styles.body}>
                  No bridges yet. Mint a credential from the desktop app (Settings → Devices)
                  and paste it into the bridge's configuration on the machine that runs it.
                </Text>
              ) : (
                servers.map((s, i) => {
                  const isRevoked = s.revokedAt != null;
                  return (
                    <View
                      key={s.id}
                      style={[
                        styles.row,
                        i > 0 && styles.rowDivider,
                        // Revoked entries stay VISIBLE but dimmed, so the list
                        // still works as an audit trail.
                        isRevoked && { opacity: 0.55 },
                      ]}
                    >
                      <View style={[styles.dot, { backgroundColor: isRevoked ? c.textMuted : (c.accent || c.accentInfo) }]} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          style={[styles.rowTitle, isRevoked && { textDecorationLine: 'line-through' }]}
                          numberOfLines={1}
                        >
                          {s.name}
                        </Text>
                        <Text style={styles.rowSub} numberOfLines={1}>
                          {/* Never a liveness claim — only what the payload says. */}
                          {isRevoked
                            ? `Revoked ${relativeTime(s.revokedAt)}`
                            : s.lastUsedAt == null
                              ? 'Never used'
                              : `Last seen ${relativeTime(s.lastUsedAt)}`}
                        </Text>
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          added {absoluteTime(s.createdAt)}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}

              {servers.length > 0 && (
                <Text style={styles.footnote}>
                  “Last seen” is the last time a bridge checked a sign-in — not a heartbeat.
                  This server has no way to tell whether a bridge is running right now.
                  {neverUsed.length > 0
                    ? ` ${neverUsed.length} active credential${neverUsed.length === 1 ? ' has' : 's have'} never been used.`
                    : ''}
                </Text>
              )}
            </View>
          </>
        )}

        {/* Your account */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={styles.cardIcon}><Icon name="account-outline" size={18} color={c.accent || c.accentInfo} /></View>
            <Text style={styles.cardTitle}>Your account</Text>
          </View>
          <InfoRow theme={theme} label="Name" value={me?.displayName || '—'} />
          <InfoRow theme={theme} label="Role" value={me?.role || '—'} />
          <InfoRow theme={theme} label="User id" value={me?.id || '—'} mono />
          <Text style={styles.footnote}>
            This is the identity a bridge is told about when you join a 3D session: your id
            and display name, nothing else.
          </Text>
        </View>

        {/* This server */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={styles.cardIcon}><Icon name="lan-connect" size={18} color={c.accent || c.accentInfo} /></View>
            <Text style={styles.cardTitle}>This server</Text>
          </View>
          <InfoRow theme={theme} label="Address" value={serverIP || '—'} mono />
          {/* The ONLY genuine liveness on this page: the app polls its own
              server, so this is measured, not inferred. Labelled as the app
              server's — never a bridge's. */}
          <InfoRow
            theme={theme}
            label="App server"
            value={isConnected ? 'Reachable from this phone' : 'Not reachable right now'}
          />
        </View>

        {/* Collab bridge — a DIFFERENT server, asked directly.
            Deliberately its own card, below "This server", so its state can
            never be read as the app server's. This is the second measured
            signal on the page; everything above it about bridges is still
            derived from credential use, not from a heartbeat. */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={styles.cardIcon}>
              <Icon name="cube-outline" size={18} color={c.accent || c.accentInfo} />
            </View>
            <Text style={styles.cardTitle}>Collab bridge</Text>
          </View>

          {probing && !collab ? (
            <InfoRow theme={theme} label="Status" value="Checking…" />
          ) : collab ? (
            <>
              <InfoRow
                theme={theme}
                label="Status"
                value={collab.state === 'up'
                  ? `Up${collab.entities != null ? ` · ${collab.entities} element${collab.entities === 1 ? '' : 's'} loaded` : ''}`
                  : 'Not answering'}
              />
              <InfoRow theme={theme} label="Address" value={collab.url} mono />
              {collab.state === 'up' && collab.ms != null && (
                <InfoRow theme={theme} label="Replied in" value={`${collab.ms} ms`} />
              )}
              {collab.state !== 'up' && !!collab.detail && (
                <Text style={styles.footnote}>{collab.detail}</Text>
              )}
            </>
          ) : (
            <InfoRow theme={theme} label="Status" value="—" />
          )}

          <Text style={styles.footnote}>
            Asked of the bridge itself, not of this app server. The two are separate
            machines — this app issues the bridge's credentials and has no other line
            to it, so its health has to come from its own address.
          </Text>
        </View>

        {/* Who has been on. Owner-only; hidden entirely otherwise.
            Unlike the inventory above, every row here is MEASURED: it exists
            because a bridge really did admit that person. */}
        {activity && (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <View style={styles.cardIcon}>
                <Icon name="account-clock-outline" size={18} color={c.accent || c.accentInfo} />
              </View>
              <Text style={styles.cardTitle}>Who's been on</Text>
            </View>

            <InfoRow
              theme={theme}
              label="On now"
              value={activity.online?.length
                ? activity.online.map((s) => s.display || s.userId).join(', ')
                : 'Nobody'}
            />

            {activity.recent?.length ? (
              activity.recent.slice(0, 6).map((s) => (
                <InfoRow
                  key={s.id}
                  theme={theme}
                  label={s.display || s.userId}
                  value={`${s.serviceName || 'a bridge'} · ${relativeTime(s.lastSeenAt)}`}
                />
              ))
            ) : (
              <InfoRow theme={theme} label="Recent" value="No sign-ins yet" />
            )}

            <Text style={styles.footnote}>
              A bridge checks a token every time someone connects, so repeat checks
              inside {Math.round((activity.idleWindowMs || 0) / 60000)} minutes count as
              one visit — that's also when you get a notification, once per arrival
              rather than once per reconnect.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

const InfoRow = ({ theme, label, value, mono }) => {
  const s = makeStyles(theme);
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={[s.infoValue, mono && s.mono]} numberOfLines={1} ellipsizeMode="middle">{value}</Text>
    </View>
  );
};

const makeStyles = (theme) => {
  const c = theme.colors;
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 10 },
    headerTitle: { fontSize: 17, fontWeight: '700', color: c.textPrimary },
    card: {
      backgroundColor: c.surfaceElevated,
      borderRadius: 16,
      padding: 16,
      marginTop: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
    cardIcon: {
      width: 34, height: 34, borderRadius: 11,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: (c.accent || c.accentInfo || '#4ADE80') + '22',
    },
    cardTitle: { fontSize: 15, fontWeight: '700', color: c.textPrimary, flex: 1 },
    body: { fontSize: 13, lineHeight: 19, color: c.textSecondary },
    tiles: { flexDirection: 'row', gap: 8, marginTop: 12 },
    tile: {
      flex: 1, alignItems: 'center', gap: 4, paddingVertical: 12, borderRadius: 14,
      backgroundColor: c.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    },
    tileValue: { fontSize: 17, fontWeight: '800', color: c.textPrimary },
    tileLabel: { fontSize: 10.5, color: c.textTertiary },
    loadingBox: { paddingVertical: 40, alignItems: 'center' },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10 },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
    rowTitle: { fontSize: 14.5, fontWeight: '600', color: c.textPrimary },
    rowSub: { fontSize: 12.5, color: c.textSecondary, marginTop: 1 },
    rowMeta: { fontSize: 11, color: c.textTertiary, marginTop: 1 },
    footnote: { fontSize: 11.5, lineHeight: 17, color: c.textTertiary, marginTop: 12 },
    infoRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, paddingVertical: 7,
    },
    infoLabel: { fontSize: 13, color: c.textSecondary },
    infoValue: { fontSize: 13, fontWeight: '600', color: c.textPrimary, flexShrink: 1, textAlign: 'right' },
    mono: { fontFamily: undefined, letterSpacing: 0.2 },
    errorBox: {
      flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12,
      padding: 12, borderRadius: 12,
      backgroundColor: (c.accentError || '#ff5252') + '18',
    },
    errorText: { fontSize: 12.5, color: c.accentError, flex: 1 },
  });
};
