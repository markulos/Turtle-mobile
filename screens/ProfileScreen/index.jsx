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
import { generatedName } from '../../utils/avatar';
import { dockOccupied } from '../../components/tabBarLayout';
import { tapHaptic } from '../../utils/haptics';
import EdgeSwipePage from '../TurtleScreen/components/EdgeSwipePage';
import PasswordsScreen from '../PasswordsScreen';

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
  const { api } = useServer();
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

  // Stored name wins over the generated one; absent ⇒ keep the generated
  // default (which is stable, so it doesn't churn between launches).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(nameKey(identity));
        if (alive && saved && saved.trim()) setName(saved.trim());
        else if (alive) setName(fallbackName);
      } catch { /* storage unavailable — the generated name stands */ }
    })();
    return () => { alive = false; };
  }, [identity, fallbackName]);

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

  const CARDS = [
    { key: 'vault', icon: 'shield-lock', label: 'Password Vault',
      sub: 'Your saved logins', onPress: () => { tapHaptic(); setVaultOpen(true); } },
    { key: 'chats', icon: 'forum', label: 'Board conversations',
      sub: 'Per-board chat + activity', onPress: () => goTab('Turtle') },
    { key: 'claude', icon: 'robot', label: 'Claude session',
      sub: 'Code with Claude in chat', onPress: () => goTab('Turtle') },
    { key: 'terminal', icon: 'console', label: 'Terminal',
      sub: 'Remote shell', onPress: () => goTab('Turtle') },
    { key: 'link', icon: 'qrcode-scan', label: 'Connect to desktop',
      sub: 'Scan the QR shown on the web app', onPress: () => goTab('Turtle') },
    { key: 'settings', icon: 'cog', label: 'Settings',
      sub: 'Appearance, server, account', onPress: () => goTab('Turtle') },
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
        {/* Identity block */}
        <View style={styles.identity}>
          <AnimalAvatar id={identity} size={88} />

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

          {/* Friends as a COUNT (Instagram-style) — the list opens on tap. */}
          {friendCount != null && (
            <TouchableOpacity
              onPress={() => { tapHaptic(); setShowFriends(true); }}
              style={styles.stat}
              accessibilityRole="button"
              accessibilityLabel={`${friendCount} friends`}
            >
              <Text style={styles.statNum}>{friendCount}</Text>
              <Text style={styles.statLabel}>{friendCount === 1 ? 'friend' : 'friends'}</Text>
            </TouchableOpacity>
          )}
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
    identity: { alignItems: 'center', paddingHorizontal: 20, gap: 10 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    name: { fontSize: 22, fontWeight: '700', color: c.textPrimary, maxWidth: 260 },
    nameInput: {
      fontSize: 22, fontWeight: '700', color: c.textPrimary, textAlign: 'center',
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
      minWidth: 200, paddingVertical: 2,
    },
    stat: { alignItems: 'center', paddingVertical: 4, paddingHorizontal: 14 },
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
