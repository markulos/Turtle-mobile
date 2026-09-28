import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
  RefreshControl, AppState,
} from 'react-native';
import { depth } from '../../utils/surfaceDepth';
import AppTextInput from '../../components/AppTextInput';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useKeyboardHeight from '../../utils/useKeyboardHeight';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../context/ThemeContext';
import { inkOn } from '../../utils/accentColor';
import { useServer } from '../../context/ServerContext';
import { useAuth } from '../../context/AuthContext';
import AnimalAvatar from '../../components/AnimalAvatar';
import { generatedName, avatarAnimal } from '../../utils/avatar';
import { dockOccupied } from '../../components/tabBarLayout';
import { tapHaptic } from '../../utils/haptics';
import { resolveAvatarUrl } from '../../utils/avatarUrl';
import useUpdateHeadline from '../../utils/useUpdateHeadline';
import UpdatesPanel from '../../components/UpdatesPanel';
import ErrorBoundary from '../../components/ErrorBoundary';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import EdgeSwipePage from '../TurtleScreen/components/EdgeSwipePage';
import ConversationsOverlay from '../TurtleScreen/components/ConversationsOverlay';
import LinkDesktop from '../TurtleScreen/components/LinkDesktop';
import PasswordsScreen from '../PasswordsScreen';
import SettingsScreen from '../SettingsScreen';
import Turtle3DPanel from './Turtle3DPanel';

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
  // Name edit keyboard: pad the page so the field can scroll clear of it.
  const keyboardHeight = useKeyboardHeight();
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
  // Invites the owner has sent that nobody has signed in against yet. The
  // server only returns these to the owner, so for everyone else it stays [].
  const [pendingFriends, setPendingFriends] = useState([]);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [convosOpen, setConvosOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [turtle3dOpen, setTurtle3dOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  // "Is there a new version, and what does it change?" — answered on the card
  // itself, before it is tapped. Metadata only; nothing downloads until the
  // panel's own button. Re-asked whenever the updates page is opened or closed
  // so the line is true again after an update has been applied.
  const { summary: updateSummary } = useUpdateHeadline({ active: !updatesOpen });
  // Server profile: the REAL display name, uploaded avatar and activity stats
  // (GET /me → { user: { displayName, avatarUrl, stats } }). The generated
  // animal name/disc are the FALLBACK for anyone who hasn't set either.
  const [me, setMe] = useState(null);
  // Which stat's detail page is open (null = none).
  const [statDetail, setStatDetail] = useState(null);
  // The full breakdown (GET /me/stats): daily series, streaks, rhythms, logs
  // and the rolling windows the strip's "today" chips are drawn from.
  const [statsDetail, setStatsDetail] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Load everything the identity card renders.
   *
   * WHY THIS IS ONE FUNCTION AND NOT THREE EFFECTS
   * It used to be three `useEffect`s keyed on `api`. `api` is memoised per
   * server (ServerContext), and Profile is a TAB — mounted once and kept
   * mounted — so every one of them ran exactly once per app launch and never
   * again. The strip then showed whatever the numbers were at launch: finish
   * five tasks and it still read the old total, which is what "outdated and the
   * data does not fetch" was. Now the same loader runs on mount, on every tab
   * focus, on foreground, and on pull-to-refresh.
   *
   * `/me/stats` is fetched here too rather than lazily on first stat tap. It
   * was held back as "the expensive breakdown", but it's ~10 grouped queries
   * over one user's rows, and the strip needs its `trend` block to show
   * movement. The throttle below is what keeps that honest.
   */
  const inFlight = useRef(false);
  const lastLoad = useRef(0);
  // The screen normally outlives every request it makes (it's a tab), but a
  // logout or server switch can unmount it mid-flight — same guard the effects
  // this replaced each carried.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const load = useCallback(async ({ force = false } = {}) => {
    // Tab focus fires on every switch back; without this a flick between tabs
    // would put three identical round-trips on the wire.
    if (inFlight.current) return;
    if (!force && Date.now() - lastLoad.current < 30000) return;
    inFlight.current = true;
    try {
      // Settled, not all-or-nothing: an older server with no /me/stats must
      // still leave the headline numbers and the friends list on screen.
      const [meRes, friendsRes, statsRes] = await Promise.allSettled([
        api.get('/me'),
        api.get('/friends'),
        api.get('/me/stats'),
      ]);
      if (!mounted.current) return;
      if (meRes.status === 'fulfilled' && meRes.value?.user) setMe(meRes.value.user);
      if (friendsRes.status === 'fulfilled') {
        const r = friendsRes.value;
        const list = Array.isArray(r?.friends) ? r.friends : (Array.isArray(r) ? r : []);
        setFriends(list);
        setFriendCount(list.length);
        setPendingFriends(Array.isArray(r?.pending) ? r.pending : []);
      }
      if (statsRes.status === 'fulfilled' && statsRes.value?.success) setStatsDetail(statsRes.value);
      lastLoad.current = Date.now();
    } finally {
      inFlight.current = false;
      if (mounted.current) setStatsLoading(false);
    }
  }, [api]);

  // Mount + every return to this tab. The throttle inside `load` means the
  // common case (tab away, tab back) costs nothing.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Coming back from the background is the other moment the numbers are stale —
  // the tab never lost focus, so useFocusEffect alone would not re-ask.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') load(); });
    return () => sub.remove();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load({ force: true }); } finally { setRefreshing(false); }
  }, [load]);

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

  const goTab = useCallback((tab) => { tapHaptic(); navigation.navigate(tab); }, [navigation]);

  // Server origin (no /api) so a server-relative avatar path resolves — same
  // construction Settings uses for its avatar.
  const serverBase = getBaseUrl().replace(/\/api$/, '');
  const avatarFullUrl = resolveAvatarUrl(me?.avatarUrl, serverBase);

  // Headline numbers. /me/stats is the fuller and fresher source; /me's own
  // stats block is the fallback that keeps the strip populated on an older
  // server or before the breakdown lands.
  const totals = statsDetail?.totals || null;
  const stats = me?.stats || null;
  const doneValue = totals?.completed ?? stats?.tasksCompleted ?? null;
  const focusValue = totals?.pomodoros ?? stats?.pomodoros ?? null;
  const pointsValue = totals?.points ?? stats?.points ?? null;
  const level = statsDetail?.level || stats?.level || null;
  const today = statsDetail?.trend?.today || null;

  /**
   * Everyone in the org ranked by points — me included.
   *
   * /api/friends returns each friend's stats but deliberately excludes the
   * caller, so "my rank" can't be read off it directly; splicing myself in is
   * what turns a list of names into a standing.
   */
  const leaderboard = useMemo(() => {
    const rows = friends.map((f) => {
      const fid = String(f.id ?? f.userId ?? f.phone ?? f.displayName ?? '');
      return {
        id: fid,
        name: f.displayName || f.phone || generatedName(fid),
        avatarUrl: f.avatarUrl || null,
        role: f.role,
        joined: f.joined !== false,
        stats: f.stats || {},
        isMe: false,
      };
    });
    rows.push({
      id: String(me?.id || identity),
      name,
      avatarUrl: me?.avatarUrl || null,
      role: me?.role,
      joined: true,
      // My own numbers come from the same two sources the strip uses, so a row
      // can't disagree with the card above it.
      stats: {
        points: pointsValue ?? 0,
        tasksCompleted: doneValue ?? 0,
        pomodoros: focusValue ?? 0,
        level,
      },
      isMe: true,
    });
    return rows
      .sort((a, b) => (b.stats?.points || 0) - (a.stats?.points || 0))
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }, [friends, me, identity, name, pointsValue, doneValue, focusValue, level]);
  const myRank = leaderboard.find((r) => r.isMe)?.rank || null;

  // Each cell is a number, a label, and one line of context under it. The
  // context prefers TODAY'S movement — that's what makes the strip feel live
  // rather than a set of totals that look identical every time it's opened —
  // and falls back to a standing fact so a cell is never bare.
  const fmtDelta = (n) => (n > 0 ? `+${n} today` : null);
  const STATS = [
    {
      key: 'friends',
      icon: 'account-group',
      value: friendCount,
      label: friendCount === 1 ? 'friend' : 'friends',
      hint: myRank && leaderboard.length > 1 ? `#${myRank} of ${leaderboard.length}` : null,
      onPress: () => setShowFriends(true),
    },
    {
      key: 'done',
      icon: 'check-circle',
      value: doneValue,
      label: 'done',
      hint: fmtDelta(today?.completed)
        || (statsDetail?.streak?.current > 0 ? `${statsDetail.streak.current}d streak` : null)
        || (statsDetail?.trend?.week?.completed ? `${statsDetail.trend.week.completed} this week` : null),
      onPress: () => setStatDetail('done'),
    },
    {
      key: 'focus',
      icon: 'timer',
      value: focusValue,
      label: 'focus',
      hint: fmtDelta(today?.pomodoros)
        || (totals?.focusMinutes ? `${fmtMinutes(totals.focusMinutes)} total` : null),
      onPress: () => setStatDetail('focus'),
    },
    {
      key: 'points',
      icon: 'star-four-points',
      value: pointsValue,
      label: 'points',
      hint: fmtDelta(today?.points) || level?.name || null,
      onPress: () => setStatDetail('points'),
    },
  ];

  const CARDS = [
    { key: 'vault', icon: 'shield-lock', label: 'Password Vault',
      sub: 'Your saved logins', onPress: () => { tapHaptic(); setVaultOpen(true); } },
    { key: 'chats', icon: 'forum', label: 'Board conversations',
      sub: 'Per-board chat + activity', onPress: () => { tapHaptic(); setConvosOpen(true); } },
    { key: 'claude', icon: 'robot', label: 'Claude session',
      sub: 'Code with Claude in chat', onPress: () => goTab('Turtle') },
    { key: 'terminal', icon: 'console', label: 'Terminal',
      sub: 'Remote shell', onPress: () => goTab('Turtle') },
    { key: 'turtle3d', icon: 'cube-outline', label: 'Turtle 3D',
      sub: 'Collab bridges, account and server',
      onPress: () => { tapHaptic(); setTurtle3dOpen(true); } },
    { key: 'link', icon: 'qrcode-scan', label: 'Connect to desktop',
      sub: 'Scan the QR shown on the web app',
      onPress: () => { tapHaptic(); setLinkOpen(true); } },
    // What this phone is running and whether anything newer is waiting. The
    // card's own line is the ANSWER, not a label: it names what the latest
    // update changed, so "is it worth updating?" is settled without opening
    // anything. Two lines, since a publish message is a sentence.
    { key: 'updates', icon: 'update', label: 'Check for updates',
      sub: updateSummary.line, subLines: 2,
      onPress: () => { tapHaptic(); setUpdatesOpen(true); } },
    { key: 'settings', icon: 'cog', label: 'Settings',
      sub: 'Appearance, server, account', onPress: () => { tapHaptic(); setSettingsOpen(true); } },
  ];

  const styles = makeStyles(theme);

  return (
    <View style={styles.page}>
      <ScrollView
        contentContainerStyle={{
          // Generous headroom above the identity card — the page has no title
          // bar, so this gap IS the top chrome and a tight one made the card
          // look jammed under the status bar.
          paddingTop: insets.top + 44,
          // Scrollable, so it may pass UNDER the dock — but it must be able to
          // scroll clear of it (turtle-chrome-underlay).
          paddingBottom: dockOccupied(insets.bottom) + 24 + keyboardHeight,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        // The manual escape hatch from the 30s throttle — a pull always goes to
        // the server, which is the behaviour a stale-looking number invites.
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.textSecondary} />
        }
      >
        {/* Identity card — a HERO block, not a settings row: an accent wash
            behind a ringed picture on the LEFT, with the name, handle, role and
            number stacked to its right, then the stats as a divided strip
            across the card's full width. */}
        <View style={styles.identityCard}>
          {/* Accent wash. Sits behind everything (absolute, non-interactive) and
              fades to nothing by mid-card, so the top of the card carries the
              user's chosen tint without colouring the text below it. */}
          <LinearGradient
            pointerEvents="none"
            colors={[(c.accent || c.accentInfo) + '2E', (c.accent || c.accentInfo) + '00']}
            style={styles.cardWash}
          />

          {/* Settings, pinned to the card's top-right. The Settings CARD lower
              down still works — this is the conventional place to reach for it
              on a profile, so it's a second door to the same page, not a move. */}
          <TouchableOpacity
            onPress={() => { tapHaptic(); setSettingsOpen(true); }}
            style={styles.cardGear}
            hitSlop={HIT}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Icon name="cog-outline" size={20} color={c.textSecondary} />
          </TouchableOpacity>

          {/* Top block: picture on the LEFT, everything else stacked to its
              right and left-aligned. */}
          <View style={styles.identityTop}>
          <View style={styles.avatarWrap}>
            {/* Ring in the accent, so the avatar reads as the card's focal
                point rather than another bordered disc. */}
            <View style={styles.avatarRing}>
              {/* The uploaded image wins; with none, the user's animal shows as
                  a silhouette in the same circle. */}
              <View style={styles.avatarCircle}>
                {avatarFullUrl ? (
                  <Image source={{ uri: avatarFullUrl }} style={styles.avatarImg} contentFit="cover" cachePolicy="memory-disk" transition={150} />
                ) : (
                  <Icon name={avatarAnimal(identity)} size={46} color={c.textTertiary} />
                )}
              </View>
            </View>
            {/* Changing the picture lives in Settings — this badge is a shortcut
                to it rather than a second uploader. */}
            <TouchableOpacity
              onPress={() => { tapHaptic(); setSettingsOpen(true); }}
              style={styles.avatarBadge}
              hitSlop={HIT}
              accessibilityRole="button"
              accessibilityLabel="Change your picture"
            >
              <Icon name="camera-outline" size={15} color={inkOn(c.accent || c.accentInfo)} />
            </TouchableOpacity>
          </View>

          <View style={styles.identityBody}>
          {editing ? (
            <AppTextInput
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

          {/* Handle + role. The generated animal name is this identity's stable
              handle, so it's worth showing even once a real name is set — it's
              what other surfaces fall back to. Shown only when it ISN'T already
              the displayed name, so it never reads as a duplicate. Role only
              appears when it's something other than a plain member. */}
          <View style={styles.metaRow}>
            {fallbackName !== name && (
              <View style={styles.handleChip}>
                <Icon name={avatarAnimal(identity)} size={12} color={c.textTertiary} />
                <Text style={styles.handleText} numberOfLines={1}>{fallbackName}</Text>
              </View>
            )}
            {!!me?.role && me.role !== 'member' && (
              <View style={styles.roleChip}>
                <Text style={styles.roleText}>{String(me.role).toUpperCase()}</Text>
              </View>
            )}
          </View>

          {!!me?.phone && (
            <View style={styles.phoneRow}>
              <Icon name="phone-outline" size={13} color={c.textMuted} />
              <Text style={styles.phoneText} numberOfLines={1}>{me.phone}</Text>
            </View>
          )}
          </View>
          </View>

          {/* Stat strip — a row of tappable counts. Each one is a drill-in:
              friends opens the list, the activity stats open a detail page for
              that metric. Values come from GET /me's stats block, so they're the
              server's real totals rather than anything recomputed here; a stat
              the server doesn't report is simply omitted. Hairline separators
              between cells, so it reads as one instrument rather than four
              loose numbers. */}
          <View style={styles.statStrip}>
            {STATS.map((s, i) => (
              <React.Fragment key={s.key}>
                {i > 0 && <View style={styles.statDivider} />}
                <TouchableOpacity
                  onPress={() => { tapHaptic(); s.onPress(); }}
                  style={styles.stat}
                  accessibilityRole="button"
                  accessibilityLabel={
                    s.value == null
                      ? `${s.label}, loading`
                      : `${s.value} ${s.label}${s.hint ? `, ${s.hint}` : ''}`
                  }
                >
                  <Icon name={s.icon} size={13} color={c.textMuted} style={{ marginBottom: 3 }} />
                  {/* An em dash while the first load is in flight, rather than
                      hiding the strip: a card that grows a row once the network
                      answers shifts everything under it. */}
                  <Text style={styles.statNum}>{s.value == null ? '—' : s.value}</Text>
                  <Text style={styles.statLabel} numberOfLines={1}>{s.label}</Text>
                  {/* Fixed-height slot so cells with a hint and cells without
                      still share a baseline. */}
                  <View style={styles.statHintSlot}>
                    {!!s.hint && (
                      <Text style={styles.statHint} numberOfLines={1}>{s.hint}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              </React.Fragment>
            ))}
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
                <Text style={styles.cardSub} numberOfLines={card.subLines || 1}>{card.sub}</Text>
              </View>
              <Icon name="chevron-right" size={20} color={c.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Friends — a standing, not a phone book. Pushed from the count. */}
      <FriendsPage
        visible={showFriends}
        onClose={() => setShowFriends(false)}
        leaderboard={leaderboard}
        pending={pendingFriends}
        serverBase={serverBase}
        refreshing={refreshing}
        onRefresh={onRefresh}
        theme={theme}
        insets={insets}
        styles={styles}
      />

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

      {/* Turtle 3D — read-only status for the collab side of this server. */}
      <EdgeSwipePage overlay visible={turtle3dOpen} onClose={() => setTurtle3dOpen(false)}>
        <Turtle3DPanel onClose={() => setTurtle3dOpen(false)} />
      </EdgeSwipePage>

      {/* Connect to desktop — the existing QR flow (web shows the code, this
          scans it), hosted here now that the chat header's button is gone. */}
      <LinkDesktop visible={linkOpen} onClose={() => setLinkOpen(false)} />

      {/* Check for updates — the SAME panel Settings shows, pushed from its own
          card so "what am I running / is there anything newer" is one tap from
          the profile instead of buried a screen deeper. A launcher, not a
          second implementation: the panel keeps the check, the download, the
          real error text and the owner's promote / roll back. */}
      <EdgeSwipePage overlay visible={updatesOpen} onClose={() => setUpdatesOpen(false)}>
        <View style={styles.page}>
          <View style={[styles.pushHeader, styles.pushHeaderCentered, { paddingTop: insets.top + 6 }]}>
            <TouchableOpacity
              onPress={() => setUpdatesOpen(false)}
              hitSlop={HIT}
              accessibilityLabel="Close updates"
              style={styles.pushHeaderSlot}
            >
              <Icon name="chevron-left" size={28} color={c.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.pushTitle, styles.pushTitleCentered]}>Updates</Text>
            <View style={styles.pushHeaderSlot} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: dockOccupied(insets.bottom) + 24 }}>
            {/* Same guard Settings gives it: a native-module throw in here
                must not take the profile down with it. */}
            {updatesOpen ? <ErrorBoundary label="App updates" compact><UpdatesPanel /></ErrorBoundary> : null}
          </ScrollView>
        </View>
      </EdgeSwipePage>

      {/* Settings — the standalone screen, pushed from its card. It was already
          a standalone component (TurtleScreen only wrapped it in a Modal), so
          this re-hosts rather than extracts. `active` gates its live polling to
          while it's actually on screen. */}
      <EdgeSwipePage overlay visible={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <View style={styles.page}>
          {/* The ONLY "Settings" title — the screen below used to draw its own
              underneath this one. Title centred, chevron pinned left; the empty
              slot opposite the chevron is what keeps the centring true (without
              it the title sits off-centre by the chevron's width). */}
          <View style={[styles.pushHeader, styles.pushHeaderCentered, { paddingTop: insets.top + 6 }]}>
            <TouchableOpacity
              onPress={() => setSettingsOpen(false)}
              hitSlop={HIT}
              accessibilityLabel="Close settings"
              style={styles.pushHeaderSlot}
            >
              <Icon name="chevron-left" size={28} color={c.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.pushTitle, styles.pushTitleCentered]}>Settings</Text>
            <View style={styles.pushHeaderSlot} />
          </View>
          <SettingsScreen active={settingsOpen} />
        </View>
      </EdgeSwipePage>

      {/* Stat detail — the full breakdown behind a number, plus its own sub-pages
          (the completions log, the focus log, the points ledger). Its own
          component so this screen isn't carrying an analytics page inline. */}
      <StatDetailPage
        metric={statDetail}
        detail={statsDetail}
        loading={statsLoading}
        headline={stats}
        rank={myRank}
        fieldSize={leaderboard.length}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onClose={() => setStatDetail(null)}
        onOpenTasks={() => { setStatDetail(null); goTab('Tasks'); }}
        onOpenFriends={() => { setStatDetail(null); setShowFriends(true); }}
        theme={theme}
        insets={insets}
        styles={styles}
      />

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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * What each stat page is MADE of.
 *
 * This table exists because the three pages used to share one set of arrays:
 * `weekday`, `hours`, `topBoards` and `recent` are all task-COMPLETION
 * queries, so the focus page drew the hours at which tasks were ticked off
 * under a heading that said "when you focus", and its "day streak" counted
 * completion days on a page where no timer may have run for a week. Each
 * metric now names the series it is actually about; the server sends both.
 */
const METRICS = {
  done: {
    title: 'Tasks completed',
    unit: 'completed',
    icon: 'check-circle',
    series: 'completed',        // field within detail.daily[]
    trendField: 'completed',    // field within detail.trend.<window>
    streakKey: 'streak',
    weekdayKey: 'weekday',
    hoursKey: 'hours',
    boardsKey: 'topBoards',
    boardField: 'completed',
    rhythmTitle: 'When you finish things',
    boardsTitle: 'Where you finish things',
    logKey: 'recent',
    logTitle: 'Recent completions',
  },
  focus: {
    title: 'Focus sessions',
    unit: 'sessions',
    icon: 'timer',
    series: 'pomodoros',
    trendField: 'pomodoros',
    streakKey: 'focusStreak',
    weekdayKey: 'focusWeekday',
    hoursKey: 'focusHours',
    boardsKey: 'topFocusBoards',
    boardField: 'minutes',
    boardSuffix: 'm',
    rhythmTitle: 'When you focus',
    boardsTitle: 'Where the time went',
    logKey: 'recentFocus',
    logTitle: 'Recent focus blocks',
  },
  points: {
    title: 'Points',
    unit: 'points',
    icon: 'star-four-points',
    series: 'points',
    trendField: 'points',
    streakKey: 'streak',
    // Points are earned by BOTH actions, so its rhythm is the two weighted
    // series added together — computed in the page, since no single server
    // array answers "when do you score".
    weekdayKey: null,
    hoursKey: null,
    boardsKey: 'topBoards',
    boardField: 'completed',
    rhythmTitle: 'When you score',
    boardsTitle: 'Where the points came from',
    logKey: 'recent',
    logTitle: 'Recent completions',
  },
};

/** Ordinal suffix for the rank line ("1st of 4"). */
const ordinal = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  const rem100 = v % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${v}th`;
  return `${v}${['th', 'st', 'nd', 'rd'][v % 10] || 'th'}`;
};

// "3d ago" / "just now" for the completions log. Local to this screen — the
// Notes screen has its own copy, and sharing one would couple two unrelated
// surfaces for four lines.
const formatRelativeTime = (ms) => {
  const t = Number(ms);
  if (!Number.isFinite(t) || t <= 0) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const fmtMinutes = (m) => {
  const mins = Math.max(0, Math.round(m || 0));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return mins % 60 === 0 ? `${h}h` : `${h}h ${mins % 60}m`;
};
const fmtDay = (iso) => {
  // 'YYYY-MM-DD' → 'Mar 4'. Parsed by parts, not Date(string), so it can't be
  // shifted a day by UTC interpretation.
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y) return '';
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/**
 * A bar chart of the daily series, drawn with plain Views.
 *
 * No chart library: the app ships none, and one bar per day is a handful of
 * flex children. Heights are a fraction of the window's own max so a quiet
 * period still reads — an absolute scale would flatten every bar to nothing.
 */
function DailyBars({ daily, field, tint, theme }) {
  const rows = Array.isArray(daily) ? daily : [];
  const max = rows.reduce((m, r) => Math.max(m, r?.[field] || 0), 0);
  if (!rows.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <View style={statStyles.chart}>
        {rows.map((r) => {
          const v = r?.[field] || 0;
          return (
            <View key={r.day} style={statStyles.chartCol}>
              <View
                style={[
                  statStyles.bar,
                  {
                    height: max > 0 ? Math.max(v > 0 ? 2 : 1, (v / max) * 92) : 1,
                    backgroundColor: v > 0 ? tint : theme.colors.border,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>
      <View style={statStyles.chartAxis}>
        <Text style={[statStyles.axisText, { color: theme.colors.textMuted }]}>{fmtDay(rows[0]?.day)}</Text>
        <Text style={[statStyles.axisText, { color: theme.colors.textMuted }]}>
          peak {max}
        </Text>
        <Text style={[statStyles.axisText, { color: theme.colors.textMuted }]}>{fmtDay(rows[rows.length - 1]?.day)}</Text>
      </View>
    </View>
  );
}

/** A labelled horizontal bar — used for weekday, hour-of-day and per-board rows. */
function RankRow({ label, value, max, tint, theme, suffix }) {
  const frac = max > 0 ? value / max : 0;
  return (
    <View style={statStyles.rankRow}>
      <Text style={[statStyles.rankLabel, { color: theme.colors.textSecondary }]} numberOfLines={1}>{label}</Text>
      <View style={[statStyles.rankTrack, { backgroundColor: theme.colors.surfaceElevated }]}>
        <View style={[statStyles.rankFill, { width: `${Math.round(frac * 100)}%`, backgroundColor: tint }]} />
      </View>
      <Text style={[statStyles.rankValue, { color: theme.colors.textPrimary }]}>{value}{suffix || ''}</Text>
    </View>
  );
}

/** Medal tint for the podium, or null for everyone else. */
const MEDAL = { 1: '#F5B301', 2: '#A8B3BD', 3: '#C9773F' };

/**
 * FriendsPage — the page behind the "friends" count.
 *
 * It used to be a list of names and nothing else, which threw away the fact
 * that /api/friends already returns each person's stats block. The same
 * response ranked by points is a standing: who is ahead, by how much, and where
 * you sit in it. The caller splices ITSELF into the list before passing it
 * here (the server excludes the requester), so "you" is a row like any other —
 * highlighted, but ranked honestly.
 */
function FriendsPage({
  visible, onClose, leaderboard, pending, serverBase, refreshing, onRefresh, theme, insets, styles,
}) {
  const c = theme.colors;
  const tint = c.accent || c.accentInfo;
  const top = leaderboard[0];
  // Totals across the whole pond — the "look what we did together" line, and
  // the reason this page is worth opening when you're not winning.
  const pondPoints = leaderboard.reduce((s, r) => s + (r.stats?.points || 0), 0);
  const pondDone = leaderboard.reduce((s, r) => s + (r.stats?.tasksCompleted || 0), 0);
  const pondFocus = leaderboard.reduce((s, r) => s + (r.stats?.pomodoros || 0), 0);

  return (
    <EdgeSwipePage overlay visible={visible} onClose={onClose}>
      <View style={styles.page}>
        <View style={[styles.pushHeader, { paddingTop: insets.top + 6 }]}>
          <TouchableOpacity onPress={onClose} hitSlop={HIT} accessibilityLabel="Back">
            <Icon name="chevron-left" size={28} color={c.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.pushTitle}>Friends</Text>
        </View>
        <ScrollView
          contentContainerStyle={{ paddingBottom: dockOccupied(insets.bottom) + 24 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.textSecondary} />
          }
        >
          {leaderboard.length <= 1 ? (
            <Text style={styles.empty}>
              No friends yet. Invite someone from Settings and this becomes a leaderboard.
            </Text>
          ) : (
            <>
              {/* What the pond has done between everyone in it. */}
              <View style={statStyles.grid}>
                {[
                  { label: 'Pond points', value: pondPoints },
                  { label: 'Tasks done', value: pondDone },
                  { label: 'Focus blocks', value: pondFocus },
                  { label: 'In the pond', value: leaderboard.length },
                ].map((g) => (
                  <View key={g.label} style={[statStyles.gridCell, { backgroundColor: c.surface, borderColor: c.border }]}>
                    <Text style={[statStyles.gridValue, { color: c.textPrimary }]} numberOfLines={1}>{g.value}</Text>
                    <Text style={[statStyles.gridLabel, { color: c.textTertiary }]} numberOfLines={1}>{g.label}</Text>
                  </View>
                ))}
              </View>

              <Text style={[statStyles.sectionHead, { color: c.textTertiary }]}>LEADERBOARD</Text>
              {leaderboard.map((r) => {
                const medal = MEDAL[r.rank];
                const pts = r.stats?.points || 0;
                // Distance to the person directly above — the number that makes
                // a standing feel catchable rather than fixed.
                const gap = top && r.rank > 1 ? (leaderboard[r.rank - 2]?.stats?.points || 0) - pts : 0;
                const avatar = resolveAvatarUrl(r.avatarUrl, serverBase);
                return (
                  <View
                    key={r.id}
                    style={[
                      statStyles.boardRow,
                      { borderColor: c.border },
                      r.isMe && { backgroundColor: tint + '14' },
                    ]}
                  >
                    <Text
                      style={[
                        statStyles.boardRank,
                        { color: medal || c.textMuted, fontWeight: medal ? '900' : '700' },
                      ]}
                    >
                      {r.rank}
                    </Text>
                    {avatar ? (
                      <Image
                        source={{ uri: avatar }}
                        style={statStyles.boardAvatar}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        transition={150}
                      />
                    ) : (
                      <AnimalAvatar id={r.id} size={38} />
                    )}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={statStyles.boardNameRow}>
                        <Text style={[statStyles.boardName, { color: c.textPrimary }]} numberOfLines={1}>
                          {r.name}
                        </Text>
                        {r.isMe && (
                          <View style={[statStyles.youChip, { backgroundColor: tint }]}>
                            <Text style={[statStyles.youChipText, { color: c.background }]}>YOU</Text>
                          </View>
                        )}
                        {!r.joined && (
                          <Text style={[statStyles.boardPending, { color: c.textMuted }]}>invited</Text>
                        )}
                      </View>
                      <Text style={[statStyles.boardMeta, { color: c.textTertiary }]} numberOfLines={1}>
                        {r.stats?.level?.name ? `${r.stats.level.name} · ` : ''}
                        {r.stats?.tasksCompleted || 0} done · {r.stats?.pomodoros || 0} focus
                        {gap > 0 ? ` · ${gap} behind` : ''}
                      </Text>
                    </View>
                    <Text style={[statStyles.boardPoints, { color: r.isMe ? tint : c.textPrimary }]}>{pts}</Text>
                  </View>
                );
              })}
            </>
          )}

          {/* Owner-only: invites nobody has signed in against yet. They have no
              stats to rank, so they sit below the board rather than at the
              bottom of it on zero points. */}
          {pending.length > 0 && (
            <>
              <Text style={[statStyles.sectionHead, { color: c.textTertiary }]}>INVITED</Text>
              {pending.map((p) => (
                <View key={p.phone} style={styles.friendRow}>
                  <AnimalAvatar id={p.phone} size={38} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.friendName} numberOfLines={1}>{p.phone}</Text>
                    <Text style={[statStyles.boardMeta, { color: c.textTertiary }]} numberOfLines={1}>
                      Hasn&apos;t signed in yet
                      {p.invitedAt ? ` · invited ${formatRelativeTime(p.invitedAt)}` : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      </View>
    </EdgeSwipePage>
  );
}

/**
 * StatDetailPage — the page behind a profile stat, plus its sub-pages.
 *
 * Level 1 is the breakdown: a hero figure, a 90-day bar chart, a grid of
 * related figures, streaks, and per-dimension rankings. Level 2 is the LOG —
 * the individual records behind the number — pushed as its own EdgeSwipePage so
 * the back-swipe steps up one level at a time (a sub-page that shared its
 * parent's page would slide away with nothing left to show).
 */
function StatDetailPage({
  metric, detail, loading, headline, rank, fieldSize, refreshing, onRefresh,
  onClose, onOpenTasks, onOpenFriends, theme, insets, styles,
}) {
  const [sub, setSub] = useState(null);
  const c = theme.colors;
  const tint = c.accent || c.accentInfo;
  useEffect(() => { if (!metric) setSub(null); }, [metric]);

  const meta = METRICS[metric] || METRICS.done;
  const totals = detail?.totals;
  // The metric's OWN streak: focus counts days a timer ran, the others count
  // days something was finished.
  const streak = detail?.[meta.streakKey] || null;
  const log = Array.isArray(detail?.[meta.logKey]) ? detail[meta.logKey] : [];
  const perTask = detail?.points?.perTask ?? 10;
  const perPomodoro = detail?.points?.perPomodoro ?? 5;

  // Headline figure: the detailed totals when they've landed, else the numbers
  // the profile already had — so the page is never blank while loading, and a
  // degraded /me/stats (which now omits `totals` entirely) falls through to the
  // real number rather than overwriting it with a zero.
  const value = metric === 'focus'
    ? (totals?.pomodoros ?? headline?.pomodoros ?? 0)
    : metric === 'points'
      ? (totals?.points ?? headline?.points ?? 0)
      : (totals?.completed ?? headline?.tasksCompleted ?? 0);

  const completionRate = totals?.created ? Math.round((totals.completed / totals.created) * 100) : null;
  // `points` per day is newer than the rest of this payload; derive it from the
  // two series when an older server hasn't sent it, so the points chart isn't a
  // flat line against a pond that hasn't been updated yet.
  const rawDaily = Array.isArray(detail?.daily) ? detail.daily : [];
  const daily = metric === 'points' && rawDaily.length && rawDaily[0]?.points == null
    ? rawDaily.map((d) => ({
      ...d,
      points: (d?.completed || 0) * perTask + (d?.pomodoros || 0) * perPomodoro,
    }))
    : rawDaily;
  const windowDays = detail?.windowDays ?? 90;
  const windowTotal = daily.reduce((s, d) => s + (d?.[meta.series] || 0), 0);

  // Movement, in this metric's own unit. This is the block that answers "is
  // this number going anywhere" — the old page only ever showed lifetime
  // totals, which look identical on every visit.
  const trend = detail?.trend || null;
  const f = meta.trendField;
  const thisWeek = trend?.week?.[f] ?? null;
  const lastWeek = trend?.prevWeek?.[f] ?? null;
  const weekDelta = thisWeek != null && lastWeek != null ? thisWeek - lastWeek : null;

  // Per-day averages over the days that actually had activity, not over the
  // whole window — "2.4 on a working day" is a truer self-description than a
  // figure diluted by every weekend off.
  const activeDays = trend?.activeDays || 0;
  const perActiveDay = activeDays > 0 ? (windowTotal / activeDays) : null;

  // The grid under the chart. Each metric gets the figures that actually
  // explain it rather than one shared set.
  const GRID = metric === 'focus'
    ? [
      { label: 'Focus time', value: fmtMinutes(totals?.focusMinutes) },
      { label: 'Avg session', value: totals?.pomodoros ? fmtMinutes((totals.focusMinutes || 0) / totals.pomodoros) : '—' },
      { label: `Last ${windowDays}d`, value: windowTotal },
      { label: 'Points earned', value: detail?.points?.fromPomodoros ?? '—' },
    ]
    : metric === 'points'
      ? [
        { label: 'From tasks', value: detail?.points?.fromTasks ?? '—' },
        { label: 'From focus', value: detail?.points?.fromPomodoros ?? '—' },
        { label: 'Per task', value: perTask },
        { label: 'Per session', value: perPomodoro },
      ]
      : [
        { label: 'Created', value: totals?.created ?? headline?.tasksCreated ?? '—' },
        { label: 'Still open', value: totals?.open ?? '—' },
        { label: 'Overdue', value: totals?.overdue ?? '—' },
        { label: 'Completion', value: completionRate == null ? '—' : `${completionRate}%` },
      ];

  // Rhythm arrays, chosen per metric. Points has no server array of its own
  // (it isn't a logged event — it's a weighting of two others), so its rhythm
  // is the two weighted series summed.
  const blend = (a, b) => {
    const A = Array.isArray(a) ? a : [];
    const B = Array.isArray(b) ? b : [];
    const n = Math.max(A.length, B.length);
    return Array.from({ length: n }, (_, i) => (A[i] || 0) * perTask + (B[i] || 0) * perPomodoro);
  };
  const weekday = meta.weekdayKey
    ? (Array.isArray(detail?.[meta.weekdayKey]) ? detail[meta.weekdayKey] : [])
    : blend(detail?.weekday, detail?.focusWeekday);
  const weekdayMax = weekday.reduce((m, n) => Math.max(m, n), 0);
  const hours = meta.hoursKey
    ? (Array.isArray(detail?.[meta.hoursKey]) ? detail[meta.hoursKey] : [])
    : blend(detail?.hours, detail?.focusHours);
  const hoursMax = hours.reduce((m, n) => Math.max(m, n), 0);

  const topBoards = Array.isArray(detail?.[meta.boardsKey]) ? detail[meta.boardsKey] : [];
  const boardMax = topBoards.reduce((m, b) => Math.max(m, b?.[meta.boardField] || 0), 0);
  // Only the busiest few hours are worth a row — 24 bars of mostly zero is noise.
  const topHours = hours
    .map((n, h) => ({ h, n }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);

  const level = detail?.level || headline?.level || null;
  const best = detail?.best || null;
  // The personal best that belongs to THIS metric, phrased in its own unit.
  const bestLine = metric === 'focus'
    ? (best?.focusDay ? `${best.focusDay.n} blocks · ${fmtMinutes(best.focusDay.minutes)}` : null)
    : (best?.doneDay ? `${best.doneDay.n} tasks` : null);
  const bestDay = metric === 'focus' ? best?.focusDay?.day : best?.doneDay?.day;

  return (
    <EdgeSwipePage overlay visible={!!metric} onClose={onClose} swipeEnabled={!sub}>
      <View style={styles.page}>
        <View style={[styles.pushHeader, { paddingTop: insets.top + 6 }]}>
          <TouchableOpacity onPress={onClose} hitSlop={HIT} accessibilityLabel="Back">
            <Icon name="chevron-left" size={28} color={c.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.pushTitle}>{meta.title}</Text>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: dockOccupied(insets.bottom) + 24 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.textSecondary} />
          }
        >
          {/* Hero. The metric's icon sits above the figure so the three pages
              are distinguishable at a glance rather than by their title alone. */}
          <View style={statStyles.hero}>
            <Icon name={meta.icon} size={22} color={tint} style={{ marginBottom: 6 }} />
            <Text style={[statStyles.heroValue, { color: c.textPrimary }]}>{value}</Text>
            <Text style={[statStyles.heroUnit, { color: c.textTertiary }]}>{meta.unit}</Text>
            {/* Week-on-week, right under the headline: the difference between a
                trophy cabinet and a dashboard. */}
            {weekDelta != null && (thisWeek > 0 || lastWeek > 0) && (
              <View style={[statStyles.deltaChip, { backgroundColor: (weekDelta >= 0 ? tint : c.textMuted) + '22' }]}>
                <Icon
                  name={weekDelta > 0 ? 'trending-up' : weekDelta < 0 ? 'trending-down' : 'trending-neutral'}
                  size={13}
                  color={weekDelta >= 0 ? tint : c.textSecondary}
                />
                <Text style={[statStyles.deltaText, { color: weekDelta >= 0 ? tint : c.textSecondary }]}>
                  {weekDelta === 0
                    ? 'level with last week'
                    : `${weekDelta > 0 ? '+' : ''}${weekDelta} vs last week`}
                </Text>
              </View>
            )}
            {loading && !detail && <ActivityIndicator style={{ marginTop: 10 }} color={c.textTertiary} />}
          </View>

          {/* Level — only on the points page, where it IS the story: which tier
              the score sits in and how far the next one is. */}
          {metric === 'points' && !!level && (
            <View style={[statStyles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={statStyles.levelHead}>
                <Icon name="shield-star" size={20} color={tint} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[statStyles.levelName, { color: c.textPrimary }]} numberOfLines={1}>
                    {level.name}
                  </Text>
                  <Text style={[statStyles.linkSub, { color: c.textTertiary }]} numberOfLines={1}>
                    {level.nextName
                      ? `${level.toNext} points to ${level.nextName}`
                      : 'Top tier — nothing left to climb'}
                  </Text>
                </View>
                <Text style={[statStyles.levelPct, { color: tint }]}>
                  {Math.round((level.progress || 0) * 100)}%
                </Text>
              </View>
              {/* Deliberately NOT statStyles.rankTrack: that one is flex:1 for
                  its row layout, and flexBasis:0 inside this column would fight
                  the fixed height. */}
              <View style={[statStyles.levelTrack, { backgroundColor: c.surfaceElevated }]}>
                <View
                  style={[
                    statStyles.rankFill,
                    { width: `${Math.round((level.progress || 0) * 100)}%`, backgroundColor: tint },
                  ]}
                />
              </View>
              {/* The whole ladder, so what's ahead is visible rather than a
                  surprise. Reached tiers are tinted; the rest are outlines. */}
              {Array.isArray(detail?.levels) && (
                <View style={statStyles.ladder}>
                  {detail.levels.map((l, i) => (
                    <View key={l.name} style={statStyles.ladderCell}>
                      <View
                        style={[
                          statStyles.ladderDot,
                          {
                            backgroundColor: i <= level.index ? tint : 'transparent',
                            borderColor: i <= level.index ? tint : c.border,
                          },
                        ]}
                      />
                      <Text
                        style={[
                          statStyles.ladderLabel,
                          { color: i === level.index ? c.textPrimary : c.textMuted },
                        ]}
                        numberOfLines={1}
                      >
                        {l.name}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Today / week / month, in this metric's unit. */}
          {!!trend && (
            <View style={statStyles.grid}>
              {[
                { label: 'Today', value: trend.today?.[f] ?? 0 },
                { label: 'This week', value: thisWeek ?? 0 },
                { label: 'This month', value: trend.month?.[f] ?? 0 },
                { label: `Active days / ${windowDays}`, value: activeDays },
              ].map((g) => (
                <View key={g.label} style={[statStyles.gridCell, { backgroundColor: c.surface, borderColor: c.border }]}>
                  <Text style={[statStyles.gridValue, { color: c.textPrimary }]} numberOfLines={1}>{g.value}</Text>
                  <Text style={[statStyles.gridLabel, { color: c.textTertiary }]} numberOfLines={1}>{g.label}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Streaks — the one figure that rewards consistency rather than volume. */}
          {!!streak && (
            <View style={[statStyles.streakRow, { borderColor: c.border }]}>
              <View style={statStyles.streakCell}>
                <Icon name="fire" size={18} color={streak.current > 0 ? tint : c.textMuted} />
                <Text style={[statStyles.streakNum, { color: c.textPrimary }]}>{streak.current}</Text>
                <Text style={[statStyles.streakLabel, { color: c.textTertiary }]}>
                  {metric === 'focus' ? 'focus streak' : 'day streak'}
                </Text>
              </View>
              <View style={[statStyles.streakDivider, { backgroundColor: c.border }]} />
              <View style={statStyles.streakCell}>
                <Icon name="trophy-outline" size={18} color={c.textMuted} />
                <Text style={[statStyles.streakNum, { color: c.textPrimary }]}>{streak.best}</Text>
                <Text style={[statStyles.streakLabel, { color: c.textTertiary }]}>best ever</Text>
              </View>
              {perActiveDay != null && (
                <>
                  <View style={[statStyles.streakDivider, { backgroundColor: c.border }]} />
                  <View style={statStyles.streakCell}>
                    <Icon name="chart-line" size={18} color={c.textMuted} />
                    <Text style={[statStyles.streakNum, { color: c.textPrimary }]}>
                      {perActiveDay >= 10 ? Math.round(perActiveDay) : perActiveDay.toFixed(1)}
                    </Text>
                    <Text style={[statStyles.streakLabel, { color: c.textTertiary }]}>per active day</Text>
                  </View>
                </>
              )}
            </View>
          )}

          {/* Personal best — the record to beat, with the day it happened. */}
          {!!bestLine && metric !== 'points' && (
            <View style={[statStyles.bestCard, { backgroundColor: tint + '14', borderColor: tint + '33' }]}>
              <Icon name="medal-outline" size={22} color={tint} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[statStyles.linkTitle, { color: c.textPrimary }]} numberOfLines={1}>
                  Best day: {bestLine}
                </Text>
                <Text style={[statStyles.linkSub, { color: c.textTertiary }]} numberOfLines={1}>
                  {fmtDay(bestDay)}
                  {metric === 'focus' && best?.longestSession
                    ? ` · longest block ${fmtMinutes(best.longestSession)}`
                    : ''}
                </Text>
              </View>
            </View>
          )}

          {/* Standing among the pond — on the points page, because points are
              what the leaderboard ranks by. */}
          {metric === 'points' && !!rank && fieldSize > 1 && (
            <TouchableOpacity
              style={[statStyles.bestCard, { backgroundColor: tint + '14', borderColor: tint + '33' }]}
              onPress={() => { tapHaptic(); onOpenFriends(); }}
              accessibilityRole="button"
              accessibilityLabel="Open the leaderboard"
            >
              <Icon name="podium" size={22} color={tint} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[statStyles.linkTitle, { color: c.textPrimary }]} numberOfLines={1}>
                  {ordinal(rank)} of {fieldSize} in the pond
                </Text>
                <Text style={[statStyles.linkSub, { color: c.textTertiary }]} numberOfLines={1}>
                  See the full leaderboard
                </Text>
              </View>
              <Icon name="chevron-right" size={20} color={c.textMuted} />
            </TouchableOpacity>
          )}

          {/* 90-day chart */}
          {daily.length > 0 && (
            <View style={[statStyles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[statStyles.cardTitle, { color: c.textPrimary }]}>
                Last {windowDays} days · {windowTotal} {meta.unit}
              </Text>
              <DailyBars daily={daily} field={meta.series} tint={tint} theme={theme} />
            </View>
          )}

          {/* Figures grid */}
          <View style={statStyles.grid}>
            {GRID.map((g) => (
              <View key={g.label} style={[statStyles.gridCell, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Text style={[statStyles.gridValue, { color: c.textPrimary }]} numberOfLines={1}>{g.value}</Text>
                <Text style={[statStyles.gridLabel, { color: c.textTertiary }]} numberOfLines={1}>{g.label}</Text>
              </View>
            ))}
          </View>

          {/* Rhythm — when the work actually happens, measured in this metric. */}
          {weekdayMax > 0 && (
            <View style={[statStyles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[statStyles.cardTitle, { color: c.textPrimary }]}>{meta.rhythmTitle}</Text>
              {weekday.map((n, i) => (
                <RankRow key={i} label={WEEKDAYS[i]} value={n} max={weekdayMax} tint={tint} theme={theme} />
              ))}
            </View>
          )}

          {topHours.length > 0 && (
            <View style={[statStyles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[statStyles.cardTitle, { color: c.textPrimary }]}>Peak hours</Text>
              {topHours.map((x) => (
                <RankRow
                  key={x.h}
                  label={`${String(x.h).padStart(2, '0')}:00`}
                  value={x.n}
                  max={hoursMax}
                  tint={tint}
                  theme={theme}
                />
              ))}
            </View>
          )}

          {topBoards.length > 0 && (
            <View style={[statStyles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[statStyles.cardTitle, { color: c.textPrimary }]}>{meta.boardsTitle}</Text>
              {topBoards.map((b) => (
                <RankRow
                  key={b.name}
                  label={b.name}
                  value={b[meta.boardField] || 0}
                  max={boardMax}
                  tint={tint}
                  theme={theme}
                  suffix={meta.boardSuffix}
                />
              ))}
            </View>
          )}

          {/* Sub-pages */}
          <View style={statStyles.links}>
            <TouchableOpacity
              style={[statStyles.linkRow, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}
              onPress={() => { tapHaptic(); setSub('log'); }}
              accessibilityRole="button"
              accessibilityLabel={meta.logTitle}
            >
              <Icon name="history" size={20} color={tint} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[statStyles.linkTitle, { color: c.textPrimary }]}>{meta.logTitle}</Text>
                <Text style={[statStyles.linkSub, { color: c.textTertiary }]} numberOfLines={1}>
                  {log.length
                    ? `The last ${log.length} records behind this number`
                    : 'Nothing recorded yet'}
                </Text>
              </View>
              <Icon name="chevron-right" size={20} color={c.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[statStyles.linkRow, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}
              onPress={() => { tapHaptic(); setSub('scoring'); }}
              accessibilityRole="button"
              accessibilityLabel="How points are scored"
            >
              <Icon name="calculator-variant-outline" size={20} color={tint} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[statStyles.linkTitle, { color: c.textPrimary }]}>How points are scored</Text>
                <Text style={[statStyles.linkSub, { color: c.textTertiary }]} numberOfLines={1}>
                  The full ledger behind your total
                </Text>
              </View>
              <Icon name="chevron-right" size={20} color={c.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[statStyles.linkRow, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}
              onPress={onOpenTasks}
              accessibilityRole="button"
              accessibilityLabel="Open tasks"
            >
              <Icon name="check-circle-outline" size={20} color={tint} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[statStyles.linkTitle, { color: c.textPrimary }]}>Open the task list</Text>
                <Text style={[statStyles.linkSub, { color: c.textTertiary }]} numberOfLines={1}>
                  Where these records come from
                </Text>
              </View>
              <Icon name="chevron-right" size={20} color={c.textMuted} />
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* SUB-PAGE: the log behind the number. Its own page so the back-swipe
            returns here rather than closing the whole stat.

            The rows differ by metric: completions are "task, when", focus
            blocks are "task, when, how long". The focus page used to show the
            completions log, which listed tasks that no timer had ever run
            against. */}
        <EdgeSwipePage overlay visible={sub === 'log'} onClose={() => setSub(null)}>
          <View style={styles.page}>
            <View style={[styles.pushHeader, { paddingTop: insets.top + 6 }]}>
              <TouchableOpacity onPress={() => setSub(null)} hitSlop={HIT} accessibilityLabel="Back">
                <Icon name="chevron-left" size={28} color={c.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.pushTitle}>{meta.logTitle}</Text>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: dockOccupied(insets.bottom) + 24 }}>
              {log.length === 0 ? (
                <Text style={styles.empty}>
                  {metric === 'focus' ? 'No focus blocks finished yet.' : 'No completed tasks yet.'}
                </Text>
              ) : log.map((r) => (
                <View key={String(r.id)} style={statStyles.logRow}>
                  <Icon
                    name={metric === 'focus' ? 'timer' : 'check-circle'}
                    size={18}
                    color={tint}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[statStyles.logTitle, { color: c.textPrimary }]} numberOfLines={1}>{r.title}</Text>
                    <Text style={[statStyles.logMeta, { color: c.textTertiary }]} numberOfLines={1}>
                      {formatRelativeTime(metric === 'focus' ? r.at : r.completedAt)}
                      {r.project ? ` · ${r.project}` : ''}
                    </Text>
                  </View>
                  {metric === 'focus' && !!r.minutes && (
                    <Text style={[statStyles.logMinutes, { color: c.textSecondary }]}>
                      {fmtMinutes(r.minutes)}
                    </Text>
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        </EdgeSwipePage>

        {/* SUB-PAGE: the scoring ledger. */}
        <EdgeSwipePage overlay visible={sub === 'scoring'} onClose={() => setSub(null)}>
          <View style={styles.page}>
            <View style={[styles.pushHeader, { paddingTop: insets.top + 6 }]}>
              <TouchableOpacity onPress={() => setSub(null)} hitSlop={HIT} accessibilityLabel="Back">
                <Icon name="chevron-left" size={28} color={c.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.pushTitle}>How points are scored</Text>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: dockOccupied(insets.bottom) + 24, paddingHorizontal: 16 }}>
              <Text style={[statStyles.ledgerNote, { color: c.textSecondary }]}>
                Points are computed by the server from two actions. The weights
                below are the live ones — change them there and this page follows.
              </Text>
              {[
                {
                  icon: 'check-circle-outline',
                  label: 'Completed tasks',
                  count: totals?.completed ?? 0,
                  each: detail?.points?.perTask ?? 0,
                  total: detail?.points?.fromTasks ?? 0,
                },
                {
                  icon: 'timer-outline',
                  label: 'Focus sessions',
                  count: totals?.pomodoros ?? 0,
                  each: detail?.points?.perPomodoro ?? 0,
                  total: detail?.points?.fromPomodoros ?? 0,
                },
              ].map((row) => (
                <View key={row.label} style={[statStyles.ledgerRow, { borderColor: c.border }]}>
                  <Icon name={row.icon} size={20} color={tint} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[statStyles.linkTitle, { color: c.textPrimary }]}>{row.label}</Text>
                    <Text style={[statStyles.linkSub, { color: c.textTertiary }]}>
                      {row.count} × {row.each} pts
                    </Text>
                  </View>
                  <Text style={[statStyles.ledgerTotal, { color: c.textPrimary }]}>{row.total}</Text>
                </View>
              ))}
              <View style={[statStyles.ledgerRow, { borderColor: 'transparent' }]}>
                <View style={{ width: 20 }} />
                <Text style={[statStyles.linkTitle, { flex: 1, color: c.textPrimary }]}>Total</Text>
                <Text style={[statStyles.ledgerTotal, { color: tint }]}>
                  {totals?.points ?? headline?.points ?? 0}
                </Text>
              </View>

              {/* What the total buys. The ladder is the server's, so a tier
                  rename or a re-weighting shows up here without a new build. */}
              {!!level && (
                <>
                  <Text style={[statStyles.sectionHead, { color: c.textTertiary, paddingHorizontal: 0 }]}>
                    TIERS
                  </Text>
                  {(Array.isArray(detail?.levels) ? detail.levels : []).map((l, i) => (
                    <View key={l.name} style={[statStyles.ledgerRow, { borderColor: c.border }]}>
                      <Icon
                        name={i <= level.index ? 'shield-star' : 'shield-outline'}
                        size={20}
                        color={i <= level.index ? tint : c.textMuted}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          style={[
                            statStyles.linkTitle,
                            { color: i === level.index ? tint : c.textPrimary },
                          ]}
                        >
                          {l.name}{i === level.index ? ' · you are here' : ''}
                        </Text>
                        <Text style={[statStyles.linkSub, { color: c.textTertiary }]}>
                          {l.floor === 0 ? 'from the start' : `${l.floor} points`}
                        </Text>
                      </View>
                      {i === level.index + 1 && (
                        <Text style={[statStyles.linkSub, { color: c.textSecondary }]}>
                          {level.toNext} to go
                        </Text>
                      )}
                    </View>
                  ))}
                </>
              )}
            </ScrollView>
          </View>
        </EdgeSwipePage>
      </View>
    </EdgeSwipePage>
  );
}

// Stat-page chrome. Theme colours are applied inline (this sheet is built once,
// outside the component, so it can't close over the palette).
const statStyles = StyleSheet.create({
  hero: { alignItems: 'center', paddingTop: 18, paddingBottom: 20 },
  heroValue: { fontSize: 56, fontWeight: '800', letterSpacing: -1 },
  heroUnit: { fontSize: 13, marginTop: 2 },
  // Week-on-week pill under the hero figure.
  deltaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, marginTop: 10,
  },
  deltaText: { fontSize: 12, fontWeight: '700' },
  sectionHead: {
    fontSize: 11, fontWeight: '800', letterSpacing: 0.8,
    paddingHorizontal: 16, marginTop: 10, marginBottom: 6,
  },
  // Level block on the points page.
  levelHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  levelName: { fontSize: 17, fontWeight: '800' },
  levelPct: { fontSize: 15, fontWeight: '800' },
  // Full-width bar in a COLUMN container — alignSelf:'stretch' rather than
  // flex:1, so it spans the card without growing vertically.
  levelTrack: {
    alignSelf: 'stretch', height: 10, borderRadius: 5,
    overflow: 'hidden', marginTop: 12,
  },
  ladder: { flexDirection: 'row', marginTop: 14 },
  ladderCell: { flex: 1, alignItems: 'center', gap: 5 },
  ladderDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  // 9pt because eight tier names have to share the card's width.
  ladderLabel: { fontSize: 9, fontWeight: '600' },
  // Personal-best / standing callout: tinted, so it reads as an award rather
  // than another data card.
  bestCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    marginHorizontal: 16, marginBottom: 14, padding: 14,
    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth,
  },
  // Leaderboard rows.
  boardRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // Fixed width so avatars line up however many digits the rank has.
  boardRank: { width: 22, fontSize: 15, textAlign: 'center' },
  boardAvatar: { width: 38, height: 38, borderRadius: 19 },
  boardNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  boardName: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  boardMeta: { fontSize: 12, marginTop: 1 },
  boardPoints: { fontSize: 17, fontWeight: '800' },
  boardPending: { fontSize: 11, fontStyle: 'italic' },
  youChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  youChipText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  streakRow: {
    flexDirection: 'row', marginHorizontal: 16, marginBottom: 14,
    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 14,
  },
  streakCell: { flex: 1, alignItems: 'center', gap: 2 },
  streakDivider: { width: StyleSheet.hairlineWidth, marginVertical: 6 },
  streakNum: { fontSize: 22, fontWeight: '800' },
  streakLabel: { fontSize: 11 },
  card: {
    marginHorizontal: 16, marginBottom: 14, padding: 14,
    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth,
  },
  cardTitle: { fontSize: 13, fontWeight: '700', marginBottom: 12 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 92, gap: 1 },
  chartCol: { flex: 1, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 1.5, minHeight: 1 },
  chartAxis: { flexDirection: 'row', justifyContent: 'space-between' },
  axisText: { fontSize: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16, marginBottom: 14 },
  gridCell: {
    // Two per row: half the width minus half the 10pt gap.
    width: '48%', flexGrow: 1,
    padding: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth,
  },
  gridValue: { fontSize: 20, fontWeight: '800' },
  gridLabel: { fontSize: 11, marginTop: 2 },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  rankLabel: { width: 54, fontSize: 12, fontWeight: '600' },
  rankTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  rankFill: { height: '100%', borderRadius: 4, minWidth: 2 },
  rankValue: { width: 40, textAlign: 'right', fontSize: 12, fontWeight: '700' },
  links: { paddingHorizontal: 16, gap: 10, marginTop: 2 },
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth,
  },
  linkTitle: { fontSize: 15, fontWeight: '600' },
  linkSub: { fontSize: 12, marginTop: 1 },
  logRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 11,
  },
  logTitle: { fontSize: 15, fontWeight: '600' },
  logMeta: { fontSize: 12, marginTop: 1 },
  logMinutes: { fontSize: 13, fontWeight: '700' },
  ledgerNote: { fontSize: 13, lineHeight: 19, marginBottom: 16 },
  ledgerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ledgerTotal: { fontSize: 18, fontWeight: '800' },
});

const makeStyles = (theme) => {
  const c = theme.colors;
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: c.background },
    // Hero card: centred column, taller radius than the list cards below so it
    // reads as the page's header rather than the first row of the list.
    identityCard: {
      // Stretch, not centre: the top block is a ROW (picture left, details
      // right) and the stat strip spans the full width beneath it.
      alignItems: 'stretch',
      backgroundColor: c.surface,
      borderRadius: 22,
      paddingHorizontal: 16,
      paddingTop: 22,
      paddingBottom: 6,
      marginHorizontal: 16,
      borderWidth: 0.5,
      borderColor: c.border,
      // Clips the accent wash to the rounded corners.
      overflow: 'hidden',
      ...depth(theme, 'card'),
    },
    // Accent wash behind the card's top half.
    cardWash: {
      position: 'absolute', top: 0, left: 0, right: 0, height: 150,
    },
    // Top-right gear. Absolute so it hangs off the card's own corner and takes
    // no space in the centred column below it.
    cardGear: {
      position: 'absolute', top: 10, right: 10,
      width: 34, height: 34, borderRadius: 17,
      alignItems: 'center', justifyContent: 'center',
    },
    // Picture on the left, details column on the right. The picture is CENTRED
    // against that column rather than top-aligned to it, so it sits on the
    // block's middle line however many lines the details happen to run to
    // (name only, name + chips, name + chips + number).
    identityTop: { flexDirection: 'row', alignItems: 'center' },
    avatarWrap: { width: 96, height: 96 },
    // Everything that isn't the picture. paddingRight clears the gear pinned to
    // the card's top-right corner, so a long name can't run under it.
    identityBody: { flex: 1, minWidth: 0, marginLeft: 16, paddingRight: 30 },
    // Accent ring around the avatar — 2pt, drawn as a padded circle so the
    // photo inside keeps its own hairline border.
    avatarRing: {
      width: 96, height: 96, borderRadius: 48,
      borderWidth: 2, borderColor: c.accent || c.accentInfo,
      alignItems: 'center', justifyContent: 'center',
    },
    avatarCircle: {
      width: 84,
      height: 84,
      borderRadius: 42,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceElevated,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      ...depth(theme, 'control'),
    },
    // Shortcut to the avatar uploader in Settings, pinned to the ring's
    // lower-right like a camera badge.
    avatarBadge: {
      position: 'absolute', right: -2, bottom: -2,
      width: 28, height: 28, borderRadius: 14,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: c.accent || c.accentInfo,
      borderWidth: 2, borderColor: c.surface,
    },
    // Every block in the details column stretches to that column's width and
    // aligns LEFT, so the text flows out from the picture rather than being a
    // shrink-wrapped stack. The column itself is flex:1, so the card fills
    // whatever width the page gives it.
    nameRow: {
      flexDirection: 'row', alignItems: 'center',
      gap: 6, alignSelf: 'stretch',
    },
    name: { fontSize: 22, fontWeight: '700', color: c.textPrimary, flexShrink: 1 },
    nameInput: {
      fontSize: 22, fontWeight: '700', color: c.textPrimary,
      alignSelf: 'stretch',
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
      paddingVertical: 2,
    },
    // Fills the bordered circle above (which clips it).
    avatarImg: { width: '100%', height: '100%' },
    metaRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8,
      flexWrap: 'wrap', alignSelf: 'stretch',
    },
    handleChip: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999,
      backgroundColor: c.surfaceElevated,
      // Shrinks rather than pushing the row wider than the card.
      flexShrink: 1, maxWidth: '100%',
      ...depth(theme, 'control'),
    },
    handleText: { fontSize: 12, fontWeight: '600', color: c.textTertiary, flexShrink: 1 },
    roleChip: {
      paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999,
      backgroundColor: (c.accent || c.accentInfo) + '26',
    },
    roleText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: c.accent || c.accentInfo },
    phoneRow: {
      flexDirection: 'row', alignItems: 'center',
      gap: 5, marginTop: 8, alignSelf: 'stretch',
    },
    phoneText: { fontSize: 13, color: c.textMuted, flexShrink: 1 },
    // Full-width divided strip across the bottom of the card.
    statStrip: {
      flexDirection: 'row', alignItems: 'stretch', alignSelf: 'stretch',
      marginTop: 18, paddingTop: 14,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
    },
    statDivider: { width: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: 2 },
    // paddingHorizontal is 4, not 6: the cells now carry a hint line ("12h 30m
    // total") that needs every point of width it can get before it ellipsises.
    stat: { flex: 1, alignItems: 'center', paddingVertical: 4, paddingHorizontal: 4 },
    statNum: { fontSize: 19, fontWeight: '800', color: c.textPrimary },
    statLabel: { fontSize: 11, color: c.textTertiary, marginTop: 1 },
    // Reserved height, so a cell whose hint hasn't loaded (or has none) keeps
    // the same footprint as its neighbours and the strip can't jump.
    statHintSlot: { height: 14, justifyContent: 'center', alignSelf: 'stretch' },
    statHint: {
      fontSize: 9, fontWeight: '700', color: c.accent || c.accentInfo,
      textAlign: 'center',
    },
    cards: { marginTop: 26, paddingHorizontal: 16, gap: 10 },
    card: {
      flexDirection: 'row', alignItems: 'center', gap: 14,
      padding: 14, borderRadius: 16,
      backgroundColor: c.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
      ...depth(theme, 'card'),
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
    // Centred variant (Settings). gap:0 because the two edge slots do the
    // spacing now; the hairline is inherited from the in-page header that this
    // bar replaced, so the content below still reads as a separate surface.
    pushHeaderCentered: {
      gap: 0,
      paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    // Equal-width bookends: chevron on the left, empty on the right.
    pushHeaderSlot: { width: 28, alignItems: 'flex-start' },
    pushTitleCentered: { flex: 1, textAlign: 'center', fontSize: 18 },
    friendRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
    friendName: { fontSize: 15, fontWeight: '600', color: c.textPrimary, flex: 1 },
    empty: { color: c.textSecondary, textAlign: 'center', padding: 40 },
    vaultBack: {
      position: 'absolute', left: 12,
      width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    },
  });
};
