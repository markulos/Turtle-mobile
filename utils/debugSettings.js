/**
 * debugSettings — persisted developer toggles.
 *
 * One tiny store instead of scattering AsyncStorage reads: a synchronous
 * in-memory value (so render paths never await), hydrated once at import,
 * with subscribers so a toggle takes effect LIVE — flipping the gesture
 * probe off in Settings stops the probe and hides its pill immediately,
 * no reload.
 *
 * Everything here is dev-tooling state, not product settings: keys are
 * namespaced `debug:` and every consumer must also gate on __DEV__ (a
 * release build has no probe to toggle — the setting would be a lie).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_GESTURE_PROBE = 'debug:gestureProbe:enabled';

// Default ON: the probe is the instrument that catches what the simulator
// can't, and a dev build with it silently off would hide exactly the
// findings it exists to catch. Turning it off is the explicit choice.
let gestureProbeEnabled = true;
const listeners = new Set();

// Hydrate once at module load. Until this lands the default answers — the
// probe may run for the first few hundred ms of a launch before a persisted
// "off" arrives, which costs one interval tick and nothing else.
AsyncStorage.getItem(KEY_GESTURE_PROBE)
  .then((raw) => {
    if (raw === null) return; // never written — keep the default
    const next = raw === 'true';
    if (next === gestureProbeEnabled) return;
    gestureProbeEnabled = next;
    listeners.forEach((l) => { try { l(); } catch { /* listener's problem */ } });
  })
  .catch(() => { /* unreadable — keep the default */ });

export function isGestureProbeEnabled() {
  return gestureProbeEnabled;
}

export function setGestureProbeEnabled(next) {
  const value = !!next;
  if (value === gestureProbeEnabled) return;
  gestureProbeEnabled = value;
  listeners.forEach((l) => { try { l(); } catch { /* listener's problem */ } });
  AsyncStorage.setItem(KEY_GESTURE_PROBE, String(value)).catch(() => {});
}

/** Subscribe to any debug-setting change. Returns the unsubscribe. */
export function subscribeDebugSettings(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
