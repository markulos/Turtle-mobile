import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../context/ThemeContext';
import { useServer } from '../../context/ServerContext';
import { useAuth } from '../../context/AuthContext';
import AnimalAvatar from '../../components/AnimalAvatar';
import { generatedName, avatarAnimal } from '../../utils/avatar';
import { dockOccupied } from '../../components/tabBarLayout';
import { tapHaptic } from '../../utils/haptics';
import { Image } from 'expo-image';
import EdgeSwipePage from '../TurtleScreen/components/EdgeSwipePage';
import ConversationsOverlay from '../TurtleScreen/components/ConversationsOverlay';
import LinkDesktop from '../TurtleScreen/components/LinkDesktop';
import PasswordsScreen from '../PasswordsScreen';
import SettingsScreen from '../SettingsScreen';

/**
 * ProfileScreen — the personal tab.
 *
 * Instagram's shape: identity block on top (avatar, name, a tappable friends
 * COUNT rather than a list), then the app's other surfaces as a vertical list
 * of cards. This is the home for everything that used to hang off the Turtle
 * chat header, so no control is stranded when that header becomes an identity
 * bar.
 *
 * Cards do not reimplement anything. They either PUSH an existing page
 * (EdgeSwipePage) or SWITCH TABS to where the feature already lives — Claude
 * and the terminal stay inside TurtleScreen, which owns their composer and
 * keyboard geometry, so their cards are launchers rather than new homes.
 */

// The display name lives per identity, so switching accounts on one device
// doesn't inherit the previous person's name.
const nameKey = (identity) => `profileName:${identity || 'anon'}`;

export default function ProfileScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { api, getBaseUrl } = useServer();
  const { authIdentity } = useAuth();

  // Identity string (e.g. "sub:123" / "phone:+1…"). Everything derived —
  // animal, tint, generated name — hangs off this one value.
  const identity = authIdentity || 'anon';
  const fallbackName = useMemo(() => generatedName(identity), [identity]);

  const [name, setName] = useState(fallbackName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [friendCount, setFriendCount] = useState(null);
  const [showFriends, setShowFriends] = useState(false);
  const [friends, setFriends] = useState([]);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [convosOpen, setConvosOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  // Server profile: the REAL display name, uploaded avatar and activity stats
  // (GET /me → { user: { displayName, avatarUrl, stats } }). The generated
  // animal name/disc are the FALLBACK for anyone who hasn't set either.
  const [me, setMe] = useState(null);
  // Which stat's detail page is open (null = none).
  const [statDetail, setStatDetail] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get('/me');
        if (alive && r?.user) setMe(r.user);
      } catch { /* offline / older server — the local identity still renders */ }
    })();
    return () => { alive = false; };
  }, [api]);

  // Stored name wins over the generated one; absent ⇒ keep the generated
  // default (which is stable, so it doesn't churn between launches).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(nameKey(identity));
        // Precedence: locally-edited name → the server's displayName → the
        // generated animal name. So a real profile name shows up without an
        // edit, and nobody ever sees a blank.
        if (alive && saved && saved.trim()) setName(saved.trim());
        else if (alive) setName(me?.displayName?.trim() || fallbackName);
      } catch { /* storage unavailable — the generated name stands */ }
    })();
    return () => { alive = false; };
  }, [identity, fallbackName, me?.displayName]);

  const commitName = useCallback(async () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === name) return;
    setName(next); // optimistic, app-wide rule
    try { await AsyncStorage.setItem(nameKey(identity), next); } catch { /* keep the UI value */ }
  }, [draft, name, identity]);

  // Friends: only the COUNT lives on the profile; the list is one tap away.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get('/friends');
        const list = Array.isArray(r?.friends) ? r.friends : (Array.isArray(r) ? r : []);
        if (alive) { setFriends(list); setFriendCount(list.length); }
      } catch {
        if (alive) setFriendCount(null); // unreachable — hide rather than lie
      }
    })();
    return () => { alive = false; };
  }, [api]);

  const goTab = useCallback((tab) => { tapHaptic(); navigation.navigate(tab); }, [navigation]);

  // Server origin (no /api) so a server-relative avatar path resolves — same
  // construction Settings uses for its avatar.
  const serverBase = getBaseUrl().replace(/\/api$/, '');
  const avatarFullUrl = me?.avatarUrl
    ? (me.avatarUrl.startsWith('/') ? `${serverBase}${me.avatarUrl}` : me.avatarUrl)
    : null;

  const stats = me?.stats || null;
  // Only stats the server actually reported. Each drills into a detail page so
  // the number is a doorway to the log behind it, not a dead badge.
  const STATS = [
    friendCount != null && {
      key: 'friends', value: friendCount,
      label: friendCount === 1 ? 'friend' : 'friends',
      onPress: () => setShowFriends(true),
    },
    stats?.tasksCompleted != null && {
      key: 'done', value: stats.tasksCompleted, label: 'done',
      onPress: () => setStatDetail('done'),
    },
    stats?.pomodoros != null && {
      key: 'focus', value: stats.pomodoros, label: 'focus',
      onPress: () => setStatDetail('focus'),
    },
    stats?.points != null && {
      key: 'points', value: stats.points, label: 'points',
      onPress: () => setStatDetail('points'),
    },
  ].filter(Boolean);

  const CARDS = [
    { key: 'vault', icon: 'shield-lock', label: 'Password Vault',
      sub: 'Your saved logins', onPress: () => { tapHaptic(); setVaultOpen(true); } },
    { key: 'chats', icon: 'forum', label: 'Board conversations',
      sub: 'Per-board chat + activity', onPress: () => { tapHaptic(); setConvosOpen(true); } },
    { key: 'claude', icon: 'robot', label: 'Claude session',
      sub: 'Code with Claude in chat', onPress: () => goTab('Turtle') },
    { key: 'terminal', icon: 'console', label: 'Terminal',
      sub: 'Remote shell', onPress: () => goTab('Turtle') },
    { key: 'link', icon: 'qrcode-scan', label: 'Connect to desktop',
      sub: 'Scan the QR shown on the web app',
      onPress: () => { tapHaptic(); setLinkOpen(true); } },
    { key: 'settings', icon: 'cog', label: 'Settings',
      sub: 'Appearance, server, account', onPress: () => { tapHaptic(); setSettingsOpen(true); } },
  ];

  const styles = makeStyles(theme);

  return (
    <View style={styles.page}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          // Scrollable, so it may pass UNDER the dock — but it must be able to
          // scroll clear of it (turtle-chrome-underlay).
          paddingBottom: dockOccupied(insets.bottom) + 24,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity card — the SAME card treatment Settings uses for its
            Profile section (surface fill, 12pt radius, 0.5pt border, 16pt pad)
            and the same row layout: avatar on the LEFT, everything else stacked
            to its right. */}
        <View style={styles.identityCard}>
          {/* The uploaded image wins. With none, the user's animal shows as a
              plain SILHOUETTE inside the same bordered circle Settings draws —
              no coloured disc, so the two screens read identically. */}
          <View style={styles.avatarCircle}>
            {avatarFullUrl ? (
              <Image source={{ uri: avatarFullUrl }} style={styles.avatarImg} contentFit="cover" cachePolicy="memory-disk" transition={150} />
            ) : (
              <Icon name={avatarAnimal(identity)} size={40} color={c.textTertiary} />
            )}
          </View>

          <View style={styles.identityBody}>

          {editing ? (
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onBlur={commitName}
              onSubmitEditing={commitName}
              autoFocus
              maxLength={40}
              style={styles.nameInput}
              placeholder="Your name"
              placeholderTextColor={c.textMuted}
              returnKeyType="done"
            />
          ) : (
            <TouchableOpacity
              onPress={() => { tapHaptic(); setDraft(name); setEditing(true); }}
              style={styles.nameRow}
              accessibilityRole="button"
              accessibilityLabel="Edit your name"
            >
              <Text style={styles.name} numberOfLines={1}>{name}</Text>
              <Icon name="pencil-outline" size={16} color={c.textMuted} />
            </TouchableOpacity>
          )}

          {/* Stat strip — Instagram's row of tappable counts. Each one is a
              drill-in: friends opens the list, the activity stats open a detail
              page for that metric. Values come from GET /me's stats block, so
              they're the server's real totals rather than anything recomputed
              here; a stat the server doesn't report is simply omitted. */}
          <View style={styles.statStrip}>
            {STATS.map((s) => (
              <TouchableOpacity
                key={s.key}
                onPress={() => { tapHaptic(); s.onPress(); }}
                style={styles.stat}
                accessibilityRole="button"
                accessibilityLabel={`${s.value} ${s.label}`}
              >
                <Text style={styles.statNum}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          </View>
        </View>

        {/* Cards */}
        <View style={styles.cards}>
          {CARDS.map((card) => (
            <TouchableOpacity
              key={card.key}
              style={styles.card}
              activeOpacity={0.7}
              onPress={card.onPress}
              accessibilityRole="button"
              accessibilityLabel={card.label}
            >
              <View style={styles.cardIcon}>
                <Icon name={card.icon} size={20} color={c.accent || c.accentInfo} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.cardLabel} numberOfLines={1}>{card.label}</Text>
                <Text style={styles.cardSub} numberOfLines={1}>{card.sub}</Text>
              </View>
              <Icon name="chevron-right" size={20} color={c.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Friends list — pushed, Instagram-style, from the count. */}
      <EdgeSwipePage overlay visible={showFriends} onClose={() => setShowFriends(false)}>
        <View style={[styles.page, { paddingTop: insets.top + 6 }]}>
          <View style={styles.pushHeader}>
            <TouchableOpacity onPress={() => setShowFriends(false)} hitSlop={HIT} accessibilityLabel="Back">
              <Icon name="chevron-left" size={28} color={c.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.pushTitle}>Friends</Text>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: dockOccupied(insets.bottom) + 24 }}>
            {friends.length === 0 ? (
              <Text style={styles.empty}>No friends yet.</Text>
            ) : friends.map((f) => {
              const fid = String(f.id ?? f.userId ?? f.phone ?? f.displayName ?? '');
              return (
                <View key={fid} style={styles.friendRow}>
                  <AnimalAvatar id={fid} size={40} />
                  <Text style={styles.friendName} numberOfLines={1}>
                    {f.displayName || f.phone || generatedName(fid)}
                  </Text>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </EdgeSwipePage>

      {/* Board conversations — hosted HERE now rather than reached by switching
          to the Turtle tab. It already owns its own EdgeSwipePage, so it is
          rendered directly. */}
      <ConversationsOverlay
        visible={convosOpen}
        onClose={() => setConvosOpen(false)}
        // The inbox's pinned Claude row only renders when this is supplied.
        // Claude itself stays in the chat (it's wired into the composer), so
        // this closes the inbox and switches there.
        onOpenClaude={() => { setConvosOpen(false); goTab('Turtle'); }}
      />

      {/* Connect to desktop — the existing QR flow (web shows the code, this
          scans it), hosted here now that the chat header's button is gone. */}
      <LinkDesktop visible={linkOpen} onClose={() => setLinkOpen(false)} />

      {/* Settings — the standalone screen, pushed from its card. It was already
          a standalone component (TurtleScreen only wrapped it in a Modal), so
          this re-hosts rather than extracts. `active` gates its live polling to
          while it's actually on screen. */}
      <EdgeSwipePage overlay visible={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <View style={styles.page}>
          <View style={[styles.pushHeader, { paddingTop: insets.top + 6 }]}>
            <TouchableOpacity onPress={() => setSettingsOpen(false)} hitSlop={HIT} accessibilityLabel="Close settings">
              <Icon name="chevron-left" size={28} color={c.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.pushTitle}>Settings</Text>
          </View>
          <SettingsScreen active={settingsOpen} />
        </View>
      </EdgeSwipePage>

      {/* Stat detail — the log behind a number. Deliberately a stub for now:
          it names the metric and its value and routes to the surface that owns
          the underlying records, rather than inventing a second analytics
          screen this pass didn't scope. */}
      <EdgeSwipePage overlay visible={!!statDetail} onClose={() => setStatDetail(null)}>
        <View style={styles.page}>
          <View style={[styles.pushHeader, { paddingTop: insets.top + 6 }]}>
            <TouchableOpacity onPress={() => setStatDetail(null)} hitSlop={HIT} accessibilityLabel="Back">
              <Icon name="chevron-left" size={28} color={c.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.pushTitle}>
              {statDetail === 'done' ? 'Tasks completed' : statDetail === 'focus' ? 'Focus sessions' : 'Points'}
            </Text>
          </View>
          <View style={{ alignItems: 'center', paddingTop: 30, gap: 8 }}>
            <Text style={styles.bigStat}>
              {statDetail === 'done' ? (stats?.tasksCompleted ?? 0)
                : statDetail === 'focus' ? (stats?.pomodoros ?? 0)
                : (stats?.points ?? 0)}
            </Text>
            <Text style={styles.statLabel}>
              {statDetail === 'done' ? `of ${stats?.tasksCreated ?? 0} created`
                : statDetail === 'focus' ? 'pomodoros completed'
                : 'earned so far'}
            </Text>
            {statDetail === 'done' && (
              <TouchableOpacity onPress={() => { setStatDetail(null); goTab('Tasks'); }} style={styles.linkBtn}>
                <Text style={styles.linkText}>Open tasks</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </EdgeSwipePage>

      {/* Password vault — the tab it replaces in the dock. */}
      <EdgeSwipePage overlay visible={vaultOpen} onClose={() => setVaultOpen(false)}>
        <PasswordsScreen />
        <TouchableOpacity
          onPress={() => setVaultOpen(false)}
          style={[styles.vaultBack, { top: insets.top + 8 }]}
          hitSlop={HIT}
          accessibilityLabel="Close the vault"
        >
          <Icon name="chevron-left" size={28} color={c.textPrimary} />
        </TouchableOpacity>
      </EdgeSwipePage>
    </View>
  );
}

const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

const makeStyles = (theme) => {
  const c = theme.colors;
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: c.background },
    // Card chrome copied from Settings' section style so the two screens'
    // profile blocks are visually identical (fill, radius, 0.5pt border, pad).
    identityCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: c.surface,
      borderRadius: 12,
      padding: 16,
      marginHorizontal: 16,
      borderWidth: 0.5,
      borderColor: c.border,
    },
    // Settings' avatarCircle: 84pt bordered disc on the surface-elevated fill.
    avatarCircle: {
      width: 84,
      height: 84,
      borderRadius: 42,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceElevated,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 16,
      overflow: 'hidden',
    },
    // Everything that isn't the avatar, stacked to its right.
    identityBody: { flex: 1, minWidth: 0, gap: 8, paddingTop: 4 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    name: { fontSize: 20, fontWeight: '700', color: c.textPrimary, flexShrink: 1 },
    nameInput: {
      fontSize: 20, fontWeight: '700', color: c.textPrimary,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
      paddingVertical: 2,
    },
    // Fills the bordered circle above (which clips it).
    avatarImg: { width: '100%', height: '100%' },
    // Left-aligned now that it sits beside the avatar rather than under it.
    statStrip: {
      flexDirection: 'row', alignItems: 'center',
      flexWrap: 'wrap', marginLeft: -10,
    },
    stat: { alignItems: 'center', paddingVertical: 2, paddingHorizontal: 10 },
    bigStat: { fontSize: 44, fontWeight: '800', color: c.textPrimary },
    linkBtn: { marginTop: 16, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 12, backgroundColor: c.surfaceElevated },
    linkText: { color: c.accent || c.accentInfo, fontWeight: '700', fontSize: 15 },
    statNum: { fontSize: 18, fontWeight: '700', color: c.textPrimary },
    statLabel: { fontSize: 12, color: c.textTertiary },
    cards: { marginTop: 26, paddingHorizontal: 16, gap: 10 },
    card: {
      flexDirection: 'row', alignItems: 'center', gap: 14,
      padding: 14, borderRadius: 16,
      backgroundColor: c.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    },
    cardIcon: {
      width: 38, height: 38, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: (c.accent || c.accentInfo || '#4ADE80') + '22',
    },
    cardLabel: { fontSize: 15, fontWeight: '600', color: c.textPrimary },
    cardSub: { fontSize: 12, color: c.textTertiary, marginTop: 1 },
    pushHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 10 },
    pushTitle: { fontSize: 17, fontWeight: '700', color: c.textPrimary },
    friendRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
    friendName: { fontSize: 15, fontWeight: '600', color: c.textPrimary, flex: 1 },
    empty: { color: c.textSecondary, textAlign: 'center', padding: 40 },
    vaultBack: {
      position: 'absolute', left: 12,
      width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    },
  });
};
