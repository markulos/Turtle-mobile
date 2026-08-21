import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ParticipantPicker from './TasksScreen/components/ParticipantPicker';
import CalendarPartners from './TasksScreen/components/CalendarPartners';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Keyboard,
  TouchableWithoutFeedback,
  Switch,
  AppState,
  ActivityIndicator,
  Animated,
  useWindowDimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { KeyboardSafeScreen } from '../components/KeyboardSafeView';
import SidecarStatusCard from '../components/SidecarStatusCard';
import { useServer } from '../context/ServerContext';
import { useTheme, ACCENTS } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import * as SecureStore from 'expo-secure-store';
import { clearAllCaches, getCacheSizeBytes, formatBytes } from '../utils/cacheManager';
import { tapHaptic, impactHaptic, notifyHaptic } from '../utils/haptics';
import { isGestureProbeEnabled, setGestureProbeEnabled, subscribeDebugSettings } from '../utils/debugSettings';
import { matchesQuery } from '../utils/settingsSearch';
import PondInvitesSection from '../components/PondInvitesSection';

const MASTER_KEY_STORE = 'vault_master_key';
const SALT_STORE = 'vault_salt';

// The single page the pager collapses to while a search is running. Searching
// spans every tab, so the four-page pager would otherwise have to show the same
// results four times over.
const SEARCH_PAGE = { key: '__search__', label: 'Results', icon: 'magnify' };

/**
 * Everything the Settings search can match, in one place.
 *
 * Each value is the visible label plus the words someone might reach for
 * instead of it ("colour" and "color", "logout" and "sign out"), because the
 * matcher is deliberately literal — it forgives typos, not vocabulary.
 *
 * Kept as a map rather than inline props so the screen can also ask "did
 * ANYTHING match?" for its empty state. Children that render null cannot
 * answer that, and a second hand-kept list would drift out of agreement
 * with the first.
 */
const SETTING_TERMS = {
  profile: 'profile display name avatar photo picture alias points stats tasks pomodoros',
  darkMode: 'dark mode theme appearance night light colour color',
  accent: 'highlight colour color accent theme appearance swatch',
  hideVault: 'hide vault button navbar tab bar navigation photos',
  cache: 'cache size storage space photos clear free disk measure',
  notifications: 'notifications push alerts reminders test sms text badge sound',
  gestureProbe: 'gesture probe debug developer performance lag jank stalls diagnostics',
  timeFormat: '24 hour time format clock twelve twenty four am pm military',
  dayCellTasks: 'list tasks day cells month grid titles dots appearance',
  freeScroll: 'free scroll calendar months continuous paging swipe snap',
  defaultParticipants: 'default participants people tasks assign involved pond members',
  calendarPartners: 'calendar partners share sharing partner view only merged tasks',
  serverConnection: 'server connection ip address computer host wifi network connect test pond offline',
  healMedia: 'heal media vault thumbnails previews rebuild repair audit library',
  passwordVault: 'password vault master password change reset security encryption face id touch id',
  noVault: 'password vault set up security encryption missing',
  account: 'account sign out log out logout session leave',
  sidecar: 'ai sidecar status inference understanding library inferences model',
  securityInfo: 'security info encryption privacy passwords plaintext server',
  pondInvites: 'invite invites pond members phone number join share link revoke owner people friends',
};

/** Terms only reachable in a dev build — excluded from the empty-state check
 *  in release, where the settings they describe do not render at all. */
const DEV_ONLY_TERMS = ['gestureProbe'];

/**
 * One searchable setting.
 *
 * A marker component: it renders its children untouched, and exists so the
 * enclosing SettingsSection can read `terms` off the element and decide whether
 * this row survives the current query. `terms` is the searchable text — the
 * visible label plus the words someone might reach for instead of it.
 */
function SettingsItem({ children }) {
  return <>{children}</>;
}

/**
 * A settings group.
 *
 * While a search is running it renders only the SettingsItem children whose
 * terms match, and returns null when none do — so results read as a short list
 * of settings instead of a page of empty section headers.
 *
 * Children WITHOUT `terms` are dropped during a search on purpose: they are the
 * explanatory blurbs and decorative rows that belong to the section as a whole,
 * and leaking them into a filtered result would put text under a header whose
 * actual setting had been filtered out.
 */
function SettingsSection({ title, icon, query, styles, theme, children }) {
  const searching = !!(query && query.trim());
  const kids = React.Children.toArray(children);
  const visible = searching
    ? kids.filter((k) => k?.props?.terms && matchesQuery(query, k.props.terms))
    : kids;
  if (searching && visible.length === 0) return null;
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={[styles.iconContainer, { backgroundColor: theme.colors.surfaceElevated }]}>
          <Icon name={icon} size={20} color={theme.colors.textPrimary} />
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {visible}
    </View>
  );
}

/**
 * Watch the server's media-heal job to completion.
 *
 * The heal used to be one blocking POST, which meant a full library had to
 * finish inside the fetch timeout — it couldn't, so the server abandoned most
 * of its own work to a 45s budget and still reported success. It's a background
 * job now; this polls its status and resolves with the final stats.
 *
 * A dropped poll is not a failed job (phone slept, tunnel hiccup), so transient
 * errors just retry. Bounded so a server that never finishes can't hang the UI.
 */
async function pollHealToCompletion(api, onProgress, { intervalMs = 2000, maxMs = 30 * 60 * 1000 } = {}) {
  const deadline = Date.now() + maxMs;
  let consecutiveErrors = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      // apiGet already carries the auth header; its 2nd arg is options, not headers.
      const res = await api.get('/media/heal/status');
      const status = res?.status;
      if (!status) throw new Error('no status');
      consecutiveErrors = 0;
      onProgress?.({ processed: status.processed || 0, total: status.total || 0 });
      if (!status.running) {
        if (status.error) return { success: false, error: status.error };
        return { success: true, stats: status.stats || {} };
      }
    } catch (e) {
      if (++consecutiveErrors >= 8) return { success: false, error: 'Lost contact with the server mid-heal.' };
    }
  }
  return { success: false, error: 'Heal is taking unusually long — check the server log.' };
}

export default function SettingsScreen({ active = true }) {
  const { theme, isDark, toggleTheme, timeFormat, setTimeFormat, hideVaultButton, setHideVaultButton, showCalendarDayTasks, setShowCalendarDayTasks, calendarFreeScroll, setCalendarFreeScroll, accent, setAccent } = useTheme();
  const { serverIP, isConnected, loading, saveIP, checkConnection, api, getBaseUrl } = useServer();
  const [isHealing, setIsHealing] = useState(false);
  // {processed, total} while the server's heal job is running (null = idle).
  const [healProgress, setHealProgress] = useState(null);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  // Debug → gesture probe. Mirrors the persisted flag; the subscription keeps
  // the switch honest when hydration lands after mount (or another surface
  // flips it).
  const [gestureProbeOn, setGestureProbeOn] = useState(() => isGestureProbeEnabled());
  useEffect(() => subscribeDebugSettings(() => setGestureProbeOn(isGestureProbeEnabled())), []);
  // null = not yet measured / measuring; number = bytes currently cached.
  const [cacheBytes, setCacheBytes] = useState(null);
  const [measuringCache, setMeasuringCache] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
  // ── Settings search ─────────────────────────────────────────
  // Filters in place rather than offering a jump list: the point is to see the
  // control itself, already live, without knowing which tab Turtle filed it
  // under. Matching (including typo tolerance) lives in utils/settingsSearch.
  const [search, setSearch] = useState('');
  const searchQuery = search.trim();
  const searching = searchQuery.length > 0;
  // Did anything match at all? Sections that filter themselves down to nothing
  // return null, so they cannot report it — this asks the same map they filter
  // against, which is why the terms live in one place.
  const anyMatch = useMemo(() => {
    if (!searching) return true;
    return Object.keys(SETTING_TERMS).some((key) => {
      // A dev-only setting must not suppress the empty state in a release
      // build, where the control it names never renders.
      if (!__DEV__ && DEV_ONLY_TERMS.includes(key)) return false;
      return matchesQuery(searchQuery, SETTING_TERMS[key]);
    });
  }, [searching, searchQuery]);
  const SETTINGS_TABS = [
    { key: 'general', label: 'General', icon: 'tune' },
    { key: 'calendar', label: 'Calendar', icon: 'calendar' },
    { key: 'connection', label: 'Connection', icon: 'server-network' },
    { key: 'security', label: 'Security', icon: 'shield-key' },
  ];

  // ── Swipeable tabs ──────────────────────────────────────────
  // Same mechanism as Notes / the photo vault: a horizontal paging ScrollView
  // whose scroll offset (pageScrollX) drives BOTH the pages and the pill
  // indicator 1:1, so swiping and the pill slide stay perfectly in sync.
  const { width: screenW } = useWindowDimensions();
  const pageScrollX = useRef(new Animated.Value(0)).current;
  const pagerRef = useRef(null);
  const TAB_TRACK_INSET = 12; // marginHorizontal on the pill track
  const segW = (screenW - TAB_TRACK_INSET * 2) / SETTINGS_TABS.length;
  // Pill translation: 1:1 with the page offset, mapped onto segment widths.
  const tabIndicatorX = pageScrollX.interpolate({
    inputRange: SETTINGS_TABS.map((_, i) => i * screenW),
    outputRange: SETTINGS_TABS.map((_, i) => i * segW),
    extrapolate: 'clamp',
  });
  const goToPage = useCallback((index) => {
    pagerRef.current?.scrollTo({ x: index * screenW, animated: true });
    const t = SETTINGS_TABS[index];
    if (t) setActiveTab(t.key);
  }, [screenW]);
  const onPagerEnd = useCallback((e) => {
    // While searching the pager holds ONE page, so its offset is always 0 —
    // reading a tab out of that would silently reset the active tab to General
    // the moment anyone typed.
    if (searching) return;
    const idx = Math.round(e.nativeEvent.contentOffset.x / screenW);
    const t = SETTINGS_TABS[idx];
    if (t && t.key !== activeTab) setActiveTab(t.key);
  }, [screenW, activeTab, searching]);

  // Leaving the search puts the pager back on the tab you were reading, not
  // wherever a one-page layout left the offset.
  useEffect(() => {
    if (searching) return;
    const idx = SETTINGS_TABS.findIndex((t) => t.key === activeTab);
    if (idx >= 0) pagerRef.current?.scrollTo({ x: idx * screenW, animated: false });
    // activeTab is deliberately not a dependency: this restores position when
    // the SEARCH ends, and re-running it on every tab change would fight the
    // pager's own animated scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching, screenW]);
  const { logout, getAuthHeaders } = useAuth();
  const [ipInput, setIpInput] = useState(serverIP);
  const [hasVault, setHasVault] = useState(false);

  // === PROFILE (avatar + display-name alias) ===
  const [profile, setProfile] = useState(null);       // { displayName, avatarUrl }
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [defaultParticipants, setDefaultParticipants] = useState([]); // calendar: auto-added to new tasks
  // Server origin (no /api) so a server-relative avatar_url resolves to a full URL.
  const serverBase = getBaseUrl().replace(/\/api$/, '');
  // A server-relative avatar ('/api/avatars/…') needs the origin prepended; an
  // optimistic local pick ('file://', 'ph://', http(s)) is already absolute.
  const avatarFullUrl = profile?.avatarUrl
    ? (profile.avatarUrl.startsWith('/') ? `${serverBase}${profile.avatarUrl}` : profile.avatarUrl)
    : null;

  const loadProfile = useCallback(async () => {
    try {
      const res = await api.get('/me');
      if (res?.user) {
        setProfile({
          displayName: res.user.displayName || '',
          avatarUrl: res.user.avatarUrl || null,
          stats: res.user.stats || null,   // { points, tasksCompleted, tasksCreated, pomodoros } — may be absent on an older server
        });
        setNameInput(res.user.displayName || '');
        setDefaultParticipants(
          Array.isArray(res.user.settings?.defaultParticipants) ? res.user.settings.defaultParticipants : [],
        );
      }
    } catch (e) { /* offline / not logged in — profile section just shows defaults */ }
  }, [api]);

  // Persist the calendar default-participants list (optimistic; next load reconciles).
  const handleChangeDefaults = useCallback(async (ids) => {
    setDefaultParticipants(ids);
    try {
      await api.patch('/me/settings', { defaultParticipants: ids });
    } catch (e) { /* keep optimistic */ }
  }, [api]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  // Save the display name (the alias seen across the app). Optimistic: the
  // field already holds the new value; persist in the background, revert on fail.
  const handleSaveName = useCallback(async () => {
    const next = nameInput.trim().slice(0, 60);
    Keyboard.dismiss();
    const prev = profile?.displayName || '';
    if (next === prev) return;
    setSavingName(true);
    setProfile(p => ({ ...(p || {}), displayName: next }));
    try {
      await api.patch('/me', { displayName: next });
    } catch (e) {
      setProfile(p => ({ ...(p || {}), displayName: prev }));
      setNameInput(prev);
      Alert.alert('Not saved', 'Could not update your name. Check your connection and try again.');
    } finally {
      setSavingName(false);
    }
  }, [api, nameInput, profile]);

  const handlePickAvatar = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permission needed', 'Allow photo access to choose a profile picture.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      // Optimistic: show the local image immediately while it uploads. On
      // failure the catch reverts to the closure's pre-pick `profile`.
      setProfile(p => ({ ...(p || {}), avatarUrl: asset.uri }));
      setUploadingAvatar(true);
      const form = new FormData();
      form.append('avatar', { uri: asset.uri, name: 'avatar.jpg', type: 'image/jpeg' });
      // Attach the Bearer token explicitly (matches this screen's heal call);
      // no Content-Type so RN sets the multipart boundary itself.
      const resp = await fetch(`${getBaseUrl()}/me/avatar`, {
        method: 'POST',
        headers: { ...getAuthHeaders() },
        body: form,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.success || !data.avatarUrl) throw new Error(data.error || 'upload failed');
      setProfile(p => ({ ...(p || {}), avatarUrl: data.avatarUrl }));
    } catch (e) {
      console.error('[Settings] avatar upload failed:', e?.message);
      setProfile(p => ({ ...(p || {}), avatarUrl: profile?.avatarUrl || null }));
      await loadProfile(); // resync to the server's truth
      Alert.alert('Upload failed', 'Could not set your profile picture. Please try again.');
    } finally {
      setUploadingAvatar(false);
    }
  }, [getBaseUrl, getAuthHeaders, profile, loadProfile]);
  
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChanging, setIsChanging] = useState(false);

  useEffect(() => {
    checkVaultStatus();
  }, []);

  // Recheck when app comes to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        checkVaultStatus();
      }
    });
    return () => subscription?.remove();
  }, []);

  const checkVaultStatus = useCallback(async () => {
    console.log('Settings: Checking vault status...');
    const hasKey = await SecureStore.getItemAsync(MASTER_KEY_STORE);
    console.log('Settings: Has vault:', !!hasKey);
    setHasVault(!!hasKey);
  }, []);

  const handleSave = async () => {
    Keyboard.dismiss();
    if (!ipInput.trim()) {
      Alert.alert('Error', 'Please enter an IP address');
      return;
    }
    
    const success = await saveIP(ipInput.trim());
    Alert.alert(
      success ? 'Success' : 'Error',
      success ? 'Connected to server!' : 'Could not connect to server. Check IP and make sure server is running.'
    );
  };

  const handleTest = async () => {
    Keyboard.dismiss();
    const success = await checkConnection(serverIP);
    Alert.alert(
      success ? 'Connected' : 'Failed',
      success ? 'Server is reachable!' : 'Cannot reach server'
    );
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      Alert.alert('Error', 'All fields are required');
      return;
    }

    if (newPassword.length < 8) {
      Alert.alert('Error', 'New password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'New passwords do not match');
      return;
    }

    setIsChanging(true);
    try {
      const salt = await SecureStore.getItemAsync(SALT_STORE);
      const { deriveKey, storeMasterKey } = await import('./PasswordsScreen/utils/crypto');
      
      const currentKey = await deriveKey(currentPassword, salt);
      const storedKey = await SecureStore.getItemAsync(MASTER_KEY_STORE);
      
      if (currentKey !== storedKey) {
        Alert.alert('Error', 'Current password is incorrect');
        return;
      }

      const { setupMasterPassword } = await import('./PasswordsScreen/utils/crypto');
      await setupMasterPassword(newPassword);

      Alert.alert('Success', 'Master password changed successfully!');
      setShowChangePassword(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      console.error('Error changing password:', error);
      Alert.alert('Error', 'Failed to change master password');
    } finally {
      setIsChanging(false);
    }
  };

  const triggerMediaHeal = useCallback(async () => {
    Alert.alert(
      'Heal Media Vault',
      'Scans the server library and rebuilds missing thumbnails, blurhashes and previews. '
      + 'It runs in the background on the server and never deletes a photo — anything it '
      + "can't reach is reported. Proceed?",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Run Heal',
          onPress: async () => {
            setIsHealing(true);
            setHealProgress(null);
            try {
              const authHeaders = getAuthHeaders();
              const started = await api.post('/media/heal', {}, authHeaders);
              if (!started?.success) throw new Error(started?.error || 'Failed to start the heal.');

              // The pass is a background job now: poll until it reports done,
              // so a big library isn't cut off by the request timeout.
              const res = await pollHealToCompletion(api, setHealProgress);

              if (res && res.success) {
                // --- 🧹 DUAL-ACTION: LOCAL CACHE WIPE ---
                try {
                  console.log('[Settings] Server healed. Flushing local app cache...');

                  // Wipe the actual image bytes (expo-image disk+RAM, temp dirs,
                  // share files) — the heal regenerated thumbnails server-side, so
                  // the device must drop its stale copies to pull the fresh ones.
                  await clearAllCaches();

                  // Also drop any media-related AsyncStorage keys.
                  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
                  const keys = await AsyncStorage.getAllKeys();
                  const mediaCacheKeys = keys.filter(k => k.includes('media') || k.includes('gallery') || k.includes('image'));
                  if (mediaCacheKeys.length > 0) {
                    await AsyncStorage.multiRemove(mediaCacheKeys);
                    console.log(`[Settings] Cleared ${mediaCacheKeys.length} cache keys`);
                  }

                  console.log('[Settings] Local cache successfully purged.');
                } catch (cacheErr) {
                  console.warn('[Settings] Cache wipe encountered an issue:', cacheErr);
                }
                // ----------------------------------------

                const s = res.stats || {};
                const lines = [
                  `Healthy rows: ${s.healthy ?? 0}`,
                  `Thumbnails rebuilt: ${s.regenerated ?? 0}`,
                  `WebP upgrades: ${s.webpConverted ?? 0}`,
                  `Blurhashes filled: ${s.blurhashed ?? 0}`,
                ];
                // Reported, never acted on: a tunnel photo's bytes live on the
                // host PC, so "unreachable" means that folder is offline.
                if (s.offline > 0) lines.push(`On an offline folder (untouched): ${s.offline}`);
                if (s.ghosts > 0) lines.push(`Missing originals, rows kept: ${s.ghosts}`);
                if (s.storageDetached) {
                  lines.push('\n⚠ Most originals were unreadable — that looks like a disconnected drive, so nothing was rewritten.');
                }
                Alert.alert(
                  s.stopped ? 'Heal Stopped' : 'Vault Healed & Cache Cleared ✅',
                  `${lines.join('\n')}\n\nLocal app memory has been flushed.`
                );
              } else {
                Alert.alert('Error', res?.error || 'Failed to heal the vault.');
              }
            } catch (error) {
              console.error('[Settings] Heal error:', error);
              Alert.alert('Error', error?.message || 'Network request failed.');
            } finally {
              setIsHealing(false);
              setHealProgress(null);
            }
          }
        }
      ]
    );
  }, [api]);

  // Manual cache wipe — clears expo-image's disk+RAM cache, the throwaway temp
  // dirs, and any leftover share files. Photos re-download from the server on
  // next view, so it's safe (just briefly slower). The app also does this
  // automatically when backgrounded (see utils/cacheManager).
  // Measure the on-disk cache size. Best-effort: a failure just leaves the
  // size as 0 rather than blocking the screen.
  const measureCache = useCallback(async () => {
    setMeasuringCache(true);
    try {
      const bytes = await getCacheSizeBytes();
      setCacheBytes(bytes);
    } catch (e) {
      setCacheBytes(0);
    } finally {
      setMeasuringCache(false);
    }
  }, []);

  // Measure once when the General tab is showing (where the Storage card lives).
  useEffect(() => {
    if (activeTab === 'general' && cacheBytes === null && !measuringCache) {
      measureCache();
    }
  }, [activeTab, cacheBytes, measuringCache, measureCache]);

  const handleClearCache = useCallback(async () => {
    if (isClearingCache) return;
    setIsClearingCache(true);
    try {
      await clearAllCaches();
      Alert.alert('Cache cleared', 'Cached photos and temporary files were removed. Your photos will reload from the server as you browse.');
    } catch (e) {
      Alert.alert('Error', 'Could not clear the cache. Please try again.');
    } finally {
      setIsClearingCache(false);
      // Re-measure so the displayed size reflects the now-empty cache.
      measureCache();
    }
  }, [isClearingCache, measureCache]);

  // Fire a test reminder at myself (push + SMS) and report what the server
  // actually managed to send, so a "no notifications" problem is diagnosable
  // right here: 0 devices → token/permission issue; muted → preference off;
  // SMS dev/skipped/failed → the texting half.
  const handleTestNotification = useCallback(async () => {
    if (sendingTest) return;
    setSendingTest(true);
    try {
      const res = await api.post('/notifications/test', {});
      const pushN = res?.push?.sent ?? 0;
      const sms = res?.sms || {};
      const pushLine = pushN > 0
        ? `Push: sent to ${pushN} device${pushN > 1 ? 's' : ''} ✓`
        : (res?.push?.muted
            ? 'Push: muted by your notification settings'
            : 'Push: no registered devices — open the app on this phone and allow notifications');
      const smsLine = sms.ok
        ? (sms.dev ? 'SMS: dev mode (logged, not actually sent)' : 'SMS: sent ✓')
        : sms.reason === 'no-phone-on-file'
          ? 'SMS: skipped — no phone on your account'
          : sms.skipped
            ? 'SMS: skipped'
            : `SMS: failed${sms.error ? ` — ${String(sms.error).slice(0, 90)}` : ''}`;
      notifyHaptic(pushN > 0 || sms.ok ? 'success' : 'warning');
      Alert.alert('Test notification', `${pushLine}\n${smsLine}`);
    } catch (e) {
      notifyHaptic('error');
      Alert.alert('Could not send', e?.message || 'Request failed. Check your connection and try again.');
    } finally {
      setSendingTest(false);
    }
  }, [api, sendingTest]);

  const handleResetVault = async () => {
    Alert.alert(
      '⚠️ Reset Password Vault',
      'This will permanently delete your master password and all stored passwords.\n\nAre you absolutely sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Reset', 
          style: 'destructive',
          onPress: async () => {
            try {
              // Clear server data first
              if (isConnected) {
                await fetch(`${getBaseUrl()}/passwords`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify([]),
                });
              }
              
              // Clear secure store
              await SecureStore.deleteItemAsync(MASTER_KEY_STORE);
              await SecureStore.deleteItemAsync(SALT_STORE);
              
              // Update state
              setHasVault(false);
              setShowChangePassword(false);
              setCurrentPassword('');
              setNewPassword('');
              setConfirmPassword('');
              
              Alert.alert('Reset Complete', 'Your password vault has been reset. Please restart the app or go to the Passwords tab to set up a new vault.');
            } catch (error) {
              console.error('Reset error:', error);
              Alert.alert('Error', 'Failed to reset vault: ' + error.message);
            }
          }
        },
      ]
    );
  };

  const styles = createStyles(theme);

  return (
    // No top safe-area inset here: this screen is presented inside
    // TurtleScreen's page-sheet Modal, whose own header strip already
    // applies insets.top. Adding it again here double-padded the top and
    // pushed the "Settings" title way down the sheet.
    <View style={styles.container}>
      {/* Custom Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      {/* Search — spans every tab, because the whole point is finding a control
          without already knowing which tab it lives under. While this has text
          the pager collapses to one page of matching settings (SEARCH_PAGE) and
          the segmented control hides, since tabs mean nothing in a result set. */}
      <View style={styles.searchWrap}>
        <Icon name="magnify" size={18} color={theme.colors.textTertiary} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search settings"
          placeholderTextColor={theme.colors.textPlaceholder}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search settings"
        />
        {searching && (
          <TouchableOpacity
            onPressIn={() => tapHaptic()}
            onPress={() => setSearch('')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Icon name="close-circle" size={18} color={theme.colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Swipeable segmented control — the pill slides 1:1 with the pager, and
          each label/icon crossfades from muted to primary as its page arrives.
          Tapping a segment animates the pager to that page. */}
      {!searching && (
      <View style={styles.tabTrack}>
        <Animated.View
          style={[styles.tabPill, { width: segW - 4, transform: [{ translateX: tabIndicatorX }] }]}
        />
        {SETTINGS_TABS.map((t, index) => {
          const inputRange = [(index - 1) * screenW, index * screenW, (index + 1) * screenW];
          const activeOp = pageScrollX.interpolate({ inputRange, outputRange: [0, 1, 0], extrapolate: 'clamp' });
          const inactiveOp = pageScrollX.interpolate({ inputRange, outputRange: [1, 0, 1], extrapolate: 'clamp' });
          return (
            <TouchableOpacity
              key={t.key}
              style={styles.tabSeg}
              onPressIn={() => tapHaptic()}
              onPress={() => goToPage(index)}
              activeOpacity={0.8}
            >
              {/* Inactive (muted) layer */}
              <Animated.View style={[styles.tabSegContent, { opacity: inactiveOp }]}>
                <Icon name={t.icon} size={16} color={theme.colors.textTertiary} />
                <Text style={[styles.tabLabel, { color: theme.colors.textTertiary }]} numberOfLines={1}>
                  {t.label}
                </Text>
              </Animated.View>
              {/* Active (primary) layer — stacked on top, fades in for this page */}
              <Animated.View style={[styles.tabSegContent, { opacity: activeOp }]}>
                <Icon name={t.icon} size={16} color={theme.colors.textPrimary} />
                <Text style={[styles.tabLabel, { color: theme.colors.textPrimary }]} numberOfLines={1}>
                  {t.label}
                </Text>
              </Animated.View>
            </TouchableOpacity>
          );
        })}
      </View>
      )}

      {/* Swipeable pager — one page per tab. The scroll offset feeds pageScrollX
          (native driver) which drives the pill above 1:1. Each page holds only
          its own tab's sections (the others render null via the tabKey gates),
          inside its own keyboard-aware vertical scroll. */}
      <Animated.ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        // One page while searching — there is nothing to swipe between, and a
        // bounce on a single page reads as a broken gesture.
        scrollEnabled={!searching}
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: pageScrollX } } }],
          { useNativeDriver: true },
        )}
        onMomentumScrollEnd={onPagerEnd}
        style={{ flex: 1 }}
      >
        {(searching ? [SEARCH_PAGE] : SETTINGS_TABS).map((tabItem) => {
          const tabKey = tabItem.key;
          return (
          <View key={tabKey} style={{ width: screenW }}>
          <KeyboardSafeScreen>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.inner}>
            {/* Profile Section — avatar + alias used across the app */}
            {(searching || tabKey === 'general') && (
            <SettingsSection title="Profile" icon="account-circle" query={searchQuery} styles={styles} theme={theme}>
              <SettingsItem terms={SETTING_TERMS.profile}>
              <View style={styles.profileRow}>
                <TouchableOpacity onPressIn={() => tapHaptic()} onPress={handlePickAvatar} activeOpacity={0.8} disabled={uploadingAvatar}>
                  <View style={[styles.avatarCircle, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
                    {avatarFullUrl ? (
                      <Image
                        source={{ uri: avatarFullUrl }}
                        style={styles.avatarImage}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        transition={150}
                      />
                    ) : (
                      <Icon name="account" size={40} color={theme.colors.textTertiary} />
                    )}
                    {uploadingAvatar && (
                      <View style={styles.avatarUploadOverlay}>
                        <ActivityIndicator size="small" color="#fff" />
                      </View>
                    )}
                    <View style={[styles.avatarBadge, { backgroundColor: theme.colors.surfaceHighlight, borderColor: theme.colors.surface }]}>
                      <Icon name="camera" size={14} color={theme.colors.textPrimary} />
                    </View>
                  </View>
                </TouchableOpacity>

                <View style={styles.profileNameCol}>
                  <Text style={styles.label}>Display Name</Text>
                  <View style={styles.inputContainer}>
                    <Icon name="account-outline" size={18} color={theme.colors.textTertiary} style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="Your name or alias"
                      placeholderTextColor={theme.colors.textPlaceholder}
                      value={nameInput}
                      onChangeText={setNameInput}
                      maxLength={60}
                      autoCapitalize="words"
                      returnKeyType="done"
                      onSubmitEditing={handleSaveName}
                      blurOnSubmit={true}
                    />
                  </View>
                  <Text style={styles.hint}>This name is shown across the app.</Text>
                </View>
              </View>

              {/* Your points — same shape friends see on your card. Renders only
                  when the server attaches stats (absent on an older build → hidden). */}
              {profile?.stats && (
                <View style={styles.profileStatsRow}>
                  {[
                    { key: 'points', label: 'Points', icon: 'star-four-points-outline', value: profile.stats.points },
                    { key: 'tasks', label: 'Tasks', icon: 'checkbox-marked-circle-outline', value: profile.stats.tasksCompleted },
                    { key: 'pomodoros', label: 'Pomodoros', icon: 'timer-outline', value: profile.stats.pomodoros },
                  ].map((s) => (
                    <View key={s.key} style={styles.profileStatTile}>
                      <Icon name={s.icon} size={16} color={theme.colors.accentInfo} />
                      <Text style={styles.profileStatValue}>
                        {typeof s.value === 'number' ? s.value.toLocaleString() : '—'}
                      </Text>
                      <Text style={styles.profileStatLabel}>{s.label}</Text>
                    </View>
                  ))}
                </View>
              )}

              {nameInput.trim() !== (profile?.displayName || '') && (
                <TouchableOpacity
                  style={[styles.primaryButton, savingName && styles.buttonDisabled, { marginBottom: 0 }]}
                  onPressIn={() => impactHaptic('medium')}
                  onPress={handleSaveName}
                  disabled={savingName}
                >
                  <Icon name="content-save" size={16} color={theme.colors.textPrimary} style={styles.buttonIcon} />
                  <Text style={styles.primaryButtonText}>{savingName ? 'Saving...' : 'Save Name'}</Text>
                </TouchableOpacity>
              )}
              </SettingsItem>
            </SettingsSection>
            )}

            {/* Appearance Section */}
            {(searching || tabKey === 'general') && (
            <SettingsSection title="Appearance" icon="palette" query={searchQuery} styles={styles} theme={theme}>
              <SettingsItem terms={SETTING_TERMS.darkMode}>
              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>Dark Mode</Text>
                  <Text style={styles.settingDescription}>Use dark theme throughout the app</Text>
                </View>
                <Switch
                  value={isDark}
                  onValueChange={toggleTheme}
                  trackColor={{ false: theme.colors.surfaceElevated, true: theme.colors.surfaceHighlight }}
                  thumbColor={isDark ? theme.colors.textPrimary : theme.colors.textTertiary}
                />
              </View>
              </SettingsItem>

              {/* Highlight colour — the accent the whole app draws with: the
                  sliding tab pill, links, active chips, affirmative actions.
                  Chosen here rather than per-surface so one pick carries
                  everywhere (see ThemeContext's accent handling). The label and
                  its swatch row are ONE item so a search that matches the label
                  still shows the control that goes with it. */}
              <SettingsItem terms={SETTING_TERMS.accent}>
              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>Highlight colour</Text>
                  <Text style={styles.settingDescription}>
                    Used across the app for the active tab, links and highlights
                  </Text>
                </View>
              </View>
              <View style={styles.accentRow}>
                {ACCENTS.map((option) => {
                  const selected = accent === option.key;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      onPress={() => setAccent(option.key)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${option.label} highlight colour`}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={[
                        styles.accentSwatch,
                        {
                          backgroundColor: option.color,
                          // The ring, not a tick, carries selection: a check
                          // mark on a saturated swatch is hard to read across
                          // eight different hues.
                          borderColor: selected ? theme.colors.textPrimary : 'transparent',
                        },
                      ]}
                    />
                  );
                })}
              </View>
              </SettingsItem>
            </SettingsSection>

            )}

            {/* Navigation Section — control what shows in the bottom navbar. */}
            {(searching || tabKey === 'general') && (
            <SettingsSection title="Navigation" icon="dock-bottom" query={searchQuery} styles={styles} theme={theme}>
              <SettingsItem terms={SETTING_TERMS.hideVault}>
              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>Hide Vault button</Text>
                  <Text style={styles.settingDescription}>
                    Remove the Vault tab from the navbar. Open it with the /vault command in chat or terminal.
                  </Text>
                </View>
                <Switch
                  value={hideVaultButton}
                  onValueChange={setHideVaultButton}
                  trackColor={{ false: theme.colors.surfaceElevated, true: theme.colors.surfaceHighlight }}
                  thumbColor={hideVaultButton ? theme.colors.textPrimary : theme.colors.textTertiary}
                />
              </View>
              </SettingsItem>
            </SettingsSection>
            )}

            {/* Storage Section — manual cache control. The app auto-trims the
                cache on background, but this gives an instant manual wipe. */}
            {(searching || tabKey === 'general') && (
            <SettingsSection title="Storage" icon="database-cog" query={searchQuery} styles={styles} theme={theme}>
              <SettingsItem terms={SETTING_TERMS.cache}>
              <Text style={[styles.hint, { marginTop: 0 }]}>
                Cached photos make browsing instant but can build up over time. The app trims this
                automatically when you leave it — clear it now to free space immediately.
              </Text>

              {/* Current cache footprint. Tappable to re-measure on demand. */}
              <TouchableOpacity
                style={styles.cacheSizeRow}
                onPress={measureCache}
                disabled={measuringCache}
                activeOpacity={0.7}
              >
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>Cache size</Text>
                  <Text style={styles.settingDescription}>Tap to refresh</Text>
                </View>
                {measuringCache || cacheBytes === null ? (
                  <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                ) : (
                  <Text style={styles.cacheSizeValue}>{formatBytes(cacheBytes)}</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.secondaryButton, { marginBottom: 0 }, isClearingCache && styles.buttonDisabled]}
                onPressIn={() => notifyHaptic('warning')}
                onPress={handleClearCache}
                disabled={isClearingCache}
                activeOpacity={0.7}
              >
                {isClearingCache ? (
                  <ActivityIndicator size="small" color={theme.colors.textPrimary} style={styles.buttonIcon} />
                ) : (
                  <Icon name="broom" size={16} color={theme.colors.textPrimary} style={styles.buttonIcon} />
                )}
                <Text style={styles.secondaryButtonText}>
                  {isClearingCache ? 'Clearing...' : 'Clear photo cache'}
                </Text>
              </TouchableOpacity>
              </SettingsItem>
            </SettingsSection>
            )}

            {/* Notifications Section — verify the reminder pipeline end-to-end. */}
            {(searching || tabKey === 'general') && (
            <SettingsSection title="Notifications" icon="bell-ring" query={searchQuery} styles={styles} theme={theme}>
              <SettingsItem terms={SETTING_TERMS.notifications}>
              <Text style={[styles.hint, { marginTop: 0 }]}>
                Task and event reminders are pushed to this phone (and texted too if you turn on
                SMS for the item). Send a test to confirm they reach you.
              </Text>

              <TouchableOpacity
                style={[styles.secondaryButton, { marginBottom: 0 }, (sendingTest || !isConnected) && styles.buttonDisabled]}
                onPressIn={() => impactHaptic('medium')}
                onPress={handleTestNotification}
                disabled={sendingTest || !isConnected}
                activeOpacity={0.7}
              >
                {sendingTest ? (
                  <ActivityIndicator size="small" color={theme.colors.textPrimary} style={styles.buttonIcon} />
                ) : (
                  <Icon name="bell-ring-outline" size={16} color={theme.colors.textPrimary} style={styles.buttonIcon} />
                )}
                <Text style={styles.secondaryButtonText}>
                  {sendingTest ? 'Sending…' : 'Send test notification'}
                </Text>
              </TouchableOpacity>
              </SettingsItem>
            </SettingsSection>
            )}

            {/* Debug — developer instruments. DEV BUILDS ONLY: in a release
                build none of these tools exist, so a toggle here would be a
                switch wired to nothing. Lives at the tail of General — real
                settings first, instruments last. */}
            {__DEV__ && (searching || tabKey === 'general') && (
            <SettingsSection title="Debug" icon="bug-outline" query={searchQuery} styles={styles} theme={theme}>
              <SettingsItem terms={SETTING_TERMS.gestureProbe}>
              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>Gesture probe</Text>
                  <Text style={styles.settingDescription}>
                    Corner pill that flags slow gestures and JS stalls. Off stops the probe entirely; findings already saved are kept.
                  </Text>
                </View>
                <Switch
                  value={gestureProbeOn}
                  onValueChange={(v) => { setGestureProbeOn(v); setGestureProbeEnabled(v); }}
                  trackColor={{ false: theme.colors.surfaceElevated, true: theme.colors.surfaceHighlight }}
                  thumbColor={gestureProbeOn ? theme.colors.textPrimary : theme.colors.textTertiary}
                />
              </View>
              </SettingsItem>
            </SettingsSection>
            )}

            {/* Calendar — time format */}
            {(searching || tabKey === 'calendar') && (
            <SettingsSection title="Calendar" icon="calendar-clock" query={searchQuery} styles={styles} theme={theme}>
              <SettingsItem terms={SETTING_TERMS.timeFormat}>
              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>24-hour time</Text>
                  <Text style={styles.settingDescription}>Show times as 14:30 instead of 2:30 PM</Text>
                </View>
                <Switch
                  value={timeFormat === '24h'}
                  onValueChange={(v) => setTimeFormat(v ? '24h' : '12h')}
                  trackColor={{ false: theme.colors.surfaceElevated, true: theme.colors.surfaceHighlight }}
                  thumbColor={timeFormat === '24h' ? theme.colors.textPrimary : theme.colors.textTertiary}
                />
              </View>
              </SettingsItem>
              <SettingsItem terms={SETTING_TERMS.dayCellTasks}>
              {/* Day-cell appearance — list task titles (iOS Calendar style) vs the
                  compact project dots in each day of the month grid. */}
              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>List tasks in day cells</Text>
                  <Text style={styles.settingDescription}>Show a tiny list of task titles in each day instead of dots</Text>
                </View>
                <Switch
                  value={showCalendarDayTasks}
                  onValueChange={(v) => setShowCalendarDayTasks(v)}
                  trackColor={{ false: theme.colors.surfaceElevated, true: theme.colors.surfaceHighlight }}
                  thumbColor={showCalendarDayTasks ? theme.colors.textPrimary : theme.colors.textTertiary}
                />
              </View>
              </SettingsItem>
              <SettingsItem terms={SETTING_TERMS.freeScroll}>
              {/* Calendar scroll style — free-form continuous scrolling (iOS
                  Calendar style) vs. the default paged one-month-per-swipe. */}
              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>Free-scroll calendar</Text>
                  <Text style={styles.settingDescription}>Scroll months continuously like iOS Calendar instead of snapping one month per swipe</Text>
                </View>
                <Switch
                  value={calendarFreeScroll}
                  onValueChange={(v) => setCalendarFreeScroll(v)}
                  trackColor={{ false: theme.colors.surfaceElevated, true: theme.colors.surfaceHighlight }}
                  thumbColor={calendarFreeScroll ? theme.colors.textPrimary : theme.colors.textTertiary}
                />
              </View>
              </SettingsItem>
              <SettingsItem terms={SETTING_TERMS.defaultParticipants}>
              {/* Default participants — pond members auto-added to tasks you create */}
              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>Default participants</Text>
                  <Text style={styles.settingDescription}>People always added to tasks you create</Text>
                </View>
              </View>
              <View style={{ paddingHorizontal: 16, paddingBottom: 14, marginTop: -6 }}>
                <ParticipantPicker selected={defaultParticipants} onChange={handleChangeDefaults} />
              </View>
              </SettingsItem>
              <SettingsItem terms={SETTING_TERMS.calendarPartners}>

              {/* Calendar partners — share your whole calendar with a partner (view-only),
                  and see partners' calendars merged onto yours. Backed by /api/shares
                  'all-tasks'; partner tasks render with owner badges (multiUser). */}
              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>Calendar partners</Text>
                  <Text style={styles.settingDescription}>See a partner&rsquo;s tasks on your calendar, and share yours with them</Text>
                </View>
              </View>
              <View style={{ paddingHorizontal: 16, paddingBottom: 16, marginTop: -6 }}>
                <CalendarPartners />
              </View>
              </SettingsItem>
            </SettingsSection>
            )}

            {/* Server Connection Section */}
            {(searching || tabKey === 'connection') && (
            <SettingsSection title="Server Connection" icon="server-network" query={searchQuery} styles={styles} theme={theme}>
              <SettingsItem terms={SETTING_TERMS.serverConnection}>
              <View style={styles.statusContainer}>
                <View style={[styles.statusDot, isConnected ? styles.connected : styles.disconnected]} />
                <Text style={styles.statusText}>
                  {loading ? 'Checking...' : (isConnected ? 'Connected' : 'Disconnected')}
                </Text>
              </View>

              <Text style={styles.label}>Computer IP Address</Text>
              <View style={styles.inputContainer}>
                <Icon name="ip-network" size={18} color={theme.colors.textTertiary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="192.168.1.100"
                  placeholderTextColor={theme.colors.textPlaceholder}
                  value={ipInput}
                  onChangeText={setIpInput}
                  keyboardType="decimal-pad"
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                  blurOnSubmit={true}
                />
              </View>
              
              <Text style={styles.hint}>
                Your phone and computer must be on the same WiFi network
              </Text>

              <TouchableOpacity style={styles.primaryButton} onPressIn={() => impactHaptic('medium')} onPress={handleSave}>
                <Icon name="content-save" size={16} color={theme.colors.textPrimary} style={styles.buttonIcon} />
                <Text style={styles.primaryButtonText}>Save & Connect</Text>
              </TouchableOpacity>

              {serverIP && (
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPressIn={() => tapHaptic()}
                  onPress={handleTest}
                >
                  <Icon name="connection" size={16} color={theme.colors.textPrimary} style={styles.buttonIcon} />
                  <Text style={styles.secondaryButtonText}>Test Connection</Text>
                </TouchableOpacity>
              )}

              </SettingsItem>
              <SettingsItem terms={SETTING_TERMS.healMedia}>
              {isConnected && (
                <TouchableOpacity
                  style={{
                    flexDirection: 'row', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    paddingVertical: 16,
                    paddingHorizontal: 20,
                    backgroundColor: theme.colors.surfaceElevated,
                    borderRadius: 12,
                    marginTop: 12,
                  }}
                  onPressIn={() => tapHaptic()}
                  onPress={triggerMediaHeal}
                  disabled={isHealing}
                  activeOpacity={0.7}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(239, 68, 68, 0.1)', justifyContent: 'center', alignItems: 'center' }}>
                      <Icon name="medical-bag" size={20} color={theme.colors.accentError} />
                    </View>
                    <View>
                      <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: '600' }}>
                        Heal Media Vault
                      </Text>
                      <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 2 }}>
                        {isHealing
                          ? (healProgress?.total
                              ? `Auditing ${healProgress.processed.toLocaleString()} / ${healProgress.total.toLocaleString()}…`
                              : 'Starting audit…')
                          : 'Rebuild thumbnails & previews'}
                      </Text>
                    </View>
                  </View>
                  {isHealing ? (
                    <ActivityIndicator size="small" color={theme.colors.accentError} />
                  ) : (
                    <Icon name="chevron-right" size={24} color={theme.colors.textTertiary} />
                  )}
                </TouchableOpacity>
              )}
              </SettingsItem>
            </SettingsSection>

            )}

            {/* AI Sidecar — live status, library progress & inference stats.
                Its own card rather than a SettingsSection, so it carries its own
                search terms instead of delegating to child items. */}
            {(searching
              ? matchesQuery(searchQuery, SETTING_TERMS.sidecar)
              : tabKey === 'connection') && <SidecarStatusCard active={active} />}

            {/* Password Vault Section */}
            {(searching || tabKey === 'security') && hasVault && (
              <SettingsSection title="Password Vault" icon="shield-key" query={searchQuery} styles={styles} theme={theme}>
                <SettingsItem terms={SETTING_TERMS.passwordVault}>
                <View style={styles.vaultStatus}>
                  <Icon name="check-circle" size={14} color={theme.colors.accentSuccess} />
                  <Text style={styles.vaultStatusText}>Vault is set up and secure</Text>
                </View>

                <TouchableOpacity 
                  style={styles.secondaryButton} 
                  onPress={() => Alert.alert('Change Master Password', 'Open the Passwords tab and tap the key icon (top-right). It’s secured with Face ID / Touch ID, with your password as a fallback.')}
                >
                  <Icon name="lock-reset" size={16} color={theme.colors.textPrimary} style={styles.buttonIcon} />
                  <Text style={styles.secondaryButtonText}>
                    Change Master Password
                  </Text>
                </TouchableOpacity>

                {false && (
                  <View style={styles.changePasswordForm}>
                    <TextInput
                      style={styles.passwordInput}
                      placeholder="Current Master Password"
                      placeholderTextColor={theme.colors.textPlaceholder}
                      value={currentPassword}
                      onChangeText={setCurrentPassword}
                      secureTextEntry
                      returnKeyType="next"
                      blurOnSubmit={false}
                    />
                    <TextInput
                      style={styles.passwordInput}
                      placeholder="New Master Password (min 8 chars)"
                      placeholderTextColor={theme.colors.textPlaceholder}
                      value={newPassword}
                      onChangeText={setNewPassword}
                      secureTextEntry
                      returnKeyType="next"
                      blurOnSubmit={false}
                    />
                    <TextInput
                      style={styles.passwordInput}
                      placeholder="Confirm New Password"
                      placeholderTextColor={theme.colors.textPlaceholder}
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      secureTextEntry
                      returnKeyType="done"
                      onSubmitEditing={handleChangePassword}
                      blurOnSubmit={true}
                    />
                    <TouchableOpacity 
                      style={[styles.primaryButton, isChanging && styles.buttonDisabled]}
                      onPressIn={() => impactHaptic('medium')}
                      onPress={handleChangePassword}
                      disabled={isChanging}
                    >
                      <Text style={styles.primaryButtonText}>
                        {isChanging ? 'Changing...' : 'Update Password'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                <TouchableOpacity
                  style={styles.dangerButton}
                  onPressIn={() => notifyHaptic('warning')}
                  onPress={handleResetVault}
                >
                  <Icon name="delete-forever" size={16} color={theme.colors.accentError} style={styles.buttonIcon} />
                  <Text style={styles.dangerButtonText}>Reset Password Vault</Text>
                </TouchableOpacity>
                </SettingsItem>
              </SettingsSection>
            )}

            {(searching || tabKey === 'security') && !hasVault && (
              <SettingsSection title="Password Vault" icon="shield-off" query={searchQuery} styles={styles} theme={theme}>
                <SettingsItem terms={SETTING_TERMS.noVault}>
                <View style={styles.vaultStatus}>
                  <Icon name="alert-circle" size={14} color={theme.colors.accentError} />
                  <Text style={[styles.vaultStatusText, { color: theme.colors.accentError }]}>No vault set up</Text>
                </View>
                <Text style={styles.hint}>
                  Go to the Passwords tab to set up your encrypted password vault.
                </Text>
                </SettingsItem>
              </SettingsSection>
            )}

            {/* Pond members — owner-only invite desk. Renders its own card (and
                hides itself entirely for non-owners), so like the sidecar card
                it carries its own search terms rather than delegating to items. */}
            {(searching
              ? matchesQuery(searchQuery, SETTING_TERMS.pondInvites)
              : tabKey === 'general') && <PondInvitesSection active={active} />}

            {/* Account Section */}
            {(searching || tabKey === 'general') && (
            <SettingsSection title="Account" icon="account-circle" query={searchQuery} styles={styles} theme={theme}>
              <SettingsItem terms={SETTING_TERMS.account}>
              <TouchableOpacity
                style={styles.dangerButton}
                onPressIn={() => notifyHaptic('warning')}
                onPress={() => {
                  Alert.alert(
                    'Sign Out',
                    'Are you sure you want to sign out?',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { 
                        text: 'Sign Out', 
                        style: 'destructive',
                        onPress: async () => {
                          await logout();
                        }
                      },
                    ]
                  );
                }}
              >
                <Icon name="logout" size={16} color={theme.colors.accentError} style={styles.buttonIcon} />
                <Text style={styles.dangerButtonText}>Sign Out</Text>
              </TouchableOpacity>
              </SettingsItem>
            </SettingsSection>

            )}

            {/* Info Section */}
            {(searching
              ? matchesQuery(searchQuery, SETTING_TERMS.securityInfo)
              : tabKey === 'security') && (
            <View style={styles.infoBox}>
              <Icon name="information" size={18} color={theme.colors.textPrimary} style={styles.infoIcon} />
              <View style={styles.infoContent}>
                <Text style={styles.infoTitle}>Security Info</Text>
                <Text style={styles.infoText}>
                  Passwords are encrypted on your device before syncing. The server never sees your plaintext passwords.
                </Text>
              </View>
            </View>

            )}

            {searching && !anyMatch && (
              <View style={styles.noResults}>
                <Icon name="magnify-close" size={30} color={theme.colors.textTertiary} />
                <Text style={styles.noResultsTitle}>Nothing matches “{searchQuery}”</Text>
                <Text style={styles.noResultsHint}>
                  Try a shorter word, or describe what the setting does.
                </Text>
              </View>
            )}

            <View style={styles.bottomPadding} />
          </View>
        </TouchableWithoutFeedback>
      </KeyboardSafeScreen>
          </View>
          );
        })}
      </Animated.ScrollView>
    </View>
  );
}

const createStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 10,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 10,
    // Explicit height + paddingVertical:0 on the field below: padding alone
    // makes the glyphs ride high in an icon row.
    height: 40,
  },
  searchIcon: {
    // No margin — the row's gap already spaces it off the field.
  },
  searchInput: {
    flex: 1,
    height: 40,
    paddingVertical: 0,
    textAlignVertical: 'center',
    fontSize: 15,
    color: theme.colors.inputText,
  },
  noResults: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
    gap: 8,
  },
  noResultsTitle: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  noResultsHint: {
    color: theme.colors.textTertiary,
    fontSize: 13,
    textAlign: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  // Segmented control track — a faint rounded bar holding the 4 tab segments
  // with the sliding pill behind them. Mirrors the Notes/vault switcher.
  tabTrack: {
    flexDirection: 'row',
    position: 'relative',
    marginHorizontal: 12,
    marginVertical: 8,
    height: 40,
    borderRadius: 12,
    backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
  },
  // The sliding pill — an elevated rounded rectangle that translateX-tracks the
  // pager offset. Inset 3px top/bottom + 2px start so it floats inside the track.
  tabPill: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 2,
    borderRadius: 9,
    backgroundColor: theme.colors.surfaceElevated,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  // One tab segment — full track height, holds the two crossfading label layers.
  tabSeg: {
    flex: 1,
    height: '100%',
    zIndex: 1,
  },
  // Both label layers (muted + primary) use this: absolutely fill the segment
  // and centre their icon+label, so they stack pixel-perfectly for the crossfade.
  tabSegContent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  inner: {
    padding: 16,
  },
  section: {
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  // Highlight-colour swatches. The ring is the selection cue; a tick would be
  // unreadable across eight saturated hues.
  accentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  accentSwatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2.5,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  settingInfo: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 13,
    color: theme.colors.textTertiary,
  },
  cacheSizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    marginBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  cacheSizeValue: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    fontVariant: ['tabular-nums'],
    marginLeft: 12,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  connected: {
    backgroundColor: theme.colors.accentSuccess,
  },
  disconnected: {
    backgroundColor: theme.colors.accentError,
  },
  statusText: {
    fontSize: 15,
    color: theme.colors.textSecondary,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    color: theme.colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 10,
    borderWidth: 0,
    height: 44,
  },
  inputIcon: {
    marginLeft: 12,
    marginRight: 8,
  },
  input: {
    flex: 1,
    height: 44,
    paddingRight: 12,
    fontSize: 15,
    color: theme.colors.inputText,
  },
  hint: {
    fontSize: 13,
    color: theme.colors.textTertiary,
    marginTop: 6,
    marginBottom: 16,
  },
  primaryButton: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surfaceElevated,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  primaryButtonText: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surfaceHighlight,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: theme.colors.border,
    marginBottom: 10,
  },
  secondaryButtonText: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  dangerButton: {
    flexDirection: 'row',
    backgroundColor: 'rgba(244, 67, 54, 0.1)',
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: theme.colors.accentError,
  },
  dangerButtonText: {
    color: theme.colors.accentError,
    fontSize: 15,
    fontWeight: '600',
  },
  buttonIcon: {
    marginRight: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  vaultStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    padding: 10,
    borderRadius: 8,
  },
  vaultStatusText: {
    marginLeft: 8,
    color: theme.colors.accentSuccess,
    fontWeight: '500',
    fontSize: 14,
  },
  changePasswordForm: {
    backgroundColor: theme.colors.surface,
    padding: 12,
    borderRadius: 10,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  passwordInput: {
    backgroundColor: theme.colors.inputBackground,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 10,
    fontSize: 15,
    color: theme.colors.inputText,
    marginBottom: 10,
    borderWidth: 0,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surfaceElevated,
    padding: 14,
    borderRadius: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  infoIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontWeight: '700',
    marginBottom: 4,
    color: theme.colors.textPrimary,
    fontSize: 14,
  },
  infoText: {
    color: theme.colors.textSecondary,
    lineHeight: 18,
    fontSize: 13,
  },
  bottomPadding: {
    height: 100,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  avatarCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    marginTop: 18,
  },
  avatarImage: {
    width: 84,
    height: 84,
    borderRadius: 42,
  },
  avatarUploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 42,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileNameCol: {
    flex: 1,
  },
  // Your-points tile (mirrors the FriendCard stats row).
  profileStatsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    marginBottom: 12,
  },
  profileStatTile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    gap: 2,
  },
  profileStatValue: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  profileStatLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.colors.textTertiary,
  },
});
