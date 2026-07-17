/**
 * Shared haptic feedback — the single source of truth for tactile button
 * response across the app. Extracted from the per-file `tapHaptic` / `hapticTick`
 * copies that had grown up independently in TaskItem, MediaGallery and
 * WheelTimePicker so every action button can fire the SAME instant confirmation.
 *
 * Why this matters for responsiveness: firing a haptic the moment a finger
 * touches an action button (on `onPressIn`, not `onPress`) makes the button feel
 * like it reacted instantly — the action reads as "done" before the optimistic
 * state update and the background save have even started. It's the cheapest,
 * highest-impact way to make every button feel snappy.
 *
 * Defensive everywhere:
 *   - `expo-haptics` is loaded via require() so a dev build that somehow lacks
 *     the native module degrades to React Native's built-in Vibration instead of
 *     throwing.
 *   - Every call is wrapped — haptics are garnish; they must NEVER break an
 *     actual action. A failed buzz is silently swallowed.
 */
import { Vibration } from 'react-native';

let _Haptics = null;
try { _Haptics = require('expo-haptics'); } catch (e) { _Haptics = null; }

// Light tap — the default for taps, toggles, chips, list rows, day cells, the
// tab bar. Uses the SOFT impact: iOS's gentlest, most CUSHIONED haptic, which
// reads as a rounded, gradual "give" rather than the crisp selectionAsync tick
// (that one felt too sharp + short). selectionAsync is the fallback for a build
// whose expo-haptics lacks the Soft style; Vibration is the last resort.
export const tapHaptic = () => {
  try {
    if (_Haptics?.impactAsync && _Haptics?.ImpactFeedbackStyle?.Soft != null) {
      _Haptics.impactAsync(_Haptics.ImpactFeedbackStyle.Soft);
      return;
    }
    if (_Haptics?.selectionAsync) { _Haptics.selectionAsync(); return; }
  } catch (e) { /* native module absent — fall through to Vibration */ }
  // Android's basic Vibration is fixed-amplitude, so "smooth" isn't achievable
  // here — keep it a single very-short buzz (softest the API allows).
  try { Vibration.vibrate(6); } catch (e) { /* no vibrator — ignore */ }
};

// Impact thump — for weightier primary actions (save, send, unlock, FAB).
// `style` ∈ 'light' | 'medium' | 'heavy'.
export const impactHaptic = (style = 'light') => {
  try {
    const map = {
      light: _Haptics?.ImpactFeedbackStyle?.Light,
      medium: _Haptics?.ImpactFeedbackStyle?.Medium,
      heavy: _Haptics?.ImpactFeedbackStyle?.Heavy,
    };
    if (_Haptics?.impactAsync) { _Haptics.impactAsync(map[style] ?? map.light); return; }
  } catch (e) { /* fall through */ }
  try { Vibration.vibrate(style === 'heavy' ? 20 : style === 'medium' ? 14 : 10); } catch (e) {}
};

// Notification buzz — success / warning / error outcomes (vault unlocked,
// invite sent, delete confirmed). `type` ∈ 'success' | 'warning' | 'error'.
export const notifyHaptic = (type = 'success') => {
  try {
    const map = {
      success: _Haptics?.NotificationFeedbackType?.Success,
      warning: _Haptics?.NotificationFeedbackType?.Warning,
      error: _Haptics?.NotificationFeedbackType?.Error,
    };
    if (_Haptics?.notificationAsync) { _Haptics.notificationAsync(map[type] ?? map.success); return; }
  } catch (e) { /* fall through */ }
  try { Vibration.vibrate(type === 'error' ? [0, 30, 40, 30] : 16); } catch (e) {}
};
