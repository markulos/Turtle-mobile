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

// The resolution IN PROGRESS, if any.
//
// Caching the RESULT is not enough, because the expensive window is before
// there is a result to cache. Two independent effects ask for the token as the
// app starts — components/PomodoroNotifications.jsx and
// screens/TurtleScreen/hooks/usePomodoroSocket.js — and both see a null cache
// and both call out. Prod telemetry: /--/api/v2/push/getExpoPushToken ran 79
// times across 32 cold starts, ~2.5 per launch, p50 685ms and p95 1,143ms, for
// a value that cannot change within a session. Sharing the in-flight promise
// collapses a stampede into one call without making any caller wait longer.
let inFlight = null;

/** One shared native round-trip, whoever asks and however many ask at once. */
function resolveToken() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const tokenResp = await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID });
      cachedToken = tokenResp?.data || null;
    } catch {
      cachedToken = null;
    } finally {
      // Cleared so a FAILED resolution can be retried later — push is commonly
      // unavailable only until permission is granted or the dev build lands,
      // and caching that "no" for the life of the process would mean the app
      // never notices it became available. A success needs no retry: the
      // cachedToken check above short-circuits before this runs again.
      inFlight = null;
    }
    return cachedToken;
  })();
  return inFlight;
}

/**
 * Best-effort fetch of this device's Expo push token, cached after the first
 * success. Returns null (never throws) when push isn't available — before the
 * dev rebuild, in Expo Go, or if permission was denied.
 */
export async function getExpoPushTokenSafe() {
  if (cachedToken) return cachedToken;
  return resolveToken();
}

/** Test-only: module state survives between tests in one file. */
export function _resetPushTokenCacheForTests() {
  cachedToken = null;
  inFlight = null;
}

/**
 * Register this device's Expo push token with the server so it can be woken for
 * vault-unlock approvals. Best-effort and self-contained — never throws into the
 * caller. Remote push requires a dev/standalone build with push enabled; in
 * Expo Go (or before the rebuild) this simply returns { ok:false }.
 */
// `${origin}|${token}` of the last registration the server ACCEPTED. Only a
// success is recorded, so a failed attempt is always retried.
let lastRegistered = null;

// The registration IN PROGRESS, keyed by the pond it is talking to.
//
// The `lastRegistered` check below is only reached once a registration has
// FINISHED, which is not when the duplicates happen. The caller is an effect
// keyed on [isAuthenticated, isConnected, getBaseUrl] and those settle within
// milliseconds of each other at launch, so two or three runs sail past the
// guard together, all of them before the first POST has come back to set it.
//
// Measured, not theorised: after shipping the guard, prod still recorded 38
// writes to /devices/push-token across 14 launches — 2.7 each, unchanged —
// and every one of them returned ok, so it was never failure-retry. Sharing
// the in-flight promise is the half of the fix that was missing, exactly as it
// was for resolveToken above.
let registerInFlight = null;

/** Test-only, alongside _resetPushTokenCacheForTests. */
export function _resetRegistrationForTests() {
  lastRegistered = null;
  registerInFlight = null;
}

export function registerForVaultPush(getBaseUrl) {
  let base = '';
  try { base = getBaseUrl(); } catch { base = ''; }

  // Already registered THIS token against THIS pond — nothing has changed and
  // nothing to say. Cheap, synchronous, and the steady state after launch.
  if (cachedToken && lastRegistered === `${base}|${cachedToken}`) {
    return Promise.resolve({ ok: true, token: cachedToken, skipped: true });
  }

  // A registration for this same pond is already running: join it rather than
  // starting a second. Keyed on the pond so a genuine switch between dev and
  // prod is never mistaken for a duplicate.
  if (registerInFlight && registerInFlight.base === base) return registerInFlight.promise;

  const promise = doRegisterForVaultPush(getBaseUrl, base).finally(() => {
    if (registerInFlight && registerInFlight.promise === promise) registerInFlight = null;
  });
  registerInFlight = { base, promise };
  return promise;
}

async function doRegisterForVaultPush(getBaseUrl, baseFromCaller) {
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

    // Through the same shared resolution as everyone else. This used to call
    // getExpoPushTokenAsync directly, which meant registration ignored a token
    // the app had already fetched and raced any resolution in progress — a
    // second native round-trip for a value already in hand, on every launch
    // that registers. The permission gate above still runs first; this only
    // deduplicates the fetch that follows it.
    const token = await resolveToken();
    if (!token) return { ok: false, reason: 'no-token' };

    const base = baseFromCaller || getBaseUrl();
    const res = await fetch(`${base}/devices/push-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, platform: Platform.OS }),
    });
    // Recorded only on success: a rejected registration must be retried on the
    // next trigger, not remembered as done.
    if (res.ok) lastRegistered = `${base}|${token}`;
    return { ok: res.ok, token };
  } catch (e) {
    // Most commonly "remote push not supported here" before the rebuild — fine.
    console.log('[vaultPush] register skipped:', e?.message);
    return { ok: false, reason: 'error' };
  }
}
