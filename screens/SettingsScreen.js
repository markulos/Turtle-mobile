import React, { useState, useEffect, useCallback } from 'react';
import ParticipantPicker from './TasksScreen/components/ParticipantPicker';
import CalendarPartners from './TasksScreen/components/CalendarPartners';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
  Keyboard,
  TouchableWithoutFeedback,
  Switch,
  AppState,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { KeyboardSafeScreen } from '../components/KeyboardSafeView';
import SidecarStatusCard from '../components/SidecarStatusCard';
import { useServer } from '../context/ServerContext';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import * as SecureStore from 'expo-secure-store';
import { clearAllCaches, getCacheSizeBytes, formatBytes } from '../utils/cacheManager';

const MASTER_KEY_STORE = 'vault_master_key';
const SALT_STORE = 'vault_salt';

export default function SettingsScreen({ active = true }) {
  const { theme, isDark, toggleTheme, timeFormat, setTimeFormat, hideVaultButton, setHideVaultButton, showCalendarDayTasks, setShowCalendarDayTasks } = useTheme();
  const { serverIP, isConnected, loading, saveIP, checkConnection, api, getBaseUrl } = useServer();
  const [isHealing, setIsHealing] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  // null = not yet measured / measuring; number = bytes currently cached.
  const [cacheBytes, setCacheBytes] = useState(null);
  const [measuringCache, setMeasuringCache] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
  const SETTINGS_TABS = [
    { key: 'general', label: 'General', icon: 'tune' },
    { key: 'calendar', label: 'Calendar', icon: 'calendar' },
    { key: 'connection', label: 'Connection', icon: 'server-network' },
    { key: 'security', label: 'Security', icon: 'shield-key' },
  ];
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
      'This will scan your server database, regenerate missing thumbnails, and purge broken ghost files. Proceed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Heal Vault',
          style: 'destructive',
          onPress: async () => {
            setIsHealing(true);
            try {
              const authHeaders = getAuthHeaders();
              const res = await api.post('/media/heal', {}, authHeaders);
              
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

                Alert.alert(
                  'Vault Healed & Cache Cleared ✅',
                  `Healthy Files: ${res.stats?.healthy ?? 0}\nRescued: ${res.stats?.rescued ?? 0}\nThumbnails Built: ${res.stats?.regenerated ?? 0}\nGhosts Purged: ${res.stats?.deleted ?? 0}\n\nLocal app memory has been flushed.`
                );
              } else {
                Alert.alert('Error', res?.error || 'Failed to heal the vault.');
              }
            } catch (error) {
              console.error('[Settings] Heal error:', error);
              Alert.alert('Error', 'Network request failed.');
            } finally {
              setIsHealing(false);
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

      {/* Fixed tab bar — equal-width tabs so nothing squishes or jumps */}
      <View style={styles.tabBar}>
        {SETTINGS_TABS.map((t) => {
          const tabActive = activeTab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, tabActive && styles.tabActive]}
              onPress={() => setActiveTab(t.key)}
              activeOpacity={0.7}
            >
              <Icon
                name={t.icon}
                size={16}
                color={tabActive ? theme.colors.textPrimary : theme.colors.textTertiary}
              />
              <Text
                style={[styles.tabLabel, { color: tabActive ? theme.colors.textPrimary : theme.colors.textTertiary }]}
                numberOfLines={1}
              >
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <KeyboardSafeScreen>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.inner}>
            {/* Profile Section — avatar + alias used across the app */}
            {activeTab === 'general' && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.iconContainer, { backgroundColor: theme.colors.surfaceElevated }]}>
                  <Icon name="account-circle" size={20} color={theme.colors.textPrimary} />
                </View>
                <Text style={styles.sectionTitle}>Profile</Text>
              </View>

              <View style={styles.profileRow}>
                <TouchableOpacity onPress={handlePickAvatar} activeOpacity={0.8} disabled={uploadingAvatar}>
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
                  onPress={handleSaveName}
                  disabled={savingName}
                >
                  <Icon name="content-save" size={16} color={theme.colors.textPrimary} style={styles.buttonIcon} />
                  <Text style={styles.primaryButtonText}>{savingName ? 'Saving...' : 'Save Name'}</Text>
                </TouchableOpacity>
              )}
            </View>
            )}

            {/* Appearance Section */}
            {activeTab === 'general' && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.iconContainer, { backgroundColor: theme.colors.surfaceElevated }]}>
                  <Icon name="palette" size={20} color={theme.colors.textPrimary} />
                </View>
                <Text style={styles.sectionTitle}>Appearance</Text>
              </View>
              
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
            </View>

            )}

            {/* Navigation Section — control what shows in the bottom navbar. */}
            {activeTab === 'general' && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.iconContainer, { backgroundColor: theme.colors.surfaceElevated }]}>
                  <Icon name="dock-bottom" size={20} color={theme.colors.textPrimary} />
                </View>
                <Text style={styles.sectionTitle}>Navigation</Text>
              </View>

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
            </View>
            )}

            {/* Storage Section — manual cache control. The app auto-trims the
                cache on background, but this gives an instant manual wipe. */}
            {activeTab === 'general' && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.iconContainer, { backgroundColor: theme.colors.surfaceElevated }]}>
                  <Icon name="database-cog" size={20} color={theme.colors.textPrimary} />
                </View>
                <Text style={styles.sectionTitle}>Storage</Text>
              </View>

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
            </View>
            )}

            {/* Calendar — time format */}
            {activeTab === 'calendar' && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.iconContainer, { backgroundColor: theme.colors.surfaceElevated }]}>
                  <Icon name="calendar-clock" size={20} color={theme.colors.textPrimary} />
                </View>
                <Text style={styles.sectionTitle}>Calendar</Text>
              </View>
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
            </View>
            )}

            {/* Server Connection Section */}
            {activeTab === 'connection' && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.iconContainer, { backgroundColor: theme.colors.surfaceElevated }]}>
                  <Icon name="server-network" size={20} color={theme.colors.textPrimary} />
                </View>
                <Text style={styles.sectionTitle}>Server Connection</Text>
              </View>
              
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

              <TouchableOpacity style={styles.primaryButton} onPress={handleSave}>
                <Icon name="content-save" size={16} color={theme.colors.textPrimary} style={styles.buttonIcon} />
                <Text style={styles.primaryButtonText}>Save & Connect</Text>
              </TouchableOpacity>

              {serverIP && (
                <TouchableOpacity 
                  style={styles.secondaryButton} 
                  onPress={handleTest}
                >
                  <Icon name="connection" size={16} color={theme.colors.textPrimary} style={styles.buttonIcon} />
                  <Text style={styles.secondaryButtonText}>Test Connection</Text>
                </TouchableOpacity>
              )}

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
                        {isHealing ? 'Scanning Dell R730 database...' : 'Purge ghosts & rebuild thumbnails'}
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
            </View>

            )}

            {/* AI Sidecar — live status, library progress & inference stats */}
            {activeTab === 'connection' && <SidecarStatusCard active={active} />}

            {/* Password Vault Section */}
            {activeTab === 'security' && hasVault && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={[styles.iconContainer, { backgroundColor: theme.colors.surfaceElevated }]}>
                    <Icon name="shield-key" size={20} color={theme.colors.textPrimary} />
                  </View>
                  <Text style={styles.sectionTitle}>Password Vault</Text>
                </View>

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
                  onPress={handleResetVault}
                >
                  <Icon name="delete-forever" size={16} color={theme.colors.accentError} style={styles.buttonIcon} />
                  <Text style={styles.dangerButtonText}>Reset Password Vault</Text>
                </TouchableOpacity>
              </View>
            )}

            {activeTab === 'security' && !hasVault && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={[styles.iconContainer, { backgroundColor: 'rgba(244, 67, 54, 0.15)' }]}>
                    <Icon name="shield-off" size={20} color={theme.colors.accentError} />
                  </View>
                  <Text style={styles.sectionTitle}>Password Vault</Text>
                </View>
                <View style={styles.vaultStatus}>
                  <Icon name="alert-circle" size={14} color={theme.colors.accentError} />
                  <Text style={[styles.vaultStatusText, { color: theme.colors.accentError }]}>No vault set up</Text>
                </View>
                <Text style={styles.hint}>
                  Go to the Passwords tab to set up your encrypted password vault.
                </Text>
              </View>
            )}

            {/* Account Section */}
            {activeTab === 'general' && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.iconContainer, { backgroundColor: theme.colors.surfaceElevated }]}>
                  <Icon name="account-circle" size={20} color={theme.colors.textPrimary} />
                </View>
                <Text style={styles.sectionTitle}>Account</Text>
              </View>
              
              <TouchableOpacity 
                style={styles.dangerButton} 
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
            </View>

            )}

            {/* Info Section */}
            {activeTab === 'security' && (
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

            <View style={styles.bottomPadding} />
          </View>
        </TouchableWithoutFeedback>
      </KeyboardSafeScreen>
    </View>
  );
}

const createStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
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
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: 10,
  },
  tabActive: {
    backgroundColor: theme.colors.surfaceElevated,
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
