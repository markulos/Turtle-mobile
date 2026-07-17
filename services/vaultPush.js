import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// EAS project id — needed for Expo push tokens. Read from the app config with a
// hard fallback so a stripped config can't break registration.
const PROJECT_ID =
  Constants?.expoConfig?.extra?.eas?.projectId ||
  Constants?.easConfig?.projectId ||
  'd7ce39a1-915a-4ee7-990a-6066708faa03';

// This device's Expo push token, cached once resolved so callers that need it
// synchronously (e.g. tagging a pomodoro-start with "ping this device") don't
// pay a native round-trip every time.
let cachedToken = null;

/**
 * Best-effort fetch of this device's Expo push token, cached after the first
 * success. Returns null (never throws) when push isn't available — before the
 * dev rebuild, in Expo Go, or if permission was denied.
 */
export async function getExpoPushTokenSafe() {
  if (cachedToken) return cachedToken;
  try {
    const tokenResp = await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID });
    cachedToken = tokenResp?.data || null;
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

/**
 * Register this device's Expo push token with the server so it can be woken for
 * vault-unlock approvals. Best-effort and self-contained — never throws into the
 * caller. Remote push requires a dev/standalone build with push enabled; in
 * Expo Go (or before the rebuild) this simply returns { ok:false }.
 */
export async function registerForVaultPush(getBaseUrl) {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('vault-unlock', {
        name: 'Vault unlock',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
      });
      // Separate channel so pomodoro end-pings show/sound independently of the
      // vault channel (server sends these with channelId 'pomodoro').
      await Notifications.setNotificationChannelAsync('pomodoro', {
        name: 'Pomodoro timer',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
      });
    }

    let settings = await Notifications.getPermissionsAsync();
    let granted =
      settings.granted ||
      settings.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED ||
      settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    if (!granted) {
      const req = await Notifications.requestPermissionsAsync();
      granted =
        req.granted ||
        req.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED ||
        req.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    }
    if (!granted) return { ok: false, reason: 'permission' };

    const tokenResp = await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID });
    const token = tokenResp?.data;
    if (!token) return { ok: false, reason: 'no-token' };
    cachedToken = token;

    const res = await fetch(`${getBaseUrl()}/devices/push-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, platform: Platform.OS }),
    });
    return { ok: res.ok, token };
  } catch (e) {
    // Most commonly "remote push not supported here" before the rebuild — fine.
    console.log('[vaultPush] register skipped:', e?.message);
    return { ok: false, reason: 'error' };
  }
}
