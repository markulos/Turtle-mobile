import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, AppState, StyleSheet, Alert } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useServer } from '../context/ServerContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { sealTo } from '../screens/PasswordsScreen/utils/bioRelay';
import { registerForVaultPush } from '../services/vaultPush';
import { impactHaptic, notifyHaptic } from '../utils/haptics';

// Must match the key useVault.js writes the biometric master password under.
const BIO_PW_KEY = 'turtleVaultMasterPwBio';

// Top-level overlay: when the web vault asks to unlock, the server pushes this
// phone; we surface an approval sheet, require Face/Touch ID, then seal the
// master password back to the browser. Mounted once, near the app root.
export default function VaultUnlockApproval() {
  const { getBaseUrl, isConnected } = useServer();
  const { isAuthenticated } = useAuth();
  const { theme } = useTheme();
  const [challenge, setChallenge] = useState(null); // { id, webPub, meta, expiresAt }
  const [busy, setBusy] = useState(false);
  const checkingRef = useRef(false);

  // Pull the newest pending challenge for this account.
  const checkPending = useCallback(async () => {
    if (!isAuthenticated || !isConnected || checkingRef.current) return;
    checkingRef.current = true;
    try {
      const r = await fetch(`${getBaseUrl()}/vault/biounlock/pending`);
      const d = await r.json().catch(() => ({}));
      if (d && d.success && d.challenge) setChallenge((prev) => prev || d.challenge);
    } catch {
      /* offline / transient — ignore */
    } finally {
      checkingRef.current = false;
    }
  }, [getBaseUrl, isAuthenticated, isConnected]);

  // Register this device for push once signed in + connected.
  useEffect(() => {
    if (isAuthenticated && isConnected) registerForVaultPush(getBaseUrl);
  }, [isAuthenticated, isConnected, getBaseUrl]);

  // Wake triggers: a vault-unlock push (foreground or tapped), app foreground,
  // and an initial check on mount.
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    checkPending();
    const isVault = (n) => {
      const data =
        n?.request?.content?.data ||
        n?.notification?.request?.content?.data ||
        {};
      return data.type === 'vault-unlock';
    };
    const recvSub = Notifications.addNotificationReceivedListener((n) => { if (isVault(n)) checkPending(); });
    const respSub = Notifications.addNotificationResponseReceivedListener((n) => { if (isVault(n)) checkPending(); });
    const appSub = AppState.addEventListener('change', (s) => { if (s === 'active') checkPending(); });
    return () => {
      recvSub?.remove?.();
      respSub?.remove?.();
      appSub?.remove?.();
    };
  }, [isAuthenticated, checkPending]);

  // Auto-dismiss when the challenge's window closes.
  useEffect(() => {
    if (!challenge) return undefined;
    const ms = Math.max(0, (challenge.expiresAt || 0) - Date.now());
    const t = setTimeout(() => setChallenge(null), ms || 1);
    return () => clearTimeout(t);
  }, [challenge]);

  const approve = useCallback(async () => {
    if (!challenge || busy) return;
    setBusy(true);
    try {
      const saved = await SecureStore.getItemAsync(BIO_PW_KEY).catch(() => null);
      if (!saved) {
        Alert.alert(
          'Set up biometric unlock first',
          'This phone can only approve web unlocks once you’ve enabled biometric unlock for the vault here: open the Vault tab, unlock once, and turn on biometrics.',
        );
        return;
      }
      const auth = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Approve vault unlock',
        fallbackLabel: 'Use passcode',
        cancelLabel: 'Cancel',
      });
      if (!auth.success) return; // cancelled / failed — leave the sheet up
      const payload = sealTo(saved, challenge.webPub);
      const r = await fetch(`${getBaseUrl()}/vault/biounlock/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: challenge.id, ...payload }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.success === false) {
        Alert.alert('Could not approve', d.message || 'The request may have expired — try again from the browser.');
      }
      setChallenge(null);
    } catch {
      Alert.alert('Error', 'Could not approve the unlock.');
    } finally {
      setBusy(false);
    }
  }, [challenge, busy, getBaseUrl]);

  const deny = useCallback(async () => {
    if (!challenge) return;
    const id = challenge.id;
    setChallenge(null);
    try {
      await fetch(`${getBaseUrl()}/vault/biounlock/deny`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch {
      /* best-effort */
    }
  }, [challenge, getBaseUrl]);

  if (!challenge) return null;
  const m = challenge.meta || {};
  const where = [m.browser, m.os].filter(Boolean).join(' · ') || 'Unknown device';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={deny}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Icon name="shield-key" size={34} color={theme.colors.accentInfo || theme.colors.primary} style={{ alignSelf: 'center' }} />
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Approve vault unlock?</Text>
          <Text style={[styles.sub, { color: theme.colors.textSecondary }]}>
            A browser is asking to open your password vault.
          </Text>

          <View style={[styles.metaBox, { borderColor: theme.colors.border }]}>
            <MetaRow label="From" value={where} theme={theme} />
            {!!m.ip && <MetaRow label="IP" value={m.ip} theme={theme} />}
          </View>

          <Text style={[styles.warn, { color: theme.colors.textMuted }]}>
            Only approve if this is you, right now. Face/Touch ID is required.
          </Text>

          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.btn, { borderColor: theme.colors.border, borderWidth: 1 }]}
              onPressIn={() => notifyHaptic('warning')}
              onPress={deny}
              disabled={busy}
            >
              <Text style={[styles.btnText, { color: theme.colors.textSecondary }]}>Deny</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.approve, { backgroundColor: theme.colors.accentSuccess || theme.colors.primary }]}
              onPressIn={() => impactHaptic('medium')}
              onPress={approve}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={[styles.btnText, { color: '#fff' }]}>Approve</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function MetaRow({ label, value, theme }) {
  return (
    <View style={styles.metaRow}>
      <Text style={[styles.metaLabel, { color: theme.colors.textMuted }]}>{label}</Text>
      <Text style={[styles.metaVal, { color: theme.colors.textPrimary }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 18,
    borderWidth: 1,
    padding: 22,
  },
  title: { fontSize: 19, fontWeight: '800', textAlign: 'center', marginTop: 10 },
  sub: { fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 18 },
  metaBox: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 16, gap: 8 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  metaLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  metaVal: { fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  warn: { fontSize: 11, textAlign: 'center', marginTop: 14, lineHeight: 16 },
  row: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btn: { flex: 1, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  approve: {},
  btnText: { fontSize: 15, fontWeight: '700' },
});
