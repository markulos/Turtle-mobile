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
  const [turtle3dOpen, setTurtle3dOpen] = useState(false);
  // Server profile: the REAL display name, uploaded avatar and activity stats
  // (GET /me → { user: { displayName, avatarUrl, stats } }). The generated
  // animal name/disc are the FALLBACK for anyone who hasn't set either.
  const [me, setMe] = useState(null);
  // Which stat's detail page is open (null = none).
  const [statDetail, setStatDetail] = useState(null);
  // The heavy breakdown behind those pages. Deliberately NOT part of the /me
  // fetch above (which runs on every profile mount) — it's pulled the first time
  // a stat is opened and then reused for all of them, since one response covers
  // every metric.
  const [statsDetail, setStatsDetail] = useState(null);
  const [statsDetailLoading, setStatsDetailLoading] = useState(false);
  useEffect(() => {
    if (!statDetail || statsDetail || statsDetailLoading) return;
    let alive = true;
    setStatsDetailLoading(true);
    (async () => {
      try {
        const r = await api.get('/me/stats');
        if (alive && r?.success) setStatsDetail(r);
      } catch { /* older server / offline — the page falls back to headline numbers */ }
      finally { if (alive) setStatsDetailLoading(false); }
    })();
    return () => { alive = false; };
  }, [statDetail, statsDetail, statsDetailLoading, api]);

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
    { key: 'turtle3d', icon: 'cube-outline', label: 'Turtle 3D',
      sub: 'Collab bridges, account and server',
      onPress: () => { tapHaptic(); setTurtle3dOpen(true); } },
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
          // Generous headroom above the identity card — the page has no title
          // bar, so this gap IS the top chrome and a tight one made the card
          // look jammed under the status bar.
          paddingTop: insets.top + 44,
          // Scrollable, so it may pass UNDER the dock — but it must be able to
          // scroll clear of it (turtle-chrome-underlay).
          paddingBottom: dockOccupied(insets.bottom) + 24,
        }}
        showsVerticalScrollIndicator={false}
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
              <Icon name="camera-outline" size={15} color={c.background} />
            </TouchableOpacity>
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
          {STATS.length > 0 && (
            <View style={styles.statStrip}>
              {STATS.map((s, i) => (
                <React.Fragment key={s.key}>
                  {i > 0 && <View style={styles.statDivider} />}
                  <TouchableOpacity
                    onPress={() => { tapHaptic(); s.onPress(); }}
                    style={styles.stat}
                    accessibilityRole="button"
                    accessibilityLabel={`${s.value} ${s.label}`}
                  >
                    <Text style={styles.statNum}>{s.value}</Text>
                    <Text style={styles.statLabel}>{s.label}</Text>
                  </TouchableOpacity>
                </React.Fragment>
              ))}
            </View>
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
        loading={statsDetailLoading}
        headline={stats}
        onClose={() => setStatDetail(null)}
        onOpenTasks={() => { setStatDetail(null); goTab('Tasks'); }}
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

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const METRICS = {
  done: { title: 'Tasks completed', unit: 'completed', series: 'completed' },
  focus: { title: 'Focus sessions', unit: 'sessions', series: 'pomodoros' },
  points: { title: 'Points', unit: 'points', series: 'completed' },
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

/**
 * StatDetailPage — the page behind a profile stat, plus its sub-pages.
 *
 * Level 1 is the breakdown: a hero figure, a 90-day bar chart, a grid of
 * related figures, streaks, and per-dimension rankings. Level 2 is the LOG —
 * the individual records behind the number — pushed as its own EdgeSwipePage so
 * the back-swipe steps up one level at a time (a sub-page that shared its
 * parent's page would slide away with nothing left to show).
 */
function StatDetailPage({ metric, detail, loading, headline, onClose, onOpenTasks, theme, insets, styles }) {
  const [sub, setSub] = useState(null);
  const c = theme.colors;
  const tint = c.accent || c.accentInfo;
  useEffect(() => { if (!metric) setSub(null); }, [metric]);

  const meta = METRICS[metric] || METRICS.done;
  const totals = detail?.totals;
  const streak = detail?.streak;
  const recent = Array.isArray(detail?.recent) ? detail.recent : [];

  // Headline figure: the detailed totals when they've landed, else the four
  // numbers the profile already had — so the page is never blank while loading.
  const value = metric === 'focus'
    ? (totals?.pomodoros ?? headline?.pomodoros ?? 0)
    : metric === 'points'
      ? (totals?.points ?? headline?.points ?? 0)
      : (totals?.completed ?? headline?.tasksCompleted ?? 0);

  const completionRate = totals?.created ? Math.round((totals.completed / totals.created) * 100) : null;
  const windowTotal = (detail?.daily || []).reduce((s, d) => s + (d?.[meta.series] || 0), 0);

  // The grid under the chart. Each metric gets the figures that actually
  // explain it rather than one shared set.
  const GRID = metric === 'focus'
    ? [
      { label: 'Focus time', value: fmtMinutes(totals?.focusMinutes) },
      { label: 'Avg session', value: totals?.pomodoros ? fmtMinutes((totals.focusMinutes || 0) / totals.pomodoros) : '—' },
      { label: `Last ${detail?.windowDays ?? 90}d`, value: windowTotal },
      { label: 'Points earned', value: detail?.points?.fromPomodoros ?? '—' },
    ]
    : metric === 'points'
      ? [
        { label: 'From tasks', value: detail?.points?.fromTasks ?? '—' },
        { label: 'From focus', value: detail?.points?.fromPomodoros ?? '—' },
        { label: 'Per task', value: detail?.points?.perTask ?? '—' },
        { label: 'Per session', value: detail?.points?.perPomodoro ?? '—' },
      ]
      : [
        { label: 'Created', value: totals?.created ?? headline?.tasksCreated ?? '—' },
        { label: 'Still open', value: totals?.open ?? '—' },
        { label: 'Overdue', value: totals?.overdue ?? '—' },
        { label: 'Completion', value: completionRate == null ? '—' : `${completionRate}%` },
      ];

  const weekday = Array.isArray(detail?.weekday) ? detail.weekday : [];
  const weekdayMax = weekday.reduce((m, n) => Math.max(m, n), 0);
  const hours = Array.isArray(detail?.hours) ? detail.hours : [];
  const hoursMax = hours.reduce((m, n) => Math.max(m, n), 0);
  const topBoards = Array.isArray(detail?.topBoards) ? detail.topBoards : [];
  const boardMax = topBoards.reduce((m, b) => Math.max(m, b?.completed || 0), 0);
  // Only the busiest few hours are worth a row — 24 bars of mostly zero is noise.
  const topHours = hours
    .map((n, h) => ({ h, n }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);

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
        >
          {/* Hero */}
          <View style={statStyles.hero}>
            <Text style={[statStyles.heroValue, { color: c.textPrimary }]}>{value}</Text>
            <Text style={[statStyles.heroUnit, { color: c.textTertiary }]}>{meta.unit}</Text>
            {loading && !detail && <ActivityIndicator style={{ marginTop: 10 }} color={c.textTertiary} />}
          </View>

          {/* Streaks — the one figure that rewards consistency rather than volume. */}
          {!!streak && (
            <View style={[statStyles.streakRow, { borderColor: c.border }]}>
              <View style={statStyles.streakCell}>
                <Icon name="fire" size={18} color={streak.current > 0 ? tint : c.textMuted} />
                <Text style={[statStyles.streakNum, { color: c.textPrimary }]}>{streak.current}</Text>
                <Text style={[statStyles.streakLabel, { color: c.textTertiary }]}>day streak</Text>
              </View>
              <View style={[statStyles.streakDivider, { backgroundColor: c.border }]} />
              <View style={statStyles.streakCell}>
                <Icon name="trophy-outline" size={18} color={c.textMuted} />
                <Text style={[statStyles.streakNum, { color: c.textPrimary }]}>{streak.best}</Text>
                <Text style={[statStyles.streakLabel, { color: c.textTertiary }]}>best ever</Text>
              </View>
            </View>
          )}

          {/* 90-day chart */}
          {!!detail?.daily?.length && (
            <View style={[statStyles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[statStyles.cardTitle, { color: c.textPrimary }]}>
                Last {detail.windowDays} days
              </Text>
              <DailyBars daily={detail.daily} field={meta.series} tint={tint} theme={theme} />
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

          {/* Rhythm — when the work actually happens. */}
          {weekdayMax > 0 && (
            <View style={[statStyles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[statStyles.cardTitle, { color: c.textPrimary }]}>By day of week</Text>
              {weekday.map((n, i) => (
                <RankRow key={i} label={WEEKDAYS[i]} value={n} max={weekdayMax} tint={tint} theme={theme} />
              ))}
            </View>
          )}

          {topHours.length > 0 && (
            <View style={[statStyles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[statStyles.cardTitle, { color: c.textPrimary }]}>Busiest hours</Text>
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

          {topBoards.length > 0 && metric !== 'focus' && (
            <View style={[statStyles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[statStyles.cardTitle, { color: c.textPrimary }]}>Top boards</Text>
              {topBoards.map((b) => (
                <RankRow key={b.name} label={b.name} value={b.completed} max={boardMax} tint={tint} theme={theme} />
              ))}
            </View>
          )}

          {/* Sub-pages */}
          <View style={statStyles.links}>
            <TouchableOpacity
              style={[statStyles.linkRow, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}
              onPress={() => { tapHaptic(); setSub('log'); }}
              accessibilityRole="button"
              accessibilityLabel="Recent completions"
            >
              <Icon name="history" size={20} color={tint} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[statStyles.linkTitle, { color: c.textPrimary }]}>Recent completions</Text>
                <Text style={[statStyles.linkSub, { color: c.textTertiary }]} numberOfLines={1}>
                  {recent.length ? `Last ${recent.length} finished tasks` : 'Nothing finished yet'}
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

        {/* SUB-PAGE: the completions log. Its own page so the back-swipe returns
            here rather than closing the whole stat. */}
        <EdgeSwipePage overlay visible={sub === 'log'} onClose={() => setSub(null)}>
          <View style={styles.page}>
            <View style={[styles.pushHeader, { paddingTop: insets.top + 6 }]}>
              <TouchableOpacity onPress={() => setSub(null)} hitSlop={HIT} accessibilityLabel="Back">
                <Icon name="chevron-left" size={28} color={c.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.pushTitle}>Recent completions</Text>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: dockOccupied(insets.bottom) + 24 }}>
              {recent.length === 0 ? (
                <Text style={styles.empty}>No completed tasks yet.</Text>
              ) : recent.map((r) => (
                <View key={String(r.id)} style={statStyles.logRow}>
                  <Icon name="check-circle" size={18} color={tint} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[statStyles.logTitle, { color: c.textPrimary }]} numberOfLines={1}>{r.title}</Text>
                    <Text style={[statStyles.logMeta, { color: c.textTertiary }]} numberOfLines={1}>
                      {formatRelativeTime(r.completedAt)}{r.project ? ` · ${r.project}` : ''}
                    </Text>
                  </View>
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
                <Text style={[statStyles.ledgerTotal, { color: tint }]}>{totals?.points ?? 0}</Text>
              </View>
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
    stat: { flex: 1, alignItems: 'center', paddingVertical: 4, paddingHorizontal: 6 },
    statNum: { fontSize: 19, fontWeight: '800', color: c.textPrimary },
    statLabel: { fontSize: 11, color: c.textTertiary, marginTop: 1 },
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
